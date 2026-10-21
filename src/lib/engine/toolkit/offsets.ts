/**
 * Positions in one file's text, in every unit the engines and the editor use.
 *
 * The toolkit reports most positions in UTF-8 **bytes** (`check()` columns,
 * `declarationSite`, `memberExtent`, `lenientSources`, `edit()` splices) and
 * some in **UTF-16** code units (`references()`, the language server). The
 * editor (CodeMirror) counts UTF-16 code units, and the app's `Span` carries
 * byte offsets plus 1-based lines. Every conversion goes through a
 * `TextIndex` built once per file text, so none of them re-encodes the file.
 *
 * Lines end at `\n` only: in `\r\n` the `\r` is the last character of its
 * line, as the toolkit counts it. Offsets past the end clamp to the end, and a
 * byte offset inside a multi-byte character maps to that character's start.
 */
import type { Span } from '../types';

/** A 1-based line and column. */
export interface LineCol {
	line: number;
	col: number;
}

/** A 0-based LSP position (`character` in UTF-16 code units). */
export interface Position {
	line: number;
	character: number;
}

export class TextIndex {
	readonly text: string;
	/** UTF-16 offset where each line starts. */
	private readonly lineStarts: number[] = [0];
	/** Byte offset where each line starts. */
	private readonly lineBytes: number[] = [0];
	/** Whether each line is pure ASCII (bytes and UTF-16 units then agree). */
	private readonly ascii: boolean[] = [];
	readonly byteLength: number;

