/**
 * Taking back one model edit from a file that may have changed since (typed
 * in, or edited again from a diagram): only the edit's own changes are
 * reversed, where they are now, so whatever came after it stays.
 *
 * Changes are found by comparing texts: lines first (`diffLines`), then the
 * characters within each run of lines that differ, so an edit and later
 * typing on neighbouring lines, or elsewhere on the same line, stay apart.
 */
import { diffLines, splitLines } from '#lib/git/diff.ts';
import type { Change } from './workspace.svelte.ts';

/** The changes that turn `a` into `b`, as ranges of `a` (UTF-16 offsets), in order. */
export function changesBetween(a: string, b: string): Change[] {
	if (a === b) return [];
	const aLines = splitLines(a);
	const bLines = splitLines(b);
	const out: Change[] = [];
	// Character offsets of the current line on each side, and where the open run of differing lines began.
	let aAt = 0;
	let bAt = 0;
	let run: { a: number; b: number } | null = null;
	const close = () => {
		if (!run) return;
		out.push(trimmed(a.slice(run.a, aAt), b.slice(run.b, bAt), run.a));
		run = null;
	};
	for (const { op, a: i, b: j } of diffLines(aLines, bLines)) {
		if (op === 'equal') {
			close();
			aAt += aLines[i]!.length;
			bAt += bLines[j]!.length;
			continue;
		}
		run ??= { a: aAt, b: bAt };
		if (op === 'del') aAt += aLines[i]!.length;
		else bAt += bLines[j]!.length;
	}
	close();
	return out;
}

/** `from` replaced by `to` at `at`, less what they have in common at either end. */
function trimmed(from: string, to: string, at: number): Change {
	let start = 0;
	const max = Math.min(from.length, to.length);
	while (start < max && from[start] === to[start]) start++;
	let end = 0;
	while (end < max - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
	return { from: at + start, to: at + from.length - end, insert: to.slice(start, to.length - end) };
}

/**
 * The changes that take an edit (`before` → `after`) back out of the text
 * as it is now (`current`), as ranges of `current`; null when something
 * changed since inside what the edit wrote or replaced, where taking it
 * back would lose that later change. Text typed right next to the edit's
 * own text, before or after it, is not inside it.
 */
export function revertChanges(before: string, after: string, current: string): Change[] | null {
	if (current === before) return [];
	const edit = changesBetween(after, before);
	const since = changesBetween(after, current);
	const out: Change[] = [];
	for (const undo of edit) {
		// Already taken back (with the text editor's own undo, say).
		if (since.some((s) => s.from === undo.from && s.to === undo.to && s.insert === undo.insert))
			continue;
		if (since.some((s) => s.from < undo.to && undo.from < s.to)) return null;
		// Text typed where the edit's text begins stays before it; where it ends, after it.
		const empty = undo.from === undo.to;
		out.push({
			from: mapPos(since, undo.from, empty ? -1 : 1),
			to: mapPos(since, undo.to, -1),
			insert: undo.insert
		});
	}
	return out;
}

/**
 * Where an offset of the old text is in the new one, given the changes
 * between them; text inserted exactly there comes before it when `assoc`
 * is 1, after it when -1.
 */
function mapPos(changes: Change[], pos: number, assoc: 1 | -1): number {
	let shift = 0;
	for (const c of changes) {
		if (c.from > pos || (c.from === pos && (c.to > pos || assoc < 0))) break;
		shift += c.insert.length - (c.to - c.from);
	}
	return pos + shift;
}
