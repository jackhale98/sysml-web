/**
 * Saving when the server moved on: a three-way merge of element models.
 *
 * - base: the server's version this project was opened from or last saved to;
 * - mine: this project, as exported;
 * - theirs: the branch's head, with what others saved since.
 *
 * Elements are matched as everywhere else in the exchange (`elements.ts`): base
 * and theirs by the server's ids (then by place, for a tool that renumbers),
 * mine to base by place, and what both added by the same place. Each element
 * then merges property by property: a property only one side changed takes
 * that side's value, the same change on both sides is taken once, and the
 * lists of what an element owns merge their insertions and removals. What
 * is left is a conflict, decided in the review by "Keep mine" or "Keep
 * theirs": a property both changed differently, an element both added
 * differently, or a part of the model one side removed while the other
 * changed something in it (or started using it).
 *
 * The merged model is in mine's ids wherever mine has the element, so the
 * engine can find each element's text (`weave.ts` brings theirs into the
 * files). Pure: no toolkit, no DOM.
 */
import {
	isRef,
	nameOf,
	ownerOf,
	ownershipKeys,
	matchIds,
	withIds,
	type ElementJson
} from './elements';

export type Side = 'mine' | 'theirs';

/** What one side did to one part of the model, for the review. */
export interface MergeChange {
	kind: 'added' | 'changed' | 'removed';
	/** What it is, in words: `part def Trailer`. */
	what: string;
	/** Where: its owner's qualified name for an addition or removal, its own for a change. */
	where: string;
	/** For a change, what about it: `name`, `type`. */
	details: string[];
}

export interface MergeConflict {
	/** The key of this conflict's choice in `resolveMerge`. */
	id: string;
	kind: 'both-changed' | 'both-added' | 'removed-by-them' | 'removed-by-you';
	/** The element, in words (`part car`), and its qualified name. */
	what: string;
	where: string;
	/** What each side did, in plain words. */
	mine: string[];
	theirs: string[];
	/** For a removal: what the other side made refer to it (it refers to nothing once removed). */
	uses?: string[];
}

export interface MergePlan {
	/** Their changes that come into this project. */
	incoming: MergeChange[];
	/** This project's changes that go to the server. */
	outgoing: MergeChange[];
	conflicts: MergeConflict[];
	/** What `resolveMerge` works from. */
	readonly state: MergeState;
}

interface Entity {
	/** The id in the merge: mine's where mine has it. */
	id: string;
	b?: ElementJson;
	o?: ElementJson;
	t?: ElementJson;
}

interface Governed {
	conflict: string;
	/** For a removal: the side that removed it. */
	remover?: Side;
	/** For a property conflict: the properties in conflict. */
	properties?: string[];
}

interface MergeState {
	entities: Map<string, Entity>;
	/** Mine's elements in order (the merged model keeps mine's order, then the rest). */
	order: string[];
	governed: Map<string, Governed>;
}

export interface MergeOptions {
	/** Names of elements outside the three models (the standard library's), for the review. */
	nameOf?: (id: string) => string | undefined;
	freshId?: () => string;
}

/** Properties that only repeat the id. */
const IGNORED = new Set(['@id', 'elementId']);
/** Lists of what an element owns, merged by insertions and removals. */
const OWNED = new Set(['ownedRelationship', 'ownedRelatedElement']);
/** Properties that say where an element is (its owner). */
const OWNING = new Set(['owningRelationship', 'owningRelatedElement']);
const EXPRESSION = /(Expression|^Literal\w*|^MultiplicityRange|^Multiplicity)$/;

