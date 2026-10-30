/**
 * Running an action flow step by step, as the emulator runs a state
 * machine: a JSON-friendly `FlowSession` (the run's state and its
 * timeline), the moves a person can make (Step, send an awaited signal,
 * choose a decision's branch), what the run waits for, and what it cannot
 * run, said before it starts. The semantics are `flow.ts`'s.
 *
 * Performed actions (`perform drone.deliveryFlight`) and actions typed by a
 * definition (`action fly : FlyTo;`) run the steps of the action they name,
 * found among the project's actions (`ActionFlow[]`).
 */
import type { ActionFlow } from '#lib/engine/types.ts';
import { allSteps, parseAction, type ActionStep } from './actions.ts';
import { parseExpr } from './expr.ts';
import {
	advance,
	begin,
	finished,
	graphAt,
	graphOf,
	placed,
	signalMatches,
	splitPath,
	type FlowEvent,
	type FlowGraph,
	type FlowHost,
	type FlowNode,
	type FlowState,
	type Performed
} from './flow.ts';

/** A run stops after this many steps, so auto-run cannot go on forever. */
export const MAX_STEPS = 10_000;

export type FlowStatus =
	'running' | 'waiting' | 'completed' | 'stuck' | 'stopped' | 'max steps reached';

export interface FlowTraceStep {
	step: number;
	/** Seconds since the start. */
	time: number;
	/** Why it happened: `Step`, `TakeOffCommand sent`, `chose …`, `time passed to 5 s`. */
	cause: string;
	events: FlowEvent[];
	notes?: string[];
}

export interface FlowSession {
	flow: string;
	state: FlowState;
	status: FlowStatus;
	trace: FlowTraceStep[];
	/** What the last move could not do. */
	messages?: string[];
}

export type FlowMove =
	| { step: true }
	/** Send the run a signal (an `accept` waits for it), then step. */
	| { signal: string }
	/** Take this branch (edge index) at a decision waiting for a choice (by its path); `auto`: auto-run chose. */
	| { choose: string; edge: number; auto?: boolean };

export interface Waiting {
	path: string;
	/** `deliveryFlight › descend`. */
	label: string;
	kind: FlowNode['kind'];
	/** What it waits for, or null when it ends on the next Step. */
	waits: string | null;
}

export interface Choice {
	path: string;
	label: string;
	reason: string;
	options: { edge: number; text: string }[];
}

export interface Outlook {
	/** Running steps and what each waits for. */
	running: Waiting[];
	/** Signals running `accept`s wait for. */
	signals: string[];
	/** Decisions waiting for a person to choose. */
	choices: Choice[];
	/** What cannot go on, and why (a decision no guard of which holds, a join missing a token). */
	blocked: { path: string; label: string; reason: string }[];
	/** A Step would move something (time passing to the next `accept after` included). */
	canStep: boolean;
	/** When nothing moves now: when the next timed `accept` is due. */
	next: number | null;
}

export interface FlowVariable {
	/** Its path: `flightPlan`, `checkDropZone.isClear`. */
	path: string;
	type: string | null;
	direction: string | null;
	value: unknown;
}

/** One action flow, ready to run: its graph, and how its steps reach other actions and signals. */
export class FlowRunner {
	readonly graph: FlowGraph;
	readonly host: FlowHost;
	private readonly parsed = new Map<string, Performed | null>();

	constructor(
		readonly flow: ActionFlow,
		readonly flows: readonly ActionFlow[]
	) {
		this.graph = graphOf(this.stepsOf(flow));
		this.host = {
			canWait: true,
			choose: 'wait',
			resolve: (target) => this.resolve(target),
			signal: (name) => this.signal(name),
			send: (step) => {
				const to = step.to?.replace(/\s+/g, '');
				if (!to || to === 'self' || to === 'this') return 'queued';
				return `sent to ${to}, outside this action`;
			}
		};
	}

	/** The steps of an action: its own, else its definition's. */
	private stepsOf(flow: ActionFlow, seen = new Set<ActionFlow>()): ActionStep[] {
		const own = parseAction(flow.body);
		if (own.some((s) => !['feature', 'declaration'].includes(s.kind)) || !flow.type) return own;
		seen.add(flow);
		const def = this.find(flow.type);
		return def && !seen.has(def) ? [...own, ...this.stepsOf(def, seen)] : own;
	}

	/** An action by qualified name, by name, or by the last part of a path (`drone.deliveryFlight`). */
	find(target: string): ActionFlow | undefined {
		return findAction(this.flows, target);
	}

