/**
 * Step-by-step emulation of a state machine, as pure functions over the
 * `StateMachine` structure (whoever extracted it) and a JSON-friendly
 * `StateSession`:
 *
 * - `start` enters the machine at time 0: the initial transition of each
 *   region, outermost first (of conditional ones, the first whose guard
 *   holds), running entry actions and starting `do` actions.
 * - `step` takes one run-to-completion step: on an event (a signal, or a
 *   change trigger by its `when …` text), on no event (a Step: what is ready
 *   now, else a signal the machine sent itself, else time passes to the next
 *   timer), on one chosen transition, or waits (`wait`: time passes by an
 *   amount, or to the next timer, firing what comes due on the way).
 * - `withVariables` re-evaluates what is enabled after variables change,
 *   without stepping.
 *
 * Firing follows the SysML v2 / UML state machine semantics: the guards
 * and conditions of one step are evaluated before any transition fires;
 * transitions from inner states take priority over ones from their
 * ancestors; of the enabled transitions, a maximal set that exit disjoint
 * states fires, so orthogonal regions each take their own step. Firing a
 * transition stops the `do` actions still running in the states it leaves
 * and runs their exit actions (innermost first), runs its effect, then
 * enters the target and its default substates (running entry actions, then
 * starting `do` actions). Actions and effects run their steps in the order
 * written (`actions.ts`): assignments, `if`, successions and signals sent
 * to the machine itself, which wait in a queue and are taken one per Step,
 * in the order sent. A transition to a `terminate` action ends the machine.
 *
 * Time is simulated: the session keeps the time and when each active state
 * was entered. A time trigger is the library's `TriggerAfter` / `TriggerAt`
 * (KerML 9.2.14): its duration or time is evaluated when its source state is
 * entered (after the entry actions), so `after d` is due `d` after the entry
 * (re-entering starts it again) and `at t` at time `t` (one already past
 * never comes). Time passes only when nothing is ready at the current time:
 * completion transitions, change triggers whose condition holds and timers
 * that are due all come first, so a condition an assignment makes true is
 * taken before the next timer. A time or change signal that comes while its
 * transition's guard is false is lost (`Observation::ObserveChange` sends a
 * change signal once, when the condition turns true): a timer until its
 * state is entered again, a change trigger until its condition turns false
 * and true again.
 * Durations are numbers with time units (`5 [s]`, `2 [SI::min]`); a bare
 * number counts seconds. One that cannot be evaluated is noted in the trace
 * and does not fire; values given to variables later (in the Variables
 * panel) evaluate it again, counting from then.
 * `docs/simulator.md` says more, with the parts of the specifications used.
 *
 * A `do` action starts after its state's entry action and runs while the
 * state is active (SysML v2 7.18.1). One with steps the simulator runs runs
 * them once and completes; any other (a named action, a `send` elsewhere)
 * keeps running until the state is exited, which stops it (7.18.3, step 1).
 * As in the `StatePerformances` library, a transition without a trigger
 * waits for the state's substates to finish, not for its `do` action
 * (`nonDoMiddle`).
 *
 * Action, trigger and guard texts are read as the extraction writes them
 * (`engine/toolkit/machines.ts`): a trigger is a signal name, `when <condition>`, or `after …` /
 * `at …`; an action is its statements as written.
 */
import type { SimStep, StateMachine, StateSession } from '#lib/engine/types.ts';
import {
	allSteps,
	parseAction,
	runsSomething,
	sendsToSelf,
	type ActionStep
} from './actions.ts';
import {
	EnumLiteral,
	EvalError,
	Quantity,
	display,
	evaluate,
	evaluateCondition,
	parseExpr,
	type Expr,
	type Scope,
	type Value
} from './expr.ts';
import { convert, formatDuration } from './units.ts';

export type Enabled = StateSession['enabled'][number];
type MachineState = StateMachine['states'][number];
type MachineTransition = StateMachine['transitions'][number];
type Queued = NonNullable<StateSession['queue']>[number];
type Sent = NonNullable<StateSession['sent']>[number];

/** A value as sessions hold it (JSON). `null` unsets a variable. */
export type Variables = Record<string, unknown>;

/** What a step does. */
export type Choice =
	/**
	 * Send an event; `null` is a Step: the completion, guard-only, change and
	 * due time transitions ready now, else the oldest signal the machine sent
	 * itself, else time passes to the next timer. `payload` gives the
	 * signal's values (by attribute name) over the defaults its definition gives.
	 */
	| { event: string | null; payload?: Variables; variables?: Variables }
	/** Fire this transition (an index into `machine.transitions`), if it is ready. */
	| { transition: number; variables?: Variables }
	/** Let time pass, by this many seconds or to the next timer, taking what comes due on the way. */
	| { wait: number | 'next'; variables?: Variables };

export interface Options {
	/** Stop with status `max steps reached` once this many transitions have fired. */
	maxSteps?: number;
	/**
	 * Signals sent to anything but the machine itself (`send … via p`, `send
	 * … to other`) go out in `session.sent`, for the parts around the
	 * machine to deliver (`system.ts`); without it they are not sent.
	 */
	outward?: boolean;
}

/** A wait stops after this many steps, in case the machine never lets time pass. */
export const WAIT_STEPS = 200;

// ---------------------------------------------------------------- the machine, compiled

type Trigger =
	| { kind: 'signal'; name: string }
	| { kind: 'change'; text: string; expr: Expr | null }
	| { kind: 'time'; text: string; mode: 'after' | 'at'; expr: Expr | null };

interface Transition {
	index: number;
	source: MachineTransition;
	label: string;
	trigger: Trigger | null;
	guard: Expr | null;
	effect: ActionStep[];
	/** The name the accepted signal is given (`accept r : Reading`). */
	payload: string | null;
}

interface Chart {
	machine: StateMachine;
	states: Map<string, MachineState>;
	/** Document order of each state. */
	order: Map<string, number>;
	children: Map<string | undefined, MachineState[]>;
	transitions: Transition[];
	variables: Set<string>;
	/** The unit of each variable whose default has one; its values are in that unit. */
	units: Map<string, string>;
	actions: Map<string, ActionStep[]>;
	exprs: Map<string, Expr | null>;
	/** Names a `send` may use for the machine itself, besides `self` (its part). */
	own: string[];
}

const charts = new WeakMap<StateMachine, Chart>();

function parseOrNull(text: string): Expr | null {
	try {
		return parseExpr(text);
	} catch {
		return null;
	}
}

function exprOf(chart: Chart, text: string): Expr | null {
	if (!chart.exprs.has(text)) chart.exprs.set(text, parseOrNull(text));
	return chart.exprs.get(text)!;
}

function parseTrigger(text: string | undefined): Trigger | null {
	const trimmed = text?.trim();
	if (!trimmed) return null;
	const when = /^when\s+([\s\S]+)$/.exec(trimmed);
	if (when) return { kind: 'change', text: when[1]!.trim(), expr: parseOrNull(when[1]!) };
	const time = /^(after|at)\b\s*([\s\S]*)$/.exec(trimmed);
	if (time) {
		const mode = time[1] as 'after' | 'at';
		return { kind: 'time', text: trimmed, mode, expr: parseOrNull(time[2]!) };
	}
	return { kind: 'signal', name: trimmed };
}

function actionOf(chart: Chart, text: string): ActionStep[] {
	let found = chart.actions.get(text);
	if (!found) {
		found = parseAction(text);
		chart.actions.set(text, found);
	}
	return found;
}