/** Plan a merge of `mine` and `theirs`, both descended from `base`. */
export function planMerge(
	base: readonly ElementJson[],
	mine: readonly ElementJson[],
	theirs: readonly ElementJson[],
	options: MergeOptions = {}
): MergePlan {
	// The text implies implied relationships, and the engine works them out again.
	const real = (es: readonly ElementJson[]) => es.filter((e) => e.isImplied !== true);
	const b = real(base);
	const o = real(mine);
	const t = real(theirs);

	// Base and theirs share the server's ids; a tool that renumbers is matched by place.
	const baseById = new Map(b.map((e) => [e['@id'], e]));
	const tToB = new Map<string, string>();
	const bTaken = new Set<string>();
	for (const e of t) {
		const counterpart = baseById.get(e['@id']);
		if (counterpart && counterpart['@type'] === e['@type']) {
			tToB.set(e['@id'], e['@id']);
			bTaken.add(e['@id']);
		}
	}
	if (tToB.size < t.length)
		for (const [their, id] of matchIds(t, b))
			if (!tToB.has(their) && !bTaken.has(id)) {
				tToB.set(their, id);
				bTaken.add(id);
			}
	const oToB = matchIds(o, b);
	const bToT = new Map([...tToB].map(([their, id]) => [id, their]));
	// What both added in the same place is the same element.
	const oToT = new Map<string, string>();
	const ourNew = o.filter((e) => !oToB.has(e['@id']));
	const theirNew = new Set(t.filter((e) => !tToB.has(e['@id'])).map((e) => e['@id']));
	if (ourNew.length && theirNew.size) {
		const ourKeys = ownershipKeys(o);
		const theirKeys = ownershipKeys(t);
		const theirByKey = new Map<string, ElementJson>();
		for (const e of t) if (theirNew.has(e['@id'])) theirByKey.set(theirKeys.get(e['@id'])!, e);
		for (const e of ourNew) {
			const key = ourKeys.get(e['@id']);
			const counterpart = key ? theirByKey.get(key) : undefined;
			if (counterpart && counterpart['@type'] === e['@type'])
				oToT.set(e['@id'], counterpart['@id']);
		}
	}

	// One id per element across the three: mine's, else the server's.
	const taken = new Set<string>();
	const freshId = options.freshId ?? (() => crypto.randomUUID());
	const claim = (id: string) => {
		let out = id;
		while (taken.has(out)) out = freshId();
		taken.add(out);
		return out;
	};
	const oMap = new Map<string, string>();
	const bMap = new Map<string, string>();
	const tMap = new Map<string, string>();
	for (const e of o) {
		const id = claim(e['@id']);
		oMap.set(e['@id'], id);
		const inBase = oToB.get(e['@id']);
		if (inBase) bMap.set(inBase, id);
		const their = inBase ? bToT.get(inBase) : oToT.get(e['@id']);
		if (their) tMap.set(their, id);
	}
	for (const e of b) {
		if (bMap.has(e['@id'])) continue;
		const id = claim(e['@id']);
		bMap.set(e['@id'], id);
		const their = bToT.get(e['@id']);
		if (their) tMap.set(their, id);
	}
	for (const e of t) if (!tMap.has(e['@id'])) tMap.set(e['@id'], claim(e['@id']));

	const entities = new Map<string, Entity>();
	const entity = (id: string) => {
		let found = entities.get(id);
		if (!found) entities.set(id, (found = { id }));
		return found;
	};
	for (const e of o) entity(oMap.get(e['@id'])!).o = withIds(e, oMap);
	for (const e of b) entity(bMap.get(e['@id'])!).b = withIds(e, bMap);
	// Theirs may still refer to what it no longer has: the base's, by the server's ids.
	const theirMap = new Map([...bMap, ...tMap]);
	for (const e of t) entity(tMap.get(e['@id'])!).t = withIds(e, theirMap);
	const state: MergeState = {
		entities,
		order: o.map((e) => oMap.get(e['@id'])!),
		governed: new Map()
	};
	const words = new Words(entities, options.nameOf);

	// Removals: a part of the model one side removed and the other changed or uses.
	const conflicts: MergeConflict[] = [];
	const childrenInBase = new Map<string, string[]>();
	for (const e of entities.values()) {
		const owner = e.b && ownerOf(e.b);
		if (owner) (childrenInBase.get(owner) ?? childrenInBase.set(owner, []).get(owner)!).push(e.id);
	}
	for (const remover of ['mine', 'theirs'] as const) {
		const gone = remover === 'mine' ? 'o' : 't';
		const kept = remover === 'mine' ? 't' : 'o';
		// What the other side changed or added, with the references it added.
		const changes = [...entities.values()]
			.filter((e) => e[kept] && !sameElement(e.b, e[kept]))
			.map((e) => ({ e, refs: addedRefs(e.b, e[kept]!) }));
		for (const root of entities.values()) {
			if (!root.b || root[gone] || !root[kept] || state.governed.has(root.id)) continue;
			const owner = ownerOf(root.b);
			if (owner && !entities.get(owner)?.[gone]) continue;
			const inside = new Set<string>();
			const walk = (id: string) => {
				inside.add(id);
				for (const child of childrenInBase.get(id) ?? []) walk(child);
			};
			walk(root.id);
			// What the other side changed in it, added to it, or now refers to in it.
			const touched: string[] = [];
			const users: string[] = [];
			for (const { e, refs } of changes) {
				if (inside.has(e.id) || (!e.b && within(e.id, kept, inside, entities))) touched.push(e.id);
				else if (refs.some((r) => inside.has(r))) users.push(e.id);
			}
			if (!touched.length && !users.length) continue;
			const id = `removed:${root.id}`;
			for (const e of entities.values())
				if (inside.has(e.id) || (!e.b && within(e.id, kept, inside, entities)))
					state.governed.set(e.id, { conflict: id, remover });
			const subject = words.subjectOf(root.id, 'b');
			const did = [
				...words.describe(touched, kept).map((c) => words.sentence(c, subject.where)),
				...users.map((u) => `uses it in ${words.pathOf(u, kept) || 'the model'}`)
			];
			const uses = unique(users.map((u) => words.pathOf(u, kept))).filter(Boolean);
			conflicts.push({
				id,
				kind: remover === 'mine' ? 'removed-by-you' : 'removed-by-them',
				what: subject.what,
				where: subject.where,
				mine: remover === 'mine' ? ['removed it'] : unique(did),
				theirs: remover === 'theirs' ? ['removed it'] : unique(did),
				...(uses.length ? { uses } : {})
			});
		}
	}

	// Properties both changed differently, gathered per element as people know it.
	const byDeclaration = new Map<string, { kind: MergeConflict['kind']; lines: Entity[] }>();
	for (const e of entities.values()) {
		if (!e.o || !e.t || state.governed.has(e.id)) continue;
		const properties = conflicting(e);
		if (!properties.length) continue;
		const declaration = words.declarationOf(e.id, 'o');
		const id = `changed:${declaration}`;
		state.governed.set(e.id, { conflict: id, properties });
		const group = byDeclaration.get(id) ?? { kind: 'both-changed' as const, lines: [] };
		if (!e.b && declaration === e.id) group.kind = 'both-added';
		group.lines.push(e);
		byDeclaration.set(id, group);
	}
	for (const [id, group] of byDeclaration) {
		const declaration = id.slice('changed:'.length);
		const subject = words.subjectOf(declaration, 'o');
		const mine: string[] = [];
		const theirs: string[] = [];
		for (const e of group.lines)
			for (const property of state.governed.get(e.id)!.properties!) {
				const word = words.detail(e.id, property, declaration, 'o');
				mine.push(`${word}: ${words.value(e.o![property], 'o')}`);
				theirs.push(`${word}: ${words.value(e.t![property], 't')}`);
			}
		conflicts.push({
			id,
			kind: group.kind,
			what: subject.what,
			where: subject.where,
			mine: unique(mine),
			theirs: unique(theirs)
		});
	}

	// What each side changed that the other doesn't have yet, outside the conflicts.
	const free = (e: Entity) => !state.governed.has(e.id);
	const incoming = [...entities.values()]
		.filter((e) => free(e) && !sameElement(e.b, e.t) && !sameElement(e.o, e.t))
		.map((e) => e.id);
	const outgoing = [...entities.values()]
		.filter((e) => free(e) && !sameElement(e.b, e.o) && !sameElement(e.o, e.t))
		.map((e) => e.id);
	return {
		incoming: words.describe(incoming, 't'),
		outgoing: words.describe(outgoing, 'o'),
		conflicts,
		state
	};
}

