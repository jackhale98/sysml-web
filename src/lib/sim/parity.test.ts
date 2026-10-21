/**
 * Parity with the Rust engine's `stateStep` (the emulator this one
 * replaces): both run the same machines through the same steps — scripted
 * sequences, and every event or Step reachable within a few moves — and
 * must give the same sessions. Where this emulator deliberately differs
 * (it follows the SysML v2 / UML state machine semantics where the Rust
 * one did not, or supports more of the expression language), the
 * `deliberate differences` tests pin both behaviours.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StateMachine, StateSession } from '#lib/engine/types.ts';
import { start, step, type Variables } from './emulator.ts';
import { flightModes, nestedMachine } from './fixtures.ts';

const ROOT = join(import.meta.dirname, '../../demo/drone');
const ENGINE = join(import.meta.dirname, '../../../static/engine');

interface Wasm {
	initSync(options: { module: Buffer }): void;
	stateMachines(files: string): string;
	stateStep(
		files: string,
		machine: string,
		session: string | null,
		event: string | null,
		variables: string | null
	): string;
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
	);
}

let wasm: Wasm;
let demo: string;

beforeAll(async () => {
	wasm = (await import(/* @vite-ignore */ join(ENGINE, 'sysml_wasm.js'))) as Wasm;
	wasm.initSync({ module: readFileSync(join(ENGINE, 'sysml_wasm_bg.wasm')) });
	demo = JSON.stringify(
		walk(ROOT)
			.filter((f) => f.endsWith('.sysml'))
			.map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }))
	);
});

const files = (text: string, path = 'model.sysml') => JSON.stringify([{ path, text }]);

/** The machine as the classic engine extracts it (the emulator's input). */
function machineOf(project: string, name: string): StateMachine {
	const all = JSON.parse(wasm.stateMachines(project)) as StateMachine[];
	const found = all.find((m) => m.name === name || m.qualifiedName === name);
	if (!found) throw new Error(`no machine ${name}`);
	return found;
}

/** Plain JSON, as a session crosses the worker boundary (and as Rust returns it). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One machine run by both emulators side by side. */
class Pair {
	readonly machine: StateMachine;
	rust: StateSession;
	ts: StateSession;

	constructor(
		readonly project: string,
		readonly name: string,
		variables: Variables | null = null
	) {
		this.machine = machineOf(project, name);
		this.rust = this.rustStep(null, null, variables);
		this.ts = plain(start(this.machine, variables));
	}

	private rustStep(
		session: StateSession | null,
		event: string | null,
		variables: Variables | null
	) {
		return JSON.parse(
			wasm.stateStep(
				this.project,
				this.name,
				session ? JSON.stringify(session) : null,
				event,
				variables ? JSON.stringify(variables) : null
			)
		) as StateSession;
	}

	fire(event: string | null, variables: Variables | null = null): this {
		this.rust = this.rustStep(this.rust, event, variables);
		this.ts = plain(step(this.machine, this.ts, { event, variables: variables ?? undefined }));
		return this;
	}

	/** Fire on both from the same session (so a difference does not compound). */
	branch(event: string | null, variables: Variables | null = null): Pair {
		const copy = Object.create(Pair.prototype) as Pair;
		Object.assign(copy, this);
		return copy.fire(event, variables);
	}

	expectSame(context = '') {
		expect(this.ts, context).toEqual(this.rust);
	}
}

/**
 * From every reachable session (within `depth` moves), fire each distinct
 * event the session lists, a Step, and a Step with each of `tweaks` (variable
 * changes), and compare. Returns how many
 * sessions were compared.
 */
function explore(
	pair: Pair,
	depth: number,
	extra: (string | null)[] = [],
	tweaks: Variables[] = []
): number {
	const seen = new Set<string>();
	let compared = 0;
	const visit = (p: Pair, left: number, path: string) => {
		p.expectSame(path);
		compared++;
		const key = JSON.stringify([p.rust.current, p.rust.variables, p.rust.status]);
		if (seen.has(key) || left === 0) return;
		seen.add(key);
		const events = new Set<string | null>([null, ...extra]);
		for (const e of p.rust.enabled) if (e.trigger) events.add(e.trigger);
		for (const event of events) visit(p.branch(event), left - 1, `${path} → ${event ?? 'Step'}`);
		for (const t of tweaks)
			visit(p.branch(null, t), left - 1, `${path} → Step ${JSON.stringify(t)}`);
	};
	visit(pair, depth, 'start');
	return compared;
}

