/**
 * CSV and tab-separated text, the way spreadsheets write them (RFC 4180):
 * quoted fields may hold the delimiter, quotes ("" inside) and line breaks.
 * Reading accepts commas, semicolons (Excel in much of Europe) and tabs
 * (cells copied from Excel or Google Sheets), and Excel's `sep=` line.
 */

export type Delimiter = ',' | ';' | '\t';

export interface Parsed {
	rows: string[][];
	delimiter: Delimiter;
}

/** The delimiter used on the first line, counting only outside quotes. */
export function detectDelimiter(text: string): Delimiter {
	const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === '"') quoted = !quoted;
		else if (!quoted && (c === '\n' || c === '\r')) break;
		else if (!quoted && (c === ',' || c === ';' || c === '\t')) counts[c]++;
	}
	if (counts['\t'] && counts['\t'] >= counts[','] && counts['\t'] >= counts[';']) return '\t';
	return counts[';'] > counts[','] ? ';' : ',';
}

/** Parse delimited text into rows of cells. Trailing empty lines are dropped. */
export function parseDelimited(input: string, delimiter?: Delimiter): Parsed {
	let text = input.startsWith('\uFEFF') ? input.slice(1) : input;
	const sep = /^sep=(.)\r?\n/i.exec(text);
	if (sep && (sep[1] === ',' || sep[1] === ';' || sep[1] === '\t')) {
		delimiter ??= sep[1];
		text = text.slice(sep[0].length);
	}
	const d = delimiter ?? detectDelimiter(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let i = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				quoted = false;
			} else cell += c;
			i++;
			continue;
		}
		if (c === '"' && cell === '') {
			quoted = true;
		} else if (c === d) {
			row.push(cell);
			cell = '';
		} else if (c === '\r' || c === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			if (c === '\r' && text[i + 1] === '\n') i++;
		} else cell += c;
		i++;
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	while (rows.length && rows.at(-1)!.every((c) => c === '')) rows.pop();
	return { rows, delimiter: d };
}

/**
 * A cell that a spreadsheet would run as a formula (`=…`, `+…`, `@…`, or `-`
 * followed by something other than a number) gets a leading apostrophe, so
 * opening an exported model never runs code hidden in its text.
 */
export function guardFormula(cell: string): string {
	if (/^[=+@\t\r]/.test(cell) || (/^-./s.test(cell) && Number.isNaN(Number(cell)))) {
		return `'${cell}`;
	}
	return cell;
}

function quote(cell: string, delimiter: string): string {
	return cell.includes('"') ||
		cell.includes(delimiter) ||
		cell.includes('\n') ||
		cell.includes('\r') ||
		/^\s|\s$/.test(cell)
		? `"${cell.replace(/"/g, '""')}"`
		: cell;
}

/**
 * Rows as CSV: CRLF line ends and a UTF-8 byte order mark, so Excel opens
 * accented letters, units and symbols correctly.
 */
export function writeDelimited(
	rows: string[][],
	{ delimiter = ',', bom = true }: { delimiter?: Delimiter; bom?: boolean } = {}
): string {
	const body = rows
		.map((row) => row.map((cell) => quote(guardFormula(cell), delimiter)).join(delimiter))
		.join('\r\n');
	return (bom ? '\uFEFF' : '') + body + '\r\n';
}

/**
 * Text from a file's bytes: UTF-8 (with or without BOM), UTF-16 with a BOM
 * (Excel's "Unicode text"), or Windows-1252 (Excel's plain "CSV" on Windows).
 */
export function decodeText(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		let text = '';
		for (const byte of bytes) {
			text += String.fromCharCode(byte >= 0x80 && byte < 0xa0 ? CP1252[byte - 0x80]! : byte);
		}
		return text;
	}
}

/** Windows-1252 code points for bytes 0x80–0x9F (the rest match Latin-1). */
const CP1252 = [
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
	0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
	0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178
];
