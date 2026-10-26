/**
 * Model exchange on the toolkit: the project as SysML v2 JSON (KerML 10.4,
 * the Systems Modeling API's element payloads) and SysML v2 JSON as project
 * text. The toolkit serializes (`toCompactJson`, `toFullJson`) and lifts JSON
 * to text (`fromInterchangeJson…`, `units()`); this file adds what the app
 * needs around that: the standard library with its standard ids, unresolved
 * references left out, file names, the checks of the imported text and the
 * report of what didn't carry over. See docs/interchange.md.
 */
import {
	checkStructure,
	compareModels,
	isRef,
	keyLabel,
	nameOf,
	ownerOf,
	ownershipKeys,
	readElements,
	referencesOf,
	InterchangeError,
	type ElementJson
} from '#lib/exchange/elements.ts';
import type {
	ImportNote,
	ImportProblem,
	InterchangeExport,
	InterchangeExportOptions,
	InterchangeImport
} from '#lib/exchange/types.ts';
import { topLevelNames } from '#lib/library/declarations.ts';
import type { SourceFile } from '../protocol';
import type { TkFinding, TkLibrary, TkSession, Toolkit } from './api';
import { FORMAT_CONFIG } from './language';

/** Indentation of lifted text (the editor's formatting uses four spaces). */
const INDENT = '4';

/** The project's model as element JSON (`options` as `InterchangeExportOptions` says). */
export function exportModel(
	tk: Toolkit,
	session: TkSession,
	options: InterchangeExportOptions & {
		/** The project's own files (the session may hold view libraries the project lacks). */
		files?: string[];
		broken?: string[];
		librarySources?: string;
		prepared?: TkLibrary;
	}
): InterchangeExport {
	const raw = options.derived
		? session.toFullJson(false)
		: tk.canonicalizeCompact(session.toCompactJson());
	let elements = JSON.parse(raw) as ElementJson[];
	if (!options.derived) {
		for (const e of elements) spellRedefined(e);
		elements = redefineMetadataValues(tk, session, elements);
	}
	if (options.files) elements = ownElements(session, elements, new Set(options.files));

	// A reference that never resolved comes out as `{"@ref": "Name"}`: not
	// standard JSON, and pointing at nothing. Leave it out and say so.
	const leftOut: InterchangeExport['leftOut'] = [];
	const byId = new Map(elements.map((e) => [e['@id'], e]));
	for (const e of elements) {
		for (const [property, value] of Object.entries(e)) {
			if (isSpelling(value)) {
				leftOut.push({ element: namePath(e, byId), reference: value['@ref'] });
				e[property] = null;
			} else if (Array.isArray(value) && value.some(isSpelling)) {
				for (const v of value.filter(isSpelling))
					leftOut.push({ element: namePath(e, byId), reference: v['@ref'] });
				e[property] = value.filter((v) => !isSpelling(v));
			}
		}
	}

	const isLibrary = (id: string) => {
		const h = session.elementById(id);
		if (!h) return false;
		const library = session.isLibraryElement(h);
		h.free();
		return library;
	};
	const own = checkStructure(elements, isLibrary);
	let library: ElementJson[] = [];
	if (options.library) {
		if (!options.librarySources || !options.prepared)
			throw new Error('The standard library’s sources are not loaded.');
		library = standardLibraryElements(tk, options.prepared, options.librarySources);
	}
	const all = library.length ? [...elements, ...library] : elements;
	const structure = library.length ? checkStructure(all, isLibrary) : own;
	return {
		// Indented for reading and diffing, unless the library makes it huge.
		json: JSON.stringify(all, null, library.length ? undefined : 2),
		elements: elements.length,
		libraryElements: library.length,
		libraryReferences: own.outside,
		leftOut,
		broken: options.broken ?? [],
		dangling: structure.dangling.length
	};
}

/** Properties the compact form doesn't have, per type (those found so far). */
const derivedProperties = new WeakMap<Toolkit, Map<string, Set<string>>>();

/**
 * Element JSON from elsewhere (a server's) in the form the export writes: only
 * the properties the compact form has, each spelled (at its default when
 * absent), the redefined ones written out, and no implied relationships (the
 * text implies them). Two versions of a model then compare property by
 * property. Elements of a type the toolkit doesn't know stay as they are.
 */
export function canonicalModel(tk: Toolkit, elements: readonly ElementJson[]): ElementJson[] {
	let derived = derivedProperties.get(tk);
	if (!derived) derivedProperties.set(tk, (derived = new Map()));
	// The toolkit names one property it doesn't take at a time: ask per type, with every
	// property the elements of that type have (it doesn't look at values).
	const seen = new Map<string, Set<string>>();
	for (const e of elements) {
		const properties = seen.get(e['@type']) ?? seen.set(e['@type'], new Set()).get(e['@type'])!;
		for (const p of Object.keys(e)) properties.add(p);
	}
	const unknown = new Set<string>();
	for (const [type, properties] of seen) {
		const dropped = derived.get(type) ?? derived.set(type, new Set()).get(type)!;
		for (let tries = 0; tries <= properties.size; tries++) {
			const stub: Record<string, unknown> = { '@id': 'x', '@type': type };
			for (const p of properties) if (!p.startsWith('@') && !dropped.has(p)) stub[p] = null;
			try {
				tk.canonicalizeCompact(JSON.stringify([stub]));
				break;
			} catch (error) {
				const property = new RegExp(`^${type}\\.(\\w+): not a compact-form property`).exec(
					String(error instanceof Error ? error.message : error)
				)?.[1];
				if (!property || dropped.has(property)) {
					unknown.add(type);
					break;
				}
				dropped.add(property);
			}
		}
	}
	const kept: ElementJson[] = [];
	const others: ElementJson[] = [];
	for (const e of elements) {
		if (e.isImplied === true) continue;
		if (unknown.has(e['@type'])) {
			others.push(e);
			continue;
		}
		const dropped = derived.get(e['@type'])!;
		const out: ElementJson = { '@id': e['@id'], '@type': e['@type'] };
		for (const [property, value] of Object.entries(e))
			if (!dropped.has(property) && !isSpelling(value)) out[property] = value;
		kept.push(out);
	}
	const canonical = JSON.parse(tk.canonicalizeCompact(JSON.stringify(kept))) as ElementJson[];
	for (const e of canonical) spellRedefined(e);
	return [...canonical, ...others];
}

