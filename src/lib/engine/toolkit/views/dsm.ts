/**
 * A view as a dependency matrix (`@MatrixRendering`, docs/dsm.md): the
 * parts, actions or requirements it exposes, in model order, and the links
 * between them, each read from the row's element to the column's.
 *
 * Items are paths from what the view exposes (`drone` › `frontLeft` ›
 * `esc`), so a part a definition gives every rotor is listed once per
 * rotor. Links come from connectors (`connect`, `interface`, `flow`,
 * `bind`, `allocate`, derivations) resolved from where they are written: a
 * connector of a definition is read in every item typed by it, its ends
 * (`frontLeft.control.setPoint`) followed member by member, and an end
 * stands for the deepest item on its path (a port for its part, a
 * parameter for its action). Successions come from the toolkit's action
 * graph, followed through forks, joins, decisions and merges; satisfy links
 * from the model's trace; typing from the items' features. Every link of
 * the kinds the matrix offers is returned: the view's `dependencies` say
 * which count, so a choice in the app shows at once.
 *
 * Made on first ask per view and analysis.
 */
import type {
	DependencyKind,
	DependencyMatrix,
	MatrixElements,
	MatrixItem,
	MatrixLink
} from '../../types';
import { WRITTEN_ENDS, WRITTEN_NAME } from '../diagrams/related';
import { labelName, toGraph } from '../diagrams/tkgraph';
import { isReference, type ElementRecord } from '../model';
import { findView, listViews, renderingSpec, viewChain, viewClauses } from './catalog';
import type { ViewContext } from './context';
import { parseExpose, type ExposeKind } from './render';
import { simpleName, splitPath, unquoteName } from './text';

/** The kinds each kind of matrix offers, in the order the app shows them. */
export const MATRIX_KINDS: Record<MatrixElements, DependencyKind[]> = {
	parts: ['connection', 'flow', 'binding', 'allocation', 'typing', 'satisfy'],
	actions: ['succession', 'flow', 'binding', 'allocation', 'typing'],
	requirements: ['derivation', 'refinement', 'satisfy', 'typing']
};

const ALL_KINDS = new Set<DependencyKind>(Object.values(MATRIX_KINDS).flat());

/** How deep `expose X::**` lists items when the view doesn't say. */
const DEEPEST = 8;

const CONNECTORS: Record<string, DependencyKind> = {
	ConnectionUsage: 'connection',
	InterfaceUsage: 'connection',
	FlowUsage: 'flow',
	SuccessionFlowUsage: 'flow',
	BindingConnectorAsUsage: 'binding',
	AllocationUsage: 'allocation'
};

const ELEMENTS: Record<MatrixElements, (r: ElementRecord) => boolean> = {
	parts: (r) =>
		r.metaclass === 'PartDefinition' || (r.metaclass === 'PartUsage' && !isReference(r)),
	actions: (r) =>
		/Action(Usage|Definition)$/.test(r.metaclass) && r.metaclass !== 'AssignmentActionUsage',
	requirements: (r) => /^(Requirement|Concern)(Usage|Definition)$/.test(r.metaclass)
};

const cache = new WeakMap<ViewContext, Map<string, DependencyMatrix>>();

/** The view `name` as a dependency matrix. */
export function dependencyMatrix(ctx: ViewContext, name: string): DependencyMatrix {
	let views = cache.get(ctx);
	if (!views) cache.set(ctx, (views = new Map()));
	let matrix = views.get(name);
	if (!matrix) {
		matrix = build(ctx, name);
		views.set(name, matrix);
	}
	return matrix;
}

