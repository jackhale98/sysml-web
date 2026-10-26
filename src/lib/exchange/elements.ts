/**
 * SysML v2 element JSON (KerML 10.4; the Systems Modeling API's element
 * payloads): reading a file of it, checking its references, and matching two
 * versions of a model by where their elements sit rather than by their ids.
 *
 * Ids depend on how a tool names things (the toolkit derives a user model's
 * ids from its file names; another tool may use random UUIDs), so the same
 * model read by two tools rarely has the same ids. What survives is the
 * ownership tree: a named element sits under its owner by name, an unnamed
 * one by its kind and position. `ownershipKeys` spells that position out;
 * `compareModels` and `rebaseIds` work from it. Pure: no toolkit, no DOM.
 */

export interface Ref {
	'@id': string;
}

/** One element: `@id`, `@type` and its properties. */
export interface ElementJson {
	'@id': string;
	'@type': string;
	[property: string]: unknown;
}

/** Something about a file of elements that is not what the standard asks for. */
export class InterchangeError extends Error {
	override name = 'InterchangeError';
}

export const isRef = (value: unknown): value is Ref =>
	!!value &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	typeof (value as Ref)['@id'] === 'string' &&
	Object.keys(value).length === 1;

/**
 * The elements of a SysML v2 JSON file: a flat array of elements (KerML
 * 10.4.6), or what an API server answers with (elements, or data versions
 * carrying them as `payload`). Throws an `InterchangeError` saying plainly
 * what is wrong.
 */
export function readElements(text: string): ElementJson[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new InterchangeError(
			`This isn’t a JSON file (${error instanceof Error ? error.message : String(error)}).`
		);
	}
	const items = Array.isArray(parsed)
		? parsed
		: parsed &&
			  typeof parsed === 'object' &&
			  Array.isArray((parsed as { elements?: unknown }).elements)
			? (parsed as { elements: unknown[] }).elements
			: parsed && typeof parsed === 'object' && '@type' in parsed
				? [parsed]
				: null;
	if (!items)
		throw new InterchangeError(
			'This JSON file has no model elements: a SysML v2 JSON file is a list of elements, each with an "@id" and an "@type".'
		);
	const elements: ElementJson[] = [];
	items.forEach((item, index) => {
		// A data version (`{payload, identity}`) carries its element as `payload`; a deletion has none.
		const element =
			item && typeof item === 'object' && 'payload' in item && !('@id' in item && '@type' in item)
				? (item as { payload: unknown }).payload
				: item;
		if (element === null) return;
		if (!element || typeof element !== 'object' || Array.isArray(element))
			throw new InterchangeError(`Item ${index + 1} of the list is not an element.`);
		const { '@id': id, '@type': type } = element as Partial<ElementJson>;
		if (typeof id !== 'string' || !id)
			throw new InterchangeError(`Item ${index + 1} of the list has no "@id".`);
		if (typeof type !== 'string' || !type)
			throw new InterchangeError(`Element ${id} has no "@type".`);
		elements.push(element as ElementJson);
	});
	if (!elements.length) throw new InterchangeError('This JSON file has no model elements.');
	return elements;
}

/** Every reference an element makes (`{"@id": …}` values of its properties), with the property. */
export function referencesOf(element: ElementJson): { property: string; id: string }[] {
	const out: { property: string; id: string }[] = [];
	for (const [property, value] of Object.entries(element)) {
		if (property === '@id' || property === '@type') continue;
		if (isRef(value)) out.push({ property, id: value['@id'] });
		else if (Array.isArray(value))
			for (const item of value) if (isRef(item)) out.push({ property, id: item['@id'] });
	}
	return out;
}

export interface StructureReport {
	elements: number;
	/** Ids used by more than one element. */
	duplicates: string[];
	/** References to elements outside the file that `known` accepts (the standard library). */
	outside: number;
	/** References to nothing: neither in the file nor known. */
	dangling: { from: string; property: string; id: string }[];
	/** Values that are neither plain data nor `{"@id"}` references (e.g. `{"@ref": "Name"}`). */
	malformed: { from: string; property: string }[];
}

/**
 * The structural rules every element file must keep: each element has an
 * `@id` and an `@type` (`readElements` enforces those), ids are unique, and
 * every reference resolves within the file or, by `known`, to an element of
 * the standard library.
 */
