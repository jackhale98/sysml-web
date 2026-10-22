import { describe, expect, it } from 'vitest';
import type { ViewInfo } from '#lib/engine/types.ts';
import {
	breakable,
	exposedName,
	groupViews,
	presentationOf,
	viewFamily,
	viewTitle
} from './views.ts';

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
		expect(
			presentationOf(
				view({ definition: 'SequenceView', exposes: ['DeliverySequence::ParcelDelivery'] })
			)
		).toEqual({ kind: 'diagram', view: 'sequence', scope: 'ParcelDelivery' });
		// A general view is drawn from the view usage itself, so its filters apply.
		expect(
			presentationOf(
				view({ definition: 'GeneralView', qualifiedName: 'Views::tree', exposes: ['A::*', 'B::*'] })
			)
		).toEqual({ kind: 'diagram', view: 'general', scope: 'Views::tree' });
		expect(
			presentationOf(view({ definition: 'GeneralView', builtin: true, exposes: ['A::*'] }))
		).toEqual({ kind: 'diagram', view: 'general', scope: 'A' });
		expect(presentationOf(view({ definition: 'InterconnectionView' }))).toEqual({ kind: 'none' });
		expect(presentationOf(view({ isUsage: false }))).toEqual({ kind: 'none' });
	});
});

describe('names', () => {
	it('reads expose targets and titles', () => {
		expect(exposedName("P::'my part'::**")).toBe('my part');
		expect(viewTitle('requirementCoverage')).toBe('Requirement coverage');
		expect(viewTitle('RequirementGaps')).toBe('Requirement gaps');
		expect(viewTitle('fmeaWorksheet')).toBe('FMEA worksheet');
		expect(viewTitle('ICDChapter')).toBe('ICD chapter');
		expect(viewTitle('FlightModes')).toBe('Flight modes');
	});
});

describe('families', () => {
	it('puts each saved view under a heading by its definition', () => {
		const family = (definition: string | undefined, over: Partial<ViewInfo> = {}) =>
			viewFamily(view({ ...(definition ? { definition } : {}), ...over }));
		expect(family('RequirementsTable')).toBe('requirements');
		expect(family('BillOfMaterials')).toBe('structure');
		expect(family('InterconnectionView')).toBe('interfaces');
		expect(family('StateTransitionView')).toBe('behaviour');
		expect(family('MassBudget')).toBe('analysis');
		expect(family('FmeaWorksheet')).toBe('risk');
		expect(family('SpecificationDocument')).toBe('documents');
		expect(family(undefined, { name: 'priceBudget', hasTable: true })).toBe('analysis');
		expect(family('Whatever')).toBe('other');
	});

	it('groups in order and leaves out empty groups', () => {
		const views = [
			view({ name: 'a', definition: 'MassBudget' }),
			view({ name: 'b', definition: 'GeneralView' }),
			view({ name: 'c', definition: 'RequirementGaps' }),
			view({ name: 'd', definition: 'GeneralView' })
		];
		expect(groupViews(views, (v) => v).map((g) => [g.title, g.views.map((v) => v.name)])).toEqual([
			['Requirements', ['c']],
			['Structure', ['b', 'd']],
			['Budgets & analysis', ['a']]
		]);
	});

	it('break names between their words, never inside one', () => {
		expect(breakable('burnInjury')).toEqual(['burn', 'Injury']);
		expect(breakable('drone::rotors::motor')).toEqual(['drone::', 'rotors::', 'motor']);
		expect(breakable('RC-001 Battery thermal protection')).toEqual([
			'RC-001 Battery thermal protection'
		]);
		expect(breakable('on-ground')).toEqual(['on-', 'ground']);
		expect(breakable('flightController.gnss2Fix')).toEqual([
			'flight',
			'Controller.',
			'gnss2',
			'Fix'
		]);
		expect(breakable('ABC')).toEqual(['ABC']);
	});
});
