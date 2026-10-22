/**
 * The semantic diff: what changed between two versions of the model, at the
 * level of elements and relationships rather than lines. Pure functions
 * over two `ModelSnapshot`s (made by the engine, `toolkit/snapshot.ts`).
 *
 * Matching elements (docs/engine.md, "Comparing versions"):
 * 1. **By id.** The toolkit's ids are derived from qualified names, so an
 *    element keeps its id through any edit that leaves its name and owner
 *    alone (text moved, reformatted, other elements added before it).
 * 2. **Parents first, then by what is left.** For each element of the new
 *    version without a match (outermost first, so renamed owners are
 *    matched before their members), among the unmatched old elements of
 *    the same kind:
 *    - in the same owner with the same name: it only *follows* a renamed or
 *      moved owner (its id changed with its owner's name);
 *    - in the same owner with another name and a similar body: *renamed*;
 *    - in another owner with the same name and a similar body: *moved*;
 *    - in another owner with another name and the same (substantial)
 *      body: moved and renamed.
 * 3. What is still unmatched was removed or added.
 *
 * Unnamed relationships (`satisfy`, `connect`, `flow`, …) are matched by
 * what they say: their kind, their owner and the elements they resolve to
 * (through the element matching), and their text with renamed names
 * replaced.
 */
import type {
	BudgetChange,
	Category,
	ElementChange,
	ElementSide,
	ModelDiff,
	ModelSnapshot,
	PropertyChange,
	RelationChange,
	SnapCheck,
	SnapElement,
	SnapRelation,
	ValueChange,
	VerdictChange
} from './types';

type How = 'same' | 'followed' | 'renamed' | 'moved' | 'renamed+moved';

/** Bodies at least this similar (Dice coefficient over tokens) make a rename. */
const RENAME_SIMILARITY = 0.6;
/** … and a move to another owner, keeping the name. */
const MOVE_SIMILARITY = 0.5;
/** A move that also renames needs (nearly) the same body, and some of it. */
const MOVE_RENAME_SIMILARITY = 0.9;
const MOVE_RENAME_MIN_BODY = 24;

