/**
 * Reference traces for the state machine simulator (assessment, §5 and
 * prioritized question 5).
 *
 * Each case is a small SysML v2 model, an input script (events, Steps,
 * waits, variable changes) and the trace the SysML v2 semantics give for it.
 * The expected traces are derived from the specification, not from what the
 * simulator does: SysML v2.0 Part 1 (7.17.8 accept actions, 7.18.1–7.18.3
 * states and transitions, 8.4.14 state semantics) and the Kernel Semantic
 * Library (`StatePerformances`, `TransitionPerformances`, `Triggers`,
 * `Observation`). Where the specifications leave a choice open (which of
 * two enabled transitions fires, the order of exit actions in concurrent
 * regions), the case says so and checks only what is fixed plus the
 * simulator's documented choice (`docs/simulator.md`).
 *
 * Entry, exit and effect actions append to a `log` string, so the order in
 * which they ran is part of the trace.
 *
 * Cases the simulator does not meet yet are `it.fails` with a `Known gap`
 * comment; they flip when fixed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { StateMachine, StateSession } from '#lib/engine/types.ts';
import { start, step, type Options, type Variables } from './emulator.ts';
import { autoMove, statusText } from './model.ts';

let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

/** The machine as the app extracts it from SysML text. */
function machineOf(text: string, name: string): StateMachine {
	const all = host.stateMachines([{ path: 'model.sysml', text }]);
	const found = all.find((m) => m.name === name || m.qualifiedName === name);
	if (!found) throw new Error(`no machine ${name} in [${all.map((m) => m.name).join(', ')}]`);
	return found;
}

/** Plain JSON, as a session crosses the worker boundary. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Move =
	| { event: string; vars?: Variables }
	| { step: true; vars?: Variables }
	| { wait: number | 'next'; vars?: Variables };

class Run {
	readonly machine: StateMachine;
	session: StateSession;

	constructor(
		text: string,
		name: string,
		variables: Variables | null = null,
		readonly options: Options = {}
	) {
		this.machine = machineOf(text, name);
		this.session = plain(start(this.machine, variables, options));
	}

	play(moves: Move[]): this {
		for (const m of moves) {
			const variables = m.vars;
			const choice =
				'event' in m
					? { event: m.event, variables }
					: 'wait' in m
						? { wait: m.wait, variables }
						: { event: null, variables };
			this.session = plain(step(this.machine, this.session, choice, this.options));
		}
		return this;
	}

	fire(event: string | null, vars?: Variables): this {
		return this.play([event === null ? { step: true, vars } : { event, vars }]);
	}

	/** Each transition taken since the start, as `time: from -> to`. */
	get trace(): string[] {
		return this.session.trace.map((s) => `${s.time ?? 0}: ${s.from_state} -> ${s.to_state}`);
	}

	get log(): string {
		return String(this.session.variables.log ?? '');
	}
}

const STEP: Move = { step: true };

// ---------------------------------------------------------------- the reference cases

interface Case {
	id: string;
	title: string;
	/** Where the expected trace comes from. */
	basis: string;
	source: string;
	machine: string;
	variables?: Variables;
	script: Move[];
	expected: { trace: string[]; current: string[]; log?: string; status?: string };
}