/**
 * The merged model, with each conflict decided as `choices` says (an
 * undecided one keeps mine). In mine's ids wherever mine has the element.
 */
export function resolveMerge(
	plan: MergePlan,
	choices: Readonly<Record<string, Side>> = {}
): ElementJson[] {
	const { entities, order, governed } = plan.state;
	const choice = (conflict: string): Side => choices[conflict] ?? 'mine';
	const present = new Set<string>();
	for (const e of entities.values()) {
		const rule = governed.get(e.id);
		if (rule?.remover) {
			const keptBy = rule.remover === 'mine' ? e.t : e.o;
			if (choice(rule.conflict) !== rule.remover && keptBy) present.add(e.id);
		} else if (e.b ? e.o && e.t : e.o || e.t) present.add(e.id);
	}

	const merged = new Map<string, ElementJson>();
	const sources = new Map<string, ElementJson[]>();
	for (const id of present) {
		const e = entities.get(id)!;
		const rule = governed.get(id);
		let out: ElementJson;
		if (rule?.remover) out = { ...(rule.remover === 'mine' ? e.t! : e.o!) };
		else if (!e.o || !e.t) out = { ...(e.o ?? e.t)! };
		else {
			const side = rule?.properties ? choice(rule.conflict) : 'mine';
			out = { '@id': id, '@type': e.o['@type'] };
			for (const property of propertiesOf(e)) {
				if (OWNED.has(property)) continue;
				const [bv, ov, tv] = [e.b?.[property], e.o[property], e.t[property]];
				let value: unknown;
				if (same(ov, tv) || same(tv, bv)) value = ov;
				else if (same(ov, bv)) value = tv;
				else value = side === 'mine' ? ov : tv;
				if (value !== undefined) out[property] = value;
			}
		}
		if (typeof out.elementId === 'string') out.elementId = id;
		merged.set(id, out);
		// The kept version leads the order of what it owns.
		const lead = rule?.remover ? (rule.remover === 'mine' ? e.t : e.o) : (e.o ?? e.t);
		sources.set(
			id,
			[lead, e.b, e.o, e.t].filter((v): v is ElementJson => !!v)
		);
	}
	// What each element owns: both sides' insertions and removals, in order,
	// of what is in the merged model and owned there by this element.
	for (const [id, out] of merged) {
		const [lead, ...rest] = sources.get(id)!;
		const e = entities.get(id)!;
		for (const property of OWNED) {
			const versions = [lead!, ...rest];
			if (!versions.some((v) => property in v)) continue;
			let order =
				e.o && e.t && !governed.get(id)?.remover
					? mergeOrder(ids(e.b?.[property]), ids(e.o[property]), ids(e.t[property]))
					: ids(lead![property]);
			for (const v of rest) order = mergeOrder([], order, ids(v[property]));
			out[property] = order
				.filter((child) => {
					const c = merged.get(child);
					return c && ownerOf(c) === id;
				})
				.map((child) => ({ '@id': child }));
		}
	}
	// Mine's order first (the text's), then the rest as the server has it.
	const result: ElementJson[] = [];
	for (const id of order) if (merged.has(id)) result.push(merged.get(id)!);
	const placed = new Set(order);
	for (const [id, e] of merged) if (!placed.has(id)) result.push(e);
	return result;
}