/** Metadata about risk (FMEA lines, hazards) puts a change in the Risk group. */
const RISK_METADATA = /^metadata:(Fmea|Hazard|Risk|Harm|Mitigation)\w*[.#]/;

export const CATEGORY_ORDER: Category[] = [
	'requirements',
	'design',
	'behaviour',
	'verification',
	'risk',
	'other'
];

export interface ElementMatch {
	/** Old id → new id. */
	toCurrent: Map<string, string>;
	/** New id → old id. */
	toBase: Map<string, string>;
	/** How each new element was matched. */
	how: Map<string, How>;
}

/** Match the elements of two versions (see the module comment). */
export function matchElements(base: ModelSnapshot, current: ModelSnapshot): ElementMatch {
	const toCurrent = new Map<string, string>();
	const toBase = new Map<string, string>();
	const how = new Map<string, How>();
	const link = (b: string, c: string, kind: How) => {
		toCurrent.set(b, c);
		toBase.set(c, b);
		how.set(c, kind);
	};
	const baseIds = new Set(base.elements.map((e) => e.id));
	for (const e of current.elements) if (baseIds.has(e.id)) link(e.id, e.id, 'same');

	const pool = new Map<string, SnapElement[]>();
	const poolKey = (e: SnapElement) => `${e.kind}|${e.isDefinition}`;
	for (const e of base.elements)
		if (!toCurrent.has(e.id)) {
			const list = pool.get(poolKey(e)) ?? [];
			list.push(e);
			pool.set(poolKey(e), list);
		}
	if (!pool.size) return { toCurrent, toBase, how };

	const currentById = new Map(current.elements.map((e) => [e.id, e]));
	const depthOf = depthFunction(currentById);
	const order = current.elements
		.filter((e) => !toBase.has(e.id))
		.sort((a, b) => depthOf(a) - depthOf(b));
	const tokens = new Map<string, Map<string, number>>();
	const tokensOf = (e: SnapElement) => {
		let t = tokens.get(e.body);
		if (!t) tokens.set(e.body, (t = tokenCounts(e.body)));
		return t;
	};

	for (const c of order) {
		const candidates = (pool.get(poolKey(c)) ?? []).filter((b) => !toCurrent.has(b.id));
		if (!candidates.length) continue;
		// The new element's owner, as it was in the base (null: at the top, or new itself).
		const owner = c.ownerId ? (toBase.get(c.ownerId) ?? undefined) : null;
		const sameOwner = (b: SnapElement) => owner !== undefined && b.ownerId === owner;
		const scored = candidates.map((b) => ({ b, score: dice(tokensOf(b), tokensOf(c)) }));
		const best = (list: typeof scored) =>
			list.reduce<(typeof scored)[number] | null>(
				(top, x) =>
					!top ||
					x.score > top.score ||
					(x.score === top.score && Math.abs(x.b.line - c.line) < Math.abs(top.b.line - c.line))
						? x
						: top,
				null
			);

		const follower = scored.find((x) => sameOwner(x.b) && x.b.name === c.name);
		if (follower) {
			link(follower.b.id, c.id, 'followed');
			continue;
		}
		const renamed = best(
			scored.filter(
				(x) =>
					sameOwner(x.b) &&
					(x.score >= RENAME_SIMILARITY ||
						// The only element of its kind that went, where the only one came.
						(x.score >= 0.35 &&
							scored.filter((y) => sameOwner(y.b)).length === 1 &&
							order.filter((o) => o.ownerId === c.ownerId && poolKey(o) === poolKey(c)).length ===
								1))
			)
		);
		if (renamed) {
			link(renamed.b.id, c.id, 'renamed');
			continue;
		}
		const moved = best(
			scored.filter((x) => !sameOwner(x.b) && x.b.name === c.name && x.score >= MOVE_SIMILARITY)
		);
		if (moved) {
			link(moved.b.id, c.id, 'moved');
			continue;
		}
		const both = best(
			scored.filter(
				(x) =>
					!sameOwner(x.b) &&
					x.score >= MOVE_RENAME_SIMILARITY &&
					Math.min(x.b.body.length, c.body.length) >= MOVE_RENAME_MIN_BODY
			)
		);
		if (both) link(both.b.id, c.id, 'renamed+moved');
	}
	return { toCurrent, toBase, how };
}

/** What changed from `base` to `current`. */
export function compareSnapshots(base: ModelSnapshot, current: ModelSnapshot): ModelDiff {
	const match = matchElements(base, current);
	const baseById = new Map(base.elements.map((e) => [e.id, e]));
	const currentById = new Map(current.elements.map((e) => [e.id, e]));
	const side = (e: SnapElement, all: Map<string, SnapElement>): ElementSide => ({
		id: e.id,
		label: e.label,
		title: e.title,
		qualifiedName: e.qualifiedName,
		owner: e.ownerId ? (all.get(e.ownerId)?.label ?? null) : null,
		ownerId: e.ownerId,
		path: e.path,
		line: e.line,
		from: e.from,
		to: e.to
	});

	const renames = renamesOf(match, baseById, currentById);
	const changes: ElementChange[] = [];
	// Added and removed elements fold into their outermost added or removed owner.
	const foldedInto = new Map<string, ElementChange>();

	for (const c of current.elements) {
		const baseId = match.toBase.get(c.id);
		if (baseId === undefined) {
			const owner = c.ownerId ? foldedInto.get(`+${c.ownerId}`) : undefined;
			if (owner) {
				owner.members.push(memberLabel(c));
				foldedInto.set(`+${c.id}`, owner);
				continue;
			}
			const change: ElementChange = {
				change: 'added',
				category: c.category,
				kind: c.kind,
				isDefinition: c.isDefinition,
				shortName: c.props.shortName ?? null,
				after: side(c, currentById),
				properties: [],
				members: []
			};
			changes.push(change);
			foldedInto.set(`+${c.id}`, change);
			continue;
		}
		const b = baseById.get(baseId)!;
		const how = match.how.get(c.id)!;
		const properties = propertyChanges(b, c, renames);
		const renamed = how === 'renamed' || how === 'renamed+moved';
		const moved = how === 'moved' || how === 'renamed+moved';
		// Its file changed, and not only because its owner's did.
		const ownerBefore = b.ownerId ? baseById.get(b.ownerId) : undefined;
		const ownerNow = c.ownerId ? currentById.get(c.ownerId) : undefined;
		const ownerFileChanged = !!ownerBefore && !!ownerNow && ownerBefore.path !== ownerNow.path;
		const fileMoved = b.path !== c.path && !ownerFileChanged;
		if (!renamed && !moved && !fileMoved && !properties.length) continue;
		changes.push({
			change: renamed ? 'renamed' : moved || fileMoved ? 'moved' : 'changed',
			category: renamed || moved || fileMoved ? c.category : categoryOf(c, properties),
			kind: c.kind,
			isDefinition: c.isDefinition,
			shortName: c.props.shortName ?? null,
			before: side(b, baseById),
			after: side(c, currentById),
			properties,
			members: []
		});
	}
	for (const b of base.elements) {
		if (match.toCurrent.has(b.id)) continue;
		const owner = b.ownerId ? foldedInto.get(`-${b.ownerId}`) : undefined;
		if (owner) {
			owner.members.push(memberLabel(b));
			foldedInto.set(`-${b.id}`, owner);
			continue;
		}
		const change: ElementChange = {
			change: 'removed',
			category: b.category,
			kind: b.kind,
			isDefinition: b.isDefinition,
			shortName: b.props.shortName ?? null,
			before: side(b, baseById),
			properties: [],
			members: []
		};
		changes.push(change);
		foldedInto.set(`-${b.id}`, change);
	}

	const relations = compareRelations(base, current, match, baseById, currentById, foldedInto);
	return {
		elements: changes.sort(byCategoryThenPlace),
		relations: relations.sort(byCategoryThenPlace),
		verdicts: compareChecks(base.checks, current.checks, match, renames, baseById),
		values: compareValues(base, current, match, changes),
		budgets: compareBudgets(base, current),
		brokenFiles: [...new Set([...base.brokenFiles, ...current.brokenFiles])].sort()
	};
}

function memberLabel(e: SnapElement): string {
	return `${e.kind} ${e.title}`;
}

/** Properties whose values differ, in a fixed order. */
export function propertyChanges(
	b: SnapElement,
	c: SnapElement,
	renames: Map<string, string> = new Map()
): PropertyChange[] {
	const out: PropertyChange[] = [];
	if (b.kind !== c.kind) out.push({ property: 'kind', before: b.kind, after: c.kind });
	const keys = [...new Set([...Object.keys(b.props), ...Object.keys(c.props)])].sort(
		(x, y) => propertyRank(x) - propertyRank(y) || x.localeCompare(y)
	);
	for (const key of keys) {
		const before = b.props[key] ?? null;
		const after = c.props[key] ?? null;
		if (before === after) continue;
		// A reference to a renamed element is the same reference (`motor.mass` → `engine.mass`).
		if (
			before !== null &&
			after !== null &&
			REFERS.has(key) &&
			substituteNames(before, renames) === after
		)
			continue;
		out.push({ property: key, before, after });
	}
	return out;
}

/** Properties that refer to other elements by name. */
const REFERS = new Set(['type', 'value', 'constraint', 'specializes', 'redefines', 'multiplicity']);

const PROPERTY_ORDER = [
	'shortName',
	'type',
	'multiplicity',
	'value',
	'constraint',
	'specializes',
	'redefines',
	'direction',
	'abstract',
	'doc'
];
const propertyRank = (key: string) => {
	const i = PROPERTY_ORDER.indexOf(key);
	return i >= 0 ? i : PROPERTY_ORDER.length;
};

function categoryOf(e: SnapElement, properties: PropertyChange[]): Category {
	if (properties.length && properties.every((p) => RISK_METADATA.test(p.property))) return 'risk';
	return e.category;
}

/** Old name → new name, for every renamed element (and those whose owner was renamed along). */
function renamesOf(
	match: ElementMatch,
	baseById: Map<string, SnapElement>,
	currentById: Map<string, SnapElement>
): Map<string, string> {
	const out = new Map<string, string>();
	for (const [b, c] of match.toCurrent) {
		const from = baseById.get(b)!.name;
		const to = currentById.get(c)!.name;
		if (from !== to) out.set(from, to);
	}
	return out;
}

const TOKEN = /'(?:[^'\\]|\\.)*'|[\p{L}_][\p{L}\p{N}_]*|\S/gu;

