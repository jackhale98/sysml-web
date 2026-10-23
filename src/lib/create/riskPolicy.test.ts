/**
 * The risk policy as the form writes it into the risk library: the
 * default zones written back give the library's own text, a painted grid
 * becomes an `Acceptability` calc the toolkit evaluates to the same zones
 * in every cell, the RPN bands' thresholds move the band of every RPN,
 * and the lead reorders the worksheets' figures and their sort. Every
 * text checks clean.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { SourceFile } from '#lib/engine/protocol.ts';
import {
	DEFAULT_ZONES,
	acceptabilityText,
	findBlock,
	orderColumns,
	withPolicy,
	zoneWords,
	type Zones
} from './riskPolicy';
import { RISK_LIBRARIES } from './riskLibraries';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const library = RISK_LIBRARIES[0]!.text;
const demo = demoFiles();

/** The demo with its risk library replaced. */
function withLibrary(text: string): SourceFile[] {
	return demo.map((f) => (f.path === 'libraries/RiskAnalysis.sysml' ? { ...f, text } : f));
}

function problems(files: SourceFile[]): string[] {
	return host
		.analyzeProject(files)
		.flatMap((a) => [...a.diagnostics, ...a.model.syntax_errors])
		.map((d) => d.message);
}

/** What the toolkit evaluates a calc to, by literal name. */
function query(files: SourceFile[], expression: string): string {
	const { session } = host.session(files);
	const answer = JSON.parse(session!.query(expression)) as { qualifiedName?: string } | number;
	return typeof answer === 'number' ? String(answer) : answer.qualifiedName!.split('::').pop()!;
}

