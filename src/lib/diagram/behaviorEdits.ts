/**
 * Behaviour drawn on state and action diagrams: the SysML each gesture
 * writes, and how to change or remove it.
 *
 * State diagrams: a state (`state off;`), where the machine starts
 * (`entry; then off;`, as the demo writes it), a transition with its
 * trigger, guard and effect (`transition off_to_on first off accept
 * SwitchOn if level < 3 do action greet then on;`), and a state's `entry`,
 * `do` and `exit` actions. Action diagrams: an action, `first start then
 * a;` and `first a then done;`, a succession `first a then b;`, decision
 * branches written right after their `decide` (`if hot then pour;`,
 * `else wait;`), and `decide` / `merge` / `fork` / `join` nodes.
 *
 * Pure, like `relationships.ts`: the model comes in as a `ModelContext`,
 * and each edit comes back as a `Plan` with one text patch per file, which
 * `applySteps` (workbench/actions.ts) runs as one undoable change. Every
 * function returns a message instead when the text does not have the shape
 * it expects; it never guesses.
 */
import { parseExpr } from '#lib/sim/expr.ts';
import { byteToUtf16, type ModelElement } from '#lib/project/elements.ts';
import { transitionParts } from '#lib/engine/toolkit/machines.ts';
import { formatName } from '#lib/workbench/templates.ts';
import type { EditStep } from '#lib/workbench/actions.ts';
import { referenceFrom } from './model.ts';
import type { ModelContext, Plan } from './relationships.ts';
import { bodyOf, directText, headerEnd, matchBrace, removeStatement } from './textpatch.ts';

const INDENT = '    ';
/** Keep one-line bodies on one line while they stay this short. */
const INLINE_MAX = 100;

// ---------------------------------------------------------------- kinds

/** Control nodes of an action flow, by the app's kind, with the keyword that declares them. */
export const CONTROL_WORDS: Record<string, 'decide' | 'merge' | 'fork' | 'join'> = {
	decision_node: 'decide',
	merge_node: 'merge',
	fork_node: 'fork',
	join_node: 'join'
};

/** A state of a machine (not the machine itself). */
export const isState = (e: ModelElement) =>
	!e.isDefinition && (e.kind === 'state' || e.kind === 'exhibit');

/** A node of an action flow: an action or a control node. */
export const isFlowNode = (e: ModelElement) =>
	!e.isDefinition &&
	(e.kind === 'action' ||
		e.kind === 'perform' ||
		e.kind === 'accept' ||
		e.kind === 'send' ||
		e.kind === 'assign' ||
		e.kind in CONTROL_WORDS);

/** What a state diagram or an action flow is drawn for: its machine or action. */
export const isBehavior = (e: ModelElement) =>
	e.kind === 'state' || e.kind === 'exhibit' || e.kind === 'action' || e.kind === 'use_case';

// ---------------------------------------------------------------- names

/** Words of a name someone typed: "switch on", "switchOn", "switch_on" → switch, On. */
function words(raw: string): string[] {
	return raw
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
}

const isIdentifier = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);

/** A signal (item def) name from what was typed: kept when it is a name, else "switch on" → SwitchOn. */
export function signalName(raw: string): string {
	const text = raw.trim();
	if (isIdentifier(text) || /^[A-Za-z_][\w]*(::[A-Za-z_]\w*)+$/.test(text)) return text;
	const name = words(text)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join('');
	return /^[0-9]/.test(name) ? `S${name}` : name;
}

/** An action name from what was typed: kept when it is a name, else "turn on lamp" → turnOnLamp. */
export function actionName(raw: string): string {
	const text = raw.trim();
	if (isIdentifier(text)) return text;
	const name = words(text)
		.map((w, i) =>
			i ? w.charAt(0).toUpperCase() + w.slice(1) : w.charAt(0).toLowerCase() + w.slice(1)
		)
		.join('');
	return /^[0-9]/.test(name) ? `a${name}` : name;
}

