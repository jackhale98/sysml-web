import { describe, expect, it } from 'vitest';
import { parseDelimited } from '#lib/dataio/csv.ts';
import { start, step } from './emulator.ts';
import { flightModes } from './fixtures.ts';
import { traceCsv, traceFileName, traceJson, traceRows } from './trace-export.ts';

function run() {
	let s = start(flightModes);
	s = step(flightModes, s, { event: 'ArmCommand', variables: { preflightChecksPassed: true } });
	s = step(flightModes, s, { event: 'TakeOffCommand' });
	return s;
}

describe('saving a run', () => {
	it('the Timeline as CSV: one row per step, with why it fired and what its guard read', () => {
		const s = run();
		const rows = traceRows(flightModes, s.trace);
		expect(rows[0]).toEqual([
			'Step',
			'Time (s)',
			'From',
			'To',
			'Transition',
			'Trigger',
			'Why',
			'Guard',
			'Values read',
			'Stopped',
			'Exit',
			'Effect',
			'Entry',
			'Started',
			'Gave way',
			'Notes'
		]);
		expect(rows).toHaveLength(s.trace.length + 1);
		expect(rows[2]!.slice(0, 9)).toEqual([
			'1',
			'0',
			'idle',
			'armed',
			'arm',
			'ArmCommand',
			'event ArmCommand',
			'preflightChecksPassed: true',
			'preflightChecksPassed = true'
		]);
		expect(rows.at(-1)!.slice(2, 8)).toEqual([
			'armed',
			'flying',
			'takeOff',
			'TakeOffCommand',
			'event TakeOffCommand',
			''
		]);
		// It reads back as the same table.
		const parsed = parseDelimited(traceCsv(flightModes, s.trace));
		expect(parsed.rows).toEqual(rows);
	});

	it('the run as JSON names the machine, its file and the commit the model is based on', () => {
		const s = run();
		const json = JSON.parse(
			traceJson(
				flightModes,
				s,
				{ project: 'Demo', repository: 'o/r', branch: 'main', commit: 'abc123', changedFiles: 0 },
				new Date('2026-10-26T12:00:00Z')
			)
		);
		expect(json).toMatchObject({
			machine: {
				name: 'FlightModes',
				qualifiedName: 'FlightControl::FlightModes',
				file: 'behaviour/FlightControl.sysml',
				line: 19
			},
			source: {
				project: 'Demo',
				repository: 'o/r',
				branch: 'main',
				commit: 'abc123',
				changedFiles: 0
			},
			exportedAt: '2026-10-26T12:00:00.000Z',
			status: 'running',
			current: s.current
		});
		expect(json.trace).toEqual(s.trace);
		expect(traceFileName(flightModes, 'json')).toBe('FlightModes run.json');
	});
});
