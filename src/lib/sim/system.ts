/**
 * Several parts' state machines run together, on one clock, with the
 * signals they send each other delivered along the connections between
 * their ports: pure functions over a `MachineSystem` (`toolkit/systems.ts`)
 * and a JSON-friendly `SystemSession`. Each part's machine runs as the
 * single-machine emulator runs it (`emulator.ts`, with `outward` so the
 * signals it sends elsewhere come out in `session.sent`).
 *
 * Delivery (SysML v2 Kernel Semantic Library `Transfers`, Systems Library
 * `Ports`; `docs/simulator.md` says more):
 * - `send S via p` is a `SendPerformance` whose sender is the port `p`: a
 *   port's outgoing transfers go to the ports connected to it by an
 *   interface or connection (`Port::outgoingTransfersFromSelf`), so the
 *   signal goes along each connection of `p` (and of the names a `bind`
 *   makes the same port) to the port at the other end, and to the part
 *   that port belongs to.
 * - `send S to x` names its receiver (`SendPerformance::receiver`): the
 *   signal goes to the part `x` (or to the part whose port `x` is).
 * - Each part keeps its own queue of the signals that came to it
 *   (`incomingTransfers`), taken one per step in the order they arrived
 *   (`earlierFirstIncomingTransferSort`), after what is ready without a
 *   signal, exactly as signals a machine sends itself.
 * - A signal arrives after it is sent (`succession self then
 *   sentTransfer`): a part takes it on a later Step, not in the step that
 *   sent it, and at the same simulated time (the model gives transfers no
 *   duration).
 * - `accept S via p` takes S only if it came in at `p`; `accept S` takes it
 *   whichever of its part's ports it came in at.
 * - A signal no transition of its receiver accepts is dropped when its
 *   turn comes; one that reaches no part with a machine (a port connected
 *   to nothing, a part without a state machine, a machine that has
 *   finished) is lost when sent. The timeline says which.
 *
 * Steps: a Step takes one run-to-completion step in every part that has
 * something ready now (a transition without a trigger, a condition that
 * holds, a timer that is due, a signal waiting), in the order the parts are
 * written; the parts run at the same time, so that order changes nothing
 * but the order of the timeline. When no part has anything ready, time
 * passes for all of them to the earliest time something comes due in any
 * of them. A Wait goes on like that up to its time.
 */
import type { MachineSystem, SimStep, StateMachine, StateSession } from '#lib/engine/types.ts';
import {
	WAIT_STEPS,
	advance,
	start as startMachine,
	step as stepMachine,
	withVariables,
	type Variables
} from './emulator.ts';
import { isEventTrigger } from './model.ts';
import { formatDuration } from './units.ts';

type Sent = NonNullable<StateSession['sent']>[number];

/** One line of the shared timeline. */
export type SystemEvent =
	/** A part's machine took a step (step 0: it started). */
	| { kind: 'step'; part: string; time: number; step: SimStep }
	/** A part sent a signal to another part, or it was lost on the way. */
	| {
			kind: 'signal';
			time: number;
			from: string;
			signal: string;
			values?: Record<string, unknown>;
			/** The port it went out through. */
			via?: string;
			/** The part it reached, and the port it came in at. */
			to?: string;
			port?: string;
			/** Why it reached no machine. */
			lost?: string;
	  }
	/** Something a part could not do (a signal it dropped, a timer lost). */
	| { kind: 'note'; part: string; time: number; text: string };

export interface SystemSession {
	system: string;
	/** Simulated time, seconds since the start: every part's. */
	time: number;
	/** Transitions fired, all parts together. */
	step: number;
	/** Each part's machine, by part path. */
	parts: Record<string, StateSession>;
	timeline: SystemEvent[];
	status: 'running' | 'completed' | 'deadlocked' | 'max steps reached';
	messages?: string[];
}

/** Variable changes, by part path. */
export type PartVariables = Record<string, Variables>;

export type SystemChoice =
	/** Send an event to one part, from outside (as the single-machine emulator does). */
	| { part: string; event: string; payload?: Variables; variables?: PartVariables }
	/** A Step: every part with something ready now takes one step; else time passes to the next due. */
	| { step: true; variables?: PartVariables }
	/** Let time pass, by this many seconds or to the next due, taking what comes on the way. */
	| { wait: number | 'next'; variables?: PartVariables };

export interface SystemOptions {
	/** Stop with status `max steps reached` once this many transitions have fired, all parts together. */
	maxSteps?: number;
}

// ---------------------------------------------------------------- routing

