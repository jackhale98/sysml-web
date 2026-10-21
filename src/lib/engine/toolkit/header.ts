/**
 * A declaration's header — everything before its body or `;` — read as
 * tokens and edited as minimal text changes. The toolkit has no operation
 * for the modifiers, short name, multiplicity, specializations or the way a
 * value is given (`=`, `default`, `:=`), so `edits.ts` writes those here and
 * has the toolkit check the result (`replaceMember`, see docs/engine.md).
 *
 * The parts of a header, in the order the SysML v2 textual notation (as the
 * toolkit parses it) puts them:
 *
 * ```text
 * visibility direction derived abstract constant end ref modifiers #tags
 *     keywords <'short'> name [multiplicity] : Type :> subsets :>> redefines = value
 * ```
 *
 * A part that is there keeps its place and spelling (`: Rotor[4]` keeps its
 * multiplicity after the type, `specializes A` stays a keyword); a missing
 * one goes where the notation puts it. Offsets are UTF-16 into the text.
 */
import type { DeclarationSet } from '../types';
import { isReservedWord } from '#lib/project/names.ts';

export interface Token {
	kind: 'word' | 'name' | 'string' | 'number' | 'op' | 'comment';
	text: string;
	start: number;
	end: number;
}

export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

const OPERATORS = [
	'::>',
	':>>',
	'===',
	'!==',
	'::',
	':>',
	':=',
	'=>',
	'==',
	'!=',
	'<=',
	'>=',
	'->',
	'**',
	'..'
];

/** The tokens of `text` from `from`, up to `to`. Unterminated comments and quotes run to the end. */
export function tokenize(text: string, from = 0, to = text.length): Token[] {
	const out: Token[] = [];
	let i = from;
	const push = (kind: Token['kind'], end: number) => {
		out.push({ kind, text: text.slice(i, end), start: i, end });
		i = end;
	};
	while (i < to) {
		const c = text[i]!;
		if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
			i++;
			continue;
		}
		if (c === '/' && text[i + 1] === '*') {
			const close = text.indexOf('*/', i + 2);
			push('comment', close < 0 ? to : close + 2);
			continue;
		}
		if (c === '/' && text[i + 1] === '/') {
			const close = text.indexOf('\n', i);
			push('comment', close < 0 ? to : close);
			continue;
		}
		if (c === "'" || c === '"') {
			let j = i + 1;
			while (j < to && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
			push(c === "'" ? 'name' : 'string', Math.min(j + 1, to));
			continue;
		}
		if (/[\p{L}_]/u.test(c)) {
			const m = /^[\p{L}\p{N}_]+/u.exec(text.slice(i, Math.min(to, i + 256)))!;
			push('word', i + m[0].length);
			continue;
		}
		if (/[0-9]/.test(c)) {
			const m = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 64))!;
			push('number', i + m[0].length);
			continue;
		}
		const op = OPERATORS.find((o) => text.startsWith(o, i));
		push('op', i + (op?.length ?? 1));
	}
	return out;
}

export type Slot =
	| 'visibility'
	| 'direction'
	| 'derived'
	| 'abstract'
	| 'readonly'
	| 'end'
	| 'ref'
	| 'modifier'
	| 'tag'
	| 'keyword'
	| 'shortName'
	| 'name'
	| 'multiplicity'
	| 'qualifier'
	| 'typing'
	| 'specialization'
	| 'redefinition'
	| 'relationship'
	| 'value'
	| 'trailing'
	| 'body';

const ORDER: Slot[] = [
	'visibility',
	'direction',
	'derived',
	'abstract',
	'readonly',
	'end',
	'ref',
	'modifier',
	'tag',
	'keyword',
	'shortName',
	'name',
	'multiplicity',
	'qualifier',
	'typing',
	'specialization',
	'redefinition',
	'relationship',
	'value',
	'trailing',
	'body'
];
const rank = (slot: Slot) => ORDER.indexOf(slot);
const KEYWORD = rank('keyword');

export interface Span {
	start: number;
	end: number;
}

export interface Part extends Span {
	slot: Slot;
	/** The words of a prefix modifier or keyword. */
	word?: string;
	/** The references a typing, specialization or redefinition names. */
	targets?: Span[];
	/** `~` of a conjugated type. */
	tilde?: Span;
	/** The value's expression and how it is given. */
	expression?: Span;
	valueKind?: 'bind' | 'default' | 'initial';
	/** `typed by` / `defined by` rather than `:`. */
	keywordTyping?: boolean;
}

export type Family = 'package' | 'definition' | 'usage';

