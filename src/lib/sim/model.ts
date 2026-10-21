/**
 * Emulation helpers: what the controls offer from the current state, how a
 * blocked transition is explained, what each variable affects, and how the
 * trace and the session history fit together. Pure functions over the
 * engine's `StateMachine` and `StateSession`.
 */
import type { SimStep, StateMachine, StateSession } from '#lib/engine/types.ts';

export type Enabled = StateSession['enabled'][number];
export type Variable = StateMachine['variables'][number];

/**
 * An event name the model cannot declare: stepping with it fires nothing but
 * applies variables and re-evaluates guards, so the controls can preview them.
 */
export const PREVIEW_EVENT = '⁠preview';

/** `when …` (change), `after …` and `at …` (time) triggers fire on a Step, not as events. */
export function isChangeTrigger(trigger: string | null | undefined): boolean {
	return !!trigger && /^(when|after|at)\b/.test(trigger.trim());
}

export function isEventTrigger(trigger: string | null | undefined): trigger is string {
	return !!trigger && !isChangeTrigger(trigger);
}

export interface EventOption {
	trigger: string;
	ready: boolean;
	/** The transitions this event may fire from the current state(s). */
	transitions: Enabled[];
	/** Why the blocked ones cannot fire. */
	reasons: string[];
}

/** One option per event trigger, in the order the engine lists them. */
export function eventOptions(enabled: Enabled[]): EventOption[] {
	const options = new Map<string, EventOption>();
	for (const e of enabled) {
		if (!isEventTrigger(e.trigger)) continue;
		const option = options.get(e.trigger) ?? {
			trigger: e.trigger,
			ready: false,
			transitions: [],
			reasons: []
		};
		option.transitions.push(e);
		if (e.ready) option.ready = true;
		else if (e.reason) option.reasons.push(e.reason);
		options.set(e.trigger, option);
	}
	return [...options.values()];
}

export interface StepOption {
	ready: boolean;
	/** Completion, guard-only and change transitions from the current state(s). */
	transitions: Enabled[];
	reasons: string[];
}

/** What a Step (null event) would do. */
export function stepOption(enabled: Enabled[]): StepOption {
	const transitions = enabled.filter((e) => !isEventTrigger(e.trigger));
	return {
		ready: transitions.some((e) => e.ready),
		transitions,
		reasons: transitions.filter((e) => !e.ready && e.reason).map((e) => e.reason!)
	};
}

/** A piece of an explanation; `code` parts are model text. */
export interface Part {
	text: string;
	code?: boolean;
	/** A variable the user can set to unblock the transition. */
	variable?: string;
}

/**
 * Turn the engine's reason into a short, kind explanation:
 * "guard `x > 2` is false" → guard x > 2 is false;
 * "guard `p`: undefined variable `p`" → p has no value yet.
 */
export function explain(reason: string): Part[] {
	const undefinedVar = /^(guard|condition) `(.+)`: undefined variable `(.+)`$/.exec(reason);
	if (undefinedVar) {
		return [
			{ text: undefinedVar[3]!, code: true, variable: undefinedVar[3]! },
			{ text: ' has no value yet' }
		];
	}
	const isFalse = /^(guard|condition) `(.+)` is false$/.exec(reason);
	if (isFalse) {
		return [{ text: `${isFalse[1]} ` }, { text: isFalse[2]!, code: true }, { text: ' is false' }];
	}
	return reason.split('`').map((text, i) => (i % 2 ? { text, code: true } : { text }));
}

export function explainText(reason: string): string {
	return explain(reason)
		.map((p) => p.text)
		.join('');
}

