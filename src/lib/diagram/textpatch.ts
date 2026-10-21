/**
 * Small, careful text patches on SysML source, for the diagram edits the
 * engine cannot compute yet (members of usages, objectives, declarations,
 * statements without a name). Offsets are UTF-16 string offsets.
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
function skipTrivia(text: string, i: number): number {
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
		const start = at + 3 + indent.length - 1;
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

const SPECIALIZES = /(\s*(?::>(?!>)|\bspecializes\b)\s*)([^]*?)(\s*)$/;

/**
 * Add `:> target` to the declaration at `from`, or `, target` when it
 * already specializes something.
 *
 * TODO(engine): replace with the engine's `setDeclaration` edit when it lands.
 */
export function addSpecialization(
	text: string,
	from: number,
	to: number,
	target: string
): Patched | null {
	const head = headerEnd(text, from, to);
	if (!head) return null;
	const header = text.slice(from, head.index);
	const trimmed = header.trimEnd();
	const end = from + trimmed.length;
	const match = SPECIALIZES.exec(trimmed);
	if (match?.[2]?.split(',').some((s) => simpleName(s) === simpleName(target))) return null;
	const insert = match ? `, ${target}` : ` :> ${target}`;
	return {
		text: text.slice(0, end) + insert + text.slice(end),
		from: end + insert.length - target.length,
		to: end + insert.length
	};
}

/** Remove `target` from the declaration's `:>` list (and the `:>` when it was the only one). */
export function removeSpecialization(
	text: string,
	from: number,
	to: number,
	target: string
): string | null {
	const head = headerEnd(text, from, to);
	if (!head) return null;
	const header = text.slice(from, head.index);
	const match = SPECIALIZES.exec(header);
	if (!match || match.index === undefined) return null;
	const list = (match[2] ?? '').split(',').map((s) => s.trim());
	const kept = list.filter((s) => simpleName(s) !== simpleName(target));
	if (kept.length === list.length) return null;
	const clause = kept.length ? `${match[1]}${kept.join(', ')}${match[3]}` : match[3] || ' ';
	const next = header.slice(0, match.index) + clause;
	return text.slice(0, from) + next + text.slice(head.index);
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