function compile(machine: StateMachine): Chart {
	const cached = charts.get(machine);
	if (cached) return cached;
	const states = new Map(machine.states.map((s) => [s.name, s]));
	const order = new Map(machine.states.map((s, i) => [s.name, i]));
	const children = new Map<string | undefined, MachineState[]>();
	for (const s of machine.states) {
		const list = children.get(s.parent) ?? [];
		list.push(s);
		children.set(s.parent, list);
	}
	const actions = new Map<string, ActionStep[]>();
	const transitions = machine.transitions.map((t, index) => ({
		index,
		source: t,
		label: t.name ?? `${t.from} -> ${t.to}`,
		trigger: parseTrigger(t.trigger),
		guard: t.guard ? parseOrNull(t.guard) : null,
		effect: t.effect ? parseAction(t.effect) : [],
		payload: t.payload ?? null
	}));
	const chart: Chart = {
		machine,
		states,
		order,
		children,
		transitions,
		variables: new Set(machine.variables.map((v) => v.name)),
		units: new Map(),
		actions,
		exprs: new Map(),
		own: machine.owner ? [machine.owner] : []
	};
	// Variables whose default carries a unit keep their values in it.
	const scope: Scope = { get: () => undefined };
	for (const v of machine.variables) {
		if (typeof v.value !== 'string') continue;
		const expr = parseOrNull(v.value);
		if (expr?.kind !== 'unit') continue;
		try {
			const value = evaluate(expr, scope);
			if (value instanceof Quantity) chart.units.set(v.name, value.unit);
		} catch {
			// A default that reads other variables: its unit is still the one written.
			chart.units.set(v.name, expr.unit);
		}
	}
	charts.set(machine, chart);
	return chart;
}

const childrenOf = (chart: Chart, parent: string | undefined) => chart.children.get(parent) ?? [];
const isComposite = (chart: Chart, name: string) => childrenOf(chart, name).length > 0;
const kindOf = (chart: Chart, name: string) => chart.states.get(name)?.kind;
const labelOf = (chart: Chart, name: string) => chart.states.get(name)?.label ?? name;

/** `name` and its ancestors, innermost first. */
function ancestry(chart: Chart, name: string): string[] {
	const out = [name];
	for (
		let p = chart.states.get(name)?.parent;
		p && !out.includes(p);
		p = chart.states.get(p)?.parent
	) {
		out.push(p);
	}
	return out;
}

const depth = (chart: Chart, name: string) => ancestry(chart, name).length - 1;

// ---------------------------------------------------------------- variables

/**
 * The clock a condition may read (`localClock.currentTime`,
 * `universalClock.currentTime`, `Time::universalClock.currentTime`): the
 * simulated time, the default clock's (`Occurrence::localClock` defaults to
 * the `universalClock`).
 */
const CLOCK = /^(?:self\.)?(?:localClock|(?:(?:Time|Clocks)::)?universalClock)\.currentTime$/;

/** The emulator's variables: values may carry units and enum literals while a step runs. */
class Env implements Scope {
	readonly values = new Map<string, Value>();
	/** The simulated time conditions read through the clock. */
	clock: { time: number } | null = null;
	constructor(private readonly chart: Chart) {}

	get(name: string): Value | undefined {
		const value = this.values.get(name);
		if (value === undefined && this.clock && CLOCK.test(name))
			return new Quantity(this.clock.time, 's');
		return value;
	}
	isVariable(name: string): boolean {
		return this.chart.variables.has(name) || this.values.has(name);
	}
	/** Bind a value; a variable with a unit keeps its value in that unit. */
	bind(name: string, value: Value) {
		const unit = this.chart.units.get(name);
		if (unit && typeof value === 'number') value = new Quantity(value, unit);
		else if (unit && value instanceof Quantity && value.unit !== unit) {
			try {
				value = new Quantity(convert(value.value, value.unit, unit), unit);
			} catch {
				// Not convertible: keep the value as it came.
			}
		}
		this.values.set(name, value);
	}
	/** Apply `{ name: value }`; `null` unbinds. */
	apply(variables: Variables | null | undefined) {
		for (const [name, json] of Object.entries(variables ?? {})) {
			const value = fromJson(json);
			if (value === null) this.values.delete(name);
			else this.bind(name, value);
		}
	}
	clone(): Env {
		const copy = new Env(this.chart);
		for (const [k, v] of this.values) copy.values.set(k, v);
		copy.clock = this.clock;
		return copy;
	}
}

function fromJson(json: unknown): Value {
	if (json === null || json === undefined) return null;
	if (typeof json === 'boolean' || typeof json === 'string') return json;
	if (typeof json === 'number') return json;
	throw new Error(`unsupported variable value ${JSON.stringify(json)}`);
}

function toJson(value: Value): unknown {
	if (value instanceof Quantity) return toJson(value.value);
	if (value instanceof EnumLiteral) return value.name;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return value;
}

/**
 * The variables a machine starts with: each default (in declaration order,
 * so defaults may read earlier variables) unless overridden, then the
 * overrides. Defaults that cannot be evaluated stay unset.
 */
function seed(chart: Chart, overrides: Variables): Env {
	const given = new Env(chart);
	for (const [name, json] of Object.entries(overrides)) {
		const value = fromJson(json);
		if (value !== null) given.bind(name, value);
	}
	const env = new Env(chart);
	for (const v of chart.machine.variables) {
		const override = given.get(v.name);
		if (override !== undefined) {
			env.bind(v.name, override);
			continue;
		}
		if (typeof v.value !== 'string' || !v.value.trim()) continue;
		const expr = parseOrNull(v.value);
		if (!expr) continue;
		try {
			env.bind(v.name, evaluate(expr, env));
		} catch {
			// Unset until the user gives it a value.
		}
	}
	for (const [name, value] of given.values) env.bind(name, value);
	return env;
}

// ---------------------------------------------------------------- signals and their values

/** A signal with its values, as a transition accepts it. */
interface Payload {
	signal: string;
	values: Map<string, Value>;
}

/**
 * Whether `event` names this signal: exactly, or one is the other with fewer
 * qualifying segments (`ArmCommand`, `DroneInterfaces::ArmCommand`). Two
 * names that differ in a qualifier (`A::Go`, `B::Go`) are different signals.
 */
function signalMatches(signal: string, event: string): boolean {
	return signal === event || signal.endsWith(`::${event}`) || event.endsWith(`::${signal}`);
}

/** The attributes the model gives a signal (by its name as written anywhere in the machine). */
function signalAttributes(chart: Chart, signal: string) {
	const all = chart.machine.signals ?? {};
	const key = signal in all ? signal : Object.keys(all).find((k) => signalMatches(k, signal));
	return key ? all[key]! : [];
}

/**
 * A signal's values: the arguments it was sent with (in the order of its
 * attributes, or by name: `Reading(v = 5)`), then `given` ones, else the
 * defaults its definition gives.
 */
function payloadOf(
	chart: Chart,
	signal: string,
	scope: Scope,
	args: { name?: string; value: Value }[] = [],
	given: Variables | null = null
): Payload {
	const attributes = signalAttributes(chart, signal);
	const values = new Map<string, Value>();
	for (const a of attributes) {
		if (typeof a.value !== 'string' || !a.value.trim()) continue;
		const expr = exprOf(chart, a.value);
		if (!expr) continue;
		try {
			values.set(a.name, evaluate(expr, scope));
		} catch {
			// No default value.
		}
	}
	args.forEach((arg, i) => {
		const name = arg.name ?? attributes[i]?.name;
		if (name) values.set(name, arg.value);
	});
	for (const [name, json] of Object.entries(given ?? {})) {
		const value = fromJson(json);
		if (value === null) values.delete(name);
		else values.set(name, value);
	}
	return { signal, values };
}

/** The variables, with the accepted signal's values readable by the name it is given (`r.v`). */
function withPayload(env: Scope, name: string | null, payload: Payload | null): Scope {
	if (!name || !payload) return env;
	return {
		get(n) {
			if (!n.startsWith(`${name}.`)) return env.get(n);
			const attribute = n.slice(name.length + 1);
			const value = payload.values.get(attribute);
			if (value === undefined || value === null)
				throw new EvalError(`\`${payload.signal}\` carries no value for \`${attribute}\``);
			return value;
		},
		isVariable: (n) => env.isVariable?.(n) ?? false
	};
}

// ---------------------------------------------------------------- running actions