const isSpelling = (value: unknown): value is { '@ref': string } =>
	!!value &&
	typeof value === 'object' &&
	typeof (value as { '@ref'?: unknown })['@ref'] === 'string';

/**
 * Properties a subtype redefines under another name, which KerML 10.4.5 says
 * are written too, with the redefining property's value. The compact form
 * spells them as null (sysml-toolkit 0.10.10); the OMG schema requires them.
 */
const REDEFINED: Record<string, [property: string, from: string][]> = {
	FeatureTyping: [
		['general', 'type'],
		['specific', 'typedFeature']
	],
	ConjugatedPortTyping: [
		['general', 'type'],
		['specific', 'typedFeature'],
		['conjugatedPortDefinition', 'type']
	],
	Subclassification: [
		['general', 'superclassifier'],
		['specific', 'subclassifier']
	],
	Subsetting: [
		['general', 'subsettedFeature'],
		['specific', 'subsettingFeature']
	],
	Redefinition: [
		['subsettedFeature', 'redefinedFeature'],
		['subsettingFeature', 'redefiningFeature'],
		['general', 'redefinedFeature'],
		['specific', 'redefiningFeature']
	],
	ReferenceSubsetting: [
		['subsettedFeature', 'referencedFeature'],
		['subsettingFeature', 'owningRelatedElement'],
		['general', 'referencedFeature'],
		['specific', 'owningRelatedElement']
	],
	CrossSubsetting: [
		['subsettedFeature', 'crossedFeature'],
		['subsettingFeature', 'owningRelatedElement'],
		['general', 'crossedFeature'],
		['specific', 'owningRelatedElement']
	],
	Conjugation: [
		['source', 'conjugatedType'],
		['target', 'originalType']
	]
};

function spellRedefined(e: ElementJson): void {
	for (const [property, from] of REDEFINED[e['@type']] ?? [])
		if (e[property] === null && isRef(e[from])) e[property] = e[from];
	// An owning membership's member (a feature value is one too) is what it owns.
	if (
		e.memberElement === null &&
		Array.isArray(e.ownedRelatedElement) &&
		isRef(e.ownedRelatedElement[0])
	)
		e.memberElement = e.ownedRelatedElement[0];
}

/**
 * A metadata body's `level = 3;` is `:>> level = 3;` (SysML 8.2.2.27): it
 * redefines the metadata definition's `level`. The toolkit's compact JSON
 * (0.10.10) writes it as a new feature named `level` instead, which another
 * tool reads as the metadata's `level` left unset. Each such feature loses its
 * name and gets the Redefinition the text means, as the pilot implementation
 * writes it.
 */
function redefineMetadataValues(
	tk: Toolkit,
	session: TkSession,
	elements: ElementJson[]
): ElementJson[] {
	const byId = new Map(elements.map((e) => [e['@id'], e]));
	const refs = (value: unknown) =>
		(Array.isArray(value) ? value : [value]).filter(isRef).map((r) => byId.get(r['@id']));
	const qualifiedName = (id: string): string | null => {
		const row = JSON.parse(
			session.rows(JSON.stringify([id]), JSON.stringify(['qualifiedName']))
		)[0];
		return typeof row?.qualifiedName === 'string' ? row.qualifiedName : null;
	};
	const added: ElementJson[] = [];
	for (const usage of elements) {
		if (usage['@type'] !== 'MetadataUsage') continue;
		const owned = refs(usage.ownedRelationship);
		const typing = owned.find((r) => r?.['@type'] === 'FeatureTyping');
		const type = typing && isRef(typing.type) ? qualifiedName(typing.type['@id']) : null;
		if (!type) continue;
		for (const membership of owned) {
			if (membership?.['@type'] !== 'FeatureMembership') continue;
			const feature = refs(membership.ownedRelatedElement)[0];
			const name = feature?.declaredName;
			if (!feature || typeof name !== 'string') continue;
			if (refs(feature.ownedRelationship).some((r) => r?.['@type'] === 'Redefinition')) continue;
			const target = session.resolve(`${type}::${name.includes(' ') ? `'${name}'` : name}`);
			if (!target) continue;
			const redefined = { '@id': session.elementId(target) };
			target.free();
			const self = { '@id': feature['@id'] };
			const stub = {
				'@id': derivedId(`${feature['@id']}/redefinition`),
				'@type': 'Redefinition',
				owningRelatedElement: self,
				redefiningFeature: self,
				redefinedFeature: redefined
			};
			const [redefinition] = JSON.parse(
				tk.canonicalizeCompact(JSON.stringify([stub]))
			) as ElementJson[];
			if (!redefinition) continue;
			spellRedefined(redefinition);
			redefinition.elementId = redefinition['@id'];
			feature.declaredName = null;
			feature.ownedRelationship = [
				{ '@id': redefinition['@id'] },
				...((feature.ownedRelationship as unknown[]) ?? [])
			];
			added.push(redefinition);
		}
	}
	return added.length ? [...elements, ...added] : elements;
}

/**
 * The other way (`redefineMetadataValues`), for the app's own work on its JSON
 * (weaving a merge into the text): the metadata values it gave a Redefinition
 * get their name back and lose it, so the text they lift to reads as written
 * (`level = 3;`) and compares with the toolkit's own JSON.
 */
export function metadataValuesAsWritten(
	session: TkSession,
	elements: readonly ElementJson[]
): ElementJson[] {
	const byId = new Map(elements.map((e) => [e['@id'], e]));
	const dropped = new Set<string>();
	const out = elements.map((e) => {
		if (!Array.isArray(e.ownedRelationship) || e.declaredName != null) return e;
		const ownId = derivedId(`${e['@id']}/redefinition`);
		const added = byId.get(ownId);
		if (!added || added['@type'] !== 'Redefinition' || !isRef(added.redefinedFeature)) return e;
		const target = added.redefinedFeature['@id'];
		const name =
			byId.get(target)?.declaredName ??
			JSON.parse(session.rows(JSON.stringify([target]), JSON.stringify(['name'])))[0]?.name;
		if (typeof name !== 'string') return e;
		dropped.add(ownId);
		return {
			...e,
			declaredName: name,
			ownedRelationship: e.ownedRelationship.filter((r) => !(isRef(r) && r['@id'] === ownId))
		};
	});
	return dropped.size ? out.filter((e) => !dropped.has(e['@id'])) : out;
}