/** Union-find over port paths: a binding makes two names one port. */
class Ports {
	private readonly parent = new Map<string, string>();
	find(p: string): string {
		let at = p;
		for (
			let next = this.parent.get(at);
			next !== undefined && next !== at;
			next = this.parent.get(at)
		)
			at = next;
		return at;
	}
	union(a: string, b: string) {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra !== rb) this.parent.set(ra, rb);
	}
}

interface Wiring {
	machines: Map<string, StateMachine>;
	/** Every part, by path; `''` is the context. */
	parts: Set<string>;
	ports: Ports;
	/** Every port path the system names. */
	known: string[];
	/** Connections, by the root of each end. */
	connections: { a: string; b: string; name?: string }[];
}

const wirings = new WeakMap<MachineSystem, Wiring>();

function wiring(system: MachineSystem): Wiring {
	const cached = wirings.get(system);
	if (cached) return cached;
	const ports = new Ports();
	const known = new Set<string>(system.ports);
	for (const p of system.parts) for (const port of p.ports) known.add(`${p.path}.${port}`);
	for (const l of system.links) for (const end of l.ends) known.add(end);
	for (const l of system.links) if (l.kind === 'binding') ports.union(l.ends[0], l.ends[1]);
	const out: Wiring = {
		machines: new Map(system.parts.map((p) => [p.path, p.machine])),
		parts: new Set(['', ...system.allParts]),
		ports,
		known: [...known],
		connections: system.links
			.filter((l) => l.kind === 'connection')
			.map((l) => ({ a: l.ends[0], b: l.ends[1], ...(l.name ? { name: l.name } : {}) }))
	};
	wirings.set(system, out);
	return out;
}

/** The part a path is in: itself when it is a part, else the longest part path before it. */
function ownerOf(w: Wiring, path: string): string {
	if (w.parts.has(path)) return path;
	const segments = path.split('.');
	for (let n = segments.length - 1; n > 0; n--) {
		const prefix = segments.slice(0, n).join('.');
		if (w.parts.has(prefix)) return prefix;
	}
	return '';
}

/** Where a signal goes: parts with a machine, each with the port it comes in at; or why it reaches none. */
type Route = { to: string; port?: string }[] | string;

function routeVia(w: Wiring, from: string, port: string): Route {
	const start = from ? `${from}.${port}` : port;
	const root = w.ports.find(start);
	const far = new Set<string>();
	for (const c of w.connections) {
		if (w.ports.find(c.a) === root) far.add(w.ports.find(c.b));
		if (w.ports.find(c.b) === root) far.add(w.ports.find(c.a));
	}
	if (!far.size) return `\`${port}\` of \`${from || 'the context'}\` is connected to nothing`;
	const out: { to: string; port?: string }[] = [];
	const reached: string[] = [];
	for (const end of w.known.filter((k) => far.has(w.ports.find(k)))) {
		const owner = ownerOf(w, end);
		reached.push(end);
		if (!w.machines.has(owner) || owner === from || out.some((o) => o.to === owner)) continue;
		out.push(end === owner ? { to: owner } : { to: owner, port: end.slice(owner.length + 1) });
	}
	return out.length
		? out
		: `it reaches ${reached.map((r) => `\`${r}\``).join(', ')}, whose part has no state machine`;
}

function routeTo(w: Wiring, from: string, target: string): Route {
	// The name as seen from the sending part, then from each part around it.
	const segments = from ? from.split('.') : [];
	for (let n = segments.length; n >= 0; n--) {
		const base = segments.slice(0, n).join('.');
		const path = base ? `${base}.${target}` : target;
		if (!w.parts.has(path) && !w.known.includes(path)) continue;
		const owner = ownerOf(w, path);
		if (!w.machines.has(owner)) return `\`${path}\` has no state machine`;
		return [path === owner ? { to: owner } : { to: owner, port: path.slice(owner.length + 1) }];
	}
	return `\`${target}\` is not a part of the context`;
}

function route(w: Wiring, from: string, sent: Sent): Route {
	if (sent.to) return routeTo(w, from, sent.to);
	if (sent.via) return routeVia(w, from, sent.via);
	return 'it names no port (`via`) and no receiver (`to`)';
}

// ---------------------------------------------------------------- running

interface Run {
	system: MachineSystem;
	w: Wiring;
	time: number;
	parts: Record<string, StateSession>;
	timeline: SystemEvent[];
	messages: string[];
	options: SystemOptions;
}

const LIMIT = 1000;
const partOptions = (options: SystemOptions) => ({
	outward: true,
	maxSteps: options.maxSteps ?? LIMIT
});

const stepsTaken = (run: Run) => Object.values(run.parts).reduce((sum, s) => sum + s.step, 0);