const LAMP = `package Home {
    item def Toggle;
    state def Lamp {
        attribute brightness : Real = 0.5;
        attribute switches : Integer = 0;
        entry; then off;
        state off;
        state on { entry assign switches := switches + 1; }
        transition turnOn first off accept Toggle if brightness > 0 then on;
        transition turnOff first on accept Toggle then off;
        transition burnOut first on accept when switches > 1 then done;
    }
}`;

const COUNTER = `state def Counter {
    attribute count : Integer = 0;
    attribute limit : Integer = 2;
    entry; then idle;
    state idle { entry assign count := count + 1; }
    state busy;
    transition start first idle accept Go if count < limit then busy;
    transition finish first busy then idle;
    transition overflow first idle accept when count >= limit then done;
}`;

const DRONE = `state def Drone {
    attribute log : Integer = 0;
    entry; then off;
    state off;
    state on parallel {
        exit action { assign log := log + 100; }
        state motors {
            entry; then idle;
            state idle;
            state spinning { entry assign log := log + 1; }
            transition first idle accept Spin then spinning;
            transition first spinning accept Halt then idle;
        }
        state camera {
            entry; then standby;
            state standby;
            state recording;
            transition first standby accept Spin then recording;
            transition first recording accept Snap then standby;
        }
    }
    transition first off accept Start then on;
    transition first on accept Stop then off;
}`;

/** The emulator fixture `nestedMachine` as SysML. */
const NESTED = `package P {
    state def Machine {
        attribute count : Integer = 0;
        attribute mode : String = "a";
        entry; then off;

        state off;
        state on {
            entry; then low;
            entry action beep;
            exit action boop;
            state low;
            state high;
            transition up first low accept Go if count > 2 do action inc then high;
            transition down first high accept Stop then low;
        }
        state par parallel {
            state motors {
                entry; then idle;
                state idle; state spinning;
                transition first idle accept Spin then spinning;
            }
            state lights {
                entry; then dark;
                state dark; state lit;
                transition first dark accept Light then lit;
            }
        }
        state done;
        transition first off accept Power then on;
        transition first on accept Par then par;
        transition first par accept Finish then done;
        transition first on accept Off then off;
        transition first done then fin;
    }
}`;

/** Composite states that finish (final states in regions) and effects that assign. */
const MISSION = `package M {
    item def Go; item def Abort;
    state def Mission {
        attribute fuel : Real = 10;
        attribute legs : Integer = 0;
        attribute ok : Boolean = true;
        entry; then ground;
        state ground;
        state travel {
            entry; then outbound;
            exit action { assign legs := legs + 10; }
            state outbound { do action { assign fuel := fuel - 2.5; } }
            state inbound;
            state holding;
            transition first outbound accept Go do assign legs := legs + 1 then inbound;
            transition first inbound if fuel > 4 then holding;
            transition first inbound accept when fuel <= 4 then holding;
            transition first holding accept Home then done;
        }
        transition launch first ground accept Go if ok and fuel >= 5 then travel;
        transition landed first travel then ground;
        transition abort first travel accept Abort do assign ok := false then ground;
        transition retire first ground accept when not ok then done;
    }
}`;

