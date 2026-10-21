/**
 * Row providers: what a `@TableRendering`'s `rows` names, read from the
 * toolkit's model. Each row is an ordered set of fields plus the elements it
 * belongs to (for `expose`), the element behind it and where it is written.
 *
 * Rows come from the project's files only; the bundled libraries and
 * everything else in the session are resolution context.
 */
import type { ElementRecord } from '../model';
import { connectionEnds, multiplicityOf } from '../model';
import type { Annotation, Link, ViewContext } from './context';
import {
	collapseWhitespace,
	displayValue,
	simpleName,
	splitPath,
	unquote,
	unquoteName
} from './text';

export interface Row {
	fields: Map<string, string>;
	/** Elements the row belongs to: it is exposed when one of them is. */
	anchors: string[];
	/** For a composition row: the elements walked from the root to it (it is exposed by path). */
	chain?: string[];
	/** Qualified name of the element behind the row ('' when it has none). */
	element: string;
	/** The type of the row's element, for finding which features a column edits. */
	typeId?: string | null;
}

const row = (fields: [string, string][], anchors: string[], element = ''): Row => ({
	fields: new Map(fields),
	anchors,
	element
});

/** The type a usage is declared with (`: T`; for `~T`, T). */
const typeOf = (r: ElementRecord) => r.typeIds[0] ?? null;
const line = (r: ElementRecord) => String(r.span.start_row);
const nameOf = (r: ElementRecord | undefined) => r?.name ?? '';
const writtenOf = (r: ElementRecord | undefined) => r?.written ?? r?.name ?? '';
const docOf = (r: ElementRecord | undefined) =>
	r?.docs.length ? collapseWhitespace(r.docs.join(' ')) : '';

export function provideRows(ctx: ViewContext, spec: string, warnings: string[]): Row[] {
	if (spec.startsWith('@')) return metadataRows(ctx, spec.slice(1).trim());
	if (spec.startsWith('type:')) return typedRows(ctx, spec.slice(5).trim());
	if (spec.startsWith('kind:')) return kindRows(ctx, spec.slice(5).trim());
	if (spec.startsWith('relation:')) return relationRows(ctx, spec.slice(9).trim());
	if (spec.startsWith('composition:')) return compositionRows(ctx, spec.slice(12).trim());
	switch (spec) {
		case 'composition':
			return compositionRows(ctx, null);
		case 'requirements':
			return requirementRows(ctx);
		case 'trace':
			return traceRows(ctx);
		case 'kindcounts':
			return kindCountRows(ctx);
		case 'uncertainty':
			warnings.push(
				'uncertainty analyses are not evaluated by this engine yet; the table is empty'
			);
			return [];
		default:
			throw new Error(
				`unknown row provider \`${spec}\` (expected @Metadata, type:, kind:, relation:, composition, requirements, trace, kindcounts, or uncertainty)`
			);
	}
}

/** The project's elements, in file and declaration order. */
function contentRecords(ctx: ViewContext): ElementRecord[] {
	return ctx.records.filter((r) => ctx.isContent(r));
}

// --- @Metadata -------------------------------------------------------------------

/** One row per annotation of a metadata type, belonging to the annotated element. */
function metadataRows(ctx: ViewContext, meta: string): Row[] {
	const wanted = unquoteName(simpleName(meta));
	const rows: Row[] = [];
	for (const a of ctx.annotations) {
		if (!ctx.content.has(a.path) || unquoteName(simpleName(a.metadata_type)) !== wanted) continue;
		const target = a.target_id ? ctx.byId.get(a.target_id) : undefined;
		const r = row(
			[
				['element', aboutAsWritten(a) ?? a.target],
				['file', a.path],
				['line', String(a.span.start_row)]
			],
			[a.target_id, a.record?.id, a.record?.ownerId].filter((x): x is string => !!x),
			target?.qualifiedName ?? ''
		);
		for (const [k, v] of a.values) r.fields.set(k, unquote(v));
		rows.push(r);
	}
	return rows;
}

/** `@Fmea about drone::battery { … }` → `drone::battery`, as written. */
function aboutAsWritten(a: Annotation): string | null {
	const header = a.record?.header ?? '';
	const about = /\babout\s+([\s\S]+)$/.exec(header);
	return about ? about[1]!.trim() : null;
}