	private resolve(target: string): Performed | null {
		if (!this.parsed.has(target)) {
			const found = this.find(target);
			this.parsed.set(
				target,
				found ? { name: found.qualifiedName ?? found.name, steps: this.stepsOf(found) } : null
			);
		}
		return this.parsed.get(target)!;
	}

	private signal(name: string) {
		for (const f of this.flows) {
			for (const [key, attributes] of Object.entries(f.signals ?? {})) {
				if (signalMatches(key, name)) return attributes;
			}
		}
		return [];
	}

	// ------------------------------------------------------------ moves

	start(variables: Record<string, unknown> = {}): FlowSession {
		const { state, events, notes } = begin(this.graph, this.host, variables);
		const trace: FlowTraceStep[] = [
			{ step: 0, time: 0, cause: 'start', events, ...(notes.length ? { notes } : {}) }
		];
		return this.settle({
			flow: this.flow.qualifiedName ?? this.flow.name,
			state,
			status: 'running',
			trace
		});
	}

	/** Take a move; `variables` are values the person changed since the last one. */
	move(session: FlowSession, move: FlowMove, variables: Record<string, unknown> = {}): FlowSession {
		if (
			session.status === 'completed' ||
			session.status === 'stopped' ||
			session.status === 'max steps reached'
		) {
			return { ...session, messages: ['The run has ended. Restart to run it again.'] };
		}
		const before: FlowState = {
			...session.state,
			variables: { ...session.state.variables, ...variables },
			queue: [...session.state.queue]
		};
		for (const [k, v] of Object.entries(variables)) if (v === null) delete before.variables[k];
		let cause = 'Step';
		const choices = new Map<string, number>();
		if ('signal' in move) {
			const awaited = this.outlook({ ...session, state: before }).signals;
			if (!awaited.some((s) => signalMatches(s, move.signal))) {
				return { ...session, messages: [`Nothing waits for \`${move.signal}\` now.`] };
			}
			before.queue.push({ signal: move.signal, from: 'you' });
			cause = `${move.signal} sent`;
		} else if ('choose' in move) {
			choices.set(move.choose, move.edge);
			const edge = this.edgeText(move.choose, move.edge, session);
			cause = move.auto
				? `auto-run chose ${edge}: several guards hold, and auto-run takes the first written`
				: `chose ${edge}`;
		}
		const result = advance(this.graph, this.host, before, choices);
		const state = result.state;
		if (!result.moved) {
			return {
				...session,
				state: { ...session.state, variables: before.variables },
				messages: ['Nothing can happen now.']
			};
		}
		if (state.time > before.time) cause = `${cause}: time passed to ${state.time} s`;
		const trace = [
			...session.trace,
			{
				step: state.step,
				time: state.time,
				cause,
				events: result.events,
				...(result.notes.length ? { notes: result.notes } : {})
			}
		];
		return this.settle({ ...session, state, trace, messages: [] });
	}

	private edgeText(path: string, edge: number, session: FlowSession): string {
		const ids = splitPath(path);
		const at = graphAt(this.graph, session.state.root, ids.slice(0, -1).join('.'), this.host);
		const e = at?.graph.edges.find((x) => x.index === edge);
		return e ? `${e.guard ? `[${e.guard}] ` : ''}${e.to}` : `branch ${edge}`;
	}

	private settle(session: FlowSession): FlowSession {
		const { state } = session;
		let status: FlowStatus;
		if (state.stopped) status = 'stopped';
		else if (finished(state.root)) status = 'completed';
		else if (state.step >= MAX_STEPS) status = 'max steps reached';
		else {
			const o = this.outlook(session);
			status = o.canStep ? 'running' : o.signals.length || o.choices.length ? 'waiting' : 'stuck';
		}
		return { ...session, status };
	}

	// ------------------------------------------------------------ what the run waits for

	/** A path said with labels: `perform#1.descend` → `drone.deliveryFlight › descend`. */
	label(path: string, root = this.graph, frame?: FlowState['root']): string {
		const ids = splitPath(path);
		const parts: string[] = [];
		let graph: FlowGraph | null = root;
		for (let i = 0; i < ids.length && graph; i++) {
			const node = graph.nodes.find((n) => n.id === ids[i]);
			parts.push(node ? node.label || node.id : ids[i]!);
			const at = frame
				? graphAt(this.graph, frame, ids.slice(0, i + 1).join('.'), this.host)
				: null;
			graph = at?.graph ?? null;
		}
		return parts.join(' › ');
	}

