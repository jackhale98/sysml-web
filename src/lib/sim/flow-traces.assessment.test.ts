/**
 * Reference traces for running actions: action flows (`flow-run.ts`) and
 * the bodies of a state machine's actions (`emulator.ts` through
 * `flow.ts`).
 *
 * Each case is a small SysML v2 model, the moves made (Steps, signals,
 * choices) and what the specification says happens. The expectations come
 * from SysML v2.0 Part 1, 7.17 (Actions: successions and their shorthand,
 * control nodes, send and accept, assignment, `if`, loops, `perform`) and
 * the Systems Library's `Actions` package and the Kernel Semantic
 * Library's `ControlPerformances` and `Occurrences`, quoted where used:
 *
 * - `Actions::ForkAction`: "Fork behavior results from requiring that the
 *   target multiplicity of all outgoing succession connectors be 1..1";
 *   `JoinAction`: "… the source multiplicity of all incoming succession
 *   connectors be 1..1": a join waits for every incoming succession.
 * - `ControlPerformances::DecisionPerformance`: "the outgoingHBLink is an
 *   instance of exactly one of the Successions"; `MergePerformance`: "the
 *   incomingHBLink is an instance of exactly one of the Successions".
 * - `Actions::ControlAction`: "bind start = done": control nodes take no time.
 * - `ControlPerformances::LoopPerformance`: the body iterates "as long as
 *   the whileTest evaluation result is true before each iteration … and
 *   the untilTest evaluation result is not true after each iteration";
 *   `WhileLoopAction::whileTest` "is evaluated before the body is performed
 *   and is always evaluated at least once"; `untilTest` "is evaluated after
 *   the body is performed".
 * - `Actions::ForLoopAction`: "iterates over an ordered sequence of
 *   values", assigning `var := seq#(index)` for index 1 to `size(seq)`.
 * - `Actions::AcceptAction`: "waits for a payload or message of the
 *   specified kind to be accepted"; `SendAction` "initiates an
 *   outgoingTransferFromSelf … optionally to a designated receiver".
 * - `IfThenElsePerformance`: the then clause "occurs after and only after
 *   the ifTest evaluation result is true", the else clause "after and only
 *   after the ifTest evaluation is false".
 * - 7.17 (Actions Overview): steps not ordered by successions may happen
 *   in any order, at the same time. Where the order changes a result, the
 *   case checks only what is fixed plus the simulator's documented choice
 *   (written order, with a note; `docs/action-runs.md`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { ActionFlow, StateMachine } from '#lib/engine/types.ts';
import { start, step } from './emulator.ts';
import { FlowRunner, autoMove, type FlowMove, type FlowSession } from './flow-run.ts';

let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A run of one action of a model, as the app extracts and runs it. */
class Run {
	readonly runner: FlowRunner;
	session: FlowSession;

	constructor(text: string, name: string, variables: Record<string, unknown> = {}) {
		const flows: ActionFlow[] = host.actionFlows([{ path: 'model.sysml', text }]);
		const flow = flows.find((f) => f.name === name || f.qualifiedName === name);
		if (!flow) throw new Error(`no action ${name} in [${flows.map((f) => f.name).join(', ')}]`);
		this.runner = new FlowRunner(flow, flows);
		this.session = plain(this.runner.start(variables));
	}

	move(m: FlowMove = { step: true }, variables?: Record<string, unknown>): this {
		this.session = plain(this.runner.move(this.session, m, variables));
		return this;
	}

	steps(n: number): this {
		for (let i = 0; i < n; i++) this.move();
		return this;
	}

	/** Step until the run ends or waits (at most `limit` steps). */
	toEnd(limit = 100): this {
		for (let i = 0; i < limit && this.session.status === 'running'; i++) this.move();
		return this;
	}

	/** What ended in each step, in the order written: `a b | c`. */
	get ended(): string[] {
		return this.session.trace
			.slice(1)
			.map((s) =>
				s.events
					.filter((e) => e.what === 'ended')
					.map((e) => e.node)
					.join(' ')
			)
			.filter(Boolean);
	}

