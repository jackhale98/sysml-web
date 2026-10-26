/**
 * State machines (`StateMachine[]`, what the emulator and its diagram run)
 * read from the toolkit's model, in the worker.
 *
 * A machine is a `state def`, or a `state` / `exhibit state` usage that is
 * not inside another state, with states or transitions of its own. Its
 * structure comes from the model:
 * - states and their nesting (a state's `name` is its path in the machine,
 *   `on.motors.idle`), `parallel`, docs, attributes as variables (with
 *   direction, type and default value);
 * - each transition's source and target as the toolkit resolves them
 *   (`derived:source` / `derived:target`), so `then done` is the library's
 *   `done` (the region's final state) and a qualified target is the state
 *   it names, not a name matched by hand.
 *
 * Its texts come from the source, in the emulator's conventions (the model
 * has no source text for expressions): a trigger is the signal, `when …` or
 * `after …` / `at …`; a guard is its expression as written; an action or
 * effect that assigns is `assign x := e` statements joined by `; `, else the
 * named action or the text as written.
 *
 * Reads: one `rows` call for the transitions' ends and parts and one for
 * `isParallel`, a few ms on the demo; none of them costs the whole-model
 * derivation pass (a succession's `targetFeature` would, so the initial
 * `entry; then x;` target is found by name, as is any end the toolkit could
 * not resolve).
 */
import type { StateMachine } from '../types';
import type { TkRef, TkSession } from './api';
import type { ElementRecord, ExtractedModel, UnitInfo } from './model';

type MachineState = StateMachine['states'][number];
type MachineTransition = StateMachine['transitions'][number];
type Variable = StateMachine['variables'][number];

const STATE_METACLASSES = new Set(['StateDefinition', 'StateUsage', 'ExhibitStateUsage']);
const FINAL_STATE = 'States::StateAction::done';

type Row = Record<string, unknown>;

export function extractMachines(
	session: TkSession,
	extracted: ExtractedModel,
	units: Map<string, UnitInfo>
): StateMachine[] {
	const { elements, byId } = extracted;
	const children = new Map<string, ElementRecord[]>();
	for (const record of elements) {
		if (!record.ownerId) continue;
		const list = children.get(record.ownerId) ?? [];
		list.push(record);
		children.set(record.ownerId, list);
	}
	const insideState = (record: ElementRecord) => {
		for (let at = record.ownerId; at; at = byId.get(at)?.ownerId ?? null) {
			const owner = byId.get(at);
			if (owner && STATE_METACLASSES.has(owner.metaclass)) return true;
		}
		return false;
	};
	const candidates = elements.filter(
		(r) => STATE_METACLASSES.has(r.metaclass) && r.name && !insideState(r)
	);
	if (!candidates.length) return [];

	const rows = (ids: string[], fields: string[]): Map<string, Row> => {
		const out = new Map<string, Row>();
		if (!ids.length) return out;
		const read = JSON.parse(
			session.rows(JSON.stringify(ids), JSON.stringify(fields))
		) as (Row | null)[];
		read.forEach((row, i) => row && out.set(ids[i]!, row));
		return out;
	};
	const parallel = rows(
		elements.filter((r) => STATE_METACLASSES.has(r.metaclass)).map((r) => r.id),
		['property:isParallel']
	);
	const transitions = rows(
		elements.filter((r) => r.metaclass === 'TransitionUsage').map((r) => r.id),
		[
			'derived:source',
			'derived:target',
			'derived:triggerAction',
			'derived:guardExpression',
			'derived:effectAction'
		]
	);
	const finals = new Map<string, boolean>();
	const isFinal = (id: string) => {
		let final = finals.get(id);
		if (final === undefined) {
			final = rows([id], ['qualifiedName']).get(id)?.qualifiedName === FINAL_STATE;
			finals.set(id, final);
		}
		return final;
	};

	const text = (record: ElementRecord): string => {
		const unit = units.get(record.path);
		const { from, to } = record.span;
		return unit && from !== undefined && to !== undefined ? unit.original.text.slice(from, to) : '';
	};
	const context: Context = {
		children: (id) => children.get(id) ?? [],
		text,
		isParallel: (id) => parallel.get(id)?.['property:isParallel'] === true,
		transition: (id) => transitions.get(id),
		isFinal
	};

	const machines: StateMachine[] = [];
	for (const record of candidates) {
		const owner = record.ownerId ? byId.get(record.ownerId) : undefined;
		// A usage sees the attributes of the part (or other usage, definition) it is in.
		const ownerVariables =
			record.metaclass !== 'StateDefinition' && owner && owner.kind !== 'package'
				? context.children(owner.id).filter(isVariable)
				: [];
		const machine = new Builder(context, ownerVariables).build(record);
		if (machine) machines.push(machine);
	}
	return machines;
}

