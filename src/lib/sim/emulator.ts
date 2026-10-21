/**
 * Step-by-step emulation of a state machine, as pure functions over the
 * `StateMachine` structure (whoever extracted it) and a JSON-friendly
 * `StateSession`:
 *
 * - `start` enters the machine: the initial transition of each region,
 *   outermost first, running entry and `do` actions.
 * - `step` takes one run-to-completion step: on an event (a signal, a
 *   change trigger by its `when …` text, a time trigger by its text), on no
 *   event (completion, guard-only, change and time transitions — a Step
 *   with no clock means "time passes"), or on one chosen transition.
 * - `withVariables` re-evaluates what is enabled after variables change,
 *   without stepping.
 *
 * Firing follows the SysML v2 / UML state machine semantics: the guards
 * and conditions of one step are evaluated before any transition fires;
 * transitions from inner states take priority over ones from their
 * ancestors; of the enabled transitions, a maximal set that exit disjoint
 * states fires, so orthogonal regions each take their own step. Firing a
 * transition exits the states it leaves (innermost first, running their
 * exit actions), runs its effect, then enters the target and its default
 * substates (running entry and `do` actions). `assign x := e` statements in
 * actions and effects update the variables; other actions are recorded in
 * the trace only.
 *
 * Action, trigger and guard texts are read as the classic engine writes
 * them: a trigger is a signal name, `when <condition>`, or `after …` /
 * `at …`; an action that updates variables is `assign x := e` statements
 * separated by `;`.
 */
import type { SimStep, StateMachine, StateSession } from '#lib/engine/types.ts';
import {
	EnumLiteral,
	Quantity,
	evaluate,
	evaluateCondition,
	parseExpr,
	type Expr,
	type Scope,
	type Value
} from './expr.ts';
import { convert } from './units.ts';

export type Enabled = StateSession['enabled'][number];
type MachineState = StateMachine['states'][number];
type MachineTransition = StateMachine['transitions'][number];

/** A value as sessions hold it (JSON). `null` unsets a variable. */
export type Variables = Record<string, unknown>;

/** What a step does. */
export type Choice =
	/** Send an event; `null` fires completion, guard-only, change and time transitions. */
	| { event: string | null; variables?: Variables }
	/** Fire this transition (an index into `machine.transitions`), if it is ready. */
	| { transition: number; variables?: Variables };

export interface Options {
	/** Stop with status `max steps reached` once this many transitions have fired. */
	maxSteps?: number;
}

// ---------------------------------------------------------------- the machine, compiled

type Trigger =
	| { kind: 'signal'; name: string }
	| { kind: 'change'; text: string; expr: Expr | null }
	| { kind: 'time'; text: string };

interface Assignment {
	target: string;
	value: string;
	expr: Expr | null;
}

interface Transition {
	index: number;
	source: MachineTransition;
	label: string;
	trigger: Trigger | null;
	guard: Expr | null;
	assignments: Assignment[];
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
	actions: Map<string, Assignment[]>;
}

const charts = new WeakMap<StateMachine, Chart>();

function parseOrNull(text: string): Expr | null {
	try {
		return parseExpr(text);
	} catch {
		return null;
	}
}

function parseTrigger(text: string | undefined): Trigger | null {
	const trimmed = text?.trim();
	if (!trimmed) return null;
	const when = /^when\s+([\s\S]+)$/.exec(trimmed);
	if (when) return { kind: 'change', text: when[1]!.trim(), expr: parseOrNull(when[1]!) };
	if (/^(after|at)\b/.test(trimmed)) return { kind: 'time', text: trimmed };
	return { kind: 'signal', name: trimmed };
}

/**
 * The assignments in an action's text: `assign x := e; assign y := f`, also
 * inside `action { … }`. Text with none (a named action, a send) changes no
 * variable.
 */