export interface Header {
	/** Where the declaration starts and where its header ends (at its `{` or `;`). */
	start: number;
	end: number;
	family: Family;
	parts: Part[];
	/** The body's braces, when it has one. */
	body: { open: number; close: number } | null;
}

const PREFIX: Record<string, Slot> = {
	private: 'visibility',
	protected: 'visibility',
	public: 'visibility',
	in: 'direction',
	out: 'direction',
	inout: 'direction',
	derived: 'derived',
	abstract: 'abstract',
	variation: 'abstract',
	readonly: 'readonly',
	constant: 'readonly',
	const: 'readonly',
	end: 'end',
	ref: 'ref',
	individual: 'modifier',
	snapshot: 'modifier',
	timeslice: 'modifier',
	variant: 'modifier',
	composite: 'modifier',
	portion: 'modifier',
	var: 'modifier',
	library: 'modifier',
	standard: 'modifier'
};

const TYPING_WORDS = new Set(['typed', 'defined']);
const SPECIALIZE_WORDS = new Set(['specializes', 'subsets']);
const RELATIONSHIP_OPS = new Set(['::>', '=>', '~']);
const RELATIONSHIP_WORDS = new Set(['references', 'crosses', 'conjugates', 'chains', 'inverse']);

/**
 * Read the header of the declaration starting at `start`. Returns null when
 * the text there is not a declaration (`satisfy … by …`, an import, …).
 */
