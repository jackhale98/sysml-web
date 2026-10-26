/**
 * Project interchange files (`.kpar`, KerML 1.0 clause 10.3): a ZIP archive
 * holding a project's model files plus, at its top level, `.project.json`
 * (the `InterchangeProject`, Table 12) and `.meta.json` (Table 13: an index
 * of top-level names, the creation time and per-file checksums).
 *
 * Written to match what `sysml-interchange` (our Rust engine) reads and
 * writes: entries stored uncompressed in path order with fixed timestamps,
 * SHA256 checksums as single objects (the form the OMG library archives
 * use), list-form checksums read too, and unknown JSON fields kept.
 */
import type { ProjectArchive } from '#lib/engine/types.ts';
import { unzip, zip } from '#lib/dataio/zip.ts';
import { missingViewLibraries } from '#lib/engine/toolkit/views/libraries.ts';
import { topLevelNames } from '#lib/library/declarations.ts';

export const PROJECT_FILE = '.project.json';
export const META_FILE = '.meta.json';
/** The checksum algorithm written; the one OMG uses for the standard libraries. */
export const SHA256 = 'SHA256';

/** `.project.json`. Unknown fields are kept as they are. */
export interface ProjectInfo {
	name: string;
	description?: string;
	/** Mandatory per Table 12; optional here so incomplete archives still load. */
	version?: string;
	license?: string;
	maintainer?: string[];
	website?: string;
	topic?: string[];
	usage?: ProjectUsage[];
	[field: string]: unknown;
}

/** A project this one uses (`InterchangeProjectUsage`). */
export interface ProjectUsage {
	/** IRI of the used project, ideally resolving to its `.kpar`. */
	resource: string;
	versionConstraint?: string;
	[field: string]: unknown;
}

export interface Checksum {
	value: string;
	algorithm: string;
}

/** `.meta.json`. Unknown fields are kept as they are. */
export interface ProjectMeta {
	/** Top-level element name (and short name) → path of the file declaring it. */
	index: Record<string, string>;
	/** Creation time, ISO 8601. */
	created: string;
	metamodel?: string;
	includesDerived?: boolean;
	includesImplied?: boolean;
	/** Path → checksum: one object (as OMG writes it) or a list (as clause 10.3 reads). */
	checksum?: Record<string, Checksum | Checksum[]>;
	[field: string]: unknown;
}

/** An archive in memory. `files` holds the model files, by archive path. */
export interface Kpar {
	info: ProjectInfo;
	meta: ProjectMeta;
	files: Map<string, Uint8Array>;
}

/** A recorded checksum that does not hold. */
export type ChecksumProblem =
	| { type: 'mismatch'; path: string }
	| { type: 'missing'; path: string }
	| { type: 'unsupported'; path: string; algorithm: string };

const NOT_A_ZIP = 'a .kpar file is one';

/** Most an archive may unpack to: far more than any model's text, far less than a ZIP bomb's. */
export const MAX_UNPACKED = 256_000_000;

/**
 * An entry's path as a project path: forward slashes, no leading `./`. Null
 * for a path that would leave the project: absolute, with a drive letter
 * (`C:`), or with a `..` segment.
 */
export function projectPath(entry: string): string | null {
	const path = entry.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
	if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
	if (path.split('/').some((segment) => segment === '..')) return null;
	return path;
}

/** The archive's entries under project paths, with what was left out or doubtful in plain words. */
async function entriesOf(bytes: Uint8Array): Promise<{
	entries: { path: string; data: Uint8Array }[];
	warnings: string[];
	damaged: string[];
}> {
	const warnings: string[] = [];
	const outside: string[] = [];
	const damaged: string[] = [];
	const entries: { path: string; data: Uint8Array }[] = [];
	for (const entry of await unzip(bytes, NOT_A_ZIP, { maxTotal: MAX_UNPACKED })) {
		const path = projectPath(entry.path);
		if (path === null) {
			outside.push(entry.path);
			continue;
		}
		if (entry.damaged) damaged.push(path);
		entries.push({ path, data: entry.data });
	}
	if (outside.length)
		warnings.push(
			`Left out ${outside.length === 1 ? 'a file whose path leads' : `${outside.length} files whose paths lead`} outside the project: ${outside.join(', ')}.`
		);
	return { entries, warnings, damaged };
}