	outlook(session: FlowSession): Outlook {
		const { state } = session;
		const all = placed(this.graph, state.root, this.host);
		const running: Waiting[] = [];
		const signals: string[] = [];
		const choices: Choice[] = [];
		const blocked: Outlook['blocked'] = [];
		let next: number | null = null;
		for (const p of all) {
			const label = this.label(p.path, this.graph, state.root);
			if (!p.run) {
				const held = p.frame.held![p.node.id]!;
				if (held.choices) {
					choices.push({
						path: p.path,
						label,
						reason: held.reason,
						options: held.choices.map((edge) => {
							const e = p.graph.edges.find((x) => x.index === edge)!;
							const to = p.graph.nodes.find((n) => n.id === e.to);
							return { edge, text: `[${e.guard}] ${to?.label || e.to}` };
						})
					});
				} else blocked.push({ path: p.path, label, reason: held.reason });
				continue;
			}
			let waits: string | null = null;
			const step = p.node.step;
			if (step?.kind === 'accept') {
				const timed = /^(after|at)\b/.test(step.trigger);
				const when = /^when\b/.test(step.trigger);
				if (timed) {
					if (typeof p.run.due === 'string') waits = `${step.trigger}: ${p.run.due}`;
					else if ((p.run.due ?? 0) > state.time) {
						waits = `${step.trigger} (due at ${p.run.due} s)`;
						next = next === null ? p.run.due! : Math.min(next, p.run.due!);
					}
				} else if (when) waits = step.trigger;
				else if (!state.queue.some((q) => signalMatches(q.signal, step.trigger))) {
					waits = `the signal ${step.trigger}`;
					if (!signals.includes(step.trigger)) signals.push(step.trigger);
				}
			}
			if (p.run.child) waits = 'its own steps';
			running.push({ path: p.path, label, kind: p.node.kind, waits });
		}
		// Joins holding some of their tokens, with nothing left running in their frame.
		const visitJoins = (graph: FlowGraph, frame: FlowState['root'], prefix: string) => {
			for (const [id, arrived] of Object.entries(frame.joins ?? {})) {
				const needed = graph.edges.filter((e) => e.to === id && e.orders);
				const missing = needed.filter((e) => !arrived.includes(e.index)).map((e) => e.from);
				if (!Object.keys(frame.running).length)
					blocked.push({
						path: prefix + id,
						label: this.label(prefix + id, this.graph, state.root),
						reason: `waits for ${missing.join(' and ')}, which will not come`
					});
			}
			for (const [id, run] of Object.entries(frame.running)) {
				if (!run.child) continue;
				const at = graphAt(this.graph, state.root, prefix + id, this.host);
				if (at) visitJoins(at.graph, run.child, `${prefix}${id}.`);
			}
		};
		visitJoins(this.graph, state.root, '');
		const dry =
			finished(state.root) || state.stopped ? null : advance(this.graph, this.host, state);
		return { running, signals, choices, blocked, canStep: !!dry?.moved, next };
	}

	// ------------------------------------------------------------ before the run

	/** What the run will not do as the model says, named before it starts. */
	unsupported(): string[] {
		const out: string[] = [];
		const seen = new Set<ActionStep[]>();
		const visit = (steps: ActionStep[], where: string) => {
			if (seen.has(steps)) return;
			seen.add(steps);
			for (const note of graphOf(steps).notes) out.push(`${where}: ${note}`);
			for (const s of allSteps(steps)) {
				if (s.kind === 'other') out.push(`${where}: \`${s.text}\` is not run`);
				else if (s.kind === 'send') {
					const to = s.to?.replace(/\s+/g, '');
					if (to && to !== 'self' && to !== 'this')
						out.push(
							`${where}: \`${s.text}\` goes to ${to}, outside this action: the run shows it sent, and nothing here receives it`
						);
				} else if (
					s.kind === 'perform' ||
					(s.kind === 'action' && s.type && !s.steps.some(isStep))
				) {
					const target = s.kind === 'perform' ? s.target : s.type!;
					const found = this.resolve(target);
					if (found) visit(found.steps, found.name.split('::').pop()!);
					else if (s.kind === 'perform')
						out.push(
							`${where}: \`${s.text}\`: no action called \`${target}\`, so it runs as one step`
						);
				}
				for (const text of expressions(s)) {
					if (!parses(text)) out.push(`${where}: \`${text}\` is not supported by the evaluator`);
				}
				if (s.kind === 'flow' || s.kind === 'succession') {
					if (s.kind === 'succession' && s.guard && s.guard !== 'else' && !parses(s.guard))
						out.push(`${where}: guard \`${s.guard}\` is not supported by the evaluator`);
				}
			}
		};
		visit(this.stepsOf(this.flow), this.flow.name);
		return [...new Set(out)];
	}

