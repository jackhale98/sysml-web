/**
 * For tests: a model's meaning as a set of facts, independent of ids, text
 * layout and file names, so two tools' versions of one model can be compared
 * ("normalized semantics", not text).
 *
 * Works on SysML v2 element JSON (KerML 10.4), compact or full, from any tool:
 * Fairtide's export, the toolkit's session JSON, or a Systems Modeling API
 * server's elements (SysON). Every element gets a key that does not depend on
 * ids: its qualified name when it has a declared name; `(:>>name)` for an
 * unnamed feature that redefines `name`; otherwise its kind and position among
 * the unnamed elements of that kind its owner has. Its facts are then:
 *
 * - its kind (`@type`) and how its owner holds it (membership kind, visibility,
 *   and the `kind` of a state subaction, transition feature or requirement
 *   constraint membership);
 * - its own properties that carry meaning (flags, direction, literal values,
 *   operators, comment bodies), at their default when absent;
 * - each relationship it owns that is not a membership (typing, subclassification,
 *   subsetting, redefinition, conjugation, imports, annotations, dependencies,
 *   feature values, chains...), with its target's key (an element outside the
 *   file is named by `outside`, e.g. the standard library's qualified names).
 *
 * Relationships marked `isImplied` are left out (the text implies them; tools
 * differ in whether they serialize them). Pure: no toolkit, no DOM.
 */
import type { ElementJson } from '#lib/exchange/elements.ts';

export type Digest = Map<string, string[]>;

const ref = (v: unknown): string | null =>
	v &&
	typeof v === 'object' &&
	!Array.isArray(v) &&
	typeof (v as { '@id'?: unknown })['@id'] === 'string'
		? (v as { '@id': string })['@id']
		: null;
const refs = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(ref).filter((r): r is string => !!r) : ref(v) ? [ref(v)!] : [];

/** Properties whose value is meaning (absent = the default given). */
const SCALARS: Record<string, unknown> = {
	declaredShortName: null,
	isAbstract: false,
	isComposite: false,
	isDerived: false,
	isEnd: false,
	isConstant: false,
	isOrdered: false,
	isUnique: true,
	isVariation: false,
	isIndividual: false,
	isPortion: false,
	isSufficient: false,
	direction: null,
	portionKind: null,
	value: null,
	operator: null,
	body: null,
	language: null,
	isNegated: false
};

/** Values a metaclass fixes (some tools spell them, others leave them at the default). */
const FIXED: Record<string, Record<string, unknown>> = {
	FeatureChainExpression: { operator: '.' },
	EnumerationDefinition: { isVariation: true, isAbstract: true }
};

/** The target of a relationship that is not a membership, by its type. */
const TARGETS: Record<string, string[]> = {
	FeatureTyping: ['type'],
	ConjugatedPortTyping: ['conjugatedPortDefinition', 'type'],
	Subclassification: ['superclassifier'],
	Subsetting: ['subsettedFeature'],
	Redefinition: ['redefinedFeature'],
	ReferenceSubsetting: ['referencedFeature'],
	CrossSubsetting: ['crossedFeature'],
	Conjugation: ['originalType'],
	PortConjugation: ['originalPortDefinition', 'originalType'],
	FeatureChaining: ['chainingFeature'],
	FeatureInverting: ['invertingFeature'],
	Disjoining: ['disjoiningType'],
	Differencing: ['differencingType'],
	Unioning: ['unioningType'],
	Intersecting: ['intersectingType'],
	TypeFeaturing: ['featuringType'],
	NamespaceImport: ['importedNamespace'],
	MembershipImport: ['importedMembership'],
	Annotation: ['annotatedElement'],
	Dependency: ['client', 'supplier'],
	Specialization: ['general'],
	// An owning membership in all but name: what it says is its flags (its value is its part).
	FeatureValue: []
};
/** Flags of a relationship that change what it says. */
const RELATIONSHIP_FLAGS = ['isRecursive', 'isImportAll', 'isDefault', 'isInitial'];

const isMembership = (e: ElementJson) => /Membership$/.test(e['@type']);

/**
 * The model's facts by element key. `outside` names an element that is not in
 * `elements` (null when it can't: the fact then says `?unknown`).
 */