export function readHeader(text: string, start: number): Header | null {
	const tokens = tokenize(text, start);
	const parts: Part[] = [];
	let i = 0;
	const at = () => tokens[i];
	const skipComments = () => {
		while (at()?.kind === 'comment') i++;
	};
	/** A qualified name or feature chain: `A::'b c'.d`. */
	const reference = (): Span | null => {
		skipComments();
		const first = at();
		if (!first || (first.kind !== 'word' && first.kind !== 'name')) return null;
		let end = first.end;
		i++;
		for (;;) {
			const sep = at();
			const next = tokens[i + 1];
			if (sep?.kind !== 'op' || (sep.text !== '::' && sep.text !== '.')) break;
			if (!next || (next.kind !== 'word' && next.kind !== 'name')) break;
			end = next.end;
			i += 2;
		}
		return { start: first.start, end };
	};
	const list = (): Span[] => {
		const out: Span[] = [];
		for (;;) {
			const r = reference();
			if (!r) break;
			out.push(r);
			skipComments();
			if (at()?.text !== ',') break;
			i++;
		}
		return out;
	};

	// Prefix modifiers, tags and keywords.
	let keywords = 0;
	let isDef = false;
	let isPackage = false;
	for (;;) {
		skipComments();
		const t = at();
		if (!t) return null;
		if (t.kind === 'op' && t.text === '#') {
			const from = t.start;
			i++;
			const r = reference();
			parts.push({ slot: 'tag', start: from, end: r?.end ?? t.end });
			continue;
		}
		if (t.kind !== 'word') break;
		const prefix = keywords === 0 ? PREFIX[t.text] : undefined;
		if (prefix) {
			parts.push({ slot: prefix, start: t.start, end: t.end, word: t.text });
			i++;
			continue;
		}
		if (!isReservedWord(t.text) || TYPING_WORDS.has(t.text) || SPECIALIZE_WORDS.has(t.text)) break;
		if (t.text === 'redefines' || RELATIONSHIP_WORDS.has(t.text)) break;
		if (['import', 'alias', 'satisfy', 'bind', 'connect', 'succession', 'first'].includes(t.text))
			return null;
		parts.push({ slot: 'keyword', start: t.start, end: t.end, word: t.text });
		keywords++;
		if (t.text === 'def') isDef = true;
		if (t.text === 'package' || t.text === 'namespace') isPackage = true;
		i++;
	}

	let end = -1;
	let body: Header['body'] = null;
	let named = false;
	while (i < tokens.length) {
		const t = tokens[i]!;
		if (t.kind === 'comment') {
			i++;
			continue;
		}
		if (t.text === ';') {
			end = t.start;
			parts.push({ slot: 'body', start: t.start, end: t.end });
			break;
		}
		if (t.text === '{') {
			end = t.start;
			const close = matchingBrace(tokens, i);
			parts.push({ slot: 'body', start: t.start, end: close?.end ?? text.length });
			body = { open: t.start, close: close?.start ?? text.length };
			break;
		}
		if (t.text === '<' && !named) {
			// `<'ID'>`
			const close = tokens.findIndex((x, j) => j > i && x.text === '>');
			if (close < 0) return null;
			parts.push({ slot: 'shortName', start: t.start, end: tokens[close]!.end });
			i = close + 1;
			continue;
		}
		if ((t.kind === 'word' || t.kind === 'name') && !named && !isReserved(t)) {
			parts.push({ slot: 'name', start: t.start, end: t.end });
			named = true;
			i++;
			continue;
		}
		if (t.text === '[') {
			const close = matching(tokens, i, '[', ']');
			const last = close ?? tokens.length - 1;
			parts.push({ slot: 'multiplicity', start: t.start, end: tokens[last]!.end });
			i = last + 1;
			continue;
		}
		if (t.kind === 'word' && (t.text === 'ordered' || t.text === 'nonunique')) {
			parts.push({ slot: 'qualifier', start: t.start, end: t.end, word: t.text });
			i++;
			continue;
		}
		if (t.text === ':' || (t.kind === 'word' && TYPING_WORDS.has(t.text))) {
			const from = t.start;
			const keyword = t.kind === 'word';
			i += keyword ? 2 : 1; // `typed by` / `defined by`
			skipComments();
			let tilde: Span | undefined;
			if (at()?.text === '~') {
				tilde = { start: at()!.start, end: at()!.end };
				i++;
			}
			const targets = list();
			parts.push({
				slot: 'typing',
				start: from,
				end: targets.at(-1)?.end ?? tilde?.end ?? t.end,
				targets,
				...(tilde ? { tilde } : {}),
				...(keyword ? { keywordTyping: true } : {})
			});
			named = true;
			continue;
		}
		const relation =
			t.text === ':>' || (t.kind === 'word' && SPECIALIZE_WORDS.has(t.text))
				? 'specialization'
				: t.text === ':>>' || (t.kind === 'word' && t.text === 'redefines')
					? 'redefinition'
					: (t.kind === 'op' && RELATIONSHIP_OPS.has(t.text)) ||
						  (t.kind === 'word' && RELATIONSHIP_WORDS.has(t.text))
						? 'relationship'
						: null;
		if (relation) {
			i++;
			const targets = list();
			parts.push({ slot: relation, start: t.start, end: targets.at(-1)?.end ?? t.end, targets });
			named = true;
			continue;
		}
		if (t.text === '=' || t.text === ':=' || (t.kind === 'word' && t.text === 'default')) {
			const from = t.start;
			let valueKind: Part['valueKind'] = t.text === ':=' ? 'initial' : 'bind';
			i++;
			if (t.text === 'default') {
				valueKind = 'default';
				skipComments();
				if (at()?.text === '=' || at()?.text === ':=') i++;
			}
			const exprStart = i;
			let depth = 0;
			while (i < tokens.length) {
				const x = tokens[i]!;
				if (depth === 0 && (x.text === ';' || x.text === '{')) break;
				if (x.text === '(' || x.text === '[') depth++;
				if (x.text === ')' || x.text === ']') depth--;
				i++;
			}
			const exprTokens = tokens.slice(exprStart, i).filter((x) => x.kind !== 'comment');
			const expression = exprTokens.length
				? { start: exprTokens[0]!.start, end: exprTokens.at(-1)!.end }
				: undefined;
			parts.push({
				slot: 'value',
				start: from,
				end: expression?.end ?? t.end,
				valueKind,
				...(expression ? { expression } : {})
			});
			continue;
		}
		parts.push({ slot: 'trailing', start: t.start, end: t.end });
		named = true;
		i++;
	}
	if (end < 0) return null;
	return {
		start,
		end,
		family: isPackage ? 'package' : isDef ? 'definition' : 'usage',
		parts,
		body
	};
}

function isReserved(t: Token): boolean {
	return t.kind === 'word' && isReservedWord(t.text);
}

function matching(tokens: Token[], open: number, a: string, b: string): number | null {
	let depth = 0;
	for (let j = open; j < tokens.length; j++) {
		if (tokens[j]!.text === a) depth++;
		else if (tokens[j]!.text === b && --depth === 0) return j;
	}
	return null;
}

function matchingBrace(tokens: Token[], open: number): Token | null {
	const j = matching(tokens, open, '{', '}');
	return j === null ? null : tokens[j]!;
}

// --- formatting ----------------------------------------------------------------------

const PLAIN = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** A name as SysML text: bare when it can be, else quoted with `'` and `\` escaped. */
export function formatName(name: string): string {
	return PLAIN.test(name) && !isReservedWord(name) ? name : quoteName(name);
}

/** A name always quoted: `'SYS-001'`. */
export function quoteName(name: string): string {
	return `'${name.replace(/[\\']/g, (c) => `\\${c}`)}'`;
}

