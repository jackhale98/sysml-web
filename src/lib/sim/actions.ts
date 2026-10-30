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

/** What every step carries: its text as written, its name (`action a accept Go`) and whether `then` puts it after the step before. */
interface Written {
	text: string;
	/** The step's own name, when it has one (`action release assign open := true`). */
	name?: string;
	/** Written `then <step>`: a succession from the step declared before it. */
	after?: true;
}

export type ActionStep = Written &
	(
		| { kind: 'assign'; target: string; value: string }
		| {
				kind: 'if';
				branches: { condition: string; steps: ActionStep[] }[];
				otherwise: ActionStep[] | null;
		  }
		| {
				kind: 'send';
				signal: string;
				args: string[];
				to: string | null;
				/** The port it goes out through (`via p`), if any. */
				via?: string | null;
		  }
		| { kind: 'named' }
		| { kind: 'other' }
		/** `while c { … } until d;`, `loop { … } until d;` (no `while`: the test is `true`). */
		| { kind: 'loop'; condition: string | null; until: string | null; steps: ActionStep[] }
		/** `for i in seq { … }`. */
		| { kind: 'for'; variable: string; collection: string; steps: ActionStep[] }
		/** `accept Sig`, `accept r : Sig via p`, `accept when c`, `accept after d`, `accept at t`. */
		| { kind: 'accept'; trigger: string; payload: string | null }
		/** `perform a;`, `perform action a : A { in x = 1; }`: the action it performs, and the body's bindings. */
		| { kind: 'perform'; target: string; steps: ActionStep[] }
		/** A named action with a body or a type: `action a { … }`, `action a : A;`. */
		| { kind: 'action'; type: string | null; steps: ActionStep[] }
		/** A control node: `fork;`, `join j;`, `merge m;`, `decide;`. */
		| { kind: 'control'; node: 'fork' | 'join' | 'merge' | 'decide' }
		/** `first start;`: the step the next `then` comes after. */
		| { kind: 'first'; target: string }
		/**
		 * A succession: `first a then b`, `then b` (from the step before, when
		 * `from` is null), or a decision's branch `if c then b` / `else b`
		 * (`guard` is the condition, or `else`).
		 */
		| { kind: 'succession'; from: string | null; to: string; guard: string | null }
		/** An item flow, `flow of T from a.x to b.y;` (`succession flow`: also a succession). */
		| { kind: 'flow'; from: string; to: string; item: string | null; succession: boolean }
		/**
		 * A parameter or attribute: `in item plan : Plan = p;`, `out attribute ok :
		 * Boolean default true;`. `binding`: `=` (a bound value), else an initial
		 * or default value.
		 */
		| {
				kind: 'feature';
				direction: 'in' | 'out' | 'inout' | null;
				type: string | null;
				value: string | null;
				binding: boolean;
		  }
		/** Something an action may declare that is not a step (`subject`, `actor`, `objective`, …). */
		| { kind: 'declaration' }
	);

export type StepOf<K extends ActionStep['kind']> = Extract<ActionStep, { kind: K }>;

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
 * block (`if c { … }`) unless an `else` or `until` follows.
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
			if (depth === 0 && c === '}' && !/^\s*(else|until)\b/.test(body.slice(i + 1))) {
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

const NAME = String.raw`(?:'[^']*'|[\w$]+)`;
const QUALIFIED = String.raw`${NAME}(?:\s*(?:::|\.)\s*${NAME})*`;
const NAMED = /^(?:'[^']*'|[\w$.:]+)(?:\s*:\s*(?:'[^']*'|[\w$.:]+))?$/;
/** A reference to a step: `descend`, `drone.deliveryFlight`, `'drop parcel'`. */
const REFERENCE = new RegExp(`^${QUALIFIED}$`);
const KEYWORDS = /^(accept|perform|terminate|while|loop|for|then|first|if|else|send|assign)\b/;

