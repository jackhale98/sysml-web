import { describe, expect, it } from 'vitest';
import type { ViewInfo } from '#lib/engine/types.ts';
import { exposedName, presentationOf, viewTitle } from './views.ts';

const view = (over: Partial<ViewInfo>): ViewInfo => ({
	name: 'v',
	file: 'views/Views.sysml',
	isUsage: true,
	hasTable: false,
	builtin: false,
	...over
});

describe('presentationOf', () => {
	it('renders table views as tables', () => {
		expect(presentationOf(view({ hasTable: true, definition: 'FmeaWorksheet' }))).toEqual({
			kind: 'table'
		});
	});

	it('draws standard diagram views from what they expose', () => {
		expect(
			presentationOf(
				view({ definition: 'InterconnectionView', exposes: ['DroneArchitecture::drone::*'] })
			)
		).toEqual({ kind: 'diagram', view: 'interconnection', scope: 'drone' });
		expect(
			presentationOf(
				view({ definition: 'ActionFlowView', exposes: ['DeliveryMission::DeliveryFlight'] })
			)
		).toEqual({ kind: 'diagram', view: 'actions', scope: 'DeliveryFlight' });
		expect(presentationOf(view({ definition: 'GeneralView', exposes: ['A::*', 'B::*'] }))).toEqual({
			kind: 'diagram',
			view: 'requirements',
			scope: null
		});
		expect(presentationOf(view({ definition: 'InterconnectionView' }))).toEqual({ kind: 'none' });
		expect(presentationOf(view({ isUsage: false }))).toEqual({ kind: 'none' });
	});
});

describe('names', () => {
	it('reads expose targets and titles', () => {
		expect(exposedName("P::'my part'::**")).toBe('my part');
		expect(viewTitle('requirementCoverage')).toBe('Requirement coverage');
		expect(viewTitle('RequirementGaps')).toBe('Requirement gaps');
	});
});