// --- type:T ----------------------------------------------------------------------

/** Usages typed by a definition or any of its specializations. */
function typedRows(ctx: ViewContext, type: string): Row[] {
	const target = ctx.definitionNamed(type);
	const simple = unquoteName(simpleName(type));
	const rows: Row[] = [];
	for (const u of contentRecords(ctx)) {
		const typeId = typeOf(u);
		if (u.isDefinition || !u.name || !typeId) continue;
		const typed = target
			? ctx.conforms(typeId, target)
			: unquoteName(simpleName(u.type ?? '')) === simple;
		if (!typed) continue;
		const r = row(
			[
				['element', writtenOf(u)],
				['type', ctx.nameOf(typeId) ?? unquoteName(simpleName(u.type ?? ''))],
				['kind', u.kind],
				['parent', u.parentId ? writtenOf(ctx.byId.get(u.parentId)) : ''],
				['file', u.path],
				['line', line(u)]
			],
			[u.id],
			u.qualifiedName ?? ''
		);
		r.typeId = typeId;
		for (const c of ctx.ownedBy(u.id))
			if (c.name && c.value !== null && !c.isDefinition) r.fields.set(c.name, unquote(c.value));
		rows.push(r);
	}
	return rows;
}

// --- kind:K ----------------------------------------------------------------------

/**
 * Usages of one kind (`kind:port`): owner, type and direction, and what each
 * is connected to. The ends of an interface definition are its ends, not
 * ports of a part, and are left out.
 */
function kindRows(ctx: ViewContext, kind: string): Row[] {
	const rows: Row[] = [];
	const connected = kind === 'port' ? connectionsByPort(ctx) : new Map<string, Reach>();
	for (const u of contentRecords(ctx)) {
		if (u.isDefinition || u.kind !== kind || !u.name || u.end) continue;
		const owner = u.parentId ? ctx.byId.get(u.parentId) : undefined;
		const type = u.type ? (u.conjugated ? `~${u.type}` : u.type) : '';
		const reach = connected.get(u.id);
		const r = row(
			[
				['element', u.name],
				['owner', nameOf(owner)],
				['parent', writtenOf(owner)],
				['type', type],
				['direction', directionOf(ctx, u)],
				['conjugated', u.conjugated ? '1' : '0'],
				['connectedTo', reach?.ends.join(', ') ?? ''],
				['via', reach?.vias.join(', ') ?? ''],
				['doc', docOf(u)],
				['file', u.path],
				['line', line(u)]
			],
			[u.id],
			u.qualifiedName ?? ''
		);
		r.typeId = typeOf(u);
		rows.push(r);
	}
	return rows;
}

/** Declared direction, else the one the usage's type implies (flipped when conjugated). */
function directionOf(ctx: ViewContext, u: ElementRecord): string {
	if (u.direction) return u.direction;
	const typeId = typeOf(u);
	if (!typeId) return '';
	let hasIn = false;
	let hasOut = false;
	for (const type of [typeId, ...ctx.supers(typeId)]) {
		for (const f of ctx.ownedBy(type)) {
			if (f.isDefinition) continue;
			if (f.direction === 'in') hasIn = true;
			else if (f.direction === 'out') hasOut = true;
			else if (f.direction === 'inout') hasIn = hasOut = true;
		}
	}
	if (u.conjugated) [hasIn, hasOut] = [hasOut, hasIn];
	return hasIn && hasOut ? 'inout' : hasIn ? 'in' : hasOut ? 'out' : '';
}

interface Reach {
	ends: string[];
	vias: string[];
}

/**
 * The far ends (as written) and the names of the connections ending on each
 * port, from the toolkit's resolution of the connection ends: `battery.powerOut`
 * reaches `Battery::powerOut` because `battery` is a `Battery`.
 */