const CASES: Case[] = [
	{
		id: 'T01',
		title: 'trigger, guard and effect: a false guard blocks; exit, effect, entry run in that order',
		basis:
			'SysML 7.18.3 (a transition is triggered only during its source, only if its guard is true; then exit, effect, entry)',
		source: `state def T01 {
            attribute ok : Boolean = false;
            attribute log : String = "";
            entry; then off;
            state off { exit action { assign log := log + "off- "; } }
            state on { entry action { assign log := log + "on+ "; } }
            transition go first off accept Go if ok do assign log := log + "eff " then on;
        }`,
		machine: 'T01',
		script: [{ event: 'Go' }, { event: 'Go', vars: { ok: true } }],
		expected: { trace: ['0: entry -> off', '0: off -> on'], current: ['on'], log: 'off- eff on+ ' }
	},
	{
		id: 'T02',
		title:
			'entry, do and exit actions: do starts after entry; exit, effect, entry, do on a transition',
		basis:
			'SysML 7.18.1 (a do action starts after the entry action completes), 7.18.3 transition steps 1–5',
		source: `state def T02 {
            attribute log : String = "";
            entry; then a;
            state a {
                entry action { assign log := log + "a.entry "; }
                do action { assign log := log + "a.do "; }
                exit action { assign log := log + "a.exit "; }
            }
            state b {
                entry action { assign log := log + "b.entry "; }
                do action { assign log := log + "b.do "; }
            }
            transition first a accept Go do assign log := log + "eff " then b;
        }`,
		machine: 'T02',
		script: [{ event: 'Go' }],
		expected: {
			trace: ['0: entry -> a', '0: a -> b'],
			current: ['b'],
			log: 'a.entry a.do a.exit eff b.entry b.do '
		}
	},
	{
		id: 'T03',
		title:
			'nested states: exits innermost first, entries outermost first, default substates entered',
		basis:
			'KerML StatePerformances (`entry then middle`, `middle then exit`; substates are middle performances, SysML 8.4.14.1), SysML 7.18.2 (`entry; then x` is the initial substate)',
		source: `state def T03 {
            attribute log : String = "";
            entry; then a;
            state a {
                entry action { assign log := log + "a+ "; }
                exit action { assign log := log + "a- "; }
                entry; then a1;
                state a1 {
                    entry action { assign log := log + "a1+ "; }
                    exit action { assign log := log + "a1- "; }
                }
            }
            state b {
                entry action { assign log := log + "b+ "; }
                entry; then b1;
                state b1 { entry action { assign log := log + "b1+ "; } }
            }
            transition first a accept Go do assign log := log + "eff " then b;
        }`,
		machine: 'T03',
		script: [{ event: 'Go' }],
		expected: {
			trace: ['0: entry -> a', '0: a -> b'],
			current: ['b.b1'],
			log: 'a+ a1+ a1- a- eff b+ b1+ '
		}
	},
	{
		id: 'T03b',
		title: 'a transition from an inner state to an outer target leaves every enclosing state',
		basis: 'as T03; the source a1 is left, then a (middle then exit)',
		source: `state def T03b {
            attribute log : String = "";
            entry; then a;
            state a {
                exit action { assign log := log + "a- "; }
                entry; then a1;
                state a1 { exit action { assign log := log + "a1- "; } }
                transition first a1 accept Out then b;
            }
            state b { entry action { assign log := log + "b+ "; } }
        }`,
		machine: 'T03b',
		script: [{ event: 'Out' }],
		expected: { trace: ['0: entry -> a', '0: a.a1 -> b'], current: ['b'], log: 'a1- a- b+ ' }
	},
	{
		id: 'T04',
		title:
			'a transition into a nested state enters its ancestors, then that state, not the default',
		basis:
			'SysML 7.18.3 (the target may be any state usage, named by a feature chain); KerML StatePerformances (`entry then middle`)',
		source: `state def T04 {
            attribute log : String = "";
            entry; then x;
            state x;
            state b {
                entry action { assign log := log + "b+ "; }
                entry; then b1;
                state b1 { entry action { assign log := log + "b1+ "; } }
                state b2 { entry action { assign log := log + "b2+ "; } }
            }
            transition first x accept Deep then b.b2;
        }`,
		machine: 'T04',
		script: [{ event: 'Deep' }],
		expected: { trace: ['0: entry -> x', '0: x -> b.b2'], current: ['b.b2'], log: 'b+ b2+ ' }
	},
	{
		id: 'T05',
		title: 'self-transition on a composite: leaves and re-enters it, back to its initial substate',
		basis:
			'SysML 7.18.3 (a transition goes to a new performance of the target: exit, effect, entry)',
		source: `state def T05 {
            attribute log : String = "";
            entry; then a;
            state a {
                entry action { assign log := log + "a+ "; }
                exit action { assign log := log + "a- "; }
                entry; then a1;
                state a1;
                state a2 { exit action { assign log := log + "a2- "; } }
                transition first a1 accept Next then a2;
            }
            transition again first a accept Again do assign log := log + "eff " then a;
        }`,
		machine: 'T05',
		script: [{ event: 'Next' }, { event: 'Again' }],
		expected: {
			trace: ['0: entry -> a', '0: a.a1 -> a.a2', '0: a -> a'],
			current: ['a.a1'],
			log: 'a+ a2- a- eff a+ '
		}
	},
	{
		id: 'T06',
		title:
			'parallel regions: entered together, one event steps both, the parallel state completes when every region is done',
		basis:
			'SysML 7.18.1 (Parallel States), 7.18.3 (`then done`: the final state of the containing state), KerML StateTransitionPerformance (`nonDoMiddle then self`: a transition without a trigger waits for the substates)',
		source: `state def T06 {
            attribute log : String = "";
            entry; then p;
            state p parallel {
                entry action { assign log := log + "p+ "; }
                exit action { assign log := log + "p- "; }
                state r1 {
                    entry; then x1;
                    state x1 { exit action { assign log := log + "x1- "; } }
                    state x2;
                    transition first x1 accept Go then x2;
                    transition first x2 then done;
                }
                state r2 {
                    entry; then y1;
                    state y1;
                    state y2;
                    transition first y1 accept Go then y2;
                    transition first y2 accept Fin then done;
                }
            }
            state finished { entry action { assign log := log + "finished+ "; } }
            transition first p then finished;
        }`,
		machine: 'T06',
		script: [{ event: 'Go' }, STEP, STEP, { event: 'Fin' }, STEP],
		expected: {
			trace: [
				'0: entry -> p',
				'0: p.r1.x1 -> p.r1.x2',
				'0: p.r2.y1 -> p.r2.y2',
				'0: p.r1.x2 -> p.r1.done',
				'0: p.r2.y2 -> p.r2.done',
				'0: p -> finished'
			],
			current: ['finished'],
			log: 'p+ x1- p- finished+ '
		}
	},
	{
		id: 'T08',
		title:
			'event ordering: an event no transition of the current state accepts is discarded, not kept',
		basis:
			'SysML 7.18.3 rule 1 (a transition is triggered only during its source); no transfer is deferrable unless modelled so (StatePerformance::deferrable)',
		source: `state def T08 {
            entry; then a;
            state a; state b; state c;
            transition first a accept A then b;
            transition first b accept B then c;
        }`,
		machine: 'T08',
		script: [{ event: 'B' }, { event: 'A' }],
		expected: { trace: ['0: entry -> a', '0: a -> b'], current: ['b'] }
	},
	{
		id: 'T09',
		title: 'a chain of transitions without triggers runs through without time passing',
		basis:
			'KerML StateTransitionPerformance (no accepter: the transition follows the source’s nonDoMiddle, which a leaf state does not have)',
		source: `state def T09 {
            entry; then a;
            state a; state b; state c;
            transition first a then b;
            transition first b then c;
        }`,
		machine: 'T09',
		script: [STEP, STEP],
		expected: { trace: ['0: entry -> a', '0: a -> b', '0: b -> c'], current: ['c'] }
	},
	{
		id: 'T11b',
		title: 'a change trigger fires when its condition turns true while the state is active',
		basis: 'SysML 7.17.8 (change trigger: sent when the expression changes from false to true)',
		source: `state def T11b {
            attribute x : Integer = 0;
            entry; then a;
            state a; state b;
            transition first a accept when x > 0 then b;
        }`,
		machine: 'T11b',
		script: [STEP, { step: true, vars: { x: 1 } }],
		expected: { trace: ['0: entry -> a', '0: a -> b'], current: ['b'] }
	},
	{
		id: 'T12',
		title: 'relative and absolute time triggers on one clock',
		basis:
			'SysML 7.17.8 (`after d`: evaluation time + d; `at t`: when the clock reaches t), KerML Triggers::TriggerAfter / TriggerAt',
		source: `state def T12 {
            entry; then a;
            state a; state b; state c; state d;
            transition first a accept after 1 [SI::min] then b;
            transition first b accept at 2 [SI::min] then c;
            transition first c accept after 30 [s] then d;
        }`,
		machine: 'T12',
		script: [{ wait: 'next' }, { wait: 'next' }, { wait: 'next' }],
		expected: {
			trace: ['0: entry -> a', '60: a -> b', '120: b -> c', '150: c -> d'],
			current: ['d']
		}
	},
	{
		id: 'T14',
		title: 'the guard is evaluated before the exit action runs',
		basis:
			'SysML 8.4.14.3 (the guard is evaluated during the source; then the accepter; then the exit action)',
		source: `state def T14 {
            attribute ok : Boolean = true;
            entry; then a;
            state a { exit action { assign ok := false; } }
            state b;
            transition first a accept Go if ok then b;
        }`,
		machine: 'T14',
		script: [{ event: 'Go' }],
		expected: { trace: ['0: entry -> a', '0: a -> b'], current: ['b'] }
	},
	{
		id: 'T15',
		title: 'a top-level `then done` completes the machine',
		basis:
			'SysML 7.18.3 (a transition to done: the source is the final state of the containing state)',
		source: `state def T15 {
            entry; then a;
            state a;
            transition first a accept Stop then done;
        }`,
		machine: 'T15',
		script: [{ event: 'Stop' }],
		expected: { trace: ['0: entry -> a', '0: a -> done'], current: ['done'], status: 'completed' }
	}
];

