/**
 * `elementFeatures` on the demo: what the guided forms read about an
 * element — its kinds, how another package refers to it, and its features
 * with their value types and values.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { collectElements, type ModelElement } from '#lib/project/elements.ts';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
let elements: ModelElement[];
const files = demoFiles();

beforeAll(async () => {
	host = await loadHost();
	elements = collectElements(host.analyzeProject(files));
}, 60_000);

const id = (file: string, name: string, parent?: string) =>
	elements.find((e) => e.file === file && e.name === name && (!parent || e.parent === parent))!.id!;

describe('elementFeatures', () => {
	it('describes a part of the design: kinds, reference and features with values', () => {
		const battery = id('system/DroneArchitecture.sysml', 'battery', 'drone');
		const f = host.elementFeatures(files, [battery])[battery]!;
		expect(f).toMatchObject({
			qualifiedName: 'DroneArchitecture::drone::battery',
			kind: 'part',
			isDefinition: false,
			kinds: ['DroneComponents::Battery', 'DroneComponents::Component'],
			reference: { imports: 'DroneArchitecture::drone', text: 'drone.battery' },
			usedBy: []
		});
		const mass = f.features.find((x) => x.name === 'mass')!;
		expect(mass).toMatchObject({
			kind: 'attribute',
			own: false,
			declaredBy: 'Battery',
			declaredIn: 'DroneComponents::Component',
			numeric: true,
			valueType: 'MassValue',
			value: '1100 [g]',
			evaluated: { kind: 'number', value: 1100, unit: 'g' }
		});
		expect(f.features.find((x) => x.name === 'price')).toMatchObject({
			valueType: 'Real',
			numeric: true
		});
		expect(f.features.find((x) => x.name === 'powerOut')).toMatchObject({
			kind: 'port',
			numeric: false
		});
	});

	it('gives a variant’s reference through its variation, and a definition’s usages', () => {
		const variant = id('analysis/BatteryTrade.sysml', 'lithiumPolymer');
		const def = id('system/Components.sysml', 'Rotor');
		const out = host.elementFeatures(files, [variant, def]);
		expect(out[variant]!.reference).toEqual({
			imports: 'BatteryTrade::batteryOptions',
			text: 'batteryOptions::lithiumPolymer'
		});
		expect(out[variant]!.features.find((x) => x.name === 'mass')).toMatchObject({
			own: true,
			value: '1250 [g]'
		});
		expect(out[def]!.usedBy).toEqual([
			'DroneArchitecture::drone::frontLeft',
			'DroneArchitecture::drone::frontRight',
			'DroneArchitecture::drone::rearLeft',
			'DroneArchitecture::drone::rearRight'
		]);
		const parts = out[def]!.features.filter((x) => x.kind === 'part').map((x) => [x.name, x.type]);
		expect(parts).toEqual([
			['esc', 'DroneComponents::SpeedController'],
			['motor', 'DroneComponents::Motor'],
			['propeller', 'DroneComponents::Propeller']
		]);
		expect(out[def]!.features.find((x) => x.name === 'spin')).toMatchObject({
			valueType: 'RotorSpin',
			numeric: false
		});
	});

	it('marks references and variations among a part’s parts, and a requirement’s subject', () => {
		const drone = id('system/DroneArchitecture.sysml', 'drone');
		const req = id('requirements/SystemRequirements.sysml', "'Maximum take-off mass'");
		const out = host.elementFeatures(files, [drone, req]);
		const rotors = out[drone]!.features.find((x) => x.name === 'rotors')!;
		expect(rotors).toMatchObject({
			ref: true,
			multiplicity: '4',
			value: '(frontLeft, frontRight, rearLeft, rearRight)'
		});
		expect(out[drone]!.features.find((x) => x.name === 'emptyMass')).toMatchObject({
			own: true,
			declaredIn: 'DroneArchitecture::DeliveryDrone',
			evaluated: { kind: 'number', unit: 'g' }
		});
		expect(out[req]!.features.find((x) => x.kind === 'subject')).toMatchObject({
			name: 'system',
			type: 'DroneArchitecture::DeliveryDrone',
			declaredBy: 'DroneRequirement'
		});
	});
});