/** A stable UUID-shaped id for an element the app adds (FNV-1a over the seed, four ways). */
function derivedId(seed: string): string {
	const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((basis) => {
		let h = basis >>> 0;
		for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
		return h.toString(16).padStart(8, '0');
	});
	const hex = words.join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The elements of the project's own files, and of the view libraries the
 * session adds only when the project uses them. Root namespaces come in the
 * session's unit order, one per unit.
 */
function ownElements(
	session: TkSession,
	elements: ElementJson[],
	files: Set<string>
): ElementJson[] {
	const units = JSON.parse(session.units()) as { name: string }[];
	const roots = elements.filter((e) => !ownerOf(e));
	if (roots.length !== units.length || units.every((u) => files.has(u.name))) return elements;
	const byId = new Map(elements.map((e) => [e['@id'], e]));
	const rootOf = new Map<string, string>();
	const root = (e: ElementJson): string => {
		const known = rootOf.get(e['@id']);
		if (known) return known;
		const owner = ownerOf(e);
		const parent = owner ? byId.get(owner) : undefined;
		const result = parent ? root(parent) : e['@id'];
		rootOf.set(e['@id'], result);
		return result;
	};
	const kept = new Set(roots.filter((_, i) => files.has(units[i]!.name)).map((r) => r['@id']));
	// A view library the project uses comes along (and whatever it uses).
	for (let grew = true; grew;) {
		grew = false;
		for (const e of elements) {
			if (!kept.has(root(e))) continue;
			for (const { id } of referencesOf(e)) {
				const target = byId.get(id);
				if (target && !kept.has(root(target))) {
					kept.add(root(target));
					grew = true;
				}
			}
		}
	}
	return elements.filter((e) => kept.has(root(e)));
}

/** The qualified name of an element, or of the nearest named element it is in. */
function namePath(e: ElementJson, byId: Map<string, ElementJson>): string {
	const names: string[] = [];
	for (let at: ElementJson | undefined = e, depth = 0; at && depth < 64; depth++) {
		const name = nameOf(at);
		if (name && !at['@type'].endsWith('Membership')) names.unshift(name);
		const owner = ownerOf(at);
		at = owner ? byId.get(owner) : undefined;
	}
	return names.join('::') || e['@type'];
}

/**
 * The standard library as element JSON with its standard ids (KerML 9.1: the
 * ids every tool uses for it). The toolkit serializes only user units, so the
 * library's sources are opened as user units, which gives them other ids, and
 * each element is then matched to the prepared library's element in the same
 * place: a top-level package by name, everything else by its position in its
 * owner's `ownedRelationship` / `ownedRelatedElement`. Costs a session over
 * the library (about 1.5 s and 140 MB of WebAssembly memory): run it in a
 * worker of its own.
 */
export function standardLibraryElements(
	tk: Toolkit,
	library: TkLibrary,
	librarySources: string
): ElementJson[] {
	const asUnits = tk.Session.fromSources(librarySources);
	const lookup = tk.Session.fromSourcesWithPreparedLibrary('[]', library);
	try {
		const elements = JSON.parse(tk.canonicalizeCompact(asUnits.toCompactJson())) as ElementJson[];
		const byId = new Map(elements.map((e) => [e['@id'], e]));
		const lists = new Map<string, string[] | null>();
		const listOf = (id: string, property: string) => {
			const key = `${id} ${property}`;
			if (!lists.has(key)) {
				const h = lookup.elementById(id);
				lists.set(
					key,
					h
						? (JSON.parse(lookup.property(h, property)) as { '@id': string }[]).map((r) => r['@id'])
						: null
				);
				h?.free();
			}
			return lists.get(key)!;
		};
		const single = (id: string, property: string): string | null => {
			const h = lookup.elementById(id);
			if (!h) return null;
			const value = JSON.parse(lookup.property(h, property)) as { '@id': string } | null;
			h.free();
			return value?.['@id'] ?? null;
		};
		const standard = new Map<string, string | null>();
		const standardOf = (id: string): string | null => {
			if (standard.has(id)) return standard.get(id)!;
			standard.set(id, null);
			const e = byId.get(id)!;
			const owner = ownerOf(e);
			let result: string | null = null;
			if (!owner) {
				// A root namespace: the owner of its first package's membership.
				const first = (e.ownedRelationship as { '@id': string }[] | undefined)?.[0];
				const membership = first ? standardOf(first['@id']) : null;
				result = membership ? single(membership, 'owningRelatedElement') : null;
			} else {
				const parent = byId.get(owner)!;
				if (!ownerOf(parent)) {
					// The membership of a top-level package: found through the package, by name.
					const pkg = byId.get((e.ownedRelatedElement as { '@id': string }[])[0]!['@id']);
					const name = nameOf(pkg);
					const h = name ? lookup.resolve(spell(tk, name)) : undefined;
					if (h) {
						const membership = JSON.parse(lookup.property(h, 'owningRelationship')) as {
							'@id': string;
						} | null;
						result = membership?.['@id'] ?? null;
						h.free();
					}
				} else {
					const at = standardOf(owner);
					const property = e.owningRelationship ? 'ownedRelatedElement' : 'ownedRelationship';
					const index = (parent[property] as { '@id': string }[]).findIndex((r) => r['@id'] === id);
					result = at ? (listOf(at, property)?.[index] ?? null) : null;
				}
			}
			standard.set(id, result);
			return result;
		};
		const map = new Map<string, string>();
		for (const e of elements) {
			const id = standardOf(e['@id']);
			if (id) map.set(e['@id'], id);
		}
		const swap = (value: unknown): unknown =>
			isRef(value)
				? { '@id': map.get(value['@id']) ?? value['@id'] }
				: Array.isArray(value)
					? value.map(swap)
					: value;
		return elements.map((e) => {
			const out: ElementJson = { ...e, '@id': map.get(e['@id']) ?? e['@id'] };
			for (const [property, value] of Object.entries(e))
				if (property !== '@id' && property !== '@type') out[property] = swap(value);
			out.elementId = out['@id'];
			return out;
		});
	} finally {
		lookup.free();
		asUnits.free();
	}
}

/** A name as reference text (`'+'`, `'part'`). */
function spell(tk: Toolkit, name: string): string {
	try {
		return (JSON.parse(tk.canonicalName(name)) as { spelling: string }).spelling;
	} catch {
		return name;
	}
}

/**
 * SysML v2 JSON as project files: the toolkit lifts the elements to text,
 * references are respelled as short names, the text is named by what it
 * declares and checked, and what the text doesn't carry is reported.
 */
export function importModel(tk: Toolkit, library: TkLibrary, text: string): InterchangeImport {
	const elements = readElements(text);
	refuseSharedIds(elements);
	const notes: ImportNote[] = [];

	// The standard library is built in: its elements are not the project's.
	const lookup = tk.Session.fromSourcesWithPreparedLibrary('[]', library);
	const libraryIds = new Set<string>();
	try {
		for (const e of elements) {
			const h = lookup.elementById(e['@id']);
			if (h) {
				if (lookup.isLibraryElement(h)) libraryIds.add(e['@id']);
				h.free();
			}
		}
	} finally {
		lookup.free();
	}
	let own = elements.filter(
		(e) =>
			!libraryIds.has(e['@id']) &&
			// A root namespace holding only library packages goes with them.
			!(
				!ownerOf(e) &&
				Array.isArray(e.ownedRelationship) &&
				e.ownedRelationship.length > 0 &&
				e.ownedRelationship.every((r) => isRef(r) && libraryIds.has(r['@id']))
			)
	);
	const libraryCount = elements.length - own.length;
	if (libraryCount)
		notes.push({
			kind: 'library',
			message: `${count(libraryCount, 'standard library element')} left out: the standard library is built in.`
		});
	if (!own.length)
		throw new InterchangeError(
			'This file holds only the standard library: there is no model in it to open.'
		);
	const implied = impliedIds(own).size;
	if (implied)
		notes.push({
			kind: 'implied',
			message: `${count(implied, 'implied relationship')} not written out: the text implies ${implied === 1 ? 'it' : 'them'}, and the engine works ${implied === 1 ? 'it' : 'them'} out again.`
		});

	// What other tools write that the lift can't take as it is (SysON's element JSON).
	const prepared = prepareForLift(own);
	notes.push(...prepared.notes);
	own = prepared.elements;

	let lifted: TkSession;
	try {
		lifted = tk.Session.fromInterchangeJsonWithPreparedLibrary(
			JSON.stringify(own),
			library,
			INDENT
		);
	} catch (error) {
		throw new InterchangeError(
			`The engine could not read these elements: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	let liftedElements: ElementJson[];
	let units: { name: string; text: string }[];
	try {
		liftedElements = JSON.parse(lifted.toCompactJson()) as ElementJson[];
		const byId = new Map(own.map((e) => [e['@id'], e]));
		// The toolkit's warnings: types it doesn't know go with what was left out; that
		// ids weren't kept says nothing new (text has no ids).
		const unknown = new Set<string>();
		for (const warning of JSON.parse(lifted.warnings()) as string[]) {
			const type = /^unsupported owned element @type (\w+)/.exec(warning)?.[1];
			if (type) unknown.add(type);
			else if (!/no structural counterpart|ids are not preserved/.test(warning))
				notes.push({ kind: 'warning', message: plainWarning(warning) });
		}
		const { lost, changed } = carriedOver(tk, own, lifted, liftedElements);
		notes.push(...leftOutNotes(own, lost, byId, unknown));
		// What the file says that the lifted model doesn't (a value the text can't hold).
		const liftedById = new Map(liftedElements.map((l) => [l['@id'], l]));
		for (const { element: e, lifted: l, properties } of changed)
			notes.push({
				kind: 'changed',
				message: `${article(e['@type'], true)} reads differently from the file: ${properties
					.map((p) => `${p} ${shown(e[p], byId)} → ${shown(l[p], liftedById)}`)
					.join(', ')}.`,
				element: elementLabel(e, byId)
			});
		try {
			lifted.minimizeQualifications();
		} catch {
			// The fully qualified spellings are still correct, just longer.
		}
		units = JSON.parse(lifted.units()) as { name: string; text: string }[];
	} finally {
		lifted.free();
	}

	let files = nameFiles(units.filter((u) => u.text.trim())).map((f) => ({
		path: f.path,
		text: format(tk, tidy(f.text))
	}));
	let check = checkFiles(tk, library, files);
	// The toolkit's printer has a few known slips; mend them when the mended text says the same.
	const mended = mendPrinted(files, check.findings);
	if (mended.changed) {
		const recheck = checkFiles(tk, library, mended.files);
		const before = compareModels(liftedElements, check.elements);
		const after = compareModels(liftedElements, recheck.elements);
		if (recheck.errors < check.errors && size(after) <= size(before)) {
			for (const message of mended.messages) notes.push({ kind: 'repaired', message });
			files = mended.files;
			check = recheck;
		}
	}

	// `expose $::A::**` (the global scope, spelled out) reads better as `expose A::**`.
	const plain = files.map((f) => ({
		path: f.path,
		text: f.text.replace(/^(\s*expose\s+)\$::/gm, '$1')
	}));
	if (plain.some((f, i) => f.text !== files[i]!.text)) {
		const recheck = checkFiles(tk, library, plain);
		if (
			recheck.errors <= check.errors &&
			size(compareModels(liftedElements, recheck.elements)) <=
				size(compareModels(liftedElements, check.elements))
		) {
			files = plain;
			check = recheck;
		}
	}

	const difference = compareModels(liftedElements, check.elements);
	for (const d of difference.onlyInFirst)
		notes.push({
			kind: 'left-out',
			message: `The text doesn’t carry ${article(d.type)}.`,
			element: keyLabel(d.key)
		});
	for (const d of difference.onlyInSecond)
		notes.push({
			kind: 'added',
			message: `The text adds ${article(d.type)}.`,
			element: keyLabel(d.key)
		});
	for (const d of difference.changed)
		notes.push({
			kind: 'changed',
			message: `${article(d.type, true)} reads differently from the text: ${d.properties.join(', ')}.`,
			element: keyLabel(d.key)
		});

	return {
		files,
		elements: elements.length,
		carried: check.elements.length,
		notes,
		problems: check.findings.map((f): ImportProblem => ({
			file: f.unit,
			line: f.line,
			severity: f.severity === 'error' || f.severity === 'warning' ? f.severity : 'info',
			message: f.message
		}))
	};
}

/**
 * Two elements with one `@id` can't both be read (references to the id would
 * mean either): refused, naming both, rather than one quietly replacing the
 * other.
 */
function refuseSharedIds(elements: readonly ElementJson[]): void {
	const { duplicates } = checkStructure(elements);
	if (!duplicates.length) return;
	const byId = new Map<string, ElementJson>();
	for (const e of elements) if (!byId.has(e['@id'])) byId.set(e['@id'], e);
	const id = duplicates[0]!;
	const sharing = elements.filter((e) => e['@id'] === id).map((e) => elementLabel(e, byId));
	const more = new Set(duplicates).size - 1;
	throw new InterchangeError(
		`Elements in this file share the same @id ${id}: ${sharing.join(' and ')}. Every element needs an id of its own, so it was not opened${more ? ` (${count(more, 'other id')} ${more === 1 ? 'is' : 'are'} shared too)` : ''}.`
	);
}

/**
 * Single spaces between words of code lines (the printer writes `flow  of :
 * T  from`); comment lines and lines with quoted names or strings are left alone.
 */
export function tidy(text: string): string {
	let comment = false;
	return text
		.split('\n')
		.map((line) => {
			const code = !comment && !/['"]|\/\*|\/\/|^\s*\*/.test(line);
			if (line.includes('/*')) comment = !line.includes('*/', line.indexOf('/*'));
			else if (comment && line.includes('*/')) comment = false;
			return code ? line.replace(/(\S) {2,}(?=\S)/g, '$1 ') : line;
		})
		.join('\n');
}

/** The editor's formatting (four spaces); text the formatter refuses stays as it is. */
function format(tk: Toolkit, text: string): string {
	try {
		return tk.formatSource(text, FORMAT_CONFIG);
	} catch {
		return text;
	}
}

const size = (d: ReturnType<typeof compareModels>) =>
	d.onlyInFirst.length + d.onlyInSecond.length + d.changed.length;

/** The files' findings against the library, and their elements. */
function checkFiles(
	tk: Toolkit,
	library: TkLibrary,
	files: SourceFile[]
): { findings: TkFinding[]; errors: number; elements: ElementJson[] } {
	const sources = JSON.stringify(files.map((f) => ({ name: f.path, text: f.text })));
	const parse = (JSON.parse(tk.checkSyntax(sources)) as TkFinding[]).filter(
		(f) => f.stage === 'parse'
	);
	if (parse.length) return { findings: parse, errors: parse.length, elements: [] };
	const session = tk.Session.fromSourcesWithPreparedLibrary(sources, library);
	try {
		const findings = JSON.parse(session.check()) as TkFinding[];
		return {
			findings,
			errors: findings.filter((f) => f.severity === 'error').length,
			elements: JSON.parse(session.toCompactJson()) as ElementJson[]
		};
	} finally {
		session.free();
	}
}

/** File names from what each unit declares: `DroneArchitecture.sysml`. */
function nameFiles(units: { name: string; text: string }[]): SourceFile[] {
	const taken = new Set<string>();
	return units.map((u, index) => {
		const name = topLevelNames(u.text)[0];
		const stem = (name ?? `Model${index + 1}`).replace(/[^\w.-]+/g, '') || `Model${index + 1}`;
		let path = `${stem}.sysml`;
		for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${stem}${n}.sysml`;
		taken.add(path.toLowerCase());
		return { path, text: u.text };
	});
}

/**
 * Mend what the toolkit's printer is known to get wrong (sysml-toolkit
 * 0.10.10; docs/engine.md, upstream requests):
 * - a decision's `else` branch printed as `transition then X;`, which an
 *   action body doesn't allow;
 * - a `message` printed as a `flow … of : T from a to b`, whose ends are then
 *   read as payload ends.
 * Only lines a finding points at are touched; the caller keeps the result
 * only when the mended text has fewer errors and says no less.
 */
export function mendPrinted(
	files: SourceFile[],
	findings: TkFinding[]
): { files: SourceFile[]; changed: boolean; messages: string[] } {
	let changed = false;
	const messages: string[] = [];
	const out = files.map((file) => {
		const lines = file.text.split('\n');
		const count = { else: 0, message: 0 };
		for (const f of findings) {
			if (f.unit !== file.path) continue;
			const at = f.line - 1;
			const line = lines[at];
			if (line === undefined) continue;
			if (/transition usage is not allowed in an action body/.test(f.message)) {
				const m = /^(\s*)transition then (.+);\s*$/.exec(line);
				const previous = lines
					.slice(0, at)
					.reverse()
					.find((l) => l.trim());
				if (m && previous && new RegExp(`^${m[1]}if .+ then .+;\\s*$`).test(previous)) {
					lines[at] = `${m[1]}else ${m[2]};`;
					count.else++;
				}
			} else if (/validateFlowEndSubsetting/.test(f.message)) {
				const m =
					/^(\s*)(then )?flow ([^\s]+)\s+of\s*:\s*(.+?)\s+from (.+?) to (.+?)(\s*\{|;)\s*$/.exec(
						line
					);
				if (m) {
					lines[at] =
						`${m[1]}${m[2] ?? ''}message ${m[3]} of ${m[4]} from ${m[5]} to ${m[6]}${m[7]!.trim() === '{' ? ' {' : ';'}`;
					count.message++;
				}
			}
		}
		if (!count.else && !count.message) return file;
		changed = true;
		if (count.else)
			messages.push(
				`${file.path}: ${count.else === 1 ? 'a decision’s “else” branch' : `${count.else} decisions’ “else” branches`} rewritten as “else”.`
			);
		if (count.message)
			messages.push(
				`${file.path}: ${count.message === 1 ? 'a message' : `${count.message} messages`} rewritten as “message … from … to …”.`
			);
		return { path: file.path, text: lines.join('\n') };
	});
	return { files: out, changed, messages };
}

/**
 * The implied part of a file (KerML 10.4 lets a file include it): implied
 * relationships, and what they own (a calculation's `result`, a
 * connection's `thisThing`, written out by a tool's derived form). The text
 * implies them all again.
 */
function impliedIds(elements: readonly ElementJson[]): Set<string> {
	const byId = new Map(elements.map((e) => [e['@id'], e]));
	const implied = new Set<string>();
	const decided = new Map<string, boolean>();
	const isImplied = (e: ElementJson, depth = 0): boolean => {
		const known = decided.get(e['@id']);
		if (known !== undefined) return known;
		const owner = ownerOf(e);
		const parent = owner ? byId.get(owner) : undefined;
		const result =
			e.isImplied === true || (!!parent && depth < 256 && isImplied(parent, depth + 1));
		decided.set(e['@id'], result);
		return result;
	};
	for (const e of elements) if (isImplied(e)) implied.add(e['@id']);
	return implied;
}

const isEmpty = (value: unknown) =>
	value === undefined ||
	value === null ||
	value === false ||
	(Array.isArray(value) && value.length === 0);

const OWNING = new Set(['owningRelationship', 'owningRelatedElement']);

/**
 * Element JSON from another tool made liftable, where the meaning is
 * certain (each case seen in SysON 2026.9's API JSON):
 * - a `ConjugatedPortDefinition` without a declared name gets the name the
 *   specification derives for it, `~` and its port definition's name (the
 *   lift names references by declared names; the toolkit writes it so too);
 * - an unnamed transition with neither trigger, guard nor effect from a
 *   state's `entry` action, which is what `entry; then off;` reads as in
 *   SysON, becomes the succession that text is (SysML 8.2.2.20,
 *   `EntryTransitionMember`; the pilot implementation reads it so);
 * - an expression referring to a feature the file doesn't name (a name its
 *   tool couldn't resolve) can't be written as text: the whole expression
 *   is left out and named in a note, rather than refusing the file.
 */
export function prepareForLift(input: readonly ElementJson[]): {
	elements: ElementJson[];
	notes: ImportNote[];
} {
	const byId = new Map(input.map((e) => [e['@id'], { ...e }]));
	const notes: ImportNote[] = [];
	const removed = new Set<string>();
	const added: ElementJson[] = [];
	const refs = (value: unknown) =>
		(Array.isArray(value) ? value : [value]).filter(isRef).map((r) => r['@id']);
	const owned = (e: ElementJson) => [...refs(e.ownedRelationship), ...refs(e.ownedRelatedElement)];
	const subtree = (id: string) => {
		const out: string[] = [];
		const walk = (at: string, depth: number) => {
			const e = byId.get(at);
			if (!e || depth > 256) return;
			out.push(at);
			for (const child of owned(e)) walk(child, depth + 1);
		};
		walk(id, 0);
		return out;
	};
	const ownerElement = (e: ElementJson) => {
		const relationship = byId.get(refs(e.owningRelationship)[0] ?? '');
		return relationship ? byId.get(refs(relationship.owningRelatedElement)[0] ?? '') : undefined;
	};
	const unnamed = (e: ElementJson) => !nameOf({ ...e, name: null, shortName: null });

	// Conjugated port definitions: `~` and the original's name.
	for (const e of byId.values()) {
		if (e['@type'] !== 'ConjugatedPortDefinition' || typeof e.declaredName === 'string') continue;
		const conjugation = owned(e)
			.map((id) => byId.get(id))
			.find((r) => r?.['@type'] === 'PortConjugation');
		const original =
			byId.get(refs(conjugation?.originalPortDefinition)[0] ?? '') ??
			byId.get(refs(e.originalPortDefinition)[0] ?? '') ??
			ownerElement(e);
		const name = original?.declaredName;
		if (typeof name === 'string' && name) e.declaredName = `~${name}`;
	}

	// What the metaclass fixes, left out: a feature chain's operator is `.`.
	for (const e of byId.values())
		if (e['@type'] === 'FeatureChainExpression' && typeof e.operator !== 'string') e.operator = '.';

	// An invocation typed by what it invokes (KerML 1.0's beta form): the
	// final form's membership of the invoked type, first.
	for (const e of [...byId.values()]) {
		if (e['@type'] !== 'InvocationExpression') continue;
		const parts = owned(e).map((id) => byId.get(id));
		if (parts.some((r) => r?.['@type'] === 'Membership')) continue;
		const typing = parts.find((r) => r?.['@type'] === 'FeatureTyping');
		const type = refs(typing?.type)[0];
		if (!typing || !type) continue;
		removed.add(typing['@id']);
		const membership: ElementJson = {
			'@id': typing['@id'],
			'@type': 'Membership',
			owningRelatedElement: { '@id': e['@id'] },
			memberElement: { '@id': type },
			visibility: 'public'
		};
		added.push(membership);
		e.ownedRelationship = [
			{ '@id': typing['@id'] },
			...refs(e.ownedRelationship)
				.filter((id) => id !== typing['@id'])
				.map((id) => ({ '@id': id }))
		];
	}

	// `entry; then X;` held as a transition: the succession it is.
	for (const t of [...byId.values()]) {
		if (t['@type'] !== 'TransitionUsage' || !unnamed(t)) continue;
		const parts = owned(t).map((id) => byId.get(id));
		if (parts.some((r) => r?.['@type'] === 'TransitionFeatureMembership')) continue;
		const source = byId.get(refs(t.source)[0] ?? '');
		const state = ownerElement(t);
		const sourceMembership = source && byId.get(refs(source.owningRelationship)[0] ?? '');
		if (
			!source ||
			!state ||
			!unnamed(source) ||
			sourceMembership?.['@type'] !== 'StateSubactionMembership' ||
			sourceMembership.kind !== 'entry' ||
			refs(sourceMembership.owningRelatedElement)[0] !== state['@id']
		)
			continue;
		const inner = parts
			.flatMap((r) => (r ? refs(r.ownedRelatedElement) : []))
			.map((id) => byId.get(id))
			.find((x) => x?.['@type'] === 'SuccessionAsUsage');
		const target = refs(t.target)[0] ?? refs(inner?.targetFeature)[0];
		if (!target || !byId.has(target)) continue;
		for (const id of subtree(t['@id'])) removed.add(id);
		const id = (part: string) => derivedId(`${t['@id']}/${part}`);
		const self = { '@id': t['@id'] };
		added.push(
			{
				'@id': t['@id'],
				'@type': 'SuccessionAsUsage',
				owningRelationship: t.owningRelationship,
				ownedRelationship: [{ '@id': id('end1') }, { '@id': id('end2') }]
			},
			{
				'@id': id('end1'),
				'@type': 'EndFeatureMembership',
				owningRelatedElement: self,
				ownedRelatedElement: [{ '@id': id('end1/feature') }],
				visibility: 'public'
			},
			{
				'@id': id('end1/feature'),
				'@type': 'ReferenceUsage',
				owningRelationship: { '@id': id('end1') }
			},
			{
				'@id': id('end2'),
				'@type': 'EndFeatureMembership',
				owningRelatedElement: self,
				ownedRelatedElement: [{ '@id': id('end2/feature') }],
				visibility: 'public'
			},
			{
				'@id': id('end2/feature'),
				'@type': 'ReferenceUsage',
				owningRelationship: { '@id': id('end2') },
				ownedRelationship: [{ '@id': id('end2/reference') }]
			},
			{
				'@id': id('end2/reference'),
				'@type': 'ReferenceSubsetting',
				owningRelatedElement: { '@id': id('end2/feature') },
				referencedFeature: { '@id': target }
			}
		);
		notes.push({
			kind: 'repaired',
			message: `The file holds “entry; then ${nameOf(byId.get(target)) ?? '…'};” as a transition; it was read as the succession that text is.`,
			element: namePath(state, byId)
		});
	}

	// Expressions referring to what the file doesn't name: left out whole, and said.
	const isExpression = (e: ElementJson | undefined) => !!e && /Expression$/.test(e['@type']);
	for (const e of [...byId.values()]) {
		if (e['@type'] !== 'FeatureReferenceExpression' || removed.has(e['@id'])) continue;
		const memberships = owned(e)
			.map((id) => byId.get(id))
			.filter((r) => r?.['@type'] === 'Membership');
		const names = memberships.some((m) => refs(m!.memberElement).length > 0);
		if (refs(e.referent).length || names || !memberships.length) continue;
		// Up to the outermost expression it is part of.
		let top = e;
		for (let depth = 0; depth < 64; depth++) {
			const owner = ownerElement(top);
			if (isExpression(owner)) top = owner!;
			else if (owner && owner['@type'] === 'Feature' && isExpression(ownerElement(owner)))
				top = ownerElement(owner)!;
			else break;
		}
		const membership = byId.get(refs(top.owningRelationship)[0] ?? '');
		const holder = membership && byId.get(refs(membership.owningRelatedElement)[0] ?? '');
		if (!membership || !holder) continue;
		for (const id of subtree(membership['@id'])) removed.add(id);
		holder.ownedRelationship = refs(holder.ownedRelationship)
			.filter((id) => id !== membership['@id'])
			.map((id) => ({ '@id': id }));
		notes.push({
			kind: 'left-out',
			message: `Not carried over: ${article(top['@type'])} that refers to something the file doesn’t name (the tool that wrote it couldn’t resolve the name).`,
			element: namePath(holder, byId)
		});
	}

	if (!removed.size && !added.length)
		return { elements: input.map((e) => byId.get(e['@id'])!), notes };
	const kept = input.filter((e) => !removed.has(e['@id'])).map((e) => byId.get(e['@id'])!);
	return { elements: [...kept, ...added], notes };
}

/**
 * What of the file's explicit elements the lifted model has, decided by
 * meaning rather than by id: each element is matched to the lifted one in
 * the same place (`ownershipKeys`: by name under its owner, an unnamed one
 * by kind and position among its owner's unnamed parts of that kind), so a
 * tool that orders members otherwise (a multiplicity before the typing) or
 * numbers them otherwise reads as the same model. Implied elements aren't
 * compared (the text implies them), nor are derived properties, which follow
 * from the rest: a property the toolkit's compact form leaves empty and its
 * full form fills in.
 */
function carriedOver(
	tk: Toolkit,
	own: ElementJson[],
	lifted: TkSession,
	liftedElements: ElementJson[]
): {
	lost: Set<string>;
	changed: { element: ElementJson; lifted: ElementJson; properties: string[] }[];
} {
	const implied = impliedIds(own);
	const explicit = own.filter((e) => !implied.has(e['@id']));
	const file = canonicalModel(tk, explicit);
	const liftedImplied = impliedIds(liftedElements);
	const canonical = JSON.parse(
		tk.canonicalizeCompact(
			JSON.stringify(liftedElements.filter((l) => !liftedImplied.has(l['@id'])))
		)
	) as ElementJson[];
	for (const l of canonical) spellRedefined(l);
	let full = new Map<string, ElementJson>();
	try {
		full = new Map(
			(JSON.parse(lifted.toFullJson(false)) as ElementJson[]).map((l) => [l['@id'], l])
		);
	} catch {
		// Without the full form every property is compared: more notes, none missed.
	}
	const derived = (l: ElementJson, p: string) => isEmpty(l[p]) && !isEmpty(full.get(l['@id'])?.[p]);

	// Files and root namespaces don't matter (a server may leave the roots out).
	const fileKeys = ownershipKeys(file, { transparentRoots: true });
	const liftKeys = ownershipKeys(canonical, { transparentRoots: true });
	const liftByKey = new Map<string, ElementJson>();
	for (const l of canonical) {
		const key = liftKeys.get(l['@id']);
		if (key) liftByKey.set(key, l);
	}
	const liftIds = new Set(liftedElements.map((l) => l['@id']));
	const counterpart = new Map<string, ElementJson>();
	const lost = new Set<string>();
	const canonicalById = new Map(file.map((e) => [e['@id'], e]));
	const ownById = new Map(own.map((e) => [e['@id'], e]));
	const liftById = new Map(canonical.map((l) => [l['@id'], l]));
	const membership = (type: string) => type.endsWith('Membership');
	for (const e of explicit) {
		const key = fileKeys.get(e['@id']);
		// Without a place (its owner isn't in the file), by id.
		const l = key ? liftByKey.get(key) : liftById.get(e['@id']);
		if (l && (l['@type'] === e['@type'] || (membership(l['@type']) && membership(e['@type']))))
			counterpart.set(e['@id'], l);
		else if (key || !liftIds.has(e['@id'])) lost.add(e['@id']);
	}
	// What another tool writes out that the text implies (a transition's parameters, a
	// calculation's result): the lifted model's full form has it, implied, in its place.
	if (lost.size && full.size) {
		const declared = [...full.values()].map((l) => ({ ...l, name: null, shortName: null }));
		const fullImplied = impliedIds(declared);
		const fullKeys = ownershipKeys(declared, { transparentRoots: true });
		const fullByKey = new Map<string, ElementJson>();
		for (const l of declared) {
			const key = fullKeys.get(l['@id']);
			if (key) fullByKey.set(key, l);
		}
		for (const id of lost) {
			const key = fileKeys.get(id);
			const there = key ? fullByKey.get(key) : undefined;
			if (there && there['@type'] === ownById.get(id)?.['@type'] && fullImplied.has(there['@id']))
				lost.delete(id);
		}
	}

	// References compare by place (ids differ between the file and the lift); others by id.
	const fileRef = (id: string) => fileKeys.get(id) ?? id;
	const gone = new Set([...lost, ...implied]);
	const liftRef = (id: string) => liftKeys.get(id) ?? id;
	const spelled = (value: unknown, ref: (id: string) => string, drop?: Set<string>): unknown =>
		isRef(value)
			? ref(value['@id'])
			: Array.isArray(value)
				? value
						.filter((v) => !(drop && isRef(v) && drop.has(v['@id'])))
						.map((v) => (isRef(v) ? ref(v['@id']) : v))
				: value;
	// Unset, false and empty are one value (KerML 10.4 lets a file leave out defaults).
	const same = (a: unknown, b: unknown) =>
		(isEmpty(a) && isEmpty(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
	const changed: { element: ElementJson; lifted: ElementJson; properties: string[] }[] = [];
	for (const [id, l] of counterpart) {
		const e = canonicalById.get(id);
		const original = ownById.get(id);
		if (!e || !original) continue;
		const properties = Object.keys(l).filter(
			(p) =>
				p !== '@id' &&
				p !== 'elementId' &&
				p in original &&
				!derived(l, p) &&
				// An owner the file leaves out (SysON's API does) is the text's to supply.
				!(OWNING.has(p) && isRef(e[p]) && !ownById.has(e[p]['@id'])) &&
				!same(spelled(e[p], fileRef, gone), spelled(l[p], liftRef, liftedImplied))
		);
		if (properties.length) changed.push({ element: original, lifted: l, properties });
	}
	return { lost, changed };
}

/**
 * What the file had that the text hasn't, once each: an element left out
 * takes what it owns and the membership that owned it along.
 */
function leftOutNotes(
	own: ElementJson[],
	lost: Set<string>,
	byId: Map<string, ElementJson>,
	unknown: Set<string>
): ImportNote[] {
	// A relationship that only owned lost elements goes with them.
	const carrier = (e: ElementJson) =>
		Array.isArray(e.ownedRelatedElement) &&
		e.ownedRelatedElement.length > 0 &&
		e.ownedRelatedElement.every((r) => isRef(r) && lost.has(r['@id']));
	const notes: ImportNote[] = [];
	const said = new Set<string>();
	for (const e of own) {
		if (!lost.has(e['@id']) || carrier(e)) continue;
		let inside = false;
		for (let owner = ownerOf(e), depth = 0; owner && depth < 64; depth++) {
			const parent = byId.get(owner);
			if (!parent) break;
			if (lost.has(owner) && !carrier(parent)) {
				inside = true;
				break;
			}
			owner = ownerOf(parent);
		}
		if (inside) continue;
		said.add(e['@type']);
		notes.push({
			kind: 'left-out',
			message: unknown.has(e['@type'])
				? `Left out: ${article(e['@type'])}, which isn’t a SysML element the engine knows.`
				: `Not carried over: ${article(e['@type'])}.`,
			element: elementLabel(e, byId)
		});
	}
	for (const type of unknown)
		if (!said.has(type))
			notes.push({
				kind: 'warning',
				message: plainWarning(`unsupported owned element @type ${type}`)
			});
	return notes;
}

/** A property's value in a note: plain values as JSON, references by name. */
function shown(value: unknown, byId: Map<string, ElementJson>): string {
	const named = (id: string) => {
		const e = byId.get(id);
		return e ? namePath(e, byId) : id.slice(0, 8);
	};
	if (isRef(value)) return named(value['@id']);
	if (Array.isArray(value) && value.some(isRef))
		return `[${value.map((v) => (isRef(v) ? named(v['@id']) : JSON.stringify(v))).join(', ')}]`;
	return JSON.stringify(value);
}

/** An element of a JSON file, by its qualified name when it has one. */
function elementLabel(e: ElementJson, byId: Map<string, ElementJson>): string {
	const path = namePath(e, byId);
	return path === e['@type'] ? `${e['@type']} ${e['@id']}` : `${path} (${e['@type']})`;
}

/** `PartUsage` → `a part usage`. */
function article(type: string, capital = false): string {
	const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	const a = /^[aeiou]/.test(words) ? 'an' : 'a';
	return `${capital ? a[0]!.toUpperCase() + a.slice(1) : a} ${words}`;
}

const count = (n: number, noun: string) => `${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;

/** The toolkit's lift warnings in plainer words. */
function plainWarning(warning: string): string {
	const ids = /^(\d+) element\(s\) of the document have no structural counterpart/.exec(warning);
	if (ids)
		return `${count(Number(ids[1]), 'element')} of the file had no place in the text, so ${ids[1] === '1' ? 'its id' : 'their ids'} could not be kept.`;
	const type = /^unsupported owned element @type (\w+)/.exec(warning);
	if (type)
		return `${article(type[1]!, true)} isn’t a SysML element the engine knows, so it was left out.`;
	return warning.charAt(0).toUpperCase() + warning.slice(1) + (/[.!?]$/.test(warning) ? '' : '.');
}