const unquote = (name: string) => name.replace(/\s+/g, '').replace(/^'(.*)'$/, '$1');

/** `name : Type` (each optional) at the start of a declaration, and what follows. */
function header(text: string): { name: string | null; type: string | null; rest: string } {
	const m = new RegExp(
		String.raw`^(?:(${NAME})\s*)?(?:(?::(?![:>])|:>|defined\s+by\b)\s*(${QUALIFIED}))?(?:\s*\[[^\]]*\])?`
	).exec(text)!;
	return {
		name: m[1] && !KEYWORDS.test(m[1]) ? m[1] : null,
		type: m[2] ? m[2].replace(/\s+/g, '') : null,
		rest: text.slice(m[1] && KEYWORDS.test(m[1]) ? 0 : m[0].length).trim()
	};
}

/** A trailing `{ … }` body: its text, and what comes before it. */
function trailingBlock(text: string): { head: string; body: string | null } {
	const open = topLevel(text, '{');
	if (open < 0) return { head: text, body: null };
	const { body, end } = block(text, open);
	if (text.slice(end).trim()) return { head: text, body: null };
	return { head: text.slice(0, open).trim(), body };
}

/** `while c { … } until d`, `loop { … } until d`. */
function parseLoop(text: string): ActionStep | null {
	const loop = /^loop\b/.test(text);
	const rest = text.replace(/^(while|loop)\b\s*/, '');
	const open = topLevel(rest, '{');
	if (open < 0) return null;
	const condition = squash(rest.slice(0, open)) || null;
	if (!loop && !condition) return null;
	if (loop && condition && !/^action\b/.test(condition)) return null;
	const { body, end } = block(rest, open);
	const tail = rest.slice(end).trim().replace(/;$/, '');
	let until: string | null = null;
	if (tail) {
		const m = /^until\b\s*([\s\S]+)$/.exec(tail);
		if (!m) return null;
		until = squash(m[1]!);
	}
	return {
		kind: 'loop',
		text: squash(text),
		condition: loop ? null : condition,
		until,
		steps: parseSteps(body)
	};
}

/** `for i in seq { … }`, `for i : Integer in seq { … }`. */
function parseFor(text: string): ActionStep | null {
	const rest = text.replace(/^for\b\s*/, '');
	const at = keyword(rest, 'in');
	const open = topLevel(rest, '{');
	if (at < 0 || open < at) return null;
	const variable = /^('[^']*'|[\w$]+)/.exec(rest.trim())?.[1];
	if (!variable) return null;
	const { body, end } = block(rest, open);
	if (rest.slice(end).trim()) return null;
	return {
		kind: 'for',
		text: squash(text),
		variable,
		collection: squash(rest.slice(at + 2, open)),
		steps: parseSteps(body)
	};
}