/** `base`, else `base_2`, `base_3`, … : the first not in `taken`. */
function unique(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Names of the members `owner` declares. */
function memberNames(owner: ModelElement, ctx: ModelContext): string[] {
	return ctx.elements.filter((e) => ctx.owners.get(e.key)?.key === owner.key).map((e) => e.name);
}

/** Direct members of `owner` that satisfy `test`, in text order. */
function membersOf(owner: ModelElement, ctx: ModelContext, test: (e: ModelElement) => boolean) {
	return ctx.elements
		.filter((e) => ctx.owners.get(e.key)?.key === owner.key && test(e))
		.sort((a, b) => a.span.start_byte - b.span.start_byte);
}

/** A name for a new transition: `idle_to_flying`, unique in the region it is written in. */
export function transitionName(
	from: ModelElement,
	to: ModelElement | 'done',
	region: ModelElement,
	ctx: ModelContext
): string {
	const part = (e: ModelElement | 'done') =>
		e === 'done'
			? 'done'
			: isIdentifier(e.label)
				? e.label
				: (words(e.label).join('_') || 'state').replace(/^([0-9])/, 's$1');
	const name = `${part(from)}_to_${part(to)}`;
	return unique(name, memberNames(region, ctx));
}

// ---------------------------------------------------------------- text plumbing

/** A change to a text, against its original offsets. */
interface Splice {
	from: number;
	to: number;
	insert: string;
}

/** Apply splices that don't overlap; at one offset, the earlier splice's text comes first. */
function applySplices(text: string, splices: Splice[]): string {
	const ordered = splices.map((s, i) => ({ ...s, i })).sort((a, b) => b.from - a.from || b.i - a.i);
	let out = text;
	for (const s of ordered) out = out.slice(0, s.from) + s.insert + out.slice(s.to);
	return out;
}

function rangeOf(text: string, e: { span: { start_byte: number; end_byte: number } }) {
	return [byteToUtf16(text, e.span.start_byte), byteToUtf16(text, e.span.end_byte)] as const;
}

function lineStart(text: string, at: number): number {
	return text.lastIndexOf('\n', at - 1) + 1;
}

function indentOf(text: string, at: number): string {
	return /^[ \t]*/.exec(text.slice(lineStart(text, at)))?.[0] ?? '';
}

function lineEnd(text: string, at: number): number {
	const end = text.indexOf('\n', at);
	return end < 0 ? text.length : end;
}

/** `lines` on new lines after the line containing `at`, indented like it. */
function linesAfter(text: string, at: number, lines: string[]): Splice {
	const end = lineEnd(text, at);
	const indent = indentOf(text, at);
	return { from: end, to: end, insert: lines.map((l) => `\n${indent}${l}`).join('') };
}

/** `lines` on new lines before the line containing `at`, indented like it. */
function linesBefore(text: string, at: number, lines: string[]): Splice {
	const start = lineStart(text, at);
	const indent = indentOf(text, at);
	return { from: start, to: start, insert: lines.map((l) => `${indent}${l}\n`).join('') };
}

/**
 * `members` as the last statements in the body of the declaration at
 * [from, to). A declaration ending in `;` gains a body; a short one-line
 * body stays on one line.
 */
function appendMembers(text: string, from: number, to: number, members: string[]): Splice | null {
	const head = headerEnd(text, from, to);
	if (!head) return null;
	const base = indentOf(text, from);
	const indent = base + INDENT;
	if (head.char === ';') {
		return {
			from: head.index,
			to: head.index + 1,
			insert: ` {\n${members.map((m) => `${indent}${m}\n`).join('')}${base}}`
		};
	}
	const open = head.index;
	const close = matchBrace(text, open);
	if (close < 0) return null;
	const inner = text.slice(open + 1, close);
	if (!inner.includes('\n')) {
		const content = inner.trim();
		const joined = members.join(' ');
		const length = lineEnd(text, close) - lineStart(text, open);
		if (length + joined.length + 2 <= INLINE_MAX) {
			return { from: open + 1, to: close, insert: ` ${content ? `${content} ` : ''}${joined} ` };
		}
		const lines = [...(content ? [content] : []), ...members];
		return {
			from: open + 1,
			to: close,
			insert: `${lines.map((l) => `\n${indent}${l}`).join('')}\n${base}`
		};
	}
	const own = /\n([ \t]+)\S/.exec(inner)?.[1] ?? indent;
	const closeLine = lineStart(text, close);
	if (/^[ \t]*$/.test(text.slice(closeLine, close))) {
		return { from: closeLine, to: closeLine, insert: members.map((m) => `${own}${m}\n`).join('') };
	}
	return {
		from: close,
		to: close,
		insert: `${members.map((m) => `\n${own}${m}`).join('')}\n${base}`
	};
}

/** A direct statement of a body, as UTF-16 offsets into the whole text. */
interface Statement {
	from: number;
	to: number;
	/** The statement with comments and nested bodies blanked. */
	masked: string;
}

/** The body of `element` and its direct statements matching `pattern` (anchored at a statement start). */
function statementsIn(
	text: string,
	element: { span: { start_byte: number; end_byte: number } },
	pattern: RegExp
): { body: { open: number; close: number } | null; found: Statement[] } {
	const [from, to] = rangeOf(text, element);
	const body = bodyOf(text, from, to);
	if (!body) return { body: null, found: [] };
	const masked = directText(text, body.open, body.close);
	// A statement starts the body, or follows a `;`, a body's `}` or a doc comment.
	const re = new RegExp(`(?<=^|[;}]|\\bdoc\\s*)(\\s*)(${pattern.source})`, 'g');
	const found: Statement[] = [];
	for (let m = re.exec(masked); m; m = re.exec(masked)) {
		const start = m.index + m[1]!.length;
		const end = start + m[2]!.length;
		found.push({ from: body.open + 1 + start, to: body.open + 1 + end, masked: m[2]! });
		re.lastIndex = end;
	}
	return { body, found };
}

/** One direct statement: `;`-terminated, or a declaration with a `{ … }` body. */
const STATEMENT = /[^;{}]*(?:;|\{\s*\}\s*;?)/;

function patchPlan(
	path: string,
	before: string,
	after: string,
	label: string,
	statement: string
): Plan {
	const steps: EditStep[] = [{ kind: 'patch', path, before, after }];
	return { label, statement, steps };
}

/** A condition or value as the emulator reads it; a message when it can't. */
function checkExpression(text: string, what: string): string | null {
	try {
		parseExpr(text);
		return null;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return `${what} "${text}" is not an expression: ${reason}`;
	}
}

// ---------------------------------------------------------------- states

/** The region a state belongs to: the machine or the state it is in. */
export function regionOf(state: ModelElement, ctx: ModelContext): ModelElement | undefined {
	return ctx.owners.get(state.key);
}

/** The state an `entry; then x;` in `region` starts in, as written. */
export function startOf(region: ModelElement, ctx: ModelContext): string | null {
	const text = ctx.textOf(region.file);
	if (text === undefined) return null;
	const { found } = statementsIn(text, region, /entry\s*;\s*then\s+[^;{}]+;/);
	const m = found[0] ? /then\s+([^;]+?)\s*;$/.exec(found[0].masked) : null;
	return m ? m[1]!.trim() : null;
}

/** States declared directly in `region`. */
export function statesOf(region: ModelElement, ctx: ModelContext): ModelElement[] {
	return membersOf(region, ctx, isState);
}

/**
 * Where a new state goes: after the last state of the region (and the
 * `accept … then …` lines that follow it, which belong to that state),
 * so states stay together above the transitions.
 */
function stateSplice(text: string, region: ModelElement, ctx: ModelContext, lines: string[]) {
	const states = statesOf(region, ctx);
	const last = states.at(-1);
	if (!last) return null;
	const [, end] = rangeOf(text, last);
	const { found } = statementsIn(text, region, /(?:accept|if|else|then)\b[^;{}]*;/);
	let after = end;
	for (const s of found) {
		if (s.from < after) continue;
		if (!/^\s*$/.test(text.slice(after, s.from).replace(/;/, ''))) break;
		after = s.to;
	}
	return linesAfter(text, after - 1, lines);
}

/** `entry; then x;` set to `name` in `region`: the existing one changed, or a new one. */
function startSplice(text: string, region: ModelElement, ctx: ModelContext, name: string) {
	const { found } = statementsIn(text, region, /entry\s*;\s*then\s+[^;{}]+;/);
	const existing = found[0];
	if (existing) {
		const m = /^(entry\s*;\s*then\s+)([^;]+?)(\s*;)$/.exec(existing.masked)!;
		const from = existing.from + m[1]!.length;
		return { splice: { from, to: from + m[2]!.length, insert: name }, line: null };
	}
	const line = `entry; then ${name};`;
	const first = statesOf(region, ctx)[0];
	if (first) {
		const [start] = rangeOf(text, first);
		return { splice: linesBefore(text, start, [line]), line };
	}
	return { splice: null, line };
}

/** Add a state to a machine or (nested) to a state; `initial` makes it where the region starts. */
export function planAddState(
	region: ModelElement,
	rawName: string,
	initial: boolean,
	ctx: ModelContext
): Plan | string {
	if (!rawName.trim()) return 'Give the new state a name.';
	const name = formatName(rawName);
	if (memberNames(region, ctx).includes(name)) return `${region.label} already has ${name}.`;
	const text = ctx.textOf(region.file);
	if (text === undefined) return `${region.file} is not in the project.`;
	const [from, to] = rangeOf(text, region);
	const statement = `state ${name};`;
	const splices: Splice[] = [];
	const append: string[] = [];
	if (initial) {
		const start = startSplice(text, region, ctx, name);
		if (start.splice) splices.push(start.splice);
		else append.push(start.line!);
	}
	const after = stateSplice(text, region, ctx, [statement]);
	if (after) splices.push(after);
	else append.push(statement);
	if (append.length) {
		const s = appendMembers(text, from, to, append);
		if (!s) return `Could not read the body of ${region.label}.`;
		splices.push(s);
	}
	return patchPlan(
		region.file,
		text,
		applySplices(text, splices),
		initial ? `Added state ${name}, where ${region.label} starts` : `Added state ${name}`,
		initial ? `${statement}\nentry; then ${name};` : statement
	);
}

/**
 * A value the machine (or action) keeps, which conditions and "Then do…"
 * read and set: `attribute count : Integer = 0;`, with the other values
 * at the top of the body.
 */
export function planAddValue(
	owner: ModelElement,
	rawName: string,
	type: string,
	value: string,
	ctx: ModelContext
): Plan | string {
	if (!rawName.trim()) return 'Give the value a name.';
	const name = formatName(rawName);
	if (memberNames(owner, ctx).includes(name)) return `${owner.label} already has ${name}.`;
	const text = ctx.textOf(owner.file);
	if (text === undefined) return `${owner.file} is not in the project.`;
	if (value.trim()) {
		const error = checkExpression(value.trim(), 'The starting value');
		if (error) return error;
	}
	const statement = `attribute ${name}${type.trim() ? ` : ${type.trim()}` : ''}${value.trim() ? ` = ${value.trim()}` : ''};`;
	const [from, to] = rangeOf(text, owner);
	const body = bodyOf(text, from, to);
	const multiline = !!body && text.slice(body.open, body.close).includes('\n');
	const values = statementsIn(
		text,
		owner,
		/(?:in\s+|out\s+|inout\s+)?attribute\b[^;{}]*(?:;|\{\s*\})/
	).found;
	const first = statementsIn(text, owner, /(?!doc\b)[A-Za-z]/).found[0];
	const splice = !multiline
		? appendMembers(text, from, to, [statement])
		: values.length
			? linesAfter(text, values.at(-1)!.to - 1, [statement])
			: first
				? linesBefore(text, first.from, [statement])
				: appendMembers(text, from, to, [statement]);
	if (!splice) return `Could not read the body of ${owner.label}.`;
	return patchPlan(
		owner.file,
		text,
		applySplices(text, [splice]),
		`Added value ${name} to ${owner.label}`,
		statement
	);
}

/** Make `state` the one its region starts in (`entry; then state;`). */
export function planSetStart(state: ModelElement, ctx: ModelContext): Plan | string {
	const region = regionOf(state, ctx);
	if (!region) return `${state.label} is not in a state machine.`;
	const text = ctx.textOf(state.file);
	if (text === undefined) return `${state.file} is not in the project.`;
	if (startOf(region, ctx) === state.name)
		return `${region.label} already starts in ${state.label}.`;
	const start = startSplice(text, region, ctx, state.name);
	let splice = start.splice;
	if (!splice) {
		const [from, to] = rangeOf(text, region);
		splice = appendMembers(text, from, to, [start.line!]);
	}
	if (!splice) return `Could not read the body of ${region.label}.`;
	return patchPlan(
		state.file,
		text,
		applySplices(text, [splice]),
		`${region.label} now starts in ${state.label}`,
		`entry; then ${state.name};`
	);
}

/** How the transition is triggered: "When…". */
export type Trigger =
	| { kind: 'signal'; signal: string }
	| { kind: 'change'; condition: string }
	| { kind: 'after'; seconds: string }
	| { kind: 'none' };

/** A transition as the form edits it: "When…", "Only if…", "Then do…". */
export interface TransitionSpec {
	trigger: Trigger;
	/** "Only if…": a condition, or empty. */
	guard: string;
	/** "Then do…": an action name, `x := value` assignments separated by `;`, or empty. */
	effect: string;
}

/**
 * The SysML of "Then do…": a name declares an action (`action greet`);
 * `x := e` assigns (`assign x := e`), several in one action body. Empty
 * stays empty. A message when it is neither.
 */
export function effectClause(effect: string): string | { error: string } {
	const text = effect.trim().replace(/;\s*$/, '');
	if (!text) return '';
	const parts = text
		.split(';')
		.map((p) => p.trim())
		.filter(Boolean);
	const assignments = parts.map((p) => /^(?:assign\s+)?([A-Za-z_][\w.]*)\s*:=\s*(.+)$/.exec(p));
	if (assignments.every(Boolean)) {
		for (const m of assignments) {
			const error = checkExpression(m![2]!, 'The value');
			if (error) return { error };
		}
		const statements = assignments.map((m) => `assign ${m![1]} := ${m![2]!.trim()}`);
		return statements.length === 1
			? statements[0]!
			: `action { ${statements.map((s) => `${s};`).join(' ')} }`;
	}
	if (parts.length === 1 && /^action\s+\S/.test(parts[0]!)) return parts[0]!;
	if (parts.length === 1 && words(parts[0]!).length) return `action ${actionName(parts[0]!)}`;
	return {
		error:
			'Write the name of what it does (like "greet"), or a value to set (like "count := count + 1").'
	};
}

/** What "Then do…" shows for an effect as written: `action greet` → greet, `assign x := 1` → x := 1. */
export function effectDisplay(written: string): string {
	const text = written.trim();
	const assigns = [...text.matchAll(/assign\s+([\w.]+)\s*:=\s*([^;}]+?)\s*(?:;|}|$)/g)];
	if (assigns.length && /^(action\s*\{|assign\b)/.test(text))
		return assigns.map((m) => `${m[1]} := ${m[2]}`).join('; ');
	const named = /^action\s+([A-Za-z_]\w*|'[^']*')\s*;?$/.exec(text);
	if (named) return named[1]!;
	return text;
}