interface Context {
	children(id: string): ElementRecord[];
	text(record: ElementRecord): string;
	isParallel(id: string): boolean;
	transition(id: string): Row | undefined;
	isFinal(id: string): boolean;
}

const isVariable = (r: ElementRecord) => r.metaclass === 'AttributeUsage' && !!r.name;
const isState = (r: ElementRecord) =>
	(r.metaclass === 'StateUsage' || r.metaclass === 'ExhibitStateUsage') && !!r.name;

const ref = (value: unknown): string | null =>
	value && typeof value === 'object' && '@id' in value ? (value as TkRef)['@id'] : null;
const refs = (value: unknown): string[] =>
	Array.isArray(value) ? value.map(ref).filter((id): id is string => !!id) : [];

const path = (parent: string | undefined, name: string) => (parent ? `${parent}.${name}` : name);

interface Pending {
	/** The region the transition is written in (its parent state's path; none at the top). */
	scope: string | undefined;
	line: number;
	context: string;
	name?: string;
	from: { path: string } | { text: string };
	to: { path: string } | { text: string };
	trigger?: string;
	guard?: string;
	effect?: string;
}

class Builder {
	private readonly states: MachineState[] = [];
	private readonly pending: Pending[] = [];
	private readonly variables: Variable[] = [];
	private readonly warnings: string[] = [];
	/** Element id → state path. */
	private readonly paths = new Map<string, string>();

	constructor(
		private readonly cx: Context,
		ownerVariables: ElementRecord[]
	) {
		for (const v of ownerVariables) this.addVariable(v);
	}

	build(record: ElementRecord): StateMachine | null {
		this.region(record, undefined);
		// A plain `state x { }` with no substates or transitions is a state, not a machine.
		if (!this.states.length && !this.pending.length) return null;
		const transitions = this.resolve();
		const qualified = record.qualifiedName;
		return {
			name: record.written ?? record.name!,
			...(qualified?.includes('::') ? { qualifiedName: qualified } : {}),
			file: record.path,
			line: record.span.start_row,
			...(record.docs.length ? { doc: record.docs.join('\n\n') } : {}),
			...(this.cx.isParallel(record.id) ? { parallel: true } : {}),
			states: this.states,
			transitions,
			variables: this.variables,
			...(this.warnings.length ? { warnings: this.warnings } : {})
		};
	}

	private addVariable(record: ElementRecord) {
		if (this.variables.some((v) => v.name === record.name)) return;
		const v: Variable = { name: record.written ?? record.name! };
		// The type as resolved, else as written (`Real` without its import).
		const type = record.type ?? writtenType(record.header);
		if (type) v.type = type;
		if (record.value !== null) v.value = record.value;
		if (record.direction) v.direction = record.direction;
		if (record.docs.length) v.doc = record.docs.join('\n\n');
		this.variables.push(v);
	}

	/** The states, variables and transitions of one state body. */
	private region(owner: ElementRecord, parent: string | undefined) {
		const members = this.cx.children(owner.id);
		for (const member of members) if (isVariable(member)) this.addVariable(member);

		// `entry; then off;`: the region's initial pseudo-state.
		const start = members.findIndex(
			(m) => m.metaclass === 'SuccessionAsUsage' && /^then\b/.test(this.cx.text(m))
		);
		if (start >= 0) {
			const succession = members[start]!;
			const target = clean(this.cx.text(succession))
				.replace(/^then\b/, '')
				.replace(/;$/, '')
				.trim();
			const entry = members
				.slice(0, start)
				.reverse()
				.find((m) => m.membership === 'StateSubactionMembership');
			const line = (entry ?? succession).span.start_row;
			const initial = path(parent, 'entry');
			this.states.push({
				name: initial,
				label: 'entry',
				kind: 'initial',
				...(parent ? { parent } : {}),
				line
			});
			this.pending.push({
				scope: parent,
				line,
				context: 'transition',
				from: { path: initial },
				to: { text: target }
			});
		}

		let previous: string | undefined;
		const transitions: ElementRecord[] = [];
		const previousOf = new Map<string, string | undefined>();
		for (const member of members) {
			if (isState(member)) {
				const id = path(parent, member.written ?? member.name!);
				this.paths.set(member.id, id);
				const state: MachineState = {
					name: id,
					label: member.written ?? member.name!,
					kind: 'state',
					...(parent ? { parent } : {}),
					...(this.cx.isParallel(member.id) ? { parallel: true } : {}),
					...this.actions(member),
					...(member.docs.length ? { doc: member.docs.join('\n\n') } : {}),
					line: member.span.start_row
				};
				this.states.push(state);
				previous = id;
				this.region(member, id);
			} else if (member.metaclass === 'TransitionUsage') {
				transitions.push(member);
				previousOf.set(member.id, previous);
			}
		}
		for (const t of transitions) this.transition(t, parent, previousOf.get(t.id));
	}