	get running(): string[] {
		return this.runner.outlook(this.session).running.map((r) => r.path);
	}

	value(path: string): unknown {
		return this.session.state.variables[path];
	}

	get notes(): string[] {
		return this.session.trace.flatMap((s) => s.notes ?? []);
	}
}

describe('successions and control nodes', () => {
	it('`then` chains the steps: each starts when the one before it ends', () => {
		// 7.17: `then x` is a succession from the step declared before it; `start` and `done` are the action's own.
		const run = new Run(
			`action def A { first start; then action a; then action b; then done; }`,
			'A'
		).toEnd();
		expect(run.ended).toEqual(['a', 'b']);
		expect(run.session.status).toBe('completed');
	});

	it('a step no succession leads to starts with the action', () => {
		// 7.17: steps not ordered by successions are not ordered: `c` starts at the start, with `a`.
		const run = new Run(
			`action def A { first start; then action a; then action b; action c; }`,
			'A'
		);
		expect(run.running.sort()).toEqual(['a', 'c']);
		run.toEnd();
		expect(run.ended).toEqual(['a c', 'b']);
		expect(run.session.status).toBe('completed');
	});

	it('a fork starts all its targets; a join waits for every one of them', () => {
		// ForkAction: every outgoing succession happens; JoinAction: every incoming one must.
		const run = new Run(
			`action def A {
                attribute x : Integer = 0;
                first start;
                then fork;
                    then slow;
                    then quick;
                action slow { assign x := 1; then assign x := 2; then assign x := 3; }
                then j;
                action quick;
                then j;
                join j;
                then action finish;
                then done;
            }`,
			'A'
		);
		expect(run.running.sort()).toEqual(['quick', 'slow', 'slow.assign#1']);
		run.move();
		// `quick` has ended; its token waits at the join for `slow`.
		expect(run.ended).toEqual(['slow.assign#1 quick']);
		expect(run.running).not.toContain('finish');
		run.toEnd();
		expect(run.ended.at(-1)).toBe('finish');
		expect(run.ended.slice(0, -1).join(' ')).toContain('slow');
		expect(run.ended.findIndex((s) => s.split(' ').includes('slow'))).toBeLessThan(
			run.ended.indexOf('finish')
		);
		expect(run.value('x')).toBe(3);
		expect(run.session.status).toBe('completed');
	});

	it('a merge passes on each token that comes to it', () => {
		// MergePerformance: each incoming succession leads on, one at a time.
		const source = `action def A {
            in attribute go : Boolean;
            attribute count : Integer = 0;
            first start;
            then decide;
                if go then left;
                else right;
            action left; then m;
            action right; then m;
            merge m;
            then assign count := count + 1;
            then done;
        }`;
		const left = new Run(source, 'A', { go: true }).toEnd();
		expect(left.ended).toEqual(['left', 'assign#1']);
		expect(left.value('count')).toBe(1);
		const right = new Run(source, 'A', { go: false }).toEnd();
		expect(right.ended).toEqual(['right', 'assign#1']);
		expect(right.value('count')).toBe(1);
	});
});