/** A SysML string literal. */
export function stringLiteral(text: string): string {
	return `"${text
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r/g, '')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')}"`;
}

/** `A::B`, `a.b`: each segment bare when it can be, quoted segments kept as written. */
export function formatReference(reference: string): string {
	const r = reference.trim();
	const bad = () => new Error(`\`${reference}\` is not a valid reference`);
	let out = '';
	let segment = '';
	const flush = () => {
		const s = segment.trim();
		if (!s) throw bad();
		out += s.startsWith("'") ? s : formatName(s);
		segment = '';
	};
	for (let i = 0; i < r.length; i++) {
		const c = r[i]!;
		if (c === "'") {
			let j = i + 1;
			while (j < r.length && r[j] !== "'") j += r[j] === '\\' ? 2 : 1;
			if (j >= r.length) throw bad();
			segment += r.slice(i, j + 1);
			i = j;
		} else if (c === ':' && r[i + 1] === ':') {
			flush();
			out += '::';
			i++;
		} else if (c === '.') {
			flush();
			out += '.';
		} else segment += c;
	}
	flush();
	return out;
}

/** `4`, `[0..1]`, ` 1..* ` → `[4]`, `[0..1]`, `[1..*]`; null when empty. */
export function formatMultiplicity(m: string): string | null {
	const t = m.trim();
	const inner = (t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t).trim();
	return inner ? `[${inner}]` : null;
}

/** Text that is empty after trimming counts as "remove". */
const present = (v: string | null | undefined) => {
	const t = v?.trim();
	return t ? t : null;
};

// --- layout helpers ----------------------------------------------------------------------

const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text: string, at: number) => {
	const n = text.indexOf('\n', at);
	return n < 0 ? text.length : n;
};

/** Leading whitespace of the line containing `at`. */
export function lineIndent(text: string, at: number): string {
	return /^[ \t]*/.exec(text.slice(lineStart(text, at)))![0];
}

/** One level of indentation as the file writes it. */
export function indentUnit(text: string): string {
	for (const line of text.split('\n')) {
		if (line.startsWith('\t')) return '\t';
		const n = line.length - line.trimStart().length;
		const rest = line.trimStart();
		if (n >= 2 && rest && !rest.startsWith('*')) return ' '.repeat(Math.min(n, 8));
	}
	return '    ';
}

/**
 * Remove [start, end): its whole line(s) when it stands alone, else the text
 * and the blank before it (or after it, when it starts a line).
 */
export function removal(text: string, start: number, end: number): TextChange {
	const ls = lineStart(text, start);
	const le = lineEnd(text, end);
	const before = text.slice(ls, start);
	const after = text.slice(end, le);
	if (!before.trim() && !after.trim()) {
		return { from: ls, to: le < text.length ? le + 1 : le, insert: '' };
	}
	if (!before.trim()) {
		const blank = after.length - after.replace(/^[ \t]+/, '').length;
		return { from: start, to: end + blank, insert: '' };
	}
	const head = text.slice(0, start);
	const blank = head.length - head.replace(/[ \t]+$/, '').length;
	return { from: start - blank, to: end, insert: '' };
}

// --- editing -------------------------------------------------------------------------------

type Key = [number, number];

interface Keyed extends TextChange {
	key: Key;
}

const own = (slot: Slot): Key => [rank(slot) * 2, rank(slot)];

const DIRECTED_KEYWORDS = new Set([
	'part',
	'attribute',
	'port',
	'item',
	'ref',
	'action',
	'occurrence'
]);
const END_KEYWORDS = new Set(['part', 'attribute', 'port', 'item', 'occurrence', 'ref']);
const VALUED_KEYWORDS = new Set([
	'part',
	'attribute',
	'port',
	'item',
	'ref',
	'action',
	'occurrence',
	'requirement',
	'calc',
	'constraint',
	'enum',
	'individual'
]);
const NO_SHORT_NAME = new Set(['action', 'state', 'transition', 'succession']);

export class HeaderEditor {
	private readonly out: Keyed[] = [];

	constructor(
		readonly text: string,
		readonly header: Header
	) {}

	private get parts() {
		return this.header.parts;
	}

	private all(slot: Slot) {
		return this.parts.filter((p) => p.slot === slot);
	}

	private first(slot: Slot) {
		return this.parts.find((p) => p.slot === slot);
	}

	private keywords(): string[] {
		return this.all('keyword').map((p) => p.word!);
	}