export function checkStructure(
	elements: readonly ElementJson[],
	known: (id: string) => boolean = () => false
): StructureReport {
	const ids = new Set<string>();
	const duplicates: string[] = [];
	for (const e of elements) {
		if (ids.has(e['@id'])) duplicates.push(e['@id']);
		ids.add(e['@id']);
	}
	let outside = 0;
	const dangling: StructureReport['dangling'] = [];
	const malformed: StructureReport['malformed'] = [];
	for (const e of elements) {
		for (const { property, id } of referencesOf(e)) {
			if (ids.has(id)) continue;
			if (known(id)) outside++;
			else dangling.push({ from: e['@id'], property, id });
		}
		for (const [property, value] of Object.entries(e)) {
			const values = Array.isArray(value) ? value : [value];
			if (values.some((v) => v && typeof v === 'object' && !isRef(v)))
				malformed.push({ from: e['@id'], property });
		}
	}
	return { elements: elements.length, duplicates, outside, dangling, malformed };
}

const refId = (value: unknown): string | null => (isRef(value) ? value['@id'] : null);
const refIds = (value: unknown): string[] =>
	Array.isArray(value) ? value.map(refId).filter((id): id is string => !!id) : [];

/** The element that owns `e` (through its owning relationship), or the relationship's owner. */
export function ownerOf(e: ElementJson): string | null {
	return refId(e.owningRelationship) ?? refId(e.owningRelatedElement);
}

/** The name an element is known by in its owner: declared name, else short name. */
export function nameOf(e: ElementJson | undefined): string | null {
	if (!e) return null;
	const name = e.declaredName ?? e.name ?? e.declaredShortName ?? e.shortName;
	return typeof name === 'string' && name ? name : null;
}

/**
 * Where each element sits in its ownership tree, as a string that is the same
 * for the same element in two tools' files: a root namespace by the names it
 * holds, a membership by the name of what it owns, an element under its
 * membership, and anything unnamed by its kind and position among its owner's
 * unnamed parts of that kind. Elements whose owner is missing get no key.
 *
 * With `transparentRoots`, the root namespaces and their memberships don't
 * count: what they hold is keyed as top-level (`/Package:A`), as is an
 * element whose owner is missing. So a
 * package has the same key whichever file (root namespace) holds it, and in
 * a file or server that leaves the root namespaces out (SysON's API does).
 * A named member's membership is then keyed `Membership:name`, whatever its
 * kind.
 */
export function ownershipKeys(
	elements: readonly ElementJson[],
	options: { transparentRoots?: boolean } = {}
): Map<string, string> {
	const byId = new Map(elements.map((e) => [e['@id'], e]));
	const keys = new Map<string, string>();
	const taken = new Set<string>();
	const unique = (key: string) => {
		let candidate = key;
		for (let n = 2; taken.has(candidate); n++) candidate = `${key}~${n}`;
		taken.add(candidate);
		return candidate;
	};

	// Root namespaces (no owner): by the names of what they hold.
	const memberName = (relationship: ElementJson | undefined) =>
		relationship ? nameOf(byId.get(refIds(relationship.ownedRelatedElement)[0] ?? '')) : null;
	for (const e of elements) {
		if (ownerOf(e)) continue;
		const names = refIds(e.ownedRelationship)
			.map((id) => memberName(byId.get(id)) ?? '?')
			.join(',');
		keys.set(e['@id'], unique(`${e['@type']}[${names}]`));
	}

	const place = (
		child: ElementJson,
		named: string | null,
		ownerKey: string,
		counts: Map<string, number>
	) => {
		const kind = child['@type'];
		let part: string;
		// Across tools, a named member's membership kind may differ (`end` as a flag or as the kind).
		if (named !== null)
			part = `${options.transparentRoots && kind.endsWith('Membership') ? 'Membership' : kind}:${named}`;
		else {
			const n = (counts.get(kind) ?? 0) + 1;
			counts.set(kind, n);
			part = `${kind}#${n}`;
		}
		const key = unique(`${ownerKey}/${part}`);
		keys.set(child['@id'], key);
		visit(child, key);
	};
	const visit = (owner: ElementJson, ownerKey: string, shared?: Map<string, number>) => {
		// Relationships the owner owns, then elements a relationship owns.
		const counts = shared ?? new Map<string, number>();
		for (const id of refIds(owner.ownedRelationship)) {
			const child = byId.get(id);
			if (child && !keys.has(id)) place(child, memberName(child), ownerKey, counts);
		}
		for (const id of refIds(owner.ownedRelatedElement)) {
			const child = byId.get(id);
			if (child && !keys.has(id)) place(child, nameOf(child), ownerKey, counts);
		}
	};
	if (!options.transparentRoots) {
		for (const e of elements) if (!ownerOf(e)) visit(e, keys.get(e['@id'])!);
		return keys;
	}
	// A top-level membership is keyed on its own; what it holds as if it had none.
	const top = new Map<string, number>();
	const topMembership = (membership: ElementJson) => {
		const key = unique(`/${membership['@type']}:${memberName(membership) ?? '?'}`);
		keys.set(membership['@id'], key);
		for (const id of refIds(membership.ownedRelatedElement)) {
			const child = byId.get(id);
			if (child && !keys.has(id)) place(child, nameOf(child), '', top);
		}
		visit({ ...membership, ownedRelatedElement: [] }, key);
	};
	for (const e of elements) {
		if (ownerOf(e)) continue;
		for (const id of refIds(e.ownedRelationship)) {
			const child = byId.get(id);
			if (child && !keys.has(id)) topMembership(child);
		}
	}
	// What a file left its owner out of: top-level too.
	for (const e of elements) {
		const owner = ownerOf(e);
		if (!owner || byId.has(owner) || keys.has(e['@id'])) continue;
		if (isRef(e.owningRelatedElement)) topMembership(e);
		else place(e, nameOf(e), '', top);
	}
	return keys;
}

