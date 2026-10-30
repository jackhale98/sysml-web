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
				text: 'send new Ping(y, z = 2) via p to self',
				signal: 'Ping',
				args: ['y', 'z = 2'],
				to: 'self',
				via: 'p'
			},
			{ kind: 'named', text: 'cleanup' },
			{ kind: 'named', text: 'first a then b' }
		]);
	});

	it('names what it does not run: a send elsewhere, loops, accepts', () => {
		const steps = parseAction(
			'action { send Sig() to p; send new Ping() to ctl; while n < 3 { assign n := n + 1; } accept Go; }'
		);
		expect(notRunSteps(steps, ['ctl'])).toEqual([
			'send Sig() to p',
			'while n < 3 { assign n := n + 1; }',
			'accept Go'
		]);
		expect(runsSomething(steps, ['ctl'])).toBe(true);
		expect(runsSomething(parseAction('send Sig() to p'), [])).toBe(false);
		expect(runsSomething(parseAction('monitor'), [])).toBe(false);
	});
});