function parseAssignments(text: string | undefined): Assignment[] {
	if (!text || !/(^|[\s{;])assign\s/.test(text)) return [];
	const out: Assignment[] = [];
	for (const raw of text.split(';')) {
		const part = raw
			.trim()
			.replace(/^action\b\s*/, '')
			.replace(/^\{\s*/, '')
			.replace(/\s*\}$/, '')
			.trim();
		const m = /^assign\s+([\s\S]+?)\s*:=\s*([\s\S]+)$/.exec(part);
		if (!m) continue;
		const value = m[2]!.trim();
		out.push({ target: m[1]!.trim(), value, expr: parseOrNull(value) });
	}
	return out;
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
	const actions = new Map<string, Assignment[]>();
	const transitions = machine.transitions.map((t, index) => ({
		index,
		source: t,
		label: t.name ?? `${t.from} -> ${t.to}`,
		trigger: parseTrigger(t.trigger),
		guard: t.guard ? parseOrNull(t.guard) : null,
		assignments: parseAssignments(t.effect)
	}));
	const chart: Chart = {
		machine,
		states,
		order,
		children,
		transitions,
		variables: new Set(machine.variables.map((v) => v.name)),
		units: new Map(),
		actions
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

function actionOf(chart: Chart, text: string): Assignment[] {
	let found = chart.actions.get(text);
	if (!found) {
		found = parseAssignments(text);
		chart.actions.set(text, found);
	}
	return found;
}

const childrenOf = (chart: Chart, parent: string | undefined) => chart.children.get(parent) ?? [];
const isComposite = (chart: Chart, name: string) => childrenOf(chart, name).length > 0;
const kindOf = (chart: Chart, name: string) => chart.states.get(name)?.kind;

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

/** The emulator's variables: values may carry units and enum literals while a step runs. */
class Env implements Scope {
	readonly values = new Map<string, Value>();
	constructor(private readonly chart: Chart) {}

	get(name: string): Value | undefined {
		return this.values.get(name);
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

function runAction(chart: Chart, text: string | undefined, env: Env, messages: string[]) {
	if (!text) return;
	runAssignments(actionOf(chart, text), env, messages);
}

function runAssignments(assignments: Assignment[], env: Env, messages: string[]) {
	for (const a of assignments) {
		const target = a.target.replace(/^self\./, '');
		if (!a.expr) {
			messages.push(`assign ${a.target}: \`${a.value}\` is not supported by the evaluator`);
			continue;
		}
		try {
			env.bind(target, evaluate(a.expr, env));
		} catch (error) {
			messages.push(`assign ${a.target}: ${(error as Error).message}`);
		}
	}
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

function status(
	chart: Chart,
	active: Set<string>,
	step: number,
	options: Options
): StateSession['status'] {
	if (finished(chart, undefined, active)) return 'completed';
	if (options.maxSteps !== undefined && step >= options.maxSteps) return 'max steps reached';
	return candidates(chart, active).length ? 'running' : 'deadlocked';
}

// ---------------------------------------------------------------- readiness

interface Check {
	guardResult?: boolean;
	conditionResult?: boolean;
	ready: boolean;
	reason?: string;
}

function check(chart: Chart, t: Transition, active: Set<string>, env: Env): Check {
	const out: Check = { ready: true };
	if (t.trigger?.kind === 'change') {
		const text = t.trigger.text;
		if (!t.trigger.expr)
			out.reason = `condition \`${text}\`: condition is not supported by the evaluator`;
		else {
			try {
				out.conditionResult = evaluateCondition(t.trigger.expr, env);
				if (!out.conditionResult) out.reason = `condition \`${text}\` is false`;
			} catch (error) {
				out.reason = `condition \`${text}\`: ${(error as Error).message}`;
			}
		}
	}
	const guard = t.source.guard;
	if (guard) {
		let message: string | undefined;
		if (!t.guard) message = `guard \`${guard}\`: guard is not supported by the evaluator`;
		else {
			try {
				out.guardResult = evaluateCondition(t.guard, env);
				if (!out.guardResult) message = `guard \`${guard}\` is false`;
			} catch (error) {
				message = `guard \`${guard}\`: ${(error as Error).message}`;
			}
		}
		out.reason ??= message;
	}
	// A completion transition out of a composite state waits until every region inside has finished.
	if (!t.trigger && !out.reason && isComposite(chart, t.source.from)) {
		const unfinished = [...active].some(
			(s) =>
				s !== t.source.from &&
				ancestry(chart, s).includes(t.source.from) &&
				!isComposite(chart, s) &&
				kindOf(chart, s) !== 'final'
		);
		if (unfinished) out.reason = `\`${t.source.from}\` has not finished`;
	}
	out.ready = out.reason === undefined;
	return out;
}

/** Whether `event` names this signal: exactly, or by its last segment. */
function signalMatches(signal: string, event: string): boolean {
	const last = (s: string) => s.split('::').pop();
	return signal === event || last(signal) === last(event);
}

/** Whether a transition's trigger accepts `event` (`null`: a Step). */
function accepts(t: Transition, event: string | null): boolean {
	const trigger = t.trigger;
	if (event === null) return trigger?.kind !== 'signal';
	if (!trigger) return false;
	if (trigger.kind === 'signal') return signalMatches(trigger.name, event);
	return eventName(trigger) === event;
}

function eventName(trigger: Trigger): string {
	return trigger.kind === 'signal'
		? trigger.name
		: trigger.kind === 'change'
			? `when ${trigger.text}`
			: trigger.text;
}

/** Firing order among candidates: inner sources first, completion before change and time triggers. */
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

/** Every transition leaving an active state, inner states first, with its guard evaluated. */
function enabled(chart: Chart, active: Set<string>, env: Env): Enabled[] {
	const list = candidates(chart, active);
	const checks = new Map(list.map((t) => [t, check(chart, t, active, env)]));
	// A ready transition that a higher-priority one pre-empts on the same event is not ready.
	const winner = new Map<Transition, Transition>();
	const groups = new Map<string, Transition[]>();
	for (const t of list) {
		if (!checks.get(t)!.ready) continue;
		const key =
			t.trigger?.kind === 'signal' ? `signal:${t.trigger.name.split('::').pop()}` : 'step';
		groups.set(key, [...(groups.get(key) ?? []), t]);
	}
	for (const group of groups.values()) {
		const chosen = select(chart, group, active);
		for (const t of group) {
			if (chosen.includes(t)) continue;
			const leaving = new Set(exits(chart, t, active));
			const by = chosen.find((c) => exits(chart, c, active).some((s) => leaving.has(s)));
			if (by) winner.set(t, by);
		}
	}
	return list.map((t) => {
		const c = checks.get(t)!;
		const by = winner.get(t);
		const e: Enabled = {
			transition: t.label,
			index: t.index,
			from: t.source.from,
			to: t.source.to,
			ready: c.ready && !by
		};
		if (t.trigger) e.trigger = eventName(t.trigger);
		if (t.source.guard) e.guard = t.source.guard;
		if (c.guardResult !== undefined) e.guardResult = c.guardResult;
		if (c.conditionResult !== undefined) e.conditionResult = c.conditionResult;
		const reason = c.reason ?? (by ? `\`${by.label}\` fires first` : undefined);
		if (reason !== undefined) e.reason = reason;
		return e;
	});
}

// ---------------------------------------------------------------- entering and leaving

interface Run {
	chart: Chart;
	active: Set<string>;
	env: Env;
	messages: string[];
	trace: SimStep[];
	step: number;
}

function markEntered(run: Run, name: string, entered: string[]) {
	if (!run.active.has(name)) {
		run.active.add(name);
		entered.push(name);
	}
}

/** Enter `name` and, if it is composite, its default substates (every region of a parallel one). */
function enterState(run: Run, name: string, entered: string[]) {
	markEntered(run, name, entered);
	const state = run.chart.states.get(name);
	if (!state) return;
	if (state.parallel) {
		for (const region of childrenOf(run.chart, name)) {
			if (region.kind === 'state') enterState(run, region.name, entered);
		}
	} else if (isComposite(run.chart, name)) enterDefault(run, name, entered);
}

/** Enter the default state of the region inside `parent`: its initial transition's target, else its first state. */
function enterDefault(run: Run, parent: string | undefined, entered: string[]) {
	const { chart } = run;
	const inside = childrenOf(chart, parent);
	const initial = inside.find((s) => s.kind === 'initial');
	const target =
		(initial && chart.machine.transitions.find((t) => t.from === initial.name)?.to) ??
		inside.find((s) => s.kind === 'state')?.name;
	if (target === undefined) return;
	// The initial transition may point into a nested state.
	const line = ancestry(chart, target);
	const stop = parent === undefined ? -1 : line.indexOf(parent);
	const path = (stop < 0 ? line : line.slice(0, stop)).reverse();
	path.forEach((s, i) => {
		if (i + 1 === path.length) enterState(run, s, entered);
		else markEntered(run, s, entered);
	});
}

/** Run the entry and `do` actions of the states entered, in order; the entry actions as text. */
function runEntries(run: Run, entered: string[]): string | null {
	const texts: string[] = [];
	for (const name of entered) {
		const state = run.chart.states.get(name);
		if (!state) continue;
		if (state.entry) {
			texts.push(state.entry);
			runAction(run.chart, state.entry, run.env, run.messages);
		}
		if (state.do) runAction(run.chart, state.do, run.env, run.messages);
	}
	return texts.length ? texts.join('; ') : null;
}

/** Fire a transition: exit, effect, enter. */
function take(run: Run, t: Transition) {
	const { chart } = run;
	const { target, targetLine } = branches(chart, t);
	const left = exits(chart, t, run.active);
	const exitTexts: string[] = [];
	for (const s of left) {
		run.active.delete(s);
		const action = chart.states.get(s)?.exit;
		if (action) {
			exitTexts.push(action);
			runAction(chart, action, run.env, run.messages);
		}
	}

	runAssignments(t.assignments, run.env, run.messages);

	// Enter from the target branch down to the target, then its defaults.
	const entered: string[] = [];
	const path = targetLine.slice(0, targetLine.indexOf(target) + 1).reverse();
	path.forEach((s, i) => {
		if (i + 1 === path.length) {
			enterState(run, s, entered);
			return;
		}
		markEntered(run, s, entered);
		// Entering one region of a parallel state enters its sibling regions too.
		if (chart.states.get(s)?.parallel) {
			for (const region of childrenOf(chart, s)) {
				if (region.name !== path[i + 1] && region.kind === 'state')
					enterState(run, region.name, entered);
			}
		}
	});
	const entryText = runEntries(run, entered);

	run.step += 1;
	run.trace.push({
		step: run.step,
		from_state: t.source.from,
		transition_name: t.source.name ?? null,
		trigger: t.trigger ? eventName(t.trigger) : null,
		// It fired, so its guard held.
		guard_result: t.source.guard ? true : null,
		effect: t.source.effect ?? null,
		to_state: t.source.to,
		exit_action: exitTexts.length ? exitTexts.join('; ') : null,
		entry_action: entryText
	});
}

// ---------------------------------------------------------------- sessions

function session(run: Run, options: Options): StateSession {
	const { chart } = run;
	const variables: Record<string, unknown> = {};
	for (const v of chart.machine.variables) variables[v.name] = null;
	for (const [name, value] of run.env.values) variables[name] = toJson(value);
	const out: StateSession = {
		machine: chart.machine.qualifiedName ?? chart.machine.name,
		current: leaves(chart, run.active),
		step: run.step,
		variables,
		trace: run.trace,
		status: status(chart, run.active, run.step, options),
		enabled: enabled(chart, run.active, run.env)
	};
	if (run.messages.length) out.messages = run.messages;
	return out;
}

/** Rebuild a run from a session (which may have gone through JSON) and variable changes. */
function resume(chart: Chart, from: StateSession, variables: Variables | null | undefined): Run {
	const unknown = from.current.find((s) => !chart.states.has(s));
	if (unknown !== undefined) {
		throw new Error(`session does not match \`${chart.machine.name}\`: no state \`${unknown}\``);
	}
	const env = new Env(chart);
	env.apply(from.variables);
	env.apply(variables);
	return {
		chart,
		active: activeSet(chart, from.current),
		env,
		messages: [],
		trace: [...from.trace],
		step: from.step
	};
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
		messages: [],
		trace: [],
		step: 0
	};
	const entered: string[] = [];
	if (machine.parallel) {
		for (const region of childrenOf(chart, undefined)) {
			if (region.kind === 'state') enterState(run, region.name, entered);
		}
	} else enterDefault(run, undefined, entered);
	const entryAction = runEntries(run, entered);
	run.trace.push({
		step: 0,
		from_state: childrenOf(chart, undefined).find((s) => s.kind === 'initial')?.name ?? '',
		transition_name: null,
		trigger: null,
		guard_result: null,
		effect: null,
		to_state: entered[0] ?? '',
		exit_action: null,
		entry_action: entryAction
	});
	return session(run, options);
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
	const run = resume(chart, from, choice.variables);
	const where = leaves(chart, run.active).join(', ');
	const now = status(chart, run.active, run.step, options);
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

	const list = candidates(chart, run.active);
	// Guards and conditions are evaluated once, before anything fires.
	const before = run.env.clone();
	let ready: Transition[];
	if ('transition' in choice) {
		const t = chart.transitions[choice.transition];
		if (!t) throw new Error(`no transition ${choice.transition} in \`${machine.name}\``);
		if (!list.includes(t)) {
			run.messages.push(`\`${t.label}\` does not leave ${where}`);
			return session(run, options);
		}
		const c = check(chart, t, run.active, before);
		if (!c.ready) {
			run.messages.push(`\`${t.label}\` cannot fire: ${c.reason}`);
			return session(run, options);
		}
		ready = [t];
	} else {
		const event = choice.event?.trim() || null;
		ready = list.filter((t) => accepts(t, event) && check(chart, t, run.active, before).ready);
		if (!ready.length) {
			run.messages.push(
				event !== null
					? `\`${event}\` fires no transition from ${where}`
					: `no completion, guard-only or change transition is ready in ${where}`
			);
			return session(run, options);
		}
	}
	for (const t of select(chart, ready, run.active)) take(run, t);
	return session(run, options);
}

/** The session with variables changed and what is enabled re-evaluated, without stepping. */
export function withVariables(
	machine: StateMachine,
	from: StateSession,
	variables: Variables,
	options: Options = {}
): StateSession {
	const run = resume(compile(machine), from, variables);
	return session(run, options);
}