function connectionsByPort(ctx: ViewContext): Map<string, Reach> {
	const out = new Map<string, Reach>();
	const add = (port: string, end: string, via: string) => {
		let reach = out.get(port);
		if (!reach) out.set(port, (reach = { ends: [], vias: [] }));
		if (end && !reach.ends.includes(end)) reach.ends.push(end);
		if (via && !reach.vias.includes(via)) reach.vias.push(via);
	};
	for (const edge of ctx.interconnections()) {
		const connection = ctx.byId.get(edge.id);
		const ends = connection ? connectionEnds(connection.header) : null;
		if (!connection || !ends) continue;
		const via =
			connection.name ?? (connection.type ? unquoteName(simpleName(connection.type)) : '');
		add(edge.source, ends[1], via);
		add(edge.target, ends[0], via);
	}
	return out;
}

// --- relation:… -----------------------------------------------------------------

function relationRows(ctx: ViewContext, relation: string): Row[] {
	const colon = relation.indexOf(':');
	const base = (colon < 0 ? relation : relation.slice(0, colon)).trim();
	const typeFilter = colon < 0 ? null : relation.slice(colon + 1).trim();
	if (typeFilter !== null && base !== 'connection' && base !== 'succession')
		throw new Error(
			`relation \`${base}\` takes no type filter (only \`connection:<Type>\` and \`succession:<Type>\` do)`
		);
	const typed = typeFilter === null ? null : typeMatcher(ctx, typeFilter);
	switch (base) {
		case 'allocation':
			return allocationRows(ctx);
		case 'satisfy':
			return traceLinkRows(ctx, ctx.satisfactions);
		case 'verify':
			return traceLinkRows(ctx, ctx.verifications);
		case 'connection':
			return connectionRows(ctx, typed);
		case 'succession':
			return successionRows(ctx, typed);
		default:
			throw new Error(
				`unknown relation \`${base}\` (allocation, satisfy, verify, connection, succession)`
			);
	}
}

function typeMatcher(ctx: ViewContext, type: string): (r: ElementRecord) => boolean {
	const target = ctx.definitionNamed(type);
	const simple = unquoteName(simpleName(type));
	return (r) => {
		const typeId = typeOf(r);
		return (
			!!typeId &&
			(target ? ctx.conforms(typeId, target) : unquoteName(simpleName(r.type ?? '')) === simple)
		);
	};
}

function allocationRows(ctx: ViewContext): Row[] {
	const rows: Row[] = [];
	for (const a of contentRecords(ctx)) {
		if (a.metaclass !== 'AllocationUsage') continue;
		const ends = /\ballocate\s+([\s\S]+?)\s+to\s+([\s\S]+)$/.exec(a.header);
		if (!ends) continue;
		const squash = (s: string) => s.replace(/\s+/g, '');
		rows.push(
			row(
				[
					['source', squash(ends[1]!)],
					['target', squash(ends[2]!)],
					['file', a.path],
					['line', line(a)]
				],
				[a.id],
				a.name ? (a.qualifiedName ?? '') : ''
			)
		);
	}
	return rows;
}

/** Satisfy or verify links: the requirement ("ID title") and what satisfies or verifies it. */
function traceLinkRows(ctx: ViewContext, links: Link[]): Row[] {
	return links
		.filter((link) => ctx.content.has(link.path))
		.map((link) => {
			const requirement = link.requirement_id ? ctx.byId.get(link.requirement_id) : undefined;
			const title = requirement?.name ?? splitPath(link.requirement).pop() ?? '';
			const id = requirement?.shortName ?? '';
			return row(
				[
					['requirement', id ? `${id} ${title}` : title],
					['id', id],
					['title', title],
					['target', link.requirement],
					['by', link.by],
					['file', link.path],
					['line', String(link.span.start_row)]
				],
				[link.record?.id, link.requirement_id].filter((x): x is string => !!x),
				requirement?.qualifiedName ?? ''
			);
		});
}

const isConnection = (r: ElementRecord) =>
	r.metaclass === 'ConnectionUsage' || r.metaclass === 'InterfaceUsage';

