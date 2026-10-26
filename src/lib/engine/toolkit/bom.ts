/**
 * A UTF-8 byte-order mark at the start of a file is kept in its text (and so
 * written back), but the toolkit reads it as an unexpected character. It is
 * given a space in its place: one UTF-16 unit, like the mark, so UTF-16
 * offsets (the editor's, the language server's, an edit's) are the same in
 * both texts; the space is one byte where the mark is three, which
 * `toOriginalByte` (`model.ts`) adds back to byte offsets past it.
 */

export const BOM = '﻿';

/** Bytes a byte-order mark has more than the space that stands in for it. */
export const BOM_BYTES_MORE = 2;

/** The text as the toolkit is given it. */
export function withoutBom(text: string): string {
	return text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
}

/** Files as the toolkit is given them. */
export function filesWithoutBom<F extends { text: string }>(files: F[]): F[] {
	return files.some((f) => f.text.startsWith(BOM))
		? files.map((f) => (f.text.startsWith(BOM) ? { ...f, text: withoutBom(f.text) } : f))
		: files;
}

/** A text the toolkit made from `original`, with `original`'s byte-order mark back in place of the space. */
export function withBomOf(original: string, text: string): string {
	if (!original.startsWith(BOM) || text.startsWith(BOM)) return text;
	return BOM + (text.startsWith(' ') ? text.slice(1) : text);
}