describe('decisions', () => {
	const source = `action def D {
        in attribute speed : Real;
        first start;
        then decide;
            if speed > 10 then fast;
            if speed > 20 then faster;
            else slow;
        action fast; then done;
        action faster; then done;
        action slow; then done;
    }`;

	it('takes the branch whose guard holds', () => {
		// DecisionPerformance: exactly one outgoing succession.
		const run = new Run(source, 'D', { speed: 15 }).toEnd();
		expect(run.ended).toEqual(['fast']);
		expect(run.session.status).toBe('completed');
	});

	it('takes `else` when no guard holds', () => {
		const run = new Run(source, 'D', { speed: 5 }).toEnd();
		expect(run.ended).toEqual(['slow']);
	});

	it('when several guards hold, waits for a choice rather than picking one', () => {
		// The specification says exactly one branch is taken, not which: the run asks.
		const run = new Run(source, 'D', { speed: 25 });
		expect(run.session.status).toBe('waiting');
		const o = run.runner.outlook(run.session);
		expect(o.choices).toHaveLength(1);
		expect(o.choices[0]!.reason).toBe(
			'`speed > 10` and `speed > 20` all hold: choose the branch to take'
		);
		expect(o.choices[0]!.options.map((x) => x.text)).toEqual([
			'[speed > 10] fast',
			'[speed > 20] faster'
		]);
		expect(o.canStep).toBe(false);
		run.move({ choose: o.choices[0]!.path, edge: o.choices[0]!.options[1]!.edge }).toEnd();
		expect(run.ended).toEqual(['faster']);
		expect(run.session.trace[1]!.cause).toBe('chose [speed > 20] faster');
	});

	it('auto-run takes the first written of several, and says so', () => {
		const run = new Run(source, 'D', { speed: 25 });
		const move = autoMove(run.runner.outlook(run.session))!;
		run.move(move).toEnd();
		expect(run.ended).toEqual(['fast']);
		expect(run.session.trace[1]!.cause).toMatch(
			/several guards hold, and auto-run takes the first written/
		);
	});

	it('when no guard holds and there is no `else`, the token waits and the run says why', () => {
		const run = new Run(
			`action def D { in attribute ok : Boolean; first start; then decide; if ok then a; action a; }`,
			'D',
			{ ok: false }
		);
		expect(run.session.status).toBe('stuck');
		expect(run.runner.outlook(run.session).blocked.map((b) => b.reason)).toEqual([
			'no guard holds (`ok`) and there is no `else`'
		]);
		// A value given later is read again.
		run.move({ step: true }, { ok: true }).toEnd();
		expect(run.ended).toEqual(['a']);
	});

	it('a guard that reads a value nobody gave waits, naming the value', () => {
		const run = new Run(
			`action def D { first start; then check; action check { out attribute clear : Boolean; }
                then decide; if check.clear then go; else stay; action go; action stay; }`,
			'D'
		).toEnd();
		expect(run.session.status).toBe('stuck');
		expect(run.runner.outlook(run.session).blocked[0]!.reason).toBe(
			'guard `check.clear`: undefined variable `check.clear`'
		);
		run.move({ step: true }, { 'check.clear': false }).toEnd();
		expect(run.ended.at(-1)).toBe('stay');
	});
});

describe('loops', () => {
	it('`while` tests before each pass: a false test runs the body no times', () => {
		// WhileLoopAction::whileTest is evaluated before the body, at least once.
		const run = new Run(
			`action def L { attribute n : Integer = 0; attribute runs : Integer = 0;
                first start; then while n < 3 { assign n := n + 1; assign runs := runs + 1; } then done; }`,
			'L'
		).toEnd();
		expect(run.value('n')).toBe(3);
		expect(run.value('runs')).toBe(3);
		const none = new Run(
			`action def L { attribute n : Integer = 5; first start; then while n < 3 { assign n := n + 1; } then done; }`,
			'L'
		).toEnd();
		expect(none.value('n')).toBe(5);
		expect(none.session.status).toBe('completed');
	});

	it('`until` is tested after each pass: the body runs at least once', () => {
		// LoopPerformance: untilTest after each iteration; `loop` has no while test (default true).
		const run = new Run(
			`action def L { attribute n : Integer = 5; first start; then loop { assign n := n + 1; } until n >= 2; then done; }`,
			'L'
		).toEnd();
		expect(run.value('n')).toBe(6);
		const both = new Run(
			`action def L { attribute n : Integer = 0; first start; then while n < 10 { assign n := n + 1; } until n == 4; then done; }`,
			'L'
		).toEnd();
		expect(both.value('n')).toBe(4);
	});

	it('`for` takes each value of the sequence in order', () => {
		// ForLoopAction: var := seq#(index), index from 1 to size(seq).
		const run = new Run(
			`action def L { attribute total : Integer = 0; attribute last : Integer = 0;
                first start; then for i in 1..4 { assign total := total + i; } then for v in (7, 2, 9) { assign last := v; } then done; }`,
			'L'
		).toEnd();
		expect(run.value('total')).toBe(10);
		expect(run.value('last')).toBe(9);
	});

	it('a loop that never ends stops the run, with a note', () => {
		const run = new Run(
			`action def L { attribute n : Integer = 0; first start; then while true { assign n := n + 1; } then done; }`,
			'L'
		).toEnd(5000);
		expect(run.session.status).toBe('stopped');
		expect(run.session.state.stopped).toBe(
			'while true ran 1000 times; the run stops here in case it never ends'
		);
		expect(run.value('n')).toBe(1000);
	});
});

