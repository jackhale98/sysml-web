/**
 * State machines read from the toolkit's model (`machines.ts`): the forms
 * the emulator runs and the texts in its conventions, on small sources, the
 * demo and the emulator's test machines (`#lib/sim/fixtures.ts`, which
 * `sim/semantics.test.ts` also checks).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COUNTER, DRONE, LAMP, MISSION, NESTED } from '#lib/sim/fixtures.ts';
import type { SourceFile } from '../protocol';
import type { StateMachine } from '../types';
import type { ToolkitHost } from './host';
import { actionText, transitionParts, triggerText, writtenType } from './machines';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const one = (text: string): SourceFile[] => [{ path: 'model.sysml', text }];
const machine = (text: string, name: string): StateMachine => {
	const found = host.stateMachines(one(text)).find((m) => m.name === name);
	if (!found) throw new Error(`no machine ${name}`);
	return found;
};
const state = (m: StateMachine, name: string) => m.states.find((s) => s.name === name);

const FORMS = `package F {
    private import ScalarValues::*;
    item def Go; item def Sig;
    part def Dev { port p; }
    state def M parallel {
        doc /* Two regions. */
        in attribute x : Integer = 1 { doc /* The x. */ }
        out attribute y : Real;
        attribute z : Nope;
        state r1 {
            entry; then a;
            state a;
            accept Go then b;
            state b {
                entry action { assign x := x + 1; assign y := 2; }
                do send Sig() to p;
                exit action cleanup;
            }
            transition first b accept s : Sig via p if x > 2 do action { assign x := 0; } then a;
            transition b then c;
            transition t2 first c accept after 5 [s] then a;
            transition t3 first c accept at 10 [s] do assign y := 1 then done; // then x
            state c;
        }
        state r2 {
            entry; then q;
            state q;
            transition first q accept Go do action inc then q;
            transition first q //* if */ if x > 3 then done;
        }
    }
    part d : Dev {
        attribute soc : Real = 0.5;
        exhibit state modes {
            entry; then off;
            state off;
            state on {
                entry; then idle;
                state idle; state spinning;
            }
            transition first off accept when soc > 0.2 then on.spinning;
            transition first on.idle accept Stop then off;
            transition first off accept Bad then nowhere;
        }
    }
    part e { state leaf; state other { doc /* No substates. */ } }
}`;

describe('state machines from the toolkit', () => {
	it('finds machines: state defs, and state usages with states of their own', () => {
		const names = host.stateMachines(one(FORMS)).map((m) => m.qualifiedName ?? m.name);
		expect(names).toEqual(['F::M', 'F::d::modes']);
	});

	it('marks a parallel state def parallel (`state def M parallel`)', () => {
		const m = machine(FORMS, 'M');
		expect(m.parallel).toBe(true);
		expect(m.doc).toBe('Two regions.');
		expect(m.states.filter((s) => !s.parent).map((s) => s.name)).toEqual(['r1', 'r2']);
	});

	it('nests states by path, with initial and final states per region', () => {
		const m = machine(FORMS, 'M');
		expect(m.states.map((s) => [s.name, s.kind, s.parent ?? null])).toEqual([
			['r1', 'state', null],
			['r1.entry', 'initial', 'r1'],
			['r1.a', 'state', 'r1'],
			['r1.b', 'state', 'r1'],
			['r1.c', 'state', 'r1'],
			['r2', 'state', null],
			['r2.entry', 'initial', 'r2'],
			['r2.q', 'state', 'r2'],
			['r1.done', 'final', 'r1'],
			['r2.done', 'final', 'r2']
		]);
		// The initial state is where `entry; then a;` is written.
		expect(state(m, 'r1.entry')!.line).toBe(11);
		// The simulator runs sends to the machine itself only, and says so for this one (through a port).
		expect(m.warnings).toEqual([
			'do action of `b`: `send Sig() to p` is not run; only signals sent to the machine itself are'
		]);
	});

	it('reads entry, do and exit actions in the emulator’s conventions', () => {
		const b = state(machine(FORMS, 'M'), 'r1.b')!;
		expect(b).toMatchObject({
			entry: 'assign x := x + 1; assign y := 2',
			do: 'send Sig() to p',
			exit: 'cleanup',
			line: 14
		});
	});

	it('reads every transition form: sources, triggers, guards, effects, targets', () => {
		const m = machine(FORMS, 'M');
		expect(m.transitions.map((t) => ({ ...t, line: undefined }))).toEqual([
			{ from: 'r1.entry', to: 'r1.a' },
			// `accept Go then b;` after `state a;` leaves `a`.
			{ from: 'r1.a', to: 'r1.b', trigger: 'Go' },
			// `s : Sig`: the signal is named `s`, for guards and effects that read its values;
			// `via p`: it must come in at the port `p`.
			{
				from: 'r1.b',
				to: 'r1.a',
				trigger: 'Sig',
				payload: 's',
				via: 'p',
				guard: 'x > 2',
				effect: 'assign x := 0'
			},
			// The shorthand source.
			{ from: 'r1.b', to: 'r1.c' },
			{ name: 't2', from: 'r1.c', to: 'r1.a', trigger: 'after 5 [s]' },
			{
				name: 't3',
				from: 'r1.c',
				to: 'r1.done',
				trigger: 'at 10 [s]',
				effect: 'assign y := 1'
			},
			{ from: 'r2.entry', to: 'r2.q' },
			{ from: 'r2.q', to: 'r2.q', trigger: 'Go', effect: 'inc' },
			{ from: 'r2.q', to: 'r2.done', guard: 'x > 3' }
		]);
	});

	it('takes variables from the machine’s attributes, with direction, type, value and doc', () => {
		expect(machine(FORMS, 'M').variables).toEqual([
			{ name: 'x', type: 'Integer', value: '1', direction: 'in', doc: 'The x.' },
			{ name: 'y', type: 'Real', direction: 'out' },
			// A type that doesn't resolve is kept as written.
			{ name: 'z', type: 'Nope' }
		]);
	});

	it('an exhibited state sees its owner’s attributes; targets resolve through nesting', () => {
		const m = machine(FORMS, 'modes');
		expect(m.qualifiedName).toBe('F::d::modes');
		expect(m.variables).toEqual([{ name: 'soc', type: 'Real', value: '0.5' }]);
		const [, , low, stop, bad] = m.transitions;
		expect(low).toMatchObject({ from: 'off', to: 'on.spinning', trigger: 'when soc > 0.2' });
		expect(stop).toMatchObject({ from: 'on.idle', to: 'off', trigger: 'Stop' });
		expect(bad).toMatchObject({ from: 'off', to: 'nowhere' });
		expect(state(m, 'nowhere')).toMatchObject({ kind: 'state', line: 0 });
		expect(m.warnings).toEqual(['transition: unknown state `nowhere`']);
	});

	it('still reads the machines while another file does not parse', () => {
		const files = [...demoFiles(), { path: 'broken.sysml', text: 'package Broken { part x : ; }' }];
		expect(host.stateMachines(files).map((m) => m.name)).toEqual(['FlightModes', 'console']);
	});

	it('costs a few ms on the demo once it is analysed', () => {
		const files = demoFiles().map((f) => ({ ...f, text: `${f.text}\n` }));
		host.analyzeProject(files);
		const started = performance.now();
		const machines = host.stateMachines(files);
		const ms = performance.now() - started;
		// FlightModes, and the ground station's console that commands it (`GroundLink`).
		expect(machines.map((m) => m.name)).toEqual(['FlightModes', 'console']);
		expect(ms).toBeLessThan(50);
		// Asked again for the same text: the same answer, not read again.
		expect(host.stateMachines(files)).toBe(machines);
	});
});

describe('texts in the emulator’s conventions', () => {
	it('splits a transition into its clauses', () => {
		expect(
			transitionParts(
				'transition t first a accept Go if x > (1) do action { assign y := 2; } then b;'
			)
		).toEqual({
			head: 't',
			first: 'a',
			trigger: 'Go',
			guard: 'x > (1)',
			effect: 'action { assign y := 2; }',
			target: 'b'
		});
		expect(transitionParts('accept Go then b;')).toEqual({ trigger: 'Go', target: 'b' });
		expect(transitionParts("transition 'do it' first 'if' then 'then';")).toEqual({
			head: "'do it'",
			first: "'if'",
			target: "'then'"
		});
		expect(transitionParts('transition a /* then x */ then b; // do y')).toEqual({
			head: 'a',
			target: 'b'
		});
	});

	it('names the event a trigger fires on', () => {
		expect(triggerText('Go')).toBe('Go');
		expect(triggerText('DroneInterfaces::ArmCommand')).toBe('DroneInterfaces::ArmCommand');
		expect(triggerText('s : Sig via port')).toBe('Sig');
		expect(triggerText('Sig via port')).toBe('Sig');
		expect(triggerText('when  soc < limit')).toBe('when soc < limit');
		expect(triggerText('after 5 [s]')).toBe('after 5 [s]');
		expect(triggerText('at t')).toBe('at t');
	});

	it('writes actions as assignments, a name, or the text', () => {
		expect(actionText('assign x := x + 1')).toBe('assign x := x + 1');
		expect(actionText('action { assign a := 1; assign b := f(1; 2); }')).toBe(
			'assign a := 1; assign b := f(1; 2)'
		);
		expect(actionText('action inc')).toBe('inc');
		expect(actionText(' followFlightPlan')).toBe('followFlightPlan');
		expect(actionText('send Sig()\n    to p')).toBe('send Sig() to p');
		expect(actionText('')).toBeUndefined();
	});

	it('reads a type as written', () => {
		expect(writtenType('in attribute x : Real = 1')).toBe('Real');
		expect(writtenType('attribute x : ScalarValues :: Real')).toBe('ScalarValues::Real');
		expect(writtenType("attribute x : 'my type'")).toBe("'my type'");
		expect(writtenType('attribute x :> y := 2')).toBeUndefined();
	});
});

// ---------------------------------------------------------------- the emulator's machines

describe('the demo and the emulator’s test machines', () => {
	const cases: [string, SourceFile[]][] = [
		['the demo', demoFiles()],
		['LAMP', one(LAMP)],
		['COUNTER', one(COUNTER)],
		['DRONE', one(DRONE)],
		['NESTED', one(NESTED)],
		['MISSION', one(MISSION)]
	];
	for (const [label, files] of cases) {
		it(`extracts ${label}, each initial state on its \`entry;\` line`, () => {
			const machines = host.stateMachines(files);
			expect(machines.length).toBeGreaterThan(0);
			for (const m of machines) {
				const lines = files.find((f) => f.path === m.file)!.text.split('\n');
				for (const s of m.states.filter((s) => s.kind === 'initial'))
					expect(lines[s.line - 1]).toMatch(/^\s*entry\s*;/);
			}
		});
	}
});