/** Record what a part's machine did (its new steps, its messages) and deliver what it sent. */
function settle(
	run: Run,
	part: string,
	before: StateSession | null,
	next: StateSession,
	send = true
) {
	const known = before?.trace.length ?? 0;
	for (const s of next.trace.slice(known)) {
		run.timeline.push({ kind: 'step', part, time: s.time ?? run.time, step: s });
	}
	for (const text of next.messages ?? []) {
		run.timeline.push({ kind: 'note', part, time: next.time ?? run.time, text });
		run.messages.push(`${part}: ${text}`);
	}
	const sent = next.sent ?? [];
	run.parts[part] = kept(next);
	if (send) for (const s of sent) deliver(run, part, s);
}

/** A part's session as the system keeps it: what it sent is delivered, its messages reported. */
function kept(s: StateSession): StateSession {
	const out = { ...s };
	delete out.sent;
	delete out.messages;
	return out;
}

function deliver(run: Run, from: string, sent: Sent) {
	const route0 = route(run.w, from, sent);
	const base = {
		kind: 'signal' as const,
		time: run.time,
		from,
		signal: sent.signal,
		...(sent.values ? { values: sent.values } : {}),
		...(sent.via ? { via: sent.via } : {})
	};
	if (typeof route0 === 'string') {
		run.timeline.push({ ...base, lost: route0 });
		return;
	}
	for (const r of route0) {
		const target = run.parts[r.to]!;
		if (target.status === 'completed' || target.status === 'max steps reached') {
			run.timeline.push({
				...base,
				to: r.to,
				...(r.port ? { port: r.port } : {}),
				lost: `\`${r.to}\` has ${target.status === 'completed' ? 'finished' : 'stopped'}`
			});
			continue;
		}
		const how = sent.via ? `\`${from}\` through \`${sent.via}\`` : `\`${from}\``;
		const waiting: StateSession = {
			...target,
			queue: [
				...(target.queue ?? []),
				{
					signal: sent.signal,
					...(sent.values ? { values: sent.values } : {}),
					from: how,
					part: from,
					...(r.port ? { port: r.port } : {})
				}
			]
		};
		// What it can do now that the signal waits (events wait for it).
		run.parts[r.to] = kept(
			withVariables(run.w.machines.get(r.to)!, waiting, {}, partOptions(run.options))
		);
		run.timeline.push({ ...base, to: r.to, ...(r.port ? { port: r.port } : {}) });
	}
}

/** Whether a part has something to do now, without an event: a Step would take it. */
export function readyNow(session: StateSession): boolean {
	if (session.status !== 'running') return false;
	return (
		!!session.queue?.length ||
		session.enabled.some((e) => e.ready && (!isEventTrigger(e.trigger) || e.queued))
	);
}

/** One round: every part with something ready now takes one step. Returns how many did. */
function round(run: Run): number {
	const eligible = run.system.parts.filter((p) => readyNow(run.parts[p.path]!));
	for (const p of eligible) {
		const before = run.parts[p.path]!;
		const next = stepMachine(p.machine, before, { event: null }, partOptions(run.options));
		settle(run, p.path, before, next);
	}
	return eligible.length;
}

/** When something next comes due in any part. */
function nextDue(run: Run): number | undefined {
	let next: number | undefined;
	for (const s of Object.values(run.parts)) {
		if (s.status !== 'running' || s.nextDue === undefined) continue;
		if (next === undefined || s.nextDue < next) next = s.nextDue;
	}
	return next;
}

/** Move every part's clock to `time`: what comes due then is ready for the next round. */
function advanceAll(run: Run, time: number) {
	if (time <= run.time) return;
	run.time = time;
	for (const p of run.system.parts) {
		run.parts[p.path] = advance(p.machine, run.parts[p.path]!, time, partOptions(run.options));
	}
}

function status(run: Run): SystemSession['status'] {
	const all = Object.values(run.parts);
	if (
		stepsTaken(run) >= (run.options.maxSteps ?? LIMIT) ||
		all.some((s) => s.status === 'max steps reached')
	)
		return 'max steps reached';
	if (all.every((s) => s.status === 'completed')) return 'completed';
	return all.some((s) => s.status === 'running') ? 'running' : 'deadlocked';
}

function session(run: Run): SystemSession {
	const out: SystemSession = {
		system: run.system.qualifiedName,
		time: run.time,
		step: stepsTaken(run),
		parts: run.parts,
		timeline: run.timeline,
		status: status(run)
	};
	if (run.messages.length) out.messages = run.messages;
	return out;
}

