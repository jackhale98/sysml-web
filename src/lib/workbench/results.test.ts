/**
 * Recording verification results, as the inspector does: on the demo (real
 * toolkit), one undoable change that writes the case's `@VerificationResult`
 * (replacing the one it has), imports what it needs and brings the results
 * library; the result then shows in the requirement rows, the coverage and
 * the requirement tables.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace, problemsOf } from '#lib/create/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { RESULTS_LIBRARY_PATH } from '#lib/project/verification.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { recordResult, resultAnnotation, withResult, type ResultInput } from './results';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const V = 'verification/VerificationPlan.sysml';
const COMMIT = '3f2a9c1d0b4e5f60718293a4b5c6d7e8f9012345';
const passed: ResultInput = {
	verdict: 'pass',
	date: '2026-10-20',
	runBy: 'A. Engineer',
	commit: COMMIT,
	evidence: 'https://example.com/flight-log-17.csv'
};

const caseNamed = (ws: Workspace, name: string) =>
	ws.elements.find((e) => e.kind === 'verification' && e.label === name)!;
const row = (ws: Workspace, id: string) => ws.requirements.find((r) => r.id === id)!;

describe('recording a verification result', { timeout: 120_000 }, () => {
	it('writes the result in the case, its import and the library, as one undoable step', async () => {
		const ws = await openWorkspace(host, demoFiles());
		await analysed(ws, () => {});
		const before = ws.text(V)!;
		const problems = problemsOf(ws);
		const error = await analysed(ws, () =>
			recordResult(ws, caseNamed(ws, 'enduranceFlightTest'), passed)
		);
		expect(error).toBeNull();
		const after = ws.text(V)!;
		expect(after).toContain(
			`        return :>> verdict = PassIf(hoverUntilReserve.flightTime >= 25 [min]);
        @VerificationResult {
            verdict = VerdictKind::pass;
            date = "2026-10-20";
            runBy = "A. Engineer";
            commit = "${COMMIT}";
            evidence = "https://example.com/flight-log-17.csv";
        }
    }`
		);
		// VerificationCases::* is imported already, which has VerdictKind.
		expect(after).toContain(
			'    private import DroneArchitecture::drone;\n    private import VerificationResults::VerificationResult;\n'
		);
		expect(ws.text(RESULTS_LIBRARY_PATH)).toMatch(/^library package VerificationResults/);
		expect(problemsOf(ws)).toEqual(problems);

		// Read back: the case's result, the requirement it verifies, the coverage.
		const vc = caseNamed(ws, 'enduranceFlightTest');
		expect(ws.results.get(vc.id!)).toMatchObject({ verdict: 'pass', commit: COMMIT });
		expect(row(ws, 'SYS-001').results).toEqual([expect.objectContaining({ verdict: 'pass' })]);
		expect(row(ws, 'SYS-002').results).toEqual([null]);
		expect(ws.coverage.passed).toBe(1);

		// The requirements table says how each requirement's verification went.
		const table = host.renderView(ws.sourceFiles(), 'systemRequirements');
		const result = (id: string) =>
			table.rows.find((r) => r[0] === id)![table.columns.indexOf('result')];
		expect(result('SYS-001')).toBe('passed');
		expect(result('SYS-002')).toBe('not run');
		expect(result('SYS-005')).toBe('');

		// One step: undo takes back the result, the import and the library.
		await analysed(ws, () => ws.undo());
		expect(ws.text(V)).toBe(before);
		expect(ws.text(RESULTS_LIBRARY_PATH)).toBeUndefined();
	});

	it('a new result replaces the one the case has', async () => {
		const ws = await openWorkspace(host, demoFiles());
		await analysed(ws, () => {});
		await analysed(ws, () => recordResult(ws, caseNamed(ws, 'batteryAbuseTest'), passed));
		await analysed(ws, () =>
			recordResult(ws, caseNamed(ws, 'batteryAbuseTest'), {
				...passed,
				verdict: 'fail',
				date: '2026-10-22',
				evidence: ''
			})
		);
		const text = ws.text(V)!;
		expect(text.match(/@VerificationResult/g)).toHaveLength(1);
		expect(text).toContain('verdict = VerdictKind::fail;\n            date = "2026-10-22";');
		expect(text).not.toContain('evidence =');
		expect(row(ws, 'RC-001').results).toEqual([expect.objectContaining({ verdict: 'fail' })]);
		expect(ws.coverage.passed).toBe(0);
	});

	it('refuses a date it can’t read, and anything but a verification case', async () => {
		const ws = await openWorkspace(host, demoFiles());
		await analysed(ws, () => {});
		expect(
			await recordResult(ws, caseNamed(ws, 'linkRangeTest'), { ...passed, date: '20/10/2026' })
		).toBe('Give the date as year-month-day, such as 2026-10-20.');
		const part = ws.elements.find((e) => e.kind === 'part' && e.label === 'drone')!;
		expect(await recordResult(ws, part, passed)).toBe(
			'A result is recorded on a verification case.'
		);
	});
});

describe('the text of a result', () => {
	it('gives a case without a body one, and escapes what it quotes', () => {
		const text = 'package P {\n    verification check;\n}\n';
		const from = text.indexOf('verification');
		const to = text.indexOf(';', from) + 1;
		expect(
			withResult(text, from, to, { ...passed, runBy: 'Jo "JJ" Doe', commit: '', evidence: '' })
		).toBe(
			'package P {\n    verification check {\n        @VerificationResult {\n            verdict = VerdictKind::pass;\n            date = "2026-10-20";\n            runBy = "Jo \\"JJ\\" Doe";\n        }\n    }\n}\n'
		);
		expect(resultAnnotation({ ...passed, verdict: 'inconclusive' }, '').split('\n')[1]).toBe(
			'    verdict = VerdictKind::inconclusive;'
		);
	});
});
