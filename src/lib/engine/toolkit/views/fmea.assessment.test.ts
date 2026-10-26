/**
 * Assessment evidence (§7, FMEA calculations): the worksheet figures against
 * independent known answers, not against the toolkit's own evaluation of the
 * same calc.
 *
 * - Action priority: the AIAG-VDA FMEA handbook (2019) table for design and
 *   process FMEA, typed in below as the handbook lays it out (bands of
 *   severity, occurrence and detection), checked in all 1000 cells.
 * - RPN: the classic definition S × O × D, in all 1000 cells.
 * - RPN bands at their thresholds, on a worksheet, with the library's
 *   defaults and with thresholds changed in the project's library.
 * - Ratings at and just outside the scale's ends, and a fractional rating.
 * - The action priority as configured: a project that changes the calc in
 *   its library gets its own answer on the worksheet.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../../protocol';
import type { RenderedTable } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const libraries = demoFiles().filter((f) => f.path.startsWith('libraries/'));
const RISK = 'libraries/RiskAnalysis.sysml';

function project(model: string, library?: (text: string) => string): SourceFile[] {
	const libs = libraries.map((f) =>
		f.path === RISK && library ? { ...f, text: library(f.text) } : f
	);
	return [...libs, { path: 'model/T.sysml', text: model }];
}

const col = (t: RenderedTable, name: string) => {
	const i = t.columns.indexOf(name);
	if (i < 0) throw new Error(`no column ${name} in ${t.columns.join(', ')}`);
	return t.rows.map((r) => r[i]!);
};

// --- The AIAG-VDA action priority table (FMEA handbook 2019, DFMEA/PFMEA) -----------
// Rows: severity band, then occurrence band; letters: detection 7-10, 5-6, 2-4, 1.
const S_BANDS = [10, 8, 6, 3, 1]; // upper bounds of 9-10, 7-8, 4-6, 2-3, 1
const O_BANDS = [10, 7, 5, 3, 1]; // 8-10, 6-7, 4-5, 2-3, 1
const D_BANDS = [10, 6, 4, 1]; // 7-10, 5-6, 2-4, 1
const AIAG_VDA: string[][] = [
	// S 9-10
	['HHHH', 'HHHH', 'HHHM', 'HMLL', 'LLLL'],
	// S 7-8
	['HHHH', 'HHHM', 'HMMM', 'MMLL', 'LLLL'],
	// S 4-6
	['HHMM', 'MMML', 'MLLL', 'LLLL', 'LLLL'],
	// S 2-3
	['MMLL', 'LLLL', 'LLLL', 'LLLL', 'LLLL'],
	// S 1
	['LLLL', 'LLLL', 'LLLL', 'LLLL', 'LLLL']
];
const band = (bounds: number[], v: number) => {
	// bounds are descending upper bounds; the band is the last whose upper bound is >= v
	let i = 0;
	while (i + 1 < bounds.length && bounds[i + 1]! >= v) i++;
	return i;
};
const LEVEL: Record<string, string> = { H: 'high', M: 'medium', L: 'low' };
function handbook(s: number, o: number, d: number): string {
	return LEVEL[AIAG_VDA[band(S_BANDS, s)]![band(O_BANDS, o)]![band(D_BANDS, d)]!]!;
}

/** One line per occurrence rating at detection `d`; a column per severity for AP and RPN. */
function grid(d: number): SourceFile[] {
	const lines = Array.from(
		{ length: 10 },
		(_, o) =>
			`    part p${o + 1} { @Fmea { failureMode = "x"; severity = 1; likelihood = ${o + 1}; detection = ${d}; } }`
	).join('\n');
	const ap = Array.from(
		{ length: 10 },
		(_, s) => `ap${s + 1} = ActionPriority(${s + 1}, likelihood, detection)`
	);
	const rpn = Array.from(
		{ length: 10 },
		(_, s) => `rpn${s + 1} = Rpn(${s + 1}, likelihood, detection)`
	);
	return project(`package T {
    private import RiskAnalysis::*;
${lines}
    view def Grid {
        @Reporting::TableRendering {
            rows = "@Fmea";
            columns = "likelihood; ${[...ap, ...rpn].join('; ')}";
        }
    }
}`);
}

