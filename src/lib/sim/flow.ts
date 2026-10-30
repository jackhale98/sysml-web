/**
 * Action flows, run token by token: the steps of an action (`actions.ts`)
 * read as a graph of nodes joined by successions, and a run of that graph
 * that can stop and wait (for a signal, a time, or a person's choice) and
 * go on later. Both the action flow runner (`flow-run.ts`) and a state
 * machine's actions (`emulator.ts`, through `runBody`) use it.
 *
 * The graph (SysML v2.0 Part 1, 7.17 Actions; the Systems Library's
 * `Actions` package):
 * - every step of the body is a node: an action (`action a { … }`, `action
 *   a : A;`, a `perform`), an `assign`, `send`, `accept`, `if`, loop, or a
 *   control node (`fork`, `join`, `merge`, `decide`), plus `start` and `done`;
 * - `then x` is a succession from the step declared before it (successions
 *   themselves do not count as that step), `first a then b` one between
 *   named steps, `if c then x` / `else x` a decision's guarded branch;
 * - `flow from a.x to b.y` carries `a.x`'s value to `b.y` when `a` ends
 *   (`succession flow` also orders them).
 *
 * The run:
 * - A step ends the steps that can end now, then passes their tokens on:
 *   the steps they lead to start. Control nodes take no time (`Actions::
 *   ControlAction`: `bind start = done`): a fork starts all its targets, a
 *   join waits for a token from every incoming succession (`JoinAction`), a
 *   merge passes each token on (`MergeAction`), and a decision takes exactly
 *   one branch (`DecisionAction`, `DecisionPerformance::outgoingHBLink
 *   [1]`): the one whose guard holds, `else` when none does. When none holds
 *   (and there is no `else`) or several do, the token waits at the decision
 *   and the run says why, rather than picking one.
 * - Steps no succession leads to start with the action (7.17: steps not
 *   ordered by successions may happen in any order, at the same time).
 *   Within a step the simulator runs them in the order written and notes
 *   when two of them set the same variable, since that order is its choice.
 * - An action with steps of its own (a body, or the body of the action it
 *   performs or is typed by) runs them as a flow inside it, and ends when
 *   they have all ended. `if` runs its first branch whose condition holds
 *   (`IfThenElsePerformance`). A `while` loop tests its condition before
 *   each pass and its `until` after (`LoopPerformance`, `WhileLoopAction`;
 *   `loop` has no `while` test); `for v in seq` runs once per value, in
 *   order (`ForLoopAction`). One pass of a loop's body per step.
 * - `accept` waits for its signal (`AcceptAction`), a time (`after d`, `at
 *   t`) or a condition (`when c`); `send` sends one (`SendAction`). Signals
 *   sent to the action itself (`to self`, or no `to`) wait in the run's
 *   queue until an `accept` takes them.
 * - A loop that runs `LOOP_LIMIT` times stops the run, with a note.
 */
import { parseAction, type ActionStep, type StepOf } from './actions.ts';
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
import { convert } from './units.ts';

/** A loop stops the run after this many passes. */
export const LOOP_LIMIT = 1000;

// ---------------------------------------------------------------- the graph

export type FlowNodeKind =
	| 'start'
	| 'done'
	| 'fork'
	| 'join'
	| 'merge'
	| 'decide'
	| 'action'
	| 'assign'
	| 'send'
	| 'accept'
	| 'if'
	| 'loop'
	| 'for'
	| 'perform'
	| 'other';

export interface FlowNode {
	/** The step's name, else its kind and number (`fork#1`, `assign#2`); `start`, `done`. */
	id: string;
	kind: FlowNodeKind;
	/** What the diagram writes in it. */
	label: string;
	step: ActionStep | null;
}

export interface FlowEdge {
	index: number;
	from: string;
	to: string;
	kind: 'succession' | 'flow';
	/** A branch's condition, or `else`. */
	guard: string | null;
	/** Flows: the item (`of T`), and the parameters it joins (`plan` of `a.plan`). */
	item?: string | null;
	fromFeature?: string | null;
	toFeature?: string | null;
	/** Successions too (`succession flow`). */
	orders: boolean;
	text: string;
}

export interface FlowGraph {
	nodes: FlowNode[];
	edges: FlowEdge[];
	/** The body's own parameters and attributes. */
	features: StepOf<'feature'>[];
	/** What the graph could not make sense of. */
	notes: string[];
}

const CONTROL = new Set<FlowNodeKind>(['start', 'done', 'fork', 'join', 'merge', 'decide']);
export const isControl = (kind: FlowNodeKind) => CONTROL.has(kind);

const graphs = new WeakMap<ActionStep[], FlowGraph>();

/** The words a node without a name is called by. */
const WORDS: Partial<Record<ActionStep['kind'], FlowNodeKind>> = {
	assign: 'assign',
	send: 'send',
	accept: 'accept',
	if: 'if',
	loop: 'loop',
	for: 'for',
	perform: 'perform',
	action: 'action',
	named: 'action',
	other: 'other'
};

/** The graph of a body of steps (cached per parse). */
export function graphOf(steps: ActionStep[]): FlowGraph {
	let graph = graphs.get(steps);
	if (!graph) {
		graph = buildGraph(steps);
		graphs.set(steps, graph);
	}
	return graph;
}