/** Properties that only repeat the id, or are derived from the rest. */
const IGNORED = new Set(['@id', 'elementId', 'identifier']);

/** An element with its references written as ownership keys, for comparing across tools. */
function normalized(
	e: ElementJson,
	keyOf: (id: string) => string,
	only?: ReadonlySet<string>
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const property of Object.keys(e).sort()) {
		if (IGNORED.has(property) || (only && !only.has(property))) continue;
		const value = e[property];
		out[property] = isRef(value)
			? { ref: keyOf(value['@id']) }
			: Array.isArray(value)
				? value.map((v) => (isRef(v) ? { ref: keyOf(v['@id']) } : v))
				: value;
	}
	return out;
}

export interface ModelDifference {
	/** Elements only in the first model, by ownership key and type. */
	onlyInFirst: { key: string; type: string }[];
	onlyInSecond: { key: string; type: string }[];
	/** Elements in both whose properties differ, with the properties. */
	changed: { key: string; type: string; properties: string[] }[];
}

/** What differs between two models, element by element, matched by ownership keys. */
export function compareModels(
	first: readonly ElementJson[],
	second: readonly ElementJson[]
): ModelDifference {
	const keysA = ownershipKeys(first);
	const keysB = ownershipKeys(second);
	const keyOfA = (id: string) => keysA.get(id) ?? id;
	const keyOfB = (id: string) => keysB.get(id) ?? id;
	const byKeyB = new Map(second.map((e) => [keyOfB(e['@id']), e]));
	const seen = new Set<string>();
	const difference: ModelDifference = { onlyInFirst: [], onlyInSecond: [], changed: [] };
	for (const a of first) {
		const key = keyOfA(a['@id']);
		const b = byKeyB.get(key);
		if (!b || b['@type'] !== a['@type']) {
			difference.onlyInFirst.push({ key, type: a['@type'] });
			continue;
		}
		seen.add(key);
		const na = normalized(a, keyOfA);
		const nb = normalized(b, keyOfB);
		const properties = [...new Set([...Object.keys(na), ...Object.keys(nb)])].filter(
			(p) => JSON.stringify(na[p] ?? null) !== JSON.stringify(nb[p] ?? null)
		);
		if (properties.length) difference.changed.push({ key, type: a['@type'], properties });
	}
	for (const b of second) {
		const key = keyOfB(b['@id']);
		if (!seen.has(key)) difference.onlyInSecond.push({ key, type: b['@type'] });
	}
	return difference;
}

/**
 * Which element of `theirs` each element of `ours` is, by place: the same
 * ownership key and type, then (for what was renamed, or moved within its
 * owner) the same kind and position under an owner that matched, and so on
 * down. Gives `ours` id → `theirs` id for the elements that matched.
 */
