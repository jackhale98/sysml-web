/**
 * Product variants and configurations (`variability.ts`), on the real
 * toolkit: what the model leaves open, what each configuration chooses, the
 * tables, checks and diagrams of a configuration (worked out by hand), the
 * variability matrix and the problems a configuration can have.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withConfiguration } from '../configuration';
import type { SourceFile } from '../protocol';
import type { RenderedTable } from '../types';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';
import { oneLine } from './variability';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
});

const demo = demoFiles();
const STANDARD = 'DroneConfigurations::standardDrone';
const LONG_RANGE = 'DroneConfigurations::longRangeDrone';
const CONFIGURATIONS = 'system/DroneConfigurations.sysml';

const col = (t: RenderedTable, name: string) => {
	const i = t.columns.indexOf(name);
	if (i < 0) throw new Error(`no column ${name} in ${t.columns.join(', ')}`);
	return t.rows.map((r) => r[i]!);
};
/** A budget's cells by path: `{ 'drone.battery': '1 kg' }`. */
const totals = (t: RenderedTable) =>
	Object.fromEntries(col(t, 'path').map((p, i) => [p, col(t, 'total')[i]!]));
const withText = (files: SourceFile[], path: string, change: (text: string) => string) =>
	files.map((f) => (f.path === path ? { ...f, text: change(f.text) } : f));

describe('what the model leaves open', () => {
	it("finds the demo's variation points, their variants and its configurations", () => {
		const { points, configurations } = host.variability(demo);
		expect(
			points.map((p) => [
				p.qualifiedName,
				p.productLine,
				p.variation,
				p.variants.map((v) => v.name)
			])
		).toEqual([
			// The trade study's candidates: a variation in a package, no product's choice.
			[
				'BatteryTrade::batteryOptions',
				null,
				'BatteryTrade::batteryOptions',
				['lithiumPolymer', 'lithiumIon3P', 'semiSolidState']
			],
			// Usages typed by a variation definition.
			[
				'DroneConfigurations::droneFamily::battery',
				'DroneConfigurations::droneFamily',
				'DroneConfigurations::BatteryOption',
				['standardPack', 'longRangePack']
			],
			[
				'DroneConfigurations::droneFamily::radio',
				'DroneConfigurations::droneFamily',
				'DroneConfigurations::RadioOption',
				['standardRadio', 'longRangeRadio']
			]
		]);
		expect(
			configurations.map((c) => ({
				name: c.qualifiedName,
				product: c.product,
				lines: c.productLines,
				choices: c.choices.map((ch) => `${ch.point}=${ch.variant}${ch.problem ?? ''}`),
				changes: c.changes
			}))
		).toEqual([
			{
				name: STANDARD,
				product: 'DroneArchitecture::drone',
				lines: ['DroneConfigurations::droneFamily'],
				choices: ['battery=standardPack', 'radio=standardRadio'],
				changes: ['system/DroneArchitecture.sysml']
			},
			{
				name: LONG_RANGE,
				product: 'DroneArchitecture::drone',
				lines: ['DroneConfigurations::droneFamily'],
				choices: ['battery=longRangePack', 'radio=longRangeRadio'],
				changes: ['system/DroneArchitecture.sysml']
			}
		]);
	});

	it('reads a variation usage in the product itself, and a choice inherited on the way', () => {
		const files: SourceFile[] = [
			{
				path: 'car.sysml',
				text: `package Cars {
    private import SI::*;
    part def Engine { attribute mass :> ISQ::mass; }
    part car {
        variation part engine : Engine {
            variant part small : Engine { attribute :>> mass = 120 [kg]; }
            variant part big : Engine { attribute :>> mass = 180 [kg]; }
        }
        part body { attribute mass :> ISQ::mass = 900 [kg]; }
    }
    part smallCar :> car { part :>> engine = car::engine::small; }
    part smallSportsCar :> smallCar;
}`
			}
		];
		const { points, configurations } = host.variability(files);
		expect(points.map((p) => [p.name, p.productLine, p.variants.map((v) => v.name)])).toEqual([
			['engine', 'Cars::car', ['small', 'big']]
		]);
		expect(configurations.map((c) => [c.name, c.choices.map((ch) => ch.variant)])).toEqual([
			['smallCar', ['small']],
			// Specializes `smallCar`, whose choice it keeps.
			['smallSportsCar', ['small']]
		]);
		expect(host.analyzeProject(files).flatMap((a) => a.diagnostics)).toEqual([]);
	});

	it('reads a product line that is a definition', () => {
		const files: SourceFile[] = [
			{
				path: 'lamp.sysml',
				text: `package Lamps {
    part def Bulb;
    variation part def BulbChoice :> Bulb {
        variant part led : Bulb;
        variant part halogen : Bulb;
    }
    part def Lamp { part bulb : BulbChoice; }
    part desk : Lamp { part :>> bulb = BulbChoice::led; }
}`
			}
		];
		const { configurations } = host.variability(files);
		expect(configurations.map((c) => [c.name, c.productLines, c.choices])).toEqual([
			['desk', ['Lamps::Lamp'], [expect.objectContaining({ point: 'bulb', variant: 'led' })]]
		]);
	});

	it('has nothing to say about a model without variants', () => {
		const files = [{ path: 'p.sysml', text: 'package P { part def A; part a : A; }' }];
		expect(host.variability(files)).toEqual({ points: [], configurations: [] });
	});
});