/** Replace whole names in written text (`esc to motor` with motor → engine). */
export function substituteNames(text: string, renames: Map<string, string>): string {
	if (!renames.size) return text;
	return text.replace(TOKEN, (token) => renames.get(token) ?? token);
}

function compareRelations(
	base: ModelSnapshot,
	current: ModelSnapshot,
	match: ElementMatch,
	baseById: Map<string, SnapElement>,
	currentById: Map<string, SnapElement>,
	foldedInto: Map<string, ElementChange>
): RelationChange[] {
	const renames = renamesOf(match, baseById, currentById);
	const identity = (r: SnapRelation, ids: (id: string) => string, text: (t: string) => string) =>
		[r.kind, r.ownerId ? ids(r.ownerId) : '', r.refs.map(ids).join(','), text(r.key)].join('|');
	const toCurrent = mapId(match, baseById);
	const before = new Map<string, SnapRelation[]>();
	for (const r of base.relations) {
		const id = identity(r, toCurrent, (t) => substituteNames(t, renames));
		before.set(id, [...(before.get(id) ?? []), r]);
	}
	const out: RelationChange[] = [];
	const ownerLabel = (id: string | null, all: Map<string, SnapElement>) =>
		id ? (all.get(id)?.label ?? null) : null;
	const fold = (r: SnapRelation, sign: '+' | '-') => {
		const owner = r.ownerId ? foldedInto.get(`${sign}${r.ownerId}`) : undefined;
		if (owner) owner.members.push(`${r.kind} ${r.text}`);
		return !!owner;
	};
	for (const r of current.relations) {
		const id = identity(
			r,
			(x) => x,
			(t) => t
		);
		const list = before.get(id);
		if (list?.length) {
			list.shift();
			continue;
		}
		if (fold(r, '+')) continue;
		out.push({
			change: 'added',
			relation: r.kind,
			category: r.category,
			text: r.text,
			owner: ownerLabel(r.ownerId, currentById),
			ownerId: r.ownerId,
			at: { path: r.path, line: r.line, from: r.from, to: r.to },
			refs: r.refs
		});
	}
	for (const list of before.values())
		for (const r of list) {
			if (fold(r, '-')) continue;
			out.push({
				change: 'removed',
				relation: r.kind,
				category: r.category,
				text: r.text,
				owner: ownerLabel(r.ownerId, baseById),
				ownerId: r.ownerId ? (match.toCurrent.get(r.ownerId) ?? null) : null,
				at: { path: r.path, line: r.line, from: r.from, to: r.to },
				refs: r.refs
			});
		}
	return out;
}