describe('the emulator fixtures are what the classic engine extracts', () => {
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

describe('same sessions as the Rust emulator', () => {
	it('runs the demo FlightModes through a flight', () => {
		const p = new Pair(demo, 'FlightModes');
		p.expectSame('start');
		// Unset guard variable, then false, then true.
		p.fire('ArmCommand').expectSame('arm without checks');
		p.fire('ArmCommand', { preflightChecksPassed: false }).expectSame('arm, checks failed');
		p.fire('ArmCommand', { preflightChecksPassed: true }).expectSame('arm');
		p.fire('DisarmCommand').expectSame('disarm');
		p.fire('ArmCommand').expectSame('arm again');
		p.fire('TakeOffCommand').expectSame('take off');
		// The change trigger: not ready while the charge is unset or high, fires once low.
		p.fire(null).expectSame('step, charge unset');
		p.fire(null, { stateOfCharge: 0.9 }).expectSame('step, charge high');
		p.fire('when stateOfCharge < returnThreshold').expectSame('when as an event, charge high');
		p.fire(null, { stateOfCharge: 0.1 }).expectSame('step, charge low');
		p.fire('FaultDetected').expectSame('fault on return');
		p.fire('TouchDown').expectSame('emergency landed');
		p.fire('Nope').expectSame('unknown event');
		p.fire('DroneInterfaces::ArmCommand').expectSame('qualified signal');
		p.fire('TakeOffCommand').expectSame('take off');
		p.fire('LinkLost').expectSame('link lost');
		p.fire('ArrivedHome').expectSame('over depot');
		p.fire('TouchDown').expectSame('landed');
		p.fire('ArmCommand', { returnThreshold: null }).expectSame('unset a variable');
		expect(p.ts.step).toBe(13);
	});

	it('explores every event and Step of FlightModes', () => {
		let total = 0;
		for (const variables of [
			null,
			{ preflightChecksPassed: true, stateOfCharge: 0.9 },
			{ preflightChecksPassed: true, stateOfCharge: 0.1 },
			{ preflightChecksPassed: false, stateOfCharge: 0.3 }
		]) {
			total += explore(
				new Pair(demo, 'FlightModes', variables),
				6,
				['Nope'],
				[{ stateOfCharge: 0.1 }, { stateOfCharge: null, preflightChecksPassed: true }]
			);
		}
		expect(total).toBeGreaterThan(100);
	}, 30_000);

	it('runs the nested fixture: hierarchy, parallel regions, guards and an unknown state', () => {
		const p = new Pair(files(NESTED), 'Machine');
		p.expectSame('start');
		p.fire('Power').expectSame('power on: enter on and its default low');
		p.fire('Go').expectSame('guard false');
		p.fire('Go', { count: 3 }).expectSame('guard true');
		p.fire('Stop').expectSame('down');
		p.fire('Off').expectSame('outer transition exits the nested state');
		p.fire('Power').fire('Par').expectSame('into the parallel state');
		p.fire('Spin').expectSame('one region steps');
		p.fire('Light').expectSame('the other region steps');
		p.fire('Finish').expectSame('leave both regions');
		p.fire(null).expectSame('completion into the unknown state');
		p.fire(null).expectSame('deadlocked');
		p.fire('Power', { mode: 'b' }).expectSame('a string variable');
		expect(p.ts.status).toBe('deadlocked');
		expect(explore(new Pair(files(NESTED), 'Machine', { count: 5 }), 7)).toBeGreaterThan(10);
	});

	it('runs the Lamp: change triggers, assignments in entry actions, final state', () => {
		const p = new Pair(files(LAMP), 'Lamp');
		p.fire('Toggle', { brightness: 0 }).expectSame('guard false');
		p.fire('Toggle', { brightness: 1 }).expectSame('guard true');
		p.fire('Toggle').fire('Toggle').expectSame('count');
		p.fire(null).expectSame('change trigger');
		expect(p.ts.status).toBe('completed');
		p.fire('Toggle').expectSame('finished');
		expect(explore(new Pair(files(LAMP), 'Home::Lamp'), 8)).toBeGreaterThan(5);
	});

	it('runs the Counter: completion transitions and guards that read assigned values', () => {
		expect(explore(new Pair(files(COUNTER), 'Counter'), 8, ['Nope'])).toBeGreaterThan(5);
		expect(explore(new Pair(files(COUNTER), 'Counter', { limit: 4 }), 10)).toBeGreaterThan(5);
	});

	it('runs the Drone: one event steps both regions, exit actions of a parallel state', () => {
		const p = new Pair(files(DRONE), 'Drone');
		p.fire('Start').expectSame('enter both regions');
		p.fire('Spin').expectSame('both regions take Spin');
		p.fire('Snap').fire('Halt').expectSame('each region alone');
		p.fire('Stop').expectSame('exit the parallel state');
		expect(p.ts.variables.log).toBe(101);
		expect(explore(new Pair(files(DRONE), 'Drone'), 6)).toBeGreaterThan(5);
	});

	it('runs the Mission: composite completion, do actions, effects and change triggers', () => {
		const p = new Pair(files(MISSION), 'Mission');
		p.fire(null).expectSame('nothing ready');
		p.fire('Go').expectSame('launch: do action burns fuel');
		p.fire(null).expectSame('travel has not finished');
		p.fire('Go').expectSame('effect assigns');
		p.fire(null).expectSame('inbound guard and change');
		p.fire(null).expectSame('travel has not finished yet');
		p.fire('Home').expectSame('reach the final state');
		p.fire(null).expectSame('travel finished: completion leaves it');
		p.fire('Go').expectSame('launch again');
		p.fire('Abort').expectSame('abort effect');
		p.fire(null).expectSame('retire');
		expect(p.ts.status).toBe('completed');
		expect(explore(new Pair(files(MISSION), 'Mission', { fuel: 20 }), 8)).toBeGreaterThan(10);
		expect(explore(new Pair(files(MISSION), 'Mission', { fuel: 6 }), 8)).toBeGreaterThan(5);
	});

	it('reports the same expression results and errors', () => {
		const exprs = [
			'not a and b',
			'not x > 3',
			'a or b and c',
			'-2 ** 2',
			'2 ** 3 ** 2',
			'1 - 2 - 3',
			'x == 5 or b',
			'a xor b and c',
			'10 / 4',
			'7 % 3',
			'x / 0',
			'x % 0',
			'x > 3 and y < 3',
			'5 [s]',
			'5 [SI::km] + 1',
			'abs(-3)',
			'sqrt(16)',
			'sqrt(-1)',
			'floor(2.5) + ceil(2.5) + round(2.5) + round(-2.5)',
			'max(1, x, 3) + min(4, y)',
			'sum(1, 2, 3) + product(2, 3) + mean(2, 4) + avg(1, 2) + count(1, 1, 1)',
			'rss(3, 4)',
			'clamp(x, 0, 3)',
			'convert(1, "kg", "g")',
			'convert(1, "kg", "m")',
			'abs(1, 2)',
			'nope(1)',
			'"ab" + "c"',
			'"a" < "b"',
			'a + 1',
			'null',
			'x != 5',
			'not (x > 3)',
			'missing + 1',
			'a and 1',
			'x == true',
			'0.1 + 0.2'
		];
		const assigns = exprs.map((e, i) => `assign r${i} := ${e};`).join(' ');
		const source = `state def E {
            attribute a : Boolean = true; attribute b : Boolean = false; attribute c : Boolean = true;
            attribute x : Real = 5; attribute y : Real = 2;
            entry; then s;
            state s { entry action { ${assigns} } }
        }`;
		const p = new Pair(files(source), 'E');
		p.expectSame();
		expect(p.ts.messages?.length).toBeGreaterThan(5);
	});

	it('rejects a session from another machine the same way', () => {
		const machine = machineOf(files(LAMP), 'Lamp');
		const stale = { ...start(machine), current: ['gone'] };
		expect(() => step(machine, stale, { event: null })).toThrow(
			'session does not match `Lamp`: no state `gone`'
		);
		expect(() => wasm.stateStep(files(LAMP), 'Lamp', JSON.stringify(stale), null, null)).toThrow(
			'no state `gone`'
		);
	});
});

describe('deliberate differences from the Rust emulator', () => {
	it('an inner transition takes priority over an outer one on the same event (UML 14.2.3.9.4)', () => {
		// Rust fires both: `on.low → on.high`, then `on → off` from the same event.
		const source = `state def M {
            entry; then on;
            state on { entry; then low; state low; state high; transition up first low accept Go then high; }
            state off;
            transition out first on accept Go then off;
        }`;
		const p = new Pair(files(source), 'M').fire('Go');
		expect(p.rust.current).toEqual(['off']);
		expect(p.rust.trace.map((s) => s.transition_name)).toEqual([null, 'up', 'out']);
		expect(p.ts.current).toEqual(['on.high']);
		expect(p.ts.trace.map((s) => s.transition_name)).toEqual([null, 'up']);
		// Before firing, the outer one shows as pre-empted rather than ready.
		const before = new Pair(files(source), 'M');
		const out = before.ts.enabled.find((e) => e.transition === 'out')!;
		expect(out).toMatchObject({ ready: false, reason: '`up` fires first' });
		expect(before.rust.enabled.find((e) => e.transition === 'out')!.ready).toBe(true);
	});

	it('of two ready transitions from one state, the later one shows as pre-empted', () => {
		const source = `state def M {
            attribute x : Integer = 1;
            entry; then s; state s; state a; state b;
            transition first s accept Go if x > 0 then a;
            transition first s accept Go if x < 5 then b;
        }`;
		const p = new Pair(files(source), 'M');
		expect(p.rust.enabled.map((e) => e.ready)).toEqual([true, true]);
		expect(p.ts.enabled.map((e) => e.ready)).toEqual([true, false]);
		// Both fire the first one.
		p.fire('Go');
		expect(p.ts.current).toEqual(p.rust.current);
	});

	it('guards of one step are evaluated before any transition of it fires (UML run-to-completion)', () => {
		// Region `a`'s effect sets `flag`; region `b`'s guard reads it. Rust evaluates `b`'s guard after `a` fired.
		const source = `state def M {
            attribute flag : Boolean = false;
            entry; then p;
            state p parallel {
                state a { entry; then a1; state a1; state a2; transition first a1 accept Go do assign flag := true then a2; }
                state b { entry; then b1; state b1; state b2; transition first b1 accept Go if flag then b2; }
            }
        }`;
		const p = new Pair(files(source), 'M').fire('Go');
		expect(p.rust.current).toEqual(['p.a.a2', 'p.b.b2']);
		expect(p.ts.current).toEqual(['p.a.a2', 'p.b.b1']);
	});

	it('a step fires only what was enabled when it began; a completion it causes waits for the next Step', () => {
		// Rust fires the inner transition into the final state, then (same Step) the outer
		// completion transition it just enabled. In UML the completion event of `travel` is
		// dispatched as a new run-to-completion step.
		const source = `state def M {
            entry; then travel;
            state travel { entry; then a; state a; transition first a then done; }
            state ground;
            transition landed first travel then ground;
        }`;
		const p = new Pair(files(source), 'M').fire(null);
		expect(p.rust.current).toEqual(['ground']);
		expect(p.ts.current).toEqual(['travel.done']);
		p.ts = step(p.machine, p.ts, { event: null });
		expect(p.ts.current).toEqual(['ground']);
		expect(p.ts.trace.slice(1).map((s) => s.to_state)).toEqual(
			p.rust.trace.slice(1).map((s) => s.to_state)
		);
	});

	it('a Step fires time triggers (no clock: a Step is time passing), as the controls already said', () => {
		const source = `state def M { entry; then a; state a; state b; transition first a accept after 5 [s] then b; }`;
		const p = new Pair(files(source), 'M');
		// Rust lists it as ready for a Step, but a Step does not fire it.
		expect(p.rust.enabled[0]).toMatchObject({ trigger: 'after 5 [s]', ready: true });
		p.fire(null);
		expect(p.rust.current).toEqual(['a']);
		expect(p.ts.current).toEqual(['b']);
		// Sending its text as an event fires it in both.
		const q = new Pair(files(source), 'M').fire('after 5 [s]');
		expect(q.ts.current).toEqual(q.rust.current);
	});

	it('a parallel machine completes when every region reaches its final state', () => {
		const source = `part def D {
            exhibit state m parallel {
                state r1 { entry; then a; state a; transition first a accept Go then done; }
                state r2 { entry; then b; state b; transition first b accept Go then done; }
            }
        }`;
		const p = new Pair(files(source), 'm').fire('Go');
		expect(p.ts.current).toEqual(['r1.done', 'r2.done']);
		expect(p.ts.current).toEqual(p.rust.current);
		expect(p.rust.status).toBe('deadlocked');
		expect(p.ts.status).toBe('completed');
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
		const p = new Pair(files(source), 'M');
		// Rust drops the units: 10 > 30 and 500 >= 1.
		expect(p.rust.enabled.map((e) => e.guardResult)).toEqual([false, true]);
		expect(p.ts.enabled.map((e) => e.guardResult)).toEqual([true, false]);
		p.fire('Check').fire(null);
		expect(p.ts.variables.range).toBe(1500);
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
		const p = new Pair(files(source), 'M');
		expect(p.rust.variables.mode).toBeNull();
		expect(p.ts.variables.mode).toBe('cruise');
		expect(p.ts.enabled[0]).toMatchObject({ guardResult: false });
		p.fire('Go', { mode: 'hover' });
		expect(p.ts.current).toEqual(['b']);
	});

	it('`and`, `or` and `implies` skip their second operand when the first decides (KerML)', () => {
		const source = `state def M {
            attribute ok : Boolean = true;
            entry; then a; state a; state b;
            transition first a accept Go if ok or unset > 1 then b;
        }`;
		const p = new Pair(files(source), 'M');
		expect(p.rust.enabled[0]).toMatchObject({ ready: false });
		expect(p.ts.enabled[0]).toMatchObject({ ready: true, guardResult: true });
	});

	it('reads more of the expression syntax: `&`, `|`, `^`, `if … ? … else`, `??`, `self.x`', () => {
		const source = `state def M {
            attribute x : Real = 2;
            entry; then s;
            state s { entry action { assign a := x > 1 & x < 3; assign b := not (x > 1) | false; assign c := x ^ 3; assign d := if x > 1 ? 10 else 20; assign e := missing ?? 7; assign f := self.x * 2; } }
        }`;
		const p = new Pair(files(source), 'M');
		expect(p.rust.messages).toHaveLength(6);
		expect(p.ts.messages).toBeUndefined();
		expect(p.ts.variables).toMatchObject({ a: true, b: false, c: 8, d: 10, e: 7, f: 4 });
	});
});
