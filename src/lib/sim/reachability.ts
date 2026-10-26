/**
 * Which states a run can never reach, and which transitions can never fire,
 * read from the machine alone (no run). Guards are taken to be possibly
 * true unless they are constant (`if false`), so a state reported here is
 * unreachable whatever the variables, events and timers; one not reported
 * may still be unreachable because of its guards.
 *
 * Under the simulator's rules (`docs/simulator.md`), a transition never fires
 * when:
 * - its source state cannot be reached;
 * - its guard, or its `when` condition, is constant and false;
 * - its source is a simple state with an earlier transition that has no
 *   trigger and no guard: that one is taken as soon as the state is entered,
 *   before any event, timer or condition (and before later untriggered ones).
 */
import type { StateMachine } from '#lib/engine/types.ts';
import { evaluateCondition, parseExpr } from './expr.ts';

export interface DeadTransition {
	/** Index in `machine.transitions`. */
	index: number;
	label: string;
	reason: string;
}

export interface Reachability {
	/** States (paths) no run can enter, in document order. */
	unreachable: string[];
	/** Transitions that can never fire, in document order. */
	dead: DeadTransition[];
}

/** `true` / `false` when an expression is constant, else `null` (it reads something). */
function constant(text: string): boolean | null {
	try {
		return evaluateCondition(parseExpr(text), { get: () => undefined });
	} catch {
		return null;
	}
}

export function reachability(machine: StateMachine): Reachability {
	const states = new Map(machine.states.map((s) => [s.name, s]));
	const children = new Map<string | undefined, StateMachine['states']>();
	for (const s of machine.states) {
		const list = children.get(s.parent) ?? [];
		list.push(s);
		children.set(s.parent, list);
	}
	const label = (t: StateMachine['transitions'][number]) => t.name ?? `${t.from} -> ${t.to}`;

	// Transitions that cannot fire whatever is reached.
	const never = new Map<number, string>();
	const shadowedBy = new Map<string, number>();
	machine.transitions.forEach((t, index) => {
		const source = states.get(t.from);
		if (source?.kind === 'initial') return;
		if (t.guard && constant(t.guard) === false) {
			never.set(index, `its guard \`${t.guard}\` is always false`);
			return;
		}
		const when = /^when\s+([\s\S]+)$/.exec(t.trigger?.trim() ?? '');
		if (when && constant(when[1]!) === false) {
			never.set(index, `its condition \`${when[1]!.trim()}\` is never true`);
			return;
		}
		const simple = !(children.get(t.from) ?? []).length;
		const first = shadowedBy.get(t.from);
		if (simple && first !== undefined) {
			never.set(
				index,
				`\`${label(machine.transitions[first]!)}\` always fires first: it has no trigger and no guard`
			);
			return;
		}
		if (simple && !t.trigger && (!t.guard || constant(t.guard) === true)) {
			shadowedBy.set(t.from, index);
		}
	});
	// A transition written before the always-ready one, but with a trigger, also waits for it.
	machine.transitions.forEach((t, index) => {
		const first = shadowedBy.get(t.from);
		if (first === undefined || index === first || never.has(index) || !t.trigger) return;
		never.set(
			index,
			`\`${label(machine.transitions[first]!)}\` always fires first: it has no trigger and no guard`
		);
	});

	const reached = new Set<string>();
	const enter = (name: string) => {
		for (let s: string | undefined = name; s && !reached.has(s); s = states.get(s)?.parent) {
			reached.add(s);
		}
		const state = states.get(name);
		const inside = children.get(name) ?? [];
		if (!state || !inside.length) return;
		if (state.parallel) {
			for (const region of inside) if (region.kind === 'state') enter(region.name);
		} else enterDefault(name);
	};
	/** Every state an initial transition may enter (any of its guards may hold), else the first one. */
	const enterDefault = (parent: string | undefined) => {
		const inside = children.get(parent) ?? [];
		const initial = inside.find((s) => s.kind === 'initial');
		const targets = initial
			? machine.transitions.filter((t) => t.from === initial.name).map((t) => t.to)
			: [];
		if (initial) reached.add(initial.name);
		if (targets.length) for (const t of targets) enter(t);
		else {
			const first = inside.find((s) => s.kind === 'state');
			if (first) enter(first.name);
		}
	};
	if (machine.parallel) {
		for (const region of children.get(undefined) ?? [])
			if (region.kind === 'state') enter(region.name);
	} else enterDefault(undefined);

	for (let changed = true; changed;) {
		changed = false;
		machine.transitions.forEach((t, index) => {
			if (never.has(index) || !reached.has(t.from) || reached.has(t.to)) return;
			if (states.get(t.from)?.kind === 'initial') return;
			enter(t.to);
			changed = true;
		});
	}

	const unreachable = machine.states
		.filter((s) => s.kind !== 'initial' && !reached.has(s.name))
		.map((s) => s.name);
	const dead: DeadTransition[] = [];
	machine.transitions.forEach((t, index) => {
		if (states.get(t.from)?.kind === 'initial') return;
		const reason =
			never.get(index) ??
			(reached.has(t.from) ? undefined : `its source \`${t.from}\` cannot be reached`);
		if (reason) dead.push({ index, label: label(t), reason });
	});
	return { unreachable, dead };
}