function shortLabel(step: ActionStep): string {
	const text = step.text.replace(/\s*\{[\s\S]*$/, ' { … }');
	return text.length > 40 ? `${text.slice(0, 38)}…` : text;
}

function buildGraph(steps: ActionStep[]): FlowGraph {
	const nodes: FlowNode[] = [];
	const byId = new Map<string, FlowNode>();
	const edges: {
		from: string | null;
		to: string;
		edge: Omit<FlowEdge, 'index' | 'from' | 'to'>;
	}[] = [];
	const features: StepOf<'feature'>[] = [];
	const notes: string[] = [];
	const counters = new Map<string, number>();
	const add = (node: FlowNode) => {
		nodes.push(node);
		byId.set(node.id, node);
	};
	const fresh = (word: string) => {
		for (;;) {
			const n = (counters.get(word) ?? 0) + 1;
			counters.set(word, n);
			const id = `${word}#${n}`;
			if (!byId.has(id)) return id;
		}
	};
	let previous: string | null = null;
	const succession = (from: string | null, to: string, guard: string | null, text: string) =>
		edges.push({ from, to, edge: { kind: 'succession', guard, orders: true, text } });

	for (const step of steps) {
		switch (step.kind) {
			case 'feature':
				features.push(step);
				continue;
			case 'declaration':
				continue;
			case 'first':
				previous = step.target;
				continue;
			case 'succession':
				if (step.from === null && previous === null) {
					notes.push(`\`${step.text}\` has no step before it`);
					continue;
				}
				succession(step.from ?? previous, step.to, step.guard, step.text);
				continue;
			case 'flow': {
				const [from, ...fromRest] = step.from.split('.');
				const [to, ...toRest] = step.to.split('.');
				edges.push({
					from: from!,
					to: to!,
					edge: {
						kind: 'flow',
						guard: null,
						item: step.item,
						fromFeature: fromRest.join('.') || null,
						toFeature: toRest.join('.') || null,
						orders: step.succession,
						text: step.text
					}
				});
				continue;
			}
		}
		const kind: FlowNodeKind = step.kind === 'control' ? step.node : (WORDS[step.kind] ?? 'other');
		const named =
			step.name ?? (step.kind === 'named' && /^[\w$'.]+$/.test(step.text) ? step.text : null);
		const id = named && !byId.has(named) ? named : fresh(kind === 'decide' ? 'decide' : kind);
		const label =
			step.kind === 'control'
				? (step.name ?? '')
				: step.kind === 'perform'
					? (step.name ?? step.target)
					: (named ?? shortLabel(step));
		add({ id, kind, label, step });
		if (step.after) {
			if (previous === null) notes.push(`\`then ${step.text}\` has no step before it`);
			else succession(previous, id, null, `then ${step.text}`);
		}
		previous = id;
	}

	// Names to nodes: `start` and `done` are the action's own; others must be declared in the body.
	const ensure = (name: string): string => {
		if (byId.has(name)) return name;
		if (name === 'start' || name === 'done') {
			add({ id: name, kind: name, label: '', step: null });
			return name;
		}
		const simple = name.split(/::|\./).pop()!;
		if (byId.has(simple)) return simple;
		notes.push(`\`${name}\` is not a step of this action`);
		add({ id: name, kind: 'action', label: name, step: null });
		return name;
	};
	const out: FlowEdge[] = edges.map((e, index) => ({
		index,
		from: ensure(e.from!),
		to: ensure(e.to),
		...e.edge
	}));
	// `start` first, `done` last: the order the diagram and the run read them in.
	nodes.sort((a, b) => rank(a.kind) - rank(b.kind));
	return { nodes, edges: out, features, notes };
}

const rank = (kind: FlowNodeKind) => (kind === 'start' ? 0 : kind === 'done' ? 2 : 1);

/** Whether a step does something when run (not a declaration or an ordering). */
function isRunnable(step: ActionStep): boolean {
	return !['feature', 'declaration', 'first', 'succession', 'flow'].includes(step.kind);
}

/** Successions (and succession flows) into a node. */
const incoming = (graph: FlowGraph, id: string) =>
	graph.edges.filter((e) => e.to === id && e.orders);
const outgoing = (graph: FlowGraph, id: string) =>
	graph.edges.filter((e) => e.from === id && e.orders);

/** The nodes a body starts with: `start`, and the steps no succession leads to. */
export function initialNodes(graph: FlowGraph): FlowNode[] {
	return graph.nodes.filter(
		(n) =>
			n.kind !== 'done' &&
			(n.kind === 'start' || (!isControl(n.kind) && !incoming(graph, n.id).length))
	);
}

// ---------------------------------------------------------------- the run's state (JSON)

/** A body being performed: what runs in it, and the tokens it holds. */
export interface Frame {
	/** Nodes running now, by id. */
	running: Record<string, NodeRun>;
	/** Joins: the incoming successions (by edge index) whose token has come. */
	joins?: Record<string, number[]>;
	/** Decisions holding a token: why it cannot go on, or the branches it could take. */
	held?: Record<string, Held>;
	/** How many times each node has ended. */
	ended?: Record<string, number>;
	/** A token reached `done`. */
	done?: true;
}

export interface Held {
	reason: string;
	/** Several guards hold: the edges a person may choose from. */
	choices?: number[];
}

export interface NodeRun {
	/** The step it started in. */
	since: number;
	/** Its own steps, once begun. */
	child?: Frame;
	/** `if`: the branch taken (its index; -1 for `else`), once tested. */
	branch?: number;
	/** Loops: the pass under way (from 1). */
	pass?: number;
	/** `for`: the values still to come. */
	items?: unknown[];
	/** `accept after` / `accept at`: when it is due (seconds since the start), or why it never is. */
	due?: number | string;
	/** Tokens that came while it was running: it runs again for each. */
	again?: number;
}

export interface FlowState {
	step: number;
	/** Seconds since the start. */
	time: number;
	root: Frame;
	/** Values by path: `flightPlan`, `checkDropZone.isClear`. */
	variables: Record<string, unknown>;
	/** Signals sent to the action itself, waiting for an `accept`, oldest first. */
	queue: { signal: string; values?: Record<string, unknown>; from?: string }[];
	/** `stopped`: a loop ran too often, or something could not be run. */
	stopped?: string;
}

/** What one step did. */
export interface FlowEvent {
	/** The node's path (`checkDropZone`, `perform#1.takeOff`). */
	node: string;
	what: 'started' | 'ended' | 'waits' | 'took' | 'note';
	text?: string;
	/** The succession or flow it went along (`<frame path>#<edge index>`). */
	edge?: string;
}

// ---------------------------------------------------------------- values

/** A value as runs keep it in JSON. */
export function toJson(value: Value): unknown {
	if (value instanceof Quantity) return { value: value.value, unit: value.unit };
	if (value instanceof EnumLiteral) return { literal: value.qualified };
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return value;
}

export function fromJson(json: unknown): Value {
	if (json === null || json === undefined) return null;
	if (typeof json === 'boolean' || typeof json === 'string' || typeof json === 'number')
		return json;
	if (typeof json === 'object') {
		const o = json as Record<string, unknown>;
		if (typeof o.value === 'number' && typeof o.unit === 'string')
			return new Quantity(o.value, o.unit);
		if (typeof o.literal === 'string') return new EnumLiteral(o.literal);
	}
	throw new Error(`unsupported value ${JSON.stringify(json)}`);
}

/** `1..3`, `(a, b, c)`, or one value: the values a `for` loop takes, in order. */
function sequence(text: string, scope: Scope, expr: (t: string) => Expr): Value[] {
	const trimmed = text.trim();
	const range = splitTop(trimmed, '..');
	if (range.length === 2) {
		const from = evaluate(expr(range[0]!), scope);
		const to = evaluate(expr(range[1]!), scope);
		if (typeof from !== 'number' || typeof to !== 'number')
			throw new EvalError(`\`${text}\` is not a range of numbers`);
		const out: Value[] = [];
		for (let i = from; i <= to && out.length <= LOOP_LIMIT; i++) out.push(i);
		return out;
	}
	if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
		const parts = splitTop(trimmed.slice(1, -1), ',');
		if (parts.length > 1) return parts.map((p) => evaluate(expr(p), scope));
	}
	return [evaluate(expr(trimmed), scope)];
}

/** Split at `sep` outside brackets and quotes. */
function splitTop(text: string, sep: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") {
			const end = text.indexOf(c, i + 1);
			i = end < 0 ? text.length : end;
		} else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if (depth === 0 && text.startsWith(sep, i)) {
			out.push(text.slice(from, i).trim());
			from = i + sep.length;
			i += sep.length - 1;
		}
	}
	out.push(text.slice(from).trim());
	return out;
}