	/** How the declaration starts, for messages: `part def`, `action`. */
	private describe(): string {
		return this.keywords().join(' ') || 'feature';
	}

	private unsupported(field: string): Error {
		return new Error(`\`${field}\` cannot be set on a \`${this.describe()}\` declaration`);
	}

	private require(ok: boolean, field: string) {
		if (!ok) throw this.unsupported(field);
	}

	private get isUsage() {
		return this.header.family === 'usage';
	}

	private push(from: number, to: number, insert: string, key: Key) {
		this.out.push({ from, to, insert, key });
	}

	private replace(from: number, to: number, insert: string, slot: Slot) {
		this.push(from, to, insert, own(slot));
	}

	private remove(part: Part) {
		// A prefix keyword goes with the blank after it: `in item x` → `item x`.
		const rest = this.text.slice(part.end);
		const blank = rest.length - rest.replace(/^[ \t]+/, '').length;
		if (rank(part.slot) < KEYWORD && blank > 0) {
			this.push(part.start, part.end + blank, '', own(part.slot));
			return;
		}
		const e = removal(this.text, part.start, part.end);
		this.push(e.from, e.to, e.insert, own(part.slot));
	}

	/**
	 * Where a missing part goes: a prefix modifier before the first part that
	 * follows it in the notation's order, anything else after the last part
	 * that precedes it.
	 */
	private insertion(slot: Slot, after: Slot): [number, Key] {
		const r = rank(slot);
		if (r < KEYWORD) {
			const next = this.parts.find((p) => rank(p.slot) > r);
			return next ? [next.start, [rank(next.slot) * 2 - 1, r]] : [this.header.start, [0, r]];
		}
		const a = rank(after);
		const prev = this.parts.findLast((p) => rank(p.slot) <= a && rank(p.slot) >= KEYWORD);
		return prev ? [prev.end, [rank(prev.slot) * 2 + 1, r]] : [this.header.start, [0, r]];
	}

	private insert(slot: Slot, after: Slot, text: string) {
		const [at, key] = this.insertion(slot, after);
		this.push(at, at, text, key);
	}

	setType(ty: string | null | undefined, conjugated: boolean | undefined) {
		const typing = this.first('typing');
		if (ty !== undefined) {
			const t = present(ty);
			if (!t) {
				if (conjugated === true) throw new Error('`conjugated` needs a type');
				for (const p of this.all('typing')) this.remove(p);
				return;
			}
			this.require(this.isUsage, 'type');
			const f = formatReference(t);
			if (typing?.targets?.length) {
				const targets = typing.targets;
				this.replace(targets[0]!.start, targets.at(-1)!.end, f, 'typing');
				this.conjugate(typing, conjugated);
			} else {
				this.insert('typing', 'typing', ` : ${conjugated ? '~' : ''}${f}`);
			}
			return;
		}
		if (conjugated === undefined) return;
		if (typing) this.conjugate(typing, conjugated);
		else if (conjugated) throw new Error('`conjugated` needs a type');
	}

	private conjugate(typing: Part, want: boolean | undefined) {
		if (want === undefined) return;
		const first = typing.targets?.[0]?.start;
		if (first === undefined) return;
		if (want && !typing.tilde) {
			if (typing.keywordTyping)
				throw new Error('a type given with `defined by` cannot be conjugated; use `: ~T`');
			this.push(first, first, '~', [rank('typing') * 2, 0]);
		} else if (!want && typing.tilde) {
			this.push(typing.tilde.start, first, '', [rank('typing') * 2, 0]);
		}
	}

	setSpecializes(list: string[]) {
		const parts = this.all('specialization');
		const joined = list
			.filter((s) => s.trim())
			.map(formatReference)
			.join(', ');
		if (!joined) {
			for (const p of parts) this.remove(p);
			return;
		}
		this.require(this.header.family !== 'package', 'specializes');
		const [first, ...rest] = parts;
		if (first?.targets?.length) {
			this.replace(first.targets[0]!.start, first.targets.at(-1)!.end, joined, 'specialization');
			for (const p of rest) this.remove(p);
		} else {
			this.insert('specialization', 'specialization', ` :> ${joined}`);
		}
	}

	setRedefines(value: string | null) {
		const parts = this.all('redefinition');
		const v = present(value);
		if (!v) {
			for (const p of parts) this.remove(p);
			return;
		}
		this.require(this.isUsage, 'redefines');
		const f = formatReference(v);
		const [first, ...rest] = parts;
		if (first?.targets?.length) {
			this.replace(first.targets[0]!.start, first.targets.at(-1)!.end, f, 'redefinition');
			for (const p of rest) this.remove(p);
		} else {
			this.insert('redefinition', 'redefinition', ` :>> ${f}`);
		}
	}

