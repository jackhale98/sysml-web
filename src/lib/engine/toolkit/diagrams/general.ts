/**
 * The General View (SysML v2 clause 9.2.20 `GeneralView`): definitions as
 * square boxes, usages as rounded ones, each with its features in
 * compartments; part usages composed into trees; specialization,
 * typing ("defined by") and composition edges between what is drawn.
 *
 * The scope decides what is drawn:
 * - a package: its definitions, usages (as part trees) and packages, plus
 *   the definitions its definitions specialize or are built from;
 * - a definition: it, its parts as usages, and the definitions those are
 *   typed by or it specializes;
 * - a usage: its part tree;
 * - a view usage: what it exposes after its filters (resolved by the
 *   toolkit), with connections between exposed elements as edges (a
 *   `#derivation` connection as «derive»);
 * - nothing: every definition of the project.
 */
import type { DiagramGraph } from '../../types';
import type { ElementRecord } from '../model';
import {
	CONNECTORS,
	DiagramContext,
	GraphBuilder,
	docText,
	featureRow,
	keywordOf,
	nameLabel,
	nodeKindOf,
	usageLabel,
	viewRows
} from './context';
import { connectorEdges, viewExposed } from './connectors';

/** Levels of a part tree drawn as boxes; deeper parts are compartment rows. */
const TREE_DEPTH = 3;

export function generalView(ctx: DiagramContext, scope: string | null): DiagramGraph {
	if (scope === null) return wholeModel(ctx);
	const subject = ctx.resolve(scope, (r) =>
		r.kind === 'package' || r.metaclass === 'ViewUsage' ? 3 : r.isDefinition ? 2 : 1
	);
	const g = new GraphBuilder(`gv [${subject?.written ?? scope}]`);
	if (!subject) return g.graph();
	const general = new General(ctx, g);
	if (subject.metaclass === 'ViewUsage') general.view(subject);
	else if (subject.kind === 'package') general.package(subject);
	else if (subject.isDefinition) general.definition(subject);
	else general.usageTree(subject, null, 0);
	general.relationships();
	return g.graph();
}

function wholeModel(ctx: DiagramContext): DiagramGraph {
	const g = new GraphBuilder('gv [model]');
	const general = new General(ctx, g);
	for (const r of ctx.records) {
		if (!r.isDefinition || r.kind === 'package' || !r.name) continue;
		const owner = r.ownerId ? ctx.byId.get(r.ownerId) : undefined;
		if (owner && owner.kind !== 'package') continue;
		general.def(r);
	}
	general.relationships();
	return g.graph();
}

class General {
	private readonly ctx: DiagramContext;
	private readonly g: GraphBuilder;
	/** Records drawn, in order, and the connectors whose ends may be drawn. */
	private readonly shown: ElementRecord[] = [];
	private readonly connectors: ElementRecord[] = [];

	constructor(ctx: DiagramContext, g: GraphBuilder) {
		this.ctx = ctx;
		this.g = g;
	}

	package(p: ElementRecord) {
		const defs: ElementRecord[] = [];
		for (const m of this.ctx.members(p)) {
			if (CONNECTORS.test(m.metaclass)) this.connectors.push(m);
			else if (!m.name) continue;
			else if (m.kind === 'package') this.pkg(m);
			else if (m.isDefinition) {
				defs.push(m);
				this.def(m);
			} else this.usageTree(m, null, 0);
		}
		this.referenced(defs);
	}

	definition(d: ElementRecord) {
		const parts = this.ctx.features(d).filter(isPart);
		this.def(d, new Set(parts.map((p) => p.id)));
		const node = this.g.drawn.get(d.id)!;
		for (const part of parts) {
			const child = this.usageTree(part, null, 0);
			if (child) this.g.edge(node, child, 'composition');
		}
		const nested = this.ctx.members(d).filter((m) => m.isDefinition && m.name);
		for (const m of nested) this.def(m);
		for (const m of this.ctx.members(d)) if (CONNECTORS.test(m.metaclass)) this.connectors.push(m);
		this.referenced([d, ...nested], parts);
	}

	view(v: ElementRecord) {
		const exposed = viewExposed(this.ctx, v);
		const ids = new Set(exposed.map((r) => r.id));
		for (const r of exposed) {
			if (CONNECTORS.test(r.metaclass)) {
				this.connectors.push(r);
				continue;
			}
			if (!r.name) continue;
			// Features drawn as their own boxes leave their owner's compartments.
			const boxed = new Set(
				this.ctx
					.features(r)
					.filter((f) => ids.has(f.id))
					.map((f) => f.id)
			);
			if (r.kind === 'package') this.pkg(r);
			else if (r.isDefinition) this.def(r, boxed);
			else {
				const owner = [...this.ctx.ancestors(r)].find((a) => this.g.drawn.has(a.id));
				const ownerId = owner ? this.g.drawn.get(owner.id)! : null;
				const prefix = owner && !owner.isDefinition ? ownerId : null;
				const id = this.usage(r, prefix, boxed);
				if (ownerId && owner!.kind !== 'package') this.g.edge(ownerId, id, 'composition');
			}
		}
	}