// ---------------------------------------------------------------- the host

/** An action a `perform` (or an action's type) names, with its steps. */
export interface Performed {
	name: string;
	steps: ActionStep[];
}

/** What a run needs from outside: its variables beyond the action's own, signals, other actions. */
export interface FlowHost {
	/** Variables outside the action (a state machine's), read when a name is not the action's own. */
	outer?: Scope;
	/** Set a variable outside the action; false when there is none of that name. */
	assignOuter?(step: StepOf<'assign'>, scope: Scope): boolean;
	/**
	 * Send a signal with its values. Return `queued` to keep it for the run's
	 * own `accept`s, else a few words on where it went.
	 */
	send(
		step: StepOf<'send'>,
		values: { name?: string; value: Value }[],
		scope: Scope
	): 'queued' | string;
	/** The action a `perform` or a typed action names. */
	resolve(target: string): Performed | null;
	/** The attributes of a signal, with their defaults. */
	signal?(name: string): { name: string; value?: unknown }[];
	/** Accepts wait in a run that can go on later; a body run in one go (`runBody`) cannot. */
	canWait: boolean;
	/** How to settle a decision with several guards holding: take the first written (and say so), or wait. */
	choose: 'first' | 'wait';
}

// ---------------------------------------------------------------- one step

/** Whether `event` names `signal`: exactly, or one with fewer qualifiers. */
export function signalMatches(signal: string, event: string): boolean {
	return signal === event || signal.endsWith(`::${event}`) || event.endsWith(`::${signal}`);
}

/** Everything a run touches while it takes a step. */
class Stepper {
	readonly vars = new Map<string, Value>();
	/** Paths declared (with or without a value). */
	readonly declared = new Set<string>();
	readonly events: FlowEvent[] = [];
	readonly notes: string[] = [];
	/** Variable → who set it this step (for the note on steps that set the same one). */
	private readonly writers = new Map<string, string[]>();
	private readonly ending: { frame: Frame; graph: FlowGraph; prefix: string; node: FlowNode }[] =
		[];
	private readonly exprs = new Map<string, Expr | null>();
	moved = false;

	constructor(
		readonly state: FlowState,
		readonly host: FlowHost
	) {
		for (const [k, v] of Object.entries(state.variables)) {
			const value = fromJson(v);
			if (value !== null) this.vars.set(k, value);
			this.declared.add(k);
		}
	}

	expr(text: string): Expr {
		let found = this.exprs.get(text);
		if (found === undefined) {
			try {
				found = parseExpr(text);
			} catch {
				found = null;
			}
			this.exprs.set(text, found);
		}
		if (!found) throw new EvalError(`\`${text}\` is not supported by the evaluator`);
		return found;
	}

	/** The path a name has from inside `prefix`: the innermost declared, else none. */
	find(prefix: string, name: string): string | null {
		const plain = name.replace(/^self\./, '');
		for (let p = prefix; ; p = parentPrefix(p)) {
			if (this.vars.has(p + plain) || this.declared.has(p + plain)) return p + plain;
			if (!p) break;
		}
		return null;
	}

	scope(prefix: string): Scope {
		const outer = this.host.outer;
		return {
			get: (name) => {
				const path = this.find(prefix, name);
				if (path !== null) return this.vars.get(path);
				return outer?.get(name);
			},
			isVariable: (name) =>
				this.find(prefix, name) !== null || (outer?.isVariable?.(name) ?? false),
			...(outer?.call ? { call: outer.call.bind(outer) } : {})
		};
	}