describe('perform and nested actions', () => {
	it('a performed action runs its own steps, with the values bound to its parameters', () => {
		// 7.17: `perform` performs the named action; `in x = 4` binds its parameter.
		const run = new Run(
			`package P {
                action def Double { in attribute x : Integer; out attribute y : Integer;
                    first start; then assign y := x * 2; then done; }
                action def Main { attribute result : Integer = 0;
                    first start;
                    then perform action d : Double { in x = 4; }
                    then assign result := d.y;
                    then done; }
            }`,
			'Main'
		).toEnd();
		expect(run.value('d.x')).toBe(4);
		expect(run.value('d.y')).toBe(8);
		expect(run.value('result')).toBe(8);
		// `d` ends once its own steps have (in the step its last one ends).
		expect(run.ended).toEqual(['d.assign#1 d', 'assign#1']);
		expect(run.session.status).toBe('completed');
	});

	it('a performed usage runs the steps of its definition', () => {
		const run = new Run(
			`package P {
                action def Fly { attribute legs : Integer = 0; first start; then assign legs := legs + 1; then done; }
                part def Drone { perform action flight : Fly; }
                part drone : Drone;
                action def Mission { first start; then perform drone.flight; then done; }
            }`,
			'Mission'
		).toEnd();
		expect(run.ended).toEqual(['perform#1.assign#1 perform#1']);
		expect(run.value('perform#1.legs')).toBe(1);
	});

	it('a nested action with steps of its own ends after them', () => {
		const run = new Run(
			`action def N { attribute log : String = "";
                first start;
                then action outer { first start; then assign log := log + "a"; then assign log := log + "b"; }
                then assign log := log + "c";
                then done; }`,
			'N'
		).toEnd();
		expect(run.value('log')).toBe('abc');
	});

	it('a `perform` of an action that does not exist is named before the run', () => {
		const run = new Run(`action def M { first start; then perform nowhere; then done; }`, 'M');
		expect(run.runner.unsupported()).toEqual([
			'M: `perform nowhere`: no action called `nowhere`, so it runs as one step'
		]);
		run.toEnd();
		expect(run.session.status).toBe('completed');
	});
});