	setMultiplicity(value: string | null) {
		const existing = this.first('multiplicity');
		const m = value ? formatMultiplicity(value) : null;
		if (!m) {
			if (existing) this.remove(existing);
			return;
		}
		this.require(this.isUsage, 'multiplicity');
		if (existing) {
			this.replace(existing.start, existing.end, m, 'multiplicity');
			return;
		}
		// A feature without a keyword needs its type first (`mass : Real[1]`).
		const after: Slot = this.keywords().length ? 'multiplicity' : 'typing';
		const [at, key] = this.insertion('multiplicity', after);
		const tight = this.parts.some(
			(p) => p.end === at && (p.slot === 'name' || p.slot === 'shortName' || p.slot === 'typing')
		);
		this.push(at, at, `${tight ? '' : ' '}${m}`, key);
	}

	setValue(value: string | null | undefined, kind: Part['valueKind'] | undefined) {
		const part = this.first('value');
		const expr = part?.expression;
		if (value !== undefined) {
			const v = present(value);
			if (!v) {
				if (part) this.remove(part);
				return;
			}
			this.require(this.mayHaveValue(), 'value');
			if (part && expr) this.replace(expr.start, expr.end, v, 'value');
			else if (part) throw new Error('the value cannot be read');
			else {
				this.insert('value', 'value', ` ${operator(kind ?? 'bind')}${v}`);
				return;
			}
		}
		if (kind && part && expr) {
			if (part.valueKind !== kind)
				this.push(part.start, expr.start, operator(kind), [rank('value') * 2, 0]);
		} else if (kind && !part && value === undefined) {
			throw new Error('`valueKind` needs a value');
		}
	}

	private mayHaveValue(): boolean {
		const words = this.keywords();
		if (!this.isUsage) return false;
		return !words.length || words.some((w) => VALUED_KEYWORDS.has(w));
	}

	setDirection(direction: 'in' | 'out' | 'inout' | null) {
		const parts = this.all('direction');
		if (!direction) {
			for (const p of parts) this.remove(p);
			return;
		}
		const words = this.keywords();
		this.require(
			this.isUsage && (!words.length || words.some((w) => DIRECTED_KEYWORDS.has(w))),
			'direction'
		);
		const [first, ...rest] = parts;
		if (first) {
			this.replace(first.start, first.end, direction, 'direction');
			for (const p of rest) this.remove(p);
		} else this.insert('direction', 'direction', `${direction} `);
	}

	/** Add or remove a prefix keyword (`abstract`, `constant`, `derived`, `end`). */
	setFlag(slot: Slot, word: string, words: string[], want: boolean, allowed: boolean) {
		const existing = this.parts.find((p) => p.slot === slot && words.includes(p.word ?? ''));
		if (want && !existing) {
			this.require(allowed, word === 'constant' ? 'readonly' : word);
			this.insert(slot, slot, `${word} `);
		} else if (!want && existing) this.remove(existing);
	}

	mayBeEnd(): boolean {
		const words = this.keywords();
		return this.isUsage && (!words.length || words.every((w) => END_KEYWORDS.has(w)));
	}

	setShortName(value: string | null) {
		const want = present(value);
		const existing = this.first('shortName');
		const current = existing ? shortNameOf(this.text, existing) : null;
		if (want === current) return;
		if (want) {
			const ok =
				this.header.family !== 'usage' || !this.keywords().some((w) => NO_SHORT_NAME.has(w));
			this.require(ok, 'shortName');
		}
		if (!want) {
			if (!existing) return;
			const rest = this.text.slice(existing.end);
			const blank = rest.length - rest.replace(/^[ \t]+/, '').length;
			this.push(existing.start, existing.end + blank, '', own('shortName'));
			return;
		}
		if (existing) {
			const inner = this.text.slice(existing.start + 1, existing.end - 1).trim();
			const offset = this.text.indexOf(inner, existing.start + 1);
			const written = inner.startsWith("'") ? quoteName(want) : formatName(want);
			this.push(offset, offset + inner.length, written, own('shortName'));
			return;
		}
		const name = this.first('name');
		if (!name) throw new Error('the element has no name to put a short name before');
		this.push(name.start, name.start, `<${quoteName(want)}> `, own('shortName'));
	}

