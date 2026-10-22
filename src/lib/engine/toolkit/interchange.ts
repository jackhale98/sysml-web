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
	if (!options.derived) for (const e of elements) spellRedefined(e);
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
	const own = elements.filter(
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
	const implied = own.filter((e) => e.isImplied === true).length;
	if (implied)
		notes.push({
			kind: 'implied',
			message: `${count(implied, 'implied relationship')} not written out: the text implies ${implied === 1 ? 'it' : 'them'}, and the engine works ${implied === 1 ? 'it' : 'them'} out again.`
		});

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
		const kept = new Set(liftedElements.map((e) => e['@id']));
		const lost = new Set(
			own.filter((e) => !kept.has(e['@id']) && e.isImplied !== true).map((e) => e['@id'])
		);
		// The toolkit's warnings: types it doesn't know go with what was left out; that
		// ids weren't kept says nothing new (text has no ids).
		const unknown = new Set<string>();
		for (const warning of JSON.parse(lifted.warnings()) as string[]) {
			const type = /^unsupported owned element @type (\w+)/.exec(warning)?.[1];
			if (type) unknown.add(type);
			else if (!/no structural counterpart|ids are not preserved/.test(warning))
				notes.push({ kind: 'warning', message: plainWarning(warning) });
		}
		notes.push(...leftOutNotes(own, lost, byId, unknown));
		// What the file says that the lifted model doesn't (a value the text can't hold).
		const canonical = JSON.parse(
			tk.canonicalizeCompact(JSON.stringify(liftedElements))
		) as ElementJson[];
		const keptOnly = (value: unknown) =>
			Array.isArray(value) ? value.filter((v) => !(isRef(v) && lost.has(v['@id']))) : value;
		for (const l of canonical) {
			spellRedefined(l);
			const e = byId.get(l['@id']);
			if (!e) continue;
			const properties = Object.keys(l).filter(
				(p) =>
					p !== '@id' &&
					p !== 'elementId' &&
					p in e &&
					JSON.stringify(keptOnly(e[p]) ?? null) !== JSON.stringify(l[p] ?? null)
			);
			if (properties.length)
				notes.push({
					kind: 'changed',
					message: `${article(e['@type'], true)} reads differently from the file: ${properties
						.map((p) => `${p} ${shown(e[p], byId)} → ${shown(l[p], byId)}`)
						.join(', ')}.`,
					element: elementLabel(e, byId)
				});
		}
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
