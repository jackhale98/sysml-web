/**
 * The emulator on machines as the toolkit extracts them (`toolkit/machines.ts`,
 * what the app runs): the fixtures are what the toolkit extracts, scripted
 * runs through the demo and the SysML fixtures, and the places where the
 * emulator follows the SysML v2 / UML state machine semantics (run to
 * completion, priorities, completion events) or reads more of the
 * expression language than a plain reading would.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '#lib/engine/protocol.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { StateMachine, StateSession } from '#lib/engine/types.ts';
import { start, step, type Variables } from './emulator.ts';
import { COUNTER, DRONE, LAMP, MISSION, NESTED, flightModes, nestedMachine } from './fixtures.ts';

let host: ToolkitHost;
const demo = demoFiles();

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const files = (text: string, path = 'model.sysml'): SourceFile[] => [{ path, text }];

/** The machine as the toolkit extracts it (the emulator's input in the app). */
function machineOf(project: SourceFile[], name: string): StateMachine {
	const all = host.stateMachines(project);
	const found = all.find((m) => m.name === name || m.qualifiedName === name);
	if (!found) throw new Error(`no machine ${name}`);
	return found;
}

/** Plain JSON, as a session crosses the worker boundary. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One machine, run step by step. */
class Run {
	readonly machine: StateMachine;
	session: StateSession;

	constructor(project: SourceFile[], name: string, variables: Variables | null = null) {
		this.machine = machineOf(project, name);
		this.session = plain(start(this.machine, variables));
	}

	fire(event: string | null, variables: Variables | null = null): this {
		this.session = plain(
			step(this.machine, this.session, { event, variables: variables ?? undefined })
		);
		return this;
	}

	/** Let time pass: so many seconds, or to the next timer. */
	wait(seconds: number | 'next', variables: Variables | null = null): this {
		this.session = plain(
			step(this.machine, this.session, { wait: seconds, variables: variables ?? undefined })
		);
		return this;
	}

	/** Each step since the start as `time: from -> to`. */
	get steps(): string[] {
		return this.session.trace.map((s) => `${s.time}: ${s.from_state} -> ${s.to_state}`);
	}
}

describe('the emulator fixtures are what the toolkit extracts', () => {
	/** Without file names and line numbers. */
	const shape = (m: StateMachine) =>
		JSON.parse(
			JSON.stringify(m, (key, value: unknown) =>
				key === 'file' || key === 'line' ? undefined : value
			)
		) as unknown;

	it('flightModes is the demo FlightModes', () => {
		expect(machineOf(demo, 'FlightModes')).toEqual(flightModes);
	});

	it('nestedMachine is the NESTED source', () => {
		expect(shape(machineOf(files(NESTED), 'Machine'))).toEqual(shape(nestedMachine));
	});
});