describe('accept and send', () => {
	it('an `accept` waits for its signal; sending it lets the run go on', () => {
		// AcceptAction: waits for a payload of the specified kind.
		const run = new Run(
			`package S { item def Go;
                action def A { first start; then accept Go; then action fly; then done; } }`,
			'A'
		);
		run.toEnd();
		expect(run.session.status).toBe('waiting');
		const o = run.runner.outlook(run.session);
		expect(o.signals).toEqual(['Go']);
		expect(o.canStep).toBe(false);
		expect(run.move({ signal: 'Stop' }).session.messages).toEqual([
			'Nothing waits for `Stop` now.'
		]);
		run.move({ signal: 'Go' }).toEnd();
		expect(run.ended).toEqual(['accept#1', 'fly']);
		expect(run.session.trace[1]!.cause).toBe('Go sent');
		expect(run.session.status).toBe('completed');
	});

	it('a signal sent to the action itself is taken by its `accept`, with its values', () => {
		// SendAction to self; AcceptAction gives the payload (`r.v`).
		const run = new Run(
			`package S { private import ScalarValues::*; item def Reading { attribute v : Integer default 1; }
                action def A { attribute last : Integer = 0;
                    first start;
                    then send new Reading(7) to self;
                    then wait;
                    action wait accept r : Reading;
                    then assign last := wait.r.v;
                } }`,
			'A'
		);
		run.toEnd();
		expect(run.value('last')).toBe(7);
		expect(run.session.status).toBe('completed');
	});

	it('`accept after` waits for its time: a Step lets the time pass', () => {
		// 7.17 accept with a relative time trigger (`TriggerAfter`).
		const run = new Run(
			`action def T { first start; then accept after 5 [SI::s]; then action go; then done; }`,
			'T'
		);
		const o = run.runner.outlook(run.session);
		expect(o.next).toBe(5);
		expect(o.canStep).toBe(true);
		run.move();
		expect(run.session.state.time).toBe(5);
		expect(run.session.trace[1]!.cause).toBe('Step: time passed to 5 s');
		run.toEnd();
		expect(run.ended).toEqual(['accept#1', 'go']);
	});

	it('a `send` to another part is said to go outside the run, before it starts', () => {
		const run = new Run(
			`package S { item def Ping; part drone;
                action def A { first start; then send new Ping() to drone; then done; } }`,
			'A'
		);
		expect(run.runner.unsupported()).toEqual([
			'A: `send new Ping() to drone` goes to drone, outside this action: the run shows it sent, and nothing here receives it'
		]);
		run.toEnd();
		expect(run.session.trace[1]!.events.find((e) => e.what === 'ended')!.text).toBe(
			'send new Ping() to drone (sent to drone, outside this action)'
		);
	});
});

describe('values', () => {
	it('an item flow carries the value of one action’s parameter to another’s', () => {
		// FlowUsage: from `a.v` to `b.w`, when `a` ends.
		const run = new Run(
			`action def F {
                first start;
                then a;
                action a { out attribute v : Integer default 5; }
                then b;
                action b { in attribute w : Integer; }
                then done;
                flow from a.v to b.w;
            }`,
			'F'
		).toEnd();
		expect(run.value('b.w')).toBe(5);
	});

	it('two steps no succession orders that set the same value: written order, with a note', () => {
		// 7.17: unordered steps may happen in any order; the simulator takes the written order and says so.
		const run = new Run(
			`action def C { attribute x : Integer = 0;
                first start; then fork; then a; then b;
                action a { assign x := 1; }
                action b { assign x := 2; } }`,
			'C'
		).toEnd();
		expect(run.value('x')).toBe(2);
		expect(run.notes).toEqual([
			'`assign x := 1` and `assign x := 2` set `x` in the same step; no succession orders them, so SysML leaves the order open: the simulator ran them in the order written, leaving 2'
		]);
	});
});

describe('the delivery flight', () => {
	it('runs end to end: fork, join, the drop-zone decision and the merge', async () => {
		const { demoFiles } = await import('#lib/engine/toolkit/testing.ts');
		const flows = host.actionFlows(demoFiles());
		const flow = flows.find((f) => f.name === 'DeliveryFlight')!;
		const runner = new FlowRunner(flow, flows);
		let session = runner.start();
		for (let i = 0; i < 20 && session.status === 'running'; i++)
			session = runner.move(session, { step: true });
		const ended = session.trace.slice(1).map((s) =>
			s.events
				.filter((e) => e.what === 'ended')
				.map((e) => e.node)
				.join(' ')
		);
		expect(ended).toEqual([
			'takeOff',
			'flyToDropPoint',
			'descend checkDropZone',
			'releaseParcel',
			'returnHome',
			'land'
		]);
		expect(session.status).toBe('completed');
		expect(runner.unsupported()).toEqual([]);
		// With the drop zone not clear, the drone keeps the parcel.
		let kept = runner.start();
		for (let i = 0; i < 20 && kept.status === 'running'; i++)
			kept = runner.move(kept, { step: true }, i === 2 ? { 'checkDropZone.isClear': false } : {});
		expect(
			kept.trace.flatMap((s) => s.events.filter((e) => e.what === 'ended').map((e) => e.node))
		).toContain('keepParcel');
	});

	it('the delivery use case performs the flight, which runs its own steps', async () => {
		const { demoFiles } = await import('#lib/engine/toolkit/testing.ts');
		const flows = host.actionFlows(demoFiles());
		const runner = new FlowRunner(
			flows.find((f) => f.name === 'DeliverParcel')!,
			flows
		);
		let session = runner.start();
		for (let i = 0; i < 30 && session.status === 'running'; i++)
			session = runner.move(session, { step: true });
		const ended = session.trace.flatMap((s) =>
			s.events.filter((e) => e.what === 'ended').map((e) => e.node)
		);
		expect(ended).toEqual([
			'prepareFlight',
			'perform#1.takeOff',
			'perform#1.flyToDropPoint',
			'perform#1.descend',
			'perform#1.checkDropZone',
			'perform#1.releaseParcel',
			'perform#1.returnHome',
			'perform#1.land',
			'perform#1'
		]);
		expect(session.status).toBe('completed');
	});
});

