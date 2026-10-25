/**
 * Inputs of the conformance runner (`run.conformance.ts`): where the corpora
 * are, how their files group into projects, and the Xpect expectations of the
 * OMG pilot implementation's own test suites, read as data.
 *
 * Corpora (fetched by `scripts/fetch-conformance.sh`, not vendored):
 * - the OMG SysML v2 Release (examples, training, validation, KerML
 *   examples), at the release the toolkit's standard library comes from;
 * - the pilot implementation's Xpect suites (`*.xt`): models with declared
 *   expectations (`errors`, `noErrors`, `linkedName`) next to them;
 * - optionally, OpenSysML's negative corpus (models that must be rejected),
 *   with the pilot's recorded verdicts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { SourceFile } from '#lib/engine/protocol.ts';

export const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(ROOT, '.cache/conformance');

/** The corpora's directories, from the environment or `.cache/conformance/`. */
export const paths = {
	release: process.env.CONFORMANCE_RELEASE ?? join(CACHE, 'sysml-v2-release'),
	pilot: process.env.CONFORMANCE_PILOT ?? join(CACHE, 'sysml-v2-pilot'),
	negative: process.env.CONFORMANCE_NEGATIVE ?? join(CACHE, 'opensysml'),
	out: process.env.CONFORMANCE_OUT ?? join(CACHE, 'out')
};

