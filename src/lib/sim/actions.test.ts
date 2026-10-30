import { describe, expect, it } from 'vitest';
import { notRunSteps, parseAction, runsSomething, statements } from './actions.ts';

describe('the steps of an action', () => {
	it('splits a body into statements: at `;`, and after a block unless `else` follows', () => {
		expect(
			statements('assign a := f(1; 2); if x { assign b := 1; } else { assign b := 2; } then c')
		).toEqual(['assign a := f(1; 2)', 'if x { assign b := 1; } else { assign b := 2; }', 'then c']);
	});

	it('reads assignments, `if`, successions, sends and named actions', () => {
		expect(
			parseAction(
				'action { assign y := 5; if x > 5 { assign y := 7; } else if x > 2 { assign y := 3; } else { assign y := 0; } then send new Ping(y, z = 2) via p to self; then cleanup; first a then b; }'
			)
		).toEqual([
			{ kind: 'assign', text: 'assign y := 5', target: 'y', value: '5' },
			{
				kind: 'if',
				text: 'if x > 5 { assign y := 7; } else if x > 2 { assign y := 3; } else { assign y := 0; }',
				branches: [
					{
						condition: 'x > 5',
						steps: [{ kind: 'assign', text: 'assign y := 7', target: 'y', value: '7' }]
					},
					{
						condition: 'x > 2',
						steps: [{ kind: 'assign', text: 'assign y := 3', target: 'y', value: '3' }]
					}
				],
				otherwise: [{ kind: 'assign', text: 'assign y := 0', target: 'y', value: '0' }]
			},
			{
				kind: 'send',
				after: true,
				text: 'send new Ping(y, z = 2) via p to self',
				signal: 'Ping',
				args: ['y', 'z = 2'],
				to: 'self'
			},
			{ kind: 'succession', text: 'then cleanup', from: null, to: 'cleanup', guard: null },
			{ kind: 'succession', text: 'first a then b', from: 'a', to: 'b', guard: null }
		]);
	});

	it('names what a state machine does not run: a send elsewhere, an accept, a perform it cannot find', () => {
		const steps = parseAction(
			'action { send Sig() to p; send new Ping() to ctl; while n < 3 { assign n := n + 1; } accept Go; perform cleanup; perform monitor; }'
		);
		expect(notRunSteps(steps, ['ctl'], (target) => target === 'monitor')).toEqual([
			'send Sig() to p',
			'accept Go',
			'perform cleanup'
		]);
		expect(runsSomething(steps, ['ctl'])).toBe(true);
		expect(runsSomething(parseAction('send Sig() to p'), [])).toBe(false);
		expect(runsSomething(parseAction('monitor'), [])).toBe(false);
	});

	it('reads loops, accepts, performs, named actions, control nodes, branches and flows', () => {
		const steps = parseAction(`
			in item plan : Plan = flightPlan;
			out attribute ok : Boolean default true;
			first start;
			then action fly : FlyTo { in route = plan; }
			then fork;
				then a;
				then b;
			while n < 3 { assign n := n + 1; } until n == 2;
			loop { assign n := n - 1; } until n <= 0;
			for i : Integer in 1..3 { assign total := total + i; }
			action wait accept r : Reading via sensor;
			accept after 5 [s];
			perform drone.deliveryFlight;
			perform action check : Check { in level = 2; }
			join j;
			decide;
				if ok then a;
				else done;
			merge m;
			succession first a then b;
			flow of Parcel from a.out to b.in;
			succession flow a.x to b.y;
			subject drone : Drone;
		`);
		expect(steps.map((s) => s.kind)).toEqual([
			'feature',
			'feature',
			'first',
			'action',
			'control',
			'succession',
			'succession',
			'loop',
			'loop',
			'for',
			'accept',
			'accept',
			'perform',
			'perform',
			'control',
			'control',
			'succession',
			'succession',
			'control',
			'succession',
			'flow',
			'flow',
			'declaration'
		]);
		expect(steps[0]).toMatchObject({
			name: 'plan',
			direction: 'in',
			type: 'Plan',
			value: 'flightPlan',
			binding: true
		});
		expect(steps[1]).toMatchObject({ name: 'ok', direction: 'out', value: 'true', binding: false });
		expect(steps[3]).toMatchObject({ name: 'fly', type: 'FlyTo', after: true });
		expect(steps[4]).toMatchObject({ node: 'fork', after: true });
		expect(steps[7]).toMatchObject({ condition: 'n < 3', until: 'n == 2' });
		expect(steps[8]).toMatchObject({ condition: null, until: 'n <= 0' });
		expect(steps[9]).toMatchObject({ variable: 'i', collection: '1..3' });
		expect(steps[10]).toMatchObject({ name: 'wait', trigger: 'Reading', payload: 'r' });
		expect(steps[11]).toMatchObject({ trigger: 'after 5 [s]', payload: null });
		expect(steps[12]).toMatchObject({ target: 'drone.deliveryFlight' });
		expect(steps[13]).toMatchObject({ name: 'check', target: 'Check' });
		expect(steps[16]).toMatchObject({ from: null, to: 'a', guard: 'ok' });
		expect(steps[17]).toMatchObject({ from: null, to: 'done', guard: 'else' });
		expect(steps[19]).toMatchObject({ from: 'a', to: 'b', guard: null });
		expect(steps[20]).toMatchObject({
			from: 'a.out',
			to: 'b.in',
			item: 'Parcel',
			succession: false
		});
		expect(steps[21]).toMatchObject({ from: 'a.x', to: 'b.y', succession: true });
	});
});
