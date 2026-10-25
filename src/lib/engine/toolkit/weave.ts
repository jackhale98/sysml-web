/**
 * Bringing a merged model into the project's text (`#lib/exchange/merge.ts`
 * merges; this writes the result). The text is the source of truth, so the
 * project's files are changed as little as they can be:
 *
 * - an element the other side added is written where it goes, between the
 *   members it sits between in the merged model;
 * - one it removed is taken out, with its lines;
 * - one it changed is written again: the smallest member declaration that
 *   holds the change (a part, a definition, a package) is replaced by the
 *   toolkit's printing of it, formatted as the editor formats.
 *
 * The printing comes from lifting the whole merged model to text (as an
 * import does) and reading the declaration's text there. Everything else in
 * the files, notes (`//`), blank lines and layout included, stays as it was.
 * A declaration written again keeps none of its own: that is reported.
 *
 * The result is checked: the changed files must hold the model the lifted
 * text holds. A file where they differ is written whole from the lifted text
 * instead, and whatever still differs is reported.
 */
import {
	isRef,
	keyLabel,
	matchIds,
	nameOf,
	ownerOf,
	ownershipKeys,
	compareModels,
	type ElementJson
} from '#lib/exchange/elements.ts';
import type { WovenFile, WeaveResult } from '#lib/exchange/types.ts';
import { topLevelNames } from '#lib/library/declarations.ts';
import type { SourceFile } from '../protocol';
import type { TkLibrary, TkSession, TkSite, Toolkit } from './api';
import { lineEnd, lineIndent, lineStart, removal } from './header';
import { FORMAT_CONFIG } from './language';
import { TextIndex } from './offsets';
import { metadataValuesAsWritten, tidy } from './interchange';
import * as views from './views';

const EXPRESSION = /(Expression|^Literal\w*|^MultiplicityRange|^Multiplicity)$/;
const IGNORED = new Set(['@id', 'elementId']);
const OWNED = new Set(['ownedRelationship', 'ownedRelatedElement']);

interface Place {
	path: string;
	from: number;
	to: number;
}

interface Change {
	path: string;
	from: number;
	to: number;
	insert: string;
}

/** The editor's rename: the declaration at `offset` and every reference to it, as changes. */
export type Rename = (path: string, offset: number, newName: string) => Change[] | null;

const refIds = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter(isRef).map((r) => r['@id']) : [];
const isRelationship = (e: ElementJson) => 'owningRelatedElement' in e;
const isDeclaration = (e: ElementJson | undefined) =>
	!!e && isRef(e.owningRelationship) && !EXPRESSION.test(e['@type']);

/**
 * `files` (whose analysed session is `session`, exported as `ours`) changed to
 * hold `merged` (in ours' ids wherever ours has the element).
 */