/** Run a case's script from the start. */
const play = (c: Case) => new Run(c.source, c.machine, c.variables ?? null).play(c.script);

describe('reference traces (expected from the SysML v2 semantics)', () => {
	for (const c of CASES) {
		it(`${c.id}: ${c.title}`, () => {
			const run = play(c);
			expect(run.trace).toEqual(c.expected.trace);
			expect(run.session.current).toEqual(c.expected.current);
			if (c.expected.log !== undefined) expect(run.log).toBe(c.expected.log);
			if (c.expected.status) expect(run.session.status).toBe(c.expected.status);
			expect(run.machine.warnings).toBeUndefined();
		});
	}

	it('every reference case gives the same session when run twice (determinism)', () => {
		for (const c of CASES) expect(play(c).session).toEqual(play(c).session);
	});

	it('a session that went through JSON resumes to the same trace as one that did not', () => {
		for (const c of CASES) {
			const machine = machineOf(c.source, c.machine);
			let live = start(machine, c.variables ?? null);
			for (const m of c.script) {
				const choice =
					'event' in m
						? { event: m.event, variables: m.vars }
						: 'wait' in m
							? { wait: m.wait, variables: m.vars }
							: { event: null, variables: m.vars };
				live = step(machine, live, choice);
			}
			expect(plain(live)).toEqual(play(c).session);
		}
	});
});