	/** `entry` / `do` / `exit` actions of a state, as the emulator reads them. */
	private actions(state: ElementRecord): Pick<MachineState, 'entry' | 'do' | 'exit'> {
		const out: Pick<MachineState, 'entry' | 'do' | 'exit'> = {};
		for (const member of this.cx.children(state.id)) {
			if (member.membership !== 'StateSubactionMembership') continue;
			const written = clean(this.cx.text(member));
			const kind = /^(entry|do|exit)\b/.exec(written)?.[1] as 'entry' | 'do' | 'exit' | undefined;
			if (!kind || out[kind]) continue;
			const source = written.slice(kind.length).replace(/;$/, '');
			const action = actionText(source);
			if (action) out[kind] = action;
			this.notRun(`${kind} action of \`${state.written ?? state.name}\``, source);
		}
		return out;
	}

	/** Note the steps of an action the emulator does not run (it runs assignments only). */
	private notRun(context: string, action: string) {
		for (const step of skippedSteps(action)) {
			this.warnings.push(`${context}: \`${step}\` is not run; only assignments are`);
		}
	}

	private transition(record: ElementRecord, scope: string | undefined, previous?: string) {
		const row = this.cx.transition(record.id) ?? {};
		const parts = transitionParts(this.cx.text(record));
		const context = record.name ? `transition ${record.written ?? record.name}` : 'transition';
		const base = {
			scope,
			line: record.span.start_row,
			context,
			...(record.name ? { name: record.written ?? record.name } : {})
		};
		const sourceId = ref(row['derived:source']);
		const targetId = ref(row['derived:target']);
		const hasTrigger = refs(row['derived:triggerAction']).length > 0 && !!parts.trigger;
		const hasGuard = refs(row['derived:guardExpression']).length > 0 && !!parts.guard;
		const hasEffect = refs(row['derived:effectAction']).length > 0 && !!parts.effect;

		let from: Pending['from'] | null = null;
		const sourcePath = sourceId ? this.paths.get(sourceId) : undefined;
		// The source as written: after `first`, or the shorthand `transition a then b`.
		const sourceText = parts.first ?? (record.name ? undefined : parts.head);
		if (sourcePath) from = { path: sourcePath };
		else if (sourceText) {
			// `transition initial then off;` (an unknown name, nothing else): the initial transition.
			const initial = path(scope, 'entry');
			if (
				!parts.first &&
				!hasTrigger &&
				!hasGuard &&
				!this.states.some((s) => s.name === initial)
			) {
				this.states.push({
					name: initial,
					label: 'entry',
					kind: 'initial',
					...(scope ? { parent: scope } : {}),
					line: base.line
				});
				from = { path: initial };
			} else from = { text: sourceText };
		} else if (previous) {
			// `accept Go then b;` after `state a;`: from the state declared before it.
			from = { path: previous };
		}
		if (!from) {
			this.warnings.push(`${context}: no source state`);
			return;
		}

		let to: Pending['to'];
		const targetPath = targetId ? this.paths.get(targetId) : undefined;
		if (targetPath) to = { path: targetPath };
		else if (targetId && this.cx.isFinal(targetId)) to = { text: 'done' };
		else to = { text: parts.target ?? '' };

		if (hasEffect) this.notRun(`effect of ${context}`, parts.effect!);
		this.pending.push({
			...base,
			from,
			to,
			...(hasTrigger ? { trigger: triggerText(parts.trigger!) } : {}),
			...(hasGuard ? { guard: parts.guard! } : {}),
			...(hasEffect && actionText(parts.effect!) ? { effect: actionText(parts.effect!)! } : {})
		});
	}

