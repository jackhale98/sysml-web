/**
 * The use case view (`ModelViews::UseCaseView`, a general view kept to use
 * cases): each use case an ellipse inside the boundary of its subject, the
 * actors that take part in it outside, a line from each actor to its use
 * cases, an «include» arrow to a use case that is part of another, and
 * specialization between the use cases and between the actors drawn.
 *
 * - The subject is the type of the use case's `subject` parameter (its own,
 *   or the one it inherits from its definition or general use case); for a
 *   use case usage without one, the part it is a use case of. Use cases of one subject share a boundary
 *   (a subgraph); a use case without a subject has none.
 * - An actor is drawn once per part def its `actor` parameters are typed
 *   by (`actor operator : Operator` in two use cases is one figure), so it
 *   reads as one person or system taking part in several use cases. An
 *   untyped actor is drawn by its own name.
 * - An `include use case x : X` draws X (also when the view doesn't expose
 *   it) with an «include» arrow from the use case that includes it.
 *
 * The scope decides which use cases: a view usage's exposed elements (its
 * filters apply), a package's or a part's (nested ones too), one use case,
 * or every use case of the project.
 */
import type { DiagramGraph } from '../../types';
import type { ElementRecord } from '../model';
import {
	type DiagramContext,
	GraphBuilder,
	docText,
	keywordOf,
	nameLabel,
	usageLabel
} from './context';
import { viewExposed } from './connectors';

const USE_CASE = /^(UseCase|IncludeUseCase)(Definition|Usage)$/;
const isUseCase = (r: ElementRecord) => USE_CASE.test(r.metaclass);
const isInclude = (r: ElementRecord) => r.metaclass === 'IncludeUseCaseUsage';

export function useCaseView(ctx: DiagramContext, scope: string | null): DiagramGraph {
	const subject = scope
		? ctx.resolve(scope, (r) => (r.metaclass === 'ViewUsage' ? 3 : isUseCase(r) ? 2 : 1))
		: undefined;
	const g = new GraphBuilder(`uc [${subject?.written ?? scope ?? 'model'}]`);
	if (scope && !subject) return g.graph();
	new UseCases(ctx, g).draw(useCasesIn(ctx, subject));
	return g.graph('left_right');
}

/** The use cases a scope draws, in declaration order. */
function useCasesIn(ctx: DiagramContext, scope: ElementRecord | undefined): ElementRecord[] {
	const found: ElementRecord[] = [];
	const seen = new Set<string>();
	const take = (r: ElementRecord) => {
		if (seen.has(r.id)) return;
		seen.add(r.id);
		if (isUseCase(r)) {
			// An include is drawn as an arrow from the use case it is part of.
			if (!isInclude(r) || ![...ctx.ancestors(r)].some(isUseCase)) found.push(r);
			return;
		}
		for (const m of ctx.members(r)) take(m);
	};
	if (!scope) {
		for (const r of ctx.records)
			if (isUseCase(r) && !isInclude(r) && !r.path.startsWith('libraries/')) take(r);
	} else if (scope.metaclass === 'ViewUsage') {
		for (const r of viewExposed(ctx, scope)) take(r);
	} else take(scope);
	return found.filter((r) => !!r.name);
}

/** What a use case's subject boundary stands for: its element and the name it shows. */
interface Subject {
	key: string;
	label: string;
}

class UseCases {
	private readonly ctx: DiagramContext;
	private readonly g: GraphBuilder;
	/** Use case node ids by the subject they sit in, in the order the subjects come. */
	private readonly bySubject = new Map<string, { label: string; ids: string[] }>();
	private readonly drawnUseCases: ElementRecord[] = [];
	private readonly actorDefs: ElementRecord[] = [];

	constructor(ctx: DiagramContext, g: GraphBuilder) {
		this.ctx = ctx;
		this.g = g;
	}

	draw(useCases: ElementRecord[]) {
		const queue = [...useCases];
		for (let u = queue.shift(); u; u = queue.shift()) {
			const id = this.useCase(u);
			// What it includes: drawn too, so the arrow has an end.
			for (const m of this.ctx.members(u).filter(isInclude)) {
				const target = this.ctx.byId.get(m.typeIds[0] ?? '') ?? m;
				if (!this.g.drawn.has(target.id) && target.name) {
					this.useCase(target);
					queue.push(target);
				}
				const to = this.g.drawn.get(target.id);
				if (to) this.g.edge(id, to, 'include', null, m);
			}
		}
		for (const u of this.drawnUseCases) this.actors(u);
		this.relationships();
		for (const [key, { label, ids }] of this.bySubject) {
			this.g.subgraphs.push({ id: `subject:${key}`, label, node_ids: ids });
		}
	}