const damagedWarning = (path: string) =>
	`${path} is damaged in the archive (its data fails the ZIP file’s own check): read it through before relying on it.`;

/**
 * Read a project interchange file; throws when `.project.json` or
 * `.meta.json` is missing or invalid, or an entry is outside the project or
 * damaged.
 */
export async function readKpar(bytes: Uint8Array): Promise<Kpar> {
	let info: ProjectInfo | undefined;
	let meta: ProjectMeta | undefined;
	const files = new Map<string, Uint8Array>();
	const { entries, warnings, damaged } = await entriesOf(bytes);
	warnings.push(...damaged.map(damagedWarning));
	if (warnings.length) throw new Error(warnings.join(' '));
	for (const { path, data } of entries) {
		if (path === PROJECT_FILE) info = projectInfo(parseJson(PROJECT_FILE, data));
		else if (path === META_FILE) meta = projectMeta(parseJson(META_FILE, data));
		else files.set(path, data);
	}
	if (!info) throw new Error(`The archive has no top-level ${PROJECT_FILE}.`);
	if (!meta) throw new Error(`The archive has no top-level ${META_FILE}.`);
	return { info, meta, files: sorted(files) };
}

/**
 * Read any ZIP of a project: a `.kpar`, or a plain archive such as a
 * repository download. Entries whose paths leave the project are left out
 * (`warnings` says so); `damaged` lists the files failing the ZIP's CRC. One top-level folder shared by every entry (as in
 * `repo-main/…`) is left out of the paths. Without `.project.json` the
 * project is named after that folder (or `fallbackName`); without
 * `.meta.json` nothing is checked. Unreadable metadata becomes a warning.
 */
export async function readArchiveLeniently(
	bytes: Uint8Array,
	fallbackName: string
): Promise<{ kpar: Kpar; warnings: string[]; damaged: string[] }> {
	const { entries, warnings, damaged } = await entriesOf(bytes);
	const root = commonRoot(entries.map((e) => e.path));
	const twice = new Set<string>();
	let info: ProjectInfo | undefined;
	let meta: ProjectMeta | undefined;
	const files = new Map<string, Uint8Array>();
	for (const entry of entries) {
		const path = root ? entry.path.slice(root.length) : entry.path;
		try {
			if (path === PROJECT_FILE) info = projectInfo(parseJson(PROJECT_FILE, entry.data));
			else if (path === META_FILE) meta = projectMeta(parseJson(META_FILE, entry.data));
			else {
				if (files.has(path)) twice.add(path);
				files.set(path, entry.data);
			}
		} catch (error) {
			warnings.push(`${error instanceof Error ? error.message : String(error)} It was left out.`);
		}
	}
	for (const path of twice)
		warnings.push(
			`The archive holds ${path} more than once: the last copy was kept, the others left out.`
		);
	const name = root ? root.slice(0, -1) : fallbackName;
	return {
		kpar: {
			info: info ?? { name },
			meta: meta ?? { index: {}, created: '' },
			files: sorted(files)
		},
		warnings,
		damaged: damaged.map((path) => (root && path.startsWith(root) ? path.slice(root.length) : path))
	};
}

/**
 * Write the archive: `.project.json`, `.meta.json`, then the files in path
 * order, stored uncompressed with fixed times, so equal projects give
 * identical bytes.
 */