	constructor(text: string) {
		this.text = text;
		let bytes = 0;
		let ascii = true;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code < 0x80) bytes += 1;
			else {
				ascii = false;
				if (code < 0x800) bytes += 2;
				else if (code >= 0xd800 && code <= 0xdbff && isLow(text.charCodeAt(i + 1))) {
					bytes += 4;
					i++;
				} else bytes += 3;
			}
			if (code === 0x0a) {
				this.ascii.push(ascii);
				ascii = true;
				this.lineStarts.push(i + 1);
				this.lineBytes.push(bytes);
			}
		}
		this.ascii.push(ascii);
		this.byteLength = bytes;
	}

	get lineCount(): number {
		return this.lineStarts.length;
	}

	/** UTF-8 byte offset → UTF-16 offset. */
	byteToUtf16(byte: number): number {
		if (byte <= 0) return 0;
		if (byte >= this.byteLength) return this.text.length;
		const line = upperBound(this.lineBytes, byte) - 1;
		return this.lineStarts[line]! + this.lineByteToUnits(line, byte - this.lineBytes[line]!);
	}

	/** UTF-16 offset → UTF-8 byte offset. */
	utf16ToByte(offset: number): number {
		if (offset <= 0) return 0;
		if (offset >= this.text.length) return this.byteLength;
		const line = upperBound(this.lineStarts, offset) - 1;
		const start = this.lineStarts[line]!;
		if (this.ascii[line]) return this.lineBytes[line]! + (offset - start);
		return this.lineBytes[line]! + utf8Length(this.text, start, offset);
	}

	/** UTF-16 offset → 1-based line and 1-based UTF-16 column. */
	lineColOf(offset: number): LineCol {
		const clamped = Math.max(0, Math.min(offset, this.text.length));
		const line = upperBound(this.lineStarts, clamped) - 1;
		return { line: line + 1, col: clamped - this.lineStarts[line]! + 1 };
	}

	/** 1-based line and column → UTF-16 offset; `unit` says what the column counts. */
	offsetOf(line: number, col: number, unit: 'byte' | 'utf16'): number {
		if (line < 1) return 0;
		if (line > this.lineCount) return this.text.length;
		const index = line - 1;
		const start = this.lineStarts[index]!;
		// The end of the line: its `\n`, which a column may point at but not past.
		const end = index + 1 < this.lineCount ? this.lineStarts[index + 1]! - 1 : this.text.length;
		const within = Math.max(0, col - 1);
		const units = unit === 'utf16' ? within : this.lineByteToUnits(index, within);
		return Math.min(start + units, end);
	}

	/** 1-based line and byte column → byte offset (what `check()` reports, as an offset). */
	byteOfLineCol(line: number, byteCol: number): number {
		if (line < 1) return 0;
		if (line > this.lineCount) return this.byteLength;
		const index = line - 1;
		const next = index + 1 < this.lineCount ? this.lineBytes[index + 1]! - 1 : this.byteLength;
		return Math.min(this.lineBytes[index]! + Math.max(0, byteCol - 1), next);
	}

	/** LSP position → UTF-16 offset. */
	positionToOffset(position: Position): number {
		return this.offsetOf(position.line + 1, position.character + 1, 'utf16');
	}

	/** UTF-16 offset → LSP position. */
	offsetToPosition(offset: number): Position {
		const { line, col } = this.lineColOf(offset);
		return { line: line - 1, character: col - 1 };
	}

	/** The app's span for a byte range, with UTF-16 offsets and lines filled in. */
	spanOfBytes(startByte: number, endByte: number): Span {
		const from = this.byteToUtf16(startByte);
		const to = this.byteToUtf16(Math.max(startByte, endByte));
		return this.spanOf(from, to);
	}

	/** The app's span for a UTF-16 range. */
	spanOf(from: number, to: number): Span {
		const start = this.lineColOf(from);
		const end = this.lineColOf(Math.max(from, to));
		return {
			start_row: start.line,
			start_col: start.col,
			end_row: end.line,
			end_col: end.col,
			start_byte: this.utf16ToByte(from),
			end_byte: this.utf16ToByte(Math.max(from, to)),
			from,
			to: Math.max(from, to)
		};
	}

	/** The text of a byte range. */
	sliceBytes(startByte: number, endByte: number): string {
		return this.text.slice(this.byteToUtf16(startByte), this.byteToUtf16(endByte));
	}

	/** How many UTF-16 units the first `bytes` bytes of a line take. */
	private lineByteToUnits(line: number, bytes: number): number {
		const start = this.lineStarts[line]!;
		const end = line + 1 < this.lineCount ? this.lineStarts[line + 1]! : this.text.length;
		if (this.ascii[line]) return Math.min(bytes, end - start);
		let seen = 0;
		let i = start;
		while (i < end) {
			const code = this.text.charCodeAt(i);
			const pair = code >= 0xd800 && code <= 0xdbff && isLow(this.text.charCodeAt(i + 1));
			const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
			// A byte offset inside a character maps to that character's start.
			if (seen + size > bytes) break;
			seen += size;
			i += pair ? 2 : 1;
		}
		return i - start;
	}
}

const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** UTF-8 length of `text.slice(from, to)`, without allocating. */
function utf8Length(text: string, from: number, to: number): number {
	let bytes = 0;
	for (let i = from; i < to; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && isLow(text.charCodeAt(i + 1))) {
			// A surrogate pair is one 4-byte character; stopping between its halves counts none of it.
			if (i + 1 >= to) break;
			bytes += 4;
			i++;
		} else bytes += 3;
	}
	return bytes;
}

/** The index of the first element greater than `value` (`list` ascending). */
function upperBound(list: number[], value: number): number {
	let lo = 0;
	let hi = list.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (list[mid]! <= value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** One `TextIndex` per distinct text, reused while the text is unchanged. */
export class TextIndexCache {
	private readonly cache = new Map<string, TextIndex>();

	get(key: string, text: string): TextIndex {
		const hit = this.cache.get(key);
		if (hit && hit.text === text) return hit;
		const index = new TextIndex(text);
		this.cache.set(key, index);
		return index;
	}

	/** Forget files no longer in the project. */
	retain(keys: Iterable<string>) {
		const keep = new Set(keys);
		for (const key of this.cache.keys()) if (!keep.has(key)) this.cache.delete(key);
	}
}
