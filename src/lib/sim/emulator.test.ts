import { describe, expect, it } from 'vitest';
import type { StateMachine, StateSession } from '#lib/engine/types.ts';
import { start, step, withVariables } from './emulator.ts';
import { flightModes, nestedMachine } from './fixtures.ts';

/** A machine from states and transitions written briefly: `a`, `a.b`; `from>to:trigger[guard]/effect`. */
function machine(
	states: (string | (Partial<StateMachine['states'][number]> & { name: string }))[],
	transitions: StateMachine['transitions'][number][],
	variables: StateMachine['variables'] = [],
	extra: Partial<StateMachine> = {}
): StateMachine {
	return {
		name: 'M',
		file: 'm.sysml',
		line: 1,
		states: states.map((s) => {
			const state = typeof s === 'string' ? { name: s } : s;
			const label = state.name.split('.').pop()!;
			const parent = state.name.includes('.')
				? state.name.slice(0, state.name.lastIndexOf('.'))
				: undefined;
			return {
				label,
				kind: label === 'entry' ? 'initial' : label === 'done' ? 'final' : 'state',
				line: 1,
				...(parent ? { parent } : {}),
				...state
			};
		}),
		transitions,
		variables,
		...extra
	};
}

const t = (from: string, to: string, more: Partial<StateMachine['transitions'][number]> = {}) => ({
	from,
	to,
	line: 1,
	...more
});

/** A session after a trip through JSON, as the UI keeps it. */
const json = (s: StateSession): StateSession => JSON.parse(JSON.stringify(s)) as StateSession;

describe('start', () => {
	it('enters the initial state with defaults and lists what can happen', () => {
		const s = start(flightModes);
		expect(s).toMatchObject({
			machine: 'FlightControl::FlightModes',
			current: ['idle'],
			step: 0,
			status: 'running',
			variables: {
				preflightChecksPassed: null,
				stateOfCharge: 1,
				returnThreshold: 0.3,
				readyCharge: 0.95
			},
			time: 0,
			entered: { idle: 0 },
			timers: {},
			doing: []
		});
		expect(s.trace).toEqual([
			{
				step: 0,
				from_state: 'entry',
				transition_name: null,
				trigger: null,
				guard_result: null,
				effect: null,
				to_state: 'idle',
				exit_action: null,
				entry_action: null,
				time: 0,
				do_action: null,
				do_stopped: null
			}
		]);
		expect(s.enabled).toEqual([
			{
				transition: 'arm',
				index: 3,
				from: 'idle',
				to: 'armed',
				trigger: 'ArmCommand',
				guard: 'preflightChecksPassed',
				ready: false,
				reason: 'guard `preflightChecksPassed`: undefined variable `preflightChecksPassed`'
			}
		]);
		expect(s.messages).toBeUndefined();
	});

	it('takes variables that override the defaults', () => {
		const s = start(flightModes, { preflightChecksPassed: true, returnThreshold: 0.5, extra: 'x' });
		expect(s.variables).toMatchObject({
			preflightChecksPassed: true,
			returnThreshold: 0.5,
			extra: 'x'
		});
		expect(s.enabled[0]).toMatchObject({ ready: true, guardResult: true });
		// `null` keeps the default.
		expect(start(flightModes, { returnThreshold: null }).variables.returnThreshold).toBe(0.3);
		expect(() => start(flightModes, { returnThreshold: [1] })).toThrow(
			'unsupported variable value [1]'
		);
	});

	it('enters every region of a parallel state, and a parallel machine', () => {
		const m = machine(
			['entry', 'p', 'p.a', 'p.a.entry', 'p.a.x', 'p.b', 'p.b.y', 'p.b.z'],
			[t('entry', 'p'), t('p.a.entry', 'p.a.x')]
		);
		m.states[1]!.parallel = true;
		// A region without an initial state starts in its first state.
		expect(start(m).current).toEqual(['p.a.x', 'p.b.y']);
		const top = machine(['r', 'r.entry', 'r.a', 'q', 'q.b'], [t('r.entry', 'r.a')], [], {
			parallel: true
		});
		expect(start(top).current).toEqual(['r.a', 'q.b']);
		expect(start(top).trace[0]).toMatchObject({ from_state: '', to_state: 'r' });
	});

	it('follows an initial transition into a nested state, running entry actions outermost first', () => {
		const m = machine(
			[
				'entry',
				{ name: 'a', entry: 'assign log := log * 10 + 1' },
				{ name: 'a.b', entry: 'assign log := log * 10 + 2' },
				'a.c'
			],
			[t('entry', 'a.b')],
			[{ name: 'log', value: '0' }]
		);
		const s = start(m);
		expect(s.current).toEqual(['a.b']);
		expect(s.variables.log).toBe(12);
		expect(s.trace[0]).toMatchObject({
			to_state: 'a',
			entry_action: 'assign log := log * 10 + 1; assign log := log * 10 + 2'
		});
	});
});