	set(path: string, value: Value, by: string) {
		const old = this.vars.get(path);
		if (old instanceof Quantity && typeof value === 'number') value = new Quantity(value, old.unit);
		else if (old instanceof Quantity && value instanceof Quantity && value.unit !== old.unit) {
			try {
				value = new Quantity(convert(value.value, value.unit, old.unit), old.unit);
			} catch {
				// Not convertible: keep the value as it came.
			}
		}
		this.vars.set(path, value);
		this.declared.add(path);
		this.wrote(path, by);
	}

	/** Note who set a variable this step (the run's own, or one outside the action). */
	wrote(path: string, by: string) {
		const list = this.writers.get(path) ?? [];
		list.push(by);
		this.writers.set(path, list);
	}

	/** Declare a body's parameters and attributes, with their values where the model gives them. */
	declare(graph: FlowGraph, prefix: string, bindings: StepOf<'feature'>[] = []) {
		const given = new Map(bindings.filter((b) => b.value).map((b) => [b.name, b]));
		for (const f of graph.features) {
			const path = prefix + f.name;
			this.declared.add(path);
			const source = given.get(f.name) ?? f;
			if (!source.value || this.vars.has(path)) continue;
			try {
				// A bound value reads the names around the action; a default may read its own.
				const scope = this.scope(source === f ? prefix : parentPrefix(prefix));
				this.vars.set(path, evaluate(this.expr(source.value), scope));
			} catch {
				// No value (yet): the run shows it unset.
			}
		}
	}

	note(node: string, text: string) {
		this.notes.push(text);
		this.events.push({ node, what: 'note', text });
	}

	// ------------------------------------------------------------ starting and ending

	/**
	 * Start a node: it runs from the next step, or from this one when `now`
	 * (the steps of an `if` or a loop begin as soon as it is tested). An
	 * action with steps of its own begins them at once.
	 */
	start(frame: Frame, graph: FlowGraph, prefix: string, node: FlowNode, now = false) {
		const running = frame.running[node.id];
		if (running) {
			running.again = (running.again ?? 0) + 1;
			return;
		}
		const run: NodeRun = { since: now ? this.state.step - 1 : this.state.step };
		frame.running[node.id] = run;
		this.moved = true;
		this.events.push({ node: prefix + node.id, what: 'started' });
		const step = node.step;
		if (step?.kind === 'accept') {
			const time = /^(after|at)\b\s*([\s\S]*)$/.exec(step.trigger);
			if (time) {
				try {
					const amount = seconds(evaluate(this.expr(time[2]!), this.scope(prefix)));
					run.due = time[1] === 'after' ? this.state.time + amount : amount;
				} catch (error) {
					run.due = (error as Error).message;
				}
			}
		}
		const body = this.bodyOf(node, prefix);
		if (body && (node.kind === 'action' || node.kind === 'perform')) {
			const inner = prefix + node.id + '.';
			this.declare(body.graph, inner, body.bindings);
			run.child = this.open(body.graph, inner, now);
		}
	}

	/** A frame for a body, its first nodes started. */
	open(graph: FlowGraph, prefix: string, now = false): Frame {
		const frame: Frame = { running: {} };
		for (const n of initialNodes(graph)) {
			if (n.kind === 'start') this.emit(frame, graph, prefix, n, now);
			else this.start(frame, graph, prefix, n, now);
		}
		return frame;
	}

	/** The steps an action, `perform` or typed action runs, and the values it binds. */
	bodyOf(
		node: FlowNode,
		prefix: string
	): { graph: FlowGraph; bindings: StepOf<'feature'>[] } | null {
		const step = node.step;
		if (step?.kind === 'action') {
			if (step.steps.some(isRunnable)) return { graph: graphOf(step.steps), bindings: [] };
			const bindings = step.steps.filter((s) => s.kind === 'feature');
			if (step.type) {
				const performed = this.host.resolve(step.type);
				if (performed) return { graph: graphOf(performed.steps), bindings };
			}
			return { graph: graphOf(step.steps), bindings: [] };
		}
		if (step?.kind === 'perform') {
			const performed = this.host.resolve(step.target);
			if (!performed) {
				this.note(
					prefix + node.id,
					`\`${step.text}\`: no action called \`${step.target}\` to perform`
				);
				return null;
			}
			return {
				graph: graphOf(performed.steps),
				bindings: step.steps.filter((s) => s.kind === 'feature')
			};
		}
		return null;
	}

	end(frame: Frame, graph: FlowGraph, prefix: string, node: FlowNode, text?: string) {
		const run = frame.running[node.id];
		delete frame.running[node.id];
		frame.ended = { ...frame.ended, [node.id]: (frame.ended?.[node.id] ?? 0) + 1 };
		this.moved = true;
		this.events.push({ node: prefix + node.id, what: 'ended', ...(text ? { text } : {}) });
		this.ending.push({ frame, graph, prefix, node });
		if (run?.again) {
			// It runs again for the token that came while it ran.
			this.ending.push({
				frame,
				graph,
				prefix,
				node: { ...node, id: `\u0000again:${node.id}:${run.again}` }
			});
		}
	}

	// ------------------------------------------------------------ tokens

	/**
	 * Pass the tokens of the nodes that ended this step on: those of one
	 * frame (before telling whether its action has ended), or all.
	 */
	passTokens(only?: Frame) {
		const now = only ? this.ending.filter((e) => e.frame === only) : [...this.ending];
		if (only)
			this.ending.splice(0, this.ending.length, ...this.ending.filter((e) => e.frame !== only));
		else this.ending.length = 0;
		for (let i = 0; i < now.length; i++) {
			const { frame, graph, prefix, node } = now[i]!;
			const again = /^\u0000again:(.*):(\d+)$/.exec(node.id);
			if (again) {
				const original = graph.nodes.find((n) => n.id === again[1])!;
				const left = Number(again[2]) - 1;
				this.start(frame, graph, prefix, original);
				if (left > 0) frame.running[original.id]!.again = left;
				continue;
			}
			this.flows(graph, prefix, node);
			this.emit(frame, graph, prefix, node);
		}
	}

