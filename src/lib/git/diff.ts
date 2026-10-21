/**
 * Line diffs (Myers), grouped into readable hunks, and a three-way merge that
 * combines two sets of changes when they touch different lines.
 */

export type DiffOp = 'equal' | 'add' | 'del';

export interface DiffLine {
	op: DiffOp;
	text: string;
	/** 1-based line number on the old side (equal and del). */
	old?: number;
	/** 1-based line number on the new side (equal and add). */
	new?: number;
}

export interface Hunk {
	lines: DiffLine[];
	/** Equal lines skipped before this hunk. */
	skipped: number;
}

/** Lines of a text, each keeping its line ending, so joining them gives the text back. */
export function splitLines(text: string): string[] {
	if (!text) return [];
	return text.split(/(?<=\n)/);
}

/** Past this many differing lines, report a full replacement instead of searching further. */
const MAX_EDIT_DISTANCE = 4000;

/**
 * The shortest edit script from `a` to `b`, as runs of equal, deleted and
 * added lines (Myers' O(ND) algorithm, with the common prefix and suffix
 * trimmed first).
 */
export function diffLines(a: string[], b: string[]): { op: DiffOp; a: number; b: number }[] {
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	)
		suffix++;

	const ops: { op: DiffOp; a: number; b: number }[] = [];
	for (let i = 0; i < prefix; i++) ops.push({ op: 'equal', a: i, b: i });
	const middle = myers(a, b, prefix, a.length - suffix, prefix, b.length - suffix);
	ops.push(...middle);
	for (let i = suffix; i > 0; i--) ops.push({ op: 'equal', a: a.length - i, b: b.length - i });
	return ops;
}

function myers(
	a: string[],
	b: string[],
	a0: number,
	a1: number,
	b0: number,
	b1: number
): { op: DiffOp; a: number; b: number }[] {
	const n = a1 - a0;
	const m = b1 - b0;
	const replace = () => [
		...Array.from({ length: n }, (_, i) => ({ op: 'del' as const, a: a0 + i, b: b0 })),
		...Array.from({ length: m }, (_, i) => ({ op: 'add' as const, a: a1, b: b0 + i }))
	];
	if (n === 0 || m === 0) return replace();

	const max = Math.min(n + m, MAX_EDIT_DISTANCE);
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	const trace: Int32Array[] = [];
	let found = -1;
	outer: for (let d = 0; d <= max; d++) {
		trace.push(v.slice(offset - d - 1, offset + d + 2));
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
					? v[offset + k + 1]!
					: v[offset + k - 1]! + 1;
			let y = x - k;
			while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break outer;
			}
		}
	}
	if (found < 0) return replace();

	// Walk back through the saved frontiers to recover the path.
	const ops: { op: DiffOp; a: number; b: number }[] = [];
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const saved = trace[d]!;
		// `saved` holds v[k] for k in [-d-1, d+1] as it was before step d.
		const at = (k: number) => saved[k + d + 1]!;
		const k = x - y;
		const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
		const prevX = at(prevK);
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x--;
			y--;
			ops.push({ op: 'equal', a: a0 + x, b: b0 + y });
		}
		if (x === prevX) {
			y--;
			ops.push({ op: 'add', a: a0 + x, b: b0 + y });
		} else {
			x--;
			ops.push({ op: 'del', a: a0 + x, b: b0 + y });
		}
	}
	while (x > 0 && y > 0) {
		x--;
		y--;
		ops.push({ op: 'equal', a: a0 + x, b: b0 + y });
	}
	return ops.reverse();
}

/** The line diff from `before` to `after`, with line numbers. */
export function lineDiff(before: string, after: string): DiffLine[] {
	const a = splitLines(before);
	const b = splitLines(after);
	return diffLines(a, b).map(({ op, a: i, b: j }) =>
		op === 'equal'
			? { op, text: a[i]!, old: i + 1, new: j + 1 }
			: op === 'del'
				? { op, text: a[i]!, old: i + 1 }
				: { op, text: b[j]!, new: j + 1 }
	);
}

/** Changed lines with `context` equal lines around them; long equal runs are folded. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
	const changed = lines.map((l) => l.op !== 'equal');
	const keep = changed.map((_, i) => {
		for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++)
			if (changed[j]) return true;
		return false;
	});
	const out: Hunk[] = [];
	let skipped = 0;
	let current: Hunk | null = null;
	lines.forEach((line, i) => {
		if (!keep[i]) {
			skipped++;
			current = null;
			return;
		}
		if (!current) {
			current = { lines: [], skipped };
			out.push(current);
			skipped = 0;
		}
		current.lines.push(line);
	});
	return out;
}

/** Added and removed line counts. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.op === 'add') added++;
		else if (line.op === 'del') removed++;
	}
	return { added, removed };
}

/** A change to base lines [start, end), replaced by `lines`. */
interface Edit {
	start: number;
	end: number;
	lines: string[];
}

function edits(base: string[], other: string[]): Edit[] {
	const out: Edit[] = [];
	let edit: Edit | null = null;
	for (const { op, a, b } of diffLines(base, other)) {
		if (op === 'equal') {
			edit = null;
			continue;
		}
		if (!edit) {
			edit = { start: a, end: a, lines: [] };
			out.push(edit);
		}
		if (op === 'del') edit.end = a + 1;
		else edit.lines.push(other[b]!);
	}
	return out;
}

const sameEdit = (x: Edit, y: Edit) =>
	x.start === y.start &&
	x.end === y.end &&
	x.lines.length === y.lines.length &&
	x.lines.every((l, i) => l === y.lines[i]);

/**
 * Combine the changes from `base` to `mine` and from `base` to `theirs`.
 * Returns null when they touch the same or adjacent lines (a real conflict
 * that a person must decide).
 */
export function merge3(base: string, mine: string, theirs: string): string | null {
	if (mine === theirs) return mine;
	if (mine === base) return theirs;
	if (theirs === base) return mine;
	const baseLines = splitLines(base);
	const ours = edits(baseLines, splitLines(mine));
	const others = edits(baseLines, splitLines(theirs));
	const all = [...ours.map((e) => ({ e, side: 0 })), ...others.map((e) => ({ e, side: 1 }))].sort(
		(x, y) => x.e.start - y.e.start || x.e.end - y.e.end
	);
	const merged: Edit[] = [];
	let last: { e: Edit; side: number } | null = null;
	for (const item of all) {
		if (last && item.e.start <= last.e.end) {
			// Overlapping or touching: fine only if both made the very same change.
			if (item.side !== last.side && sameEdit(item.e, last.e)) continue;
			if (item.side !== last.side) return null;
		}
		merged.push(item.e);
		last = item;
	}
	const out: string[] = [];
	let at = 0;
	for (const edit of merged) {
		out.push(...baseLines.slice(at, edit.start), ...edit.lines);
		at = edit.end;
	}
	out.push(...baseLines.slice(at));
	return out.join('');
}

/** Git's object id for a file: SHA-1 of `blob <size>\0<content>`. */
export async function blobSha(text: string): Promise<string> {
	const body = new TextEncoder().encode(text);
	const header = new TextEncoder().encode(`blob ${body.length}\0`);
	const data = new Uint8Array(header.length + body.length);
	data.set(header);
	data.set(body, header.length);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
	return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