/** The trigger, as `accept` writes it (without `accept`); a message when it is not valid. */
function triggerClause(
	trigger: Trigger,
	signalRef: string,
	seconds = 'SI::s'
): string | { error: string } {
	switch (trigger.kind) {
		case 'none':
			return '';
		case 'signal':
			if (!trigger.signal.trim())
				return { error: 'Say what it waits for, or choose another "When".' };
			return signalRef;
		case 'change': {
			const condition = trigger.condition.trim();
			if (!condition) return { error: 'Write the condition it waits for.' };
			const error = checkExpression(condition, 'The condition');
			return error ? { error } : `when ${condition}`;
		}
		case 'after': {
			const unit = seconds;
			seconds = trigger.seconds.trim();
			if (!/^\d+(\.\d+)?$/.test(seconds))
				return { error: 'Write how many seconds to wait, like 5.' };
			return `after ${seconds} [${unit}]`;
		}
	}
}

/** The form's fields for a transition as written (its statement's text). */
export function specOf(statement: string): TransitionSpec {
	const parts = transitionParts(statement);
	const raw = parts.trigger?.trim() ?? '';
	let trigger: Trigger = { kind: 'none' };
	const when = /^when\b\s*([\s\S]*)$/.exec(raw);
	const after = /^after\s+([\d.]+)\s*\[\s*(?:SI::)?s\s*\]$/.exec(raw);
	if (when) trigger = { kind: 'change', condition: when[1]!.trim() };
	else if (after) trigger = { kind: 'after', seconds: after[1]! };
	else if (raw) trigger = { kind: 'signal', signal: raw };
	return {
		trigger,
		guard: parts.guard?.trim() ?? '',
		effect: parts.effect ? effectDisplay(parts.effect) : ''
	};
}