export function matchIds(
	ours: readonly ElementJson[],
	theirs: readonly ElementJson[],
	options: { transparentRoots?: boolean } = {}
): Map<string, string> {
	const ourKeys = ownershipKeys(ours, options);
	const theirKeys = ownershipKeys(theirs, options);
	const theirByKey = new Map<string, ElementJson>();
	for (const e of theirs) {
		const key = theirKeys.get(e['@id']);
		if (key) theirByKey.set(key, e);
	}
	const map = new Map<string, string>();
	const used = new Set<string>();
	const pair = (ours: ElementJson, counterpart: ElementJson) => {
		map.set(ours['@id'], counterpart['@id']);
		used.add(counterpart['@id']);
	};
	for (const e of ours) {
		const key = ourKeys.get(e['@id']);
		const counterpart = key ? theirByKey.get(key) : undefined;
		if (counterpart && counterpart['@type'] === e['@type'] && !used.has(counterpart['@id']))
			pair(e, counterpart);
	}
	// Renamed (or moved within its owner): what is left under an owner both
	// have is matched by kind and position, then its contents the same way.
	const theirById = new Map(theirs.map((e) => [e['@id'], e]));
	const ourById = new Map(ours.map((e) => [e['@id'], e]));
	const slot = (e: ElementJson, byId: Map<string, ElementJson>) => {
		const owner = ownerOf(e);
		const parent = owner ? byId.get(owner) : undefined;
		if (!parent) return null;
		const list = e.owningRelationship ? 'ownedRelatedElement' : 'ownedRelationship';
		const siblings = refIds(parent[list])
			.map((id) => byId.get(id))
			.filter((s): s is ElementJson => !!s && s['@type'] === e['@type']);
		return { owner: parent['@id'], list, index: siblings.indexOf(e), siblings };
	};
	for (let grew = true; grew;) {
		grew = false;
		for (const e of ours) {
			if (map.has(e['@id'])) continue;
			const at = slot(e, ourById);
			const theirOwner = at ? map.get(at.owner) : undefined;
			const parent = theirOwner ? theirById.get(theirOwner) : undefined;
			if (!at || !parent) continue;
			const candidates = refIds(parent[at.list])
				.map((id) => theirById.get(id))
				.filter((c): c is ElementJson => !!c && c['@type'] === e['@type']);
			const free = candidates.filter((c) => !used.has(c['@id']));
			const counterpart =
				candidates[at.index] && !used.has(candidates[at.index]!['@id'])
					? candidates[at.index]
					: free.length === 1 && at.siblings.filter((s) => !map.has(s['@id'])).length === 1
						? free[0]
						: undefined;
			if (counterpart) {
				pair(e, counterpart);
				grew = true;
			}
		}
	}
	return map;
}

/** `value` with every reference's id passed through `map` (ids it lacks stay). */
export function swapRefs(value: unknown, map: ReadonlyMap<string, string>): unknown {
	return isRef(value)
		? { '@id': map.get(value['@id']) ?? value['@id'] }
		: Array.isArray(value)
			? value.map((v) => swapRefs(v, map))
			: value;
}

/** An element under new ids: its own and those of what it refers to. */
export function withIds(e: ElementJson, map: ReadonlyMap<string, string>): ElementJson {
	const out: ElementJson = { ...e, '@id': map.get(e['@id']) ?? e['@id'] };
	for (const [property, value] of Object.entries(e)) {
		if (property === '@id' || property === '@type') continue;
		out[property] = swapRefs(value, map);
	}
	if (typeof e.elementId === 'string') out.elementId = out['@id'];
	return out;
}

/**
 * `ours` with the ids of `theirs` wherever an element sits in the same place
 * (`matchIds`), so a change sent to a server that holds `theirs` updates its
 * elements instead of replacing them. Elements of ours that have no
 * counterpart keep their ids, or get a fresh one when theirs already uses
 * that id for another element. `options` as `ownershipKeys` takes them.
 */