describe('competing transitions (the specifications fix that one fires, not which)', () => {
	it('an inner and an outer transition on one event: exactly one fires, the inner one (UML 14.2.3.9.4)', () => {
		// KerML StatePerformance::accepted is [0..1]: one transfer, one transition.
		const run = new Run(
			`state def C1 {
                entry; then on;
                state on { entry; then low; state low; state high; transition up first low accept Go then high; }
                state off;
                transition leave first on accept Go then off;
            }`,
			'C1'
		).fire('Go');
		expect(run.trace).toEqual(['0: entry -> on', '0: on.low -> on.high']);
	});

	it('two transitions from one state with true guards: exactly one fires, the one written first, and the other shows as pre-empted', () => {
		const run = new Run(
			`state def C2 {
                attribute x : Integer = 1;
                entry; then s; state s; state a; state b;
                transition ta first s accept Go if x > 0 then a;
                transition tb first s accept Go if x < 5 then b;
            }`,
			'C2'
		);
		expect(run.session.enabled.find((e) => e.transition === 'tb')).toMatchObject({
			ready: false,
			reason: '`ta` fires first'
		});
		run.fire('Go');
		expect(run.trace).toEqual(['0: entry -> s', '0: s -> a']);
	});

	it('a change and a time trigger ready at the same instant: one fires, the one written first (documented tie)', () => {
		const source = (first: string, second: string) => `state def C3 {
            attribute x : Integer = 1;
            entry; then a;
            state a; state t; state w;
            ${first}
            ${second}
        }`;
		const timer = 'transition first a accept after 0 [s] then t;';
		const change = 'transition first a accept when x > 0 then w;';
		expect(new Run(source(timer, change), 'C3').fire(null).trace).toEqual([
			'0: entry -> a',
			'0: a -> t'
		]);
		expect(new Run(source(change, timer), 'C3').fire(null).trace).toEqual([
			'0: entry -> a',
			'0: a -> w'
		]);
	});

	it('leaving a parallel state from inside one region exits every region before the parallel state itself', () => {
		// The order between the two regions is open (they are concurrent); both come before `p-`.
		const run = new Run(
			`state def C4 {
                attribute log : String = "";
                entry; then p;
                state p parallel {
                    exit action { assign log := log + "p- "; }
                    state r1 {
                        entry; then x1;
                        state x1 { exit action { assign log := log + "x1- "; } }
                        transition first x1 accept Out then outside;
                    }
                    state r2 {
                        entry; then y1;
                        state y1 { exit action { assign log := log + "y1- "; } }
                    }
                }
                state outside { entry action { assign log := log + "out+ "; } }
            }`,
			'C4'
		).fire('Out');
		expect(run.session.current).toEqual(['outside']);
		const tokens = run.log.trim().split(' ');
		expect(tokens.slice(2)).toEqual(['p-', 'out+']);
		expect([...tokens.slice(0, 2)].sort()).toEqual(['x1-', 'y1-']);
	});
});

describe('events wait for what is ready now (fixed in this assessment)', () => {
	// Before the fix an event sent here was taken from `a`, a state the machine had already left.
	it('a transition without a trigger is taken before an event sent after it became ready', () => {
		// `a` has nothing to wait for, so its untriggered transition happens as it
		// is entered (StateTransitionPerformance: `nonDoMiddle then self`); the
		// simulator's own rule is "transitions without a trigger come before
		// triggered ones". Go then finds the machine in `b`.
		const run = new Run(
			`state def G1 {
                entry; then a;
                state a; state b; state c; state d;
                transition first a then b;
                transition first a accept Go then c;
                transition first b accept Go then d;
            }`,
			'G1'
		);
		expect(run.fire('Go').session.messages).toEqual(['`a -> b` fires first: Step, then send `Go`']);
		run.fire(null).fire('Go');
		expect(run.trace).toEqual(['0: entry -> a', '0: a -> b', '0: b -> d']);
	});

	it('a change trigger that holds on entry fires before a later event', () => {
		// 7.17.8: a change signal is sent at once if the condition is true when first evaluated.
		const run = new Run(
			`state def G2 {
                attribute x : Integer = 1;
                entry; then a;
                state a; state b; state c;
                transition first a accept when x > 0 then b;
                transition first a accept Go then c;
            }`,
			'G2'
		)
			.fire('Go')
			.fire(null);
		expect(run.trace).toEqual(['0: entry -> a', '0: a -> b']);
	});

	it('the event is shown as waiting, with the reason, while the untriggered transition is ready', () => {
		const run = new Run(
			`state def G1u {
                entry; then a;
                state a; state b; state c;
                transition first a then b;
                transition first a accept Go then c;
            }`,
			'G1u'
		);
		const go = run.session.enabled.find((e) => e.trigger === 'Go')!;
		const completion = run.session.enabled.find((e) => !e.trigger)!;
		expect(completion.ready).toBe(true);
		expect(go).toMatchObject({ ready: false, reason: '`a -> b` fires first' });
	});
});

