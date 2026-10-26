/**
 * Units that don't parse are repaired with the toolkit's `lenientSources()`
 * before a session is built over them: a broken member is cut out (whole
 * lines), and bodies left open get closers appended. Everything the session
 * then reports about such a unit is in the *repaired* text's bytes; a
 * `RepairMap` takes those back to the text the person is editing.
 */
import type { TkDropped } from './api';
import { TextIndex } from './offsets';

interface Run {
	/** Start of the run in the repaired text (bytes). */
	repaired: number;
	/** Start of the run in the original text (bytes). */
	original: number;
	length: number;
}

export class RepairMap {
	/** Text copied unchanged from the original, in order. */
	private readonly runs: Run[];
	/** Byte ranges of the original that were cut out. */
	readonly removed: { start: number; end: number }[];

	private constructor(runs: Run[], removed: { start: number; end: number }[]) {
		this.runs = runs;
		this.removed = removed;
	}

	/** The repaired text's byte offset → the original text's byte offset. */
	toOriginal(byte: number): number {
		let last: Run | undefined;
		for (const run of this.runs) {
			if (byte < run.repaired) break;
			last = run;
		}
		if (!last) return 0;
		// Inside appended text, the position is where it was appended.
		return last.original + Math.min(byte - last.repaired, last.length);
	}

	/**
	 * Whether a byte of the repaired text is text the repair put in (closers, or
	 * text taken back from the file as it last parsed), not the original's.
	 */
	isInserted(byte: number): boolean {
		let last: Run | undefined;
		for (const run of this.runs) {
			if (byte < run.repaired) break;
			last = run;
		}
		return !!last && byte >= last.repaired + last.length;
	}

	/** Whether an original byte offset is inside text the repair removed. */
	isRemoved(byte: number): boolean {
		return this.removed.some((r) => byte >= r.start && byte < r.end);
	}

	/**
	 * Work out how `repaired` came from `original`, from what `lenientSources`
	 * says it dropped; when that doesn't reproduce the repaired text exactly,
	 * fall back to keeping the common start and end and treating the middle as
	 * changed.
	 */
	static build(original: string, repaired: string, dropped: TkDropped[]): RepairMap {
		const index = new TextIndex(original);
		const lineStartByte = (line: number) => index.byteOfLineCol(line, 1);
		type Edit = { start: number; end: number; insert: number };
		const edits: Edit[] = dropped
			.map((d): Edit => {
				if (d.wholeLines) {
					const start = lineStartByte(d.line);
					const after = d.line + Math.max(1, d.linesRemoved);
					const end = after > index.lineCount ? index.byteLength : lineStartByte(after);
					return { start, end, insert: 0 };
				}
				return { start: d.start, end: d.end, insert: byteLength(d.inserted) };
			})
			.sort((a, b) => a.start - b.start || a.end - b.end);

		const originalBytes = new TextEncoder().encode(original);
		const repairedBytes = new TextEncoder().encode(repaired);
		const runs: Run[] = [];
		const out: Uint8Array[] = [];
		let at = 0;
		let written = 0;
		let consistent = true;
		for (const edit of edits) {
			if (edit.start < at) {
				consistent = false;
				break;
			}
			runs.push({ repaired: written, original: at, length: edit.start - at });
			out.push(originalBytes.subarray(at, edit.start));
			written += edit.start - at;
			// Inserted text (closers) is taken from the repaired text itself.
			out.push(repairedBytes.subarray(written, written + edit.insert));
			written += edit.insert;
			at = edit.end;
		}
		if (consistent) {
			runs.push({ repaired: written, original: at, length: originalBytes.length - at });
			out.push(originalBytes.subarray(at));
			if (sameBytes(concat(out), repairedBytes))
				return new RepairMap(
					runs.filter((r) => r.length > 0 || r === runs[0]),
					edits.filter((e) => e.end > e.start).map(({ start, end }) => ({ start, end }))
				);
		}
		return RepairMap.byPrefixAndSuffix(originalBytes, repairedBytes);
	}

	/** Same start and end kept; the differing middle maps to its start. */
	private static byPrefixAndSuffix(original: Uint8Array, repaired: Uint8Array): RepairMap {
		let prefix = 0;
		const max = Math.min(original.length, repaired.length);
		while (prefix < max && original[prefix] === repaired[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < max - prefix &&
			original[original.length - 1 - suffix] === repaired[repaired.length - 1 - suffix]
		)
			suffix++;
		return new RepairMap(
			[
				{ repaired: 0, original: 0, length: prefix },
				{
					repaired: repaired.length - suffix,
					original: original.length - suffix,
					length: suffix
				}
			],
			[{ start: prefix, end: original.length - suffix }]
		);
	}
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
