/**
 * The steps of an action (an entry, `do` or exit action, or a transition's
 * effect) as the simulator reads them, from the action's text:
 *
 * - `assign x := e`: changes a variable;
 * - `if c { … } else if d { … } else { … }`: runs the first branch whose
 *   condition holds;
 * - `then <step>` (a succession inside the action): the step, after the one
 *   before it;
 * - `send new Sig(a, b) to target`: a signal, delivered to the machine when
 *   the target is the machine itself (`self`, or the part it belongs to);
 * - `action { … }`: its steps;
 * - a named action (`powerUp`, `cleanup : Cleanup`) or a succession between
 *   named actions (`first a then b`): nothing the simulator changes;
 * - anything else (`accept`, loops, `perform`, `terminate`, a `send`
 *   elsewhere) is not run, and the machine says so.
 *
 * Steps run in the order written. (SysML runs actions not joined by
 * successions concurrently, in no fixed order; the simulator takes the
 * written order, as it does for assignments.)
 *
 * Pure text handling, shared by the extraction (`engine/toolkit/machines.ts`,
 * for the notes) and the simulator (`emulator.ts`, to run them).
 */

export type ActionStep =
	| { kind: 'assign'; text: string; target: string; value: string }
	| {
			kind: 'if';
			text: string;
			branches: { condition: string; steps: ActionStep[] }[];
			otherwise: ActionStep[] | null;
	  }
	| {
			kind: 'send';
			text: string;
			signal: string;
			args: string[];
			to: string | null;
			/** The port it goes out through (`via p`), if any. */
			via?: string | null;
	  }
	| { kind: 'named'; text: string }
	| { kind: 'other'; text: string };

/** Index of the quote closing the one at `start` (backslash escapes). */
function closing(text: string, start: number): number {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (text[i] === quote) return i;
	}
	return text.length - 1;
}

/** Index of the bracket closing the one at `start`, or the end of the text. */
function matching(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") i = closing(text, i);
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return text.length;
}

/** Index of the first `char` outside brackets and quotes, from `from`; -1 if none. */
function topLevel(text: string, char: string, from = 0): number {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") i = closing(text, i);
		else if (depth === 0 && c === char) return i;
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
	}
	return -1;
}

/** Position of a whole keyword outside brackets and quotes, from `from`; -1 if none. */
function keyword(text: string, word: string, from = 0): number {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") i = closing(text, i);
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if (
			depth === 0 &&
			text.startsWith(word, i) &&
			!/[\w$.:']/.test(text[i - 1] ?? ' ') &&
			!/[\w$']/.test(text[i + word.length] ?? ' ')
		)
			return i;
	}
	return -1;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The statements of a body, in order: each ends at a `;`, or at the `}` of a
 * block (`if c { … }`) unless an `else` follows.
 */
export function statements(body: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	const push = (to: number) => {
		const s = body.slice(from, to).trim();
		if (s) out.push(s);
		from = to + 1;
	};
	for (let i = 0; i < body.length; i++) {
		const c = body[i]!;
		if (c === '"' || c === "'") i = closing(body, i);
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') {
			depth--;
			if (depth === 0 && c === '}' && !/^\s*else\b/.test(body.slice(i + 1))) {
				// A block ends the statement; a `;` right after it is an empty one.
				out.push(body.slice(from, i + 1).trim());
				from = i + 1;
				const semi = /^\s*;/.exec(body.slice(from));
				if (semi) from += semi[0].length;
			}
		} else if (c === ';' && depth === 0) push(i);
	}
	push(body.length);
	return out.filter((s) => s.trim());
}

/** The body of `{ … }` starting at `open`, and the index after its `}`. */
function block(text: string, open: number): { body: string; end: number } {
	const close = matching(text, open);
	return { body: text.slice(open + 1, close), end: close + 1 };
}

/** `if c { … } else if d { … } else { … }`, or null when it is not one. */
function parseIf(text: string): ActionStep | null {
	const branches: { condition: string; steps: ActionStep[] }[] = [];
	let rest = text;
	for (;;) {
		const m = /^if\b/.exec(rest);
		if (!m) return null;
		const open = topLevel(rest, '{', 2);
		if (open < 0) return null;
		const condition = rest.slice(2, open).trim();
		if (!condition) return null;
		const { body, end } = block(rest, open);
		branches.push({ condition: squash(condition), steps: parseSteps(body) });
		rest = rest.slice(end).trim();
		if (!rest) return { kind: 'if', text: squash(text), branches, otherwise: null };
		const otherwise = /^else\b\s*/.exec(rest);
		if (!otherwise) return null;
		rest = rest.slice(otherwise[0].length);
		if (rest.startsWith('{')) {
			const last = block(rest, 0);
			if (rest.slice(last.end).trim()) return null;
			return { kind: 'if', text: squash(text), branches, otherwise: parseSteps(last.body) };
		}
	}
}

/** `send new Sig(1, x) via p to target`. */
function parseSend(text: string): ActionStep | null {
	let rest = text.replace(/^send\b/, '').trim();
	let to: string | null = null;
	const at = keyword(rest, 'to');
	if (at >= 0) {
		to = squash(rest.slice(at + 2)) || null;
		rest = rest.slice(0, at).trim();
	}
	let port: string | null = null;
	const via = keyword(rest, 'via');
	if (via >= 0) {
		port = squash(rest.slice(via + 3)) || null;
		rest = rest.slice(0, via).trim();
	}
	rest = rest.replace(/^new\b\s*/, '');
	const m = /^((?:'[^']*'|[\w$]+)(?:\s*::\s*(?:'[^']*'|[\w$]+))*)\s*([\s\S]*)$/.exec(rest);
	if (!m) return null;
	const signal = m[1]!.replace(/\s+/g, '');
	const tail = m[2]!.trim();
	let args: string[] = [];
	if (tail) {
		if (!tail.startsWith('(') || matching(tail, 0) !== tail.length - 1) return null;
		const inner = tail.slice(1, -1);
		args = [];
		let from = 0;
		for (let comma = topLevel(inner, ','); ; comma = topLevel(inner, ',', from)) {
			const arg = inner.slice(from, comma < 0 ? inner.length : comma).trim();
			if (arg) args.push(squash(arg));
			if (comma < 0) break;
			from = comma + 1;
		}
	}
	return { kind: 'send', text: squash(text), signal, args, to, ...(port ? { via: port } : {}) };
}

