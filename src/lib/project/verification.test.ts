import { describe, expect, it } from 'vitest';
import { coverageRule, passedRule } from './coverage';
import {
	freshness,
	outcomeOf,
	readResult,
	sameModel,
	withoutResults,
	type RecordedResult,
	type RevisionInfo
} from './verification';

const SPAN = { start_row: 1, start_col: 1, end_row: 1, end_col: 1, start_byte: 0, end_byte: 0 };
const result = (more: Partial<RecordedResult> = {}): RecordedResult => ({
	caseId: 'vc',
	caseName: 'vc',
	verdict: 'pass',
	date: '2026-10-20',
	runBy: null,
	commit: '3f2a9c1d0b4e5f60718293a4b5c6d7e8f9012345',
	evidence: null,
	file: 'v.sysml',
	span: SPAN,
	...more
});
const revision = (more: Partial<RevisionInfo> = {}): RevisionInfo => ({
	commit: '3f2a9c1d0b4e5f60718293a4b5c6d7e8f9012345',
	changed: false,
	sameModel: () => null,
	...more
});

describe('reading a result', () => {
	it('reads the verdict as SysML’s VerdictKind, and the strings as written', () => {
		expect(
			readResult([
				['verdict', 'VerdictKind::fail'],
				['date', '"2026-10-20"'],
				['runBy', '"A. \\"Ace\\" Engineer"'],
				['commit', '"abc1234"']
			])
		).toEqual({
			verdict: 'fail',
			date: '2026-10-20',
			runBy: 'A. "Ace" Engineer',
			commit: 'abc1234',
			evidence: null
		});
		expect(readResult([['verdict', 'VerdictKind::maybe']]).verdict).toBeNull();
	});
});

describe('whether a result still holds', () => {
	it('holds at the project’s commit while the model is unchanged', () => {
		expect(freshness(result(), revision()).state).toBe('current');
		// An abbreviated commit names the same one.
		expect(freshness(result({ commit: '3f2a9c1' }), revision()).state).toBe('current');
	});

	it('is out of date once the model changes, saved or not', () => {
		expect(freshness(result(), revision({ changed: true }))).toEqual({
			state: 'stale',
			text: 'Out of date: the model has changed since 3f2a9c1 (not saved yet).'
		});
		const later = revision({ commit: 'bbbbbbbbbbbbbbbb', sameModel: () => false });
		expect(freshness(result(), later)).toEqual({
			state: 'stale',
			text: 'Out of date: the model has changed since 3f2a9c1 (now bbbbbbb).'
		});
	});

	it('holds at a later commit that changed nothing but results', () => {
		const later = revision({ commit: 'bbbbbbbbbbbbbbbb', sameModel: (c) => c.startsWith('3f2a') });
		expect(freshness(result(), later).state).toBe('current');
		expect(freshness(result(), { ...later, changed: true }).state).toBe('stale');
	});

	it('says so while it is being found out', () => {
		const later = revision({ commit: 'bbbbbbbbbbbbbbbb' });
		expect(freshness(result(), later).state).toBe('checking');
	});

	it('says the commit is unknown without a commit to compare', () => {
		expect(freshness(result({ commit: null }), revision())).toEqual({
			state: 'unknown',
			text: 'Commit unknown: the result doesn’t name the commit it was run against.'
		});
		expect(freshness(result(), null)).toMatchObject({ state: 'unknown' });
		expect(freshness(result(), null).text).toMatch(/^Run against 3f2a9c1\. Commit unknown here/);
		expect(freshness(result(), revision({ commit: null })).state).toBe('unknown');
	});
});

