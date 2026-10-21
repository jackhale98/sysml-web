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
		expect(p.session.current).toEqual(['flying']);
		p.fire(null, { stateOfCharge: 0.1 });
		expect(p.session.current).toEqual(['returningHome']);
		p.fire('ArrivedHome').fire('TouchDown');
		expect(p.session.current).toEqual(['idle']);
		expect(p.session.step).toBe(5);
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

	it('a Step fires time triggers (no clock: a Step is time passing), as the controls already said', () => {
		const source = `state def M { entry; then a; state a; state b; transition first a accept after 5 [s] then b; }`;
		const p = new Run(files(source), 'M');
		expect(p.session.enabled[0]).toMatchObject({ trigger: 'after 5 [s]', ready: true });
		p.fire(null);
		expect(p.session.current).toEqual(['b']);
		// Sending its text as an event fires it too.
		expect(new Run(files(source), 'M').fire('after 5 [s]').session.current).toEqual(['b']);
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