const NAMED = /^(?:'[^']*'|[\w$.:]+)(?:\s*:\s*(?:'[^']*'|[\w$.:]+))?$/;

function parseStep(raw: string): ActionStep[] {
	let text = raw.trim();
	// `then x`: a succession from the step before; the steps run in order anyway.
	const then = /^then\b\s*/.exec(text);
	if (then) text = text.slice(then[0].length);
	if (!text) return [];
	const statement = squash(text);
	if (/^action\b/.test(text)) {
		const rest = text.replace(/^action\b\s*/, '');
		const open = topLevel(rest, '{');
		if (open >= 0 && !rest.slice(0, open).includes('=')) {
			const { body, end } = block(rest, open);
			if (!rest.slice(end).trim()) return parseSteps(body);
		}
		if (!rest || NAMED.test(rest)) return [{ kind: 'named', text: statement }];
		return parseStep(rest);
	}
	const assign = /^assign\s+([\s\S]+?)\s*:=\s*([\s\S]+)$/.exec(text);
	if (assign) {
		const value = squash(assign[2]!);
		const target = squash(assign[1]!);
		return [{ kind: 'assign', text: `assign ${target} := ${value}`, target, value }];
	}
	if (/^if\b/.test(text)) return [parseIf(text) ?? { kind: 'other', text: statement }];
	if (/^send\b/.test(text)) return [parseSend(text) ?? { kind: 'other', text: statement }];
	// `first a then b`: the order of named actions, which change nothing the simulator runs.
	if (/^first\b/.test(text) && !/[{]/.test(text)) return [{ kind: 'named', text: statement }];
	if (NAMED.test(text) && !/^(accept|perform|terminate|while|loop|for)\b/.test(text))
		return [{ kind: 'named', text: statement }];
	return [{ kind: 'other', text: statement }];
}

/** The steps of a body of statements. */
function parseSteps(body: string): ActionStep[] {
	return statements(body).flatMap(parseStep);
}

/**
 * The steps of an action as written: `assign x := 1`, `action { … }`, `send
 * new Sig() to self`, a name. Comments are expected to be gone already.
 */
export function parseAction(text: string): ActionStep[] {
	return parseSteps(text);
}

/** Every step, nested ones (inside `if`) included, depth first. */
export function allSteps(steps: ActionStep[]): ActionStep[] {
	return steps.flatMap((s) =>
		s.kind === 'if'
			? [s, ...s.branches.flatMap((b) => allSteps(b.steps)), ...allSteps(s.otherwise ?? [])]
			: [s]
	);
}

/** Whether a `send` goes to the machine itself: `self`, `this`, or one of `own` (its part). */
export function sendsToSelf(step: ActionStep, own: readonly string[]): boolean {
	if (step.kind !== 'send' || !step.to) return false;
	const to = step.to.replace(/^self\./, '').replace(/\s+/g, '');
	return to === 'self' || to === 'this' || own.includes(to);
}

/**
 * The steps the simulator does not run (named actions aside): any `other`
 * step, and a `send` to anything but the machine itself. An `if` with such
 * a step inside is run; the step inside is listed.
 */
export function notRunSteps(steps: ActionStep[], own: readonly string[]): string[] {
	return allSteps(steps)
		.filter((s) => s.kind === 'other' || (s.kind === 'send' && !sendsToSelf(s, own)))
		.map((s) => s.text);
}

/** Whether running the action changes anything the simulator keeps (variables, signals). */
export function runsSomething(steps: ActionStep[], own: readonly string[]): boolean {
	return allSteps(steps).some(
		(s) => s.kind === 'assign' || s.kind === 'if' || (s.kind === 'send' && sendsToSelf(s, own))
	);
}