describe('a requirement’s verification, from its cases’ results', () => {
	it('is the worst of them: failed, inconclusive, not run, out of date, passed', () => {
		const pass = result();
		expect(outcomeOf([], null)).toBeNull();
		expect(outcomeOf([pass, pass], revision())).toBe('passed');
		expect(outcomeOf([pass, null], revision())).toBe('not run');
		expect(outcomeOf([pass, result({ verdict: 'inconclusive' })], revision())).toBe('inconclusive');
		expect(outcomeOf([null, result({ verdict: 'error' })], revision())).toBe('failed');
		expect(outcomeOf([pass], revision({ changed: true }))).toBe('stale');
		// Commit unknown is said where the result is shown; it doesn't undo the pass.
		expect(outcomeOf([pass], null)).toBe('passed');
	});
});

describe('the coverage rule', () => {
	// need ← a, b (derived); b ← c; a cycle x ↔ y.
	const into: Record<string, string[]> = { need: ['a', 'b'], b: ['c'], x: ['y'], y: ['x'] };
	const items = ['need', 'a', 'b', 'c', 'x', 'y', 'lone'];
	const rule = (direct: string[]) =>
		Object.fromEntries(
			coverageRule(
				items,
				(i) => direct.includes(i),
				(i) => into[i] ?? []
			)
		);

	it('covers a requirement directly, or through every requirement derived from it', () => {
		expect(rule(['a', 'c'])).toEqual({
			need: 'derived',
			a: 'direct',
			b: 'derived',
			c: 'direct',
			x: null,
			y: null,
			lone: null
		});
		// One derived requirement uncovered leaves the need uncovered.
		expect(rule(['a']).need).toBeNull();
	});

	it('a circle of derivations covers nothing by itself', () => {
		expect(rule(['x'])).toMatchObject({ x: 'direct', y: 'derived' });
		expect(rule([])).toMatchObject({ x: null, y: null });
	});

	it('passed follows the same rule over the results', () => {
		const row = (key: string, results: (RecordedResult | null)[], derivedInto: string[] = []) => ({
			key,
			satisfied: null,
			verified: null,
			results,
			derivedInto
		});
		const rows = [
			row('need', [], ['a', 'b']),
			row('a', [result()]),
			row('b', [result(), result({ verdict: 'fail' })])
		];
		const passed = (rev: RevisionInfo | null) =>
			[...passedRule(rows, rev)].map(([r, how]) => `${r.key} ${how}`);
		expect(passed(revision())).toEqual(['need null', 'a direct', 'b null']);
		rows[2]!.results = [result()];
		expect(passed(revision())).toEqual(['need derived', 'a direct', 'b direct']);
		expect(passed(revision({ changed: true }))).toEqual(['need null', 'a null', 'b null']);
	});
});

describe('the same model, recorded results aside', () => {
	const before = `package V {
    private import VerificationCases::*;
    verification vc {
        objective { verify r; }
    }
    verification other;
}`;
	const after = `package V {
    private import VerificationCases::*;
    private import VerificationResults::VerificationResult;
    verification vc {
        objective { verify r; }
        @VerificationResult {
            verdict = VerdictKind::pass;
            date = "2026-10-20";
            evidence = "a } in a string";
        }
    }
    verification other {
        @VerificationResults::VerificationResult { verdict = VerdictKind::fail; date = "2026-10-21"; }
    }
}`;

	it('reads the same with results recorded, and their library', () => {
		expect(withoutResults(after)).toBe(withoutResults(before));
		expect(
			sameModel(
				{ 'v.sysml': before },
				{ 'v.sysml': after, 'libraries/VerificationResults.sysml': 'library package X;' }
			)
		).toBe(true);
	});

	it('differs when anything else changes', () => {
		expect(
			sameModel({ 'v.sysml': before }, { 'v.sysml': after.replace('verify r', 'verify s') })
		).toBe(false);
		expect(sameModel({ 'v.sysml': before }, { 'v.sysml': before, 'w.sysml': 'package W;' })).toBe(
			false
		);
		// Files that are not the model don't count.
		expect(sameModel({ 'v.sysml': before }, { 'v.sysml': before, 'README.md': 'notes' })).toBe(
			true
		);
	});
});