describe('the risk policy form’s SysML', { timeout: 60_000 }, () => {
	it('writes the default policy back as the library has it', () => {
		expect(withPolicy(library, { zones: DEFAULT_ZONES })).toBe(library);
		expect(withPolicy(library, { lead: 'rpn' })).toBe(library);
		expect(
			withPolicy(library, {
				bands: [
					{ name: 'mediumFrom', value: 51 },
					{ name: 'highFrom', value: 151 },
					{ name: 'criticalFrom', value: 401 }
				]
			})
		).toBe(library);
		expect(zoneWords(DEFAULT_ZONES)).toEqual([
			'severity 9 to 10: unacceptable at likelihood 4 to 10, reduce at 2 to 3, acceptable at 1;',
			'severity 7 to 8: unacceptable at likelihood 6 to 10, reduce at 3 to 5, acceptable at 1 to 2;',
			'severity 4 to 6: unacceptable at likelihood 8 to 10, reduce at 5 to 7, acceptable at 1 to 4;',
			'severity 2 to 3: reduce at likelihood 8 to 10, acceptable at 1 to 7;',
			'severity 1: acceptable.'
		]);
	});

	it('a painted grid is a calc the toolkit evaluates to the same zones, in every cell', () => {
		// Diagonal zones by severity × likelihood, with one cell painted against the grain.
		const painted: Zones = Array.from({ length: 10 }, (_, s) =>
			Array.from({ length: 10 }, (_, l) => {
				const score = (s + 1) * (l + 1);
				return score >= 40 ? 'unacceptable' : score >= 12 ? 'reduce' : 'acceptable';
			})
		);
		painted[0]![9] = 'unacceptable';
		const text = withPolicy(library, { zones: painted });
		expect(acceptabilityText(painted)).toMatchSnapshot();
		const files = withLibrary(text);
		expect(problems(files)).toEqual([]);
		for (let s = 1; s <= 10; s++)
			for (let l = 1; l <= 10; l++)
				expect(query(files, `RiskAnalysis::Acceptability(${s}, ${l})`), `${s}, ${l}`).toBe(
					painted[s - 1]![l - 1]
				);
		// The app's own evaluation agrees, and so does the matrix.
		expect(host.riskPolicy(files).zones).toEqual(painted);
		const matrix = host.renderView(files, 'riskMatrix');
		expect(matrix.counts?.levels?.[9]).toEqual(painted[0]);
		// One zone everywhere is a single literal.
		const all = Array.from({ length: 10 }, () => Array(10).fill('reduce') as string[]);
		expect(acceptabilityText(all)).toContain(
			'return : RiskAcceptability = RiskAcceptability::reduce;'
		);
		expect(problems(withLibrary(withPolicy(library, { zones: all })))).toEqual([]);
	});

	it('the RPN bands follow their thresholds', () => {
		const text = withPolicy(library, {
			bands: [
				{ name: 'mediumFrom', value: 30 },
				{ name: 'highFrom', value: 100 },
				{ name: 'criticalFrom', value: 200 }
			]
		});
		expect(findBlock(text, /calc\s+def\s+RpnBand\b/) && text).toContain(
			'attribute highFrom : Integer = 100;'
		);
		const files = withLibrary(text);
		expect(problems(files)).toEqual([]);
		const band = (rpn: number) => query(files, `RiskAnalysis::RpnBand(${rpn})`);
		expect([1, 29, 30, 99, 100, 199, 200, 1000].map(band)).toEqual([
			'low',
			'low',
			'medium',
			'medium',
			'high',
			'high',
			'critical',
			'critical'
		]);
		// The default bands, across the whole scale, as the toolkit evaluates them.
		const original = withLibrary(library);
		for (const rpn of [1, 50, 51, 150, 151, 400, 401, 1000])
			expect(query(original, `RiskAnalysis::RpnBand(${rpn})`), String(rpn)).toBe(
				rpn >= 401 ? 'critical' : rpn >= 151 ? 'high' : rpn >= 51 ? 'medium' : 'low'
			);
		expect(host.riskPolicy(files).bands.map((b) => b.value)).toEqual([30, 100, 200]);
	});

	it('leading with the action priority puts it first and sorts by it, keeping the RPN', () => {
		expect(
			orderColumns(
				'part; failureMode; rpn = R; rpnBand = B; actionPriority = A; effect',
				'actionPriority'
			)
		).toBe('part; failureMode; actionPriority = A; rpn = R; rpnBand = B; effect');
		expect(orderColumns('part; actionPriority = A; rpn = R; rpnBand = B; effect', 'rpn')).toBe(
			'part; rpn = R; rpnBand = B; actionPriority = A; effect'
		);
		// The worksheets' own order (the controls before the band) comes back as it was.
		const own = 'rpn = R; actionPriority = A; riskControls; rpnBand = B';
		expect(orderColumns(own, 'rpn')).toBe(own);
		expect(orderColumns(orderColumns(own, 'actionPriority'), 'rpn')).toBe(own);
		const text = withPolicy(library, { lead: 'actionPriority' });
		const files = withLibrary(text);
		expect(problems(files)).toEqual([]);
		expect(host.riskPolicy(files).lead).toBe('actionPriority');
		const sheet = host.renderView(files, 'fmeaWorksheet');
		expect(sheet.columns.slice(5, 9)).toEqual(['actionPriority', 'rpn', 'riskControls', 'rpnBand']);
		const priority = sheet.rows.map((r) => r[5]);
		// High before medium before low, then by RPN.
		expect(priority).toEqual([
			'high',
			'medium',
			'medium',
			'medium',
			'low',
			'low',
			'low',
			'low',
			'low'
		]);
		expect(sheet.rows.map((r) => Number(r[6]))).toEqual([288, 144, 96, 80, 96, 72, 72, 60, 48]);
		// And back.
		expect(withPolicy(text, { lead: 'rpn' })).toBe(library);
	});

	it('adds the policy to a library that has none yet', () => {
		const old = library
			.replace(findBlockText(library, /enum\s+def\s+RiskAcceptability\b/), '')
			.replace(findBlockText(library, /calc\s+def\s+Acceptability\b/), '')
			.replace(findBlockText(library, /enum\s+def\s+RpnBandLevel\b/), '')
			.replace(findBlockText(library, /calc\s+def\s+RpnBand\b/), '')
			.replace(
				/ rpnBand = RpnBand\([^;]*\);| acceptability = Acceptability\([^;]*\);| acceptabilityBefore = Acceptability\([^;]*\);/g,
				''
			)
			.replace(/\n\s*cellLevel = "[^"]*";/, '');
		expect(problems(withLibrary(old))).toEqual([]);
		const text = withPolicy(old, {
			zones: DEFAULT_ZONES,
			bands: [
				{ name: 'mediumFrom', value: 51 },
				{ name: 'highFrom', value: 151 },
				{ name: 'criticalFrom', value: 401 }
			]
		});
		const files = withLibrary(text);
		expect(problems(files)).toEqual([]);
		expect(host.riskPolicy(files).zones).toEqual(DEFAULT_ZONES);
		expect(query(files, 'RiskAnalysis::RpnBand(151)')).toBe('high');
	});
});

function findBlockText(text: string, header: RegExp): string {
	const block = findBlock(text, header)!;
	return text.slice(block.start, block.end);
}