/** Whether an expression mentions a name (as a whole word, not a member). */
export function mentions(expression: string, name: string): boolean {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^\\w.])${escaped}(?![\\w])`).test(expression);
}

export interface Use {
	/** Index in `machine.transitions`. */
	index: number;
	name: string;
	kind: 'guard' | 'when';
	expression: string;
}

/** For each variable, the guards and change triggers that read it. */
export function variableUses(machine: StateMachine): Map<string, Use[]> {
	const uses = new Map<string, Use[]>(machine.variables.map((v) => [v.name, []]));
	machine.transitions.forEach((t, index) => {
		const name = t.name ?? `${t.from} → ${t.to}`;
		const checks: [Use['kind'], string | undefined][] = [
			['guard', t.guard],
			['when', isChangeTrigger(t.trigger) ? t.trigger!.replace(/^\s*when\s+/, '') : undefined]
		];
		for (const [kind, expression] of checks) {
			if (!expression) continue;
			for (const v of machine.variables) {
				if (mentions(expression, v.name)) uses.get(v.name)!.push({ index, name, kind, expression });
			}
		}
	});
	return uses;
}

export type InputKind = 'boolean' | 'integer' | 'real' | 'text';

const INTEGER = /^(Integer|Natural|Positive|Integers|UnlimitedNatural)$/;
const REAL = /^(Real|Rational|Number|Numerical|Complex|Float|Double)$/;

/** The input that fits a variable's type (or its value, when untyped). */
export function inputKind(v: Pick<Variable, 'type' | 'value'>): InputKind {
	const type = v.type?.split('::').pop() ?? '';
	if (type === 'Boolean') return 'boolean';
	if (INTEGER.test(type)) return 'integer';
	if (REAL.test(type) || /Value$/.test(type)) return 'real';
	if (type) return 'text';
	const value = parseLiteral(v.value);
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real';
	return 'text';
}

/** A default as written in the model (`0.3`, `true`, `"a"`) to a value. */
export function parseLiteral(value: unknown): unknown {
	if (typeof value !== 'string') return value ?? null;
	const text = value.trim();
	if (text === 'true' || text === 'false') return text === 'true';
	if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
	const quoted = /^"(.*)"$|^'(.*)'$/.exec(text);
	if (quoted) return quoted[1] ?? quoted[2] ?? '';
	return text;
}

/** A slider range for a numeric variable, from its value or the ones it is compared with. */
export function sliderRange(
	machine: StateMachine,
	name: string,
	kind: InputKind
): { min: number; max: number; step: number } | null {
	if (kind !== 'real' && kind !== 'integer') return null;
	const own = parseLiteral(machine.variables.find((v) => v.name === name)?.value);
	let scale = typeof own === 'number' ? Math.abs(own) : null;
	if (scale === null) {
		// Borrow the scale of a variable it is compared with (`charge < threshold`).
		for (const use of variableUses(machine).get(name) ?? []) {
			for (const v of machine.variables) {
				const value = parseLiteral(v.value);
				if (v.name !== name && typeof value === 'number' && mentions(use.expression, v.name)) {
					scale = Math.abs(value);
				}
			}
			if (scale !== null) break;
		}
	}
	if (scale === null) return null;
	if (kind === 'real' && scale <= 1) return { min: 0, max: 1, step: 0.01 };
	const max = Math.max(10, 10 ** Math.ceil(Math.log10(scale * 2 || 1)));
	return { min: 0, max, step: kind === 'integer' ? 1 : max / 100 };
}

/** The transition a trace step took: by name, else by its ends and trigger. */
export function transitionOf(machine: StateMachine, step: SimStep): number {
	const ts = machine.transitions;
	if (step.transition_name) {
		const named = ts.findIndex((t) => t.name === step.transition_name);
		if (named >= 0) return named;
	}
	const ends = ts
		.map((t, i) => ({ t, i }))
		.filter(({ t }) => t.from === step.from_state && t.to === step.to_state);
	return (ends.find(({ t }) => (t.trigger ?? null) === step.trigger) ?? ends[0])?.i ?? -1;
}

/** Trace steps a session took since the previous one (all of them for a new session). */
export function stepsSince(previous: StateSession | null, next: StateSession): SimStep[] {
	const after = previous && previous.trace.length <= next.trace.length ? previous.step : -1;
	return next.trace.filter((s) => s.step > after);
}

/** The active states with their ancestors (composite states are active too). */
export function activeSet(machine: StateMachine | null, current: string[]): Set<string> {
	const parents = new Map(machine?.states.map((s) => [s.name, s.parent]) ?? []);
	const active = new Set<string>();
	for (const leaf of current) {
		for (let s: string | undefined = leaf; s && !active.has(s); s = parents.get(s)) active.add(s);
	}
	return active;
}

/** Whether `state` is `ancestor` or nested in it. */
export function within(state: string, ancestor: string): boolean {
	return state === ancestor || state.startsWith(`${ancestor}.`);
}

function list(names: string[]): string {
	if (names.length <= 1) return names[0] ?? 'nothing';
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What a step did, said as a sentence: "Now in returningHome after lowBattery". */
export function stepName(step: SimStep): string {
	return step.transition_name ?? (step.trigger ? step.trigger : 'completion');
}

export function announcement(session: StateSession, steps: SimStep[]): string {
	const where = list(session.current);
	const last = steps.at(-1);
	if (!last || (steps.length === 1 && last.step === 0)) return `Started in ${where}`;
	const via = steps.filter((s) => s.step > 0).map(stepName);
	const done =
		session.status === 'completed'
			? '. The machine completed'
			: session.status === 'deadlocked'
				? '. Nothing more can happen'
				: '';
	return `Now in ${where} after ${list(via)}${done}`;
}

/** Names that shape the machine; when they change, a running session no longer fits. */
export function structureKey(machine: StateMachine): string {
	return JSON.stringify([
		machine.states.map((s) => [s.name, s.kind, s.parallel ?? false]),
		machine.transitions.map((t) => [t.from, t.to, t.trigger ?? '', t.guard ?? '', t.effect ?? '']),
		machine.variables.map((v) => [v.name, v.type ?? '', v.value ?? null])
	]);
}

/** The machine a tab names: by qualified name, else by simple name. */
export function findMachine(machines: StateMachine[], name: string): StateMachine | undefined {
	return (
		machines.find((m) => (m.qualifiedName ?? m.name) === name) ??
		machines.find((m) => m.name === name || m.qualifiedName?.endsWith(`::${name}`)) ??
		machines.find((m) => name.endsWith(`::${m.name}`))
	);
}

/** History of sessions with a cursor; firing from an earlier point drops the later ones. */
export interface History {
	sessions: StateSession[];
	cursor: number;
}

export function record(history: History, next: StateSession): History {
	const kept = history.sessions.slice(0, history.cursor + 1);
	const current = kept.at(-1);
	const same =
		current &&
		current.step === next.step &&
		current.trace.length === next.trace.length &&
		JSON.stringify(current.variables) === JSON.stringify(next.variables);
	// An ignored event changes nothing worth a step back; keep its messages only.
	if (same) return { sessions: [...kept.slice(0, -1), next], cursor: kept.length - 1 };
	return { sessions: [...kept, next], cursor: kept.length };
}

/** The history entry that ended at a trace step (the latest at or before it). */
export function sessionAt(history: History, step: number): number {
	let found = 0;
	history.sessions.forEach((s, i) => {
		if (s.step <= step) found = i;
	});
	return found;
}

/**
 * Auto-run's next move: a ready Step first, else the ready event whose targets
 * were visited least (so a run tours the machine), ties broken at random.
 */
export function autoMove(
	enabled: Enabled[],
	trace: SimStep[] = [],
	random: () => number = Math.random
): { event: string | null } | null {
	if (stepOption(enabled).ready) return { event: null };
	const ready = eventOptions(enabled).filter((o) => o.ready);
	if (!ready.length) return null;
	const visits = new Map<string, number>();
	for (const s of trace) visits.set(s.to_state, (visits.get(s.to_state) ?? 0) + 1);
	const score = (o: EventOption) =>
		Math.min(...o.transitions.filter((t) => t.ready).map((t) => visits.get(t.to) ?? 0));
	const best = Math.min(...ready.map(score));
	const choices = ready.filter((o) => score(o) === best);
	return { event: choices[Math.floor(random() * choices.length) % choices.length]!.trigger };
}

/** Values as the engine wants them: numbers parsed, empty text as unset. */
export function coerce(kind: InputKind, raw: string | boolean): unknown {
	if (kind === 'boolean') return !!raw;
	const text = String(raw).trim();
	if (kind === 'integer' || kind === 'real') {
		if (text === '') return null;
		const n = Number(text);
		return Number.isFinite(n) ? (kind === 'integer' ? Math.round(n) : n) : null;
	}
	return text;
}

export function formatValue(value: unknown): string {
	if (value === null || value === undefined) return 'unset';
	if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6);
	if (typeof value === 'string') return `"${value}"`;
	return String(value);
}

export function statusText(status: string): string {
	switch (status) {
		case 'running':
			return 'Running';
		case 'completed':
			return 'Completed';
		case 'deadlocked':
			return 'Stuck';
		case 'max steps reached':
			return 'Step limit reached';
		default:
			return status.charAt(0).toUpperCase() + status.slice(1);
	}
}