function connectionRows(ctx: ViewContext, typed: ((r: ElementRecord) => boolean) | null): Row[] {
	const rows: Row[] = [];
	for (const c of contentRecords(ctx)) {
		if (!isConnection(c) || (typed && !typed(c))) continue;
		const ends = connectionEnds(c.header);
		if (!ends) continue;
		rows.push(
			row(
				[
					['connection', c.name ?? ''],
					['type', c.type ? unquoteName(simpleName(c.type)) : ''],
					['source', ends[0]],
					['target', ends[1]],
					['file', c.path],
					['line', line(c)]
				],
				[c.id],
				c.name ? (c.qualifiedName ?? '') : ''
			)
		);
	}
	return rows;
}

/** Successions (`first a then b`, `succession s first a then b`) with their ends as written. */
function successionRows(ctx: ViewContext, typed: ((r: ElementRecord) => boolean) | null): Row[] {
	const rows: Row[] = [];
	for (const s of contentRecords(ctx)) {
		if (s.kind !== 'succession' || (typed && !typed(s))) continue;
		const ends = /\bfirst\s+([\s\S]+?)\s+then\s+([\s\S]+)$/.exec(s.header);
		if (!ends) continue;
		const squash = (t: string) => t.replace(/\s+/g, '');
		rows.push(
			row(
				[
					['succession', s.name ?? ''],
					['type', s.type ? unquoteName(simpleName(s.type)) : ''],
					['source', squash(ends[1]!)],
					['target', squash(ends[2]!)],
					['parent', s.parentId ? writtenOf(ctx.byId.get(s.parentId)) : ''],
					['file', s.path],
					['line', line(s)]
				],
				[s.id],
				s.name ? (s.qualifiedName ?? '') : ''
			)
		);
	}
	return rows;
}

// --- requirements and trace ---------------------------------------------------------

const isRequirementUsage = (r: ElementRecord) =>
	!r.isDefinition && r.kind === 'requirement' && !!r.name;
const isRequirementDef = (r: ElementRecord) => r.metaclass === 'RequirementDefinition' && !!r.name;

/**
 * One row per requirement: every named requirement usage, and every
 * requirement def that is not merely the type (or a supertype of the type)
 * of requirement usages. Trace links match by the toolkit's resolved
 * requirement, and satisfying a usage counts for its definition and that
 * definition's supertypes.
 */
function requirementRows(ctx: ViewContext): Row[] {
	const byOf = (links: Link[]) => {
		const map = new Map<string, string[]>();
		for (const link of links) {
			if (!link.requirement_id || !link.by) continue;
			const list = map.get(link.requirement_id) ?? [];
			if (!list.includes(link.by)) list.push(link.by);
			map.set(link.requirement_id, list);
		}
		return map;
	};
	const satisfiedBy = byOf(ctx.satisfactions);
	const verifiedBy = byOf(ctx.verifications);
	const closure = (map: Map<string, string[]>) => {
		const set = new Set<string>();
		for (const id of map.keys()) {
			set.add(id);
			for (const s of ctx.supers(id)) set.add(s);
		}
		return set;
	};
	const satisfied = closure(satisfiedBy);
	const verified = closure(verifiedBy);
	const classifiers = new Set<string>();
	for (const u of ctx.records) {
		const typeId = typeOf(u);
		if (!isRequirementUsage(u) || !typeId) continue;
		classifiers.add(typeId);
		for (const s of ctx.supers(typeId)) classifiers.add(s);
	}

	const rows: Row[] = [];
	for (const r of contentRecords(ctx)) {
		const usage = isRequirementUsage(r);
		if (!usage && !(isRequirementDef(r) && !classifiers.has(r.id))) continue;
		const sat = satisfiedBy.get(r.id) ?? [];
		const ver = verifiedBy.get(r.id) ?? [];
		const typeId = usage ? typeOf(r) : (r.generalIds[0] ?? null);
		const type = typeId
			? (ctx.nameOf(typeId) ?? '')
			: unquoteName(simpleName((usage ? r.type : r.specializes[0]) ?? ''));
		const meta = (type: string, key: string) => {
			for (const a of ctx.metadataOf(r.id)) {
				if (unquoteName(simpleName(a.metadata_type)) !== type) continue;
				const value = a.values.find(([k]) => k === key);
				if (value) return displayValue(value[1]);
			}
			return '';
		};
		const issues = ctx
			.metadataOf(r.id)
			.filter((a) => unquoteName(simpleName(a.metadata_type)) === 'Issue')
			.flatMap((a) => a.values.filter(([k]) => k === 'text').map(([, v]) => displayValue(v)));
		const out = row(
			[
				['element', r.name!],
				['qualifiedName', r.qualifiedName ?? ''],
				['id', r.shortName ?? ''],
				['title', r.name!],
				['text', docOf(r)],
				['type', type],
				['status', meta('StatusInfo', 'status')],
				['owner', meta('StatusInfo', 'owner')],
				['rationale', meta('Rationale', 'text')],
				['issues', issues.join('; ')],
				['satisfiedBy', sat.join(', ')],
				['verifiedBy', ver.join(', ')],
				['satisfied', sat.length || satisfied.has(r.id) ? '1' : '0'],
				['verified', ver.length || verified.has(r.id) ? '1' : '0'],
				['file', r.path],
				['line', line(r)]
			],
			[r.id],
			r.qualifiedName ?? ''
		);
		out.typeId = typeId;
		// Body values fill fields the metadata left empty (a `rationale` attribute
		// when there is no @Rationale) and add the rest (kind, priority, …).
		for (const c of ctx.ownedBy(r.id)) {
			if (!c.name || c.value === null || c.isDefinition) continue;
			const current = out.fields.get(c.name);
			if (usage ? !current : current === undefined) out.fields.set(c.name, displayValue(c.value));
		}
		rows.push(out);
	}
	// Columns the standard views ask for exist on every row.
	for (const r of rows)
		for (const key of ['kind', 'priority', 'verificationMethod'])
			if (!r.fields.has(key)) r.fields.set(key, '');
	return rows;
}

