/**
 * Verification results: what a verification case returned when it was run,
 * recorded in the model as metadata on the case (`libraries/
 * VerificationResults.sysml`, SysML's own `VerdictKind`):
 *
 *   verification <'VC-001'> enduranceFlightTest {
 *       …
 *       @VerificationResult {
 *           verdict = VerdictKind::pass;
 *           date = "2026-10-20"; runBy = "A. Engineer";
 *           commit = "3f2a9c1…"; evidence = "https://…";
 *       }
 *   }
 *
 * A result names the commit of the model it was run against. It holds while
 * the model is the same as at that commit (recorded results aside); once
 * the model changes it is out of date. Without a commit to compare (a
 * project not connected to GitHub, or a result that names none), whether it
 * still holds is unknown, and is said so.
 */
import type { Analysis, Span } from '#lib/engine/types.ts';
import { lastSegment, stringValue } from './names';

/** SysML's `VerificationCases::VerdictKind`. */
export type Verdict = 'pass' | 'fail' | 'inconclusive' | 'error';
export const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'inconclusive', 'error'];

export const VERDICT_LABEL: Record<Verdict, string> = {
	pass: 'Passed',
	fail: 'Failed',
	inconclusive: 'Inconclusive',
	error: 'Error'
};

/** The metadata def, the library it is in, and where a project keeps that library. */
export const RESULT_METADATA = 'VerificationResult';
export const RESULTS_PACKAGE = 'VerificationResults';
export const RESULTS_LIBRARY_PATH = 'libraries/VerificationResults.sysml';

export interface RecordedResult {
	/** The verification case's element id (when the model resolved it) and name. */
	caseId: string | null;
	caseName: string;
	/** Null when the value is not one of the verdicts. */
	verdict: Verdict | null;
	date: string | null;
	/** Who ran it (`runBy`: `by` is a SysML keyword). */
	runBy: string | null;
	commit: string | null;
	evidence: string | null;
	file: string;
	span: Span;
}

/**
 * Every verification case's recorded result, by the case's element id (and
 * by its name, for models without ids). A case with several results counts
 * its latest (by date, then the one written last).
 */
export function collectResults(analyses: Iterable<Analysis>): Map<string, RecordedResult> {
	const out = new Map<string, RecordedResult>();
	for (const { model } of analyses) {
		for (const a of model.annotations ?? []) {
			if (lastSegment(a.metadata_type) !== RESULT_METADATA) continue;
			const result: RecordedResult = {
				...readResult(a.values),
				caseId: a.target_id ?? null,
				caseName: lastSegment(a.target),
				file: model.file,
				span: a.span
			};
			for (const key of [result.caseId, result.caseName]) {
				if (!key) continue;
				const known = out.get(key);
				if (!known || (result.date ?? '') >= (known.date ?? '')) out.set(key, result);
			}
		}
	}
	return out;
}

/** A result's fields from the annotation's values as written. */
export function readResult(
	values: readonly [string, string][]
): Pick<RecordedResult, 'verdict' | 'date' | 'runBy' | 'commit' | 'evidence'> {
	const field = (name: string) => {
		const value = values.find(([k]) => k === name)?.[1];
		const text = value === undefined ? '' : stringValue(value).trim();
		return text || null;
	};
	const literal = lastSegment(field('verdict') ?? '');
	return {
		verdict: VERDICTS.includes(literal as Verdict) ? (literal as Verdict) : null,
		date: field('date'),
		runBy: field('runBy'),
		commit: field('commit'),
		evidence: field('evidence')
	};
}

// --- Whether a result still holds -------------------------------------------------------

/** What the project's version is, as results are compared with it. */
export interface RevisionInfo {
	/** The commit the project's files are based on (GitHub), or null when not connected. */
	commit: string | null;
	/** The model changed since that commit (recorded results aside). */
	changed: boolean;
	/**
	 * Whether the model at another commit is the same as at `commit` (recorded
	 * results aside); null while that is being found out, or can't be.
	 */
	sameModel(commit: string): boolean | null;
}

export type Freshness =
	| { state: 'current'; text: string }
	| { state: 'stale'; text: string }
	| { state: 'checking'; text: string }
	| { state: 'unknown'; text: string };

/** A commit as people read it: its first 7 characters. */
export const shortCommit = (commit: string) => commit.slice(0, 7);

/** Whether two spellings of a commit (full or abbreviated) name the same one. */
export function sameCommit(a: string, b: string): boolean {
	const x = a.trim().toLowerCase();
	const y = b.trim().toLowerCase();
	return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x));
}