	/**
	 * A state written by name from inside `scope`: the innermost enclosing
	 * region that declares it wins; `done` is the scope's final state. Unknown
	 * names become placeholder states, with a warning.
	 */
	private resolveName(raw: string, scope: string | undefined, context: string): string {
		const name = raw.replace(/::/g, '.').replace(/\s+/g, '');
		const scopes: (string | undefined)[] = [];
		for (let at = scope; ; at = this.states.find((s) => s.name === at)?.parent) {
			scopes.push(at);
			if (at === undefined || scopes.length > 64) break;
		}
		for (const s of scopes) {
			const id = path(s, name);
			if (this.states.some((st) => st.name === id && st.kind !== 'initial')) return id;
		}
		const done = name === 'done' || name.endsWith('.done');
		const id = done ? path(scope, 'done') : path(scope, name);
		if (!this.states.some((s) => s.name === id)) {
			if (!done) this.warnings.push(`${context}: unknown state \`${name}\``);
			this.states.push({
				name: id,
				label: done ? 'done' : name,
				kind: done ? 'final' : 'state',
				...(scope ? { parent: scope } : {}),
				line: 0
			});
		}
		return id;
	}

	private resolve(): MachineTransition[] {
		return this.pending.map((p) => {
			const from =
				'path' in p.from ? p.from.path : this.resolveName(p.from.text, p.scope, p.context);
			const to = 'path' in p.to ? p.to.path : this.resolveName(p.to.text, p.scope, p.context);
			return {
				...(p.name ? { name: p.name } : {}),
				from,
				to,
				...(p.trigger ? { trigger: p.trigger } : {}),
				...(p.guard ? { guard: p.guard } : {}),
				...(p.effect ? { effect: p.effect } : {}),
				line: p.line
			};
		});
	}
}

// ---------------------------------------------------------------- texts

/** `text` with its comments and notes blanked (strings kept), trimmed. */
export function clean(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") {
			const end = closing(text, i);
			out += text.slice(i, end + 1);
			i = end;
		} else if (c === '/' && (text[i + 1] === '*' || text.startsWith('//*', i))) {
			// `/* … */` (a comment element: only where a member may be) or a `//* … */` note.
			const end = text.indexOf('*/', i + 2);
			out += ' ';
			i = end < 0 ? text.length : end + 1;
		} else if (c === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			out += ' ';
			i = end < 0 ? text.length : end - 1;
		} else out += c;
	}
	return out.trim();
}

/** Index of the quote closing the one at `start` (backslash escapes). */
function closing(text: string, start: number): number {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (text[i] === quote) return i;
	}
	return text.length - 1;
}

/** Top-level words of `text` (outside brackets and quotes), with their positions. */
function topLevelWords(text: string): { word: string; start: number; end: number }[] {
	const out: { word: string; start: number; end: number }[] = [];
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") i = closing(text, i);
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if (depth === 0 && /[A-Za-z_]/.test(c) && !/[\w.:$]/.test(text[i - 1] ?? ' ')) {
			let end = i;
			while (end < text.length && /\w/.test(text[end]!)) end++;
			out.push({ word: text.slice(i, end), start: i, end });
			i = end - 1;
		}
	}
	return out;
}

const CLAUSES = ['transition', 'first', 'accept', 'if', 'do', 'then'] as const;
type Clause = (typeof CLAUSES)[number];

export interface TransitionParts {
	/** Between `transition` and the first clause: the name, or the shorthand source. */
	head?: string;
	first?: string;
	trigger?: string;
	guard?: string;
	effect?: string;
	target?: string;
}

/**
 * The clauses of a transition as written: `transition t first a accept Go
 * if x > 1 do assign y := 2 then b;` (each optional but `then`), or a
 * target transition `accept Go then b;`.
 */