interface Doing {
	/** Variables the actions set. */
	writes: Set<string>;
}

/**
 * Run the steps of an action in order: assignments, `if`, and signals sent
 * to the machine itself (queued). `where` says whose action it is, for the
 * queue and for messages.
 */
function runSteps(run: Run, steps: ActionStep[], scope: Scope, where: string, doing: Doing) {
	const { chart } = run;
	for (const step of steps) {
		if (step.kind === 'assign') {
			const target = step.target.replace(/^self\./, '');
			const expr = exprOf(chart, step.value);
			if (!expr) {
				run.messages.push(
					`assign ${step.target}: \`${step.value}\` is not supported by the evaluator`
				);
				continue;
			}
			try {
				run.env.bind(target, evaluate(expr, scope));
				doing.writes.add(target);
			} catch (error) {
				run.messages.push(`assign ${step.target}: ${(error as Error).message}`);
			}
		} else if (step.kind === 'if') {
			let branch: ActionStep[] | null = step.otherwise;
			for (const b of step.branches) {
				const expr = exprOf(chart, b.condition);
				let holds: boolean;
				try {
					if (!expr) throw new EvalError('the condition is not supported by the evaluator');
					holds = evaluateCondition(expr, scope);
				} catch (error) {
					run.messages.push(
						`${where}: \`if ${b.condition}\` was not run: ${(error as Error).message}`
					);
					branch = null;
					break;
				}
				if (holds) {
					branch = b.steps;
					break;
				}
			}
			if (branch) runSteps(run, branch, scope, where, doing);
		} else if (step.kind === 'send' && (run.outward || sendsToSelf(step, chart.own))) {
			const args: { name?: string; value: Value }[] = [];
			try {
				for (const text of step.args) {
					const named = /^([\w$]+)\s*=(?!=)\s*([\s\S]+)$/.exec(text);
					const expr = exprOf(chart, named ? named[2]! : text);
					if (!expr) throw new EvalError(`\`${text}\` is not supported by the evaluator`);
					args.push({ ...(named ? { name: named[1]! } : {}), value: evaluate(expr, scope) });
				}
			} catch (error) {
				run.messages.push(`${where}: \`${step.text}\` was not sent: ${(error as Error).message}`);
				continue;
			}
			const payload = payloadOf(chart, step.signal, scope, args);
			const values = payload.values.size
				? Object.fromEntries([...payload.values].map(([k, v]) => [k, toJson(v)] as const))
				: null;
			if (sendsToSelf(step, chart.own)) {
				run.queue.push({ signal: step.signal, from: where, ...(values ? { values } : {}) });
			} else {
				// Out of the machine: its part's connections take it on (`system.ts`).
				const sent: Sent = { signal: step.signal, from: where };
				if (values) sent.values = values;
				if (step.via) sent.via = step.via.replace(/^self\./, '');
				if (step.to) sent.to = step.to.replace(/^self\./, '');
				run.sent.push(sent);
			}
		}
		// Named actions change nothing the simulator keeps; other steps are noted on the machine.
	}
}

function runAction(run: Run, text: string, scope: Scope, where: string, doing: Doing) {
	runSteps(run, actionOf(run.chart, text), scope, where, doing);
}

// ---------------------------------------------------------------- the active configuration

/** The active states: the leaves in `current` and their ancestors. */
function activeSet(chart: Chart, current: string[]): Set<string> {
	return new Set(current.flatMap((s) => ancestry(chart, s)));
}

/** Active states with no active substate, in document order. */
function leaves(chart: Chart, active: Set<string>): string[] {
	return chart.machine.states
		.filter((s) => active.has(s.name))
		.filter((s) => !childrenOf(chart, s.name).some((c) => active.has(c.name)))
		.map((s) => s.name);
}

/** Whether a region (the machine, or a composite state) has finished. */
function finished(chart: Chart, region: string | undefined, active: Set<string>): boolean {
	const parallel =
		region === undefined ? chart.machine.parallel : chart.states.get(region)?.parallel;
	const inside = childrenOf(chart, region);
	if (parallel) {
		const regions = inside.filter((s) => s.kind === 'state');
		return regions.length > 0 && regions.every((r) => finished(chart, r.name, active));
	}
	return inside.some((s) => s.kind === 'final' && active.has(s.name));
}

/** Transitions whose source is active, deeper sources first, then in document order. */
function candidates(chart: Chart, active: Set<string>): Transition[] {
	return chart.transitions
		.filter((t) => active.has(t.source.from) && kindOf(chart, t.source.from) !== 'initial')
		.map((t) => ({ t, d: depth(chart, t.source.from) }))
		.sort((a, b) => b.d - a.d || a.t.index - b.t.index)
		.map(({ t }) => t);
}

function status(run: Run, options: Options): StateSession['status'] {
	if (run.terminated || finished(run.chart, undefined, run.active)) return 'completed';
	if (options.maxSteps !== undefined && run.step >= options.maxSteps) return 'max steps reached';
	return candidates(run.chart, run.active).length || run.queue.length ? 'running' : 'deadlocked';
}

// ---------------------------------------------------------------- the clock

/** Simulated time, and the time triggers of the active states. */
interface Clock {
	/** Seconds since the start. */
	time: number;
	/** When each active state was entered. */
	entered: Map<string, number>;
	/** By transition index: when its time trigger is due, or why it will not fire. */
	timers: Map<number, number | string>;
}

type TimeTrigger = Extract<Trigger, { kind: 'time' }>;

/** A time or a duration in seconds: a number with a time unit, or a bare number (seconds). */
function seconds(value: Value): number {
	let out: number | null = null;
	if (value instanceof Quantity) {
		try {
			out = convert(value.value, value.unit, 's');
		} catch {
			// Not a time unit.
		}
	} else if (typeof value === 'number') out = value;
	if (out === null || !Number.isFinite(out)) throw new EvalError(`${display(value)} is not a time`);
	return out;
}

/** Why a time trigger cannot fire because its time could not be evaluated. */
const unevaluated = (text: string, why: string) => `time \`${text}\`: ${why}`;
const isUnevaluated = (reason: number | string | undefined) =>
	typeof reason === 'string' && reason.startsWith('time `');

/**
 * When a time trigger is due, evaluated as its source state is entered at
 * `base` (TriggerAfter adds the delay to the time it is evaluated at), or
 * why it will not come.
 */
function arm(t: Transition, base: number, env: Env): number | string {
	const trigger = t.trigger as TimeTrigger;
	if (!trigger.expr) return unevaluated(trigger.text, 'the time is not supported by the evaluator');
	let value: number;
	try {
		value = seconds(evaluate(trigger.expr, env));
	} catch (error) {
		return unevaluated(trigger.text, (error as Error).message);
	}
	if (trigger.mode === 'after') return base + Math.max(0, value);
	return value < base
		? `\`${trigger.text}\` had passed when \`${t.source.from}\` was entered, at ${formatDuration(base)}`
		: value;
}

/** Start the time triggers of the states just entered; what will not fire is noted. */
function armStates(run: Run, states: string[], notes: string[]) {
	const entered = new Set(states);
	for (const t of run.chart.transitions) {
		if (t.trigger?.kind !== 'time' || !entered.has(t.source.from)) continue;
		const due = arm(t, run.clock.entered.get(t.source.from) ?? run.clock.time, run.env);
		run.clock.timers.set(t.index, due);
		if (typeof due === 'string') notes.push(`\`${t.label}\` will not fire: ${due}`);
	}
}

/** The earliest timer of the active states still to come. */
function nextDue(clock: Clock): number | undefined {
	let next: number | undefined;
	for (const due of clock.timers.values()) {
		if (typeof due === 'number' && due > clock.time && (next === undefined || due < next))
			next = due;
	}
	return next;
}

/** Whether an expression reads the clock. */
const readsClock = (expr: Expr | null) => !!expr && [...namesIn(expr)].some((n) => CLOCK.test(n));