	/** The changes, each trimmed to what changes, with changes at one place merged in order. */
	finish(): TextChange[] {
		const items = this.out
			.map((k) => {
				const m = minimal(this.text, k);
				return m ? { ...m, key: k.key } : null;
			})
			.filter((k): k is Keyed => !!k)
			.sort((a, b) => a.from - b.from || a.key[0] - b.key[0] || a.key[1] - b.key[1]);
		const merged: TextChange[] = [];
		for (const e of items) {
			const last = merged.at(-1);
			if (last) {
				const sameStart = e.from === last.from;
				const inside = e.from < last.to;
				if (sameStart && last.from === last.to) {
					last.to = e.to;
					last.insert += e.insert;
					continue;
				}
				if ((sameStart || inside) && e.from === e.to) {
					last.insert += e.insert;
					continue;
				}
				if (inside) {
					if (!last.insert && !e.insert) {
						last.to = Math.max(last.to, e.to);
						continue;
					}
					throw new Error('these changes overlap; set fewer fields at once');
				}
			}
			merged.push({ from: e.from, to: e.to, insert: e.insert });
		}
		return merged;
	}
}

function operator(kind: NonNullable<Part['valueKind']>): string {
	return kind === 'default' ? 'default = ' : kind === 'initial' ? ':= ' : '= ';
}

function shortNameOf(text: string, part: Part): string {
	const inner = text.slice(part.start + 1, part.end - 1).trim();
	return unquote(inner);
}

/** `'b c'` → `b c`; a bare name is itself. */
export function unquote(name: string): string {
	if (name.length >= 2 && name.startsWith("'") && name.endsWith("'"))
		return name.slice(1, -1).replace(/\\(.)/g, '$1');
	return name;
}

/** A change without the text it leaves unchanged at either end; null when it changes nothing. */
function minimal(text: string, e: TextChange): TextChange | null {
	const old = text.slice(e.from, e.to);
	const neu = e.insert;
	let pre = 0;
	while (pre < old.length && pre < neu.length && old[pre] === neu[pre]) pre++;
	let suf = 0;
	while (
		suf < old.length - pre &&
		suf < neu.length - pre &&
		old[old.length - 1 - suf] === neu[neu.length - 1 - suf]
	)
		suf++;
	const from = e.from + pre;
	const to = e.to - suf;
	const insert = neu.slice(pre, neu.length - suf);
	return from !== to || insert ? { from, to, insert } : null;
}

/**
 * The header changes `set` asks for (everything but `doc`, which is a body
 * member). Throws with a message a person can act on when the declaration
 * cannot say it.
 */
export function planHeader(text: string, header: Header, set: DeclarationSet): TextChange[] {
	const ed = new HeaderEditor(text, header);
	ed.setType(set.type, set.conjugated);
	if (set.specializes) ed.setSpecializes(set.specializes);
	if (set.redefines !== undefined) ed.setRedefines(set.redefines);
	if (set.multiplicity !== undefined) ed.setMultiplicity(set.multiplicity);
	ed.setValue(set.value, set.valueKind);
	if (set.direction !== undefined) ed.setDirection(set.direction);
	const notPackage = header.family !== 'package';
	if (set.abstract !== undefined)
		ed.setFlag('abstract', 'abstract', ['abstract'], set.abstract, notPackage);
	const featured = header.family === 'usage';
	if (set.readonly !== undefined)
		ed.setFlag('readonly', 'constant', ['readonly', 'constant', 'const'], set.readonly, featured);
	if (set.derived !== undefined)
		ed.setFlag('derived', 'derived', ['derived'], set.derived, featured);
	if (set.end !== undefined) ed.setFlag('end', 'end', ['end'], set.end, ed.mayBeEnd());
	if (set.shortName !== undefined) ed.setShortName(set.shortName);
	return ed.finish();
}

/** Apply non-overlapping changes (UTF-16 offsets) to `text`. */
export function applyTextChanges(text: string, changes: TextChange[]): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from))
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}

// --- bodies ------------------------------------------------------------------------------

const startsLine = (text: string, at: number) => !text.slice(lineStart(text, at), at).trim();

/** Indent every line after the first of `text` by `indent`. */
export function indentRest(text: string, indent: string): string {
	return text
		.split('\n')
		.map((l, i) => (i === 0 || !l ? l : indent + l))
		.join('\n');
}

/**
 * Indentation for a member of a body: that of its first member on its own
 * line, else one level deeper than the line of the closing brace.
 */
export function memberIndent(text: string, members: Span[], close: number): string {
	const own = members.find((m) => startsLine(text, m.start));
	return own ? lineIndent(text, own.start) : lineIndent(text, close) + indentUnit(text);
}

