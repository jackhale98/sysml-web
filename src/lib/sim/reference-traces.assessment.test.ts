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
		title: 'entry, do and exit actions: do starts after entry; exit, effect, entry, do on a transition',
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
		title: 'nested states: exits innermost first, entries outermost first, default substates entered',
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
		title: 'a transition into a nested state enters its ancestors, then that state, not the default',
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
		title: 'parallel regions: entered together, one event steps both, the parallel state completes when every region is done',
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
		title: 'event ordering: an event no transition of the current state accepts is discarded, not kept',
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
		basis: 'SysML 7.18.3 (a transition to done: the source is the final state of the containing state)',
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

describe('where the simulator departs from the semantics', () => {
	// Known gap (critical): an event sent while a transition without a trigger is ready is taken from a state the machine has already left.
	it.fails('a transition without a trigger is taken before an event sent after it became ready', () => {
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
		).fire('Go');
		expect(run.trace).toEqual(['0: entry -> a', '0: a -> b', '0: b -> d']);
	});

	// Known gap (critical): as above, for a change trigger whose condition already holds.
	it.fails('a change trigger that holds on entry fires before a later event', () => {
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
		).fire('Go');
		expect(run.trace).toEqual(['0: entry -> a', '0: a -> b']);
	});

	it('the UI offers the event as ready while the untriggered transition is pending (how G1 reaches the user)', () => {
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
		// Records today's behaviour: Go is offered as ready too.
		expect(go.ready).toBe(true);
	});

	// Known gap (critical): two signals with the same simple name in different packages are treated as one.
	it.fails('signals are matched by the signal they name, not by their last name segment', () => {
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

	// Known gap: a change signal that comes while the guard is false is kept, not lost (the simulator loses time signals in that case).
	it.fails('a change signal that comes while the guard is false is not taken later', () => {
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
	});

	// Known gap: conditional initial transitions (`entry; if c then x;`) are not followed.
	it.fails('a conditional initial transition enters the state its guard selects', () => {
		const source = `state def G5 {
            attribute startOn : Boolean = true;
            entry;
            if startOn then on;
            if not startOn then off;
            state off;
            state on;
        }`;
		expect(new Run(source, 'G5').session.current).toEqual(['on']);
		expect(new Run(source, 'G5', { startOn: false }).session.current).toEqual(['off']);
	});

	it('…and the machine carries a note that its initial transition was not understood', () => {
		const m = machineOf(
			`state def G5n {
                attribute startOn : Boolean = true;
                entry;
                if startOn then on;
                if not startOn then off;
                state off;
                state on;
            }`,
			'G5n'
		);
		expect(m.warnings?.length ?? 0).toBeGreaterThan(0);
	});

	// Known gap: `terminate` is not supported.
	it.fails('a transition to a terminate action ends the machine', () => {
		const run = new Run(
			`state def G6 {
                entry; then on;
                state on;
                accept Abort then stop;
                action stop terminate;
            }`,
			'G6'
		).fire('Abort');
		expect(run.session.status).toBe('completed');
		expect(run.session.current).not.toContain('stop');
	});

	it('…and the machine carries a note about the terminate target', () => {
		const m = machineOf(
			`state def G6n {
                entry; then on;
                state on;
                accept Abort then stop;
                action stop terminate;
            }`,
			'G6n'
		);
		expect(m.warnings?.length ?? 0).toBeGreaterThan(0);
	});

	// Known gap: a signal a state's entry action sends to its own part is not delivered.
	it.fails('a signal sent to the machine’s own part by an entry action triggers its transition', () => {
		const run = new Run(
			`package G7 {
                item def Ping;
                part ctl {
                    exhibit state m {
                        entry; then a;
                        state a { entry send new Ping() to ctl; }
                        state b;
                        transition first a accept Ping then b;
                    }
                }
            }`,
			'm'
		).fire(null);
		expect(run.session.current).toEqual(['b']);
	});

	// Known gap: the steps of an action other than assignments (if, successions) are skipped without a note.
	it.fails('an `if` inside an entry action runs (or the step says it was skipped)', () => {
		const run = new Run(
			`state def G8 {
                attribute x : Integer = 10;
                attribute y : Integer = 0;
                entry; then a;
                state a { entry action { assign y := 5; if x > 5 { assign y := 7; } } }
            }`,
			'G8'
		);
		const reported = !!(run.session.trace[0]?.notes?.length || run.session.messages?.length);
		expect(run.session.variables.y === 7 || reported).toBe(true);
	});

	// Known gap: as above, for `then` successions inside an action.
	it.fails('a succession inside an entry action runs in order (or the step says it was skipped)', () => {
		const run = new Run(
			`state def G9 {
                attribute n : Integer = 0;
                entry; then a;
                state a { entry action { assign n := 1; then assign n := n + 10; } }
            }`,
			'G9'
		);
		const reported = !!(run.session.trace[0]?.notes?.length || run.session.messages?.length);
		expect(run.session.variables.n === 11 || reported).toBe(true);
	});

	it('a guard that reads the trigger’s payload blocks, with a reason, rather than firing', () => {
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
		expect(t.reason).toBeTruthy();
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
		expect(run.session.variables.n).toBe(201);
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
	it('breaks ties between ready events at random, so two auto-runs may differ', () => {
		const run = new Run(
			`state def A1 {
                entry; then s; state s; state x; state y;
                transition first s accept X then x;
                transition first s accept Y then y;
            }`,
			'A1'
		);
		const spy = vi.spyOn(Math, 'random');
		try {
			spy.mockReturnValue(0);
			const first = autoMove(run.session.enabled, run.session.trace);
			spy.mockReturnValue(0.99);
			const second = autoMove(run.session.enabled, run.session.trace);
			expect(first).toEqual({ event: 'X' });
			expect(second).toEqual({ event: 'Y' });
		} finally {
			spy.mockRestore();
		}
	});
});