function build(ctx: ViewContext, name: string): DependencyMatrix {
	const view = findView(ctx, name);
	if (!view) {
		const names = listViews(ctx).map((v) => v.name);
		throw new Error(
			`view \`${name}\` not found. Available views: ${names.length ? names.join(', ') : '(none)'}`
		);
	}
	const spec = renderingSpec(ctx, view, 'MatrixRendering');
	const elements = spec?.get('elements')?.trim() as MatrixElements | undefined;
	if (!spec || !elements || !(elements in MATRIX_KINDS))
		throw new Error(
			`view \`${view.name}\` has no @MatrixRendering saying what its rows are (parts, actions or requirements)`
		);
	const warnings: string[] = [];
	const available = MATRIX_KINDS[elements];
	const kinds = readKinds(spec.get('dependencies') ?? '', available, warnings);
	const levels = Number.parseInt(spec.get('levels') ?? '', 10);
	const reader = new MatrixReader(ctx, elements, Number.isFinite(levels) ? levels : DEEPEST);
	reader.collect(view, warnings);
	reader.connectors();
	if (available.includes('succession')) reader.successions();
	reader.traces();
	reader.typing();
	return {
		view: view.name ?? name,
		elements,
		kinds,
		available,
		order: spec.get('order')?.trim() === 'clustered' ? 'clustered' : 'model',
		cells: spec.get('cells')?.trim() === 'names' ? 'names' : 'marks',
		scope: reader.scope(),
		items: reader.items,
		links: reader.links.filter((l) => available.includes(l.kind)),
		outside: reader.outside.filter((o) => available.includes(o.kind)),
		warnings
	};
}

/** `"connection; flow"` → the kinds, in the order the matrix offers them. */
function readKinds(
	written: string,
	available: DependencyKind[],
	warnings: string[]
): DependencyKind[] {
	const asked = written
		.split(/[;,]/)
		.map((k) => k.trim())
		.filter(Boolean);
	for (const k of asked) {
		if (!ALL_KINDS.has(k as DependencyKind))
			warnings.push(`\`${k}\` is not a kind of dependency this matrix knows; ignored`);
		else if (!available.includes(k as DependencyKind))
			warnings.push(`\`${k}\` does not link these elements; ignored`);
	}
	return available.filter((k) => asked.includes(k));
}

/** A path of element ids from the outermost owner, keyed for lookups. */
const keyOf = (path: readonly string[]) => path.join('/');

class MatrixReader {
	readonly items: MatrixItem[] = [];
	readonly links: MatrixLink[] = [];
	readonly outside: DependencyMatrix['outside'] = [];
	private readonly ctx: ViewContext;
	private readonly elements: MatrixElements;
	private readonly levels: number;
	private readonly accepts: (r: ElementRecord) => boolean;
	/** Each item's path, by index, and the index by path key. */
	private readonly paths: string[][] = [];
	private readonly byPath = new Map<string, number>();
	/** The namespaces items are listed from, as paths: their connectors link the items. */
	private readonly roots: string[][] = [];
	private readonly seenLinks = new Set<string>();
	private readonly seenOutside = new Set<string>();

	constructor(ctx: ViewContext, elements: MatrixElements, levels: number) {
		this.ctx = ctx;
		this.elements = elements;
		this.levels = Math.max(1, levels);
		this.accepts = ELEMENTS[elements];
	}

	/** What the matrix is of, when it lists one element's members. */
	scope(): string | null {
		const named = this.roots.map((p) => this.ctx.byId.get(p.at(-1)!)).filter((r) => r?.name);
		return named.length === 1 && named[0]!.kind !== 'package' ? named[0]!.name : null;
	}

	// --- Items -------------------------------------------------------------------------

	/** The items the view exposes (or, without `expose`, the matrix's usual subject). */
	collect(view: ElementRecord, warnings: string[]) {
		const chain = viewChain(this.ctx, view);
		const exposing = chain
			.map((v) => ({ v, ...viewClauses(this.ctx.textOf(v)) }))
			.find((c) => c.expose.length);
		if (!exposing) {
			this.collectDefault();
			return;
		}
		for (const text of exposing.expose) {
			const { kind, base } = parseExpose(text);
			const id = this.ctx.resolveIn(exposing.v.id, base);
			const target = id ? this.ctx.byId.get(id) : undefined;
			if (!target) {
				warnings.push(`expose \`${text}\` does not name an element of the model; ignored`);
				continue;
			}
			this.expose(target, kind);
		}
	}