describe('signals (fixed in this assessment)', () => {
	// Before the fix `A::Go` fired the `B::Go` transition, and the `A::Go` one showed as pre-empted.
	it('signals are matched by the signal they name, not by their last name segment', () => {
		const run = new Run(
			`package G3 {
                package A { item def Go; }
                package B { item def Go; }
                state def M {
                    entry; then s;
                    state s; state x; state y;
                    transition toY first s accept B::Go then y;
                    transition toX first s accept A::Go then x;
                }
            }`,
			'M'
		);
		expect(run.session.enabled.find((e) => e.transition === 'toX')?.ready).toBe(true);
		run.fire('A::Go');
		expect(run.trace).toEqual(['0: entry -> s', '0: s -> x']);
	});

	it('a signal written with and without its package is still one signal', () => {
		const run = new Run(
			`package G3b {
                package A { item def Go; }
                state def M {
                    entry; then s; state s; state t; state u;
                    transition first s accept A::Go then t;
                    transition first t accept Go then u;
                }
            }`,
			'M'
		);
		run.fire('Go').fire('A::Go');
		expect(run.trace).toEqual(['0: entry -> s', '0: s -> t', '0: t -> u']);
	});
});

describe('constructs the simulator once departed on (fixed)', () => {
	// Before the fix the change signal was kept and taken once the guard held (time signals were already lost).
	it('a change signal that comes while the guard is false is not taken later', () => {
		// Observation::ObserveChange sends the change signal once; a transfer
		// not accepted while the guard is false is not accepted later (it is
		// not deferrable). The simulator applies this to time signals already.
		const run = new Run(
			`state def G4 {
                attribute x : Integer = 1;
                attribute ok : Boolean = false;
                entry; then a;
                state a; state b;
                transition first a accept when x > 0 if ok then b;
            }`,
			'G4'
		).play([STEP, { step: true, vars: { ok: true } }]);
		expect(run.session.current).toEqual(['a']);
		// It says why: the signal came while the guard was false.
		expect(run.session.enabled[0]!.reason).toBe(
			'`when x > 0` came at 0 s while guard `ok` is false'
		);
		// The condition turning false and true again sends a new one, which the guard now lets through.
		run.play([
			{ step: true, vars: { x: 0 } },
			{ step: true, vars: { x: 2 } }
		]);
		expect(run.session.current).toEqual(['b']);
	});

	const G5 = `state def G5 {
            attribute startOn : Boolean = true;
            entry;
            if startOn then on;
            if not startOn then off;
            state off;
            state on;
        }`;

	// Before the fix the first state was entered whatever the guards said.
	it('a conditional initial transition enters the state its guard selects', () => {
		expect(new Run(G5, 'G5').session.current).toEqual(['on']);
		expect(new Run(G5, 'G5', { startOn: false }).session.current).toEqual(['off']);
		const first = new Run(G5, 'G5', { startOn: false }).session.trace[0]!;
		expect(first).toMatchObject({
			to_state: 'off',
			guard_result: true,
			cause: 'start: guard `not startOn` is true',
			reads: { startOn: false }
		});
	});

	it('…the machine reads them as guarded initial transitions, with no note', () => {
		const m = machineOf(G5, 'G5');
		expect(m.warnings).toBeUndefined();
		expect(m.transitions.filter((t) => t.from === 'entry')).toMatchObject([
			{ to: 'on', guard: 'startOn' },
			{ to: 'off', guard: 'not startOn' }
		]);
	});

	it('…and when no guard holds, nothing is entered and the start says so', () => {
		const run = new Run(
			`state def G5b {
                attribute mode : Integer = 3;
                entry;
                if mode == 1 then a;
                if mode == 2 then b;
                state a; state b;
            }`,
			'G5b'
		);
		expect(run.session.current).toEqual([]);
		expect(run.session.status).toBe('deadlocked');
		expect(run.session.trace[0]!.notes).toEqual([
			'no initial transition of the machine can be taken (guard `mode == 1` is false; guard `mode == 2` is false), so no state in it is entered'
		]);
	});

	it('a conditional initial transition of a composite state reads what its entry action set', () => {
		// StatePerformance: `entry then middle`: the substates come after the entry action.
		const run = new Run(
			`state def G5c {
                attribute fast : Boolean = false;
                entry; then on;
                state on {
                    entry action { assign fast := true; }
                    entry;
                    if fast then quick;
                    if not fast then slow;
                    state slow; state quick;
                }
            }`,
			'G5c'
		);
		expect(run.session.current).toEqual(['on.quick']);
	});

	const G6 = `state def G6 {
            attribute log : String = "";
            entry; then on;
            state on { exit action { assign log := log + "on- "; } }
            accept Abort do assign log := log + "eff " then stop;
            action stop terminate;
        }`;

	// Before the fix `stop` was an unknown state, and the run stayed in it.
	it('a transition to a terminate action ends the machine', () => {
		const run = new Run(G6, 'G6').fire('Abort');
		expect(run.session.status).toBe('completed');
		expect(run.session.current).not.toContain('stop');
		expect(run.session.current).toEqual([]);
		// 7.18.3: the source is exited and the effect runs; then the terminate action ends the performance.
		expect(run.log).toBe('on- eff ');
		expect(run.trace).toEqual(['0: entry -> on', '0: on -> stop']);
		expect(run.fire('Abort').session.messages).toEqual([
			'the machine has finished; restart it to run again'
		]);
	});

	it('…with no note, and the other regions stop without their exit actions', () => {
		// `stop` is in r1, so the transition leaves only x; y, in the other region, is never exited.
		expect(machineOf(G6, 'G6').warnings).toBeUndefined();
		const run = new Run(
			`state def G6p {
                attribute log : String = "";
                entry; then p;
                state p parallel {
                    state r1 {
                        entry; then x;
                        state x;
                        transition first x accept Abort then stop;
                        action stop terminate;
                    }
                    state r2 {
                        entry; then y;
                        state y { exit action { assign log := log + "y- "; } do monitor; }
                    }
                }
                action monitor;
            }`,
			'G6p'
		).fire('Abort');
		expect(run.session).toMatchObject({ status: 'completed', current: [], doing: [] });
		expect(run.log).toBe('');
		expect(run.session.trace.at(-1)).toMatchObject({
			to_state: 'p.r1.stop',
			do_stopped: 'monitor',
			notes: ['`stop` terminates the machine']
		});
	});

	const SEND = `package G7 {
        item def Ping;
        part ctl {
            exhibit state m {
                entry; then a;
                state a { entry send new Ping() to ctl; }
                state b;
                transition first a accept Ping then b;
            }
        }
    }`;

	it('a send to the machine’s own part is run, so the machine has no note', () => {
		expect(machineOf(SEND, 'm').warnings).toBeUndefined();
		expect(machineOf(SEND, 'm').owner).toBe('ctl');
	});

	// Before the fix the signal was not delivered.
	it('a signal sent to the machine’s own part by an entry action triggers its transition', () => {
		const run = new Run(SEND, 'm');
		expect(run.session.queue).toEqual([{ signal: 'Ping', from: 'the entry action of `a`' }]);
		run.fire(null);
		expect(run.session.current).toEqual(['b']);
		expect(run.session.trace.at(-1)!.cause).toBe('`Ping`, sent by the entry action of `a`');
	});

	it('signals the machine sends itself wait for what is ready now, and come before events sent after them', () => {
		// UML 14.2.3.9.1: completion events first, then the event pool in order; events are taken one per step.
		const run = new Run(
			`state def G7b {
                attribute log : String = "";
                entry; then a;
                state a { entry action { send new One() to self; then send new Two() to self; } }
                state b { entry action { assign log := log + "b "; } }
                state c { entry action { assign log := log + "c "; } }
                state d;
                transition first a then b;
                transition first b accept One then c;
                transition first c accept Two then d;
                transition first c accept Go then a;
            }`,
			'G7b'
		);
		expect(run.session.queue?.map((q) => q.signal)).toEqual(['One', 'Two']);
		// Go waits: the untriggered transition, then One and Two, come first.
		expect(run.fire('Go').session.messages).toEqual(['`a -> b` fires first: Step, then send `Go`']);
		run.fire(null);
		expect(run.fire('Go').session.messages).toEqual([
			'`One`, sent by the machine, comes first: Step, then send `Go`'
		]);
		run.fire(null).fire(null);
		expect(run.trace).toEqual(['0: entry -> a', '0: a -> b', '0: b -> c', '0: c -> d']);
		expect(run.session.queue).toBeUndefined();
	});

	it('a signal the machine sent itself that nothing accepts is dropped, with a message', () => {
		const run = new Run(
			`state def G7c {
                entry; then a;
                state a { entry send new Lost() to self; }
                state b;
                transition first a accept Go then b;
            }`,
			'G7c'
		).fire(null);
		expect(run.session.messages).toEqual([
			'`Lost`, sent by the entry action of `a`, fires no transition from a: it is dropped'
		]);
		expect(run.session.queue).toBeUndefined();
		run.fire('Go');
		expect(run.session.current).toEqual(['b']);
	});

	it('a Wait takes the signals the machine sends itself on the way', () => {
		const run = new Run(
			`state def G7d {
                attribute n : Integer = 0;
                entry; then a;
                state a;
                transition first a accept after 5 [s] do send new Tick() to self then a;
                transition first a accept Tick do assign n := n + 1 then a;
            }`,
			'G7d'
		).play([{ wait: 12 }]);
		expect(run.session.variables.n).toBe(2);
		expect(run.trace).toEqual([
			'0: entry -> a',
			'5: a -> a',
			'5: a -> a',
			'10: a -> a',
			'10: a -> a'
		]);
	});

	const IF = `state def G8 {
        attribute x : Integer = 10;
        attribute y : Integer = 0;
        entry; then a;
        state a { entry action { assign y := 5; if x > 5 { assign y := 7; } } }
    }`;
	const THEN = `state def G9 {
        attribute n : Integer = 0;
        entry; then a;
        state a { entry action { assign n := 1; then assign n := n + 10; } }
    }`;

	it('an `if` or a succession inside an action runs, so the machine has no note', () => {
		expect(machineOf(IF, 'G8').warnings).toBeUndefined();
		expect(machineOf(THEN, 'G9').warnings).toBeUndefined();
		// The timeline shows the whole action, not only its assignments.
		expect(machineOf(IF, 'G8').states.find((s) => s.name === 'a')!.entry).toBe(
			'assign y := 5; if x > 5 { assign y := 7; }'
		);
	});

	// Loops run since action bodies run as flows (`flow.ts`); the `while` is no longer noted.
	it('a step the simulator does not run is still noted: a send elsewhere', () => {
		const m = machineOf(
			`package G9b {
                item def Timeout;
                action def PowerUp;
                part ground;
                state def M {
                    attribute n : Integer = 0;
                    entry; then a;
                    state a { do action { assign n := n + 1; } exit action powerUp : PowerUp; }
                    state b { entry assign n := 0; do monitor; }
                    state c { entry action { while n < 3 { assign n := n + 1; } } }
                    action monitor;
                    transition t1 first a accept Go do send new Timeout() to self then b;
                    transition t2 first b accept Back do assign n := 2 then a;
                    transition t3 first b accept Report do send new Timeout() to ground then c;
                }
            }`,
			'M'
		);
		expect(m.warnings).toEqual([
			'effect of transition t3: `send new Timeout() to ground` is not run; only signals sent to the machine itself are'
		]);
	});

	// Before the fix only `assign y := 5` ran.
	it('an `if` inside an entry action runs', () => {
		expect(new Run(IF, 'G8').session.variables.y).toBe(7);
		expect(new Run(IF, 'G8', { x: 1 }).session.variables.y).toBe(5);
	});

	// Before the fix only `assign n := 1` ran.
	it('a succession inside an entry action runs in order', () => {
		expect(new Run(THEN, 'G9').session.variables.n).toBe(11);
	});

	it('`else if` and `else` take the first branch that holds; effects and exit actions run their steps too', () => {
		const source = `state def G9c {
            attribute x : Integer = 0;
            attribute log : String = "";
            entry; then a;
            state a {
                exit action {
                    if x > 10 { assign log := log + "big "; }
                    else if x > 5 { assign log := log + "mid "; }
                    else { assign log := log + "small "; }
                }
            }
            state b;
            transition first a accept Go do action { if x == 7 { assign log := log + "seven "; } then assign x := 0; } then b;
        }`;
		expect(new Run(source, 'G9c', { x: 20 }).fire('Go').log).toBe('big ');
		expect(new Run(source, 'G9c', { x: 7 }).fire('Go').log).toBe('mid seven ');
		const small = new Run(source, 'G9c', { x: 1 }).fire('Go');
		expect(small.log).toBe('small ');
		expect(small.session.variables.x).toBe(0);
	});

	it('a guard that reads the trigger’s payload blocks, with a reason, when the model gives the signal no value', () => {
		const run = new Run(
			`package G10 {
                item def Reading { attribute v : Integer; }
                state def M {
                    entry; then a; state a; state b;
                    transition first a accept r : Reading if r.v > 3 then b;
                }
            }`,
			'M'
		);
		const t = run.session.enabled[0]!;
		expect(t.ready).toBe(false);
		expect(t.reason).toBe('guard `r.v > 3`: `Reading` carries no value for `v`');
	});

	// Before the fix every guard reading a payload stayed blocked ("r.v has no value yet").
	it('a guard and an effect read the values a signal carries: its defaults, or what it was sent with', () => {
		const source = `package G10b {
            item def Reading { attribute v : Integer = 5; attribute unit : String = "C"; }
            state def M {
                attribute last : Integer = 0;
                attribute level : Integer = 2;
                entry; then a;
                state a { entry send new Reading(level) to self; }
                state b;
                state c;
                transition first a accept r : Reading if r.v > 3 do assign last := r.v then b;
                transition first a accept s : Reading if s.v <= 3 do assign last := 100 + s.v then c;
                transition first b accept r : Reading if r.v > 3 do assign last := r.v then a;
            }
        }`;
		const sent = new Run(source, 'M');
		expect(sent.session.queue).toEqual([
			{ signal: 'Reading', values: { v: 2, unit: 'C' }, from: 'the entry action of `a`' }
		]);
		sent.fire(null);
		// Sent with level = 2: the second transition takes it.
		expect(sent.session).toMatchObject({ current: ['c'], variables: { last: 102 } });
		expect(sent.session.trace.at(-1)!.reads).toEqual({ 's.v': 2 });

		const run = new Run(source, 'M', { level: 9 }).fire(null);
		expect(run.session).toMatchObject({ current: ['b'], variables: { last: 9 } });
		// Sent from the event buttons: the definition's default (5).
		expect(run.session.enabled.find((e) => e.from === 'b')).toMatchObject({ ready: true });
		run.fire('Reading');
		expect(run.session).toMatchObject({ current: ['a'], variables: { last: 5 } });
		// …or values given with it.
		const given = plain(step(run.machine, run.session, { event: null }));
		expect(given.current).toEqual(['b']);
		const low = plain(step(run.machine, given, { event: 'Reading', payload: { v: 1 } }));
		expect(low.current).toEqual(['b']);
		expect(low.messages).toEqual(['`Reading` fires no transition from b']);
	});
});