/**
 * The times at which a condition on the clock may change: the other side of
 * each comparison with the clock (`localClock.currentTime >= start + 30 [s]`
 * changes at `start + 30 [s]`), in seconds.
 */
function clockEdges(expr: Expr, env: Env, out: number[] = []): number[] {
	if (expr.kind === 'binary') {
		if (['<', '>', '<=', '>=', '==', '!='].includes(expr.op)) {
			const left = readsClock(expr.left);
			const right = readsClock(expr.right);
			const other = left && !right ? expr.right : right && !left ? expr.left : null;
			const clock = left && !right ? expr.left : right && !left ? expr.right : null;
			if (other && clock?.kind === 'name') {
				try {
					out.push(seconds(evaluate(other, env)));
				} catch {
					// Not a time: the condition is read at each step only.
				}
			}
		}
		clockEdges(expr.left, env, out);
		clockEdges(expr.right, env, out);
	} else if (expr.kind === 'unary') clockEdges(expr.operand, env, out);
	else if (expr.kind === 'if') {
		clockEdges(expr.condition, env, out);
		clockEdges(expr.then, env, out);
		clockEdges(expr.else, env, out);
	}
	return out;
}

/** A strict comparison with the clock (`> 30 [s]`) first holds just after its time: this much after. */
const JUST_AFTER = 0.001;

/**
 * When a change trigger whose condition reads the clock turns true as time
 * passes, with the variables as they are now: the first time after now at
 * which it holds (just after, for a strict comparison). Undefined when it
 * holds now, never will, or does not read the clock.
 */
function clockDue(run: Run, t: Transition): number | undefined {
	const trigger = t.trigger;
	if (trigger?.kind !== 'change' || !trigger.expr || !readsClock(trigger.expr)) return undefined;
	const expr = trigger.expr;
	const now = run.clock.time;
	const at = (time: number) => {
		const probe = run.env.clone();
		probe.clock = { time };
		try {
			return evaluateCondition(expr, probe);
		} catch {
			return false;
		}
	};
	if (at(now)) return undefined;
	const edges = [...new Set(clockEdges(expr, run.env))].sort((a, b) => a - b);
	for (const edge of edges) {
		if (edge > now && at(edge)) return edge;
		if (edge + JUST_AFTER > now && at(edge + JUST_AFTER)) return edge + JUST_AFTER;
	}
	return undefined;
}

/** The next time something comes due: a timer, or a condition on the clock turning true. */
function nextAt(run: Run): number | undefined {
	let next = nextDue(run.clock);
	for (const t of candidates(run.chart, run.active)) {
		const due = clockDue(run, t);
		if (due !== undefined && due > run.clock.time && (next === undefined || due < next)) next = due;
	}
	return next;
}

/** Move the clock to `time`: the timers and conditions that come due then are taken, or lost. */
function setTime(run: Run, time: number) {
	run.clock.time = time;
	expire(run, candidates(run.chart, run.active), run.env);
	observe(run);
}

/**
 * A time signal that comes while its transition cannot take it (its guard
 * is false) is lost: the timer will not fire again until its state is
 * entered again.
 */
function expire(run: Run, list: Transition[], env: Env) {
	const { clock } = run;
	for (const t of list) {
		if (t.trigger?.kind !== 'time') continue;
		const due = clock.timers.get(t.index);
		if (typeof due !== 'number' || due > clock.time) continue;
		const c = check(run, t, env);
		if (!c.ready && c.reason) {
			clock.timers.set(
				t.index,
				`\`${t.trigger.text}\` came at ${formatDuration(due)} while ${c.reason}`
			);
		}
	}
}

/**
 * Watch the change triggers of the active states (`Observation`): a change
 * signal comes when the condition turns true, or at once if it is true when
 * first evaluated, and only once. One that comes, or waits, while its
 * transition's guard is false is lost; the condition must turn false and
 * true again for another.
 */
function observe(run: Run) {
	for (const t of candidates(run.chart, run.active)) {
		if (t.trigger?.kind !== 'change') continue;
		let holds = false;
		try {
			holds = !!t.trigger.expr && evaluateCondition(t.trigger.expr, run.env);
		} catch {
			// Cannot be read: no signal; the transition shows why.
		}
		const was = run.changes.get(t.index);
		if (!holds) {
			run.changes.set(t.index, false);
			continue;
		}
		if (typeof was === 'string') continue;
		const guard = guardOf(run, t, run.env, null);
		if (guard.reason === undefined) run.changes.set(t.index, true);
		else {
			run.changes.set(
				t.index,
				`\`when ${t.trigger.text}\` came at ${formatDuration(run.clock.time)} while ${guard.reason}`
			);
		}
	}
}

// ---------------------------------------------------------------- readiness

interface Check {
	guardResult?: boolean;
	conditionResult?: boolean;
	due?: number;
	ready: boolean;
	reason?: string;
	/** The values the guard and condition read. */
	reads?: Record<string, unknown>;
}

/** The names an expression reads. */
function namesIn(expr: Expr, out: Set<string> = new Set()): Set<string> {
	switch (expr.kind) {
		case 'name':
			out.add(expr.name);
			break;
		case 'binary':
			namesIn(expr.left, out);
			namesIn(expr.right, out);
			break;
		case 'unary':
		case 'unit':
			namesIn(expr.operand, out);
			break;
		case 'call':
			for (const a of expr.args) namesIn(a, out);
			break;
		case 'if':
			namesIn(expr.condition, out);
			namesIn(expr.then, out);
			namesIn(expr.else, out);
			break;
	}
	return out;
}

/** What the expressions read, with their values (those that have one). */
function readsOf(exprs: (Expr | null)[], scope: Scope): Record<string, unknown> | undefined {
	const names = new Set<string>();
	for (const e of exprs) if (e) namesIn(e, names);
	const out: Record<string, unknown> = {};
	for (const name of names) {
		try {
			const value = evaluate({ kind: 'name', name }, scope);
			if (!(value instanceof EnumLiteral) || scope.isVariable?.(name)) out[name] = toJson(value);
		} catch {
			// No value: the reason says so.
		}
	}
	return Object.keys(out).length ? out : undefined;
}

/** The guard alone: its value, or why it does not hold. */
function guardOf(
	run: Run,
	t: Transition,
	env: Scope,
	payload: Payload | null
): { result?: boolean; reason?: string } {
	const guard = t.source.guard;
	if (!guard) return {};
	if (!t.guard) return { reason: `guard \`${guard}\`: guard is not supported by the evaluator` };
	try {
		const result = evaluateCondition(t.guard, withPayload(env, t.payload, payload));
		return result ? { result } : { result, reason: `guard \`${guard}\` is false` };
	} catch (error) {
		return { reason: `guard \`${guard}\`: ${(error as Error).message}` };
	}
}

/** The values a signal transition reads before its signal is sent: the defaults the model gives. */
function defaultPayload(run: Run, t: Transition, env: Scope): Payload | null {
	return t.trigger?.kind === 'signal' && t.payload
		? payloadOf(run.chart, t.trigger.name, env)
		: null;
}