describe('a configuration shown', () => {
	it("gives the long-range drone's mass budget, worked out by hand", () => {
		const asWritten = totals(host.renderView(demo, 'droneMassBudget'));
		const longRange = totals(
			host.renderView(withConfiguration(demo, LONG_RANGE), 'droneMassBudget')
		);
		// Today's drone: 2.77 kg empty, 3.77 kg with the 1 kg payload.
		expect(asWritten).toMatchObject({
			'drone.battery': '1100 g',
			'drone.radio': '30 g',
			'drone.emptyMass': '2.77 kg',
			'drone.takeOffMass': '3.77 kg'
		});
		// The semi-solid-state pack (1000 g instead of 1100 g) and the long-range radio (75 g
		// instead of 30 g): 2.77 kg - 0.1 kg + 0.045 kg = 2.715 kg empty, 3.715 kg at take-off.
		expect(longRange).toMatchObject({
			'drone.battery': '1000 g',
			'drone.radio': '75 g',
			'drone.emptyMass': '2.715 kg',
			'drone.takeOffMass': '3.715 kg'
		});
		// The standard drone is the drone as it flies today.
		expect(totals(host.renderView(withConfiguration(demo, STANDARD), 'droneMassBudget'))).toEqual(
			asWritten
		);
	});

	it('gives its power budget and checks', () => {
		const power = (files: SourceFile[]) =>
			totals(host.renderView(files, 'dronePowerBudget'))['drone'];
		// The radio draws 9 W instead of 4 W: 397 W + 5 W.
		expect(power(demo)).toBe('397 W');
		expect(power(withConfiguration(demo, LONG_RANGE))).toBe('402 W');
		const endurance = (files: SourceFile[]) =>
			host
				.checks(files)
				.checks.find((c) => c.requirement?.id === 'SYS-001')!
				.values.find((v) => v.feature === 'drone.endurance')!.value;
		// 216 W*h x 0.85 / 400 W = 27.54 min today; 260 W*h x 0.9 / 400 W = 35.1 min.
		expect(endurance(demo)).toMatchObject({ value: 1652.4, unit: 's' });
		expect(endurance(withConfiguration(demo, LONG_RANGE))).toMatchObject({
			value: 2106,
			unit: 's'
		});
	});

	it('shows the chosen variants in the bill of materials and the diagrams', () => {
		const bom = host.renderView(withConfiguration(demo, LONG_RANGE), 'droneBillOfMaterials');
		const asWritten = host.renderView(demo, 'droneBillOfMaterials');
		expect(bom.rows).toHaveLength(asWritten.rows.length);
		const description = (t: RenderedTable, path: string) =>
			col(t, 'description')[col(t, 'path').indexOf(path)];
		expect(description(bom, 'drone.battery')).toBe(
			'longRangePack: The semi-solid-state pack the battery trade study selects.'
		);
		expect(description(asWritten, 'drone.battery')).toBe(
			'Six-cell lithium-ion pack with a built-in battery management system.'
		);
		// Every other element is where it is written: the rewritten part keeps its lines.
		const line = (t: RenderedTable, path: string) => t.sources[col(t, 'path').indexOf(path)]!.line;
		for (const path of ['drone.radio', 'drone.camera', 'drone.payloadRelease'])
			expect(line(bom, path)).toBe(line(asWritten, path));
		expect(bom.configurable).toBe(true);

		const general = host.diagram('general', withConfiguration(demo, LONG_RANGE), 'drone');
		expect(general.nodes.find((n) => n.id === 'drone.radio')?.attributes).toEqual([
			['attribute', 'mass = 75 [g]'],
			['attribute', 'powerDraw = 9 [W]'],
			['attribute', 'range = 30 [km]']
		]);
		const ports = host.diagram('interconnection', withConfiguration(demo, LONG_RANGE), 'drone');
		const drawn = host.diagram('interconnection', demo, 'drone');
		expect(ports.nodes.map((n) => n.id)).toEqual(drawn.nodes.map((n) => n.id));
		expect(ports.edges).toHaveLength(drawn.edges.length);
	});

	it('leaves the model as written as it was', () => {
		const before = host.analyzeProject(demo);
		const budget = host.renderView(demo, 'droneMassBudget');
		host.renderView(withConfiguration(demo, LONG_RANGE), 'droneMassBudget');
		// The analysed model is the same one, as written, with no problems.
		expect(host.analyzeProject(demo)).toEqual(before);
		expect(before.flatMap((a) => a.diagnostics)).toEqual([]);
		expect(host.renderView(demo, 'droneMassBudget')).toEqual(budget);
		// An unknown configuration is the model as written; a table that doesn't read the
		// product's values can't show one.
		expect(host.renderView(withConfiguration(demo, 'noSuchDrone'), 'droneMassBudget')).toEqual(
			budget
		);
		expect(host.renderView(demo, 'systemRequirements').configurable).toBeUndefined();
	});

	it('writes the rewritten part on one line', () => {
		expect(
			oneLine(`part x : T { // a comment
    /* a doc
     * on two lines */
    attribute :>> name = "two  spaces";
}`)
		).toBe('part x : T { /* a doc on two lines */ attribute :>> name = "two  spaces"; }');
	});
});