export function rebaseIds(
	ours: readonly ElementJson[],
	theirs: readonly ElementJson[],
	freshId: () => string = () => crypto.randomUUID(),
	options: { transparentRoots?: boolean } = {}
): { elements: ElementJson[]; matched: number } {
	const map = matchIds(ours, theirs, options);
	const matched = map.size;
	const used = new Set(map.values());
	const theirIds = new Set(theirs.map((e) => e['@id']));
	for (const e of ours) {
		if (map.has(e['@id'])) continue;
		// Their element with our id sits elsewhere: ours needs an id of its own.
		const id = theirIds.has(e['@id']) && used.has(e['@id']) ? freshId() : e['@id'];
		map.set(e['@id'], id);
		used.add(id);
	}
	return { elements: ours.map((e) => withIds(e, map)), matched };
}

export interface ChangeSet {
	created: ElementJson[];
	updated: ElementJson[];
	/** Ids of elements in the base that are gone. */
	deleted: string[];
}

/**
 * What to send to turn `base` into `next`, by id (rebase `next` onto `base`
 * first). An element counts as updated when a property `next` spells differs
 * from the base's. Properties `next` doesn't spell (a server's derived values)
 * are not compared, and one the base leaves out counts as its default (KerML
 * 10.4 lets a file omit defaults): null, an empty list, false, `public`.
 */
export function changeSet(base: readonly ElementJson[], next: readonly ElementJson[]): ChangeSet {
	const before = new Map(base.map((e) => [e['@id'], e]));
	const changes: ChangeSet = { created: [], updated: [], deleted: [] };
	const kept = new Set<string>();
	for (const e of next) {
		const old = before.get(e['@id']);
		if (!old) {
			changes.created.push(e);
			continue;
		}
		kept.add(e['@id']);
		if (old['@type'] !== e['@type'] || differs(e, old)) changes.updated.push(e);
	}
	for (const e of base) if (!kept.has(e['@id'])) changes.deleted.push(e['@id']);
	return changes;
}

/** Defaults other than null, [] and false. */
const TRUE_BY_DEFAULT = new Set(['isUnique']);

function differs(ours: ElementJson, theirs: ElementJson): boolean {
	return changedProperties(ours, theirs).length > 0;
}

/**
 * The properties `ours` spells with a value other than `theirs`' (a property
 * `theirs` leaves out counts as its default, as `changeSet` says).
 */
export function changedProperties(ours: ElementJson, theirs: ElementJson): string[] {
	const changed: string[] = [];
	for (const [property, value] of Object.entries(ours)) {
		if (IGNORED.has(property)) continue;
		if (!(property in theirs)) {
			const isDefault =
				value === null ||
				value === false ||
				(Array.isArray(value) && value.length === 0) ||
				(property === 'visibility' && value === 'public') ||
				(TRUE_BY_DEFAULT.has(property) && value === true);
			if (!isDefault) changed.push(property);
			continue;
		}
		if (JSON.stringify(value) === JSON.stringify(theirs[property])) continue;
		if (unspelled(property, value, theirs[property])) continue;
		changed.push(property);
	}
	return changed;
}

/** Owned lists: emptied, they are a change (the last member removed). */
const OWNED_LISTS = new Set(['ownedRelationship', 'ownedRelatedElement']);
/** Names a membership derives from its member, which the compact form leaves unset. */
const DERIVED_NAMES = new Set(['memberName', 'memberShortName']);

/**
 * A value ours leaves empty where theirs has one the compact form doesn't
 * spell: references a server derives (a relationship's `source`/`target`,
 * `relatedElement`) or a membership's member names. Not a change: sending
 * it would erase the server's.
 */
function unspelled(property: string, ours: unknown, theirs: unknown): boolean {
	if (DERIVED_NAMES.has(property)) return ours === null && typeof theirs === 'string';
	if (OWNED_LISTS.has(property)) return false;
	const empty = ours === null || (Array.isArray(ours) && ours.length === 0);
	const references =
		isRef(theirs) || (Array.isArray(theirs) && theirs.length > 0 && theirs.every(isRef));
	return empty && references;
}

/** A readable name for an ownership key: `…/Package:Drone/…/PartUsage:motor` → `Drone::motor`. */
export function keyLabel(key: string): string {
	const names = key
		.split('/')
		.slice(1)
		.map((part) => /^([A-Za-z]+):(.*)$/.exec(part))
		.filter((m): m is RegExpExecArray => !!m && !m[1]!.endsWith('Membership'))
		.map((m) => m[2]!);
	return names.length ? names.join('::') : key.split('/').slice(-1)[0]!;
}