function check(run: Run, t: Transition, env: Env, payload?: Payload | null): Check {
	const { chart, clock } = run;
	const out: Check = { ready: true };
	if (t.trigger?.kind === 'change') {
		const text = t.trigger.text;
		if (!t.trigger.expr)
			out.reason = `condition \`${text}\`: condition is not supported by the evaluator`;
		else {
			try {
				out.conditionResult = evaluateCondition(t.trigger.expr, env);
				const due = out.conditionResult ? undefined : clockDue(run, t);
				if (due !== undefined) {
					out.due = due;
					out.reason = `\`when ${text}\` turns true at ${formatDuration(due)}`;
				} else if (!out.conditionResult) out.reason = `condition \`${text}\` is false`;
				else {
					const signal = run.changes.get(t.index);
					if (typeof signal === 'string') out.reason = signal;
				}
			} catch (error) {
				out.reason = `condition \`${text}\`: ${(error as Error).message}`;
			}
		}
	} else if (t.trigger?.kind === 'time') {
		const due = clock.timers.get(t.index);
		if (typeof due === 'number') {
			out.due = due;
			if (due > clock.time) out.reason = `\`${t.trigger.text}\` is due at ${formatDuration(due)}`;
		} else out.reason = due ?? `\`${t.trigger.text}\` is not running`;
	}
	const accepted = payload === undefined ? defaultPayload(run, t, env) : payload;
	const guard = guardOf(run, t, env, accepted);
	if (guard.result !== undefined) out.guardResult = guard.result;
	out.reason ??= guard.reason;
	// A completion transition out of a composite state waits until every region inside has finished.
	if (!t.trigger && !out.reason && isComposite(chart, t.source.from)) {
		const unfinished = [...run.active].some(
			(s) =>
				s !== t.source.from &&
				ancestry(chart, s).includes(t.source.from) &&
				!isComposite(chart, s) &&
				kindOf(chart, s) !== 'final'
		);
		if (unfinished) out.reason = `\`${t.source.from}\` has not finished`;
	}
	const reads = readsOf(
		[t.trigger?.kind === 'change' ? t.trigger.expr : null, t.guard],
		withPayload(env, t.payload, accepted)
	);
	if (reads) out.reads = reads;
	out.ready = out.reason === undefined;
	return out;
}

/**
 * Whether a transition's trigger accepts `event` (`null`: a Step). A time
 * trigger takes no event: it fires when its time comes.
 */
function accepts(t: Transition, event: string | null): boolean {
	const trigger = t.trigger;
	if (event === null) return trigger?.kind !== 'signal';
	if (!trigger || trigger.kind === 'time') return false;
	if (trigger.kind === 'signal') return signalMatches(trigger.name, event);
	return eventName(trigger) === event;
}

/**
 * Whether a transition takes a waiting signal: it accepts the signal and,
 * if it names a port (`accept Sig via p`), the signal came in at that port
 * (`AcceptPerformance::receiver` is the port; one with no `via` receives at
 * its part, `this`, whose ports a signal comes in at).
 */
function takesQueued(t: Transition, q: Queued): boolean {
	if (!accepts(t, q.signal)) return false;
	const via = t.source.via;
	return !via || q.port === undefined || via === q.port;
}

/** Who sent a waiting signal, for messages: another part, or the machine itself. */
const senderOf = (q: Queued) => (q.part !== undefined ? (q.from ?? `\`${q.part}\``) : 'the machine');

function eventName(trigger: Trigger): string {
	return trigger.kind === 'signal'
		? trigger.name
		: trigger.kind === 'change'
			? `when ${trigger.text}`
			: trigger.text;
}

/**
 * Firing order among candidates: inner sources first, completion before
 * triggered transitions (as UML's completion events), then document
 * order. Timing already orders change and time triggers: a timer is not
 * ready before its time. Two triggered transitions from one state ready at
 * the same instant (a change trigger and a timer due then) are a tie the
 * specifications leave open; the one written first fires.
 */
function priority(chart: Chart, list: Transition[]): Transition[] {
	return [...list]
		.map((t) => ({ t, d: depth(chart, t.source.from), c: t.trigger ? 1 : 0 }))
		.sort((a, b) => b.d - a.d || a.c - b.c || a.t.index - b.t.index)
		.map(({ t }) => t);
}

/** The innermost state containing both ends (neither of them), and the branches below it. */
function branches(chart: Chart, t: Transition) {
	const sourceLine = ancestry(chart, t.source.from);
	const targetLine = ancestry(chart, t.source.to);
	const domain = sourceLine.slice(1).find((a) => targetLine.slice(1).includes(a));
	const branchOf = (line: string[]) => {
		const pos = domain === undefined ? line.length : line.indexOf(domain);
		return line[Math.max(0, (pos < 0 ? line.length : pos) - 1)]!;
	};
	return { source: branchOf(sourceLine), target: branchOf(targetLine), targetLine };
}

/** The active states a transition would exit: its source branch and everything inside. */
function exits(chart: Chart, t: Transition, active: Set<string>): string[] {
	const branch = branches(chart, t).source;
	return [...active]
		.filter((s) => ancestry(chart, s).includes(branch))
		.sort((a, b) => depth(chart, b) - depth(chart, a) || chart.order.get(a)! - chart.order.get(b)!);
}

/**
 * The transitions one step fires: in priority order, each ready one that
 * accepts the event and exits none of the states an earlier one exits.
 */
function select(chart: Chart, ready: Transition[], active: Set<string>): Transition[] {
	const taken = new Set<string>();
	const out: Transition[] = [];
	for (const t of priority(chart, ready)) {
		const leaving = exits(chart, t, active);
		if (leaving.some((s) => taken.has(s))) continue;
		for (const s of leaving) taken.add(s);
		out.push(t);
	}
	return out;
}

/** Of `ready`, the one in `chosen` that pre-empts `t` (they leave a state in common). */
function preemptedBy(
	chart: Chart,
	t: Transition,
	chosen: Transition[],
	active: Set<string>
): Transition | undefined {
	const leaving = new Set(exits(chart, t, active));
	return chosen.find((c) => exits(chart, c, active).some((s) => leaving.has(s)));
}

/** Every transition leaving an active state, inner states first, with its guard evaluated. */
function enabled(run: Run, env: Env): Enabled[] {
	const { chart, active } = run;
	const list = candidates(chart, active);
	const head = run.queue[0];
	const headPayload = head ? queuedPayload(head) : null;
	const takesHead = (t: Transition) => !!head && takesQueued(t, head);
	const checks = new Map(
		list.map((t) => [t, check(run, t, env, takesHead(t) ? headPayload : undefined)])
	);
	// A ready transition that a higher-priority one pre-empts is not ready, and says why.
	const waits = new Map<Transition, string>();
	const ready = list.filter((t) => checks.get(t)!.ready);
	/** Pre-empt the transitions of `group` that `own` picks and a chosen one conflicts with. */
	const preempt = (group: Transition[], own: (t: Transition) => boolean) => {
		const chosen = select(chart, group, active);
		for (const t of group) {
			if (chosen.includes(t) || !own(t) || waits.has(t)) continue;
			const by = preemptedBy(chart, t, chosen, active);
			if (by) waits.set(t, `\`${by.label}\` fires first`);
		}
		return chosen;
	};
	const steps = preempt(
		ready.filter((t) => accepts(t, null)),
		() => true
	);
	// What a Step would fire comes before any event (as UML's completion events): events wait.
	if (steps.length) {
		for (const t of ready) {
			if (t.trigger?.kind === 'signal') waits.set(t, `\`${steps[0]!.label}\` fires first`);
		}
	} else if (head) {
		// Then the signals the machine sent itself, in the order sent; events sent now come after.
		preempt(ready.filter(takesHead), takesHead);
		for (const t of ready) {
			if (t.trigger?.kind === 'signal' && !takesHead(t))
				waits.set(t, `\`${head.signal}\`, sent by ${senderOf(head)}, comes first`);
		}
	}
	// Each event pre-empts among the transitions that accept it.
	const names = new Set(
		ready.flatMap((t) => (t.trigger?.kind === 'signal' ? [t.trigger.name] : []))
	);
	for (const name of names) {
		preempt(
			ready.filter((t) => accepts(t, name)),
			(t) => t.trigger?.kind === 'signal' && t.trigger.name === name
		);
	}
	return list.map((t) => {
		const c = checks.get(t)!;
		const wait = waits.get(t);
		const e: Enabled = {
			transition: t.label,
			index: t.index,
			from: t.source.from,
			to: t.source.to,
			ready: c.ready && !wait
		};
		if (t.trigger) e.trigger = eventName(t.trigger);
		if (t.source.guard) e.guard = t.source.guard;
		if (c.guardResult !== undefined) e.guardResult = c.guardResult;
		if (c.conditionResult !== undefined) e.conditionResult = c.conditionResult;
		if (c.due !== undefined) e.due = c.due;
		if (takesHead(t)) e.queued = true;
		const reason = c.reason ?? wait;
		if (reason !== undefined) e.reason = reason;
		return e;
	});
}

