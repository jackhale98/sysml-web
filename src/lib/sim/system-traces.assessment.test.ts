/**
 * Reference traces for several parts' state machines run together
 * (`system.ts`), in the style of `reference-traces.assessment.test.ts`:
 * each case is a small SysML v2 model with a context whose parts exhibit
 * state machines, an input script, and the timeline the specifications
 * give for it, derived from them and not from what the simulator does.
 *
 * Where the expectations come from:
 * - Kernel Semantic Library `Transfers`: `SendPerformance` (a transfer from
 *   its `sender`, by default `this`, bound to its `receiver`'s
 *   `incomingTransfersToSelf` when one is given; `succession self then
 *   sentTransfer`), `AcceptPerformance` (a transfer among its `receiver`'s
 *   `incomingTransfersToSelf`, by default `this`).
 * - Systems Library `Ports`: "Transfers outgoing from a Port are always
 *   targeted to a Port connected to the original Port by an Interface"
 *   (`Port::outgoingTransfersFromSelf :> interfacingPorts.incomingTransfersToSelf`).
 * - KerML 7.4.6 / 8.3.4.6 binding connectors: the two ends of a binding are
 *   the same thing, so `bind link = inner.q` makes one port of two names.
 * - `StatePerformances`: a state performance accepts its incoming transfers
 *   in the order they arrived (`earlierFirstIncomingTransferSort`), one per
 *   run-to-completion step; one it does not accept is not deferred.
 * - `Occurrences::localClock` (defaults to `universalClock`): one clock for
 *   every part.
 *
 * Where they leave a choice open (the order in which parts that run at the
 * same time are listed; that a transfer takes no simulated time), the case
 * checks what is fixed plus the choice `docs/simulator.md` documents.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { MachineSystem } from '#lib/engine/types.ts';
import type { Variables } from './emulator.ts';
import { start, step, type PartVariables, type SystemSession } from './system.ts';

let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

function systemOf(text: string, name: string): MachineSystem {
	const all = host.machineSystems([{ path: 'model.sysml', text }]);
	const found = all.find((s) => s.name === name || s.qualifiedName === name);
	if (!found) throw new Error(`no system ${name} in [${all.map((s) => s.name).join(', ')}]`);
	return found;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Move =
	| { send: string; to: string; payload?: Variables; vars?: PartVariables }
	| { step: true; vars?: PartVariables }
	| { wait: number | 'next' };

class Run {
	readonly system: MachineSystem;
	session: SystemSession;
	constructor(text: string, name: string) {
		this.system = systemOf(text, name);
		this.session = plain(start(this.system));
	}
	play(moves: Move[]): this {
		for (const m of moves) {
			const choice =
				'send' in m
					? {
							part: m.to,
							event: m.send,
							...(m.payload ? { payload: m.payload } : {}),
							...(m.vars ? { variables: m.vars } : {})
						}
					: 'wait' in m
						? { wait: m.wait }
						: { step: true as const, ...(m.vars ? { variables: m.vars } : {}) };
			this.session = plain(step(this.system, this.session, choice));
		}
		return this;
	}
	/** The timeline after the start: `time part: from -> to`, `time a =Sig=> b`, `time a =Sig=> lost: why`, `time part: note`. */
	get timeline(): string[] {
		return this.session.timeline
			.filter((e) => e.kind !== 'step' || e.step.step > 0)
			.map((e) =>
				e.kind === 'step'
					? `${e.time} ${e.part}: ${e.step.from_state} -> ${e.step.to_state}`
					: e.kind === 'signal'
						? `${e.time} ${e.from} =${e.signal}=> ${e.lost ? `lost: ${e.lost}` : `${e.to}${e.port ? `.${e.port}` : ''}`}`
						: `${e.time} ${e.part}: ${e.text}`
			);
	}
	current(part: string): string[] {
		return this.session.parts[part]!.current;
	}
}

const STEP: Move = { step: true };

/** Two parts that answer each other through connected ports. */
const PINGPONG = `package S01 {
    item def Go; item def Ping; item def Pong;
    port def P;
    part def A {
        port p : P;
        exhibit state m {
            entry; then idle;
            state idle;
            state waiting { entry send new Ping() via p; }
            state over;
            transition first idle accept Go then waiting;
            transition first waiting accept Pong via p then over;
        }
    }
    part def B {
        port q : ~P;
        exhibit state m {
            entry; then ready;
            state ready; state replied;
            transition first ready accept Ping do send new Pong() via q then replied;
        }
    }
    part ctx {
        part a : A;
        part b : B;
        connect a.p to b.q;
    }
}`;

