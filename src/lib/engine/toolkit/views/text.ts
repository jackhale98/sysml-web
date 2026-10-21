/**
 * How table cells read values and names as written: unquoting, the simple
 * name of a reference, a value as a person reads it, numbers and ordering.
 * Ported from the classic engine's `view_render.rs` so cells read the same.
 */

/** `'Flight endurance'` → `Flight endurance` (names that aren't quoted stay as they are). */
export function unquoteName(name: string): string {
	const t = name.trim();
	if (t.length >= 2 && t.startsWith("'") && t.endsWith("'"))
		return t.slice(1, -1).replace(/\\(.)/g, '$1');
	return t;
}

/** `A::B::'c d'` → `'c d'` (the last segment, as written). */
export function simpleName(reference: string): string {
	const parts = splitWritten(reference.trim(), '::');
	return parts[parts.length - 1] ?? reference;
}

/** Split at a separator outside quotes. */
function splitWritten(text: string, separator: string): string[] {
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '\\' && quoted) {
			current += c + (text[i + 1] ?? '');
			i++;
			continue;
		}
		if (c === "'") quoted = !quoted;
		if (!quoted && text.startsWith(separator, i)) {
			out.push(current);
			current = '';
			i += separator.length - 1;
			continue;
		}
		current += c;
	}
	out.push(current);
	return out;
}

/** `A::B.c` → `[A, B, c]`, each segment unquoted. */
export function splitPath(reference: string): string[] {
	return splitWritten(reference.trim(), '::')
		.flatMap((s) => splitWritten(s, '.'))
		.map((s) => unquoteName(s))
		.filter(Boolean);
}

/** A plain identifier: letters, digits and `_`, not starting with a digit. */
export function isPlainIdentifier(text: string): boolean {
	return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(text);
}

/** Strip one layer of `"…"`. */
export function unquote(text: string): string {
	const t = text.trim();
	return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/** Resolve the escapes of a SysML string literal. */
export function unescape(text: string): string {
	return text.replace(/\\(.?)/g, (_, c: string) =>
		c === 'n' ? '\n' : c === 't' ? '\t' : c === '' ? '\\' : c
	);
}

/** Doc text as one line: line breaks and the `*` that starts continuation lines are layout. */
export function collapseWhitespace(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const l = line.trim();
			return l.startsWith('*') && !l.startsWith('**') ? l.slice(1) : l;
		})
		.join(' ')
		.split(/\s+/)
		.filter(Boolean)
		.join(' ');
}

/**
 * A value as a person reads it: strings unquoted, enum literals and
 * references by their simple name, lists comma-separated —
 * `(VerificationMethod::test, VerificationMethod::analysis)` reads
 * `test, analysis`.
 */
export function displayValue(value: string): string {
	const v = value.trim();
	if (v.startsWith('"')) return unescape(unquote(v));
	if (v.startsWith('(') && v.endsWith(')')) {
		const parts = v.slice(1, -1).split(',').map(displayValue);
		if (parts.every((p) => p !== '')) return parts.join(', ');
	}
	const segments = v.split('::');
	const isSegment = (s: string) => isPlainIdentifier(s) || /^'[^']+'$/.test(s);
	if (segments.every(isSegment)) return unquoteName(segments[segments.length - 1]!);
	return v;
}

/** A number as Rust's `f64` parse reads it (no empty strings, no hex). */
export function parseNumber(text: string): number | null {
	const t = text.trim();
	if (!/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf|infinity|nan)$/i.test(t))
		return null;
	return Number(t.replace(/^([+-]?)inf(inity)?$/i, '$1Infinity'));
}

/** Whole numbers without a fraction, the rest to four places. */
export function formatNumber(value: number): string {
	if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
	return value.toFixed(4);
}

/** Numbers compare numerically, everything else as text. */
export function compareCells(x: string, y: string): number {
	const nx = parseNumber(x);
	const ny = parseNumber(y);
	if (nx !== null && ny !== null) return nx < ny ? -1 : nx > ny ? 1 : 0;
	return x < y ? -1 : x > y ? 1 : 0;
}