/** `accept r : Sig via p`, `accept when c`, `accept after d`. */
function parseAccept(text: string): ActionStep {
	let rest = squash(text.replace(/^accept\b/, ''));
	if (/^(when|after|at)\b/.test(rest))
		return { kind: 'accept', text: squash(text), trigger: rest, payload: null };
	const via = keyword(rest, 'via');
	if (via >= 0) rest = rest.slice(0, via).trim();
	const typed = /^((?:'[^']*'|[\w$]+))\s*:(?!:)\s*([\s\S]+)$/.exec(rest);
	return {
		kind: 'accept',
		text: squash(text),
		trigger: (typed ? typed[2]! : rest).replace(/\s+/g, ''),
		payload: typed ? typed[1]! : null
	};
}

/** `flow of T from a.x to b.y`, `flow a.x to b.y` (after `flow` or `succession flow`). */
function parseFlow(text: string, succession: boolean): ActionStep | null {
	let rest = text.replace(/^(succession\s+)?flow\b\s*/, '');
	let item: string | null = null;
	const of = keyword(rest, 'of');
	const from = keyword(rest, 'from');
	const to = keyword(rest, 'to');
	if (to < 0) return null;
	if (of >= 0) {
		const end = from >= 0 ? from : to;
		item = squash(rest.slice(of + 2, end)).replace(/^(?:'[^']*'|[\w$]+)\s*:\s*/, '') || null;
	}
	const source =
		from >= 0
			? rest.slice(from + 4, to)
			: of >= 0
				? ''
				: rest.slice(0, to).replace(new RegExp(`^${NAME}\\s+(?=${NAME})`), '');
	rest = rest.slice(to + 2);
	const target = squash(trailingBlock(rest).head);
	if (!squash(source) || !target) return null;
	return {
		kind: 'flow',
		text: squash(text),
		from: squash(source).replace(/\s+/g, ''),
		to: target.replace(/\s+/g, ''),
		item,
		succession
	};
}

/** `in item plan : Plan = p`, `attribute x : Real := 0`, `out ok : Boolean default true`. */
function parseFeature(text: string): ActionStep | null {
	const statement = squash(text);
	let rest = trailingBlock(statement).head;
	const direction = /^(in|out|inout)\b/.exec(rest)?.[1] as 'in' | 'out' | 'inout' | undefined;
	if (direction) rest = rest.slice(direction.length).trim();
	rest = rest.replace(/^(?:(?:ref|derived|readonly|constant|var|end)\s+)*/, '');
	rest = rest.replace(/^(attribute|item|part|occurrence|port|ref|action)\b\s*/, '');
	rest = rest.replace(/^(?::>>|redefines\b)\s*/, '');
	const { name, type, rest: tail } = header(rest);
	if (!name) return null;
	const value = /^(:=|=|default\b\s*=?)\s*([\s\S]+)$/.exec(tail);
	return {
		kind: 'feature',
		text: statement,
		name,
		direction: direction ?? null,
		type,
		value: value ? squash(value[2]!) : null,
		binding: value?.[1] === '='
	};
}

/** `action a { … }`, `action a : A;`, `action a accept Go`: a named step, or the steps of an unnamed body. */
function parseNamedAction(text: string, statement: string): ActionStep[] {
	const rest = text.replace(/^action\b\s*/, '');
	const { head, body } = trailingBlock(rest);
	const { name, type, rest: tail } = header(head);
	if (!tail) {
		if (!name && !type)
			return body === null ? [{ kind: 'named', text: statement }] : parseSteps(body);
		if (name && (type || body !== null))
			return [
				{
					kind: 'action',
					text: statement,
					name,
					type,
					steps: body === null ? [] : parseSteps(body)
				}
			];
		return [{ kind: 'named', text: statement, ...(name ? { name } : {}) }];
	}
	// `action a accept Go;`: the step, with its name.
	if (name && /^(accept|send|assign|if|while|loop|for|perform)\b/.test(tail)) {
		return parseStep(tail).map((s) => ({ ...s, name }));
	}
	if (!rest || NAMED.test(rest)) return [{ kind: 'named', text: statement }];
	return parseStep(rest);
}

/** `perform a`, `perform action a : A { in x = 1; }`. */
function parsePerform(text: string, statement: string): ActionStep {
	const rest = text.replace(/^perform\b\s*/, '').replace(/^action\b\s*/, '');
	const { head, body } = trailingBlock(rest);
	const reference = new RegExp(`^(${QUALIFIED})$`).exec(head);
	if (reference) {
		return {
			kind: 'perform',
			text: statement,
			target: reference[1]!.replace(/\s+/g, ''),
			steps: body === null ? [] : parseSteps(body)
		};
	}
	const { name, type, rest: tail } = header(head);
	const target = type ?? name;
	if (!target || tail) return { kind: 'other', text: statement };
	return {
		kind: 'perform',
		text: statement,
		...(name && type ? { name } : {}),
		target,
		steps: body === null ? [] : parseSteps(body)
	};
}

/** `first a then b`, after `first` or `succession [name]`. */
function parseSuccession(text: string, statement: string): ActionStep {
	const rest = text.replace(/^succession\b\s*(?:(?:'[^']*'|[\w$]+)\s+(?=first\b))?/, '');
	const m = /^first\s+([\s\S]+?)\s+then\s+([\s\S]+)$/.exec(rest);
	if (m && REFERENCE.test(m[1]!.trim()) && REFERENCE.test(m[2]!.trim()))
		return {
			kind: 'succession',
			text: statement,
			from: unquote(m[1]!),
			to: unquote(m[2]!),
			guard: null
		};
	const first = /^first\s+([\s\S]+)$/.exec(rest);
	if (first && REFERENCE.test(first[1]!.trim()))
		return { kind: 'first', text: statement, target: unquote(first[1]!) };
	return { kind: 'other', text: statement };
}

function parseStep(raw: string): ActionStep[] {
	let text = raw.trim().replace(/^(private|public|protected)\s+/, '');
	// `doc` whose comment is already gone.
	text = text.replace(/^doc\b\s*(?:locale\s+"[^"]*"\s*)?/, '');
	// `then x`: a succession from the step before.
	const then = /^then\b\s*/.exec(text);
	if (then) text = text.slice(then[0].length);
	if (!text) return [];
	const statement = squash(text);
	const control = /^(fork|join|merge|decide)\b/.test(text);
	if (then && !control && (REFERENCE.test(text) || text === 'done')) {
		return [
			{ kind: 'succession', text: `then ${statement}`, from: null, to: unquote(text), guard: null }
		];
	}
	const steps = parseOne(text, statement);
	return then ? steps.map((s, i) => (i === 0 ? { ...s, after: true } : s)) : steps;
}

function parseOne(text: string, statement: string): ActionStep[] {
	if (/^action\b/.test(text)) return parseNamedAction(text, statement);
	const assign = /^assign\s+([\s\S]+?)\s*:=\s*([\s\S]+)$/.exec(text);
	if (assign) {
		const value = squash(assign[2]!);
		const target = squash(assign[1]!);
		return [{ kind: 'assign', text: `assign ${target} := ${value}`, target, value }];
	}
	if (/^if\b/.test(text)) {
		const then = keyword(text, 'then');
		const open = topLevel(text, '{');
		if (then >= 0 && (open < 0 || then < open)) {
			const to = squash(text.slice(then + 4));
			if (REFERENCE.test(to) || to === 'done')
				return [
					{
						kind: 'succession',
						text: statement,
						from: null,
						to: unquote(to),
						guard: squash(text.slice(2, then))
					}
				];
		}
		return [parseIf(text) ?? { kind: 'other', text: statement }];
	}
	const otherwise = /^else\s+([\s\S]+)$/.exec(text);
	if (otherwise && (REFERENCE.test(otherwise[1]!.trim()) || otherwise[1]!.trim() === 'done'))
		return [
			{ kind: 'succession', text: statement, from: null, to: unquote(otherwise[1]!), guard: 'else' }
		];
	if (/^send\b/.test(text)) return [parseSend(text) ?? { kind: 'other', text: statement }];
	if (/^accept\b/.test(text)) return [parseAccept(text)];
	if (/^(while|loop)\b/.test(text)) return [parseLoop(text) ?? { kind: 'other', text: statement }];
	if (/^for\b/.test(text)) return [parseFor(text) ?? { kind: 'other', text: statement }];
	if (/^perform\b/.test(text)) return [parsePerform(text, statement)];
	if (/^(succession\s+)?flow\b/.test(text))
		return [parseFlow(text, /^succession\b/.test(text)) ?? { kind: 'other', text: statement }];
	if (/^(first|succession)\b/.test(text)) return [parseSuccession(text, statement)];
	const control = /^(fork|join|merge|decide)\b\s*([\s\S]*)$/.exec(text);
	if (control && (!control[2] || new RegExp(`^${NAME}$`).test(control[2].trim()))) {
		return [
			{
				kind: 'control',
				text: statement,
				node: control[1] as StepOf<'control'>['node'],
				...(control[2] ? { name: unquote(control[2]) } : {})
			}
		];
	}
	if (/^(in|out|inout|attribute|item|ref|part|occurrence|port|redefines)\b|^:>>/.test(text))
		return [parseFeature(text) ?? { kind: 'declaration', text: statement }];
	if (
		/^(subject|actor|objective|stakeholder|return|require|assume|include|requirement|constraint|calc|state|exhibit|allocate|satisfy|connect|connection|interface|bind|binding|comment|metadata|alias|import|enum|individual|snapshot|timeslice|event|use|view|viewpoint|rendering|concern|verify|analysis|verification)\b|^[@#]/.test(
			text
		)
	)
		return [{ kind: 'declaration', text: statement }];
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

/** The steps nested in a step: an `if`'s branches, a loop's body, an action's body. */
export function innerSteps(step: ActionStep): ActionStep[] {
	if (step.kind === 'if')
		return [...step.branches.flatMap((b) => b.steps), ...(step.otherwise ?? [])];
	if (
		step.kind === 'loop' ||
		step.kind === 'for' ||
		step.kind === 'action' ||
		step.kind === 'perform'
	)
		return step.steps;
	return [];
}

/** Every step, nested ones (inside `if`, loops and actions) included, depth first. */
export function allSteps(steps: ActionStep[]): ActionStep[] {
	return steps.flatMap((s) => [s, ...allSteps(innerSteps(s))]);
}

/** Whether a `send` goes to the machine itself: `self`, `this`, or one of `own` (its part). */
export function sendsToSelf(step: ActionStep, own: readonly string[]): boolean {
	if (step.kind !== 'send' || !step.to) return false;
	const to = step.to.replace(/^self\./, '').replace(/\s+/g, '');
	return to === 'self' || to === 'this' || own.includes(to);
}

/**
 * Steps that need more than the plain written order: loops, `perform`,
 * named actions with bodies, accepts, successions, control nodes and flows.
 * The simulator runs a body with any of them as a small action flow
 * (`flow.ts`); a body of assignments, `if` and sends runs in the order written.
 */
export function needsFlow(steps: ActionStep[]): boolean {
	return allSteps(steps).some(
		(s) =>
			s.after ||
			s.kind === 'loop' ||
			s.kind === 'for' ||
			s.kind === 'perform' ||
			s.kind === 'action' ||
			s.kind === 'accept' ||
			s.kind === 'control' ||
			s.kind === 'first' ||
			s.kind === 'succession' ||
			s.kind === 'flow'
	);
}

/**
 * The steps a state machine's actions do not run (named actions aside): any
 * `other` step, a `send` to anything but the machine itself, an `accept`
 * (a state's actions run within one step, so they do not wait for a
 * signal) and a `perform` of an action `performs` does not know. An `if`
 * with such a step inside is run; the step inside is listed.
 */
export function notRunSteps(
	steps: ActionStep[],
	own: readonly string[],
	performs: (target: string) => boolean = () => false
): string[] {
	return allSteps(steps)
		.filter(
			(s) =>
				s.kind === 'other' ||
				s.kind === 'accept' ||
				(s.kind === 'perform' && !performs(s.target)) ||
				(s.kind === 'send' && !sendsToSelf(s, own))
		)
		.map((s) => s.text);
}

/** Whether running the action changes anything the simulator keeps (variables, signals). */
export function runsSomething(steps: ActionStep[], own: readonly string[]): boolean {
	return allSteps(steps).some(
		(s) =>
			s.kind === 'assign' ||
			s.kind === 'if' ||
			s.kind === 'loop' ||
			s.kind === 'for' ||
			s.kind === 'perform' ||
			(s.kind === 'send' && sendsToSelf(s, own))
	);
}