/** `git rev-parse HEAD` of a checkout, or null. */
export function revision(dir: string): string | null {
	try {
		return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

/** Every `.sysml` / `.kerml` file under `dir`, sorted, with paths relative to `base`. */
export function modelFiles(dir: string, base = dir, extension = /\.(sysml|kerml)$/): SourceFile[] {
	const out: SourceFile[] = [];
	const walk = (at: string) => {
		for (const name of readdirSync(at).sort()) {
			const path = join(at, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (extension.test(name))
				out.push({ path: relative(base, path), text: readFileSync(path, 'utf8') });
		}
	};
	if (existsSync(dir)) walk(dir);
	return out;
}

/** The release corpus's suites: folder → files (paths relative to the release root). */
export const RELEASE_SUITES = [
	'sysml/src/examples',
	'sysml/src/training',
	'sysml/src/validation',
	'kerml/src/examples'
];

export interface CorpusProject {
	/** `sysml/src/examples/Vehicle Example`: a folder of the corpus, opened as one project. */
	name: string;
	suite: string;
	files: SourceFile[];
}

/** The release corpus as projects: each folder directly under a suite is one project. */
export function releaseProjects(release = paths.release): CorpusProject[] {
	const projects: CorpusProject[] = [];
	for (const suite of RELEASE_SUITES) {
		const dir = join(release, suite);
		if (!existsSync(dir)) continue;
		const byFolder = new Map<string, SourceFile[]>();
		for (const file of modelFiles(dir, release)) {
			const inSuite = relative(suite, file.path);
			const folder = inSuite.includes('/') ? inSuite.slice(0, inSuite.indexOf('/')) : '';
			const name = folder ? `${suite}/${folder}` : suite;
			byFolder.set(name, [...(byFolder.get(name) ?? []), file]);
		}
		for (const [name, files] of byFolder) projects.push({ name, suite, files });
	}
	return projects;
}

// ---- Xpect (the pilot implementation's declared expectations) ----

export type XpectKind = 'errors' | 'warnings' | 'noErrors' | 'linkedName' | 'scope' | string;

/** One `XPECT` assertion: what it expects and where (`at` text found after the comment). */
export interface XpectAssertion {
	kind: XpectKind;
	/** 1-based line of the comment. */
	line: number;
	/** For `errors`/`warnings`: the messages, each with where it is expected. */
	items: { message: string; at: string | null; from: number; to: number }[];
	/** For `linkedName`: the reference text and the qualified name it must resolve to (`::`). */
	reference?: { at: string; from: number; to: number; target: string };
}

export interface XpectCase {
	/** Path of the `.xt` file, relative to the pilot checkout. */
	path: string;
	/** `org.omg.sysml.xpect.tests/…/validation/invalid`: the suite folder. */
	suite: string;
	/** The test model as a project file (`.xt` dropped from its name). */
	file: SourceFile;
	/** Other project files the setup names (not the standard library, which every session has). */
	setup: SourceFile[];
	assertions: XpectAssertion[];
}

/** The `*.xt` files of the pilot's Xpect suites. */
export function xpectCases(pilot = paths.pilot): XpectCase[] {
	const cases: XpectCase[] = [];
	for (const project of ['org.omg.kerml.xpect.tests', 'org.omg.sysml.xpect.tests']) {
		const root = join(pilot, project);
		for (const xt of modelFiles(join(root, 'src'), pilot, /\.xt$/)) {
			const name = basename(xt.path).replace(/\.xt$/, '');
			if (!/\.(sysml|kerml)$/.test(name)) continue;
			const setup: SourceFile[] = [];
			for (const m of xt.text.matchAll(/File\s*\{\s*from\s*=\s*"([^"]+)"\s*\}/g)) {
				const from = m[1]!;
				if (/^\/library/.test(from)) continue;
				const path = from.startsWith('/') ? join(root, from) : join(pilot, dirname(xt.path), from);
				const key = relative(pilot, path);
				if (setup.some((s) => s.path === key) || !existsSync(path)) continue;
				setup.push({ path: key, text: readFileSync(path, 'utf8') });
			}
			cases.push({
				path: xt.path,
				suite: dirname(xt.path).replace(/\/src\/org\/omg\/(kerml|sysml)\/xpect\/tests/, ''),
				file: { path: join(dirname(xt.path), name), text: xt.text },
				setup,
				assertions: parseXpect(xt.text)
			});
		}
	}
	return cases;
}

/**
 * The assertions of an Xpect test. Two forms:
 * `// XPECT errors --> "message" at "text"` and
 * `//* XPECT errors --- "m1" at "t1" "m2" at "t2" --- *\/`. An `at` names the
 * first occurrence of its text after the comment; without one, the
 * assertion is about the next line.
 */
export function parseXpect(text: string): XpectAssertion[] {
	const out: XpectAssertion[] = [];
	const comments = commentRanges(text);
	const inComment = (offset: number) => comments.some(([a, b]) => offset >= a && offset < b);
	const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
	const re = /XPECT(?!_SETUP)\s+(\w+)/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const kind = m[1]!;
		const start = m.index;
		const lineEnd = text.indexOf('\n', start);
		const head = text.slice(start, lineEnd < 0 ? text.length : lineEnd);
		let body: string;
		let after: number;
		if (/---\s*$/.test(head)) {
			// Block form: up to the closing `--- */`.
			const close = text.indexOf('---', start + head.length);
			body = text.slice(start + m[0].length, close < 0 ? text.length : close);
			const commentEnd = text.indexOf('*/', close < 0 ? start : close);
			after = commentEnd < 0 ? text.length : commentEnd + 2;
		} else {
			body = head.slice(m[0].length);
			after = lineEnd < 0 ? text.length : lineEnd + 1;
		}
		const locate = (at: string | null): { from: number; to: number } => {
			if (at) {
				// The first occurrence outside a comment (other assertions repeat the text).
				for (let from = text.indexOf(at, after); from >= 0; from = text.indexOf(at, from + 1))
					if (!inComment(from)) return { from, to: from + at.length };
			}
			// The next line that isn't blank or a comment.
			let at2 = after;
			for (;;) {
				const end = text.indexOf('\n', at2);
				const line = text.slice(at2, end < 0 ? text.length : end).trim();
				if (end < 0 || (line && !line.startsWith('//') && !line.startsWith('/*'))) {
					return { from: at2, to: end < 0 ? text.length : end };
				}
				at2 = end + 1;
			}
		};
		const assertion: XpectAssertion = { kind, line: lineOf(start), items: [] };
		if (kind === 'errors' || kind === 'warnings') {
			for (const item of body.matchAll(/"((?:[^"\\]|\\.)*)"(?:\s+at\s+"((?:[^"\\]|\\.)*)")?/g)) {
				const at = item[2] ?? null;
				assertion.items.push({ message: item[1]!, at, ...locate(at) });
			}
		} else if (kind === 'linkedName') {
			const link = /at\s+(.+?)\s*-->\s*(\S+)/.exec(body);
			if (link) {
				const at = link[1]!.trim();
				assertion.reference = { at, ...locate(at), target: link[2]!.replace(/\./g, '::') };
			}
		}
		out.push(assertion);
	}
	return out;
}

// ---- OpenSysML's negative corpus (optional) ----

export interface NegativeCase {
	/** `semantic/cn01-fork-two-incoming.sysml`. */
	path: string;
	category: string;
	file: SourceFile;
	/** The rule the file breaks, from its first comment line. */
	rule: string;
	/** Whether the OMG pilot rejected it, as OpenSysML recorded (null when not recorded). */
	pilotRejects: boolean | null;
}

export function negativeCases(dir = paths.negative): NegativeCase[] {
	const corpus = join(dir, 'tools/referee/reject/testdata/negative');
	if (!existsSync(corpus)) return [];
	const baseline = join(dir, 'docs/project/pilot-rejection-baseline.json');
	const pilot = new Map<string, boolean>();
	if (existsSync(baseline)) {
		const record = JSON.parse(readFileSync(baseline, 'utf8')) as {
			cases: { path: string; pilotErrors: number }[];
		};
		for (const c of record.cases) pilot.set(c.path, c.pilotErrors > 0);
	}
	return modelFiles(corpus).map((file) => ({
		path: file.path,
		category: file.path.split('/')[0]!,
		file,
		rule: (/^\s*\/\/\s*(.*)$/m.exec(file.text)?.[1] ?? '').trim(),
		pilotRejects: pilot.get(file.path) ?? null
	}));
}

/** `[from, to)` of each comment or note in a SysML/KerML text (strings and quoted names skipped). */
function commentRanges(text: string): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") {
			for (i++; i < text.length && text[i] !== c && text[i] !== '\n'; i++)
				if (text[i] === '\\') i++;
		} else if (c === '/' && text[i + 1] === '/' && text[i + 2] !== '*') {
			const end = text.indexOf('\n', i);
			out.push([i, end < 0 ? text.length : end]);
			i = end < 0 ? text.length : end;
		} else if (c === '/' && (text[i + 1] === '*' || text.startsWith('//*', i))) {
			// `/* … */`, and the multi-line note `//* … */`.
			const end = text.indexOf('*/', i + 3);
			out.push([i, end < 0 ? text.length : end + 2]);
			i = end < 0 ? text.length : end + 1;
		}
	}
	return out;
}