/** Whether a result still holds for the model as it is. */
export function freshness(result: RecordedResult, revision: RevisionInfo | null): Freshness {
	const commit = result.commit;
	if (!commit)
		return {
			state: 'unknown',
			text: 'Commit unknown: the result doesn’t name the commit it was run against.'
		};
	const at = shortCommit(commit);
	if (!revision?.commit)
		return {
			state: 'unknown',
			text: `Run against ${at}. Commit unknown here: the project isn’t connected to GitHub, so whether the model changed since can’t be told.`
		};
	const now = shortCommit(revision.commit);
	if (sameCommit(commit, revision.commit))
		return revision.changed
			? { state: 'stale', text: `Out of date: the model has changed since ${at} (not saved yet).` }
			: { state: 'current', text: `Run against ${at}, the model as it is.` };
	const same = revision.sameModel(commit);
	if (same === null)
		return {
			state: 'checking',
			text: `Run against ${at}; checking whether the model changed since.`
		};
	if (!same)
		return { state: 'stale', text: `Out of date: the model has changed since ${at} (now ${now}).` };
	return revision.changed
		? { state: 'stale', text: `Out of date: the model has changed since ${at} (not saved yet).` }
		: { state: 'current', text: `Run against ${at}; the model is the same now (${now}).` };
}

/** How a verification case's result reads: `Passed`, `Passed, out of date`, `Not run`. */
export function resultLabel(result: RecordedResult | null, fresh: Freshness | null): string {
	if (!result) return 'Not run';
	const verdict = result.verdict ? VERDICT_LABEL[result.verdict] : 'Unreadable result';
	return fresh?.state === 'stale' ? `${verdict}, out of date` : verdict;
}

/**
 * A requirement's verification, from the results of the cases that verify
 * it: `failed` when one failed (or could not run), `inconclusive`, `not run`
 * when one has no result, `stale` when all passed but one is out of date,
 * `passed` when all passed; null when nothing verifies it.
 */
export type Outcome = 'passed' | 'stale' | 'not run' | 'inconclusive' | 'failed';

export const OUTCOME_LABEL: Record<Outcome, string> = {
	passed: 'Passed',
	stale: 'Passed, out of date',
	'not run': 'Not run',
	inconclusive: 'Inconclusive',
	failed: 'Failed'
};

export function outcomeOf(
	results: readonly (RecordedResult | null)[],
	revision: RevisionInfo | null
): Outcome | null {
	if (!results.length) return null;
	if (results.some((r) => r?.verdict === 'fail' || r?.verdict === 'error')) return 'failed';
	if (results.some((r) => r?.verdict === 'inconclusive' || (r && !r.verdict)))
		return 'inconclusive';
	if (results.some((r) => !r)) return 'not run';
	if (results.some((r) => freshness(r!, revision).state === 'stale')) return 'stale';
	return 'passed';
}

// --- Comparing versions of the model, recorded results aside -----------------------------

/**
 * A model file's text without its recorded results (and the imports of their
 * library), whitespace collapsed: two versions that differ only in results
 * read the same.
 */
export function withoutResults(text: string): string {
	let out = '';
	let at = 0;
	const pattern = new RegExp(String.raw`@\s*(?:\w+\s*::\s*)*${RESULT_METADATA}\b`, 'g');
	for (const match of text.matchAll(pattern)) {
		if (match.index! < at) continue;
		out += text.slice(at, match.index!);
		at = endOfAnnotation(text, match.index! + match[0].length);
	}
	out += text.slice(at);
	return out
		.replace(
			new RegExp(String.raw`(?:private\s+|public\s+)?import\s+${RESULTS_PACKAGE}\s*::[^;]*;`, 'g'),
			''
		)
		.replace(/\{\s*\}/g, ';')
		.replace(/\s+/g, ' ')
		.replace(/ ;/g, ';')
		.trim();
}

/** Where an annotation's body (`{ … }`, strings and comments skipped) or `;` ends. */
function endOfAnnotation(text: string, from: number): number {
	let i = from;
	while (i < text.length && /\s/.test(text[i]!)) i++;
	if (text[i] === ';') return i + 1;
	if (text[i] !== '{') return from;
	let depth = 0;
	for (; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"') {
			for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		} else if (c === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end;
		} else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return i + 1;
	}
	return text.length;
}

/** Files that make up the model, for comparing versions (the results library is not the model). */
export function isComparedFile(path: string): boolean {
	return /\.(sysml|kerml)$/.test(path) && !path.endsWith(`${RESULTS_PACKAGE}.sysml`);
}

/** Whether two versions of the project's files are the same model, recorded results aside. */
export function sameModel(
	a: Record<string, string | undefined>,
	b: Record<string, string | undefined>
): boolean {
	const paths = new Set([...Object.keys(a), ...Object.keys(b)].filter(isComparedFile));
	for (const path of paths) {
		const x = a[path];
		const y = b[path];
		if (x === y) continue;
		if (x === undefined || y === undefined) return false;
		if (withoutResults(x) !== withoutResults(y)) return false;
	}
	return true;
}