	private expose(target: ElementRecord, kind: ExposeKind) {
		const path = this.pathOf(target);
		if (kind === 'element') {
			const owner = path.slice(0, -1);
			if (owner.length) this.addRoot(owner);
			if (this.accepts(target)) this.addItem(target, path, 0, null);
			return;
		}
		this.addRoot(path);
		this.addMembers(path, 0, null, kind === 'members' ? 1 : this.levels);
	}

	/**
	 * Without `expose`: the parts of the project's first part with parts (a
	 * system), the steps of its first action with steps, or every
	 * requirement its packages hold.
	 */
	private collectDefault() {
		const content = this.ctx.records.filter((r) => this.ctx.isContent(r) && r.name);
		if (this.elements === 'requirements') {
			for (const r of content) {
				const owner = r.ownerId ? this.ctx.byId.get(r.ownerId) : undefined;
				if (this.accepts(r) && owner?.kind === 'package') {
					this.addRoot(this.pathOf(owner));
					this.addItem(r, this.pathOf(r), 0, null);
				}
			}
			return;
		}
		const subject = content.find(
			(r) =>
				(this.elements === 'parts'
					? r.metaclass === 'PartUsage' && this.ctx.byId.get(r.ownerId ?? '')?.kind === 'package'
					: r.metaclass === 'ActionDefinition') &&
				this.members(r).filter((m) => this.accepts(m)).length > 1
		);
		if (subject) this.expose(subject, 'members');
	}

	private addRoot(path: string[]) {
		if (!this.roots.some((p) => keyOf(p) === keyOf(path))) this.roots.push(path);
	}

	private addMembers(path: string[], depth: number, parent: number | null, levels: number) {
		if (levels <= 0) return;
		const owner = this.ctx.byId.get(path.at(-1)!);
		if (!owner) return;
		// A package of definitions lists its definitions; otherwise its usages are what is compared.
		const accepted = this.members(owner).filter((m) => this.accepts(m));
		const usages = accepted.filter((m) => !m.isDefinition);
		for (const m of usages.length ? usages : accepted) {
			const index = this.addItem(m, [...path, m.id], depth, parent);
			if (index !== null) this.addMembers([...path, m.id], depth + 1, index, levels - 1);
		}
	}

	private addItem(
		r: ElementRecord,
		path: string[],
		depth: number,
		parent: number | null
	): number | null {
		const key = keyOf(path);
		if (this.byPath.has(key) || !r.name) return null;
		const index = this.items.length;
		const parentPath = parent === null ? [] : this.items[parent]!.path.split('.');
		const typeId = r.isDefinition ? null : (r.typeIds[0] ?? null);
		this.items.push({
			id: r.id,
			name: r.name,
			qualifiedName: r.qualifiedName ?? r.name,
			...(r.shortName ? { shortName: unquoteName(r.shortName) } : {}),
			path: [...(parent === null ? [] : parentPath), r.name].join('.'),
			kind: r.kind,
			type: (typeId ? this.ctx.nameOf(typeId) : null) ?? (r.type ? simpleName(r.type) : null),
			depth,
			parent,
			file: r.path,
			start: r.span.start_byte,
			end: r.span.end_byte
		});
		this.paths.push(path);
		this.byPath.set(key, index);
		return index;
	}

	/** A namespace's members: what it owns, and what its types and supertypes give it. */
	private members(r: ElementRecord): ElementRecord[] {
		const own = this.ctx.ownedBy(r.id).filter((m) => m.name || CONNECTORS[m.metaclass]);
		const names = new Set(own.map((m) => m.name).filter(Boolean));
		const out = [...own];
		for (const s of this.ctx.supers(r.id)) {
			for (const m of this.ctx.ownedBy(s)) {
				if (m.isDefinition || !m.name || names.has(m.name)) continue;
				names.add(m.name);
				out.push(m);
			}
		}
		return out;
	}