/** A definition named `name` (simple or qualified), for a trigger's signal. */
export function findSignal(name: string, ctx: ModelContext): ModelElement | undefined {
	const simple = name.split('::').pop()!.replace(/^'|'$/g, '');
	return ctx.elements.find((e) => e.isDefinition && e.kind !== 'package' && e.label === simple);
}

/** The definitions a trigger can wait for: item defs first (signals), then the other kinds. */
export function signalChoices(ctx: ModelContext): ModelElement[] {
	const rank = (e: ModelElement) => (e.kind === 'item' ? 0 : e.kind === 'attribute' ? 1 : 2);
	return ctx.elements
		.filter(
			(e) =>
				e.isDefinition &&
				!e.file.startsWith('libraries/') &&
				['item', 'attribute', 'part', 'port', 'occurrence'].includes(e.kind)
		)
		.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** How seconds are written where `element` is: `s` under `import SI::*;`, else `SI::s`. */
function secondsUnit(element: ModelElement, ctx: ModelContext): string {
	for (const at of ownerChain(element, ctx)) {
		if (at.kind !== 'package') continue;
		const text = ctx.textOf(at.file);
		if (!text) continue;
		const [from, to] = rangeOf(text, at);
		if (/\bimport\s+(?:all\s+)?SI::(?:\*|s)\s*;/.test(text.slice(from, to))) return 's';
	}
	return 'SI::s';
}

/** The package that holds `element`, where a new signal is declared. */
function packageOf(element: ModelElement, ctx: ModelContext): ModelElement | undefined {
	for (let at = ctx.owners.get(element.key); at; at = ctx.owners.get(at.key)) {
		if (at.kind === 'package') return at;
	}
	return undefined;
}

/** The chain of owners of `e`, nearest first. */
function ownerChain(e: ModelElement, ctx: ModelContext): ModelElement[] {
	const out: ModelElement[] = [];
	for (let at = ctx.owners.get(e.key); at; at = ctx.owners.get(at.key)) out.push(at);
	return out;
}

/**
 * How `target` is written from inside `region`: its path from the innermost
 * region around `region` (itself included) that contains it. `on.busy`
 * from the machine, `busy` from inside `on`, `off` from inside `on`.
 */
export function referenceWithin(target: ModelElement, region: ModelElement, ctx: ModelContext) {
	const chain = [target, ...ownerChain(target, ctx)];
	const around = [region, ...ownerChain(region, ctx)];
	for (const r of around) {
		const at = chain.findIndex((c) => c.key === r.key);
		if (at > 0)
			return chain
				.slice(0, at)
				.reverse()
				.map((c) => c.name)
				.join('.');
	}
	return target.name;
}

/** `transition name first a accept T if g do e then b;` from its parts. */
export function transitionStatement(
	name: string | null,
	source: string,
	clauses: { trigger: string; guard: string; effect: string },
	target: string
): string {
	return [
		'transition',
		name,
		`first ${source}`,
		clauses.trigger && `accept ${clauses.trigger}`,
		clauses.guard && `if ${clauses.guard}`,
		clauses.effect && `do ${clauses.effect}`,
		`then ${target};`
	]
		.filter(Boolean)
		.join(' ');
}

/** The clauses of a spec as SysML, and the signal to declare when it is new. */
function clausesOf(
	spec: TransitionSpec,
	host: ModelElement,
	ctx: ModelContext,
	keep: { trigger?: string; effect?: string } = {}
): { trigger: string; guard: string; effect: string; newSignal: string | null } | string {
	let newSignal: string | null = null;
	let signalRef = '';
	if (spec.trigger.kind === 'signal') {
		const typed = spec.trigger.signal.trim();
		if (keep.trigger !== undefined && typed === keep.trigger) signalRef = typed;
		else if (typed) {
			const name = signalName(typed);
			if (!name) return 'Give the signal a name.';
			const existing = findSignal(name, ctx);
			if (existing)
				signalRef = name.includes('::')
					? name
					: referenceFrom(existing, host, ctx.owners, ctx.textOf);
			else {
				newSignal = name.split('::').pop()!;
				signalRef = newSignal;
			}
		}
	}
	const trigger = triggerClause(spec.trigger, signalRef, secondsUnit(host, ctx));
	if (typeof trigger !== 'string') return trigger.error;
	const guard = spec.guard.trim();
	if (guard) {
		const error = checkExpression(guard, 'The condition');
		if (error) return error;
	}
	const effect =
		keep.effect !== undefined && spec.effect.trim() === effectDisplay(keep.effect)
			? keep.effect
			: effectClause(spec.effect);
	if (typeof effect !== 'string') return effect.error;
	return { trigger, guard, effect, newSignal };
}

/** A splice declaring `item def Name;` in `pkg`, and its statement. */
function signalSplice(text: string, pkg: ModelElement, name: string): Splice | null {
	const [from, to] = rangeOf(text, pkg);
	return appendMembers(text, from, to, [`item def ${name};`]);
}

/**
 * A new transition from one state to another (or to `done`), written in the
 * source's region next to its other transitions. A trigger naming a signal
 * the model doesn't have declares it (`item def SwitchOn;`) in the machine's
 * package.
 */
export function planTransition(
	from: ModelElement,
	to: ModelElement | 'done',
	spec: TransitionSpec,
	ctx: ModelContext
): Plan | string {
	const region = regionOf(from, ctx);
	if (!region) return `${from.label} is not in a state machine.`;
	if (to !== 'done' && to.file !== from.file) return 'Both states must be in the same file.';
	const text = ctx.textOf(from.file);
	if (text === undefined) return `${from.file} is not in the project.`;
	const clauses = clausesOf(spec, region, ctx);
	if (typeof clauses === 'string') return clauses;
	const name = transitionName(from, to, region, ctx);
	const target = to === 'done' ? 'done' : referenceWithin(to, region, ctx);
	const statement = transitionStatement(name, from.name, clauses, target);

	const splices: Splice[] = [];
	if (clauses.newSignal) {
		const pkg = packageOf(region, ctx);
		if (!pkg || pkg.file !== from.file)
			return `There is no package to declare ${clauses.newSignal} in; add it as an item def first.`;
		const s = signalSplice(text, pkg, clauses.newSignal);
		if (!s) return `Could not read the body of ${pkg.label}.`;
		splices.push(s);
	}
	const { found } = statementsIn(text, region, /transition\b[^;{}]*(?:\{\s*\}[^;{}]*)*;/);
	const last = found.at(-1);
	const [rFrom, rTo] = rangeOf(text, region);
	const inline = (() => {
		const body = bodyOf(text, rFrom, rTo);
		return !body || !text.slice(body.open, body.close).includes('\n');
	})();
	if (last && !inline) splices.push(linesAfter(text, last.to - 1, [statement]));
	else {
		const after = !inline ? stateSplice(text, region, ctx, [statement]) : null;
		const s = after ?? appendMembers(text, rFrom, rTo, [statement]);
		if (!s) return `Could not read the body of ${region.label}.`;
		splices.push(s);
	}
	const toLabel = to === 'done' ? 'the end' : to.label;
	return patchPlan(
		from.file,
		text,
		applySplices(text, splices),
		`Added a transition from ${from.label} to ${toLabel}`,
		(clauses.newSignal ? `item def ${clauses.newSignal};\n` : '') + statement
	);
}

/** The text of a transition (or succession) drawn as an edge, as UTF-16 offsets. */
export interface EdgeSource {
	file: string;
	start_byte: number;
	end_byte?: number;
}

function sourceRange(text: string, element: EdgeSource): [number, number] | null {
	if (element.end_byte === undefined) return null;
	return [byteToUtf16(text, element.start_byte), byteToUtf16(text, element.end_byte)];
}

/** The written transition at `element`, and the form's fields for it. */
export function readTransition(element: EdgeSource, ctx: ModelContext) {
	const text = ctx.textOf(element.file);
	const range = text === undefined ? null : sourceRange(text, element);
	if (!text || !range) return null;
	const statement = text.slice(...range);
	return { statement, spec: specOf(statement), parts: transitionParts(statement) };
}

/**
 * Change a transition's trigger, guard and effect. It keeps its name, its
 * source as written and its target; a shorthand `accept T then b;` is
 * rewritten in full, with `source` (the state it leaves) after `first`.
 */
export function planEditTransition(
	element: EdgeSource,
	source: ModelElement,
	spec: TransitionSpec,
	named: string | null,
	ctx: ModelContext
): Plan | string {
	const text = ctx.textOf(element.file);
	const range = text === undefined ? null : sourceRange(text, element);
	if (!text || !range) return 'This transition was not found in the text.';
	const written = text.slice(...range);
	const parts = transitionParts(written);
	if (!parts.target) return 'This transition has no target written; change it in the text.';
	const region = regionOf(source, ctx);
	if (!region) return `${source.label} is not in a state machine.`;
	const clauses = clausesOf(spec, region, ctx, { trigger: parts.trigger, effect: parts.effect });
	if (typeof clauses === 'string') return clauses;
	const isTransition = /^\s*transition\b/.test(written);
	const first = parts.first ?? (isTransition && !named ? parts.head : undefined) ?? source.name;
	const statement = transitionStatement(named, first, clauses, parts.target);
	const splices: Splice[] = [{ from: range[0], to: range[1], insert: statement }];
	if (clauses.newSignal) {
		const pkg = packageOf(region, ctx);
		const s = pkg && pkg.file === element.file ? signalSplice(text, pkg, clauses.newSignal) : null;
		if (!s)
			return `There is no package to declare ${clauses.newSignal} in; add it as an item def first.`;
		splices.push(s);
	}
	return patchPlan(
		element.file,
		text,
		applySplices(text, splices),
		`Changed the transition from ${source.label}`,
		statement
	);
}

/** "When entering", "While in", "When leaving": a state's `entry`, `do` and `exit` actions. */
export type StateActionKind = 'entry' | 'do' | 'exit';

const ACTION_ORDER: StateActionKind[] = ['entry', 'do', 'exit'];
const stateActionPattern = (kind: StateActionKind) =>
	new RegExp(`${kind}\\b(?!\\s*;)${STATEMENT.source}`);

/** A state's entry, do and exit actions, as "Then do…" shows them. */
export function stateActions(
	state: ModelElement,
	ctx: ModelContext
): Record<StateActionKind, string> {
	const text = ctx.textOf(state.file) ?? '';
	const out = { entry: '', do: '', exit: '' };
	for (const kind of ACTION_ORDER) {
		const { found } = statementsIn(text, state, stateActionPattern(kind));
		const s = found[0];
		if (s)
			out[kind] = effectDisplay(
				text
					.slice(s.from + kind.length, s.to)
					.trim()
					.replace(/;$/, '')
			);
	}
	return out;
}

/** Set (or, with an empty `action`, remove) what a state does on entry, while in it, or on exit. */
export function planStateAction(
	state: ModelElement,
	kind: StateActionKind,
	action: string,
	ctx: ModelContext
): Plan | string {
	const text = ctx.textOf(state.file);
	if (text === undefined) return `${state.file} is not in the project.`;
	const clause = effectClause(action);
	if (typeof clause !== 'string') return clause.error;
	const word = { entry: 'when entering', do: 'while in', exit: 'when leaving' }[kind];
	const existing = statementsIn(text, state, stateActionPattern(kind)).found[0];
	const statement = clause ? `${kind} ${clause}${clause.endsWith('}') ? '' : ';'}` : '';
	if (!clause) {
		if (!existing) return `${state.label} does nothing ${word} it.`;
		return patchPlan(
			state.file,
			text,
			removeStatement(text, existing.from, existing.to),
			`${state.label} no longer does anything ${word} it`,
			text.slice(existing.from, existing.to)
		);
	}
	let splice: Splice | null;
	if (existing) splice = { from: existing.from, to: existing.to, insert: statement };
	else {
		const others = ACTION_ORDER.map((k) => ({
			k,
			s: statementsIn(text, state, stateActionPattern(k)).found[0]
		})).filter((o) => o.s);
		const later = others.find((o) => ACTION_ORDER.indexOf(o.k) > ACTION_ORDER.indexOf(kind));
		const earlier = others
			.filter((o) => ACTION_ORDER.indexOf(o.k) < ACTION_ORDER.indexOf(kind))
			.at(-1);
		const [from, to] = rangeOf(text, state);
		const body = bodyOf(text, from, to);
		const multiline = !!body && text.slice(body.open, body.close).includes('\n');
		if (multiline && later) splice = linesBefore(text, later.s!.from, [statement]);
		else if (multiline && earlier) splice = linesAfter(text, earlier.s!.to - 1, [statement]);
		else if (later) splice = { from: later.s!.from, to: later.s!.from, insert: `${statement} ` };
		else if (earlier) splice = { from: earlier.s!.to, to: earlier.s!.to, insert: ` ${statement}` };
		else {
			// Before the first statement that isn't the doc; else at the end.
			const first = multiline ? statementsIn(text, state, /(?!doc\b)[A-Za-z]/).found[0] : undefined;
			splice = first
				? linesBefore(text, first.from, [statement])
				: appendMembers(text, from, to, [statement]);
		}
	}
	if (!splice) return `Could not read the body of ${state.label}.`;
	return patchPlan(
		state.file,
		text,
		applySplices(text, [splice]),
		`${state.label} now does ${effectDisplay(clause)} ${word} it`,
		statement
	);
}

// ---------------------------------------------------------------- action flows

/** One end of a succession: an action or control node, or the flow's start or done. */
export type FlowEnd = ModelElement | 'start' | 'done';

/** The innermost action (or definition) holding both ends, where a succession between them is written. */
export function flowOwner(a: FlowEnd, b: FlowEnd, ctx: ModelContext): ModelElement | undefined {
	const ends = [a, b].filter((e): e is ModelElement => typeof e !== 'string');
	if (!ends.length) return undefined;
	const [first, second] = ends;
	const chain = ownerChain(first!, ctx);
	if (!second) return chain[0];
	const other = new Set(ownerChain(second, ctx).map((e) => e.key));
	return chain.find((o) => other.has(o.key) && o.kind !== 'package');
}

/** `then` statements that begin a declaration (`then action b { … }`): removing the succession keeps the node. */
const DECLARING_THEN =
	/^then\s+(?=(?:action|decide|merge|fork|join|perform|accept|send|assign|state)\b)/;

/** The decision `decide` statement and its branches (`if g then x;` / `else x;`) right after it. */
function branchesAfter(text: string, decide: ModelElement, owner: ModelElement) {
	const [, end] = rangeOf(text, decide);
	const { found } = statementsIn(text, owner, /(?:if\b[^;{}]*\bthen\b[^;{}]*|else\b[^;{}]*);/);
	const branches: Statement[] = [];
	let at = end;
	for (const s of found) {
		if (s.from < at) continue;
		if (!/^[\s;]*$/.test(text.slice(at, s.from))) break;
		branches.push(s);
		at = s.to;
	}
	return { end, branches };
}

/**
 * A succession from one node to another: `first a then b;` beside the
 * flow's other successions; `start` and `done` are the flow's own. From a
 * decision it is a branch, written right after the `decide` with its guard
 * (`if hot then pour;`), or `else pour;` without one.
 */
export function planSuccession(
	from: FlowEnd,
	to: FlowEnd,
	guard: string | null,
	ctx: ModelContext
): Plan | string {
	if (from === 'done' || to === 'start') return 'A flow ends at done and begins at start.';
	const owner = flowOwner(from, to, ctx);
	if (!owner) return 'These are not steps of the same action.';
	const text = ctx.textOf(owner.file);
	if (text === undefined) return `${owner.file} is not in the project.`;
	const name = (e: FlowEnd) => (typeof e === 'string' ? e : referenceWithin(e, owner, ctx));
	const label = (e: FlowEnd) => (typeof e === 'string' ? e : e.label);
	const a = name(from);
	const b = name(to);

	if (typeof from !== 'string' && from.kind === 'decision_node') {
		const condition = (guard ?? '').trim();
		if (condition) {
			const error = checkExpression(condition, 'The condition');
			if (error) return error;
		}
		const { end, branches } = branchesAfter(text, from, owner);
		const otherwise = branches.find((s) => /^else\b/.test(s.masked));
		if (!condition && otherwise) return `${from.label} already has an "otherwise" branch.`;
		const statement = condition ? `if ${condition} then ${b};` : `else ${b};`;
		const indent = indentOf(text, rangeOf(text, from)[0]) + INDENT;
		let splice: Splice;
		if (condition && otherwise) splice = linesBefore(text, otherwise.from, [statement]);
		else {
			const after = branches.at(-1)?.to ?? end;
			const lineEndAt = lineEnd(text, after - 1);
			splice = { from: lineEndAt, to: lineEndAt, insert: `\n${indent}${statement}` };
		}
		return patchPlan(
			owner.file,
			text,
			applySplices(text, [splice]),
			condition
				? `${from.label} now goes to ${label(to)} if ${condition}`
				: `${from.label} otherwise goes to ${label(to)}`,
			statement
		);
	}

	const statement = `first ${a} then ${b};`;
	const { found } = statementsIn(text, owner, /first\b[^;{}]*;/);
	if (found.some((s) => s.masked.replace(/\s+/g, ' ') === statement))
		return `${label(from)} already goes to ${label(to)}.`;
	const [oFrom, oTo] = rangeOf(text, owner);
	const splice =
		successionSplice(text, owner, [statement]) ?? appendMembers(text, oFrom, oTo, [statement]);
	if (!splice) return `Could not read the body of ${owner.label}.`;
	const what =
		from === 'start'
			? `${owner.label} now starts with ${label(to)}`
			: to === 'done'
				? `${owner.label} now ends after ${label(from)}`
				: `${label(from)} is now followed by ${label(to)}`;
	return patchPlan(owner.file, text, applySplices(text, [splice]), what, statement);
}

/** Whether the body of `element` spans lines (else new statements stay on its line). */
function multilineBody(text: string, element: ModelElement): boolean {
	const [from, to] = rangeOf(text, element);
	const body = bodyOf(text, from, to);
	return !!body && text.slice(body.open, body.close).includes('\n');
}

/** After the flow's last `first … then …;`, so successions stay together. */
function successionSplice(text: string, owner: ModelElement, lines: string[]): Splice | null {
	if (!multilineBody(text, owner)) return null;
	const last = statementsIn(text, owner, /first\b[^;{}]*;/).found.at(-1);
	return last ? linesAfter(text, last.to - 1, lines) : null;
}

/**
 * After the flow's last node (and the branches or `then` lines that follow
 * it, which belong to it), so nodes stay together above the successions.
 */
function nodeSplice(
	text: string,
	owner: ModelElement,
	ctx: ModelContext,
	lines: string[]
): Splice | null {
	if (!multilineBody(text, owner)) return null;
	const last = membersOf(owner, ctx, isFlowNode).at(-1);
	if (!last) return null;
	const [, end] = rangeOf(text, last);
	const { found } = statementsIn(text, owner, /(?:if|else|then)\b[^;{}]*;/);
	let after = end;
	for (const s of found) {
		if (s.from < after) continue;
		if (!/^\s*$/.test(text.slice(after, s.from).replace(/;/, ''))) break;
		after = s.to;
	}
	return linesAfter(text, after - 1, lines);
}

/** What the Add form can put in an action flow. */
export type FlowNodeKind = 'action' | 'decide' | 'merge' | 'fork' | 'join';

/** Add an action or control node to `owner`; `start` also makes the flow begin with it. */
export function planAddFlowNode(
	owner: ModelElement,
	kind: FlowNodeKind,
	rawName: string,
	start: boolean,
	ctx: ModelContext
): Plan | string {
	if (!rawName.trim()) return 'Give it a name.';
	const name = formatName(rawName);
	if (memberNames(owner, ctx).includes(name)) return `${owner.label} already has ${name}.`;
	const text = ctx.textOf(owner.file);
	if (text === undefined) return `${owner.file} is not in the project.`;
	const statement = `${kind} ${name};`;
	const succession = `first start then ${name};`;
	const members = [statement, ...(start ? [succession] : [])];
	const [from, to] = rangeOf(text, owner);
	const splices: Splice[] = [];
	const node = nodeSplice(text, owner, ctx, [statement]);
	const append = node ? [] : [statement];
	if (node) splices.push(node);
	if (start) {
		const s = successionSplice(text, owner, [succession]);
		if (s) splices.push(s);
		else append.push(succession);
	}
	if (append.length) {
		const s = appendMembers(text, from, to, append);
		if (!s) return `Could not read the body of ${owner.label}.`;
		splices.push(s);
	}
	const splice = splices;
	const what = { action: 'action', decide: 'decision', merge: 'merge', fork: 'fork', join: 'join' }[
		kind
	];
	return patchPlan(
		owner.file,
		text,
		applySplices(text, splice),
		start ? `Added ${what} ${name}, where ${owner.label} starts` : `Added ${what} ${name}`,
		members.join('\n')
	);
}

/** Change a decision branch's guard: `if g then x;`, or `else x;` when empty. */
export function planEditBranch(
	element: EdgeSource,
	guard: string,
	ctx: ModelContext
): Plan | string {
	const text = ctx.textOf(element.file);
	const range = text === undefined ? null : sourceRange(text, element);
	if (!text || !range) return 'This branch was not found in the text.';
	const written = text.slice(...range);
	const target = /^(?:if\b[\s\S]*?\bthen|else)\s+([\s\S]+?)\s*;?\s*$/.exec(written)?.[1];
	if (!target) return 'This line is not a decision branch; change it in the text.';
	const condition = guard.trim();
	if (condition) {
		const error = checkExpression(condition, 'The condition');
		if (error) return error;
	}
	const statement = condition ? `if ${condition} then ${target};` : `else ${target};`;
	return patchPlan(
		element.file,
		text,
		applySplices(text, [{ from: range[0], to: range[1], insert: statement }]),
		condition
			? `The branch to ${target} now needs ${condition}`
			: `The branch to ${target} is now "otherwise"`,
		statement
	);
}

/** The guard of a decision branch as written (empty for `else`), or null when it isn't one. */
export function branchGuard(element: EdgeSource, ctx: ModelContext): string | null {
	const text = ctx.textOf(element.file);
	const range = text === undefined ? null : sourceRange(text, element);
	if (!text || !range) return null;
	const written = text.slice(...range).trim();
	if (/^else\b/.test(written)) return '';
	return /^if\s+([\s\S]+?)\s+then\b/.exec(written)?.[1] ?? null;
}

// ---------------------------------------------------------------- removing

/**
 * What removing a drawn transition or succession takes out of the text: the
 * statement; with `entry;` before an initial `then x;`; only the `then` of
 * `then action b;` (b stays).
 */
function edgeRemoval(text: string, element: EdgeSource): [number, number] | null {
	const range = sourceRange(text, element);
	if (!range) return null;
	const [from, to] = range;
	const written = text.slice(from, to);
	const declaring = DECLARING_THEN.exec(written);
	if (declaring) return [from, from + declaring[0].length];
	if (/^then\b/.test(written)) {
		const before = text.slice(0, from);
		const entry = /entry\s*;\s*$/.exec(before);
		if (entry) return [entry.index, to];
	}
	return [from, to];
}

/** Remove ranges (merged where only blanks separate them), each with its line when nothing else is on it. */
function removeRanges(text: string, ranges: [number, number][]): string {
	const merged: [number, number][] = [];
	for (const r of [...ranges].sort((a, b) => a[0] - b[0])) {
		const last = merged.at(-1);
		if (last && (r[0] <= last[1] || /^\s*$/.test(text.slice(last[1], r[0])))) {
			last[1] = Math.max(last[1], r[1]);
		} else merged.push([r[0], r[1]]);
	}
	let out = text;
	for (const [from, to] of merged.reverse()) {
		// Only the `then ` of `then action b;`: b stays where it is.
		out = /^then\s+$/.test(text.slice(from, to))
			? out.slice(0, from) + out.slice(to)
			: removeStatement(out, from, to);
	}
	return out;
}

/** Remove a transition or succession drawn as an edge. */
export function planRemoveEdge(
	element: EdgeSource,
	what: string,
	ctx: ModelContext
): Plan | string {
	const text = ctx.textOf(element.file);
	if (text === undefined) return `${element.file} is not in the project.`;
	const range = edgeRemoval(text, element);
	if (!range) return 'This line was not found in the text.';
	const shown = text.slice(...(sourceRange(text, element) ?? range));
	return patchPlan(element.file, text, removeRanges(text, [range]), what, shown);
}

/**
 * Remove a state or a step of a flow together with the transitions and
 * successions drawn to and from it (`edges`), so nothing is left pointing
 * at it. A step written as `then action a;` takes its `then` with it.
 */
export function planRemoveNode(
	element: ModelElement,
	edges: EdgeSource[],
	ctx: ModelContext
): Plan | string {
	const text = ctx.textOf(element.file);
	if (text === undefined) return `${element.file} is not in the project.`;
	const [from, to] = rangeOf(text, element);
	const ranges: [number, number][] = [[from, to]];
	const before = /then\s+$/.exec(text.slice(lineStart(text, from), from));
	if (before) ranges.push([from - before[0].length, from]);
	let count = 0;
	for (const edge of edges) {
		if (edge.file !== element.file) continue;
		const r = edgeRemoval(text, edge);
		if (!r || (r[0] >= from && r[1] <= to)) continue;
		// `then action a;` declares the element: removing the element covers it.
		const whole = sourceRange(text, edge);
		if (whole && whole[0] <= from && whole[1] >= to) continue;
		ranges.push(r);
		count++;
	}
	const statement = text.slice(from, to);
	const also = count ? ` and ${count === 1 ? 'the line' : `${count} lines`} to and from it` : '';
	return patchPlan(
		element.file,
		text,
		removeRanges(text, ranges),
		`Deleted ${element.label}${also}`,
		statement
	);
}

// ---------------------------------------------------------------- for the forms

/** Whether an action flow says where it starts (`first start …`). */
export function flowStarts(owner: ModelElement, ctx: ModelContext): boolean {
	const text = ctx.textOf(owner.file);
	return !!text && statementsIn(text, owner, /first\s+start\b[^;{}]*;/).found.length > 0;
}

/** A free name for a new control node: `decision1`, `merge2`, …. */
export function suggestName(owner: ModelElement, base: string, ctx: ModelContext): string {
	const taken = new Set(memberNames(owner, ctx));
	for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

/**
 * The values a condition or action in `element` can read: the attributes of
 * it and of everything around it, nearest first, up to its package.
 */
export function valuesAround(element: ModelElement, ctx: ModelContext): string[] {
	const names: string[] = [];
	for (const at of [element, ...ownerChain(element, ctx)]) {
		if (at.kind === 'package') break;
		for (const e of membersOf(at, ctx, (m) => m.kind === 'attribute' && !m.isDefinition))
			if (!names.includes(e.name)) names.push(e.name);
	}
	return names;
}
