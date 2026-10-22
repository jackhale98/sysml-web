import { describe, expect, it } from 'vitest';
import type { RenderedTable, ViewInfo } from '#lib/engine/types.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { isFmeaTable, isHazardLog, levelTone, matrixOf, zoneTone } from './risk.ts';

const view = (over: Partial<ViewInfo>): ViewInfo => ({
	name: 'v',
	file: 'views/Views.sysml',
	isUsage: true,
	hasTable: true,
	builtin: false,
	...over
});

describe('risk tables', () => {
	it('are told by what they list and the view def they are typed by', () => {
		const table = (metadata: string) =>
			({ annotations: { metadata, package: 'P' } }) as unknown as RenderedTable;
		expect(isFmeaTable(table('RiskAnalysis::Fmea'))).toBe(true);
		expect(isFmeaTable(table('ModelingMetadata::StatusInfo'))).toBe(false);
		expect(isHazardLog(view({ definition: 'HazardAnalysis::HazardLog' }))).toBe(true);
		expect(isHazardLog(view({ name: 'HazardLog', isUsage: false }))).toBe(true);
		expect(isHazardLog(view({ definition: 'RequirementsTable' }))).toBe(false);
	});

	it('show priorities, bands, acceptability, status and a harm’s severity as levels, nothing else', () => {
		expect(levelTone('actionPriority', 'high')).toBe('bad');
		expect(levelTone('priorityBefore', 'medium')).toBe('warn');
		expect(levelTone('severity', 'negligible')).toBe('ok');
		expect(levelTone('rpnBand', 'critical')).toBe('bad');
		expect(levelTone('acceptability', 'reduce')).toBe('warn');
		expect(levelTone('mitigationStatus', 'inProgress')).toBe('warn');
		expect(levelTone('controlStatus', 'none')).toBe('plain');
		// A requirement's priority, a rating as a number: not levels.
		expect(levelTone('priority', 'high')).toBeNull();
		expect(levelTone('severity', '8')).toBeNull();
	});

	it('tone a policy’s zones by name, else by their place', () => {
		expect(zoneTone('unacceptable', [])).toBe('bad');
		expect(zoneTone('tolerable', ['broadlyAcceptable', 'tolerable', 'intolerable'])).toBe('warn');
		expect(zoneTone('intolerable', ['broadlyAcceptable', 'tolerable', 'intolerable'])).toBe('bad');
		expect(zoneTone('', [])).toBe('plain');
	});

	it('find the saved risk matrix of a sheet', () => {
		const workspace = {
			views: [
				view({ name: 'sheet', definition: 'DesignFmeaWorksheet', exposes: ['Pump::Fmea::*'] }),
				view({ name: 'matrix', definition: 'RiskAnalysis::RiskMatrix', exposes: ['Fmea::*'] })
			]
		} as unknown as Workspace;
		expect(matrixOf(workspace, 'Pump::Fmea')?.name).toBe('matrix');
		expect(matrixOf(workspace, 'Other')).toBeUndefined();
	});
});