describe('concurrent regions', () => {
	it('two regions setting one variable in one step: noted on the step (the order is open in SysML)', () => {
		const run = new Run(
			`state def P1 {
                attribute x : Integer = 0;
                entry; then p;
                state p parallel {
                    state r1 { entry; then a; state a; state a2; transition t1 first a accept Go do assign x := 1 then a2; }
                    state r2 { entry; then b; state b; state b2; transition t2 first b accept Go do assign x := 2 then b2; }
                }
            }`,
			'P1'
		).fire('Go');
		expect(run.session.variables.x).toBe(2);
		const [first, second] = run.session.trace.slice(-2);
		expect(first!.notes).toBeUndefined();
		expect(second!.notes).toEqual([
			'`x` is also set by `t1` in this step: the regions run at the same time, so the result depends on an order SysML leaves open (the simulator runs them in the order written)'
		]);
	});

	it('regions setting different variables are not noted', () => {
		const run = new Run(
			`state def P2 {
                attribute x : Integer = 0;
                attribute y : Integer = 0;
                entry; then p;
                state p parallel {
                    state r1 { entry; then a; state a; state a2; transition first a accept Go do assign x := 1 then a2; }
                    state r2 { entry; then b; state b; state b2; transition first b accept Go do assign y := 2 then b2; }
                }
            }`,
			'P2'
		).fire('Go');
		expect(run.session.trace.some((s) => s.notes)).toBe(false);
	});
});