// ---------------------------------------------------------------- entering and leaving

interface Run {
	chart: Chart;
	active: Set<string>;
	env: Env;
	clock: Clock;
	/** Active states whose `do` action is still running. */
	doing: Set<string>;
	/** Signals waiting to be taken (sent by the machine itself, or by other parts), oldest first. */
	queue: Queued[];
	/** Signals this step sent out of the machine (with `outward`). */
	sent: Sent[];
	outward: boolean;
	/** Change triggers: see `StateSession.changes`. */
	changes: Map<number, boolean | string>;
	terminated: boolean;
	messages: string[];
	trace: SimStep[];
	step: number;
}

/** What entering states did, for the trace. */
interface Entering extends Doing {
	entered: string[];
	entries: string[];
	dos: string[];
	notes: string[];
	/** The guards of the conditional initial transitions taken, with what they read. */
	initial: { guard: string; reads?: Record<string, unknown> }[];
}

const entering = (): Entering => ({
	entered: [],
	entries: [],
	dos: [],
	notes: [],
	initial: [],
	writes: new Set()
});

/**
 * Mark a state active and run its entry action, then start its `do`
 * action: one with steps the simulator runs runs them and completes, any
 * other keeps running while the state is active. Its substates are entered
 * after this (`entry then middle`).
 */
function markEntered(run: Run, name: string, e: Entering) {
	if (run.active.has(name)) return;
	run.active.add(name);
	run.clock.entered.set(name, run.clock.time);
	e.entered.push(name);
	const state = run.chart.states.get(name);
	if (!state) return;
	if (state.entry) {
		e.entries.push(state.entry);
		runAction(run, state.entry, run.env, `the entry action of \`${state.label}\``, e);
	}
	if (state.do) {
		e.dos.push(state.do);
		const steps = actionOf(run.chart, state.do);
		const sends = run.outward && allSteps(steps).some((s) => s.kind === 'send');
		if (sends || runsSomething(steps, run.chart.own))
			runSteps(run, steps, run.env, `the do action of \`${state.label}\``, e);
		else run.doing.add(name);
	}
}

/** Enter `name` and, if it is composite, its default substates (every region of a parallel one). */
function enterState(run: Run, name: string, e: Entering) {
	markEntered(run, name, e);
	const state = run.chart.states.get(name);
	if (!state) return;
	if (state.parallel) {
		for (const region of childrenOf(run.chart, name)) {
			if (region.kind === 'state') enterState(run, region.name, e);
		}
	} else if (isComposite(run.chart, name)) enterDefault(run, name, e);
}

/**
 * Enter the default state of the region inside `parent`: the target of its
 * initial transition (of conditional ones, `entry; if c then a;`, the first
 * written whose guard holds), else its first state. When no guard holds,
 * nothing is entered, and the step says so.
 */
function enterDefault(run: Run, parent: string | undefined, e: Entering) {
	const { chart } = run;
	const inside = childrenOf(chart, parent);
	const initial = inside.find((s) => s.kind === 'initial');
	const options = initial ? chart.transitions.filter((t) => t.source.from === initial.name) : [];
	let target: string | undefined;
	const reasons: string[] = [];
	for (const t of options) {
		const guard = guardOf(run, t, run.env, null);
		if (guard.reason === undefined) {
			target = t.source.to;
			if (t.source.guard) {
				const reads = readsOf([t.guard], run.env);
				e.initial.push({ guard: t.source.guard, ...(reads ? { reads } : {}) });
			}
			break;
		}
		reasons.push(guard.reason);
	}
	if (options.length && target === undefined) {
		const where = parent === undefined ? 'the machine' : `\`${labelOf(chart, parent)}\``;
		e.notes.push(
			`no initial transition of ${where} can be taken (${reasons.join('; ')}), so no state in it is entered`
		);
		return;
	}
	target ??= inside.find((s) => s.kind === 'state')?.name;
	if (target === undefined) return;
	// The initial transition may point into a nested state.
	const line = ancestry(chart, target);
	const stop = parent === undefined ? -1 : line.indexOf(parent);
	const path = (stop < 0 ? line : line.slice(0, stop)).reverse();
	path.forEach((s, i) => {
		if (i + 1 === path.length) enterState(run, s, e);
		else markEntered(run, s, e);
	});
}

/** Leave a state: stop its running `do` action, run its exit action, drop its timers. */
function leave(run: Run, name: string, stopped: string[], exited: string[], doing: Doing) {
	const { chart } = run;
	run.active.delete(name);
	const state = chart.states.get(name);
	if (run.doing.delete(name) && state?.do) stopped.push(state.do);
	if (state?.exit) {
		exited.push(state.exit);
		runAction(run, state.exit, run.env, `the exit action of \`${state.label}\``, doing);
	}
	run.clock.entered.delete(name);
	for (const t of chart.transitions) {
		if (t.source.from !== name) continue;
		run.clock.timers.delete(t.index);
		run.changes.delete(t.index);
	}
}

/** A `terminate` action ends the machine: what still runs stops, and no exit action runs. */
function terminate(run: Run, stopped: string[]) {
	for (const name of run.active) {
		const state = run.chart.states.get(name);
		if (run.doing.has(name) && state?.do) stopped.push(state.do);
	}
	run.active.clear();
	run.doing.clear();
	run.clock.entered.clear();
	run.clock.timers.clear();
	run.changes.clear();
	run.queue = [];
	run.terminated = true;
}

/** Why a transition fires, for the trace. */
interface Why {
	cause: string;
	payload: Payload | null;
	reads?: Record<string, unknown>;
	preempted: string[];
}

/** Fire a transition: exit, effect, enter. Returns the variables its actions set. */
function take(run: Run, t: Transition, why: Why): Set<string> {
	const { chart } = run;
	const { target, targetLine } = branches(chart, t);
	const exitTexts: string[] = [];
	const stopped: string[] = [];
	const e = entering();
	for (const s of exits(chart, t, run.active)) leave(run, s, stopped, exitTexts, e);

	runSteps(
		run,
		t.effect,
		withPayload(run.env, t.payload, why.payload),
		`the effect of \`${t.label}\``,
		e
	);

	if (chart.states.get(t.source.to)?.terminate) {
		terminate(run, stopped);
		e.notes.push(`\`${labelOf(chart, t.source.to)}\` terminates the machine`);
	} else {
		// Enter from the target branch down to the target, then its defaults.
		const path = targetLine.slice(0, targetLine.indexOf(target) + 1).reverse();
		path.forEach((s, i) => {
			if (i + 1 === path.length) {
				enterState(run, s, e);
				return;
			}
			markEntered(run, s, e);
			// Entering one region of a parallel state enters its sibling regions too.
			if (chart.states.get(s)?.parallel) {
				for (const region of childrenOf(chart, s)) {
					if (region.name !== path[i + 1] && region.kind === 'state')
						enterState(run, region.name, e);
				}
			}
		});
		armStates(run, e.entered, e.notes);
	}

	run.step += 1;
	const s: SimStep = {
		step: run.step,
		from_state: t.source.from,
		transition_name: t.source.name ?? null,
		trigger: t.trigger ? eventName(t.trigger) : null,
		// It fired, so its guard held.
		guard_result: t.source.guard ? true : null,
		effect: t.source.effect ?? null,
		to_state: t.source.to,
		exit_action: exitTexts.length ? exitTexts.join('; ') : null,
		entry_action: e.entries.length ? e.entries.join('; ') : null,
		time: run.clock.time,
		do_action: e.dos.length ? e.dos.join('; ') : null,
		do_stopped: stopped.length ? stopped.join('; ') : null,
		cause: why.cause
	};
	if (why.reads) s.reads = why.reads;
	if (why.preempted.length) s.preempted = why.preempted;
	if (e.notes.length) s.notes = e.notes;
	run.trace.push(s);
	return e.writes;
}

