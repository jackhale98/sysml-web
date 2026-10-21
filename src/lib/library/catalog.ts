/**
 * The standard library as the app browses it: a list of files and a search
 * index of their declarations, built from the library text the toolkit
 * bundles (`static/toolkit/stdlib/sysml-library.json.gz`). Pure, so it runs
 * in the library worker and in unit tests alike.
 */
import type { LibraryEntry, LibraryHit } from '#lib/engine/types.ts';
import { declaredPackage, scanDeclarations, type Declaration } from './declarations.ts';

/** One unit of the toolkit's library bundle. */
export interface BundleFile {
	name: string;
	text: string;
}

/** The toolkit's own packages, loaded after the OMG library; not part of the standard. */
const TOOLKIT_UNITS = 'local-packages/';
/** Whether a bundle path is a file of the OMG standard library (listed and searched). */
export const isStandardFile = (path: string) => !path.startsWith(TOOLKIT_UNITS);

interface Item extends LibraryHit {
	/** Lower-case name, short name and qualified name, for matching. */
	lower: string;
	short?: string;
	lowerQualified: string;
}

export interface Catalog {
	entries: LibraryEntry[];
	/** Every unit's text by path, the toolkit's own included (for navigation). */
	texts: Map<string, string>;
	items: Item[];
}

const utf8 = new TextEncoder();

/** Index the bundle: files in path order, and every named declaration. */
export function buildCatalog(bundle: readonly BundleFile[]): Catalog {
	const texts = new Map<string, string>();
	const entries: LibraryEntry[] = [];
	const items: Item[] = [];
	for (const file of [...bundle].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
		texts.set(file.name, file.text);
		if (!isStandardFile(file.name)) continue;
		const declarations = scanDeclarations(file.text);
		entries.push({
			path: file.name,
			package: declaredPackage(declarations),
			kind: file.name.endsWith('.kerml') ? 'kerml' : 'sysml',
			size: utf8.encode(file.text).length
		});
		for (const d of declarations) items.push(item(d, file.name));
	}
	return { entries, texts, items };
}

function item(d: Declaration, path: string): Item {
	const hit: Item = {
		name: d.name,
		qualifiedName: d.qualifiedName,
		kind: d.kind,
		isDefinition: d.isDefinition,
		path,
		line: d.line,
		lower: d.name.toLowerCase(),
		lowerQualified: d.qualifiedName.toLowerCase()
	};
	if (d.doc) hit.doc = d.doc;
	if (d.shortName) hit.short = d.shortName.toLowerCase();
	return hit;
}

/** Whether `query` (lower case) starts a word inside `name` (`Power` in `SoundPowerLevel`). */
function startsWord(name: string, lowerName: string, query: string): boolean {
	for (let i = lowerName.indexOf(query); i >= 0; i = lowerName.indexOf(query, i + 1)) {
		if (i === 0) return true;
		const before = name[i - 1]!;
		if (!/[A-Za-z0-9]/.test(before)) return true;
		if (/[A-Z]/.test(name[i]!) && !/[A-Z]/.test(before)) return true;
	}
	return false;
}

/**
 * How well an item matches: 0 exact (same case), 1 exact ignoring case or
 * its short name, 2 prefix, 3 the start of a word inside the name, 4
 * anywhere in it; null for no match. A query with `::` matches qualified
 * names: exact, then a whole trailing part or a prefix, then anywhere.
 */
function matchRank(item: Item, query: string, lower: string): number | null {
	if (lower.includes('::')) {
		const name = item.lowerQualified;
		const plain = name.replace(/'/g, '');
		if (name === lower || plain === lower) return 0;
		if (name.endsWith(`::${lower}`) || plain.endsWith(`::${lower}`)) return 1;
		if (name.startsWith(lower) || plain.startsWith(lower)) return 2;
		return name.includes(lower) || plain.includes(lower) ? 4 : null;
	}
	if (item.name === query) return 0;
	if (item.lower === lower || item.short === lower) return 1;
	if (item.lower.startsWith(lower)) return 2;
	if (!item.lower.includes(lower)) return null;
	return startsWord(item.name, item.lower, lower) ? 3 : 4;
}

/**
 * Search the library's definitions and usages by name. Exact names come
 * first, then names that start with the query, then names with a word that
 * does, then the rest; within each, definitions before usages, then shorter
 * names. At most `limit` hits.
 */
export function searchCatalog(catalog: Catalog, query: string, limit: number): LibraryHit[] {
	const q = query.trim();
	if (!q || limit <= 0) return [];
	const lower = q.toLowerCase();
	const ranked: { rank: number; item: Item }[] = [];
	for (const item of catalog.items) {
		const rank = matchRank(item, q, lower);
		if (rank !== null) ranked.push({ rank, item });
	}
	ranked.sort(
		(a, b) =>
			a.rank - b.rank ||
			Number(b.item.isDefinition) - Number(a.item.isDefinition) ||
			a.item.name.length - b.item.name.length ||
			compare(a.item.name, b.item.name) ||
			compare(a.item.qualifiedName, b.item.qualifiedName)
	);
	return ranked.slice(0, limit).map(({ item }) => hit(item));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function hit(item: Item): LibraryHit {
	const { name, qualifiedName, kind, isDefinition, path, line, doc } = item;
	return doc
		? { name, qualifiedName, kind, isDefinition, path, line, doc }
		: { name, qualifiedName, kind, isDefinition, path, line };
}