	/** A use case's ellipse, in its subject's boundary. */
	private useCase(u: ElementRecord): string {
		const known = this.g.drawn.get(u.id);
		if (known) return known;
		const rows: [string, string][] = [];
		if (u.abstract) rows.push(['modifier', 'abstract']);
		const objective = this.objectiveOf(u);
		if (objective) rows.push(['objective', objective]);
		const name = u.written ?? u.name!;
		const id = this.g.add(
			{
				id: this.g.freeId(name, u.qualifiedName),
				label: u.isDefinition ? nameLabel(u) : usageLabel(u),
				kind: 'use_case',
				stereotype: `<<${keywordOf(u)}>>`,
				attributes: rows,
				is_definition: u.isDefinition
			},
			u
		).id;
		this.drawnUseCases.push(u);
		const subject = this.subjectOf(u);
		if (subject) {
			const group = this.bySubject.get(subject.key) ?? { label: subject.label, ids: [] };
			group.ids.push(id);
			this.bySubject.set(subject.key, group);
		}
		return id;
	}

	/** The type of the use case's `subject` (its own or inherited), else (a usage) its part. */
	private subjectOf(u: ElementRecord): Subject | null {
		const declared = this.inherited(u, (r) =>
			this.ctx.members(r).find((m) => m.kind === 'subject' && m.typeIds.length)
		);
		const type = declared && this.ctx.byId.get(declared.typeIds[0]!);
		if (type?.name) return { key: type.id, label: nameLabel(type) };
		if (!u.isDefinition) {
			const owner = [...this.ctx.ancestors(u)].find((a) => a.kind !== 'package' && !isUseCase(a));
			if (owner?.name) return { key: owner.id, label: nameLabel(owner) };
		}
		return null;
	}

	/** The objective's text: the use case's own, else the one it inherits. */
	private objectiveOf(u: ElementRecord): string | null {
		const objective = this.inherited(u, (r) =>
			this.ctx.members(r).find((m) => m.kind === 'objective' && m.docs.length)
		);
		return objective ? docText(objective) : null;
	}

	/** The first answer of `read` on the use case, then on what it is typed by or specializes. */
	private inherited<T>(u: ElementRecord, read: (r: ElementRecord) => T | undefined): T | undefined {
		const seen = new Set<string>();
		const queue = [u];
		for (let r = queue.shift(); r && seen.size < 32; r = queue.shift()) {
			if (seen.has(r.id)) continue;
			seen.add(r.id);
			const found = read(r);
			if (found) return found;
			for (const id of [...r.typeIds, ...r.generalIds]) {
				const next = this.ctx.byId.get(id);
				if (next) queue.push(next);
			}
		}
		return undefined;
	}

	/** The actors of a use case (its own, else those it inherits), each joined to it. */
	private actors(u: ElementRecord) {
		const target = this.g.drawn.get(u.id)!;
		const params = this.inherited(u, (r) => {
			const own = this.ctx.members(r).filter((m) => m.kind === 'actor' && m.name);
			return own.length ? own : undefined;
		});
		for (const a of params ?? []) {
			const type = this.actorType(a);
			const id = type ? this.actorDef(type) : this.actorUsage(a);
			this.g.edge(id, target, 'actor', null, a);
		}
	}

	/** The part def an actor parameter is typed by, also through what it redefines. */
	private actorType(a: ElementRecord): ElementRecord | undefined {
		const typed = this.inherited(a, (r) => (r.typeIds.length ? r : undefined));
		const type = typed && this.ctx.byId.get(typed.typeIds[0]!);
		return type?.name ? type : undefined;
	}

	private actorDef(type: ElementRecord): string {
		const known = this.g.drawn.get(type.id);
		if (known) return known;
		this.actorDefs.push(type);
		return this.g.add(
			{
				id: this.g.freeId(type.written ?? type.name!, type.qualifiedName),
				label: nameLabel(type),
				kind: 'actor',
				stereotype: '<<actor>>',
				is_definition: type.isDefinition
			},
			type
		).id;
	}

	private actorUsage(a: ElementRecord): string {
		const name = a.written ?? a.name!;
		const known = this.g.nodes.find((n) => n.kind === 'actor' && n.label === name && !n.element);
		if (known) return known.id;
		return this.g.add({
			id: this.g.freeId(name, a.qualifiedName),
			label: name,
			kind: 'actor',
			stereotype: '<<actor>>'
		}).id;
	}

	/** Specialization between the use cases and between the actors drawn; a usage's definition. */
	private relationships() {
		for (const r of [...this.drawnUseCases, ...this.actorDefs]) {
			const id = this.g.drawn.get(r.id)!;
			for (const general of r.generalIds) {
				const target = this.g.drawn.get(general);
				if (target && target !== id) this.g.edge(id, target, 'specialization');
			}
			if (r.isDefinition || isInclude(r)) continue;
			for (const type of r.typeIds) {
				const target = this.g.drawn.get(type);
				if (target) this.g.edge(id, target, 'typing');
			}
		}
	}
}