	/** Carry values along the flows out of a node that ended. */
	private flows(graph: FlowGraph, prefix: string, node: FlowNode) {
		for (const e of graph.edges) {
			if (e.kind !== 'flow' || e.from !== node.id) continue;
			const from = prefix + e.from + (e.fromFeature ? `.${e.fromFeature}` : '');
			const to = prefix + e.to + (e.toFeature ? `.${e.toFeature}` : '');
			const value = this.vars.get(from);
			const what =
				value === undefined || value === null
					? `${e.item ?? 'a token'} (no value)`
					: display(value);
			if (value !== undefined && value !== null) this.set(to, value, `flow to ${to}`);
			this.events.push({
				node: prefix + node.id,
				what: 'took',
				text: `${e.text}: carries ${what}`,
				edge: `${prefix}#${e.index}`
			});
		}
	}

	/** A node's token goes along its successions. */
	emit(frame: Frame, graph: FlowGraph, prefix: string, node: FlowNode, now = false) {
		const out = outgoing(graph, node.id);
		if (node.kind === 'decide') {
			this.decide(frame, graph, prefix, node, undefined, now);
			return;
		}
		// Guarded successions out of other nodes: each one whose guard holds (or `else` when none does).
		const guarded = out.filter((e) => e.guard);
		let taken = out.filter((e) => !e.guard);
		if (guarded.length) {
			const { holding, unknown } = this.guards(guarded, prefix);
			for (const u of unknown) this.note(prefix + node.id, u);
			taken = [...taken, ...(holding.length ? holding : guarded.filter((e) => e.guard === 'else'))];
		}
		for (const e of taken) this.along(frame, graph, prefix, e, now);
	}

	/** The guards that hold, and why the ones that cannot be read cannot. */
	private guards(edges: FlowEdge[], prefix: string) {
		const holding: FlowEdge[] = [];
		const unknown: string[] = [];
		for (const e of edges) {
			if (!e.guard || e.guard === 'else') continue;
			try {
				if (evaluateCondition(this.expr(e.guard), this.scope(prefix))) holding.push(e);
			} catch (error) {
				unknown.push(`guard \`${e.guard}\`: ${(error as Error).message}`);
			}
		}
		return { holding, unknown };
	}

	/** A decision: exactly one branch, or the token waits there and the run says why. */
	decide(
		frame: Frame,
		graph: FlowGraph,
		prefix: string,
		node: FlowNode,
		chosen?: number,
		now = false
	) {
		const out = outgoing(graph, node.id);
		const path = prefix + node.id;
		let edge: FlowEdge | undefined =
			chosen === undefined ? undefined : out.find((e) => e.index === chosen);
		let note: string | null = null;
		if (!edge) {
			const { holding, unknown } = this.guards(out, prefix);
			const otherwise = out.filter((e) => !e.guard || e.guard === 'else');
			if (holding.length === 1 && !unknown.length) edge = holding[0];
			else if (holding.length > 1) {
				const names = holding.map((e) => `\`${e.guard}\``).join(' and ');
				if (this.host.choose === 'first') {
					edge = holding[0];
					note = `${label(node)}: ${names} all hold; SysML takes one of them, and the simulator took the first written`;
				} else {
					this.hold(frame, node, path, {
						reason: `${names} all hold: choose the branch to take`,
						choices: holding.map((e) => e.index)
					});
					return;
				}
			} else if (unknown.length) {
				this.hold(frame, node, path, { reason: unknown.join('; ') });
				return;
			} else if (otherwise.length) edge = otherwise[0];
			else {
				const guards = out.map((e) => `\`${e.guard}\``).join(', ');
				this.hold(frame, node, path, {
					reason: out.length
						? `no guard holds (${guards}) and there is no \`else\``
						: 'it has no branches'
				});
				return;
			}
		}
		if (frame.held?.[node.id]) {
			const { [node.id]: _, ...rest } = frame.held;
			frame.held = rest;
		}
		if (note) this.note(path, note);
		this.along(frame, graph, prefix, edge!, now);
	}

	private hold(frame: Frame, node: FlowNode, path: string, held: Held) {
		const before = frame.held?.[node.id];
		frame.held = { ...frame.held, [node.id]: held };
		if (before?.reason !== held.reason)
			this.events.push({ node: path, what: 'waits', text: held.reason });
	}

	/** A token goes along an edge into its target. */
	private along(frame: Frame, graph: FlowGraph, prefix: string, edge: FlowEdge, now = false) {
		const target = graph.nodes.find((n) => n.id === edge.to);
		if (!target) return;
		this.moved = true;
		this.events.push({
			node: prefix + edge.from,
			what: 'took',
			edge: `${prefix}#${edge.index}`,
			...(edge.guard ? { text: `[${edge.guard}]` } : {})
		});
		switch (target.kind) {
			case 'done':
				frame.done = true;
				return;
			case 'start':
				return;
			case 'fork':
			case 'merge':
				this.emit(frame, graph, prefix, target, now);
				return;
			case 'decide':
				this.decide(frame, graph, prefix, target, undefined, now);
				return;
			case 'join': {
				const arrived = [...new Set([...(frame.joins?.[target.id] ?? []), edge.index])];
				const needed = incoming(graph, target.id).map((e) => e.index);
				if (needed.every((i) => arrived.includes(i))) {
					const { [target.id]: _, ...rest } = frame.joins ?? {};
					frame.joins = rest;
					this.emit(frame, graph, prefix, target, now);
				} else frame.joins = { ...frame.joins, [target.id]: arrived };
				return;
			}
			default:
				this.start(frame, graph, prefix, target, now);
		}
	}

	// ------------------------------------------------------------ running