	/** A member named `name`, owned or given by the element's types and supertypes. */
	private member(r: ElementRecord, name: string): ElementRecord | undefined {
		const own = this.ctx.ownedBy(r.id).find((m) => m.name === name);
		if (own) return own;
		for (const s of this.ctx.supers(r.id)) {
			const found = this.ctx.ownedBy(s).find((m) => m.name === name);
			if (found) return found;
		}
		return undefined;
	}

	/** An element's path of ids from its outermost owner. */
	private pathOf(r: ElementRecord): string[] {
		return [...this.ctx.ownerChain(r), r.id];
	}

	// --- Ends --------------------------------------------------------------------------

	/**
	 * The item a path stands for: the deepest item along it; else, for a
	 * path written another way (an action as `drone.deliveryFlight.takeOff`
	 * where the matrix lists its definition's steps), the deepest element on
	 * it that is listed once.
	 */
	private itemAt(path: readonly string[]): number | null {
		for (let n = path.length; n > 0; n--) {
			const found = this.byPath.get(keyOf(path.slice(0, n)));
			if (found !== undefined) return found;
		}
		for (let n = path.length; n > 0; n--) {
			const listed = this.items.flatMap((x, i) => (x.id === path[n - 1] ? [i] : []));
			if (listed.length === 1) return listed[0]!;
			if (listed.length) return null;
		}
		return null;
	}

	/**
	 * Where an end written in `context` (a path) leads: its first name a
	 * member of the context or of what encloses it, each next one a member
	 * of the last; else resolved as the language would from `owner`.
	 */
	private endPath(context: string[], owner: ElementRecord, written: string): string[] | null {
		const names = splitPath(written);
		if (!names.length) return null;
		for (let n = context.length; n > 0; n--) {
			const at = this.ctx.byId.get(context[n - 1]!);
			const first = at && this.member(at, names[0]!);
			if (first) return this.follow([...context.slice(0, n), first.id], first, names.slice(1));
		}
		// A name the context doesn't have (`DroneArchitecture::drone.flightController`, or one
		// an import brings): its shortest prefix that resolves, then member by member.
		const parts = written.split('.');
		for (let n = 1; n <= parts.length; n++) {
			const id = this.ctx.resolveIn(owner.id, parts.slice(0, n).join('.'));
			const record = id ? this.ctx.byId.get(id) : undefined;
			if (record) {
				const rest = parts.slice(n).flatMap((p) => splitPath(p));
				return this.follow(this.pathOf(record), record, rest);
			}
		}
		return null;
	}

	private follow(path: string[], from: ElementRecord, names: string[]): string[] {
		let at = from;
		for (const name of names) {
			const next = this.member(at, name);
			if (!next) break;
			path.push(next.id);
			at = next;
		}
		return path;
	}

	/** The name the matrix gives an end it doesn't list: the nearest element on its path that isn't a port or parameter. */
	private outsideName(path: readonly string[]): string {
		for (let n = path.length; n > 0; n--) {
			const r = this.ctx.byId.get(path[n - 1]!);
			if (r?.name && r.kind !== 'port' && !r.direction) return r.name;
		}
		return '';
	}

	private link(from: number, to: number, link: Omit<MatrixLink, 'from' | 'to'>) {
		if (from === to) return;
		const key = `${from} ${to} ${link.kind} ${link.element ?? ''}@${link.file}:${link.start}`;
		if (this.seenLinks.has(key)) return;
		this.seenLinks.add(key);
		this.links.push({ from, to, ...link });
	}

	/** One end in the matrix, the other not: noted on the item, as the phone's list shows it. */
	private outsideLink(item: number, kind: DependencyKind, direction: 'out' | 'in', name: string) {
		if (!name || name === this.items[item]!.name) return;
		const key = `${item} ${kind} ${direction} ${name}`;
		if (this.seenOutside.has(key)) return;
		this.seenOutside.add(key);
		this.outside.push({ item, kind, direction, name });
	}