describe('step', () => {
	it('fires events, applies variables first, and explains what did not fire', () => {
		let s = start(flightModes);
		s = step(flightModes, json(s), { event: 'ArmCommand' });
		expect(s.current).toEqual(['idle']);
		expect(s.messages).toEqual(['`ArmCommand` fires no transition from idle']);
		s = step(flightModes, json(s), {
			event: 'ArmCommand',
			variables: { preflightChecksPassed: true }
		});
		expect(s.current).toEqual(['armed']);
		expect(s.messages).toBeUndefined();
		expect(s.trace.at(-1)).toEqual({
			step: 1,
			from_state: 'idle',
			transition_name: 'arm',
			trigger: 'ArmCommand',
			guard_result: true,
			effect: null,
			to_state: 'armed',
			exit_action: null,
			entry_action: null,
			time: 0,
			do_action: null,
			do_stopped: null
		});
		s = step(flightModes, s, { event: 'TakeOffCommand' });
		expect(s.current).toEqual(['flying.cruising']);
		s = step(flightModes, s, { event: 'Whatever' });
		expect(s.messages).toEqual(['`Whatever` fires no transition from flying.cruising']);
		s = step(flightModes, s, { event: null, variables: { stateOfCharge: 0.2 } });
		expect(s.current).toEqual(['returningHome']);
		expect(s.trace.at(-1)).toMatchObject({ trigger: 'when stateOfCharge < returnThreshold' });
	});

	it('matches signals by their last name, either way round', () => {
		const ready = start(flightModes, { preflightChecksPassed: true });
		expect(step(flightModes, ready, { event: 'DroneInterfaces::ArmCommand' }).current).toEqual([
			'armed'
		]);
		const m = machine(['entry', 'a', 'b'], [t('entry', 'a'), t('a', 'b', { trigger: 'Pkg::Go' })]);
		expect(step(m, start(m), { event: 'Go' }).current).toEqual(['b']);
	});

	it('fires one chosen transition', () => {
		const s = start(flightModes, { preflightChecksPassed: true });
		expect(step(flightModes, s, { transition: 3 }).current).toEqual(['armed']);
		const blocked = step(flightModes, start(flightModes), { transition: 3 });
		expect(blocked.current).toEqual(['idle']);
		expect(blocked.messages).toEqual([
			'`arm` cannot fire: guard `preflightChecksPassed`: undefined variable `preflightChecksPassed`'
		]);
		expect(step(flightModes, s, { transition: 4 }).messages).toEqual([
			'`disarm` does not leave idle'
		]);
		expect(() => step(flightModes, s, { transition: 99 })).toThrow('no transition 99');
	});

	it('runs exit actions, the effect, then entry and do actions', () => {
		const m = machine(
			[
				'entry',
				{ name: 'a', exit: 'assign log := log + "x"' },
				{ name: 'b', entry: 'assign log := log + "n"', do: 'assign log := log + "d"' }
			],
			[
				t('entry', 'a'),
				t('a', 'b', { name: 'go', trigger: 'Go', effect: 'assign log := log + "e"' })
			],
			[{ name: 'log', value: '""' }]
		);
		const s = step(m, start(m), { event: 'Go' });
		expect(s.variables.log).toBe('xend');
		expect(s.trace.at(-1)).toMatchObject({
			exit_action: 'assign log := log + "x"',
			effect: 'assign log := log + "e"',
			entry_action: 'assign log := log + "n"'
		});
	});

	it('reports assignments it cannot run, and leaves their variable alone', () => {
		const m = machine(
			[
				'entry',
				{ name: 'a', entry: 'assign x := missing + 1; assign y := 2' },
				{ name: 'b', entry: 'assign z := 1 +' }
			],
			[t('entry', 'a'), t('a', 'b', { trigger: 'Go' })],
			[{ name: 'x', value: '5' }]
		);
		const s = start(m);
		expect(s.messages).toEqual(['assign x: undefined variable `missing`']);
		expect(s.variables).toMatchObject({ x: 5, y: 2 });
		expect(step(m, s, { event: 'Go' }).messages).toEqual([
			'assign z: `1 +` is not supported by the evaluator'
		]);
	});

	it('treats a guard it cannot read as blocking', () => {
		const m = machine(['entry', 'a', 'b'], [t('entry', 'a'), t('a', 'b', { guard: 'x @ T' })]);
		const s = start(m);
		expect(s.enabled[0]).toMatchObject({
			ready: false,
			reason: 'guard `x @ T`: guard is not supported by the evaluator'
		});
		expect(step(m, s, { event: null }).current).toEqual(['a']);
	});

	it('moves through the nested fixture: hierarchy, parallel regions and an unknown target', () => {
		const m = nestedMachine;
		let s = start(m);
		s = step(m, s, { event: 'Power' });
		expect(s.current).toEqual(['on.low']);
		expect(s.trace.at(-1)).toMatchObject({ to_state: 'on', entry_action: 'beep' });
		s = step(m, s, { event: 'Go', variables: { count: 3 } });
		expect(s.current).toEqual(['on.high']);
		expect(s.trace.at(-1)).toMatchObject({ effect: 'inc', guard_result: true });
		s = step(m, s, { event: 'Par' });
		expect(s.current).toEqual(['par.motors.idle', 'par.lights.dark']);
		expect(s.trace.at(-1)).toMatchObject({ from_state: 'on', exit_action: 'boop' });
		s = step(m, s, { event: 'Spin' });
		expect(s.current).toEqual(['par.motors.spinning', 'par.lights.dark']);
		s = step(m, s, { event: 'Finish' });
		s = step(m, s, { event: null });
		expect(s.current).toEqual(['fin']);
		expect(s.status).toBe('deadlocked');
	});

	it('steps orthogonal regions together on one event', () => {
		const m = machine(
			['entry', 'p', 'p.a', 'p.a.x', 'p.a.y', 'p.b', 'p.b.u', 'p.b.v'],
			[
				t('entry', 'p'),
				t('p.a.x', 'p.a.y', { trigger: 'Go' }),
				t('p.b.u', 'p.b.v', { trigger: 'Go' })
			]
		);
		m.states[1]!.parallel = true;
		const s = step(m, start(m), { event: 'Go' });
		expect(s.current).toEqual(['p.a.y', 'p.b.v']);
		expect(s.step).toBe(2);
	});

	it('enters the sibling regions when a transition targets a state inside one region', () => {
		const m = machine(
			['entry', 'off', 'p', 'p.a', 'p.a.x', 'p.a.y', 'p.b', 'p.b.u'],
			[t('entry', 'off'), t('off', 'p.a.y', { trigger: 'Go' })]
		);
		m.states[2]!.parallel = true;
		expect(step(m, start(m), { event: 'Go' }).current).toEqual(['p.a.y', 'p.b.u']);
	});

	it('leaves and re-enters a state on a self-transition', () => {
		const m = machine(
			['entry', { name: 'a', entry: 'assign n := n + 1', exit: 'assign n := n * 10' }],
			[t('entry', 'a'), t('a', 'a', { trigger: 'Again' })],
			[{ name: 'n', value: '0' }]
		);
		expect(step(m, start(m), { event: 'Again' }).variables.n).toBe(11);
	});

	it('waits for every region of a composite state before its completion transition', () => {
		const m = machine(
			[
				'entry',
				'c',
				'c.p',
				'c.p.r1',
				'c.p.r1.a',
				'c.p.r1.done',
				'c.p.r2',
				'c.p.r2.b',
				'c.p.r2.done',
				'out'
			],
			[
				t('entry', 'c'),
				t('c.p.r1.a', 'c.p.r1.done', { trigger: 'A' }),
				t('c.p.r2.b', 'c.p.r2.done', { trigger: 'B' }),
				t('c', 'out')
			]
		);
		m.states[2]!.parallel = true;
		let s = start(m);
		expect(s.enabled.find((e) => e.from === 'c')).toMatchObject({
			ready: false,
			reason: '`c` has not finished'
		});
		s = step(m, s, { event: 'A' });
		expect(step(m, s, { event: null }).current).toEqual(['c.p.r1.done', 'c.p.r2.b']);
		s = step(m, s, { event: 'B' });
		expect(s.enabled.find((e) => e.from === 'c')).toMatchObject({ ready: true });
		expect(step(m, s, { event: null }).current).toEqual(['out']);
	});

	it('completes on a top-level final state and then refuses to step', () => {
		const m = machine(['entry', 'a', 'done'], [t('entry', 'a'), t('a', 'done')]);
		const s = step(m, start(m), { event: null });
		expect(s.status).toBe('completed');
		const again = step(m, s, { event: null });
		expect(again.current).toEqual(['done']);
		expect(again.messages).toEqual(['the machine has finished; restart it to run again']);
	});

	it('is deadlocked when nothing leaves the active states', () => {
		const m = machine(['entry', 'a', 'b'], [t('entry', 'a'), t('a', 'b', { trigger: 'Go' })]);
		expect(start(m).status).toBe('running');
		expect(step(m, start(m), { event: 'Go' }).status).toBe('deadlocked');
	});

	it('stops at a step limit', () => {
		const m = machine(['entry', 'a', 'b'], [t('entry', 'a'), t('a', 'b'), t('b', 'a')]);
		let s = start(m, null, { maxSteps: 2 });
		s = step(m, s, { event: null }, { maxSteps: 2 });
		expect(s.status).toBe('running');
		s = step(m, s, { event: null }, { maxSteps: 2 });
		expect(s.status).toBe('max steps reached');
		const stuck = step(m, s, { event: null }, { maxSteps: 2 });
		expect(stuck.step).toBe(2);
		expect(stuck.messages).toEqual([
			'the machine has taken 2 steps, its limit; restart it to run again'
		]);
		// A higher limit lets it go on.
		expect(step(m, s, { event: null }, { maxSteps: 3 }).step).toBe(3);
	});

	it('rejects a session that does not fit the machine', () => {
		const s = { ...start(flightModes), current: ['gone'] };
		expect(() => step(flightModes, s, { event: null })).toThrow(
			'session does not match `FlightModes`: no state `gone`'
		);
	});
});