	/** End what can end in a frame (and the frames inside it), in the order written. */
	advance(frame: Frame, graph: FlowGraph, prefix: string, choices: Map<string, number>) {
		for (const node of graph.nodes) {
			const run = frame.running[node.id];
			if (!run || run.since === this.state.step) continue;
			this.advanceNode(frame, graph, prefix, node, run, choices);
			if (this.state.stopped) return;
		}
		// Decisions holding a token: values may have changed, or a person chose.
		for (const id of Object.keys(frame.held ?? {})) {
			const node = graph.nodes.find((n) => n.id === id);
			if (!node) continue;
			const chosen = choices.get(prefix + id);
			const held = frame.held![id]!;
			if (held.choices && chosen === undefined && this.host.choose === 'wait') continue;
			this.decide(frame, graph, prefix, node, chosen);
		}
	}

	private advanceNode(
		frame: Frame,
		graph: FlowGraph,
		prefix: string,
		node: FlowNode,
		run: NodeRun,
		choices: Map<string, number>
	) {
		const path = prefix + node.id;
		const step = node.step;
		const scope = this.scope(prefix);
		switch (step?.kind) {
			case 'assign': {
				const target = this.find(prefix, step.target);
				if (target === null && this.host.assignOuter?.(step, scope)) {
					this.wrote(step.target.replace(/^self\./, ''), step.text);
					this.end(frame, graph, prefix, node, step.text);
					return;
				}
				try {
					const value = evaluate(this.expr(step.value), scope);
					const at = target ?? step.target.replace(/^self\./, '');
					this.set(at, value, step.text);
					this.end(frame, graph, prefix, node, `${step.text} (${at} = ${display(value)})`);
				} catch (error) {
					this.note(path, `\`${step.text}\` was not run: ${(error as Error).message}`);
					this.end(frame, graph, prefix, node);
				}
				return;
			}
			case 'send': {
				try {
					const values = step.args.map((text) => {
						const named = /^([\w$]+)\s*=(?!=)\s*([\s\S]+)$/.exec(text);
						return {
							...(named ? { name: named[1]! } : {}),
							value: evaluate(this.expr(named ? named[2]! : text), scope)
						};
					});
					const where = this.host.send(step, values, scope);
					if (where === 'queued') this.queue(step, values, path);
					this.end(
						frame,
						graph,
						prefix,
						node,
						where === 'queued' ? step.text : `${step.text} (${where})`
					);
				} catch (error) {
					this.note(path, `\`${step.text}\` was not sent: ${(error as Error).message}`);
					this.end(frame, graph, prefix, node);
				}
				return;
			}
			case 'accept': {
				const taken = this.accept(step, run, prefix);
				if (taken) this.end(frame, graph, prefix, node, taken);
				return;
			}
			case 'if': {
				if (run.branch === undefined) {
					run.branch = -2;
					const steps = this.branchOf(step, scope, path, run);
					if (!steps) {
						this.end(frame, graph, prefix, node, `${shortIf(step)}: no branch`);
						return;
					}
					run.child = this.open(graphOf(steps), path + '.', true);
				}
				this.inside(frame, graph, prefix, node, run, choices);
				return;
			}
			case 'loop':
			case 'for': {
				if (!run.child) {
					if (!this.nextPass(step, run, path)) {
						this.end(frame, graph, prefix, node, `${shortIf(step)}: ${run.pass ?? 0} passes`);
						return;
					}
					if (this.state.stopped) return;
					run.child = this.open(graphOf(step.steps), path + '.', true);
				}
				this.advance(run.child, graphOf(step.steps), path + '.', choices);
				this.passTokens(run.child);
				if (finished(run.child)) {
					delete run.child;
					// `until` is tested after each pass (`LoopPerformance::untilDecision`).
					if (step.kind === 'loop' && step.until && this.test(step.until, scope, path) !== false) {
						this.end(frame, graph, prefix, node, `${shortIf(step)}: ${run.pass} passes`);
					}
				}
				return;
			}
			case 'action':
			case 'perform': {
				if (run.child) {
					this.inside(frame, graph, prefix, node, run, choices);
					return;
				}
				this.end(frame, graph, prefix, node);
				return;
			}
			case 'other':
				this.note(path, `\`${step.text}\` is not run`);
				this.end(frame, graph, prefix, node);
				return;
			default:
				// A named action with nothing to run: it takes one step.
				this.end(frame, graph, prefix, node);
		}
	}

	/** Advance an action's own steps; it ends when they have. */
	private inside(
		frame: Frame,
		graph: FlowGraph,
		prefix: string,
		node: FlowNode,
		run: NodeRun,
		choices: Map<string, number>
	) {
		const inner = this.childGraph(node, run);
		if (!inner || !run.child) {
			this.end(frame, graph, prefix, node);
			return;
		}
		this.advance(run.child, inner, prefix + node.id + '.', choices);
		this.passTokens(run.child);
		if (finished(run.child)) this.end(frame, graph, prefix, node);
	}

	/** The graph a running node's frame runs. */
	childGraph(node: FlowNode, run: NodeRun): FlowGraph | null {
		const step = node.step;
		if (step?.kind === 'if') {
			const steps =
				run.branch === -1
					? step.otherwise
					: run.branch !== undefined && run.branch >= 0
						? step.branches[run.branch]?.steps
						: null;
			return steps ? graphOf(steps) : null;
		}
		if (step?.kind === 'loop' || step?.kind === 'for') return graphOf(step.steps);
		return this.resolveQuietly(node);
	}

	private resolveQuietly(node: FlowNode): FlowGraph | null {
		const step = node.step;
		if (step?.kind === 'action') {
			if (step.steps.some(isRunnable) || !step.type) return graphOf(step.steps);
			const performed = this.host.resolve(step.type);
			return performed ? graphOf(performed.steps) : graphOf(step.steps);
		}
		if (step?.kind === 'perform') {
			const performed = this.host.resolve(step.target);
			return performed ? graphOf(performed.steps) : null;
		}
		return null;
	}