	/** Link two end paths, or note the end the matrix doesn't list. */
	private connect(
		a: readonly string[] | null,
		b: readonly string[] | null,
		link: Omit<MatrixLink, 'from' | 'to'>
	) {
		if (!a || !b) return;
		const from = this.itemAt(a);
		const to = this.itemAt(b);
		if (from !== null && to !== null) this.link(from, to, link);
		else if (from !== null) this.outsideLink(from, link.kind, 'out', this.outsideName(b));
		else if (to !== null) this.outsideLink(to, link.kind, 'in', this.outsideName(a));
	}

	// --- Links -------------------------------------------------------------------------

	/**
	 * Every connector, read where it applies: in each root or item whose
	 * namespace (itself, its types and supertypes) owns it, else from where
	 * it is written.
	 */
	connectors() {
		const contexts = [...this.roots, ...this.paths];
		for (const r of this.ctx.records) {
			const kind = CONNECTORS[r.metaclass];
			if (!kind || !r.ownerId) continue;
			const owner = this.ctx.byId.get(r.ownerId);
			if (!owner) continue;
			if (/#\s*derivation\b/.test(r.header)) {
				this.derivation(r, owner);
				continue;
			}
			const inside = contexts.filter((p) => this.ctx.conforms(p.at(-1)!, owner.id));
			for (const context of inside.length ? inside : [this.pathOf(owner)])
				this.connector(r, kind, owner, context);
		}
		this.refinements();
	}

	private connector(
		r: ElementRecord,
		kind: DependencyKind,
		owner: ElementRecord,
		context: string[]
	) {
		const written = this.endsOf(r, kind);
		if (!written) return;
		const [a, b] = written.map((w) => this.endPath(context, owner, w));
		const definition = r.typeIds[0] ? this.ctx.nameOf(r.typeIds[0]) : null;
		const item =
			kind === 'flow' ? new RegExp(String.raw`\bof\s+${WRITTEN_NAME}`).exec(r.header) : null;
		this.connect(a ?? null, b ?? null, {
			kind,
			mutual: kind === 'connection' || kind === 'binding',
			...(r.name ? { name: r.name, element: r.id } : {}),
			...(definition
				? { definition }
				: r.type
					? { definition: unquoteName(simpleName(r.type)) }
					: {}),
			...(item ? { item: unquoteName(simpleName(item[1]!)) } : {}),
			...(definition && kind === 'connection' ? this.carried(r.typeIds[0]!) : {}),
			ends: written,
			file: r.path,
			start: r.span.start_byte,
			end: r.span.end_byte
		});
	}

	/** A connector's two ends as written: `connect a.p to b.q`, or its `end` features. */
	private endsOf(r: ElementRecord, kind: DependencyKind): [string, string] | null {
		const ends = this.ctx.ownedBy(r.id).filter((e) => e.end && e.specializes[0]);
		if (ends.length >= 2) return [ends[0]!.specializes[0]!, ends[1]!.specializes[0]!];
		const pattern =
			WRITTEN_ENDS[
				kind === 'connection'
					? 'connects'
					: kind === 'flow'
						? 'flows'
						: kind === 'binding'
							? 'binds'
							: 'allocates'
			];
		const found = pattern?.exec(r.header.replace(/\s+/g, ' '));
		return found ? [found[1]!, found[2]!] : null;
	}

