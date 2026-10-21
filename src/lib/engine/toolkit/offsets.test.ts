import { describe, expect, it } from 'vitest';
import { TextIndex, TextIndexCache } from './offsets';

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Every UTF-16 offset that is not inside a surrogate pair. */
function boundaries(text: string): number[] {
	const out: number[] = [];
	for (let i = 0; i <= text.length; i++) {
		const prev = text.charCodeAt(i - 1);
		if (i > 0 && i < text.length && prev >= 0xd800 && prev <= 0xdbff) continue;
		out.push(i);
	}
	return out;
}

const SAMPLES = {
	ascii: 'package P {\n    part def A;\n}\n',
	accents: "part def 'Wärme' {\n    attribute größe = 1;\n}",
	emoji: "part def 'Wärme😀';\npart y : Nope; // 🚁 drone\n",
	crlf: 'package P {\r\n    part def A;\r\n    // é\r\n}\r\n',
	cjk: 'doc /* 无人机 */\npart def 机;\n',
	empty: '',
	noNewline: 'part x;'
};

describe('TextIndex', () => {
	for (const [name, text] of Object.entries(SAMPLES)) {
		it(`round-trips every offset (${name})`, () => {
			const index = new TextIndex(text);
			expect(index.byteLength).toBe(bytes(text));
			for (const offset of boundaries(text)) {
				const byte = index.utf16ToByte(offset);
				expect(byte).toBe(bytes(text.slice(0, offset)));
				expect(index.byteToUtf16(byte)).toBe(offset);
				const { line, col } = index.lineColOf(offset);
				expect(index.offsetOf(line, col, 'utf16')).toBe(offset);
				const position = index.offsetToPosition(offset);
				expect(index.positionToOffset(position)).toBe(offset);
			}
		});
	}

	it('converts byte columns (as check() reports them) to UTF-16 offsets', () => {
		// The probe from the evaluation: check() said col 68 where the UTF-16 column is 61.
		const text = "part def 'Wärme😀';\npart y : Nope;";
		const index = new TextIndex(text);
		const line1 = "part def 'Wärme😀';";
		// `;` on line 1: byte column vs UTF-16 column.
		const byteCol = bytes(line1.slice(0, line1.indexOf(';'))) + 1;
		const utf16Col = line1.indexOf(';') + 1;
		expect(byteCol).toBe(utf16Col + 3); // ä is 2 bytes/1 unit, 😀 is 4 bytes/2 units
		expect(index.offsetOf(1, byteCol, 'byte')).toBe(line1.indexOf(';'));
		expect(index.offsetOf(1, utf16Col, 'utf16')).toBe(line1.indexOf(';'));
		expect(index.offsetOf(2, 10, 'byte')).toBe(text.indexOf('Nope'));
		expect(index.byteOfLineCol(2, 10)).toBe(bytes(text.slice(0, text.indexOf('Nope'))));
	});

	it('maps a byte offset inside a character to its start', () => {
		const text = 'a😀b';
		const index = new TextIndex(text);
		expect(index.byteToUtf16(1)).toBe(1);
		expect(index.byteToUtf16(2)).toBe(1);
		expect(index.byteToUtf16(4)).toBe(1);
		expect(index.byteToUtf16(5)).toBe(3);
		expect(index.utf16ToByte(2)).toBe(1); // between the surrogate halves
	});

	it('counts lines at \\n only, keeping \\r on its line (CRLF)', () => {
		const text = SAMPLES.crlf;
		const index = new TextIndex(text);
		expect(index.lineCount).toBe(5);
		const at = text.indexOf('part');
		expect(index.lineColOf(at)).toEqual({ line: 2, col: 5 });
		expect(index.offsetOf(3, 8, 'byte')).toBe(text.indexOf('é'));
		expect(index.offsetOf(3, 10, 'byte')).toBe(text.indexOf('é') + 1);
		// A column past the end of a line stops at the line end (the \n).
		expect(index.offsetOf(1, 99, 'utf16')).toBe(text.indexOf('\n'));
	});

	it('clamps out-of-range input', () => {
		const index = new TextIndex('ab\ncd');
		expect(index.byteToUtf16(-4)).toBe(0);
		expect(index.byteToUtf16(99)).toBe(5);
		expect(index.utf16ToByte(99)).toBe(5);
		expect(index.offsetOf(9, 1, 'utf16')).toBe(5);
		expect(index.offsetOf(0, 1, 'utf16')).toBe(0);
		expect(index.lineColOf(99)).toEqual({ line: 2, col: 3 });
	});

	it('builds spans with bytes, UTF-16 offsets and lines', () => {
		const text = "part def 'Wärme😀' {\n    part p;\n}";
		const index = new TextIndex(text);
		const start = bytes(text.slice(0, text.indexOf('part p')));
		const span = index.spanOfBytes(start, start + 'part p;'.length);
		expect(span).toEqual({
			start_row: 2,
			start_col: 5,
			end_row: 2,
			end_col: 12,
			start_byte: start,
			end_byte: start + 7,
			from: text.indexOf('part p'),
			to: text.indexOf('part p') + 7
		});
		expect(index.sliceBytes(span.start_byte, span.end_byte)).toBe('part p;');
	});

	it('caches one index per file text', () => {
		const cache = new TextIndexCache();
		const a = cache.get('a', 'x');
		expect(cache.get('a', 'x')).toBe(a);
		expect(cache.get('a', 'y')).not.toBe(a);
		cache.retain([]);
		expect(cache.get('a', 'y').text).toBe('y');
	});
});
