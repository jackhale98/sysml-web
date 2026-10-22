/**
 * Small, careful text patches on SysML source, for the diagram edits the
 * engine has no operation for (a statement beside its kind, a member of an
 * unnamed objective, removing an unnamed statement). Offsets are UTF-16
 * string offsets.
 *
 * Every function returns the new text, or null when the source does not
 * have the expected shape; callers then refuse rather than guess.
 */

const INDENT = '    ';
/** Keep one-line bodies on one line while they stay this short. */
const INLINE_MAX = 100;

/**
 * Index just after a comment or quoted name/string starting at `i`, or `i`
 * when none starts there.
 */
export function skipTrivia(text: string, i: number): number {
	const c = text[i];
	if (c === '/' && text[i + 1] === '*') {
		const end = text.indexOf('*/', i + 2);
		return end < 0 ? text.length : end + 2;
	}
	if (c === '/' && text[i + 1] === '/') {
		const end = text.indexOf('\n', i);
		return end < 0 ? text.length : end;
	}
	if (c === "'" || c === '"') {
		for (let j = i + 1; j < text.length; j++) {
			if (text[j] === '\\') j++;
			else if (text[j] === c) return j + 1;
		}
		return text.length;
	}
	return i;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
export function matchBrace(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length;) {
		const next = skipTrivia(text, i);
		if (next !== i) {
			i = next;
			continue;
		}
		if (text[i] === '{') depth++;
		else if (text[i] === '}' && --depth === 0) return i;
		i++;
	}
	return -1;
}

/**
 * Where a declaration's header ends: its first `{` or `;` outside comments
 * and quotes, between `from` and `to`.
 */
export function headerEnd(
	text: string,
	from: number,
	to = text.length
): { index: number; char: '{' | ';' } | null {
	for (let i = from; i < to;) {
		const next = skipTrivia(text, i);
		if (next !== i) {
			i = next;
			continue;
		}
		const c = text[i];
		if (c === '{' || c === ';') return { index: i, char: c };
		i++;
	}
	return null;
}

function lineStart(text: string, at: number): number {
	return text.lastIndexOf('\n', at - 1) + 1;
}

function indentOf(text: string, at: number): string {
	const start = lineStart(text, at);
	return /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
}

/** Indentation used by the members of the body `{…}` at `open`, or base + one level. */
function memberIndent(text: string, open: number, close: number, base: string): string {
	const body = text.slice(open + 1, close);
	const line = /\n([ \t]+)\S/.exec(body);
	return line?.[1] ?? base + INDENT;
}

export interface Patched {
	text: string;
	/** Where the inserted statement starts and ends in the new text. */
	from: number;
	to: number;
}

/**
 * Add `member` as the last statement in the body of the declaration that
 * starts at `from`. A declaration ending in `;` gains a body; a short
 * one-line body stays on one line.
 */
export function insertIntoBody(
	text: string,
	from: number,
	to: number,
	member: string
): Patched | null {
	const head = headerEnd(text, from, to);
	if (!head) return null;
	const base = indentOf(text, from);
	if (head.char === ';') {
		const indent = base + INDENT;
		const insert = ` {\n${indent}${member}\n${base}}`;
		const at = head.index;
		const start = at + 3 + indent.length;
		return {
			text: text.slice(0, at) + insert + text.slice(at + 1),
			from: start,
			to: start + member.length
		};
	}
	const open = head.index;
	const close = matchBrace(text, open);
	if (close < 0) return null;
	const inner = text.slice(open + 1, close);
	if (!inner.includes('\n')) {
		const content = inner.trim();
		const lineLength = text.indexOf('\n', close) - lineStart(text, open);
		if (lineLength + member.length + 2 <= INLINE_MAX) {
			const before = text.slice(0, open + 1) + (content ? ` ${content} ` : ' ');
			return {
				text: before + `${member} }` + text.slice(close + 1),
				from: before.length,
				to: before.length + member.length
			};
		}
		// Too long for one line: open the body up.
		const indent = base + INDENT;
		const lines = (content ? `\n${indent}${content}` : '') + `\n${indent}`;
		const before = text.slice(0, open + 1) + lines;
		return {
			text: before + `${member}\n${base}}` + text.slice(close + 1),
			from: before.length,
			to: before.length + member.length
		};
	}
	const indent = memberIndent(text, open, close, base);
	const closeLine = lineStart(text, close);
	if (/^[ \t]*$/.test(text.slice(closeLine, close))) {
		// The usual case: `}` on its own line.
		const insert = `${indent}${member}\n`;
		return {
			text: text.slice(0, closeLine) + insert + text.slice(closeLine),
			from: closeLine + indent.length,
			to: closeLine + indent.length + member.length
		};
	}
	const insert = `\n${indent}${member}\n${base}`;
	return {
		text: text.slice(0, close).trimEnd() + insert + text.slice(close),
		from: text.slice(0, close).trimEnd().length + 1 + indent.length,
		to: text.slice(0, close).trimEnd().length + 1 + indent.length + member.length
	};
}

