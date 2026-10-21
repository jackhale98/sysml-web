import { describe, expect, it } from 'vitest';
import { decodeText, detectDelimiter, guardFormula, parseDelimited, writeDelimited } from './csv';

describe('parseDelimited', () => {
	it('reads quoted fields with commas, doubled quotes and line breaks', () => {
		const text = 'ID,Text\r\nR1,"Shall lift 1 kg, then ""hover""\nfor 5 s"\r\nR2,plain\r\n';
		expect(parseDelimited(text).rows).toEqual([
			['ID', 'Text'],
			['R1', 'Shall lift 1 kg, then "hover"\nfor 5 s'],
			['R2', 'plain']
		]);
	});

	it('drops a byte order mark and trailing empty lines', () => {
		expect(parseDelimited('\uFEFFa,b\n1,2\n\n\n').rows).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('reads semicolons, as Excel writes CSV in much of Europe', () => {
		const parsed = parseDelimited('ID;Text;Mass\nR1;"a; b";0,5\n');
		expect(parsed.delimiter).toBe(';');
		expect(parsed.rows[1]).toEqual(['R1', 'a; b', '0,5']);
	});

	it("honours Excel's sep= line", () => {
		const parsed = parseDelimited('sep=;\nA;B,C\n1;2,3\n');
		expect(parsed.delimiter).toBe(';');
		expect(parsed.rows).toEqual([
			['A', 'B,C'],
			['1', '2,3']
		]);
	});

	it('reads cells pasted from Excel or Google Sheets (tabs)', () => {
		const pasted = 'ID\tTitle\tText\nSYS-1\tRange\t"Two\nlines"\nSYS-2\tMass\t\n';
		const parsed = parseDelimited(pasted);
		expect(parsed.delimiter).toBe('\t');
		expect(parsed.rows).toEqual([
			['ID', 'Title', 'Text'],
			['SYS-1', 'Range', 'Two\nlines'],
			['SYS-2', 'Mass', '']
		]);
	});

	it('keeps empty cells and handles a last line without a line break', () => {
		expect(parseDelimited('a,,c\n,,').rows).toEqual([['a', '', 'c']]);
		expect(parseDelimited('a,,c\n,x,').rows).toEqual([
			['a', '', 'c'],
			['', 'x', '']
		]);
	});

	it('detects the delimiter outside quotes only', () => {
		expect(detectDelimiter('"a;b;c",d\n')).toBe(',');
		expect(detectDelimiter('a;b,c;d\n')).toBe(';');
		expect(detectDelimiter('a\tb,c\n')).toBe('\t');
	});
});

describe('writeDelimited', () => {
	it('writes RFC 4180 with CRLF and a UTF-8 byte order mark', () => {
		const csv = writeDelimited([
			['ID', 'Text'],
			['R1', 'He said "go", then\nstopped'],
			['R2', '25 °C ± 2']
		]);
		expect(csv).toBe('\uFEFFID,Text\r\nR1,"He said ""go"", then\nstopped"\r\nR2,25 °C ± 2\r\n');
	});

	it('round-trips through the parser', () => {
		const rows = [
			['a', 'b;c', ' padded '],
			['"quoted"', 'line\r\nbreak', '']
		];
		expect(parseDelimited(writeDelimited(rows)).rows).toEqual(rows);
		expect(parseDelimited(writeDelimited(rows, { delimiter: ';' })).rows).toEqual(rows);
	});

	it('keeps spreadsheets from running cells as formulas', () => {
		expect(guardFormula('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
		expect(guardFormula('+1+1')).toBe("'+1+1");
		expect(guardFormula('@SUM(A1)')).toBe("'@SUM(A1)");
		expect(guardFormula('-cmd')).toBe("'-cmd");
		expect(guardFormula('-40')).toBe('-40');
		expect(guardFormula('-')).toBe('-');
		expect(guardFormula('Plain text')).toBe('Plain text');
	});
});

describe('decodeText', () => {
	it('reads UTF-8 with and without a byte order mark', () => {
		const bytes = new TextEncoder().encode('Zoë');
		expect(decodeText(bytes)).toBe('Zoë');
		expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toBe('Zoë');
	});

	it('falls back to Windows-1252 for CSV saved by older Excel', () => {
		expect(decodeText(new Uint8Array([0x5a, 0x6f, 0xeb, 0x20, 0x80]))).toBe('Zoë €');
	});

	it("reads UTF-16 (Excel's Unicode text)", () => {
		const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x09, 0x00, 0x42, 0x00]);
		expect(decodeText(utf16)).toBe('A\tB');
	});
});