	/** A definition with its features in compartments (except those in `boxed`). */
	def(d: ElementRecord, boxed: Set<string> = new Set()): string {
		const known = this.g.drawn.get(d.id);
		if (known) return known;
		const rows: [string, string][] = [];
		if (d.abstract) rows.push(['modifier', 'abstract']);
		const doc = isRequirement(d) ? docText(d) : null;
		if (doc) rows.push(['text', doc]);
		for (const f of this.ctx.features(d)) if (!boxed.has(f.id)) rows.push(featureRow(f));
		if (isView(d)) rows.push(...viewRows(this.ctx.textOf(d)));
		this.shown.push(d);
		return this.g.add(
			{
				id: this.g.freeId(d.written ?? d.name!, d.qualifiedName),
				label: nameLabel(d),
				kind: nodeKindOf(d),
				stereotype: `<<${keywordOf(d)}>>`,
				attributes: rows,
				is_definition: true
			},
			d
		).id;
	}

	/** A package, its members listed by kind. */
	private pkg(p: ElementRecord): string {
		const known = this.g.drawn.get(p.id);
		if (known) return known;
		const rows: [string, string][] = this.ctx
			.members(p)
			.filter((m) => m.name && !CONNECTORS.test(m.metaclass))
			.map((m) => [keywordOf(m), m.written ?? m.name!]);
		this.shown.push(p);
		return this.g.add(
			{
				id: this.g.freeId(p.written ?? p.name!, p.qualifiedName),
				label: p.written ?? p.name!,
				kind: 'package',
				stereotype: '<<package>>',
				attributes: rows
			},
			p
		).id;
	}

	/** One usage box: `prefix.name`, its features (except `boxed`) in compartments. */
	private usage(u: ElementRecord, prefix: string | null, boxed: Set<string>): string {
		const known = this.g.drawn.get(u.id);
		if (known) return known;
		const name = u.written ?? u.name!;
		const rows: [string, string][] = [];
		const doc = isRequirement(u) ? docText(u) : null;
		if (doc) rows.push(['text', doc]);
		for (const f of this.ctx.features(u)) if (!boxed.has(f.id)) rows.push(featureRow(f));
		if (isView(u)) rows.push(...viewRows(this.ctx.textOf(u)));
		for (const m of this.ctx.members(u)) if (CONNECTORS.test(m.metaclass)) this.connectors.push(m);
		this.shown.push(u);
		return this.g.add(
			{
				id: this.g.freeId(prefix ? `${prefix}.${name}` : name, u.qualifiedName),
				label: isRequirement(u) ? nameLabel(u) : usageLabel(u),
				kind: nodeKindOf(u) === 'port' ? 'block' : nodeKindOf(u),
				stereotype: `<<${keywordOf(u)}>>`,
				attributes: rows
			},
			u
		).id;
	}

	/** A usage and its parts, as boxes composed into a tree (ids are feature paths). */
	usageTree(u: ElementRecord, prefix: string | null, depth: number): string | null {
		if (!u.name) return null;
		const parts = depth + 1 < TREE_DEPTH ? this.ctx.features(u).filter(isPart) : [];
		const id = this.usage(u, prefix, new Set(parts.map((p) => p.id)));
		for (const part of parts) {
			const child = this.usageTree(part, id, depth + 1);
			if (child) this.g.edge(id, child, 'composition');
		}
		return id;
	}

	/**
	 * The project's definitions the drawn ones are built from: their
	 * supertypes and the types of their parts (and of `parts`), so a
	 * package's view shows its decomposition rather than isolated boxes.
	 */
	private referenced(defs: ElementRecord[], parts: ElementRecord[] = []) {
		const wanted: string[] = [];
		for (const d of defs) {
			wanted.push(...d.generalIds);
			for (const f of this.ctx.features(d)) if (isPart(f)) wanted.push(...f.typeIds);
		}
		for (const p of parts) wanted.push(...p.typeIds);
		for (const id of wanted) {
			const r = this.ctx.byId.get(id);
			if (r?.isDefinition && r.name && r.kind !== 'package') this.def(r);
		}
	}

	/** Specialization, typing and definition-level composition between drawn boxes. */
	relationships() {
		const { g, ctx } = this;
		for (const r of this.shown) {
			const id = g.drawn.get(r.id)!;
			for (const general of r.generalIds) {
				const target = g.drawn.get(general);
				if (target && target !== id) g.edge(id, target, 'specialization');
			}
			if (r.isDefinition) {
				// A definition's part typed by a drawn definition: a composition, labelled by the part.
				if (r.kind === 'package') continue;
				for (const f of ctx.features(r)) {
					const type = isPart(f) && !g.drawn.has(f.id) ? g.drawn.get(f.typeIds[0] ?? '') : null;
					if (type) g.edge(id, type, 'composition', f.written ?? f.name);
				}
			} else {
				for (const type of r.typeIds) {
					const target = g.drawn.get(type);
					if (target) g.edge(id, target, 'typing');
				}
			}
		}
		connectorEdges(ctx, g, this.connectors);
	}
}

const isPart = (r: ElementRecord) => r.kind === 'part' && !CONNECTORS.test(r.metaclass);

const isView = (r: ElementRecord) => /^View(Usage|Definition)$/.test(r.metaclass);

const isRequirement = (r: ElementRecord) => /^(Requirement|Concern)/.test(r.metaclass);