describe('why each step fired', () => {
	it('each step records its cause, the values its guard read and the transitions it went before', () => {
		const run = new Run(
			`state def W1 {
                attribute x : Integer = 3;
                attribute ok : Boolean = true;
                entry; then a;
                state a; state b; state c; state d; state e;
                transition ta first a accept Go if x > 2 and ok then b;
                transition tb first a accept Go if x < 5 then c;
                transition first b accept when x > 4 then c;
                transition first c accept after 30 [s] then d;
                transition first d then e;
            }`,
			'W1'
		)
			.fire('Go')
			.play([{ step: true, vars: { x: 5 } }, { wait: 'next' }, STEP]);
		const steps = run.session.trace.map(({ step: n, cause, reads, preempted, time }) => ({
			n,
			cause,
			reads,
			preempted,
			time
		}));
		expect(steps).toEqual([
			{ n: 0, cause: 'start', reads: undefined, preempted: undefined, time: 0 },
			{ n: 1, cause: 'event `Go`', reads: { x: 3, ok: true }, preempted: ['tb'], time: 0 },
			{ n: 2, cause: '`when x > 4` turned true', reads: { x: 5 }, preempted: undefined, time: 0 },
			{
				n: 3,
				cause: '`after 30 [s]` came due at 30 s',
				reads: undefined,
				preempted: undefined,
				time: 30
			},
			{ n: 4, cause: 'completion of `d`', reads: undefined, preempted: undefined, time: 30 }
		]);
	});
});
describe('machines that never let time pass', () => {
	const CYCLE = `state def L1 {
        entry; then a;
        state a; state b;
        transition first a then b;
        transition first b then a;
    }`;
	const ALWAYS = `state def L2 {
        attribute n : Integer = 0;
        entry; then a;
        state a;
        transition first a accept when true do assign n := n + 1 then a;
    }`;

	it('a Wait on a cycle of untriggered transitions stops and says why', () => {
		const run = new Run(CYCLE, 'L1').play([{ wait: 1 }]);
		expect(run.session.messages?.join(' ')).toMatch(/stopped after 200 steps at 0 s/);
		expect(run.session.time).toBe(0);
	});

	it('a `when` that is always true on a self-transition stops the same way', () => {
		const run = new Run(ALWAYS, 'L2').play([{ wait: 10 }]);
		expect(run.session.messages?.join(' ')).toMatch(/stopped after 200 steps/);
		// 200 transitions fired, then the Wait stopped.
		expect(run.session.variables.n).toBe(200);
	});

	it('stepping one at a time reaches the step limit and the status says so', () => {
		const run = new Run(CYCLE, 'L1', null, { maxSteps: 25 });
		for (let i = 0; i < 30; i++) run.fire(null);
		expect(run.session.step).toBe(25);
		expect(run.session.status).toBe('max steps reached');
		expect(statusText(run.session.status)).toBe('Step limit reached');
		expect(run.fire(null).session.messages).toEqual([
			'the machine has taken 25 steps, its limit; restart it to run again'
		]);
	});
});

describe('auto-run', () => {
	// Before the fix ties were broken with Math.random, so two auto-runs of one machine could differ.
	it('is reproducible: the same machine and steps give the same moves, without chance', () => {
		const run = new Run(
			`state def A1 {
                entry; then s; state s; state x; state y;
                transition first s accept X then x;
                transition first s accept Y then y;
                transition first x accept Back then s;
                transition first y accept Back then s;
            }`,
			'A1'
		);
		const spy = vi.spyOn(Math, 'random');
		try {
			spy.mockReturnValue(0.99);
			expect(autoMove(run.session.enabled, run.session.trace)).toEqual({ event: 'X' });
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
		// A tour: X first (written first), back, then Y (sent fewer times), back.
		const moves: (string | null)[] = [];
		for (let i = 0; i < 4; i++) {
			const move = autoMove(run.session.enabled, run.session.trace)!;
			moves.push(move.event);
			run.fire(move.event);
		}
		expect(moves).toEqual(['X', 'Back', 'Y', 'Back']);
	});
});
