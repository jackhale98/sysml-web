/** Working with source text and engine spans. */

/** The text a span covers. Spans count UTF-8 bytes; JS strings count UTF-16 units. */
export function sliceBytes(text: string, start: number, end: number): string {
	const bytes = new TextEncoder().encode(text);
	return new TextDecoder().decode(bytes.subarray(start, end));
}

/**
 * A source excerpt for display: re-indents the first line (which starts at
 * `startCol`) like the rest, then removes the indentation common to all lines.
 */
export function excerpt(text: string, startCol: number): string {
	const lines = (' '.repeat(Math.max(0, startCol - 1)) + text).split('\n');
	const indents = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
	const common = indents.length ? Math.min(...indents) : 0;
	return lines.map((l) => l.slice(Math.min(common, l.length - l.trimStart().length))).join('\n');
}