/**
 * Remove the statement at [from, to), and its whole line when nothing else
 * is on it.
 */
export function removeStatement(text: string, from: number, to: number): string {
	let end = to;
	while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
	if (text[end] === ';' && text[to - 1] !== ';') end++;
	const start = lineStart(text, from);
	const lineEnd = text.indexOf('\n', end);
	const before = text.slice(start, from);
	const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
	if (!before.trim() && !after.trim()) {
		return text.slice(0, start) + text.slice(lineEnd < 0 ? text.length : lineEnd + 1);
	}
	// Inside a line (e.g. `objective { verify A; verify B; }`): drop one space too.
	const gap = text[end] === ' ' ? 1 : 0;
	return text.slice(0, from) + text.slice(end + gap);
}

/** Name without qualification or quotes, for comparing references. */
export function simpleName(reference: string): string {
	const last = reference.trim().split('::').pop() ?? reference;
	return last.replace(/^'(.*)'$/, '$1');
}

/**
 * The first match of `pattern` between `from` and `to` that is not inside
 * a comment, as [start, end).
 */
export function findStatement(
	text: string,
	pattern: RegExp,
	from = 0,
	to = text.length
): [number, number] | null {
	const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
	const re = new RegExp(pattern.source, flags);
	re.lastIndex = from;
	for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
		if (!insideComment(text, m.index)) return [m.index, m.index + m[0].length];
		if (m[0].length === 0) re.lastIndex++;
	}
	return null;
}

function insideComment(text: string, at: number): boolean {
	for (let i = 0; i < at;) {
		const next = skipTrivia(text, i);
		if (next > at && (text[i] === '/' || text[i] === "'" || text[i] === '"')) {
			return text[i] === '/';
		}
		i = next === i ? i + 1 : next;
	}
	return false;
}

/** A reference as a regex that also accepts it qualified (`P::x`). */
export function referencePattern(reference: string): string {
	const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return `(?:[\\w']+::)*${escaped}`;
}

/** Add `line` on a new line after the line containing `at`, with the same indentation. */
export function insertLineAfter(text: string, at: number, line: string): Patched {
	const end = text.indexOf('\n', at);
	const lineEnd = end < 0 ? text.length : end;
	const insert = `\n${indentOf(text, at)}${line}`;
	return {
		text: text.slice(0, lineEnd) + insert + text.slice(lineEnd),
		from: lineEnd + insert.length - line.length,
		to: lineEnd + insert.length
	};
}

/**
 * The text between `open` and `close` (a body's braces) as its own members
 * see it: comments, quoted names and strings, and the contents of nested
 * bodies are blanked with spaces (their braces kept), so a pattern matched
 * on it only finds the body's direct statements. Same length as the slice,
 * so an index into it plus `open + 1` is an index into `text`.
 */
export function directText(text: string, open: number, close: number): string {
	let out = '';
	let depth = 0;
	for (let i = open + 1; i < close;) {
		const next = skipTrivia(text, i);
		if (next !== i) {
			out += text.slice(i, next).replace(/[^\n]/g, ' ');
			i = next;
			continue;
		}
		const c = text[i]!;
		if (c === '{') {
			if (depth === 0) out += c;
			else out += ' ';
			depth++;
		} else if (c === '}') {
			depth--;
			out += depth === 0 ? c : ' ';
		} else out += depth > 0 && c !== '\n' ? ' ' : c;
		i++;
	}
	return out;
}

/** The body `{ … }` of the declaration at [from, to), as the indices of its braces. */
export function bodyOf(
	text: string,
	from: number,
	to: number
): { open: number; close: number } | null {
	const head = headerEnd(text, from, to);
	if (!head || head.char !== '{') return null;
	const close = matchBrace(text, head.index);
	return close < 0 ? null : { open: head.index, close };
}

/** Add `line` on a new line before the line containing `at`, with that line's indentation. */
export function insertLineBefore(text: string, at: number, line: string): Patched {
	const start = lineStart(text, at);
	const indent = indentOf(text, at);
	const insert = `${indent}${line}\n`;
	return {
		text: text.slice(0, start) + insert + text.slice(start),
		from: start + indent.length,
		to: start + indent.length + line.length
	};
}