/** An old id as the new version knows it: matched, gone (`old:`), or not an element of either. */
function mapId(match: ElementMatch, baseById: Map<string, SnapElement>): (id: string) => string {
	return (id) => match.toCurrent.get(id) ?? (baseById.has(id) ? `old:${id}` : id);
}

function compareChecks(
	base: SnapCheck[],
	current: SnapCheck[],
	match: ElementMatch,
	renames: Map<string, string>,
	baseById: Map<string, SnapElement>
): VerdictChange[] {
	const key = (c: SnapCheck, requirement: string | null, by: string | null) =>
		[c.kind, requirement ?? '', by ?? '', c.requirementId ? '' : c.label].join('|');
	const toCurrent = mapId(match, baseById);
	const before = new Map<string, SnapCheck>();
	for (const c of base)
		before.set(
			key(
				c,
				c.requirementId ? toCurrent(c.requirementId) : null,
				c.by === null ? null : substituteNames(c.by, renames)
			),
			c
		);
	const out: VerdictChange[] = [];
	for (const c of current) {
		const was = before.get(key(c, c.requirementId, c.by)) ?? null;
		const at = { path: c.path, line: c.line, from: c.from, to: c.to };
		const common = {
			label: c.label,
			title: c.title,
			by: c.by,
			subject: c.subject,
			requirementId: c.requirementId,
			after: c.status,
			afterReason: c.reason,
			at
		};
		if (!was) {
			// A new check matters when it fails; a met one shows with its requirement.
			if (c.status === 'violated')
				out.push({
					...common,
					before: null,
					beforeReason: null,
					marginBefore: null,
					marginAfter: null
				});
			continue;
		}
		if (was.status !== c.status)
			out.push({
				...common,
				before: was.status,
				beforeReason: was.reason,
				marginBefore: null,
				marginAfter: null
			});
		else if (was.margin !== c.margin && (was.margin || c.margin))
			out.push({
				...common,
				before: was.status,
				beforeReason: was.reason,
				marginBefore: was.margin,
				marginAfter: c.margin
			});
	}
	// Failures first, then other verdict changes, then margins.
	const rank = (v: VerdictChange) => (v.before === v.after ? 2 : v.after === 'violated' ? 0 : 1);
	return out.sort((a, b) => rank(a) - rank(b));
}