/** Whether a plan changes anything on either side. */
export const isQuiet = (plan: MergePlan): boolean =>
	!plan.incoming.length && !plan.outgoing.length && !plan.conflicts.length;

/** Two versions of an element (or its absence) say the same. */
export function sameElement(a: ElementJson | undefined, b: ElementJson | undefined): boolean {
	if (!a || !b) return a === b;
	for (const property of new Set([...Object.keys(a), ...Object.keys(b)]))
		if (!IGNORED.has(property) && !same(a[property], b[property])) return false;
	return true;
}

function propertiesOf(e: Entity): string[] {
	const out = new Set<string>();
	for (const v of [e.b, e.o, e.t]) if (v) for (const p of Object.keys(v)) out.add(p);
	for (const p of IGNORED) out.delete(p);
	return [...out];
}

/** The properties both sides changed, to different values (owned lists merge instead). */
function conflicting(e: Entity): string[] {
	return propertiesOf(e).filter((p) => {
		if (OWNED.has(p)) return false;
		const [bv, ov, tv] = [e.b?.[p], e.o![p], e.t![p]];
		return !same(ov, tv) && !same(ov, bv) && !same(tv, bv);
	});
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/** JSON with object keys in order; absent and null are the same. */
function stable(value: unknown): string {
	if (value === undefined || value === null) return 'null';
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (typeof value === 'object')
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

const ids = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter(isRef).map((r) => r['@id']) : [];

/**
 * Two orderings merged: the one that reordered what it shares with the base
 * leads (mine when neither did), and what only the other has goes in after
 * the nearest element it follows there.
 */
export function mergeOrder(base: string[], mine: string[], theirs: string[]): string[] {
	const sameOrder = (x: string[], y: string[]) => {
		const inY = new Set(y);
		const inX = new Set(x);
		return x.filter((i) => inY.has(i)).join() === y.filter((i) => inX.has(i)).join();
	};
	const lead = sameOrder(theirs, base) ? mine : theirs;
	const out = [...lead];
	for (const list of lead === mine ? [theirs, base] : [mine, base])
		list.forEach((id, i) => {
			if (out.includes(id)) return;
			for (let j = i - 1; j >= 0; j--) {
				const at = out.indexOf(list[j]!);
				if (at >= 0) return void out.splice(at + 1, 0, id);
			}
			for (let j = i + 1; j < list.length; j++) {
				const at = out.indexOf(list[j]!);
				if (at >= 0) return void out.splice(at, 0, id);
			}
			out.push(id);
		});
	return out;
}

/** References a version makes that the base didn't, other than to what it owns or is owned by. */
function addedRefs(before: ElementJson | undefined, after: ElementJson): string[] {
	const refs = (e: ElementJson | undefined) => {
		const out = new Set<string>();
		if (!e) return out;
		for (const [property, value] of Object.entries(e)) {
			if (IGNORED.has(property) || OWNED.has(property) || OWNING.has(property)) continue;
			for (const v of Array.isArray(value) ? value : [value]) if (isRef(v)) out.add(v['@id']);
		}
		return out;
	};
	const had = refs(before);
	return [...refs(after)].filter((r) => !had.has(r));
}

/** Whether an element of one side sits (through its owners there) in `inside`. */
function within(
	id: string,
	side: 'o' | 't',
	inside: Set<string>,
	entities: Map<string, Entity>
): boolean {
	for (let at: string | null = id, depth = 0; at && depth < 256; depth++) {
		if (inside.has(at)) return true;
		const version: ElementJson | undefined = entities.get(at)?.[side];
		at = version ? ownerOf(version) : null;
	}
	return false;
}

const unique = (lines: string[]) => [...new Set(lines)];

const isRelationship = (e: ElementJson) =>
	'owningRelatedElement' in e || 'source' in e || 'target' in e;
/** A member as people write it: owned through a membership, not part of an expression. */
const isDeclaration = (e: ElementJson) =>
	isRef(e.owningRelationship) && !EXPRESSION.test(e['@type']);

/** Words for kinds of elements and properties. */
const KIND_WORDS: Record<string, string> = {
	Documentation: 'doc',
	Comment: 'comment',
	TextualRepresentation: 'textual representation',
	ReferenceUsage: 'ref',
	Namespace: 'file'
};
const PROPERTY_WORDS: Record<string, string> = {
	declaredName: 'name',
	declaredShortName: 'short name',
	body: 'text',
	isAbstract: 'abstract',
	isComposite: 'composite',
	isConstant: 'constant',
	isDerived: 'derived',
	isEnd: 'end',
	isOrdered: 'ordered',
	isUnique: 'unique',
	isIndividual: 'individual',
	isVariation: 'variation',
	isReference: 'reference',
	portionKind: 'portion',
	'@type': 'kind',
	owningRelationship: 'place',
	owningRelatedElement: 'place'
};
const PART_WORDS: Record<string, string> = {
	FeatureTyping: 'type',
	ConjugatedPortTyping: 'type',
	Subclassification: 'specializes',
	Redefinition: 'redefines',
	Subsetting: 'subsets',
	ReferenceSubsetting: 'refers to',
	CrossSubsetting: 'crosses',
	FeatureValue: 'value',
	NamespaceImport: 'imports',
	MembershipImport: 'imports',
	Documentation: 'doc',
	Comment: 'comment',
	OwningMembership: 'members',
	FeatureMembership: 'members'
};

/** `PartDefinition` → `part def`, `AttributeUsage` → `attribute`. */
export function kindWord(type: string): string {
	if (KIND_WORDS[type]) return KIND_WORDS[type];
	const m = /^(\w+?)(Definition|Usage)$/.exec(type);
	const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	return m ? `${words(m[1]!)}${m[2] === 'Definition' ? ' def' : ''}` : words(type);
}

/** Names and plain words for the elements of the three models. */
class Words {
	constructor(
		private readonly entities: Map<string, Entity>,
		private readonly outside?: (id: string) => string | undefined
	) {}

	private version(id: string, side: 'b' | 'o' | 't'): ElementJson | undefined {
		const e = this.entities.get(id);
		return e?.[side] ?? e?.o ?? e?.t ?? e?.b;
	}

	/** The qualified name of an element (or of the nearest named one it is in). */
	pathOf(id: string, side: 'b' | 'o' | 't'): string {
		const names: string[] = [];
		for (let at: string | null = id, depth = 0; at && depth < 256; depth++) {
			const e = this.version(at, side);
			if (!e) break;
			const name = nameOf(e);
			if (name && !isRelationship(e)) names.unshift(name);
			at = ownerOf(e);
		}
		return names.join('::');
	}

	/**
	 * The element a change belongs to as people see it: the nearest named
	 * member it is in (a membership stands for its member), else the file.
	 */
	declarationOf(id: string, side: 'b' | 'o' | 't'): string {
		let at: string | null = this.memberOf(id, side);
		for (let depth = 0; at && depth < 256; depth++) {
			const e = this.version(at, side);
			if (!e) break;
			if ((isDeclaration(e) && nameOf(e)) || !ownerOf(e)) return at;
			at = ownerOf(e);
		}
		return id;
	}

	/** A membership's member, or the element itself. */
	private memberOf(id: string, side: 'b' | 'o' | 't'): string {
		const e = this.version(id, side);
		const member = e && isRelationship(e) ? ids(e.ownedRelatedElement)[0] : undefined;
		const child = member ? this.version(member, side) : undefined;
		return child && isDeclaration(child) ? member! : id;
	}

	/** An element in words: `part car` and `Garage::car`. */
	subjectOf(id: string, side: 'b' | 'o' | 't'): { what: string; where: string } {
		const e = this.version(this.memberOf(id, side), side);
		if (!e) return { what: 'an element', where: '' };
		const name = nameOf(e);
		const what = ownerOf(e) ? `${kindWord(e['@type'])}${name ? ` ${name}` : ''}` : 'a file';
		return { what, where: this.pathOf(e['@id'], side) };
	}

	/** What a changed property means for the element people know (`type`, `name`, `value`). */
	detail(id: string, property: string, declaration: string, side: 'b' | 'o' | 't'): string {
		if (id === declaration || this.memberOf(id, side) === declaration)
			return PROPERTY_WORDS[property] ?? kindWord(property);
		// The part of the declaration the element is in: its typing, its value…
		let part = id;
		for (let at: string | null = id, depth = 0; at && at !== declaration && depth < 256; depth++) {
			part = at;
			const e = this.version(at, side);
			at = e ? ownerOf(e) : null;
		}
		const type = this.version(part, side)?.['@type'] ?? '';
		return PART_WORDS[type] ?? (EXPRESSION.test(type) ? 'value' : kindWord(type));
	}

	/** A property's value in words: references by name. */
	value(value: unknown, side: 'b' | 'o' | 't'): string {
		if (value === undefined || value === null) return 'none';
		if (isRef(value))
			return (
				this.pathOf(value['@id'], side) ||
				this.outside?.(value['@id']) ||
				(this.entities.has(value['@id']) ? 'an unnamed element' : 'a library element')
			);
		if (Array.isArray(value))
			return value.length ? value.map((v) => this.value(v, side)).join(', ') : 'none';
		if (typeof value === 'boolean') return value ? 'yes' : 'no';
		if (typeof value === 'string')
			return `“${value.length > 60 ? `${value.slice(0, 57)}…` : value}”`;
		return String(value);
	}

	/** Changed elements of one side (against the base), as changes people know. */
	describe(changed: string[], side: 'o' | 't'): MergeChange[] {
		const set = new Set(changed);
		const out = new Map<string, MergeChange>();
		const add = (change: MergeChange) => {
			const key = `${change.kind} ${change.what} ${change.where}`;
			const known = out.get(key);
			if (known) known.details = unique([...known.details, ...change.details]);
			else out.set(key, change);
		};
		for (const id of changed) {
			const e = this.entities.get(id)!;
			const now = e[side];
			const gone = !now;
			const version = gone ? 'b' : side;
			const owner = (x: string) => {
				const v = this.version(x, version);
				return v ? ownerOf(v) : null;
			};
			if (!e.b || gone) {
				// Added or removed: said once, at the outermost element of what came or went.
				const up = owner(id);
				if (up && set.has(up) && (gone ? !this.entities.get(up)![side] : !this.entities.get(up)!.b))
					continue;
				const member = this.memberOf(id, version);
				const v = this.version(member, version)!;
				if (!ownerOf(v)) {
					// A whole file: what it declares.
					for (const relationship of ids(v.ownedRelationship)) {
						const top = this.memberOf(relationship, version);
						if (top === relationship) continue;
						add({
							kind: gone ? 'removed' : 'added',
							what: this.subjectOf(top, version).what,
							where: '',
							details: [gone ? 'with its file' : 'in a new file']
						});
					}
					continue;
				}
				if (isDeclaration(v)) {
					const where = this.pathOf(ownerOf(v)!, version);
					add({ kind: gone ? 'removed' : 'added', ...this.subject(member, version, where) });
					continue;
				}
				// A typing, a value…: a change to what it belongs to.
				const declaration = up ? this.declarationOf(up, version) : id;
				add({
					kind: 'changed',
					...this.subjectOf(declaration, version),
					details: [this.detail(id, '', declaration, version)]
				});
				continue;
			}
			const declaration = this.declarationOf(id, side);
			const properties = propertiesOf(e).filter(
				(p) => !OWNED.has(p) && p !== 'memberElement' && !same(e.b![p], now[p])
			);
			if (!properties.length) continue;
			add({
				kind: 'changed',
				...this.subjectOf(declaration, side),
				details: unique(properties.map((p) => this.detail(id, p, declaration, side)))
			});
		}
		return [...out.values()];
	}

	private subject(id: string, side: 'b' | 'o' | 't', where: string) {
		return { what: this.subjectOf(id, side).what, where, details: [] };
	}

	/** A change as a phrase inside a conflict about `subject`. */
	sentence(change: MergeChange, subject: string): string {
		const where = change.where === subject ? 'it' : change.where;
		if (change.kind === 'changed')
			return `changed ${where === 'it' ? 'its' : `${where}:`} ${change.details.join(', ')}`;
		return `${change.kind} ${change.what}${change.kind === 'added' ? ' in' : ' from'} ${where}`;
	}
}

/** A change as a line of the review: `Added part def Trailer to Garage`. */
export function changeLine(change: MergeChange): string {
	const details = change.details.length ? ` (${change.details.join(', ')})` : '';
	if (change.kind === 'changed')
		return `Changed ${change.what}${change.where ? ` (${change.where})` : ''}: ${change.details.join(', ')}`;
	if (!change.where)
		return `${change.kind === 'added' ? 'Added' : 'Removed'} ${change.what}${details}`;
	return change.kind === 'added'
		? `Added ${change.what} to ${change.where}${details}`
		: `Removed ${change.what} from ${change.where}${details}`;
}

/** What choosing a side of a conflict does, in words. */
export function choiceHint(conflict: MergeConflict, side: Side): string {
	switch (conflict.kind) {
		case 'removed-by-them':
			return side === 'mine'
				? 'Keep it, with your changes'
				: `Remove it${conflict.uses?.length ? `: ${conflict.uses.join(', ')} will refer to something that isn’t there` : ''}`;
		case 'removed-by-you':
			return side === 'mine'
				? `Remove it${conflict.uses?.length ? `: ${conflict.uses.join(', ')} will refer to something that isn’t there` : ''}`
				: 'Keep it, with their changes';
		default:
			return side === 'mine' ? 'Your version' : 'Their version';
	}
}