describe('FMEA figures against known answers', { timeout: 120_000 }, () => {
	it('the handbook table as typed in is complete and has the handbook’s corners', () => {
		// Sanity of the oracle itself, so a typo in it cannot pass silently.
		expect(handbook(10, 10, 10)).toBe('high');
		expect(handbook(9, 1, 10)).toBe('low');
		expect(handbook(9, 4, 1)).toBe('medium');
		expect(handbook(9, 3, 7)).toBe('high');
		expect(handbook(8, 7, 1)).toBe('medium');
		expect(handbook(6, 8, 4)).toBe('medium');
		expect(handbook(6, 6, 1)).toBe('low');
		expect(handbook(3, 8, 5)).toBe('medium');
		expect(handbook(3, 8, 4)).toBe('low');
		expect(handbook(1, 10, 10)).toBe('low');
		const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>;
		for (let s = 1; s <= 10; s++)
			for (let o = 1; o <= 10; o++) for (let d = 1; d <= 10; d++) counts[handbook(s, o, d)]!++;
		expect(counts.high! + counts.medium! + counts.low!).toBe(1000);
	});

	it('the worksheet’s action priority is the AIAG-VDA table and its RPN is S×O×D, in all 1000 cells', () => {
		const wrongAp: string[] = [];
		const wrongRpn: string[] = [];
		for (let d = 1; d <= 10; d++) {
			const t = host.renderView(grid(d), 'Grid');
			const likelihoods = col(t, 'likelihood').map(Number);
			expect(likelihoods.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
			t.rows.forEach((row, r) => {
				const o = Number(row[0]);
				for (let s = 1; s <= 10; s++) {
					const ap = col(t, `ap${s}`)[r];
					const rpn = col(t, `rpn${s}`)[r];
					if (ap !== handbook(s, o, d)) wrongAp.push(`S${s} O${o} D${d}: ${ap}`);
					if (rpn !== String(s * o * d)) wrongRpn.push(`S${s} O${o} D${d}: ${rpn}`);
				}
			});
		}
		expect(wrongAp).toEqual([]);
		expect(wrongRpn).toEqual([]);
	});

	const LINES = (ratings: [number, number, number][]) =>
		`package T {
    private import RiskAnalysis::*;
${ratings.map(([s, o, d], i) => `    part p${i} { @Fmea { failureMode = "m${i}"; severity = ${s}; likelihood = ${o}; detection = ${d}; } }`).join('\n')}
    view sheet : FmeaWorksheet { expose T::*; }
}`;

	// RPNs either side of each default threshold (51, 151, 401) that ratings of 1-10 can make.
	const AROUND: [number, number, number][] = [
		[5, 5, 2], // 50
		[6, 9, 1], // 54
		[5, 5, 6], // 150
		[4, 5, 8], // 160
		[4, 10, 10], // 400
		[5, 9, 9] // 405
	];

	it('puts each RPN in its band at the default thresholds', () => {
		const t = host.renderView(project(LINES(AROUND)), 'sheet');
		const byRpn = Object.fromEntries(col(t, 'rpn').map((r, i) => [r, col(t, 'rpnBand')[i]]));
		expect(byRpn).toEqual({
			'50': 'low',
			'54': 'medium',
			'150': 'medium',
			'160': 'high',
			'400': 'high',
			'405': 'critical'
		});
		// Highest risk first, numerically (not as text: 54 after 405 and 400).
		expect(col(t, 'rpn')).toEqual(['405', '400', '160', '150', '54', '50']);
	});

	it('moves the bands when the project’s library changes the thresholds', () => {
		const files = project(LINES(AROUND), (text) =>
			text
				.replace('attribute mediumFrom : Integer = 51;', 'attribute mediumFrom : Integer = 54;')
				.replace('attribute highFrom : Integer = 151;', 'attribute highFrom : Integer = 150;')
				.replace(
					'attribute criticalFrom : Integer = 401;',
					'attribute criticalFrom : Integer = 400;'
				)
		);
		const t = host.renderView(files, 'sheet');
		const byRpn = Object.fromEntries(col(t, 'rpn').map((r, i) => [r, col(t, 'rpnBand')[i]]));
		expect(byRpn).toEqual({
			'50': 'low',
			'54': 'medium',
			'150': 'high',
			'160': 'high',
			'400': 'critical',
			'405': 'critical'
		});
	});

	it('uses the project’s own action priority when the library’s calc changes', () => {
		// A stricter house rule: any severity of 9 or 10 is high priority.
		const files = project(LINES([[9, 1, 1]]), (text) =>
			text.replace(
				'if severity >= 9 ?\n                (if likelihood >= 6',
				'if severity >= 9 ?\n                (if true ? ActionPriorityLevel::high else if likelihood >= 6'
			)
		);
		expect(files.find((f) => f.path === RISK)!.text).toContain(
			'if true ? ActionPriorityLevel::high'
		);
		const t = host.renderView(files, 'sheet');
		expect(col(t, 'actionPriority')).toEqual(['high']);
		// The default library says low for the same line.
		expect(col(host.renderView(project(LINES([[9, 1, 1]])), 'sheet'), 'actionPriority')).toEqual([
			'low'
		]);
	});

	const RANGE = [
		[1, 1, 1],
		[10, 10, 10],
		[0, 5, 5],
		[11, 5, 5],
		[5, 5.5, 5]
	] as [number, number, number][];
	const sheetOf = () => {
		const t = host.renderView(project(LINES(RANGE)), 'sheet');
		const row = (mode: string) => t.rows.findIndex((r) => r.includes(mode));
		const figures = (mode: string) =>
			['rpn', 'actionPriority', 'rpnBand', 'acceptability'].map(
				(c) => t.rows[row(mode)]![t.columns.indexOf(c)]
			);
		const problems = (mode: string) => t.rowInfo?.[row(mode)]?.problems ?? {};
		return { t, figures, problems };
	};

	it('accepts ratings of 1 and 10, and flags 0 and 11 with no figures computed', () => {
		const { t, figures, problems } = sheetOf();
		expect(figures('m0')).toEqual(['1', 'low', 'low', 'acceptable']);
		expect(figures('m1')).toEqual(['1000', 'high', 'critical', 'unacceptable']);
		expect(problems('m0')).toEqual({});
		// 10/10/10 is a valid line; its only flags are the risk review's (unacceptable, no control).
		const ratingColumns = ['severity', 'likelihood', 'detection'].map((c) =>
			String(t.columns.indexOf(c))
		);
		expect(Object.keys(problems('m1')).filter((k) => ratingColumns.includes(k))).toEqual([]);
		const severity = t.columns.indexOf('severity');
		expect(problems('m2')[severity]).toBe('Severity is 0, outside the scale of 1 to 10.');
		expect(problems('m3')[severity]).toBe('Severity is 11, outside the scale of 1 to 10.');
		expect(figures('m2').slice(0, 3)).toEqual(['', '', '']);
		expect(figures('m3').slice(0, 3)).toEqual(['', '', '']);
	});

	// Known gap: a fractional rating (likelihood 5.5) is not flagged, though FmeaRating is an
	// Integer, and the worksheet shows RPN 137.5000, band medium and priority low for it.
	it.fails('flags a fractional rating and computes no figures from it', () => {
		const { t, figures, problems } = sheetOf();
		expect(problems('m4')[t.columns.indexOf('likelihood')]).toBeDefined();
		expect(figures('m4').slice(0, 3)).toEqual(['', '', '']);
	});
});