	/** An `if`'s branch: the first whose condition holds, else `else`. */
	private branchOf(
		step: StepOf<'if'>,
		scope: Scope,
		path: string,
		run: NodeRun
	): ActionStep[] | null {
		for (const [i, b] of step.branches.entries()) {
			const holds = this.test(b.condition, scope, path);
			if (holds === null) return null;
			if (holds) {
				run.branch = i;
				return b.steps;
			}
		}
		run.branch = -1;
		return step.otherwise;
	}

	/** A condition's value; null (with a note) when it cannot be read. */
	private test(condition: string, scope: Scope, path: string): boolean | null {
		try {
			return evaluateCondition(this.expr(condition), scope);
		} catch (error) {
			this.note(path, `\`${condition}\` could not be read: ${(error as Error).message}`);
			return null;
		}
	}

	/** Whether a loop makes another pass; binds a `for` loop's variable. */
	private nextPass(step: StepOf<'loop'> | StepOf<'for'>, run: NodeRun, path: string): boolean {
		const scope = this.scope(path + '.');
		if (step.kind === 'for') {
			if (run.items === undefined) {
				try {
					run.items = sequence(step.collection, this.scope(parentPrefix(path + '.')), (t) =>
						this.expr(t)
					).map(toJson);
				} catch (error) {
					this.note(
						path,
						`\`for ${step.variable} in ${step.collection}\`: ${(error as Error).message}`
					);
					return false;
				}
			}
			const next = run.items.shift();
			if (next === undefined) return false;
			this.declared.add(`${path}.${step.variable}`);
			this.vars.set(`${path}.${step.variable}`, fromJson(next));
		} else if (step.condition && this.test(step.condition, scope, path) !== true) return false;
		run.pass = (run.pass ?? 0) + 1;
		if (run.pass > LOOP_LIMIT) {
			this.state.stopped = `${shortIf(step)} ran ${LOOP_LIMIT} times; the run stops here in case it never ends`;
			this.note(path, this.state.stopped);
			return false;
		}
		return true;
	}

	/** Take the signal, time or condition an `accept` waits for; what it took, or null. */
	private accept(step: StepOf<'accept'>, run: NodeRun, prefix: string): string | null {
		const trigger = step.trigger;
		if (/^(after|at)\b/.test(trigger)) {
			return typeof run.due === 'number' && run.due <= this.state.time ? trigger : null;
		}
		const when = /^when\b\s*([\s\S]+)$/.exec(trigger);
		if (when) {
			try {
				return evaluateCondition(this.expr(when[1]!), this.scope(prefix)) ? trigger : null;
			} catch {
				return null;
			}
		}
		const at = this.state.queue.findIndex((q) => signalMatches(q.signal, trigger));
		if (at < 0) return null;
		const [signal] = this.state.queue.splice(at, 1);
		if (step.payload) {
			// The accepted signal's values, by the name it is given (`r.v`).
			const base = `${prefix}${step.payload}`;
			this.declared.add(base);
			for (const a of this.host.signal?.(signal!.signal) ?? []) {
				if (typeof a.value !== 'string') continue;
				try {
					this.vars.set(`${base}.${a.name}`, evaluate(this.expr(a.value), this.scope(prefix)));
				} catch {
					// No default.
				}
			}
			for (const [k, v] of Object.entries(signal!.values ?? {}))
				this.vars.set(`${base}.${k}`, fromJson(v));
		}
		return `accepted ${signal!.signal}`;
	}

	private queue(step: StepOf<'send'>, values: { name?: string; value: Value }[], from: string) {
		const attributes = this.host.signal?.(step.signal) ?? [];
		const named: Record<string, unknown> = {};
		values.forEach((v, i) => {
			const name = v.name ?? attributes[i]?.name;
			if (name) named[name] = toJson(v.value);
		});
		this.state.queue.push({
			signal: step.signal,
			...(Object.keys(named).length ? { values: named } : {}),
			from
		});
	}

	/** Notes on variables two steps set in the same step: SysML leaves their order open. */
	conflicts() {
		for (const [path, by] of this.writers) {
			const distinct = [...new Set(by)];
			if (distinct.length < 2) continue;
			const value = this.vars.get(path);
			this.notes.push(
				`${distinct.map((b) => `\`${b}\``).join(' and ')} set \`${path}\` in the same step; no succession orders them, so SysML leaves the order open: the simulator ran them in the order written, leaving ${value === undefined ? 'no value' : display(value)}`
			);
		}
	}

	/** Keep the values in the state; paths declared without one are kept, unset. */
	save() {
		const out: Record<string, unknown> = {};
		for (const path of this.declared) out[path] = null;
		for (const [k, v] of this.vars) out[k] = toJson(v);
		this.state.variables = out;
	}
}

const parentPrefix = (prefix: string) => {
	if (!prefix) return '';
	const inner = prefix.slice(0, -1);
	const at = inner.lastIndexOf('.');
	return at < 0 ? '' : inner.slice(0, at + 1);
};

const label = (node: FlowNode) => node.label || node.id;

