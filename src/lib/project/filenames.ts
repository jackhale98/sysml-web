/**
 * Paths of the files people make, rename and move: a folder and a name,
 * checked so they are safe on every disk and git host, and the text a new
 * model file starts with. Plain functions, so they are easy to test.
 */
import { packageName } from './sources.ts';

/** The folder of a path ('' at the top level). */
export function folderOf(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** The file name of a path. */
export function nameOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** The name without `.sysml` / `.kerml`. */
export function stemOf(name: string): string {
	return name.replace(/\.(sysml|kerml)$/i, '');
}

/** Every folder that holds a file, parents included, sorted. */
export function foldersOf(paths: readonly string[]): string[] {
	const folders = new Set<string>();
	for (const path of paths) {
		const parts = path.split('/').slice(0, -1);
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
	}
	return [...folders].sort((a, b) => a.localeCompare(b));
}

/** `Power` → `Power.sysml`; a name that ends in `.sysml` or `.kerml` stays. */
export function withExtension(name: string): string {
	return /\.(sysml|kerml)$/i.test(name) ? name : `${name}.sysml`;
}

/** Names Windows keeps for devices; a file can't have one, with any extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
/** Letters, digits, spaces, `-`, `_` and `.`; starting with a letter, digit or `_`. */
const SAFE = /^[\p{L}\p{N}_][\p{L}\p{N}_. -]*$/u;

/** Why one part of a path (a folder or the file name) won't do, or null when it is fine. */
function partProblem(part: string, what: 'name' | 'folder'): string | null {
	const label = what === 'name' ? 'The name' : 'A folder name';
	if (!part) return what === 'name' ? 'Give the file a name.' : 'A folder name is empty.';
	if (part.length > 120) return `${label} is too long.`;
	if (part.startsWith('.')) return `${label} can't start with a dot.`;
	if (!SAFE.test(part))
		return `${label} can only have letters, digits, spaces, - and _ (not ${JSON.stringify(
			[...part].find((c) => !/[\p{L}\p{N}_. -]/u.test(c)) ?? part[0]
		)}).`;
	if (/[. ]$/.test(part)) return `${label} can't end with a dot or a space.`;
	if (RESERVED.test(part)) return `${label} “${part}” is kept for devices on Windows.`;
	return null;
}

export type PathCheck = { path: string; error: null } | { path: string | null; error: string };

/**
 * The path a file in `folder` named `name` gets (`.sysml` added when left
 * off), or why it can't have it: unsafe characters, or a clash with a file
 * of the project (`existing`; `except` is the file being renamed). Names
 * that differ only in case clash: most disks treat them as the same file.
 */
export function checkFilePath(
	folder: string,
	name: string,
	existing: readonly string[],
	except?: string
): PathCheck {
	const cleanFolder = folder
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '');
	const trimmed = name.trim();
	if (trimmed.includes('/') || trimmed.includes('\\'))
		return { path: null, error: 'Choose the folder separately; the name has no / in it.' };
	const nameProblem = partProblem(trimmed, 'name');
	if (nameProblem) return { path: null, error: nameProblem };
	const folders = cleanFolder ? cleanFolder.split('/').map((p) => p.trim()) : [];
	for (const part of folders) {
		const problem = partProblem(part, 'folder');
		if (problem) return { path: null, error: problem };
	}
	const path = [...folders, withExtension(trimmed)].join('/');
	const lower = path.toLowerCase();
	const others = existing.filter((p) => p !== except);
	const clash = others.find((p) => p.toLowerCase() === lower);
	if (clash)
		return {
			path,
			error:
				clash === path
					? `There is a file ${path} already.`
					: `There is a file ${clash} already (names that differ only in capitals clash).`
		};
	// A folder can't have the name of a file, nor a file the name of a folder.
	const asFile = folders
		.map((_, i) =>
			folders
				.slice(0, i + 1)
				.join('/')
				.toLowerCase()
		)
		.find((f) => others.some((p) => p.toLowerCase() === f));
	if (asFile) return { path, error: `${asFile} is a file, not a folder.` };
	if (others.some((p) => p.toLowerCase().startsWith(`${lower}/`)))
		return { path, error: `${path} is a folder already.` };
	return { path, error: null };
}

/**
 * What a new model file starts with: an empty package named after the
 * file (`power-supply.sysml` → `package PowerSupply`), so it is valid at
 * once. A name a top-level element has already gets a number.
 */
export function newFileText(path: string, taken: readonly string[] = []): string {
	const base = packageName(stemOf(nameOf(path)));
	const used = new Set(taken);
	let name = base;
	for (let n = 2; used.has(name); n++)
		name = base.startsWith("'") ? `${base.slice(0, -1)} ${n}'` : `${base}${n}`;
	return `package ${name} {\n}\n`;
}