describe('runs the machines the toolkit extracts', () => {
	it('runs the demo FlightModes through a flight', () => {
		const p = new Run(demo, 'FlightModes');
		p.fire('ArmCommand', { preflightChecksPassed: true });
		expect(p.session.current).toEqual(['armed']);
		p.fire('TakeOffCommand');
		expect(p.session.current).toEqual(['flying.cruising']);
		p.fire(null, { stateOfCharge: 0.1 });
		expect(p.session.current).toEqual(['returningHome']);
		p.fire('ArrivedHome').fire('TouchDown');
		expect(p.session.current).toEqual(['charging']);
		expect(p.session.step).toBe(5);
	});

	it('runs the demo FlightModes through a charge cycle with Steps alone, after the commands', () => {
		const p = new Run(demo, 'FlightModes', { preflightChecksPassed: true });
		p.fire('ArmCommand').fire('TakeOffCommand');
		expect(p.session.doing).toEqual(['flying']);
		// Every 5 minutes in the air uses 15 % of the battery; below 30 % the drone turns home.
		for (let i = 0; i < 5; i++) p.fire(null);
		expect(p.session.time).toBe(25 * 60);
		expect(p.session.variables.stateOfCharge).toBeCloseTo(0.25);
		expect(p.session.current).toEqual(['flying.cruising']);
		// The low charge is taken at once, before more time passes.
		p.fire(null);
		expect(p.session.current).toEqual(['returningHome']);
		expect(p.session.time).toBe(25 * 60);
		expect(p.session.trace.at(-1)).toMatchObject({
			transition_name: 'lowBattery',
			do_stopped: 'followFlightPlan'
		});
		expect(p.session.doing).toEqual([]);
		p.fire('ArrivedHome').fire('TouchDown');
		expect(p.session.current).toEqual(['charging']);
		// Every 10 minutes on the charger adds 25 %; at 95 % the drone is ready.
		p.fire(null).fire(null).fire(null);
		expect(p.session.time).toBe(55 * 60);
		expect(p.session.current).toEqual(['charging']);
		p.fire(null);
		expect(p.session.current).toEqual(['idle']);
		expect(p.session.time).toBe(55 * 60);
		expect(p.session.trace.map((s) => s.transition_name)).toEqual([
			null,
			'arm',
			'takeOff',
			...Array<string>(5).fill('useCharge'),
			'lowBattery',
			'overDepot',
			'landed',
			'addCharge',
			'addCharge',
			'addCharge',
			'charged'
		]);
		expect(p.session.messages).toBeUndefined();
	});

	it('runs the nested fixture into a state it does not know, and deadlocks there', () => {
		const p = new Run(files(NESTED), 'Machine');
		p.fire('Power').fire('Par').fire('Spin').fire('Light');
		expect(p.session.current).toEqual(['par.motors.spinning', 'par.lights.lit']);
		p.fire('Finish').fire(null).fire(null);
		expect(p.session.status).toBe('deadlocked');
	});

	it('runs the Lamp: change triggers, assignments in entry actions, final state', () => {
		const p = new Run(files(LAMP), 'Lamp');
		p.fire('Toggle', { brightness: 1 }).fire('Toggle').fire('Toggle');
		expect(p.session.variables.switches).toBe(2);
		p.fire(null);
		expect(p.session.status).toBe('completed');
	});

	it('runs the Counter: completion transitions and guards that read assigned values', () => {
		const p = new Run(files(COUNTER), 'Counter');
		expect(p.session.variables.count).toBe(1);
		p.fire('Go').fire(null);
		expect(p.session.current).toEqual(['idle']);
		expect(p.session.variables.count).toBe(2);
		p.fire(null);
		expect(p.session.status).toBe('completed');
	});

	it('runs the Drone: one event steps both regions, exit actions of a parallel state', () => {
		const p = new Run(files(DRONE), 'Drone');
		p.fire('Start').fire('Spin');
		expect(p.session.current).toEqual(['on.motors.spinning', 'on.camera.recording']);
		p.fire('Snap').fire('Halt').fire('Stop');
		expect(p.session.current).toEqual(['off']);
		expect(p.session.variables.log).toBe(101);
	});

	it('runs the Mission: composite completion, do actions, effects and change triggers', () => {
		const p = new Run(files(MISSION), 'Mission');
		p.fire('Go').fire('Go').fire(null).fire('Home').fire(null);
		expect(p.session.current).toEqual(['ground']);
		p.fire('Go').fire('Abort').fire(null);
		expect(p.session.status).toBe('completed');
		expect(p.session.variables.ok).toBe(false);
	});
});