describe('withVariables', () => {
	it('re-evaluates guards for changed variables without stepping', () => {
		const s = start(flightModes);
		const preview = withVariables(flightModes, s, { preflightChecksPassed: true });
		expect(preview.enabled[0]).toMatchObject({ ready: true, guardResult: true });
		expect(preview.step).toBe(0);
		expect(preview.trace).toEqual(s.trace);
		expect(preview.messages).toBeUndefined();
		expect(
			withVariables(flightModes, preview, { preflightChecksPassed: null }).variables
				.preflightChecksPassed
		).toBeNull();
	});
});

describe('units and enums in variables', () => {
	it('keeps a variable in the unit of its default', () => {
		const m = machine(
			['entry', { name: 'a', entry: 'assign range := range + 1 [km]' }, 'far'],
			[t('entry', 'a'), t('a', 'far', { trigger: 'Check', guard: 'range > 1.2 [km]' })],
			[{ name: 'range', type: 'LengthValue', value: '500 [m]' }]
		);
		const s = start(m);
		expect(s.variables.range).toBe(1500);
		expect(s.enabled[0]).toMatchObject({ guardResult: true });
		// A number the user types is in the variable's unit.
		expect(withVariables(m, s, { range: 1000 }).enabled[0]).toMatchObject({ guardResult: false });
	});

	it('stores enum literals by name', () => {
		const m = machine(
			['entry', 'a', 'b'],
			[
				t('entry', 'a'),
				t('a', 'b', {
					trigger: 'Go',
					guard: 'mode == Mode::hover',
					effect: 'assign mode := Mode::cruise'
				})
			],
			[{ name: 'mode', type: 'Mode', value: 'Mode::hover' }]
		);
		const s = step(m, start(m), { event: 'Go' });
		expect(s.current).toEqual(['b']);
		expect(s.variables.mode).toBe('cruise');
	});
});

