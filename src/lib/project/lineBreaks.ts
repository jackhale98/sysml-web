/**
 * Each file keeps its own line endings: Unix (`\n`), Windows (`\r\n`) or,
 * rarely, old Mac (`\r`). Text the app writes into a file (an edit's new
 * lines, a pasted block) takes the file's line ending, so a Windows file
 * doesn't end up with some lines ending in `\n` only.
 */

export type LineBreak = '\n' | '\r\n' | '\r';

/** The line ending most of a text's lines use (`\n` for a text of one line). */
export function lineBreakOf(text: string): LineBreak {
	let crlf = 0;
	let lf = 0;
	let cr = 0;
	for (const m of text.matchAll(/\r\n|\r|\n/g)) {
		if (m[0] === '\r\n') crlf++;
		else if (m[0] === '\n') lf++;
		else cr++;
	}
	if (crlf > lf && crlf >= cr) return '\r\n';
	if (cr > lf && cr > crlf) return '\r';
	return '\n';
}

/** A text's line breaks, every one, as `lineBreak`. */
export function withLineBreak(text: string, lineBreak: LineBreak): string {
	return text.replace(/\r\n|\r|\n/g, lineBreak);
}

interface Change {
	from: number;
	to: number;
	insert: string;
}

/**
 * Changes to `source` whose inserted line breaks are `source`'s own. A
 * break that completes one already there (a `\n` inserted right after a
 * `\r`) is left as it is.
 */
export function inLineBreaksOf<C extends Change>(source: string, changes: C[]): C[] {
	const lineBreak = lineBreakOf(source);
	return changes.map((change) => {
		if (!/[\r\n]/.test(change.insert)) return change;
		let insert = change.insert;
		let head = '';
		// `\r` + `\n…`: the first `\n` ends the line the source's `\r` began to end.
		if (source[change.from - 1] === '\r' && insert.startsWith('\n')) {
			head = '\n';
			insert = insert.slice(1);
		}
		// `…\r` + `\n`: the last `\r` and the source's `\n` end a line together.
		let tail = '';
		if (source[change.to] === '\n' && insert.endsWith('\r')) {
			tail = '\r';
			insert = insert.slice(0, -1);
		}
		const converted = head + withLineBreak(insert, lineBreak) + tail;
		return converted === change.insert ? change : { ...change, insert: converted };
	});
}