	/**
	 * What an interface definition carries between its ends, from its own
	 * flows (`flow of ElectricPower from supply.power to load.power`): each
	 * item, and whether it goes from the first end to the second.
	 */
	private carried(definition: string): Pick<MatrixLink, 'carries'> {
		const def = this.ctx.byId.get(definition);
		if (!def) return {};
		const ends = this.members(def)
			.filter((m) => m.end && m.name)
			.map((m) => m.name!);
		if (ends.length !== 2) return {};
		const carries: NonNullable<MatrixLink['carries']> = [];
		for (const f of this.members(def)) {
			if (CONNECTORS[f.metaclass] !== 'flow') continue;
			const written = WRITTEN_ENDS.flows?.exec(f.header.replace(/\s+/g, ' '));
			const item = new RegExp(String.raw`\bof\s+${WRITTEN_NAME}`).exec(f.header);
			if (!written || !item) continue;
			const from = ends.indexOf(splitPath(written[1]!)[0] ?? '');
			const to = ends.indexOf(splitPath(written[2]!)[0] ?? '');
			if (from >= 0 && to >= 0 && from !== to)
				carries.push({ item: unquoteName(simpleName(item[1]!)), forward: from === 0 });
		}
		return carries.length ? { carries } : {};
	}

	/**
	 * `#derivation connection { end #original ::> a; end #derive ::> b; }`:
	 * from the original to each requirement derived from it.
	 */
	private derivation(r: ElementRecord, owner: ElementRecord) {
		const ends = this.ctx.ownedBy(r.id).filter((e) => e.end && e.specializes[0]);
		const context = this.pathOf(owner);
		const at = ends.map((e) => ({
			path: this.endPath(context, owner, e.specializes[0]!),
			derived: /#\s*derive\b/.test(e.header)
		}));
		const original = at.find((e) => !e.derived)?.path ?? null;
		for (const e of at)
			if (e.derived)
				this.connect(original, e.path, {
					kind: 'derivation',
					mutual: false,
					...(r.name ? { name: r.name, element: r.id } : {}),
					file: r.path,
					start: r.span.start_byte,
					end: r.span.end_byte
				});
	}