describe('signals between parts (reference traces)', () => {
	it('S01 a signal sent through a port reaches the part at the other end of its connection, and the answer comes back', () => {
		// Ports: a port's outgoing transfers target the ports connected to it; the
		// receiving part accepts it (`accept Ping`, receiver `this`) on a later step
		// (`succession self then sentTransfer`), at the same time (no duration given).
		const run = new Run(PINGPONG, 'ctx');
		expect(run.system.parts.map((p) => p.path)).toEqual(['a', 'b']);
		run.play([{ send: 'Go', to: 'a' }]);
		expect(run.current('a')).toEqual(['waiting']);
		// Sent, not yet taken: b is still ready, with Ping waiting.
		expect(run.current('b')).toEqual(['ready']);
		expect(run.session.parts.b!.queue?.map((q) => q.signal)).toEqual(['Ping']);
		run.play([STEP, STEP]);
		expect(run.timeline).toEqual([
			'0 a: idle -> waiting',
			'0 a =Ping=> b.q',
			'0 b: ready -> replied',
			'0 b =Pong=> a.p',
			'0 a: waiting -> over'
		]);
		expect(run.current('a')).toEqual(['over']);
		expect(run.session.time).toBe(0);
	});

	it('S02 `accept … via p` takes a signal only if it came in at `p`', () => {
		// AcceptPerformance: the transfer must be among the receiver's incoming
		// transfers; `via q2` makes the port q2 the receiver.
		const run = new Run(
			`package S02 {
                item def Ping; port def P;
                part def A { port p : P; exhibit state m {
                    entry; then s; state s { entry send new Ping() via p; } } }
                part def B { port q1 : ~P; port q2 : ~P; exhibit state m {
                    entry; then ready; state ready; state at1; state at2;
                    transition first ready accept Ping via q2 then at2;
                    transition first ready accept Ping via q1 then at1; } }
                part ctx { part a : A; part b : B; connect a.p to b.q1; }
            }`,
			'ctx'
		).play([STEP]);
		expect(run.timeline).toEqual(['0 a =Ping=> b.q1', '0 b: ready -> at1']);
	});

	it('S03 a part takes the signals that come to it one per step, in the order they arrived', () => {
		// earlierFirstIncomingTransferSort; one transition per run-to-completion step.
		const run = new Run(
			`package S03 {
                item def One; item def Two; port def P;
                part def A { port p : P; exhibit state m {
                    entry; then s;
                    state s { entry action { send new One() via p; send new Two() via p; } } } }
                part def B { port q : ~P; exhibit state m {
                    entry; then r; state r; state s1; state s2;
                    transition first r accept One then s1;
                    transition first s1 accept Two then s2; } }
                part ctx { part a : A; part b : B; connect a.p to b.q; }
            }`,
			'ctx'
		);
		expect(run.session.parts.b!.queue?.map((q) => q.signal)).toEqual(['One', 'Two']);
		run.play([STEP]);
		expect(run.current('b')).toEqual(['s1']);
		run.play([STEP]);
		expect(run.current('b')).toEqual(['s2']);
	});

	it('S04 a signal no transition accepts is dropped when its turn comes; one that reaches no machine is lost when sent', () => {
		// StatePerformance: a transfer it does not accept is not deferred.
		const run = new Run(
			`package S04 {
                item def Go; item def Ping; item def Pong; port def P;
                part def A { port p : P; port loose : P; port toRadio : P; exhibit state m {
                    entry; then s; state s; state t;
                    transition first s accept Go
                        do action { send new Pong() via p; send new Ping() via loose; send new Ping() via toRadio; }
                        then t; } }
                part def B { port q : ~P; exhibit state m {
                    entry; then r; state r; state x;
                    transition first r accept Ping then x; } }
                part def Radio { port q : ~P; }
                part ctx { part a : A; part b : B; part radio : Radio;
                    connect a.p to b.q; connect a.toRadio to radio.q; }
            }`,
			'ctx'
		).play([{ send: 'Go', to: 'a' }, STEP]);
		expect(run.timeline).toEqual([
			'0 a: s -> t',
			'0 a =Pong=> b.q',
			'0 a =Ping=> lost: `loose` of `a` is connected to nothing',
			'0 a =Ping=> lost: it reaches `radio.q`, whose part has no state machine',
			'0 b: `Pong`, sent by `a` through `p`, fires no transition from r: it is dropped'
		]);
		expect(run.current('b')).toEqual(['r']);
	});

	it('S05 a binding makes one port of two names: a signal goes on to the inner part', () => {
		// KerML binding connectors: both ends are the same feature value.
		const run = new Run(
			`package S05 {
                item def Ping; port def P;
                part def A { port p : P; exhibit state m {
                    entry; then s; state s { entry send new Ping() via p; } } }
                part def B { port q : ~P; exhibit state m {
                    entry; then r; state r; state x; transition first r accept Ping via q then x; } }
                part ctx {
                    part a : A;
                    part box { port link : ~P; part inner : B; bind link = inner.q; }
                    connect a.p to box.link;
                }
            }`,
			'ctx'
		).play([STEP]);
		expect(run.timeline).toEqual(['0 a =Ping=> box.inner.q', '0 box.inner: r -> x']);
	});

	it('S06 `send … to x` goes to the part it names, and carries its values', () => {
		// SendPerformance: `receiver.incomingTransfersToSelf = sentTransfer`.
		const run = new Run(
			`package S06 {
                private import ScalarValues::*;
                item def Reading { attribute v : Integer default 1; }
                part ctx {
                    part a { exhibit state m {
                        entry; then s; state s { entry send new Reading(7) to b; } } }
                    part b { exhibit state m {
                        attribute last : Integer = 0;
                        entry; then r; state r; state high; state low;
                        transition first r accept x : Reading if x.v > 5 do assign last := x.v then high;
                        transition first r accept Reading then low; } }
                }
            }`,
			'ctx'
		).play([STEP]);
		expect(run.timeline).toEqual(['0 a =Reading=> b', '0 b: r -> high']);
		expect(run.session.parts.b!.variables.last).toBe(7);
	});

	it('S07 one clock: each part’s timers come due in time order, and parts with something ready step together', () => {
		// localClock defaults to universalClock for every occurrence: one time for all parts.
		const run = new Run(
			`package S07 {
                part ctx {
                    part a { exhibit state m { entry; then s; state s; state t;
                        transition first s accept after 5 [SI::s] then t; } }
                    part b { exhibit state m { entry; then s; state s; state t; state u;
                        transition first s accept after 3 [SI::s] then t;
                        transition first t accept after 2 [SI::s] then u; } }
                }
            }`,
			'ctx'
		).play([STEP]);
		expect(run.timeline).toEqual(['3 b: s -> t']);
		expect(run.session.time).toBe(3);
		expect(run.session.parts.a!.time).toBe(3);
		// At 5 s both are due: one Step takes both.
		run.play([STEP]);
		expect(run.timeline.slice(1)).toEqual(['5 a: s -> t', '5 b: t -> u']);
	});

	it('S08 a Wait runs the exchange on the way: the timer of one part sends, the other takes it', () => {
		const run = new Run(
			`package S08 {
                item def Ping; port def P;
                part def A { port p : P; exhibit state m { entry; then s; state s; state t;
                    transition first s accept after 10 [SI::s] do send new Ping() via p then t; } }
                part def B { port q : ~P; exhibit state m { entry; then r; state r; state x;
                    transition first r accept Ping then x; } }
                part ctx { part a : A; part b : B; connect a.p to b.q; }
            }`,
			'ctx'
		).play([{ wait: 60 }]);
		expect(run.timeline).toEqual(['10 a: s -> t', '10 a =Ping=> b.q', '10 b: r -> x']);
		expect(run.session.time).toBe(60);
	});

	it('an event sent to a part waits for the signals that came to it first', () => {
		const run = new Run(PINGPONG, 'ctx').play([{ send: 'Go', to: 'a' }]);
		// b has Ping waiting; Ping sent by hand now would come after it.
		run.play([{ send: 'Ping', to: 'b' }]);
		expect(run.session.messages?.[0]).toBe(
			'b: `Ping`, sent by `a` through `p`, comes first: Step, then send `Ping`'
		);
	});

	it('the same moves give the same session (determinism), through JSON', () => {
		const moves: Move[] = [{ send: 'Go', to: 'a' }, STEP, STEP];
		const one = new Run(PINGPONG, 'ctx').play(moves).session;
		const two = new Run(PINGPONG, 'ctx').play(moves).session;
		expect(two).toEqual(one);
	});
});

describe('the demo', () => {
	it('the ground station console commands the flight controller over the command link', async () => {
		const { demoFiles } = await import('#lib/engine/toolkit/testing.ts');
		const system = host.machineSystems(demoFiles()).find((s) => s.name === 'linkTest')!;
		expect(system.parts.map((p) => [p.path, p.machine.name])).toEqual([
			['station', 'console'],
			['controller', 'FlightModes']
		]);
		let s = start(system);
		s = step(system, s, {
			part: 'station',
			event: 'StartFlight',
			variables: { controller: { preflightChecksPassed: true } }
		});
		s = step(system, s, { step: true });
		expect(s.parts.controller!.current).toEqual(['armed']);
		// To the console's timer, taking everything that happens then on the way.
		s = step(system, s, { wait: 'next' });
		expect(s.time).toBe(10);
		expect(s.parts.station!.current).toEqual(['watching']);
		expect(s.parts.controller!.current).toEqual(['flying.cruising']);
	});
});