/** Requirement coverage: requirement rows with the title as `requirement` and yes/no flags. */
function traceRows(ctx: ViewContext): Row[] {
	return requirementRows(ctx).map((r) => {
		const fields = new Map<string, string>([['requirement', r.fields.get('title') ?? '']]);
		for (const [k, v] of r.fields)
			fields.set(k, k === 'satisfied' || k === 'verified' ? (v === '1' ? 'yes' : 'no') : v);
		return { ...r, fields };
	});
}

// --- kindcounts ------------------------------------------------------------------

/**
 * Definitions and named usages counted by kind: definition kinds sorted, then
 * usage kinds sorted. The values set in a metadata annotation are not usages
 * of the model.
 */
function kindCountRows(ctx: ViewContext): Row[] {
	const definitions = new Map<string, number>();
	const usages = new Map<string, number>();
	for (const r of contentRecords(ctx)) {
		if (r.ownerId && ctx.byId.get(r.ownerId)?.metaclass === 'MetadataUsage') continue;
		if (r.isDefinition) {
			const label = r.kind === 'package' ? 'package' : `${r.kind.replace(/_/g, ' ')} def`;
			definitions.set(label, (definitions.get(label) ?? 0) + 1);
		} else if (r.name) usages.set(r.kind, (usages.get(r.kind) ?? 0) + 1);
	}
	const sorted = (m: Map<string, number>) => [...m.keys()].sort();
	const kinds = sorted(definitions);
	for (const k of sorted(usages)) if (!kinds.includes(k)) kinds.push(k);
	return kinds.map((k) =>
		row(
			[
				['kind', k],
				['definitions', String(definitions.get(k) ?? 0)],
				['usages', String(usages.get(k) ?? 0)]
			],
			[]
		)
	);
}

// --- composition (bill of materials) ------------------------------------------------

const isContentUsage = (r: ElementRecord) =>
	!r.isDefinition && (r.kind === 'part' || r.kind === 'item') && !!r.name;

/**
 * The part and item tree under `root` (a definition or a usage), or under
 * every package, part def and item def nothing uses as a type: one row per
 * part or item usage. A usage's children are its own, then its type's (or
 * those of the usage it subsets) and the type's supertypes', less the ones
 * it redefines. Quantity comes from the multiplicity and `extended`
 * multiplies it down the tree; attribute values of the usage, then of its
 * type, become fields (mass, cost, …).
 */