function compareValues(
	base: ModelSnapshot,
	current: ModelSnapshot,
	match: ElementMatch,
	changes: ElementChange[]
): ValueChange[] {
	const edited = new Set(
		changes
			.filter((c) => c.after && c.properties.some((p) => p.property === 'value'))
			.map((c) => c.after!.id)
	);
	const out: ValueChange[] = [];
	for (const e of current.elements) {
		const after = current.values[e.id];
		const baseId = match.toBase.get(e.id);
		const before = baseId ? base.values[baseId] : undefined;
		if (after === undefined || before === undefined || before === after || edited.has(e.id))
			continue;
		out.push({
			id: e.id,
			label: e.label,
			before,
			after,
			at: { path: e.path, line: e.line, from: e.from, to: e.to }
		});
	}
	return out;
}

function compareBudgets(base: ModelSnapshot, current: ModelSnapshot): BudgetChange[] {
	const out: BudgetChange[] = [];
	const was = new Map(base.budgets.map((b) => [b.view, b]));
	for (const b of current.budgets) {
		const old = was.get(b.view);
		was.delete(b.view);
		if (old?.total !== b.total)
			out.push({
				view: b.view,
				title: b.title,
				root: b.root,
				before: old?.total ?? null,
				after: b.total
			});
	}
	for (const old of was.values())
		out.push({ view: old.view, title: old.title, root: old.root, before: old.total, after: null });
	return out;
}

function byCategoryThenPlace(
	a: {
		category: Category;
		after?: { path: string; line: number };
		before?: { path: string; line: number };
		at?: { path: string; line: number };
	},
	b: typeof a
): number {
	const place = (x: typeof a) => x.after ?? x.at ?? x.before ?? { path: '', line: 0 };
	const pa = place(a);
	const pb = place(b);
	return (
		CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
		pa.path.localeCompare(pb.path) ||
		pa.line - pb.line
	);
}

function depthFunction(byId: Map<string, SnapElement>): (e: SnapElement) => number {
	const cache = new Map<string, number>();
	const depth = (e: SnapElement): number => {
		const known = cache.get(e.id);
		if (known !== undefined) return known;
		cache.set(e.id, 0); // guards against a cycle
		const owner = e.ownerId ? byId.get(e.ownerId) : undefined;
		const d = owner ? depth(owner) + 1 : 0;
		cache.set(e.id, d);
		return d;
	};
	return depth;
}

function tokenCounts(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const t of text.match(TOKEN) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
	return counts;
}

/** Dice coefficient of two token multisets: 1 when equal, 0 when nothing is shared. */
function dice(a: Map<string, number>, b: Map<string, number>): number {
	let total = 0;
	let common = 0;
	for (const n of a.values()) total += n;
	for (const n of b.values()) total += n;
	if (!total) return 1;
	for (const [t, n] of a) common += Math.min(n, b.get(t) ?? 0);
	return (2 * common) / total;
}