function resume(system: MachineSystem, from: SystemSession, options: SystemOptions): Run {
	for (const p of system.parts) {
		if (!from.parts[p.path])
			throw new Error(`session does not match \`${system.name}\`: no part \`${p.path}\``);
	}
	return {
		system,
		w: wiring(system),
		time: from.time,
		parts: { ...from.parts },
		timeline: [...from.timeline],
		messages: [],
		options
	};
}

/** Start every part's machine at time 0 (in the order written), then deliver what their entries sent. */
export function start(system: MachineSystem, options: SystemOptions = {}): SystemSession {
	const run: Run = {
		system,
		w: wiring(system),
		time: 0,
		parts: {},
		timeline: [],
		messages: [],
		options
	};
	const started = system.parts.map(
		(p) => [p, startMachine(p.machine, null, partOptions(options))] as const
	);
	// Every machine exists before any signal is delivered.
	for (const [p, s] of started) run.parts[p.path] = s;
	for (const [p, s] of started) settle(run, p.path, null, s, false);
	for (const [p, s] of started) for (const sent of s.sent ?? []) deliver(run, p.path, sent);
	return session(run);
}

/** Apply variable changes to the parts they name. */
function applyVariables(run: Run, variables: PartVariables | undefined) {
	for (const [part, values] of Object.entries(variables ?? {})) {
		const machine = run.w.machines.get(part);
		if (!machine || !Object.keys(values).length) continue;
		run.parts[part] = withVariables(machine, run.parts[part]!, values, partOptions(run.options));
	}
}

/**
 * Take a step of the whole system. If nothing happens, the session comes
 * back with a message saying why.
 */
export function step(
	system: MachineSystem,
	from: SystemSession,
	choice: SystemChoice,
	options: SystemOptions = {}
): SystemSession {
	const run = resume(system, from, options);
	applyVariables(run, choice.variables);
	const now = status(run);
	if (now !== 'running') {
		run.messages.push(
			now === 'completed'
				? 'every machine has finished; restart to run again'
				: now === 'max steps reached'
					? `the parts have taken ${stepsTaken(run)} steps, the limit; restart to run again`
					: 'no part can do anything more'
		);
		return session(run);
	}

	if ('part' in choice) {
		const machine = run.w.machines.get(choice.part);
		if (!machine)
			throw new Error(`no part \`${choice.part}\` with a state machine in \`${system.name}\``);
		const before = run.parts[choice.part]!;
		const next = stepMachine(
			machine,
			before,
			{ event: choice.event, ...(choice.payload ? { payload: choice.payload } : {}) },
			partOptions(options)
		);
		if (next.trace.length === before.trace.length) {
			// Nothing fired: say why, change nothing else.
			for (const text of next.messages ?? []) run.messages.push(`${choice.part}: ${text}`);
			run.parts[choice.part] = kept(next);
			return session(run);
		}
		settle(run, choice.part, before, next);
		return session(run);
	}

	if ('wait' in choice) {
		let target: number | undefined;
		if (choice.wait === 'next')
			target = nextDue(run) ?? (Object.values(run.parts).some(readyNow) ? run.time : undefined);
		else if (Number.isFinite(choice.wait) && choice.wait > 0) target = run.time + choice.wait;
		else throw new Error(`cannot wait for ${String(choice.wait)} seconds`);
		if (target === undefined) {
			run.messages.push('no timer is running in any part');
			return session(run);
		}
		for (let rounds = 0; ;) {
			const now = status(run);
			// Time goes on for parts that are stuck, not for ones that finished or hit the limit.
			if (now === 'deadlocked') advanceAll(run, target);
			if (now !== 'running') break;
			if (Object.values(run.parts).some(readyNow)) {
				if (rounds++ >= WAIT_STEPS) {
					run.messages.push(
						`stopped after ${WAIT_STEPS} steps at ${formatDuration(run.time)}: the parts keep moving without time passing`
					);
					break;
				}
				round(run);
				continue;
			}
			const next = nextDue(run);
			if (next !== undefined && next <= target) {
				advanceAll(run, next);
				continue;
			}
			advanceAll(run, target);
			break;
		}
		return session(run);
	}

	if (round(run)) return session(run);
	const next = nextDue(run);
	if (next === undefined) {
		run.messages.push('nothing is ready in any part, and no timer is running');
		return session(run);
	}
	advanceAll(run, next);
	if (!round(run)) run.messages.push(`at ${formatDuration(run.time)} nothing fired`);
	return session(run);
}

/** The session with variable changes applied (by part) and what is enabled re-evaluated, without stepping. */
export function withPartVariables(
	system: MachineSystem,
	from: SystemSession,
	variables: PartVariables,
	options: SystemOptions = {}
): SystemSession {
	const run = resume(system, from, options);
	applyVariables(run, variables);
	return session(run);
}