/**
 * Add `member` to the body of the declaration `header` reads: after the
 * member `after`, or first; a declaration ending in `;` gains a body. A body
 * on one line stays on one line.
 */
export function insertIntoBody(
	text: string,
	header: Header,
	members: Span[],
	after: Span | null,
	member: string
): TextChange {
	const body = header.body;
	if (!body) {
		const semi = header.parts.find((p) => p.slot === 'body');
		if (!semi) throw new Error('the element has neither a body nor a closing `;`');
		const indent = lineIndent(text, header.start);
		const inner = indent + indentUnit(text);
		return {
			from: semi.start,
			to: semi.end,
			insert: ` {\n${inner}${indentRest(member, inner)}\n${indent}}`
		};
	}
	const { open, close } = body;
	if (text.slice(open, close).includes('\n')) {
		const indent = memberIndent(text, members, close);
		const at = after ? after.end : open + 1;
		return { from: at, to: at, insert: `\n${indent}${indentRest(member, indent)}` };
	}
	if (after) return { from: after.end, to: after.end, insert: ` ${member}` };
	const tight = text[open + 1] === '}';
	return { from: open + 1, to: open + 1, insert: ` ${member}${tight ? ' ' : ''}` };
}

// --- comments ----------------------------------------------------------------------------

/** The text for a comment: `*\/` cannot appear inside one. */
export function commentSafe(text: string): string {
	return text.trim().replace(/\*\//g, '* /').replace(/\r/g, '');
}

/** Greedy word wrap of one line to `width` characters. */
function wrapLine(line: string, width: number): string[] {
	const out: string[] = [];
	let cur = '';
	for (const word of line.split(/\s+/).filter(Boolean)) {
		if (cur && [...cur].length + 1 + [...word].length > width) {
			out.push(cur);
			cur = '';
		}
		cur = cur ? `${cur} ${word}` : word;
	}
	out.push(cur);
	return out;
}

const column = (text: string, at: number) => [...text.slice(lineStart(text, at), at)].length;

/**
 * A block comment holding `body`, laid out like `old` (the comment it
 * replaces, a span of `text`) — or `/* … *\/` on one line when there is none
 * and the body is one line.
 */
export function blockComment(text: string, old: Span | null, body: string): string {
	const safe = commentSafe(body);
	const oldText = old ? text.slice(old.start, old.end) : null;
	const multiOld = !!oldText?.includes('\n');
	if (!multiOld && !safe.includes('\n')) return `/* ${safe} */`;
	let cont: string;
	let inlineOpen = false;
	let inlineClose = false;
	let width = 100;
	if (old && oldText && multiOld) {
		const lines = oldText.split('\n');
		const second = lines[1] ?? '';
		const star = second.indexOf('*');
		if (star >= 0 && !second.slice(0, star).trim()) {
			const after = second.slice(star + 1);
			cont = `${second.slice(0, star)}*${after.startsWith(' ') || !after ? ' ' : ''}`;
		} else cont = `${' '.repeat(column(text, old.start) + 1)} `;
		inlineOpen = !!lines[0]!.replace(/^\/\*/, '').trim();
		const last = lines.at(-1)!;
		inlineClose = !!last.trim().replace(/\*\/$/, '').trim().replace(/^\*+/, '').trim();
		const startCol = column(text, old.start);
		width = Math.max(60, ...lines.map((l, i) => [...l].length + (i === 0 ? startCol : 0)));
	} else {
		const col = old ? column(text, old.start) : 0;
		cont = `${' '.repeat(col)} * `;
	}
	const room = Math.max(20, width - [...cont].length);
	const lines = safe.split('\n').flatMap((l) => wrapLine(l.trim(), room));
	let out = '/*';
	lines.forEach((l, i) => {
		if (i === 0 && inlineOpen) out += ' ';
		else out += `\n${l ? cont : cont.trimEnd()}`;
		out += l;
	});
	out += inlineClose ? ' */' : `\n${cont.trimEnd().replace(/\*+$/, '')}*/`;
	return out;
}

/** The text of a block comment: no `/*`, `*\/` or leading ` * `. */
export function commentText(comment: string): string {
	let inner = comment.startsWith('/*') ? comment.slice(2) : comment;
	if (inner.endsWith('*/')) inner = inner.slice(0, -2);
	const lines = inner.split('\n').map((l, i) => {
		const t = l.trim();
		if (i === 0) return t;
		return t.startsWith('*') ? t.slice(1).trim() : t;
	});
	const first = lines.findIndex((l) => l);
	const last = lines.findLastIndex((l) => l);
	return first < 0 ? '' : lines.slice(first, last + 1).join('\n');
}
