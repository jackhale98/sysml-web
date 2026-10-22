/**
 * Column filters, as the table applies them: the shape a column filters
 * by (levels from the engine, numbers by range, few values by value, the
 * rest by text), which rows pass, the words a filter reads as, the risk
 * worksheets' quick reviews, and the `where` a filtered table is saved
 * with.
 */
import { describe, expect, it } from 'vitest';
import type { RenderedTable } from '#lib/engine/types.ts';
import {
	describeFilter,
	filterShape,
	isActive,
	isPreset,
	newFilter,
	passes,
	riskPresets,
	rowPasses,
	whereOf,
	type ColumnFilter
} from './tableFilters';

const sheet: RenderedTable = {
	view: 'fmeaWorksheet',
	columns: ['part', 'failureMode', 'severity', 'rpn', 'actionPriority', 'controlStatus', 'effect'],
	columnSpecs: [
		'part = element',
		'failureMode',
		'severity',
		'rpn = Rpn(severity, likelihood, detection)',
		'actionPriority = ActionPriority(severity, likelihood, detection)',
		'controlStatus',
		'effect'
	],
	columnLevels: [
		null,
		null,
		null,
		null,
		{ enum: 'ActionPriorityLevel', values: ['low', 'medium', 'high'] },
		{ enum: '', values: ['none', 'open', 'implemented', 'verified'] },
		null
	],
	rows: [
		['drone::battery', 'Thermal runaway', '9', '144', 'high', 'verified', 'Fire in the airframe'],
		['drone::motor', 'Stops', '8', '96', 'medium', 'open', 'The drone falls'],
		['drone::gnss', 'Position lost', '6', '72', 'low', 'none', 'It drifts away; it may fall'],
		['drone::radio', 'Link lost', '', '', '', 'none', '']
	],
	warnings: [],
	sources: []
};

const passing = (filters: ColumnFilter[]) =>
	sheet.rows.flatMap((cells, i) => (rowPasses(sheet, filters, cells) ? [i] : []));

describe('column filters', () => {
	it('filter each column by what it holds', () => {
		expect(filterShape(sheet, 4)).toEqual({
			kind: 'levels',
			values: ['low', 'medium', 'high'],
			ordered: true
		});
		expect(filterShape(sheet, 2)).toEqual({ kind: 'range', min: 6, max: 9 });
		// Few short values: by value, sorted; long or many: by text.
		expect(filterShape(sheet, 1)).toEqual({
			kind: 'levels',
			values: ['Link lost', 'Position lost', 'Stops', 'Thermal runaway'],
			ordered: false
		});
		expect(
			filterShape({ ...sheet, rows: sheet.rows.map((r) => [...r.slice(0, 6), r[6]!.repeat(5)]) }, 6)
		).toEqual({ kind: 'text' });
		expect(newFilter(sheet, 'severity')).toEqual({
			column: 'severity',
			kind: 'range',
			min: null,
			max: null
		});
		expect(isActive(newFilter(sheet, 'actionPriority'))).toBe(false);
	});

	it('keep the rows that pass every filter; empty cells fail a range', () => {
		expect(passing([{ column: 'severity', kind: 'range', min: 8, max: null }])).toEqual([0, 1]);
		expect(passing([{ column: 'rpn', kind: 'range', min: null, max: 100 }])).toEqual([1, 2]);
		expect(
			passing([
				{ column: 'actionPriority', kind: 'levels', values: ['high', 'medium'] },
				{ column: 'controlStatus', kind: 'levels', values: ['open'] }
			])
		).toEqual([1]);
		expect(passing([{ column: 'effect', kind: 'text', text: 'FALL' }])).toEqual([1, 2]);
		// A filter not narrowed yet, or of a column the table lacks, keeps everything.
		expect(passing([{ column: 'effect', kind: 'text', text: ' ' }])).toEqual([0, 1, 2, 3]);
		expect(passing([{ column: 'nothing', kind: 'text', text: 'x' }])).toEqual([0, 1, 2, 3]);
		expect(passes({ column: 'x', kind: 'range', min: 1, max: 1 }, '1')).toBe(true);
	});

	it('read in plain words', () => {
		const words = (f: ColumnFilter) => describeFilter(sheet, f);
		expect(words({ column: 'severity', kind: 'range', min: 9, max: null })).toBe('Severity ≥ 9');
		expect(words({ column: 'rpn', kind: 'range', min: 50, max: 100 })).toBe('RPN 50 to 100');
		expect(words({ column: 'actionPriority', kind: 'levels', values: ['high'] })).toBe(
			'Action priority: high'
		);
		// The top of a scale reads as "or above".
		expect(words({ column: 'actionPriority', kind: 'levels', values: ['medium', 'high'] })).toBe(
			'Action priority ≥ medium'
		);
		expect(words({ column: 'controlStatus', kind: 'levels', values: ['none', 'open'] })).toBe(
			'Control status: none or open'
		);
		expect(words({ column: 'effect', kind: 'text', text: 'fire ' })).toBe('Effect contains “fire”');
	});

	it('offer the risk worksheet’s quick reviews, for the columns it has', () => {
		const presets = riskPresets(sheet, 151);
		expect(presets.map((p) => p.label)).toEqual(['High priority', 'Severity ≥ 9', 'RPN ≥ 151']);
		expect(riskPresets(sheet, null).at(-1)!.label).toBe('RPN ≥ 100');
		expect(isPreset(presets[0]!.filters, presets[0]!)).toBe(true);
		expect(isPreset([...presets[0]!.filters, ...presets[1]!.filters], presets[0]!)).toBe(false);
	});

	it('save as a where condition over the columns’ own expressions, leaving text out', () => {
		const { where, left } = whereOf(sheet, [
			{ column: 'actionPriority', kind: 'levels', values: ['medium', 'high'] },
			{ column: 'severity', kind: 'range', min: 8, max: 9 },
			{ column: 'controlStatus', kind: 'levels', values: ['open'] },
			{ column: 'effect', kind: 'text', text: 'fire' },
			{ column: 'failureMode', kind: 'levels', values: ['Stops'] },
			{ column: 'rpn', kind: 'range', min: null, max: null }
		]);
		expect(where).toBe(
			'(ActionPriority(severity, likelihood, detection) == ActionPriorityLevel::medium or ActionPriority(severity, likelihood, detection) == ActionPriorityLevel::high) and severity >= 8 and severity <= 9 and controlStatus == "open"'
		);
		expect(left.map((f) => f.column)).toEqual(['effect', 'failureMode']);
		expect(whereOf(sheet, [{ column: 'rpn', kind: 'range', min: 100, max: null }]).where).toBe(
			'Rpn(severity, likelihood, detection) >= 100'
		);
	});
});