export function semanticDigest(
	elements: readonly ElementJson[],
	outside: (id: string) => string | null = () => null
): Digest {
	const live = elements.filter((e) => e.isImplied !== true);
	const byId = new Map(live.map((e) => [e['@id'], e]));
	const ownerOf = (e: ElementJson): string | null =>
		ref(e.owningRelationship) ?? ref(e.owningRelatedElement) ?? null;

	// Children in ownership order: owned relationships, and what they own.
	const ownedOf = (e: ElementJson): ElementJson[] => {
		const ids = [...refs(e.ownedRelationship), ...refs(e.ownedRelatedElement)];
		return ids.map((id) => byId.get(id)).filter((c): c is ElementJson => !!c);
	};

	// Keys: walk down from what has no owner in the file (root namespaces, or the
	// top-level elements of a server that leaves its roots out).
	const key = new Map<string, string>();
	const redefinedName = (e: ElementJson): string | null => {
		for (const r of refs(e.ownedRelationship)) {
			const rel = byId.get(r);
			if (rel?.['@type'] !== 'Redefinition') continue;
			const target = ref(rel.redefinedFeature);
			const t = target ? byId.get(target) : undefined;
			const name = t
				? ((t.declaredName as string | null) ?? redefinedName(t))
				: target
					? outside(target)?.split('::').pop()
					: null;
			if (name) return name;
		}
		return null;
	};
	const assign = (owner: string, members: ElementJson[]) => {
		const unnamed = new Map<string, number>();
		for (const m of members) {
			if (key.has(m['@id'])) continue;
			// A conjugated port definition's name is derived (`~` and its port's name).
			const name =
				m.declaredName ??
				(m['@type'] === 'ConjugatedPortDefinition' ? `~${owner.split('::').pop()}` : null);
			let k: string;
			if (typeof name === 'string' && name) k = owner ? `${owner}::${name}` : name;
			else {
				const redefined =
					!isMembership(m) && /Usage$|^Feature$/.test(m['@type']) ? redefinedName(m) : null;
				// A file's top-level comments are told apart by their text, not their order
				// (tools order files differently).
				const comment =
					!owner && typeof m.body === 'string'
						? `(${m.body.replace(/\W+/g, ' ').trim().slice(0, 40)})`
						: '';
				const label = redefined ? `(:>>${redefined})` : `${m['@type']}${comment}`;
				const n = unnamed.get(label) ?? 0;
				unnamed.set(label, n + 1);
				k = `${owner}/${label}${redefined && n === 0 ? '' : `#${n}`}`;
			}
			key.set(m['@id'], k);
		}
	};
	// Members of an element: through its memberships to what they own; its other relationships keyed as parts.
	const visit = (e: ElementJson, k: string) => {
		const members: ElementJson[] = [];
		const relationships: ElementJson[] = [];
		for (const r of ownedOf(e)) {
			if (isMembership(r) && refs(r.ownedRelatedElement).length) {
				for (const m of refs(r.ownedRelatedElement)) {
					const member = byId.get(m);
					if (member) members.push(member);
				}
			} else relationships.push(r);
		}
		assign(k, members);
		// A relationship's key: its owner's key, its kind and position (it may own elements itself).
		const count = new Map<string, number>();
		for (const r of relationships) {
			if (key.has(r['@id'])) continue;
			const n = count.get(r['@type']) ?? 0;
			count.set(r['@type'], n + 1);
			key.set(r['@id'], `${k}/${r['@type']}#${n}`);
		}
		for (const c of [...members, ...relationships]) visit(c, key.get(c['@id'])!);
		// A membership is named by its member (for imports of one).
		for (const r of ownedOf(e))
			if (isMembership(r) && !key.has(r['@id'])) {
				const member = refs(r.ownedRelatedElement)[0] ?? ref(r.memberElement);
				key.set(r['@id'], `membership(${member ? (key.get(member) ?? member) : '?'})`);
			}
	};
	const roots = live.filter((e) => {
		const owner = ownerOf(e);
		return !owner || !byId.has(owner);
	});
	const topLevel: ElementJson[] = [];
	for (const root of roots) {
		if (root['@type'] === 'Namespace' && !root.declaredName) {
			key.set(root['@id'], '$');
			for (const r of ownedOf(root))
				if (isMembership(r))
					for (const m of refs(r.ownedRelatedElement)) {
						const member = byId.get(m);
						if (member) topLevel.push(member);
					}
		} else if (!isMembership(root)) topLevel.push(root);
		else
			for (const m of refs(root.ownedRelatedElement)) {
				const member = byId.get(m);
				if (member) topLevel.push(member);
			}
	}
	assign('', topLevel);
	for (const t of topLevel) visit(t, key.get(t['@id'])!);
	for (const root of roots)
		if (root['@type'] === 'Namespace') for (const r of ownedOf(root)) visit(r, '$');

	const name = (id: string): string => {
		const e = byId.get(id);
		if (e) {
			if (isMembership(e) && !refs(e.ownedRelatedElement).length) {
				const member = ref(e.memberElement);
				return `alias(${e.memberName ?? ''} for ${member ? name(member) : '?'})`;
			}
			return key.get(id) ?? `?unkeyed ${e['@type']}`;
		}
		return outside(id) ?? '?unknown';
	};

	const digest: Digest = new Map();
	const add = (k: string, fact: string) => {
		const facts = digest.get(k) ?? digest.set(k, []).get(k)!;
		facts.push(fact);
	};
	for (const e of live) {
		const k = key.get(e['@id']);
		if (!k || k === '$') continue;
		const owning = ref(e.owningRelationship);
		const membership = owning ? byId.get(owning) : undefined;
		if (isMembership(e)) {
			// Memberships are said on their members; one that owns nothing is an alias.
			if (!refs(e.ownedRelatedElement).length && e['@type'] === 'Membership') {
				const owner = ref(e.membershipOwningNamespace) ?? ownerOf(e);
				const target = name(ref(e.memberElement) ?? '');
				add(
					owner ? name(owner) : '$',
					e.memberName ? `alias ${String(e.memberName)} for ${target}` : `refers to ${target}`
				);
			}
			continue;
		}
		add(k, `kind ${e['@type']}`);
		// How the root namespace holds a top-level element is not said: some servers leave roots out.
		if (membership && isMembership(membership) && !topLevel.includes(e)) {
			const via = [membership['@type']];
			if (membership.kind) via.push(String(membership.kind));
			const visibility = membership.visibility ?? 'public';
			if (visibility !== 'public') via.push(String(visibility));
			add(k, `in ${via.join(' ')}`);
		}
		for (const [p, fallback] of Object.entries(SCALARS)) {
			let v = p in e ? e[p] : fallback;
			if (v === undefined || (v !== null && typeof v === 'object')) v = fallback;
			if (FIXED[e['@type']] && p in FIXED[e['@type']]!) continue;
			// A variation is abstract by definition.
			if (p === 'isAbstract' && e.isVariation === true) continue;
			// A comment's body without the `*` that starts its continuation lines.
			if (p === 'body' && typeof v === 'string')
				v = v
					.replace(/\n\s*\*(?!\/)/g, '\n')
					.replace(/\s+/g, ' ')
					.trim();
			if (p === 'value' && typeof v === 'number') v = Number(v.toPrecision(12));
			if (JSON.stringify(v) !== JSON.stringify(fallback)) add(k, `${p} ${JSON.stringify(v)}`);
		}
		const targets = targetsOf(e);
		if (targets) {
			const flags = RELATIONSHIP_FLAGS.filter((f) => e[f] === true);
			const visibility =
				e.visibility && e.visibility !== 'public' ? ` ${String(e.visibility)}` : '';
			const flagged = flags.length ? ` [${flags.join(' ')}]` : '';
			add(k, `to ${targets.map(name).join(', ')}${flagged}${visibility}`);
		}
	}
	for (const facts of digest.values()) facts.sort();
	return digest;
}

