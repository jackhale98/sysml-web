import { describe, expect, it } from 'vitest';
import type { TraceMatrix } from '#lib/engine/types.ts';
import { elementText, groupEdges, humanize, marksByRow, matrixExport } from './traceGrid';

const element = (written: string, name: string, path: string[] = []) => ({
	written,
	name,
	path,
	qualifiedName: '',
	elementId: null,
	kind: 'part'
});

const MATRIX: TraceMatrix = {
	relation: 'satisfy',
	requirements: [
		{ id: 'SYS-001', title: 'Flight endurance', elementId: 'a' },
		{ id: 'SYS-005', title: 'Ingress protection', elementId: 'b' },
		{ id: '', title: 'Noise', elementId: null }
	],
	elements: [
		element('drone', 'drone'),
		element('drone.flightController', 'flightController', ['drone']),
		element('batteryAbuseTest', 'batteryAbuseTest')
	],
	links: [
		{ row: 0, column: 0, file: 'f', line: 1, start: 0, end: 1 },
		{ row: 0, column: 1, file: 'f', line: 2, start: 2, end: 3 },
		{ row: 2, column: 1, file: 'f', line: 3, start: 4, end: 5 },
		{ row: 2, column: 1, file: 'f', line: 4, start: 6, end: 7 }
	]
};

describe('trace matrix words', () => {
	it('splits declared names for display only', () => {
		expect(humanize('batteryAbuseTest')).toBe('Battery abuse test');
		expect(humanize('drone')).toBe('Drone');
		expect(humanize('GPSReceiver')).toBe('GPS receiver');
		expect(humanize('battery_pack')).toBe('Battery pack');
		expect(humanize("'Flight endurance'")).toBe('Flight endurance');
	});

	it('names an element with the owner it is written under', () => {
		expect(elementText(MATRIX.elements[1]!)).toBe('Flight controller (drone)');
		expect(elementText(MATRIX.elements[2]!)).toBe('Battery abuse test');
	});

	it('groups columns written under the same owner', () => {
		expect(groupEdges(MATRIX.elements, [0, 1, 2])).toEqual([
			{ first: true, last: false },
			{ first: false, last: true },
			{ first: false, last: false }
		]);
		// Alone, a column is no group.
		expect(groupEdges(MATRIX.elements, [1, 2])).toEqual([
			{ first: false, last: false },
			{ first: false, last: false }
		]);
	});

	it('counts each element once per requirement', () => {
		expect(marksByRow(MATRIX)).toEqual([[0, 1], [], [1]]);
	});

	it('exports the grid with readable headers', () => {
		const table = matrixExport(MATRIX, [0, 1, 2], { title: 'Trace matrix', project: 'P' });
		expect(table.header).toEqual([
			'ID',
			'Requirement',
			'Drone',
			'Flight controller (drone)',
			'Battery abuse test',
			'Total'
		]);
		expect(table.rows).toEqual([
			['SYS-001', 'Flight endurance', '✓', '✓', '', '2'],
			['SYS-005', 'Ingress protection', '', '', '', '0'],
			['', 'Noise', '', '✓', '', '1']
		]);
		expect(matrixExport(MATRIX, [1], { title: 't', project: 'P' }).rows).toHaveLength(1);
	});
});