describe('the variability matrix', () => {
	it('lists each configuration with the variant it chooses for each point', () => {
		const t = host.renderView(demo, 'droneVariants');
		expect(t.columns).toEqual(['configuration', 'battery', 'radio', 'description']);
		expect(t.rows).toEqual([
			['standardDrone', 'standardPack', 'standardRadio', 'The drone as it flies today.'],
			[
				'longRangeDrone',
				'longRangePack',
				'longRangeRadio',
				'Further and longer: the semi-solid-state pack and the long-range radio.'
			]
		]);
		expect(t.sources.map((s) => s.element)).toEqual([STANDARD, LONG_RANGE]);
	});
});

describe('problems of a configuration', () => {
	const broken = withText(demo, CONFIGURATIONS, (text) =>
		text.replace(
			/}\s*$/,
			`
    part openDrone :> droneFamily {
        part :>> radio = RadioOption::longRangeRadio;
    }
    part wrongDrone :> droneFamily {
        part :>> battery = batteryOptions::lithiumPolymer;
        part :>> radio = RadioOption::longRangeRadio;
        part :>> radio = RadioOption::standardRadio;
    }
    part listDrone :> droneFamily {
        part :>> battery = (BatteryOption::standardPack, BatteryOption::longRangePack);
        part :>> radio = RadioOption::longRangeRadio;
    }
}
`
		)
	);
	const text = broken.find((f) => f.path === CONFIGURATIONS)!.text;
	const lineOf = (needle: string) => text.slice(0, text.lastIndexOf(needle)).split('\n').length;

	it('are listed: a point left open, a choice that is no variant, two choices', () => {
		const problems = host
			.analyzeProject(broken)
			.flatMap((a) => a.diagnostics)
			.filter((d) => d.code === 'variability')
			.map((d) => [d.span.start_row, d.severity, d.message]);
		expect(problems).toEqual([
			[
				lineOf('part openDrone'),
				'warning',
				'`openDrone` leaves the variation point `battery` open: choose one of its variants (`standardPack`, `longRangePack`) with `:>> battery = …`'
			],
			[
				lineOf('part :>> battery = batteryOptions::lithiumPolymer'),
				'warning',
				'`wrongDrone`: `batteryOptions::lithiumPolymer` is not one of the variants of `battery` (`standardPack`, `longRangePack`)'
			],
			[
				lineOf('part :>> radio = RadioOption::standardRadio'),
				'warning',
				'`wrongDrone` chooses for `radio` more than once: a configuration picks one variant for each variation point'
			],
			[
				lineOf('part :>> battery = (BatteryOption'),
				'warning',
				'`listDrone`: `battery` is bound to 2 elements (`BatteryOption::standardPack`, `BatteryOption::longRangePack`): a configuration picks one variant'
			]
		]);
		host.analyzeProject(demo);
	});

	it('are marked in the matrix', () => {
		const t = host.renderView(broken, 'droneVariants');
		const row = col(t, 'configuration').indexOf('wrongDrone');
		expect(t.rows[row]).toEqual(['wrongDrone', '', 'longRangeRadio', '']);
		expect(t.rowInfo?.[row]?.problems).toEqual({
			1: '`batteryOptions::lithiumPolymer` is not one of the variants of `battery` (`standardPack`, `longRangePack`)',
			2: '`radio` is chosen 2 times: a configuration picks one variant for each variation point'
		});
		// Showing it makes only its sound choices: the battery stays as written.
		const budget = totals(
			host.renderView(withConfiguration(broken, 'wrongDrone'), 'droneMassBudget')
		);
		expect(budget['drone.battery']).toBe('1100 g');
		host.analyzeProject(demo);
	});
});