/** What a relationship that is not a membership points at (null: not such a relationship). */
function targetsOf(e: ElementJson): string[] | null {
	const properties = TARGETS[e['@type']];
	if (!properties) return null;
	if (e['@type'] === 'Dependency') return [...refs(e.client), ...refs(e.supplier)];
	for (const p of properties) {
		const ids = refs(e[p]);
		if (ids.length) return ids;
	}
	return [];
}

export interface DigestDifference {
	onlyInFirst: string[];
	onlyInSecond: string[];
	changed: { key: string; first: string[]; second: string[] }[];
}

/** What differs between two digests: elements one has, and facts that differ. */
export function compareDigests(a: Digest, b: Digest): DigestDifference {
	const onlyInFirst = [...a.keys()].filter((k) => !b.has(k)).sort();
	const onlyInSecond = [...b.keys()].filter((k) => !a.has(k)).sort();
	const changed: DigestDifference['changed'] = [];
	for (const [k, facts] of a) {
		const other = b.get(k);
		if (!other) continue;
		const first = facts.filter((f) => !other.includes(f));
		const second = other.filter((f) => !facts.includes(f));
		if (first.length || second.length) changed.push({ key: k, first, second });
	}
	changed.sort((x, y) => x.key.localeCompare(y.key));
	return { onlyInFirst, onlyInSecond, changed };
}

/** A short count of a difference, for messages: `{ onlyInFirst: 3, onlyInSecond: 0, changed: 2 }`. */
export const differenceSize = (d: DigestDifference) => ({
	onlyInFirst: d.onlyInFirst.length,
	onlyInSecond: d.onlyInSecond.length,
	changed: d.changed.length
});

/** The digest as lines (`key: fact`), for files and diffs. */
export function digestLines(d: Digest): string[] {
	return [...d.keys()].sort().flatMap((k) => d.get(k)!.map((f) => `${k}: ${f}`));
}