export async function writeKparArchive(kpar: Kpar): Promise<Uint8Array> {
	return zip(
		[
			{ path: PROJECT_FILE, data: JSON.stringify(ordered(kpar.info, INFO_FIELDS)) },
			{ path: META_FILE, data: JSON.stringify(serializeMeta(kpar.meta)) },
			...[...sorted(kpar.files)].map(([path, data]) => ({ path, data }))
		],
		{ store: true }
	);
}

/** Record a SHA256 checksum for every model file. */
export async function computeChecksums(kpar: Kpar): Promise<void> {
	const checksum: Record<string, Checksum> = {};
	for (const [path, data] of kpar.files) {
		checksum[path] = { value: await sha256(data), algorithm: SHA256 };
	}
	kpar.meta.checksum = checksum;
}

/** Check the recorded checksums against the files. */
export async function verifyChecksums(kpar: Kpar): Promise<ChecksumProblem[]> {
	const problems: ChecksumProblem[] = [];
	for (const [path, recorded] of Object.entries(kpar.meta.checksum ?? {})) {
		const data = kpar.files.get(path);
		if (!data) {
			problems.push({ type: 'missing', path });
			continue;
		}
		for (const checksum of Array.isArray(recorded) ? recorded : [recorded]) {
			const algorithm = checksum.algorithm.toUpperCase();
			if (algorithm === 'SHA256' || algorithm === 'SHA-256') {
				if (checksum.value.toLowerCase() !== (await sha256(data))) {
					problems.push({ type: 'mismatch', path });
				}
			} else {
				problems.push({ type: 'unsupported', path, algorithm: checksum.algorithm });
			}
		}
	}
	return problems;
}

/** A checksum problem in plain words. */
export function describeProblem(problem: ChecksumProblem): string {
	switch (problem.type) {
		case 'mismatch':
			return `${problem.path} has changed since the archive was made (its checksum does not match).`;
		case 'missing':
			return `${problem.path} is listed in ${META_FILE} but is not in the archive.`;
		case 'unsupported':
			return `${problem.path} was not checked: its checksum uses ${problem.algorithm}, which this app cannot compute.`;
	}
}

/**
 * Read a `.kpar` or a plain ZIP of a project as text files. Files that are
 * not UTF-8 text (images, binaries) are listed in `skipped`; checksum
 * problems and unreadable metadata in `warnings`.
 */
export async function readProjectArchive(
	bytes: Uint8Array,
	fallbackName: string
): Promise<ProjectArchive> {
	const { kpar, warnings, damaged } = await readArchiveLeniently(bytes, fallbackName);
	const problems = await verifyChecksums(kpar);
	warnings.push(...problems.map(describeProblem));
	// A file whose recorded checksum already failed is said once.
	const mismatched = new Set(problems.map((p) => p.path));
	warnings.push(...damaged.filter((p) => !mismatched.has(p)).map(damagedWarning));
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const files: ProjectArchive['files'] = [];
	const skipped: string[] = [];
	for (const [path, data] of kpar.files) {
		try {
			files.push({ path, text: decoder.decode(data) });
		} catch {
			skipped.push(path);
		}
	}
	return { info: kpar.info, files, skipped, warnings };
}

/**
 * The bundled view libraries (`ModelViews`, `Reporting`) the files use
 * without holding them, and what those use in turn. The app resolves them
 * from its own copies; anywhere else they must come with the project.
 */
export function bundledLibrariesUsed(
	files: readonly { path: string; text: string }[]
): { path: string; text: string; package: string }[] {
	const missing = missingViewLibraries(files).map((lib) => ({
		...lib,
		package: /package\s+(\w+)/.exec(lib.text)?.[1] ?? lib.path
	}));
	const uses = (text: string, pkg: string) => new RegExp(`(^|[^\\w'])${pkg}::`).test(text);
	const needed: typeof missing = [];
	let texts = files.map((f) => f.text);
	for (let grew = true; grew;) {
		grew = false;
		for (const lib of missing) {
			if (needed.includes(lib) || !texts.some((t) => uses(t, lib.package))) continue;
			needed.push(lib);
			texts = [...texts, lib.text];
			grew = true;
		}
	}
	return needed;
}