export function weaveModel(
	tk: Toolkit,
	library: TkLibrary,
	session: TkSession,
	files: readonly SourceFile[],
	ours: readonly ElementJson[],
	merged: readonly ElementJson[],
	rename?: Rename
): WeaveResult {
	// Metadata values as the toolkit writes them, like the lifted text's JSON below.
	ours = metadataValuesAsWritten(session, ours);
	merged = metadataValuesAsWritten(session, merged);
	const texts = new Map(files.map((f) => [f.path, f.text]));
	const O = new Map(ours.map((e) => [e['@id'], e]));
	const M = new Map(merged.map((e) => [e['@id'], e]));
	const ourPlaces = places(session, [...O.keys()], texts);

	// The merged model as text: lifted, short names, formatted; then read again for its places.
	const lifted = liftModel(tk, library, merged);
	const fresh = tk.Session.fromSourcesWithPreparedLibrary(
		JSON.stringify(lifted.map((text, i) => ({ name: liftedName(i), text }))),
		library
	);
	let freshElements: ElementJson[];
	let freshPlaces: Map<string, Place>;
	try {
		freshElements = JSON.parse(fresh.toCompactJson()) as ElementJson[];
		freshPlaces = places(
			fresh,
			freshElements.map((e) => e['@id']),
			new Map(lifted.map((text, i) => [liftedName(i), text]))
		);
	} finally {
		fresh.free();
	}
	const toFresh = matchIds(merged, freshElements);
	const liftedText = (path: string) => lifted[Number(/\d+/.exec(path)![0])]!;
	/** Where an element of the merged model is in the lifted text. */
	const printed = (id: string) => {
		const fid = toFresh.get(id);
		return fid ? freshPlaces.get(fid) : undefined;
	};

	// Each root namespace (a file) of either model, and its file.
	const fileOf = new Map<string, string>();
	const rootOf = (id: string, byId: Map<string, ElementJson>) => {
		let at = id;
		for (let depth = 0; depth < 256; depth++) {
			const owner = ownerOf(byId.get(at)!);
			if (!owner || !byId.has(owner)) return at;
			at = owner;
		}
		return at;
	};
	for (const [id, place] of ourPlaces)
		if (!fileOf.has(rootOf(id, O))) fileOf.set(rootOf(id, O), place.path);
	const liftedFileOf = new Map<string, string>();
	for (const [id] of M) {
		const place = printed(id);
		if (place && !liftedFileOf.has(rootOf(id, M))) liftedFileOf.set(rootOf(id, M), place.path);
	}
	const ownFile = (root: string) => {
		const path = fileOf.get(root);
		return path && texts.has(path) ? path : null;
	};

	// What differs between the text's model and the merged one.
	const created: string[] = [];
	const deleted: string[] = [];
	const updated: string[] = [];
	for (const [id, m] of M) {
		const o = O.get(id);
		if (!o) created.push(id);
		else if (!sameElement(o, m)) updated.push(id);
	}
	for (const id of O.keys()) if (!M.has(id)) deleted.push(id);

	// The member declaration whose text holds an element of ours (a root: the whole file).
	const holder = (id: string): string => {
		let at = id;
		const e = O.get(at);
		if (e && isRelationship(e)) {
			const member = refIds(e.ownedRelatedElement)[0];
			if (member && isDeclaration(O.get(member)) && ourPlaces.has(member)) return member;
		}
		for (let depth = 0; depth < 256; depth++) {
			const x = O.get(at);
			if (!x) break;
			if (isDeclaration(x) && ourPlaces.has(at)) return at;
			const owner = ownerOf(x);
			if (!owner || !O.has(owner)) return at;
			at = owner;
		}
		return at;
	};
	const isRoot = (id: string) => !ownerOf(O.get(id) ?? M.get(id)!);
	const rewrites = new Set<string>();
	const wholeFiles = new Set<string>();
	/** Write a declaration of ours again (one the merged model has, printed), else what holds it. */
	const rewrite = (id: string) => {
		let at = holder(id);
		for (let depth = 0; depth < 256; depth++) {
			if (isRoot(at)) {
				const path = ownFile(at);
				if (path) wholeFiles.add(path);
				return;
			}
			if (M.has(at) && printed(at) && ourPlaces.has(at)) {
				rewrites.add(at);
				return;
			}
			const owner = O.get(at) ? ownerOf(O.get(at)!) : null;
			if (!owner) return;
			at = holder(owner);
		}
	};

	interface Insert {
		parent: string;
		relationship: string;
		member: string;
	}
	const inserts: Insert[] = [];
	const removes = new Set<string>();
	const newRoots = new Set<string>();
	const goneRoots = new Set<string>();

	const renames: Change[] = [];
	const renameIn = (id: string, o: ElementJson, m: ElementJson): Change[] | null => {
		const place = ourPlaces.get(id);
		const before = o.declaredName;
		const after = m.declaredName;
		if (!rename || !place || typeof before !== 'string' || typeof after !== 'string') return null;
		const text = texts.get(place.path)!.slice(place.from, place.to);
		const plain = new RegExp(
			`(^|[^\\w'])${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w'])`
		).exec(text);
		const quoted = text.indexOf(`'${before}'`);
		const at = plain ? plain.index + plain[1]!.length : quoted >= 0 ? quoted + 1 : -1;
		if (at < 0) return null;
		const changes = rename(place.path, place.from + at, after);
		return changes?.length ? changes : null;
	};
	for (const id of updated) {
		const o = O.get(id)!;
		const m = M.get(id)!;
		const properties = [...new Set([...Object.keys(o), ...Object.keys(m)])].filter(
			(p) => !IGNORED.has(p) && stable(o[p]) !== stable(m[p])
		);
		// Members came or went, the rest in the same order: those are written one by one.
		const membersOnly = properties
			.filter((p) => OWNED.has(p))
			.every(
				(p) =>
					refIds(o[p])
						.filter((x) => M.has(x))
						.join() ===
					refIds(m[p])
						.filter((x) => O.has(x))
						.join()
			);
		const rest = properties.filter((p) => !OWNED.has(p) && p !== 'declaredName');
		// Renamed: the name and every reference to it, as the editor renames (what is
		// written again anyway has the new name already).
		const renamed = properties.includes('declaredName');
		const edits = renamed ? renameIn(id, o, m) : null;
		if (edits) renames.push(...edits);
		if (!membersOnly || rest.length || (renamed && !edits)) rewrite(id);
		// Moved: the new owner's text changes too.
		const newOwner = ownerOf(m);
		if (newOwner && newOwner !== ownerOf(o) && O.has(newOwner)) rewrite(newOwner);
	}
	const topOf = (
		id: string,
		inModel: Map<string, ElementJson>,
		outside: Map<string, ElementJson>
	) => {
		let at = id;
		for (let depth = 0; depth < 256; depth++) {
			const e = inModel.get(at);
			const owner = e ? ownerOf(e) : null;
			if (!owner || outside.has(owner) || !inModel.has(owner)) return at;
			at = owner;
		}
		return at;
	};
	for (const id of new Set(created.map((id) => topOf(id, M, O)))) {
		const top = M.get(id)!;
		const parent = ownerOf(top);
		if (!parent) {
			newRoots.add(id);
			continue;
		}
		const member = isRelationship(top) ? refIds(top.ownedRelatedElement) : [];
		if (
			member.length === 1 &&
			isDeclaration(M.get(member[0]!)) &&
			printed(member[0]!) &&
			(isRoot(parent) || ourPlaces.has(parent))
		)
			inserts.push({ parent, relationship: id, member: member[0]! });
		else rewrite(parent);
	}
	for (const id of new Set(deleted.map((id) => topOf(id, O, M)))) {
		const top = O.get(id)!;
		const parent = ownerOf(top);
		if (!parent) {
			goneRoots.add(id);
			continue;
		}
		const member = isRelationship(top) ? (refIds(top.ownedRelatedElement)[0] ?? id) : id;
		if (isDeclaration(O.get(member)) && ourPlaces.has(member)) removes.add(member);
		else rewrite(parent);
	}

	// Where each new member goes: after the member it follows in the merged
	// model (or before the one it precedes) that the text has.
	const placed: {
		at: number;
		/** The neighbour's other end. */
		edge: number;
		path: string;
		after: boolean;
		insert: Insert;
		index: number;
	}[] = [];
	for (const insert of inserts) {
		const list = refIds(M.get(insert.parent)!.ownedRelationship);
		const index = list.indexOf(insert.relationship);
		const anchor = (from: number, step: number) => {
			for (let j = from; j >= 0 && j < list.length; j += step) {
				const relationship = O.get(list[j]!);
				if (!relationship || !M.has(list[j]!)) continue;
				const member = refIds(relationship.ownedRelatedElement)[0];
				if (member && !removes.has(member) && ourPlaces.has(member)) return ourPlaces.get(member)!;
			}
			return undefined;
		};
		const before = anchor(index - 1, -1);
		const after = before ? undefined : anchor(index + 1, 1);
		if (before)
			placed.push({
				at: before.to,
				edge: before.from,
				path: before.path,
				after: true,
				insert,
				index
			});
		else if (after)
			placed.push({
				at: after.from,
				edge: after.to,
				path: after.path,
				after: false,
				insert,
				index
			});
		else if (isRoot(insert.parent) && ownFile(insert.parent)) {
			const path = ownFile(insert.parent)!;
			const at = texts.get(path)!.length;
			placed.push({ at, edge: at, path, after: true, insert, index });
		} else rewrite(insert.parent);
	}

	// Keep only the outermost of what is written again; what lies in it goes with it.
	const rewritten = [...rewrites]
		.map((id) => ({ id, ...ourPlaces.get(id)! }))
		.filter((r) => !wholeFiles.has(r.path));
	const inside = (path: string, at: number, end = at) =>
		wholeFiles.has(path) ||
		rewritten.some(
			(r) => r.path === path && r.from <= at && end <= r.to && !(r.from === at && r.to === end)
		);
	const outer = rewritten.filter(
		(r, i) =>
			!inside(r.path, r.from, r.to) &&
			rewritten.findIndex((x) => x.path === r.path && x.from === r.from && x.to === r.to) === i
	);
	const within = (path: string, at: number, end = at) =>
		wholeFiles.has(path) || outer.some((r) => r.path === path && r.from <= at && end <= r.to);
	const removed = [...removes]
		.map((id) => ({ id, ...ourPlaces.get(id)! }))
		.filter((r) => !within(r.path, r.from, r.to));
	const outerRemoved = removed.filter(
		(r) => !removed.some((x) => x !== r && x.path === r.path && x.from <= r.from && r.to <= x.to)
	);

	const changes: Change[] = [];
	const notes: WeaveResult['rewritten'] = [];
	for (const r of outer) {
		const text = texts.get(r.path)!;
		const place = printed(r.id)!;
		const snippet = reindent(liftedText(place.path), place, lineIndent(text, r.from));
		changes.push({ path: r.path, from: r.from, to: r.to, insert: snippet });
		notes.push({
			path: r.path,
			element: qualifiedName(r.id, M) || words(M.get(r.id)!['@type']),
			notes: countNotes(text.slice(r.from, r.to))
		});
	}
	for (const r of outerRemoved) {
		const change = removal(texts.get(r.path)!, r.from, r.to);
		changes.push({ path: r.path, ...change });
	}
	// New members after the same place go in together, in the merged model's order.
	const groups = new Map<string, typeof placed>();
	for (const p of placed) {
		// A new member inside what is written again or taken out goes with it.
		if (
			wholeFiles.has(p.path) ||
			[...outer, ...outerRemoved].some((r) => r.path === p.path && r.from < p.at && p.at < r.to)
		)
			continue;
		const key = `${p.path} ${p.at} ${p.after}`;
		(groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
	}
	for (const group of groups.values()) {
		group.sort((a, b) => a.index - b.index);
		const { path, at, after } = group[0]!;
		const text = texts.get(path)!;
		const end = after ? lineEnd(text, at) : lineStart(text, at);
		const rest = after ? text.slice(at, end) : text.slice(end, at);
		const ownLine = !rest.trim() || (after && /^\s*\/\//.test(rest));
		const indent = lineIndent(text, at);
		const snippets = group.map((p) => {
			const place = printed(p.insert.member)!;
			return reindent(liftedText(place.path), place, indent);
		});
		if (!ownLine) {
			// The neighbour shares its line with more: the new member goes right beside it.
			const joined = snippets.join(' ');
			changes.push({ path, from: at, to: at, insert: after ? ` ${joined}` : `${joined} ` });
		} else if (after && at >= text.length) {
			const joined = snippets.map((s) => `\n${s}`).join('');
			changes.push({
				path,
				from: at,
				to: at,
				insert: `${text.endsWith('\n') ? '' : '\n'}${joined}\n`
			});
		} else {
			// Members kept apart by blank lines (the neighbour from the one beyond it): the new ones too.
			const { edge } = group[0]!;
			const beyond = after
				? text.slice(lineStart(text, Math.max(0, lineStart(text, edge) - 1)), lineStart(text, edge))
				: text.slice(lineEnd(text, edge) + 1, lineEnd(text, lineEnd(text, edge) + 1) + 1);
			const gap = beyond.length > 0 && !beyond.trim() ? '\n' : '';
			const insert = after
				? snippets.map((s) => `\n${gap}${indent}${s}`).join('')
				: snippets.map((s) => `${indent}${s}\n${gap}`).join('');
			changes.push({ path, from: end, to: end, insert });
		}
	}

	// Renames, where nothing else writes the text they touch.
	for (const r of renames)
		if (
			!wholeFiles.has(r.path) &&
			!changes.some(
				(c) =>
					c.path === r.path &&
					(c.from === c.to ? r.from < c.from && c.from < r.to : r.from < c.to && c.from < r.to)
			)
		)
			changes.push(r);

	let out = new Map<string, string>();
	for (const path of texts.keys()) {
		const own = changes.filter((c) => c.path === path);
		if (wholeFiles.has(path)) continue;
		if (own.length) out.set(path, apply(texts.get(path)!, own));
	}
	const wholeFile = (path: string) => {
		const root = [...fileOf].find(([, p]) => p === path)?.[0];
		const lifted = root ? liftedFileOf.get(root) : undefined;
		return lifted ? liftedText(lifted) : '';
	};
	for (const path of wholeFiles) {
		out.set(path, wholeFile(path));
		notes.push({ path, element: null, notes: countNotes(texts.get(path)!) });
	}
	const removedFiles = [...goneRoots].map((root) => ownFile(root)).filter((p): p is string => !!p);
	const taken = new Set([...texts.keys()].map((p) => p.toLowerCase()));
	const added: WovenFile[] = [];
	const addedOf = new Map<string, string>();
	for (const root of newRoots) {
		const lifted = liftedFileOf.get(root);
		if (!lifted) continue;
		const text = liftedText(lifted);
		const stem = (topLevelNames(text)[0] ?? 'Model').replace(/[^\w.-]+/g, '') || 'Model';
		let path = `${stem}.sysml`;
		for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${stem}${n}.sysml`;
		taken.add(path.toLowerCase());
		added.push({ path, text, status: 'added' });
		addedOf.set(root, path);
	}

	// The check: the files must hold what the lifted text holds.
	// The lifted text's files as the project's.
	const projectPath = new Map<string, string>();
	for (const [root, lifted] of liftedFileOf) {
		const path = fileOf.get(root) ?? addedOf.get(root);
		if (path) projectPath.set(lifted, path);
	}
	const check = (changed: Map<string, string>) =>
		differences(tk, library, files, changed, added, removedFiles, lifted, projectPath);
	let found = check(out);
	const redo = [...found.files].filter((p) => texts.has(p) && !wholeFiles.has(p));
	if (redo.length) {
		out = new Map(out);
		for (const path of redo) {
			out.set(path, wholeFile(path));
			for (let i = notes.length - 1; i >= 0; i--) if (notes[i]!.path === path) notes.splice(i, 1);
			notes.push({ path, element: null, notes: countNotes(texts.get(path)!) });
		}
		found = check(out);
	}

	const result: WovenFile[] = [
		...[...out]
			.filter(([path, text]) => text !== texts.get(path))
			.map(([path, text]): WovenFile => ({ path, text, status: 'changed' })),
		...added,
		...removedFiles.map((path): WovenFile => ({ path, text: '', status: 'removed' }))
	];
	return {
		files: result,
		rewritten: notes.filter((n) => result.some((f) => f.path === n.path)),
		differences: found.messages
	};
}

/** The merged model as text, one file per root namespace: lifted, short names, formatted. */
function liftModel(tk: Toolkit, library: TkLibrary, merged: readonly ElementJson[]): string[] {
	const lifted = tk.Session.fromInterchangeJsonWithPreparedLibrary(
		JSON.stringify(merged),
		library,
		'4'
	);
	try {
		try {
			lifted.minimizeQualifications();
		} catch {
			// The fully qualified spellings are still correct, just longer.
		}
		const units = JSON.parse(lifted.units()) as { name: string; text: string }[];
		return units.map((u) => format(tk, tidy(u.text)));
	} finally {
		lifted.free();
	}
}

const liftedName = (i: number) => `merged-${i}.sysml`;

function format(tk: Toolkit, text: string): string {
	try {
		return tk.formatSource(text, FORMAT_CONFIG);
	} catch {
		return text;
	}
}

/** Where elements' member declarations are, in UTF-16 offsets of their files. */
function places(session: TkSession, ids: string[], texts: Map<string, string>): Map<string, Place> {
	const out = new Map<string, Place>();
	if (!ids.length) return out;
	const units = new Map(
		(JSON.parse(session.units()) as { unit: number; name: string }[]).map((u) => [u.unit, u.name])
	);
	const rows = JSON.parse(session.rows(JSON.stringify(ids), JSON.stringify(['memberExtent']))) as ({
		memberExtent?: TkSite | null;
	} | null)[];
	const indexes = new Map<string, TextIndex>();
	ids.forEach((id, i) => {
		const site = rows[i]?.memberExtent;
		const path = site ? units.get(site.unit) : undefined;
		const text = path ? texts.get(path) : undefined;
		if (!site || !path || text === undefined) return;
		let index = indexes.get(path);
		if (!index) indexes.set(path, (index = new TextIndex(text)));
		out.set(id, { path, from: index.byteToUtf16(site.start), to: index.byteToUtf16(site.end) });
	});
	return out;
}

/** A declaration's printed text, its lines after the first indented as `indent` in our file. */
function reindent(text: string, place: Place, indent: string): string {
	const own = lineIndent(text, place.from);
	return text
		.slice(place.from, place.to)
		.split('\n')
		.map((line, i) =>
			i === 0 ? line : line.startsWith(own) ? indent + line.slice(own.length) : line
		)
		.join('\n');
}

function apply(text: string, changes: Change[]): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to))
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}

/** Notes (`//`) in a stretch of SysML text, outside comments and strings. */
export function countNotes(text: string): number {
	let n = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const next = text[i + 1];
		if (c === '/' && next === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		} else if (c === '/' && next === '/') {
			n++;
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end;
		} else if (c === '"' || c === "'") {
			const end = text.indexOf(c, i + 1);
			i = end < 0 ? text.length : end;
		}
	}
	return n;
}

const stable = (value: unknown): string => {
	if (value === undefined || value === null) return 'null';
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (typeof value === 'object')
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
			.join(',')}}`;
	return JSON.stringify(value);
};

function sameElement(a: ElementJson, b: ElementJson): boolean {
	for (const p of new Set([...Object.keys(a), ...Object.keys(b)]))
		if (!IGNORED.has(p) && stable(a[p]) !== stable(b[p])) return false;
	return true;
}

function qualifiedName(id: string, byId: Map<string, ElementJson>): string {
	const names: string[] = [];
	for (let at: string | null = id, depth = 0; at && depth < 256; depth++) {
		const e = byId.get(at);
		if (!e) break;
		const name = nameOf(e);
		if (name && !isRelationship(e)) names.unshift(name);
		at = ownerOf(e);
	}
	return names.join('::');
}

/**
 * What the files (with `changed` texts) hold that the lifted text doesn't, or
 * the other way round, in the files of the project: the files where it
 * differs, and what, in words.
 */
function differences(
	tk: Toolkit,
	library: TkLibrary,
	files: readonly SourceFile[],
	changed: Map<string, string>,
	added: WovenFile[],
	removed: string[],
	lifted: string[],
	projectPath: Map<string, string>
): { files: Set<string>; messages: string[] } {
	const woven = [
		...files
			.filter((f) => !removed.includes(f.path))
			.map((f) => ({ path: f.path, text: changed.get(f.path) ?? f.text })),
		...added.map((f) => ({ path: f.path, text: f.text }))
	];
	const syntax = (
		JSON.parse(
			tk.checkSyntax(JSON.stringify(woven.map((f) => ({ name: f.path, text: f.text }))))
		) as { unit?: string; stage: string }[]
	).filter((f) => f.stage === 'parse');
	if (syntax.length) {
		const broken = new Set(syntax.map((f) => f.unit ?? '').filter((p) => changed.has(p)));
		return {
			files: broken,
			messages: [...broken].map((p) => `${p} could not be read after the change.`)
		};
	}
	const ours = readModel(tk, library, woven);
	const theirs = readModel(
		tk,
		library,
		lifted.map((text, i) => ({ path: liftedName(i), text }))
	);
	const keysOurs = ownershipKeys(ours.elements);
	const keysTheirs = ownershipKeys(theirs.elements);
	const fileOfKey = new Map<string, string>();
	for (const [root, path] of ours.roots) fileOfKey.set(keysOurs.get(root)!, path);
	for (const [root, path] of theirs.roots)
		fileOfKey.set(keysTheirs.get(root)!, projectPath.get(path) ?? path);
	const project = new Set(woven.map((f) => f.path));
	const difference = compareModels(theirs.elements, ours.elements);
	const out = new Set<string>();
	const messages: string[] = [];
	const report = (key: string, message: string) => {
		const file = fileOfKey.get(key.split('/')[0]!);
		if (!file || !project.has(file)) return;
		out.add(file);
		messages.push(`${file}: ${message} (${keyLabel(key)}).`);
	};
	for (const d of difference.onlyInFirst) report(d.key, `the text doesn’t have ${article(d.type)}`);
	for (const d of difference.onlyInSecond) report(d.key, `the text has another ${words(d.type)}`);
	for (const d of difference.changed)
		report(d.key, `${article(d.type)} reads differently: ${d.properties.join(', ')}`);
	return { files: out, messages };
}

/** A set of files' elements (compact), and which file each root namespace is. */
function readModel(
	tk: Toolkit,
	library: TkLibrary,
	sources: { path: string; text: string }[]
): { elements: ElementJson[]; roots: Map<string, string> } {
	const session = tk.Session.fromSourcesWithPreparedLibrary(
		JSON.stringify(
			[...sources, ...views.missingViewLibraries(sources)].map((f) => ({
				name: f.path,
				text: f.text
			}))
		),
		library
	);
	try {
		const elements = JSON.parse(session.toCompactJson()) as ElementJson[];
		const byId = new Map(elements.map((e) => [e['@id'], e]));
		const unitNames = new Map(
			(JSON.parse(session.units()) as { unit: number; name: string }[]).map((u) => [u.unit, u.name])
		);
		// A file's top-level element: its membership's owner is the file's root namespace.
		const roots = new Map<string, string>();
		for (const top of session.roots()) {
			const site = session.memberExtent(top);
			const id = session.elementId(top);
			top.free();
			const path = site ? unitNames.get((JSON.parse(site) as TkSite).unit) : undefined;
			const membership = byId.get(id) ? ownerOf(byId.get(id)!) : null;
			const root = membership && byId.get(membership) ? ownerOf(byId.get(membership)!) : null;
			if (root && path) roots.set(root, path);
		}
		return { elements, roots };
	} finally {
		session.free();
	}
}

const words = (type: string) => type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const article = (type: string) => `${/^[AEIOU]/.test(type) ? 'an' : 'a'} ${words(type)}`;