describe('the clock', () => {
	const timed = () =>
		machine(
			['entry', 'a', 'b'],
			[
				t('entry', 'a'),
				t('a', 'b', { trigger: 'after 2 [min]' }),
				t('b', 'a', { trigger: 'after 0 [s]' })
			]
		);

	it('refuses to wait for no time, or for time going backwards', () => {
		const m = timed();
		expect(() => step(m, start(m), { wait: 0 })).toThrow('cannot wait for 0 seconds');
		expect(() => step(m, start(m), { wait: -5 })).toThrow('cannot wait for -5 seconds');
	});

	it('resumes a session kept without the clock, starting its timers from time 0', () => {
		const m = timed();
		const old = json(start(m));
		delete old.time;
		delete old.entered;
		delete old.timers;
		delete old.doing;
		const s = step(m, old, { event: null });
		expect(s).toMatchObject({ current: ['b'], time: 120 });
	});

	it('stops a wait at the step limit, and when the machine never lets time pass', () => {
		const m = timed();
		const limited = step(m, start(m, null, { maxSteps: 3 }), { wait: 3600 }, { maxSteps: 3 });
		expect(limited).toMatchObject({ step: 3, status: 'max steps reached', time: 240 });
		// `b` goes back to `a` at once and `a` waits 2 minutes: an hour is 30 round trips.
		const hour = step(m, start(m), { wait: 3600 });
		expect(hour).toMatchObject({ step: 60, time: 3600, current: ['a'] });
		const spin = machine(
			['entry', 'a'],
			[t('entry', 'a'), t('a', 'a', { trigger: 'after 0 [s]' })]
		);
		const stuck = step(spin, start(spin), { wait: 10 });
		expect(stuck.time).toBe(0);
		expect(stuck.messages).toEqual([
			'stopped after 200 steps at 0 s: the machine keeps moving without time passing'
		]);
	});

	it('lets time pass for a machine that is stuck', () => {
		const m = machine(['entry', 'a'], [t('entry', 'a')]);
		expect(step(m, start(m), { wait: 60 })).toMatchObject({ status: 'deadlocked', time: 60 });
	});
});
