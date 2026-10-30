import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from './host';
import { bodyOf } from './flows';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

describe('actions to run', () => {
	it('lists every action, and offers to run the ones in a package with steps', () => {
		const flows = host.actionFlows(demoFiles());
		expect(flows.filter((f) => f.runnable).map((f) => [f.qualifiedName, f.keyword])).toEqual([
			['DeliveryMission::DeliverParcel', 'use case def'],
			['DeliveryMission::DeliveryFlight', 'action def']
		]);
		// The FMEA's mitigations are actions too, with values only: not offered.
		const mitigation = flows.find((f) => f.name === 'dropZoneScan')!;
		expect(mitigation).toMatchObject({ runnable: false, type: 'RiskAnalysis::Mitigation' });
		// A performed usage names its definition, whose steps it runs.
		expect(
			flows.find((f) => f.qualifiedName === 'DroneArchitecture::DeliveryDrone::deliveryFlight')
		).toMatchObject({
			keyword: 'perform action',
			type: 'DeliveryMission::DeliveryFlight'
		});
	});

	it('reads a body without its docs and comments', () => {
		expect(
			bodyOf('action def A {\n doc /* one; two */\n // a note\n first start; /* x */ then a; }')
		).toBe('first start;   then a;');
		expect(bodyOf('action a;')).toBe('');
	});

	it('gives a machine the actions it performs, and drops the note that said they are not run', () => {
		const files = [
			{
				path: 'model.sysml',
				text: `package P {
                    action def Beep { attribute n : Integer = 0; first start; then assign n := 1; }
                    state def M { entry; then s; state s { entry action { perform Beep; } } state t { entry action { perform Missing; } } }
                }`
			}
		];
		const machine = host.stateMachines(files).find((m) => m.name === 'M')!;
		expect(Object.keys(machine.actions ?? {})).toEqual(['Beep']);
		expect(machine.warnings).toEqual(['entry action of `t`: `perform Missing` is not run']);
	});
});