describe('state machine semantics', () => {
	it('an inner transition takes priority over an outer one on the same event (UML 14.2.3.9.4)', () => {
		const source = `state def M {
            entry; then on;
            state on { entry; then low; state low; state high; transition up first low accept Go then high; }
            state off;
            transition leave first on accept Go then off;
        }`;
		const p = new Run(files(source), 'M');
		// Before firing, the outer one shows as pre-empted rather than ready.
		const out = p.session.enabled.find((e) => e.transition === 'leave')!;
		expect(out).toMatchObject({ ready: false, reason: '`up` fires first' });
		p.fire('Go');
		expect(p.session.current).toEqual(['on.high']);
		expect(p.session.trace.map((s) => s.transition_name)).toEqual([null, 'up']);
	});

	it('of two ready transitions from one state, the later one shows as pre-empted', () => {
		const source = `state def M {
            attribute x : Integer = 1;
            entry; then s; state s; state a; state b;
            transition first s accept Go if x > 0 then a;
            transition first s accept Go if x < 5 then b;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.enabled.map((e) => e.ready)).toEqual([true, false]);
		p.fire('Go');
		expect(p.session.current).toEqual(['a']);
	});

	it('guards of one step are evaluated before any transition of it fires (UML run-to-completion)', () => {
		// Region `a`'s effect sets `flag`; region `b`'s guard reads it, before `a` fired.
		const source = `state def M {
            attribute flag : Boolean = false;
            entry; then p;
            state p parallel {
                state a { entry; then a1; state a1; state a2; transition first a1 accept Go do assign flag := true then a2; }
                state b { entry; then b1; state b1; state b2; transition first b1 accept Go if flag then b2; }
            }
        }`;
		const p = new Run(files(source), 'M').fire('Go');
		expect(p.session.current).toEqual(['p.a.a2', 'p.b.b1']);
	});

	it('a step fires only what was enabled when it began; a completion it causes waits for the next Step', () => {
		// The completion event of `travel` is dispatched as a new run-to-completion step.
		const source = `state def M {
            entry; then travel;
            state travel { entry; then a; state a; transition first a then done; }
            state ground;
            transition landed first travel then ground;
        }`;
		const p = new Run(files(source), 'M').fire(null);
		expect(p.session.current).toEqual(['travel.done']);
		p.fire(null);
		expect(p.session.current).toEqual(['ground']);
		expect(p.session.trace.slice(1).map((s) => s.to_state)).toEqual(['travel.done', 'ground']);
	});

	it('a parallel machine completes when every region reaches its final state', () => {
		const source = `part def D {
            exhibit state m parallel {
                state r1 { entry; then a; state a; transition first a accept Go then done; }
                state r2 { entry; then b; state b; transition first b accept Go then done; }
            }
        }`;
		const p = new Run(files(source), 'm').fire('Go');
		expect(p.session.current).toEqual(['r1.done', 'r2.done']);
		expect(p.session.status).toBe('completed');
	});

	it('numbers with units convert between compatible units', () => {
		const source = `state def M {
            attribute speed : Real = 10 [m/s];
            attribute range : Real = 500 [m];
            entry; then a; state a; state fast; state far;
            transition first a accept Check if speed > 30 [km/h] then fast;
            transition first a accept Far if range >= 1 [km] then far;
            transition first fast do assign range := range + 1 [km] then a;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.enabled.map((e) => e.guardResult)).toEqual([true, false]);
		p.fire('Check').fire(null);
		expect(p.session.variables.range).toBe(1500);
	});

	it('enum literals are values, not undefined variables', () => {
		const source = `package P {
            enum def Mode { enum cruise; enum hover; }
            state def M {
                attribute mode : Mode = Mode::cruise;
                entry; then a; state a; state b;
                transition first a accept Go if mode == Mode::hover then b;
                transition first b do assign mode := Mode::cruise then a;
            }
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.variables.mode).toBe('cruise');
		expect(p.session.enabled[0]).toMatchObject({ guardResult: false });
		p.fire('Go', { mode: 'hover' });
		expect(p.session.current).toEqual(['b']);
	});

	it('`and`, `or` and `implies` skip their second operand when the first decides (KerML)', () => {
		const source = `state def M {
            attribute ok : Boolean = true;
            entry; then a; state a; state b;
            transition first a accept Go if ok or unset > 1 then b;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.enabled[0]).toMatchObject({ ready: true, guardResult: true });
	});

	it('reads more of the expression syntax: `&`, `|`, `^`, `if … ? … else`, `??`, `self.x`', () => {
		const source = `state def M {
            attribute x : Real = 2;
            entry; then s;
            state s { entry action { assign a := x > 1 & x < 3; assign b := not (x > 1) | false; assign c := x ^ 3; assign d := if x > 1 ? 10 else 20; assign e := missing ?? 7; assign f := self.x * 2; } }
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.messages).toBeUndefined();
		expect(p.session.variables).toMatchObject({ a: true, b: false, c: 8, d: 10, e: 7, f: 4 });
	});
});

describe('simulated time (TriggerAfter, TriggerAt: KerML 9.2.14)', () => {
	it('`after d` fires d after its state was entered; a Step lets time pass to the next timer', () => {
		const source = `state def M {
            entry; then a;
            state a; state b; state c;
            transition slow first a accept after 30 [SI::min] then c;
            transition quick first a accept after 1 [SI::min] then b;
            transition first b accept after 90 [s] then a;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.time).toBe(0);
		expect(p.session.enabled.map((e) => [e.transition, e.ready, e.due, e.reason])).toEqual([
			['slow', false, 1800, '`after 30 [SI::min]` is due at 30 min'],
			['quick', false, 60, '`after 1 [SI::min]` is due at 1 min']
		]);
		// The shorter one comes first, whatever the order they are written in.
		p.fire(null);
		expect(p.session.current).toEqual(['b']);
		expect(p.session.time).toBe(60);
		p.fire(null);
		expect(p.session.current).toEqual(['a']);
		expect(p.session.time).toBe(150);
		expect(p.steps).toEqual(['0: entry -> a', '60: a -> b', '150: b -> a']);
		// Its text is not an event: it fires when its time comes.
		expect(p.fire('after 1 [SI::min]').session.messages).toEqual([
			'`after 1 [SI::min]` is a time trigger: it fires when its time comes (Step or Wait)'
		]);
	});

	it('re-entering a state starts its timers again', () => {
		const source = `state def M {
            entry; then a;
            state a; state b;
            transition first a accept after 10 [s] then b;
            transition poke first a accept Poke then a;
        }`;
		const p = new Run(files(source), 'M').wait(6);
		expect(p.session).toMatchObject({ time: 6, current: ['a'], timers: { '1': 10 } });
		p.fire('Poke');
		expect(p.session).toMatchObject({ time: 6, entered: { a: 6 }, timers: { '1': 16 } });
		p.fire(null);
		expect(p.session.current).toEqual(['b']);
		expect(p.session.time).toBe(16);
	});

	it('`at t` fires at that time; one already past when its state is entered never fires', () => {
		const source = `state def M {
            entry; then a;
            state a; state b; state c;
            transition first a accept at 2 [SI::min] then b;
            transition first b accept Back then a;
            transition first b accept at 1 [SI::min] then c;
        }`;
		const p = new Run(files(source), 'M').fire(null);
		expect(p.session).toMatchObject({ time: 120, current: ['b'] });
		expect(p.session.enabled.find((e) => e.to === 'c')).toMatchObject({
			ready: false,
			reason: '`at 1 [SI::min]` had passed when `b` was entered, at 2 min'
		});
		p.wait(10).fire('Back');
		expect(p.fire(null).session.messages).toEqual([
			'nothing is ready in a, and no timer is running'
		]);
		expect(p.session.trace.at(-1)?.notes).toEqual([
			'`a -> b` will not fire: `at 2 [SI::min]` had passed when `a` was entered, at 2 min 10 s'
		]);
	});

	it('a change made true by an assignment is taken before more time passes, wherever it is written', () => {
		// The timer is written first; timing, not the order, decides.
		const source = `state def M {
            attribute soc : Real = 0.2;
            entry; then charging;
            state charging; state idle;
            transition first charging accept after 1 [SI::min] do assign soc := soc + 0.4 then charging;
            transition first charging accept when soc >= 0.9 then idle;
        }`;
		const p = new Run(files(source), 'M');
		p.fire(null).fire(null);
		expect(p.session).toMatchObject({ time: 120, current: ['charging'] });
		expect(p.session.variables.soc).toBeCloseTo(1);
		expect(p.session.enabled.map((e) => e.ready)).toEqual([false, true]);
		p.fire(null);
		expect(p.session).toMatchObject({ time: 120, current: ['idle'] });
		expect(p.session.variables.soc).toBeCloseTo(1);
	});

	it('a timer and a change trigger ready at the same instant: the one written first fires', () => {
		// The specifications leave this tie open (KerML orders signals by arrival only).
		const source = (first: string, second: string) => `state def M {
            attribute x : Integer = 1;
            entry; then a;
            state a; state t; state w;
            ${first}
            ${second}
        }`;
		const timer = 'transition first a accept after 0 [s] then t;';
		const change = 'transition first a accept when x > 0 then w;';
		expect(new Run(files(source(timer, change)), 'M').fire(null).session.current).toEqual(['t']);
		expect(new Run(files(source(change, timer)), 'M').fire(null).session.current).toEqual(['w']);
	});

	it('timers in nested states run on while an inner state changes; an outer one leaves it all', () => {
		const source = `state def M {
            attribute n : Integer = 0;
            entry; then outer;
            state outer {
                entry; then inner;
                state inner;
                transition tick first inner accept after 1 [SI::min] do assign n := n + 1 then inner;
            }
            state done2;
            transition timeout first outer accept after 150 [s] then done2;
        }`;
		const p = new Run(files(source), 'M');
		p.fire(null).fire(null);
		expect(p.session).toMatchObject({ time: 120, current: ['outer.inner'], variables: { n: 2 } });
		// The inner self-transition does not restart the outer timer.
		expect(p.session.entered).toEqual({ outer: 0, 'outer.inner': 120 });
		p.fire(null);
		expect(p.session).toMatchObject({ time: 150, current: ['done2'], timers: {} });
	});

	it('timers in parallel regions each fire at their own time, together when they coincide', () => {
		const source = `state def M {
            entry; then p;
            state p parallel {
                state r1 { entry; then a; state a; state a2; transition first a accept after 10 [s] then a2; }
                state r2 { entry; then b; state b; state b2; transition first b accept after 20 [s] then b2; }
                state r3 { entry; then c; state c; state c2; transition first c accept after 20 [s] then c2; }
            }
        }`;
		const p = new Run(files(source), 'M');
		p.fire(null);
		expect(p.session).toMatchObject({ time: 10, current: ['p.r1.a2', 'p.r2.b', 'p.r3.c'] });
		p.fire(null);
		expect(p.session).toMatchObject({ time: 20, current: ['p.r1.a2', 'p.r2.b2', 'p.r3.c2'] });
		expect(p.session.step).toBe(3);
	});

	it('Wait lets time pass by an amount or to the next timer, taking what comes due on the way', () => {
		const source = `state def M {
            attribute soc : Real = 0.2;
            entry; then charging;
            state charging; state idle;
            transition first charging accept after 1 [SI::min] do assign soc := soc + 0.4 then charging;
            transition first charging accept when soc >= 0.9 then idle;
        }`;
		const p = new Run(files(source), 'M').wait(30);
		expect(p.session).toMatchObject({ time: 30, step: 0, current: ['charging'] });
		p.wait('next');
		expect(p.session).toMatchObject({ time: 60, step: 1 });
		// The change fires at 2 min, on the way; then time goes on to 10 min with nothing to do.
		p.wait(540);
		expect(p.session).toMatchObject({ time: 600, step: 3, current: ['idle'] });
		expect(p.steps.slice(-2)).toEqual(['120: charging -> charging', '120: charging -> idle']);
		expect(p.wait('next').session.messages).toEqual(['no timer is running in idle']);
	});

	it('a time signal that comes while the guard is false is lost until the state is entered again', () => {
		const source = `state def M {
            attribute ok : Boolean = false;
            entry; then a;
            state a; state b;
            transition first a accept after 5 [s] if ok then b;
            transition first a accept Again then a;
        }`;
		const p = new Run(files(source), 'M').fire(null);
		expect(p.session.time).toBe(5);
		expect(p.session.messages).toEqual([
			'at 5 s nothing fired: `after 5 [s]` came at 5 s while guard `ok` is false'
		]);
		expect(p.fire(null, { ok: true }).session.current).toEqual(['a']);
		p.fire('Again').fire(null);
		expect(p.session).toMatchObject({ time: 10, current: ['b'] });
	});

	it('a time it cannot work out is noted in the trace, never fires, and counts from when it can', () => {
		const source = `state def M {
            attribute delay : Real;
            entry; then a;
            state a; state b; state c;
            transition late first a accept after delay then b;
            transition far first a accept after 5 [m] then c;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.trace[0]!.notes).toEqual([
			'`late` will not fire: time `after delay`: undefined variable `delay`',
			'`far` will not fire: time `after 5 [m]`: 5 [m] is not a time'
		]);
		expect(p.session.enabled.map((e) => e.ready)).toEqual([false, false]);
		expect(p.fire(null).session.messages).toEqual([
			'nothing is ready in a, and no timer is running'
		]);
		// Giving it a value starts it from now; a bare number counts seconds.
		p.wait(100).wait('next', { delay: 30 });
		expect(p.session).toMatchObject({ time: 130, current: ['b'] });
	});
});

describe('do actions (SysML v2 7.18.2, 7.18.3)', () => {
	it('start after the entry action; one of assignments runs once and completes', () => {
		const source = `state def M {
            attribute log : String = "";
            entry; then a;
            state a {
                entry action { assign log := log + "entry "; }
                do action { assign log := log + "do"; }
            }
            state b;
            transition first a accept after 1 [s] then b;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.variables.log).toBe('entry do');
		expect(p.session.doing).toEqual([]);
		expect(p.session.trace[0]).toMatchObject({ do_action: 'assign log := log + "do"' });
		// Time passing does not run it again.
		p.wait(0.5);
		expect(p.session.variables.log).toBe('entry do');
	});

	it('any other runs while its state is active and is stopped when it is exited, before the exit action', () => {
		const source = `state def M {
            entry; then flying;
            state flying {
                do action followFlightPlan;
                exit action land;
                entry; then cruising;
                state cruising;
                transition first cruising accept after 1 [SI::min] then cruising;
            }
            state ground;
            transition first flying accept Home then ground;
            transition first flying accept Reset then flying;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.session.doing).toEqual(['flying']);
		expect(p.session.trace[0]).toMatchObject({ do_action: 'followFlightPlan' });
		// An inner step leaves it running.
		p.fire(null);
		expect(p.session.doing).toEqual(['flying']);
		expect(p.session.trace.at(-1)).toMatchObject({ do_action: null, do_stopped: null });
		// Re-entering the state stops it and starts it again.
		p.fire('Reset');
		expect(p.session.trace.at(-1)).toMatchObject({
			do_stopped: 'followFlightPlan',
			exit_action: 'land',
			do_action: 'followFlightPlan'
		});
		p.fire('Home');
		expect(p.session.trace.at(-1)).toMatchObject({ do_stopped: 'followFlightPlan' });
		expect(p.session.doing).toEqual([]);
	});

	it('a transition without a trigger waits for the substates to finish, not for the do action (nonDoMiddle)', () => {
		const source = `state def M {
            entry; then work;
            state work {
                do action monitor;
                entry; then step1;
                state step1;
                transition first step1 accept Next then done;
            }
            state rest;
            transition first work then rest;
        }`;
		const p = new Run(files(source), 'M');
		expect(p.fire(null).session.current).toEqual(['work.step1']);
		p.fire('Next').fire(null);
		expect(p.session.current).toEqual(['rest']);
		expect(p.session.trace.at(-1)).toMatchObject({ do_stopped: 'monitor' });
	});
});