/** The sentence that says why a transition fires now. */
function causeOf(run: Run, t: Transition, event: { name: string; from?: string } | null): string {
	if (event) {
		return event.from ? `\`${event.name}\`, sent by ${event.from}` : `event \`${event.name}\``;
	}
	const trigger = t.trigger;
	if (!trigger) {
		return isComposite(run.chart, t.source.from)
			? `completion: \`${labelOf(run.chart, t.source.from)}\` has finished`
			: `completion of \`${labelOf(run.chart, t.source.from)}\``;
	}
	if (trigger.kind === 'change') return `\`when ${trigger.text}\` turned true`;
	if (trigger.kind === 'time') {
		const due = run.clock.timers.get(t.index);
		return `\`${trigger.text}\` came due at ${formatDuration(typeof due === 'number' ? due : run.clock.time)}`;
	}
	return `event \`${trigger.name}\``;
}

/**
 * Fire the transitions one step takes out of `ready` (guards read from
 * `before`), recording why each fired and what it beat; note a variable set
 * by two of them (concurrent regions run in the order written here).
 */
function fire(
	run: Run,
	ready: Transition[],
	before: Env,
	event: { name: string; from?: string; payload: Payload | null } | null = null
) {
	const { chart } = run;
	const chosen = select(chart, ready, run.active);
	const whys = chosen.map((t): Why => {
		const payload = event?.payload ?? null;
		const c = check(run, t, before, event ? payload : undefined);
		return {
			cause: causeOf(run, t, event),
			payload,
			...(c.reads ? { reads: c.reads } : {}),
			preempted: ready
				.filter((r) => !chosen.includes(r) && preemptedBy(chart, r, chosen, run.active) === t)
				.map((r) => r.label)
		};
	});
	const writers = new Map<string, string>();
	chosen.forEach((t, i) => {
		const writes = take(run, t, whys[i]!);
		const step = run.trace.at(-1)!;
		for (const name of writes) {
			const other = writers.get(name);
			if (other !== undefined && other !== t.label) {
				(step.notes ??= []).push(
					`\`${name}\` is also set by \`${other}\` in this step: the regions run at the same time, so the result depends on an order SysML leaves open (the simulator runs them in the order written)`
				);
			}
			if (other === undefined) writers.set(name, t.label);
		}
	});
	observe(run);
}

/** A queued signal with its values. */
function queuedPayload(q: Queued): Payload {
	return {
		signal: q.signal,
		values: new Map(Object.entries(q.values ?? {}).map(([k, v]) => [k, fromJson(v)] as const))
	};
}

/** Take the oldest signal the machine sent itself; one no transition accepts is discarded. */
function dispatch(run: Run, list: Transition[], before: Env) {
	const head = run.queue.shift()!;
	const payload = queuedPayload(head);
	const ready = list.filter((t) => takesQueued(t, head) && check(run, t, before, payload).ready);
	if (!ready.length) {
		const where = leaves(run.chart, run.active).join(', ');
		run.messages.push(
			`\`${head.signal}\`, sent by ${head.from ?? 'the machine'}, fires no transition from ${where}: it is dropped`
		);
		observe(run);
		return;
	}
	fire(run, ready, before, { name: head.signal, from: head.from ?? 'the machine', payload });
}

// ---------------------------------------------------------------- sessions

function session(run: Run, options: Options): StateSession {
	const { chart, clock } = run;
	const variables: Record<string, unknown> = {};
	for (const v of chart.machine.variables) variables[v.name] = null;
	for (const [name, value] of run.env.values) variables[name] = toJson(value);
	const inOrder = (names: Iterable<string>) =>
		[...names].sort((a, b) => (chart.order.get(a) ?? 0) - (chart.order.get(b) ?? 0));
	const out: StateSession = {
		machine: chart.machine.qualifiedName ?? chart.machine.name,
		current: leaves(chart, run.active),
		step: run.step,
		variables,
		trace: run.trace,
		status: status(run, options),
		time: clock.time,
		entered: Object.fromEntries(
			inOrder(clock.entered.keys()).map((s) => [s, clock.entered.get(s)!])
		),
		timers: Object.fromEntries(
			[...clock.timers].sort((a, b) => a[0] - b[0]).map(([i, due]) => [String(i), due])
		),
		doing: inOrder(run.doing),
		enabled: enabled(run, run.env)
	};
	if (run.queue.length) out.queue = run.queue;
	if (run.sent.length) out.sent = run.sent;
	const next = nextAt(run);
	if (next !== undefined) out.nextDue = next;
	if (run.changes.size) {
		out.changes = Object.fromEntries(
			[...run.changes].sort((a, b) => a[0] - b[0]).map(([i, c]) => [String(i), c])
		);
	}
	if (run.terminated) out.terminated = true;
	if (run.messages.length) out.messages = run.messages;
	return out;
}

/** Rebuild a run from a session (which may have gone through JSON) and variable changes. */
function resume(
	chart: Chart,
	from: StateSession,
	variables: Variables | null | undefined,
	options: Options = {}
): Run {
	const unknown = from.current.find((s) => !chart.states.has(s));
	if (unknown !== undefined) {
		throw new Error(`session does not match \`${chart.machine.name}\`: no state \`${unknown}\``);
	}
	const env = new Env(chart);
	env.apply(from.variables);
	env.apply(variables);
	const active = activeSet(chart, from.current);
	const time = from.time ?? 0;
	const clock: Clock = {
		time,
		entered: new Map([...active].map((s) => [s, from.entered?.[s] ?? 0])),
		timers: new Map()
	};
	const run: Run = {
		chart,
		active,
		env,
		clock,
		doing: new Set((from.doing ?? []).filter((s) => active.has(s))),
		queue: (from.queue ?? []).map((q) => ({ ...q })),
		sent: [],
		outward: options.outward === true,
		changes: new Map(Object.entries(from.changes ?? {}).map(([i, c]) => [Number(i), c])),
		terminated: from.terminated === true,
		messages: [],
		trace: [...from.trace],
		step: from.step
	};
	env.clock = clock;
	if (from.timers) {
		for (const [index, due] of Object.entries(from.timers)) clock.timers.set(Number(index), due);
	} else armStates(run, [...active], []);
	// A time that could not be evaluated is tried again with the new values, counting from now.
	if (variables && Object.keys(variables).length) {
		for (const [index, due] of clock.timers) {
			if (isUnevaluated(due)) clock.timers.set(index, arm(chart.transitions[index]!, time, env));
		}
	}
	// Values given now may make a condition turn true.
	observe(run);
	return run;
}

/** Start a machine. `variables` override the defaults (`null` keeps the default). */
export function start(
	machine: StateMachine,
	variables: Variables | null = null,
	options: Options = {}
): StateSession {
	const chart = compile(machine);
	const run: Run = {
		chart,
		active: new Set(),
		env: seed(chart, variables ?? {}),
		clock: { time: 0, entered: new Map(), timers: new Map() },
		doing: new Set(),
		queue: [],
		sent: [],
		outward: options.outward === true,
		changes: new Map(),
		terminated: false,
		messages: [],
		trace: [],
		step: 0
	};
	run.env.clock = run.clock;
	const e = entering();
	if (machine.parallel) {
		for (const region of childrenOf(chart, undefined)) {
			if (region.kind === 'state') enterState(run, region.name, e);
		}
	} else enterDefault(run, undefined, e);
	armStates(run, e.entered, e.notes);
	observe(run);
	const initial = childrenOf(chart, undefined).find((s) => s.kind === 'initial')?.name ?? '';
	const guards = e.initial.map((g) => `guard \`${g.guard}\` is true`);
	const reads = Object.assign({}, ...e.initial.map((g) => g.reads ?? {})) as Record<
		string,
		unknown
	>;
	const first: SimStep = {
		step: 0,
		from_state: initial,
		transition_name: null,
		trigger: null,
		guard_result: e.initial.length ? true : null,
		effect: null,
		to_state: e.entered[0] ?? initial,
		exit_action: null,
		entry_action: e.entries.length ? e.entries.join('; ') : null,
		time: 0,
		do_action: e.dos.length ? e.dos.join('; ') : null,
		do_stopped: null,
		cause: guards.length ? `start: ${guards.join(', ')}` : 'start'
	};
	if (Object.keys(reads).length) first.reads = reads;
	if (e.notes.length) first.notes = e.notes;
	run.trace.push(first);
	return session(run, options);
}