	/** The variables to show: the action's parameters and attributes, its steps', and any the run set. */
	variables(session: FlowSession | null): FlowVariable[] {
		const rows = new Map<string, FlowVariable>();
		const add = (graph: FlowGraph, prefix: string, depth: number) => {
			for (const f of graph.features) {
				rows.set(prefix + f.name, {
					path: prefix + f.name,
					type: f.type,
					direction: f.direction,
					value: null
				});
			}
			if (depth > 3) return;
			for (const n of graph.nodes) {
				const step = n.step;
				if (step?.kind === 'action' || step?.kind === 'perform') {
					const inner =
						step.kind === 'perform'
							? this.resolve(step.target)
							: step.steps.some(isStep) || !step.type
								? { name: n.id, steps: step.steps }
								: this.resolve(step.type);
					if (inner) add(graphOf(inner.steps), `${prefix}${n.id}.`, depth + 1);
				}
			}
		};
		add(this.graph, '', 0);
		for (const [path, value] of Object.entries(session?.state.variables ?? {})) {
			const row = rows.get(path);
			if (row) row.value = value;
			else if (!/[#]/.test(path)) rows.set(path, { path, type: null, direction: null, value });
		}
		return [...rows.values()];
	}
}

const isStep = (s: ActionStep) =>
	!['feature', 'declaration', 'first', 'succession', 'flow'].includes(s.kind);

/** The expressions a step evaluates. */
function expressions(s: ActionStep): string[] {
	switch (s.kind) {
		case 'assign':
			return [s.value];
		case 'if':
			return s.branches.map((b) => b.condition);
		case 'loop':
			return [s.condition, s.until].filter((x): x is string => !!x);
		case 'accept': {
			const m = /^(?:when|after|at)\b\s*([\s\S]+)$/.exec(s.trigger);
			return m ? [m[1]!] : [];
		}
		default:
			return [];
	}
}

function parses(text: string): boolean {
	try {
		parseExpr(text);
		return true;
	} catch {
		return false;
	}
}

/** An action by qualified name, by name, or by the last part of a path (`drone.deliveryFlight`). */
export function findAction(flows: readonly ActionFlow[], target: string): ActionFlow | undefined {
	const name = target.replace(/\s+/g, '');
	const last = name.split(/::|\./).pop()!;
	const qualified = name.includes('::') ? name : null;
	return (
		(qualified && flows.find((f) => f.qualifiedName === qualified)) ||
		flows.find((f) => f.qualifiedName === name) ||
		flows.find((f) => f.name === name) ||
		flows.find((f) => f.name === last) ||
		(qualified ? flows.find((f) => f.qualifiedName?.endsWith(`::${last}`)) : undefined)
	);
}

/**
 * The steps an action runs, as text: its own, else (a usage with none,
 * `perform action fly : DeliveryFlight;`) its definition's.
 */
export function bodyText(flows: readonly ActionFlow[], flow: ActionFlow): string {
	const seen = new Set<ActionFlow>();
	let at: ActionFlow | undefined = flow;
	let text = flow.body;
	while (at && !seen.has(at)) {
		seen.add(at);
		const own = parseAction(at.body);
		if (own.some((s) => !['feature', 'declaration'].includes(s.kind)) || !at.type) break;
		at = findAction(flows, at.type);
		if (at && !seen.has(at)) text = `${text}\n${at.body}`;
	}
	return text;
}

/** The runners of a list of actions, kept while the list is the same. */
const runners = new WeakMap<ActionFlow, FlowRunner>();

export function runnerFor(flow: ActionFlow, flows: readonly ActionFlow[]): FlowRunner {
	let runner = runners.get(flow);
	if (!runner || runner.flows !== flows) {
		runner = new FlowRunner(flow, flows);
		runners.set(flow, runner);
	}
	return runner;
}

/** The action a tab names: by qualified name, else by simple name. */
export function findFlow(flows: readonly ActionFlow[], name: string): ActionFlow | undefined {
	return (
		flows.find((f) => (f.qualifiedName ?? f.name) === name) ??
		flows.find((f) => f.name === name || f.qualifiedName?.endsWith(`::${name}`))
	);
}

/** Auto-run's next move: a Step when one can happen, else the first awaited signal or choice. */
export function autoMove(outlook: Outlook): FlowMove | null {
	if (outlook.canStep) return { step: true };
	const choice = outlook.choices[0];
	if (choice) return { choose: choice.path, edge: choice.options[0]!.edge, auto: true };
	return null;
}