function compositionRows(ctx: ViewContext, root: string | null): Row[] {
	const rows: Row[] = [];
	const walk = (
		node: ElementRecord,
		chain: string[],
		dotted: string,
		depth: number,
		mult: number
	) => {
		if (chain.length > 64) return;
		for (const child of compositionChildren(ctx, node)) {
			if (chain.includes(child.id)) continue;
			const name = child.name!;
			const quantity = quantityOf(child);
			const extended = mult * quantity;
			const path = dotted ? `${dotted}.${name}` : name;
			const typeId = ctx.effectiveType(child);
			const type = typeId ? ctx.byId.get(typeId) : undefined;
			const subsetted = ctx.subsettedUsage(child);
			const r = row(
				[
					['element', name],
					['type', typeId ? (ctx.nameOf(typeId) ?? '') : ''],
					['parent', node.name ?? ''],
					['path', path],
					['depth', String(depth)],
					['quantity', String(quantity)],
					['extended', String(extended)],
					['doc', docOf(child) || docOf(subsetted) || docOf(type)],
					['file', child.path],
					['line', line(child)]
				],
				[child.id],
				child.qualifiedName ?? ''
			);
			r.chain = [...chain, child.id];
			r.typeId = typeId;
			for (const [k, v] of attributeValues(ctx, child, typeId))
				if (!r.fields.has(k)) r.fields.set(k, v);
			rows.push(r);
			walk(child, r.chain, path, depth + 1, extended);
		}
	};
	const start = (node: ElementRecord) => walk(node, [...ctx.ownerChain(node), node.id], '', 0, 1);
	if (root !== null) {
		const simple = splitPath(root).pop() ?? root;
		const found =
			ctx.records.find((r) => r.isDefinition && r.name === simple) ??
			ctx.records.find((r) => isContentUsage(r) && r.name === simple);
		if (found) start(found);
		return rows;
	}
	const used = new Set(ctx.records.flatMap((r) => r.typeIds));
	for (const r of contentRecords(ctx)) {
		const top =
			r.kind === 'package' || r.metaclass === 'PartDefinition' || r.metaclass === 'ItemDefinition';
		if (r.isDefinition && top && r.name && !used.has(r.id)) start(r);
	}
	return rows;
}

/** Part and item usages in a definition or usage: its own, then inherited ones it doesn't redefine. */
function compositionChildren(ctx: ViewContext, node: ElementRecord): ElementRecord[] {
	const out = ctx.membersOf(node.id).filter(isContentUsage);
	const names = new Set(out.map((c) => c.name));
	const replaced = new Set(out.flatMap((c) => (c.rootId ? [c.rootId] : [])));
	const from = node.isDefinition
		? node.generalIds
		: [ctx.subsettedUsage(node)?.id ?? ctx.effectiveType(node)].filter((x): x is string => !!x);
	for (const id of from) {
		const source = ctx.byId.get(id);
		if (!source) continue;
		for (const inherited of compositionChildren(ctx, source)) {
			if (names.has(inherited.name) || replaced.has(inherited.rootId ?? inherited.id)) continue;
			names.add(inherited.name);
			out.push(inherited);
		}
	}
	return out;
}

/** `[4]` → 4; a range → its lower bound; none → 1. */
function quantityOf(usage: ElementRecord): number {
	const text = multiplicityOf(usage.header);
	if (!text) return 1;
	const [lower, upper] = text.split('..').map((s) => s.trim());
	if (upper === undefined) return /^\d+$/.test(lower!) ? Number(lower) : 1;
	return /^\d+$/.test(lower!) ? Number(lower) : 1;
}

/** Attribute values of the usage, then of its type and the type's supertypes (nearest first). */
function attributeValues(
	ctx: ViewContext,
	usage: ElementRecord,
	typeId: string | null
): [string, string][] {
	const out: [string, string][] = [];
	const seen = new Set<string>();
	const take = (owner: string) => {
		for (const a of ctx.ownedBy(owner)) {
			if (a.kind !== 'attribute' || !a.name || a.value === null || seen.has(a.name)) continue;
			seen.add(a.name);
			out.push([a.name, unquote(a.value.trim())]);
		}
	};
	take(usage.id);
	if (typeId) for (const t of [typeId, ...ctx.supers(typeId)]) take(t);
	return out;
}