// ---------------------------------------------------------------- a state machine's actions

function machineOf(text: string, name: string): StateMachine {
	const found = host.stateMachines([{ path: 'model.sysml', text }]).find((m) => m.name === name);
	if (!found) throw new Error(`no machine ${name}`);
	return found;
}

describe("a state machine's actions", () => {
	it('an entry action with a loop runs it', () => {
		// WhileLoopAction, as in an action flow; the whole action runs within the step that enters the state.
		const m = machineOf(
			`state def M { attribute n : Integer = 0; entry; then a;
                state a { entry action { while n < 3 { assign n := n + 1; } } } }`,
			'M'
		);
		expect(m.warnings ?? []).toEqual([]);
		expect(start(m).variables.n).toBe(3);
	});

	it('successions between named actions order them, whatever order they are written in', () => {
		// 7.17: `first a then b` orders a before b; without it they would be unordered.
		const m = machineOf(
			`state def M { attribute log : String = ""; entry; then s;
                state s { entry action {
                    action second { assign log := log + "b"; }
                    action first_ { assign log := log + "a"; }
                    first first_ then second;
                } } }`,
			'M'
		);
		expect(start(m).variables.log).toBe('ab');
	});

	it('a `perform` in an entry action runs the action it names, with its parameters', () => {
		const m = machineOf(
			`package P {
                action def Charge { in attribute current : Real; in attribute amount : Real; out attribute result : Real;
                    first start; then assign result := current + amount; }
                state def M { attribute level : Real = 0.5; entry; then s;
                    state s { entry action {
                        perform action c : Charge { in current = level; in amount = 0.25; }
                        then assign level := c.result;
                    } } }
            }`,
			'M'
		);
		expect(m.warnings ?? []).toEqual([]);
		expect(m.actions?.Charge).toBeDefined();
		expect(start(m).variables.level).toBe(0.75);
	});

	it('an `accept` in an action does not wait within a step: the rest is not run, and the machine says so', () => {
		const m = machineOf(
			`package P { item def Go;
                state def M { attribute n : Integer = 0; entry; then s;
                    state s { entry action { assign n := 1; then accept Go; then assign n := 2; } } } }`,
			'M'
		);
		expect(m.warnings).toEqual(['entry action of `s`: `accept Go` is not run']);
		const session = start(m);
		expect(session.variables.n).toBe(1);
		expect(session.messages).toEqual([
			'the entry action of `s`: `accept Go` waits for a signal; the action runs within one step of the machine, so it does not wait, and the steps after it were not run'
		]);
	});

	it('an effect with a loop and a send to the machine runs both', () => {
		const m = machineOf(
			`package P { item def Go; item def Done;
                state def M { attribute n : Integer = 0; entry; then a; state a; state b; state c;
                    transition first a accept Go do action { for i in 1..3 { assign n := n + i; } then send new Done() to self; } then b;
                    transition first b accept Done then c; } }`,
			'M'
		);
		let s = start(m);
		s = plain(step(m, plain(s), { event: 'Go' }));
		expect(s.variables.n).toBe(6);
		expect(s.queue?.map((q) => q.signal)).toEqual(['Done']);
		s = plain(step(m, s, { event: null }));
		expect(s.current).toEqual(['c']);
	});
});