/**
 * The project as a `.kpar`: `info` becomes `.project.json`, and
 * `.meta.json` gets an index of each `.sysml`/`.kerml` file's top-level
 * names (the first file declaring a name wins), `created` (ISO 8601) and a
 * SHA256 checksum per file. The bundled view libraries the project uses
 * without holding them are written in too (`bundledLibrariesUsed`), so the
 * archive is complete without this app.
 */
export async function writeKpar(
	info: object,
	files: readonly { path: string; text: string }[],
	created: string
): Promise<Uint8Array> {
	const project = projectInfo(info);
	const meta: ProjectMeta = { index: {}, created };
	const stored = new Map<string, Uint8Array>();
	const encoder = new TextEncoder();
	for (const file of [...files, ...bundledLibrariesUsed(files)]) {
		if (file.path === PROJECT_FILE || file.path === META_FILE) continue;
		if (/\.(sysml|kerml)$/.test(file.path)) {
			for (const name of topLevelNames(file.text)) meta.index[name] ??= file.path;
		}
		stored.set(file.path, encoder.encode(file.text));
	}
	const kpar: Kpar = { info: project, meta, files: sorted(stored) };
	await computeChecksums(kpar);
	return writeKparArchive(kpar);
}

// --- helpers -----------------------------------------------------------------

/** The single top-level folder (`name/`) every path starts with, if any. */
function commonRoot(paths: string[]): string | undefined {
	const first = paths[0];
	const slash = first?.indexOf('/') ?? -1;
	if (!first || slash < 0) return undefined;
	const prefix = first.slice(0, slash + 1);
	return paths.every((p) => p.startsWith(prefix)) ? prefix : undefined;
}

function parseJson(file: string, data: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder().decode(data)) as unknown;
	} catch (error) {
		throw new Error(`${file} is not valid JSON (${(error as Error).message}).`, { cause: error });
	}
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function projectInfo(value: unknown): ProjectInfo {
	if (!isObject(value) || typeof value.name !== 'string') {
		throw new Error(`${PROJECT_FILE} has no project name.`);
	}
	return value as ProjectInfo;
}

function projectMeta(value: unknown): ProjectMeta {
	if (!isObject(value) || !isObject(value.index) || typeof value.created !== 'string') {
		throw new Error(`${META_FILE} needs an index and a creation time.`);
	}
	return value as ProjectMeta;
}

function sorted<T>(map: Map<string, T>): Map<string, T> {
	return new Map([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Known fields in their documented order (empty ones left out), then the rest by name. */
const INFO_FIELDS = [
	'name',
	'description',
	'version',
	'license',
	'maintainer',
	'website',
	'topic',
	'usage'
];
const META_FIELDS = [
	'index',
	'created',
	'metamodel',
	'includesDerived',
	'includesImplied',
	'checksum'
];

function ordered(object: Record<string, unknown>, fields: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of fields) {
		const value = object[field];
		if (value === undefined || value === null) continue;
		if (Array.isArray(value) && !value.length && field !== 'index') continue;
		out[field] = value;
	}
	for (const field of Object.keys(object).sort()) {
		if (!fields.includes(field) && object[field] !== undefined) out[field] = object[field];
	}
	return out;
}

function serializeMeta(meta: ProjectMeta): Record<string, unknown> {
	const byPath = <T>(record: Record<string, T>) =>
		Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	const out = ordered({ ...meta, index: byPath(meta.index) }, META_FIELDS);
	if (meta.checksum && Object.keys(meta.checksum).length) out.checksum = byPath(meta.checksum);
	else delete out.checksum;
	return out;
}

async function sha256(data: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
	let hex = '';
	for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
	return hex;
}