/** What a Step would fire now, with guards and conditions read from `env`. */
function readyNow(run: Run, list: Transition[], env: Env): Transition[] {
	return list.filter((t) => accepts(t, null) && check(run, t, env).ready);
}

/** The reasons of the timers and change signals that just came and were lost, for a message. */
function lostAt(run: Run, list: Transition[]): string[] {
	return list
		.map((t) =>
			t.trigger?.kind === 'time'
				? run.clock.timers.get(t.index)
				: t.trigger?.kind === 'change'
					? run.changes.get(t.index)
					: undefined
		)
		.filter((due): due is string => typeof due === 'string' && due.includes(' came at '));
}

/**
 * Let time pass to `target`, firing what is ready at each instant on the way
 * (one run-to-completion step at a time, signals the machine sent itself
 * included) and each timer as it comes due.
 */
function waitUntil(run: Run, target: number, options: Options) {
	const { chart, clock } = run;
	for (let steps = 0; ;) {
		const now = status(run, options);
		// Time goes on for a machine that is stuck, not for one that finished or hit its limit.
		if (now === 'deadlocked') clock.time = Math.max(clock.time, target);
		if (now !== 'running') return;
		const list = candidates(chart, run.active);
		const before = run.env.clone();
		const ready = readyNow(run, list, before);
		expire(run, list, before);
		if (ready.length || run.queue.length) {
			if (steps++ >= WAIT_STEPS) {
				run.messages.push(
					`stopped after ${WAIT_STEPS} steps at ${formatDuration(clock.time)}: the machine keeps moving without time passing`
				);
				return;
			}
			if (ready.length) fire(run, ready, before);
			else dispatch(run, list, before);
			continue;
		}
		const next = nextAt(run);
		if (next !== undefined && next <= target) {
			setTime(run, next);
			continue;
		}
		if (target > clock.time) setTime(run, target);
		return;
	}
}

/**
 * Take one step. Variables in the choice are applied first (`null` unsets).
 * If nothing fires, the session is returned with a message saying why.
 */
export function step(
	machine: StateMachine,
	from: StateSession,
	choice: Choice,
	options: Options = {}
): StateSession {
	const chart = compile(machine);
	const run = resume(chart, from, choice.variables, options);
	const where = leaves(chart, run.active).join(', ');
	const now = status(run, options);
	if (now === 'completed') {
		run.messages.push('the machine has finished; restart it to run again');
		return session(run, options);
	}
	if (now === 'max steps reached') {
		run.messages.push(
			`the machine has taken ${run.step} steps, its limit; restart it to run again`
		);
		return session(run, options);
	}

	if ('wait' in choice) {
		let target: number | undefined;
		if (choice.wait === 'next') target = nextAt(run);
		else if (Number.isFinite(choice.wait) && choice.wait > 0) target = run.clock.time + choice.wait;
		else throw new Error(`cannot wait for ${String(choice.wait)} seconds`);
		if (target === undefined) {
			if (run.queue.length) target = run.clock.time;
			else {
				run.messages.push(`no timer is running in ${where}`);
				return session(run, options);
			}
		}
		waitUntil(run, target, options);
		return session(run, options);
	}

	const list = candidates(chart, run.active);
	// Guards and conditions are evaluated once, before anything fires.
	const before = run.env.clone();
	const head = run.queue[0];
	if ('transition' in choice) {
		const t = chart.transitions[choice.transition];
		if (!t) throw new Error(`no transition ${choice.transition} in \`${machine.name}\``);
		if (!list.includes(t)) {
			run.messages.push(`\`${t.label}\` does not leave ${where}`);
			return session(run, options);
		}
		const first = select(chart, readyNow(run, list, before), run.active)[0];
		if (t.trigger?.kind === 'signal' && first) {
			run.messages.push(`\`${first.label}\` fires first: Step, then \`${t.label}\``);
			return session(run, options);
		}
		if (t.trigger?.kind === 'signal' && head) {
			run.messages.push(
				`\`${head.signal}\`, sent by ${senderOf(head)}, comes first: Step, then \`${t.label}\``
			);
			return session(run, options);
		}
		const payload = t.trigger?.kind === 'signal' ? payloadOf(chart, t.trigger.name, before) : null;
		const c = check(run, t, before, payload);
		if (!c.ready) {
			run.messages.push(`\`${t.label}\` cannot fire: ${c.reason}`);
			return session(run, options);
		}
		fire(run, [t], before, t.trigger?.kind === 'signal' ? { name: t.trigger.name, payload } : null);
		return session(run, options);
	}

	const event = choice.event?.trim() || null;
	if (event !== null) {
		// What a Step would fire comes first: an event sent now would find the machine elsewhere.
		const pending = readyNow(run, list, before);
		const first = select(chart, pending, run.active)[0];
		if (first && !pending.some((t) => accepts(t, event))) {
			run.messages.push(`\`${first.label}\` fires first: Step, then send \`${event}\``);
			return session(run, options);
		}
		if (head) {
			run.messages.push(
				`\`${head.signal}\`, sent by ${senderOf(head)}, comes first: Step, then send \`${event}\``
			);
			return session(run, options);
		}
		const payload = payloadOf(chart, event, before, [], choice.payload ?? null);
		const ready = list.filter((t) => accepts(t, event) && check(run, t, before, payload).ready);
		if (!ready.length) {
			const timed = list.some((t) => t.trigger?.kind === 'time' && t.trigger.text === event);
			run.messages.push(
				timed
					? `\`${event}\` is a time trigger: it fires when its time comes (Step or Wait)`
					: `\`${event}\` fires no transition from ${where}`
			);
			return session(run, options);
		}
		const signal = ready.some((t) => t.trigger?.kind === 'signal');
		fire(run, ready, before, signal ? { name: event, payload } : null);
		return session(run, options);
	}

	let ready = readyNow(run, list, before);
	if (!ready.length && head) {
		// Nothing else is ready: the oldest signal the machine sent itself.
		dispatch(run, list, before);
		return session(run, options);
	}
	// Nothing to do now: time passes to the next timer.
	if (!ready.length) {
		const next = nextAt(run);
		if (next === undefined) {
			run.messages.push(`nothing is ready in ${where}, and no timer is running`);
			return session(run, options);
		}
		setTime(run, next);
		ready = readyNow(run, list, before);
	}
	expire(run, list, before);
	if (!ready.length) {
		const lost = lostAt(run, list);
		run.messages.push(
			`at ${formatDuration(run.clock.time)} nothing fired: ${lost.join('; ') || 'nothing was ready'}`
		);
		return session(run, options);
	}
	fire(run, ready, before);
	return session(run, options);
}

/** The session with variables changed and what is enabled re-evaluated, without stepping. */
export function withVariables(
	machine: StateMachine,
	from: StateSession,
	variables: Variables,
	options: Options = {}
): StateSession {
	const run = resume(compile(machine), from, variables, options);
	return session(run, options);
}

/**
 * The session at a later time, with nothing fired: what comes due then
 * (timers, conditions on the clock) is ready for the next Step, or lost when
 * its guard is false. For parts run on one clock (`system.ts`), which moves
 * every part to the earliest time something comes due in any of them.
 */
export function advance(
	machine: StateMachine,
	from: StateSession,
	time: number,
	options: Options = {}
): StateSession {
	const run = resume(compile(machine), from, null, options);
	if (time > run.clock.time) setTime(run, time);
	return session(run, options);
}