function shortIf(step: ActionStep): string {
	const text = step.text.replace(/\s*\{[\s\S]*$/, '');
	return text.length > 40 ? `${text.slice(0, 38)}…` : text;
}

/** A time or duration in seconds (a bare number counts seconds). */
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

/** Whether a frame has nothing left to do: nothing running, no token held or waiting at a join. */
export function finished(frame: Frame): boolean {
	if (Object.keys(frame.running).length || Object.keys(frame.held ?? {}).length) return false;
	if (frame.done) return true;
	// Tokens waiting at a join that can no longer come: not finished (the run is stuck).
	return !Object.keys(frame.joins ?? {}).length;
}

// ---------------------------------------------------------------- the public API

export interface StepResult {
	state: FlowState;
	events: FlowEvent[];
	notes: string[];
	/** Something ended, started or moved. */
	moved: boolean;
}

/** Start a run of a body: its variables declared, its first nodes started. */
export function begin(
	graph: FlowGraph,
	host: FlowHost,
	variables: Record<string, unknown> = {}
): StepResult {
	const state: FlowState = { step: 0, time: 0, root: { running: {} }, variables, queue: [] };
	const s = new Stepper(state, host);
	s.declare(graph, '');
	state.root = s.open(graph, '');
	s.passTokens();
	s.save();
	return { state, events: s.events, notes: s.notes, moved: true };
}

/**
 * One step: what can end ends (in the order written), then the tokens go
 * on. `choices` settles decisions waiting for a person (by the decision's
 * path, the edge to take). When nothing could move, time passes to the
 * next `accept after`/`at` that is due, and the step is taken then.
 */
export function advance(
	graph: FlowGraph,
	host: FlowHost,
	previous: FlowState,
	choices: Map<string, number> = new Map()
): StepResult {
	const state: FlowState = structuredClone(previous);
	state.step++;
	let s = new Stepper(state, host);
	s.advance(state.root, graph, '', choices);
	s.passTokens();
	if (!s.moved && !state.stopped) {
		const due = nextDue(state.root, graph, s);
		if (due !== null && due > state.time) {
			const retry: FlowState = structuredClone(previous);
			retry.step++;
			retry.time = due;
			s = new Stepper(retry, host);
			s.advance(retry.root, graph, '', choices);
			s.passTokens();
			s.conflicts();
			s.save();
			return { state: retry, events: s.events, notes: s.notes, moved: s.moved };
		}
	}
	s.conflicts();
	s.save();
	return { state, events: s.events, notes: s.notes, moved: s.moved };
}

/** The earliest `accept after`/`at` due in a frame and the frames inside it. */
function nextDue(frame: Frame, graph: FlowGraph, s: Stepper): number | null {
	let best: number | null = null;
	for (const node of graph.nodes) {
		const run = frame.running[node.id];
		if (!run) continue;
		if (typeof run.due === 'number') best = best === null ? run.due : Math.min(best, run.due);
		if (run.child) {
			const inner = s.childGraph(node, run);
			const due = inner ? nextDue(run.child, inner, s) : null;
			if (due !== null) best = best === null ? due : Math.min(best, due);
		}
	}
	return best;
}

/** A node somewhere in a run, with the frame it is in. */
export interface Placed {
	path: string;
	node: FlowNode;
	frame: Frame;
	graph: FlowGraph;
	run: NodeRun | null;
}

/** Every running node and every held decision, depth first. */
export function placed(graph: FlowGraph, frame: Frame, host: FlowHost, prefix = ''): Placed[] {
	const s = new Stepper({ step: 0, time: 0, root: frame, variables: {}, queue: [] }, host);
	const out: Placed[] = [];
	const visit = (f: Frame, g: FlowGraph, p: string) => {
		for (const node of g.nodes) {
			const run = f.running[node.id];
			if (run) {
				out.push({ path: p + node.id, node, frame: f, graph: g, run });
				if (run.child) {
					const inner = s.childGraph(node, run);
					if (inner) visit(run.child, inner, p + node.id + '.');
				}
			} else if (f.held?.[node.id])
				out.push({ path: p + node.id, node, frame: f, graph: g, run: null });
		}
	};
	visit(frame, graph, prefix);
	return out;
}

/** The graph of a performed or nested body, found by its path from the root (`perform#1.descend`). */
export function graphAt(
	graph: FlowGraph,
	root: Frame,
	path: string,
	host: FlowHost
): { graph: FlowGraph; frame: Frame } | null {
	if (!path) return { graph, frame: root };
	const s = new Stepper({ step: 0, time: 0, root, variables: {}, queue: [] }, host);
	let g = graph;
	let f = root;
	let prefix = '';
	for (const id of splitPath(path)) {
		const node = g.nodes.find((n) => n.id === id);
		const run = f.running[id];
		if (!node || !run?.child) return null;
		const inner = s.childGraph(node, run);
		if (!inner) return null;
		g = inner;
		f = run.child;
		prefix += id + '.';
	}
	return { graph: g, frame: f };
}

/** A path's node ids (ids may contain `#` but not `.`; quoted names are kept whole). */
export function splitPath(path: string): string[] {
	return path.match(/'[^']*'|[^.]+/g) ?? [];
}

// ---------------------------------------------------------------- a body in one go

/** At most this many steps for a body run in one go (`runBody`). */
export const BODY_STEPS = 10_000;

/**
 * Run a body to its end in one go, as a state's entry, `do` or exit action
 * or a transition's effect runs within one step of the machine. It cannot
 * wait: an `accept` ends the run there (the steps after it are not run),
 * and a decision with several guards holding takes the first written. Notes
 * say what happened that the model may not expect.
 */
export function runBody(steps: ActionStep[], host: Omit<FlowHost, 'canWait' | 'choose'>): string[] {
	const full: FlowHost = { ...host, canWait: false, choose: 'first' };
	const graph = graphOf(steps);
	const notes = [...graph.notes];
	let { state } = begin(graph, full);
	for (let i = 0; i < BODY_STEPS; i++) {
		if (finished(state.root) || state.stopped) break;
		const next = advance(graph, full, state);
		notes.push(...next.notes);
		state = next.state;
		if (!next.moved) {
			const waiting = placed(graph, state.root, full)
				.filter((p) => p.node.kind === 'accept')
				.map((p) => `\`${p.node.step!.text}\``);
			const held = placed(graph, state.root, full)
				.filter((p) => !p.run && p.frame.held?.[p.node.id])
				.map((p) => `${label(p.node)}: ${p.frame.held![p.node.id]!.reason}`);
			if (waiting.length)
				notes.push(
					`${waiting.join(' and ')} waits for a signal; the action runs within one step of the machine, so it does not wait, and the steps after it were not run`
				);
			notes.push(...held);
			break;
		}
	}
	return [...new Set(notes)];
}

export { parseAction };
