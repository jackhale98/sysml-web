/**
 * Values and verdicts on the demo and on small models, through the host the
 * worker runs: `checks` (the toolkit's `verify`, mapped), `evaluate`, and the
 * budget and checks tables.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inputsText } from '#lib/project/checks.ts';
import type { SourceFile } from '../protocol';
import type { Check } from '../types';
import { chainsIn, comparisonOf, referencesIn } from './evaluation';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
const files = demoFiles();
const edit = (path: string, from: string, to: string): SourceFile[] =>
	files.map((f) => {
		if (f.path !== path) return f;
		expect(f.text).toContain(from);
		return { ...f, text: f.text.replace(from, to) };
	});
const byId = (checks: Check[], id: string) => checks.find((c) => c.requirement?.id === id)!;

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(files);
}, 60_000);

describe('the demo’s checks', () => {
	it('decides the requirements stated as constraints', () => {
		const report = host.checks(files);
		const checkable = report.checks.filter((c) => c.checkable && c.kind !== 'assert');
		expect(checkable.map((c) => [c.requirement?.id, c.status])).toEqual([
			['SYS-001', 'satisfied'],
			['SYS-002', 'satisfied'],
			['SYS-003', 'satisfied'],
			// A reliability requirement: decided from the reliability budget (`views/reliability.ts`).
			['REL-001', 'satisfied']
		]);
		// Requirements in words only are listed, with nothing to check.
		const words = report.checks.filter((c) => !c.checkable);
		expect(words).toHaveLength(13);
		expect(words.every((c) => c.status === 'undecided' && c.kind === 'satisfy')).toBe(true);
		// The libraries' type invariants (`that >= 1 and that <= 10`) hold and are left out; the
		// risk review flags the camera's FMEA line (unacceptable, no verified control).
		expect(report.checks.filter((c) => c.kind === 'assert').map((c) => c.by)).toEqual([
			'drone::camera',
			'drone::camera'
		]);
		expect(report.summary).toEqual({ satisfied: 4, violated: 2, undecided: 13 });
	});

	it('gives the values, the limit and the margin of a met requirement', () => {
		const endurance = byId(host.checks(files).checks, 'SYS-001');
		expect(endurance).toMatchObject({
			kind: 'satisfy',
			by: 'drone',
			constraint: 'system.endurance >= 25 [min]',
			file: 'system/Satisfaction.sysml',
			span: { start_row: 12 },
			constraintAt: { file: 'requirements/SystemRequirements.sysml', span: { start_row: 32 } },
			requirement: {
				name: 'Flight endurance',
				qualifiedName: "SystemRequirements::'Flight endurance'",
				id: 'SYS-001'
			},
			limit: { feature: 'drone.endurance', operator: '>=', value: 25, unit: 'min' },
			explanation: 'Met: drone.endurance = 27.54 min (needs ≥ 25 min).'
		});
		// 216 W·h × 0.85 / 400 W = 0.459 h, with what each value is worked out from.
		expect(endurance.values).toEqual([
			{
				feature: 'drone.endurance',
				value: { kind: 'number', value: 1652.4, unit: 's' },
				from: {
					expression: 'HoverEndurance(battery.usableEnergy, hoverPower)',
					writtenIn: null,
					isDefault: false,
					inputs: [
						{
							feature: 'battery.usableEnergy',
							value: { kind: 'number', value: 183.6, unit: 'W*h' },
							from: {
								expression: 'capacity * usableFraction',
								writtenIn: 'Battery',
								isDefault: false,
								inputs: [
									{
										feature: 'capacity',
										value: { kind: 'number', value: 216, unit: 'W*h' },
										from: {
											expression: '216 [W*h]',
											writtenIn: 'Battery',
											isDefault: true,
											inputs: []
										}
									},
									{
										feature: 'usableFraction',
										value: { kind: 'number', value: 0.85, unit: null },
										from: { expression: '0.85', writtenIn: 'Battery', isDefault: true, inputs: [] }
									}
								]
							}
						},
						{
							feature: 'hoverPower',
							value: { kind: 'number', value: 400, unit: 'W' },
							from: { expression: '400 [W]', writtenIn: null, isDefault: false, inputs: [] }
						}
					]
				}
			}
		]);
		expect(inputsText(endurance)).toBe(
			'drone.endurance = HoverEndurance(battery.usableEnergy, hoverPower), with battery.usableEnergy = 183.6 W·h (capacity * usableFraction in Battery, with capacity = 216 W·h (default in Battery) and usableFraction = 0.85 (default in Battery)) and hoverPower = 400 W'
		);
		expect(endurance.margin!.value).toBeCloseTo(2.54);
		expect(endurance.margin!.unit).toBe('min');
		expect(endurance.margin!.ratio).toBeCloseTo(0.1016);
		const payload = byId(host.checks(files).checks, 'SYS-002');
		expect(payload.margin).toEqual({ value: 0, unit: 'kg', ratio: 0 });
	});

	it('decides the take-off mass over the four named rotors', () => {
		const mass = byId(host.checks(files).checks, 'SYS-003');
		expect(mass).toMatchObject({
			status: 'satisfied',
			limit: { feature: 'drone.takeOffMass', operator: '<=', value: 4, unit: 'kg' },
			values: [{ feature: 'drone.takeOffMass', value: { kind: 'number', value: 3770, unit: 'g' } }],
			explanation: 'Met: drone.takeOffMass = 3.77 kg (needs ≤ 4 kg).'
		});
		// The toolkit adds the rotors up itself: `rotors` refers to four parts.
		expect(mass.byApp).toBeUndefined();
		expect(mass.margin!.value).toBeCloseTo(0.23);
		expect(mass.margin!.ratio).toBeCloseTo(0.0575);

		// Heavier motors (190 g): four rotors of 250 g put the drone at 4.05 kg.
		const edited = edit('system/Components.sysml', 'mass = 120 [g]', 'mass = 190 [g]');
		host.analyzeProject(edited);
		const heavy = byId(host.checks(edited).checks, 'SYS-003');
		expect(heavy.status).toBe('violated');
		expect(heavy.margin!.value).toBeCloseTo(-0.05);
		host.analyzeProject(files);
	});

	it('reports a violation, with the values, when a value changes', () => {
		const edited = edit(
			'system/DroneArchitecture.sysml',
			'attribute :>> hoverPower = 400 [W]',
			'attribute :>> hoverPower = 450 [W]'
		);
		host.analyzeProject(edited);
		const endurance = byId(host.checks(edited).checks, 'SYS-001');
		expect(endurance.status).toBe('violated');
		expect(endurance.margin!.value).toBeCloseTo(-0.52);
		expect(endurance.explanation).toBe('Not met: drone.endurance = 24.48 min (needs ≥ 25 min).');
		host.analyzeProject(files);
		expect(byId(host.checks(files).checks, 'SYS-001').status).toBe('satisfied');
	});

	it('says why a requirement is undecided when its value is a division by zero', () => {
		const edited = edit(
			'system/DroneArchitecture.sysml',
			'attribute :>> hoverPower = 400 [W]',
			'attribute :>> hoverPower = 0 [W]'
		);
		host.analyzeProject(edited);
		const endurance = byId(host.checks(edited).checks, 'SYS-001');
		expect(endurance).toMatchObject({
			status: 'undecided',
			undecided: 'fault',
			explanation: 'drone.endurance cannot be worked out: division by zero.'
		});
		host.analyzeProject(files);
	});

	it('lists a requirement constraint nothing claims to satisfy', () => {
		const edited = edit(
			'system/Satisfaction.sysml',
			"satisfy 'Payload capacity' by drone;",
			'// (removed)'
		);
		const payload = byId(host.checks(edited).checks, 'SYS-002');
		expect(payload).toMatchObject({
			kind: 'require',
			status: 'undecided',
			constraint: 'system.payloadCapacity >= 1 [kg]',
			file: 'requirements/SystemRequirements.sysml'
		});
		expect(payload.explanation).toMatch(/^Nothing in the design claims to satisfy/);
		host.analyzeProject(files);
	});

	it('costs little, once per analysis', () => {
		const edited = edit('system/Components.sysml', '650 [g]', '651 [g]');
		host.analyzeProject(edited);
		const started = performance.now();
		host.checks(edited);
		const first = performance.now() - started;
		const again = performance.now();
		host.checks(edited);
		expect(performance.now() - again).toBeLessThan(1);
		// About 50 ms in Node (a session without metadata, then `verify`); generous for CI.
		expect(first).toBeLessThan(1500);
		host.analyzeProject(files);
	});
});

describe('evaluated values', () => {
	const ids = (qualified: string[]) => {
		const records = (
			host as unknown as {
				built: { extracted: { elements: { id: string; qualifiedName: string | null }[] } };
			}
		).built.extracted.elements;
		return qualified.map((q) => records.find((r) => r.qualifiedName === q)!.id);
	};

	it('evaluates expressions, with units, in a batch', () => {
		const [rotor, energy, endurance, fraction, kind] = ids([
			'DroneComponents::Rotor::mass',
			'DroneComponents::Battery::usableEnergy',
			'DroneArchitecture::drone::endurance',
			'DroneComponents::Battery::usableFraction',
			"SystemRequirements::'Flight endurance'::kind"
		]);
		const values = host.evaluate(files, [rotor!, energy!, endurance!, fraction!, kind!, 'nope']);
		expect(values[rotor!]).toEqual({ kind: 'number', value: 180, unit: 'g' });
		expect(values[energy!]).toEqual({ kind: 'number', value: 183.6, unit: 'W*h' });
		expect(values[endurance!]).toEqual({ kind: 'number', value: 1652.4, unit: 's' });
		expect(values[fraction!]).toEqual({ kind: 'number', value: 0.85, unit: null });
		expect(values[kind!]).toEqual({ kind: 'text', text: 'performance' });
		expect(values.nope).toBeUndefined();
	});

	it('says why a value is undecided', () => {
		const [takeOff, empty] = ids([
			'DroneArchitecture::DeliveryDrone::takeOffMass',
			'DroneArchitecture::drone::emptyMass'
		]);
		const values = host.evaluate(files, [takeOff!, empty!]);
		// In the definition, nothing gives the empty mass a value.
		expect(values[takeOff!]).toEqual({
			kind: 'undecided',
			reason: '`emptyMass` has no value in `DeliveryDrone`'
		});
		// In the drone, the app adds up its 4 rotors (see the next test).
		expect(values[empty!]).toMatchObject({ kind: 'number', value: 2770, unit: 'g' });
	});

	it('evaluates the values a part inherits although metadata annotates it', () => {
		// The FMEA annotates `drone::battery`; the toolkit 0.10 refuses `battery.usableEnergy` then.
		const [endurance] = ids(['DroneArchitecture::drone::endurance']);
		const built = (host as unknown as { built: { session: import('./api').TkSession } }).built;
		const handle = built.session.elementById(endurance!)!;
		// The analysed session (with the annotations): refused. When this starts to pass, the
		// toolkit is fixed and the evaluation session (evaluation.ts) can go.
		expect(() => built.session.evaluate(handle)).toThrow(/receiver identity/);
		handle.free();
		expect(host.evaluate(files, [endurance!])[endurance!]).toMatchObject({ kind: 'number' });
	});
});

describe('checks on small models', () => {
	const model = (text: string) => [{ path: 'm.sysml', text }];

	it('adds up a value over a collection of parts only while the toolkit cannot', () => {
		const text = [
			'package P {',
			'    private import SI::*;',
			'    part def Wheel { attribute mass :> ISQ::mass = 9 [kg]; }',
			'    part def Car {',
			'        part wheels : Wheel[4];',
			'        attribute body :> ISQ::mass = 1200 [kg];',
			'        attribute total :> ISQ::mass = body + sum(wheels.mass);',
			'        assert constraint light { total <= 1250 [kg] }',
			'    }',
			'}',
			''
		].join('\n');
		const files = model(text);
		host.analyzeProject(files);
		const [check] = host.checks(files).checks;
		expect(check).toMatchObject({
			kind: 'assert',
			status: 'satisfied',
			values: [{ feature: 'total', value: { kind: 'number', value: 1236, unit: 'kg' } }]
		});
		// When this fails because `byApp` is gone, the toolkit sums over collections itself:
		// remove the app's sums from evaluation.ts (and this test's expectation of them).
		expect(check!.byApp).toBe('the app added up the 4 `wheels`');
		host.analyzeProject(demoFiles());
	});

	it('says to give a value when a limit reads one that has none', () => {
		const text = [
			'package P {',
			'    private import SI::*;',
			'    part def System { attribute mass :> ISQ::mass; }',
			'    part system : System;',
			"    requirement <'REQ-002'> 'Light enough to carry' {",
			'        subject system : System;',
			'        require constraint { system.mass <= 12 [kg] }',
			'    }',
			"    satisfy 'Light enough to carry' by system;",
			'}',
			''
		].join('\n');
		const files = model(text);
		host.analyzeProject(files);
		const check = byId(host.checks(files).checks, 'REQ-002');
		expect(check).toMatchObject({
			status: 'undecided',
			values: [{ feature: 'system.mass', value: { kind: 'undecided', reason: 'it has no value' } }]
		});
		expect(check.explanation).toBe(
			'system.mass has no value yet: give it one and the check will say whether it is met.'
		);
		host.analyzeProject(demoFiles());
	});

	it('maps an assertion’s byte positions to UTF-16 after multi-byte text', () => {
		const text =
			"package P { private import SI::*; part def 'Wärmeöäü' { attribute x :> ISQ::mass = 1 [kg]; assert constraint light { x <= 0.5 [kg] } } }\n";
		const files = model(text);
		host.analyzeProject(files);
		const [check] = host.checks(files).checks;
		expect(check).toMatchObject({
			kind: 'assert',
			status: 'violated',
			name: 'light',
			by: 'Wärmeöäü',
			constraint: 'x <= 0.5 [kg]',
			values: [{ feature: 'x', value: { kind: 'number', value: 1, unit: 'kg' } }],
			margin: { value: -0.5, unit: 'kg', ratio: -1 }
		});
		expect(text.slice(check!.span.from, check!.span.to)).toBe('x <= 0.5 [kg]');
		expect(check!.explanation).toBe('Not met: x = 1 kg (needs ≤ 0.5 kg).');
	});

	it('blanks metadata without moving anything', () => {
		const text = [
			'package P {',
			'    private import SI::*;',
			'    metadata def Note { attribute text : ScalarValues::String; }',
			'    part def Box { attribute mass :> ISQ::mass = 2 [kg]; @Note { text = "größer"; } }',
			'    part shelf { part box : Box; attribute load :> ISQ::mass = box.mass; assert constraint { load <= 1.5 [kg] } }',
			'    @Note about shelf::box { text = "für Bücher"; }',
			'}',
			''
		].join('\n');
		const files = model(text);
		host.analyzeProject(files);
		const [check] = host.checks(files).checks;
		expect(check).toMatchObject({ status: 'violated', constraint: 'load <= 1.5 [kg]' });
		expect(text.slice(check!.span.from, check!.span.to)).toBe('load <= 1.5 [kg]');
		host.analyzeProject(demoFiles());
	});
});

describe('the budget and checks tables', () => {
	it('adds up the mass budget over the parts tree', () => {
		const table = host.renderView(files, 'droneMassBudget');
		expect(table.columns).toEqual([
			'path',
			'type',
			'quantity',
			'each',
			'total',
			'share',
			'limit',
			'margin',
			'check'
		]);
		const row = (path: string) => table.rows.find((r) => r[0] === path)!;
		expect(row('drone').slice(0, 6)).toEqual([
			'drone',
			'DeliveryDrone',
			'1',
			'2770 g',
			'2770 g',
			'100 %'
		]);
		expect(row('drone.frontLeft').slice(0, 6)).toEqual([
			'drone.frontLeft',
			'Rotor',
			'1',
			'180 g',
			'180 g',
			'6.5 %'
		]);
		expect(row('drone.frontLeft.motor').slice(2, 5)).toEqual(['1', '120 g', '120 g']);
		expect(row('drone.payloadCapacity').slice(4)).toEqual([
			'1 kg',
			'',
			'≥ 1 kg',
			'0 kg (0 %)',
			'satisfied'
		]);
		expect(row('drone.takeOffMass').slice(4)).toEqual([
			'3.77 kg',
			'',
			'≤ 4 kg',
			'0.23 kg (5.8 %)',
			'satisfied'
		]);
		// The parts first, then the drone's own masses.
		expect(table.rows.map((r) => r[0]).slice(-3)).toEqual([
			'drone.emptyMass',
			'drone.payloadCapacity',
			'drone.takeOffMass'
		]);
		expect(table.columnKinds).toEqual([
			'tree',
			null,
			'number',
			'quantity',
			'quantity',
			'percent',
			'quantity',
			'quantity',
			'check'
		]);
		const drone = table.rows.findIndex((r) => r[0] === 'drone');
		expect(table.rowInfo![drone]).toEqual({
			depth: 0,
			role: 'rollup',
			notes: { 3: 'the sum of its parts' }
		});
		const takeOff = table.rowInfo![table.rows.findIndex((r) => r[0] === 'drone.takeOffMass')]!;
		expect(takeOff.role).toBe('attribute');
		expect(takeOff.notes).toBeUndefined();
	});

	it('leaves parts that draw no power out of the power budget', () => {
		const table = host.renderView(files, 'dronePowerBudget');
		const paths = table.rows.map((r) => r[0]);
		expect(paths).not.toContain('drone.airframe');
		expect(paths).not.toContain('drone.frontLeft.propeller');
		// `rotors` refers to the four rotors: they are counted once, where they are owned.
		expect(paths).not.toContain('drone.rotors');
		const row = (path: string) => table.rows.find((r) => r[0] === path)!;
		expect(row('drone').slice(3, 5)).toEqual(['397 W', '397 W']);
		expect(row('drone.rearRight').slice(2, 5)).toEqual(['1', '95 W', '95 W']);
		expect(row('drone.hoverPower')[4]).toBe('400 W');
	});

	it('lists the checks that have something to check, violations first', () => {
		const table = host.renderView(files, 'designChecks');
		expect(table.opensText).toBe(true);
		expect(table.rows.map((r) => [r[0], r[1]])).toEqual([
			['violated', ''],
			['violated', ''],
			['satisfied', 'SYS-001'],
			['satisfied', 'SYS-002'],
			['satisfied', 'SYS-003'],
			['satisfied', 'REL-001']
		]);
		expect(table.rows[2]).toEqual([
			'satisfied',
			'SYS-001',
			'Flight endurance',
			'drone',
			'2.54 min (10 %)',
			'Met: drone.endurance = 27.54 min (needs ≥ 25 min).',
			// What the value comes from: the expression, where it's written, the values it reads.
			'drone.endurance = HoverEndurance(battery.usableEnergy, hoverPower), with battery.usableEnergy = 183.6 W·h (capacity * usableFraction in Battery, with capacity = 216 W·h (default in Battery) and usableFraction = 0.85 (default in Battery)) and hoverPower = 400 W'
		]);
		expect(table.sources[2]).toMatchObject({ file: 'system/Satisfaction.sysml', line: 12 });
		expect(typeof table.sources[2]!.byte).toBe('number');
	});
});

describe('reading expressions', () => {
	it('finds feature chains and references', () => {
		expect(chainsIn('drone.endurance >= 25 [min] and x.y.z < "a.b"')).toEqual([
			'drone.endurance',
			'x.y.z'
		]);
		expect(referencesIn('HoverEndurance(battery.usableEnergy, hoverPower) * 2 [SI::h]')).toEqual([
			'battery.usableEnergy',
			'hoverPower'
		]);
		expect(referencesIn('if a then b else ISQ::mass')).toEqual(['a', 'b']);
	});

	it('reads a comparison with a limit either way round', () => {
		expect(comparisonOf('drone.takeOffMass <= 4 [kg]')).toEqual({
			feature: 'drone.takeOffMass',
			operator: '<=',
			limit: { value: 4, unit: 'kg' }
		});
		expect(comparisonOf('25 [min] <= drone.endurance')).toEqual({
			feature: 'drone.endurance',
			operator: '>=',
			limit: { value: 25, unit: 'min' }
		});
		expect(comparisonOf('a + b <= 4')).toBeNull();
	});
});
