import { describe, expect, it } from 'vitest';
import type { ModelElement } from '#lib/project/elements.ts';
import type { RequirementRow } from '#lib/project/requirements.ts';
import type { CheckReport, ViewInfo } from '#lib/engine/types.ts';
import { countModel, doneSteps, STEP_ORDER, type Counts } from './nextSteps.ts';

const element = (kind: string, more: Partial<ModelElement> = {}): ModelElement => ({
	key: `${kind}@${Math.random()}`,
	name: kind,
	label: kind,
	kind,
	isDefinition: false,
	parent: null,
	typeRef: null,
	shortName: null,
	doc: null,
	multiplicity: null,
	value: null,
	file: 'model/M.sysml',
	span: { start_byte: 0, end_byte: 1, start_row: 1, end_row: 1 } as ModelElement['span'],
	...more
});

const view = (name: string, more: Partial<ViewInfo> = {}): ViewInfo => ({
	name,
	file: 'views/Views.sysml',
	isUsage: true,
	hasTable: true,
	builtin: false,
	...more
});

describe('next steps', () => {
	it('counts what the model has, leaving the libraries out', () => {
		const counts = countModel({
			elements: [
				element('part'),
				element('part', { isDefinition: true }),
				element('part', { file: 'libraries/ModelViews.sysml' }),
				element('attribute', { value: 'battery.mass + led.mass' }),
				element('attribute', { value: 'sum(wheels.mass)' }),
				element('attribute', { value: '48 [g]' })
			],
			requirements: [
				{ satisfiedBy: ['system'] } as unknown as RequirementRow,
				{ satisfiedBy: [] } as unknown as RequirementRow
			],
			views: [view('a'), view('b', { builtin: true }), view('c', { file: 'libraries/X.sysml' })],
			checks: {
				checks: [
					{ kind: 'satisfy', checkable: true },
					{ kind: 'require', checkable: false },
					{ kind: 'assert', checkable: true }
				],
				summary: { satisfied: 0, violated: 0, undecided: 0 },
				ms: 0
			} as unknown as CheckReport
		});
		expect(counts).toEqual({ requirements: 2, parts: 2, satisfies: 1, views: 1, numbers: 3 });
	});

	it('ticks a step when the model has more than it started with', () => {
		const start: Counts = { requirements: 1, parts: 2, satisfies: 1, views: 3, numbers: 0 };
		const none = doneSteps(start, start, { github: false, downloaded: false });
		expect(STEP_ORDER.filter((s) => none[s])).toEqual([]);
		const some = doneSteps({ ...start, requirements: 2, numbers: 1 }, start, {
			github: false,
			downloaded: true
		});
		expect(STEP_ORDER.filter((s) => some[s])).toEqual(['requirement', 'numbers', 'keep']);
	});
});