	/** `#refinement dependency a to b`: from what is refined (b) to what refines it (a). */
	private refinements() {
		const pattern = new RegExp(
			String.raw`\bdependency\s+(?:[\w$']+\s+)?(?:from\s+)?${WRITTEN_NAME}\s+to\s+${WRITTEN_NAME}`
		);
		for (const r of this.ctx.records) {
			if (!/Dependency$/.test(r.metaclass) || !/#\s*refinement\b/.test(r.header)) continue;
			const owner = r.ownerId ? this.ctx.byId.get(r.ownerId) : undefined;
			const written = pattern.exec(r.header.replace(/\s+/g, ' '));
			if (!owner || !written) continue;
			const context = this.pathOf(owner);
			this.connect(
				this.endPath(context, owner, written[2]!),
				this.endPath(context, owner, written[1]!),
				{
					kind: 'refinement',
					mutual: false,
					...(r.name ? { name: r.name, element: r.id } : {}),
					file: r.path,
					start: r.span.start_byte,
					end: r.span.end_byte
				}
			);
		}
	}

	/** `satisfy R by x`: from what satisfies to the requirement. */
	traces() {
		for (const s of this.ctx.satisfactions) {
			if (!s.by_id || !s.requirement_id) continue;
			const by = this.ctx.byId.get(s.by_id);
			const requirement = this.ctx.byId.get(s.requirement_id);
			if (!by || !requirement) continue;
			const fromPaths = this.pathsEnding(by);
			const toPaths = this.pathsEnding(requirement);
			const link = {
				kind: 'satisfy' as const,
				mutual: false,
				file: s.path,
				start: s.span.start_byte,
				end: s.span.end_byte
			};
			for (const a of fromPaths.length ? fromPaths : [this.pathOf(by)])
				for (const b of toPaths.length ? toPaths : [this.pathOf(requirement)])
					this.connect(a, b, link);
		}
	}

	/** The item paths that end at an element (several when a definition gives it to many). */
	private pathsEnding(r: ElementRecord): string[][] {
		return this.paths.filter((p) => p.at(-1) === r.id);
	}

	/**
	 * B's definition types a feature of A: from B to A, A using what B is
	 * (`Rotor`'s `esc : SpeedController` with `SpeedController` listed). An
	 * item's own listed members are its parts, not what it uses.
	 */
	typing() {
		const byType = new Map<string, number[]>();
		this.items.forEach((item, i) => {
			const r = this.ctx.byId.get(item.id);
			if (!r) return;
			for (const t of r.isDefinition ? [r.id] : r.typeIds)
				byType.set(t, [...(byType.get(t) ?? []), i]);
		});
		this.items.forEach((item, a) => {
			const r = this.ctx.byId.get(item.id);
			if (!r) return;
			const listed = new Set(
				this.items.flatMap((x) => (x.parent === a ? [x.id] : [])).concat(item.id)
			);
			for (const f of this.members(r)) {
				if (f.isDefinition || listed.has(f.id) || CONNECTORS[f.metaclass]) continue;
				for (const t of f.typeIds)
					for (const b of byType.get(t) ?? [])
						this.link(b, a, {
							kind: 'typing',
							mutual: false,
							...(f.name ? { name: f.name } : {}),
							definition: this.ctx.nameOf(t) ?? undefined,
							file: f.path,
							start: f.span.start_byte,
							end: f.span.end_byte
						});
			}
		});
	}

	/**
	 * `first a then b`, through the forks, joins, decisions and merges
	 * between them, from the toolkit's graph of each action the items are
	 * steps of; a decision's branches (`if c then a; else b;`) are read from
	 * the text, as the action flow view reads them.
	 */
	successions() {
		const owners = new Set(this.items.map((i) => this.ctx.byId.get(i.id)?.ownerId ?? ''));
		for (const ownerId of owners) {
			const owner = this.ctx.byId.get(ownerId);
			if (!owner?.qualifiedName || !/Action|UseCase|Case/.test(owner.metaclass)) continue;
			const graph = this.ctx.session && toGraph(this.ctx.session, 'action', owner.qualifiedName);
			if (!graph) continue;
			const next = new Map<string, { to: string; id?: string }[]>();
			const add = (from: string, to: string, id?: string) =>
				next.set(from, [...(next.get(from) ?? []), { to, ...(id ? { id } : {}) }]);
			for (const e of graph.edges)
				if (e.kind === 'succession' || e.metaclass === 'SuccessionAsUsage')
					add(e.source, e.target, e.id);
			const nodes = new Set(graph.nodes.map((n) => n.id));
			const siblings = this.ctx.ownedBy(owner.id);
			for (const [i, t] of siblings.entries()) {
				if (t.metaclass !== 'TransitionUsage') continue;
				const branch = /^(?:if\s+.+?\s+then|else)\s+(.+?)\s*$/.exec(t.header.trim());
				const source = siblings.slice(0, i).findLast((s) => nodes.has(s.id));
				const target = branch && this.member(owner, labelName(unquoteName(branch[1]!)));
				if (source && target) add(source.id, target.id, t.id);
			}
			const itemOf = (id: string) => this.items.findIndex((x) => x.id === id);
			for (const [from, item] of this.items.entries()) {
				if (this.ctx.byId.get(item.id)?.ownerId !== ownerId) continue;
				// Breadth first through control nodes, to the next steps.
				const seen = new Set<string>([item.id]);
				const queue = [...(next.get(item.id) ?? [])].map((e) => ({ ...e, via: e.id }));
				while (queue.length) {
					const { to, via } = queue.shift()!;
					if (seen.has(to)) continue;
					seen.add(to);
					const target = itemOf(to);
					if (target >= 0) {
						const record = via ? this.ctx.byId.get(via) : undefined;
						const at = record ?? this.ctx.byId.get(to)!;
						this.link(from, target, {
							kind: 'succession',
							mutual: false,
							file: at.path,
							start: at.span.start_byte,
							end: at.span.end_byte
						});
						continue;
					}
					const node = this.ctx.byId.get(to);
					// Control nodes lead on; another action that isn't listed ends the path.
					if (node && this.accepts(node)) continue;
					for (const e of next.get(to) ?? []) queue.push({ to: e.to, via: via ?? e.id });
				}
			}
		}
	}
}