export function transitionParts(written: string): TransitionParts {
	const text = clean(written).replace(/;$/, '');
	const found: { clause: Clause; start: number; end: number }[] = [];
	let order = -1;
	for (const w of topLevelWords(text)) {
		const at = CLAUSES.indexOf(w.word as Clause);
		// Clauses come in this order; a later keyword out of order is part of an expression.
		if (at <= order) continue;
		found.push({ clause: w.word as Clause, start: w.start, end: w.end });
		order = at;
		if (w.word === 'then') break;
	}
	const parts: TransitionParts = {};
	found.forEach((f, i) => {
		const body = text.slice(f.end, found[i + 1]?.start ?? text.length).trim();
		if (!body) return;
		if (f.clause === 'transition') parts.head = body;
		else if (f.clause === 'first') parts.first = body;
		else if (f.clause === 'accept') parts.trigger = body;
		else if (f.clause === 'if') parts.guard = body;
		else if (f.clause === 'do') parts.effect = body;
		else parts.target = body;
	});
	return parts;
}

/**
 * The event a trigger fires on, as the emulator matches it: the signal
 * (`accept sig : Sig via port` → `Sig`), `when <condition>`, or the time
 * trigger as written (`after 5 [s]`, `at t`).
 */
export function triggerText(trigger: string): string {
	const text = trigger.trim();
	const when = /^when\b\s*([\s\S]*)$/.exec(text);
	if (when) return `when ${when[1]!.trim()}`;
	if (/^(after|at)\b/.test(text)) return text;
	const via = topLevelWords(text).find((w) => w.word === 'via');
	const payload = (via ? text.slice(0, via.start) : text).trim();
	const typed = /^[\s\S]*?(?<!:):(?!:)\s*([\s\S]+)$/.exec(payload);
	return (typed ? typed[1]! : payload).trim();
}

/**
 * An action as the emulator reads it: its `assign x := e` statements joined
 * by `; ` (also inside `action { … }`), else a named action's name, else the
 * text as written (`send …`).
 */
export function actionText(action: string): string | undefined {
	const text = clean(action);
	if (!text) return undefined;
	if (/(^|[\s{;])assign\s/.test(text)) {
		const open = text.indexOf('{');
		const body = open >= 0 ? text.slice(open + 1, text.lastIndexOf('}')) : text;
		const assignments: string[] = [];
		for (const statement of splitTopLevel(body)) {
			const m = /^(?:action\s+)?assign\s+([\s\S]+?)\s*:=\s*([\s\S]+)$/.exec(statement.trim());
			if (m) assignments.push(`assign ${m[1]!.trim()} := ${m[2]!.trim()}`);
		}
		if (assignments.length) return assignments.join('; ');
	}
	const bare = text.replace(/^action\b\s*/, '');
	if (/^[\w'.:]+$/.test(bare)) return bare;
	return text.replace(/\s+/g, ' ');
}

/** A step the emulator runs, or that changes nothing it simulates: an assignment, a named action. */
const RUN = /^(?:action\s+)?(?:assign\s[\s\S]*:=[\s\S]*|[\w'.:]*\s*(?::\s*[\w'.:]+)?)$/;
/** Steps whose effect on the run is lost if they are not run. */
const STEPS = /(^|[^\w$'])(send|accept|assign|if|while|loop|for|then|perform|terminate)\b/;

/**
 * The statements of an action the emulator does not run but that would
 * change the run: a `send`, an `accept`, an `if`, a loop, a succession,
 * an assignment inside one of them (`if x > 5 { assign y := 7; }`).
 */
export function skippedSteps(action: string): string[] {
	const text = clean(action);
	if (!text) return [];
	const open = text.indexOf('{');
	const body = open >= 0 ? text.slice(open + 1, text.lastIndexOf('}')) : text;
	return splitTopLevel(body)
		.map((statement) => statement.trim().replace(/\s+/g, ' '))
		.filter((statement) => !RUN.test(statement) && STEPS.test(statement));
}

/** `in attribute x : Real = 1` → `Real`. */
export function writtenType(header: string): string | undefined {
	return /(?<![:>]):(?![:>=])\s*((?:'[^']*'|[\w$]+)(?:\s*::\s*(?:'[^']*'|[\w$]+))*)/
		.exec(header)?.[1]
		?.replace(/\s*::\s*/g, '::');
}

/** `a; b; { c; }` → its top-level statements. */
function splitTopLevel(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"' || c === "'") i = closing(text, i);
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if (c === ';' && depth === 0) {
			out.push(text.slice(from, i));
			from = i + 1;
		}
	}
	out.push(text.slice(from));
	return out.filter((s) => s.trim());
}
