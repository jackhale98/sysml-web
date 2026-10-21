/**
 * The smallest set of changes that turns one text into another. The toolkit's
 * rename, formatting and some code actions answer with whole new documents;
 * the editor wants minimal changes so the cursor, folds and undo history stay
 * where they are. Lines are matched with Myers' diff, then each changed run
 * of lines is narrowed to the characters that differ.
 */

export interface TextChange {
	/** UTF-16 offsets into the old text. */
	from: number;
	to: number;
	insert: string;
}

export function diffTexts(before: string, after: string): TextChange[] {
	if (before === after) return [];
	const a = splitLines(before);
	const b = splitLines(after);
	const changes: TextChange[] = [];
	// Offsets of each line start in the old and new text.
	const startA = starts(a);
	const startB = starts(b);
	for (const [aFrom, aTo, bFrom, bTo] of hunks(a, b)) {
		// As many lines changed as replaced them: change each line on its own.
		if (aTo - aFrom === bTo - bFrom) {
			for (let i = 0; i < aTo - aFrom; i++)
				changes.push(narrow(a[aFrom + i]!, b[bFrom + i]!, startA[aFrom + i]!));
			continue;
		}
		const oldText = before.slice(startA[aFrom]!, startA[aTo]!);
		const newText = after.slice(startB[bFrom]!, startB[bTo]!);
		changes.push(narrow(oldText, newText, startA[aFrom]!));
	}
	return changes.filter((c) => c.from !== c.to || c.insert);
}

/** Lines with their `\n`, so joining them gives the text back. */
function splitLines(text: string): string[] {
	const lines = text.split(/(?<=\n)/);
	return lines.length === 1 && lines[0] === '' ? [] : lines;
}

function starts(lines: string[]): number[] {
	const out = [0];
	for (const line of lines) out.push(out[out.length - 1]! + line.length);
	return out;
}

/** One change for a differing run, without its common start and end. */
function narrow(oldText: string, newText: string, offset: number): TextChange {
	let start = 0;
	const max = Math.min(oldText.length, newText.length);
	while (start < max && oldText[start] === newText[start]) start++;
	let end = 0;
	while (
		end < max - start &&
		oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]
	)
		end++;
	return {
		from: offset + start,
		to: offset + oldText.length - end,
		insert: newText.slice(start, newText.length - end)
	};
}

/** Runs of differing lines: `[aFrom, aTo, bFrom, bTo]` (Myers' O((N+M)D) diff). */
function hunks(a: string[], b: string[]): [number, number, number, number][] {
	const n = a.length;
	const m = b.length;
	const max = n + m;
	const v = new Int32Array(2 * max + 2);
	const trace: Int32Array[] = [];
	let found = false;
	for (let d = 0; d <= max && !found; d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[max + k - 1]! < v[max + k + 1]!)
					? v[max + k + 1]!
					: v[max + k - 1]! + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[max + k] = x;
			if (x >= n && y >= m) {
				found = true;
				break;
			}
		}
	}
	// Walk back through the trace to the matched line pairs.
	const matches: [number, number][] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
		const vd = trace[d]!;
		const k = x - y;
		const prevK = k === -d || (k !== d && vd[max + k - 1]! < vd[max + k + 1]!) ? k + 1 : k - 1;
		const prevX = d === 0 ? 0 : vd[max + prevK]!;
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x--;
			y--;
			matches.push([x, y]);
		}
		if (d > 0) {
			x = prevX;
			y = prevY;
		}
	}
	while (x > 0 && y > 0) {
		x--;
		y--;
		matches.push([x, y]);
	}
	matches.reverse();
	const out: [number, number, number, number][] = [];
	let ai = 0;
	let bi = 0;
	for (const [ma, mb] of [...matches, [n, m] as [number, number]]) {
		if (ma > ai || mb > bi) out.push([ai, ma, bi, mb]);
		ai = ma + 1;
		bi = mb + 1;
	}
	return out;
}
