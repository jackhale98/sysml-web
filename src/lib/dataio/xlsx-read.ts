/**
 * Read the worksheets of an Excel workbook (`.xlsx`, Office Open XML) as rows
 * of text: unzip, then the workbook's sheet list, the shared strings and each
 * sheet's cells. Values are read as the file stores them; formulas give their
 * last calculated value.
 */
import { attributes, decodeXml } from './xml';
import { unzip } from './zip';

export interface Sheet {
	name: string;
	rows: string[][];
}

/** `B12` → column 1 (zero-based). */
export function columnIndex(ref: string): number {
	let n = 0;
	for (const c of ref.toUpperCase()) {
		if (c < 'A' || c > 'Z') break;
		n = n * 26 + (c.charCodeAt(0) - 64);
	}
	return n - 1;
}

/** The text of `<t>` runs in a string item, leaving out phonetic hints (`<rPh>`). */
function runs(xml: string): string {
	const visible = xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '');
	let out = '';
	for (const m of visible.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) {
		out += decodeXml(m[1] ?? '');
	}
	return out;
}

/** Number as people read it: `0.10000000000000001` → `0.1`. */
function numberText(value: string): string {
	const n = Number(value);
	return value.trim() !== '' && Number.isFinite(n) ? String(n) : value;
}

function parseSheet(xml: string, strings: string[]): string[][] {
	const rows: string[][] = [];
	let nextRow = 0;
	const rowPattern = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
	const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
	for (const row of xml.matchAll(rowPattern)) {
		const rowAttrs = attributes(row[1] ?? '');
		const r = rowAttrs.r ? Number(rowAttrs.r) - 1 : nextRow;
		nextRow = r + 1;
		const cells: string[] = [];
		let nextColumn = 0;
		for (const cell of (row[2] ?? '').matchAll(cellPattern)) {
			const a = attributes(cell[1] ?? '');
			const c = a.r ? columnIndex(a.r) : nextColumn;
			nextColumn = c + 1;
			const body = cell[2] ?? '';
			const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
			let value: string;
			switch (a.t) {
				case 's':
					value = strings[Number(v)] ?? '';
					break;
				case 'inlineStr':
					value = runs(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(body)?.[1] ?? '');
					break;
				case 'b':
					value = v === undefined ? '' : v.trim() === '1' ? 'TRUE' : 'FALSE';
					break;
				case 'str':
				case 'e':
				case 'd':
					value = decodeXml(v ?? '');
					break;
				default:
					value = v === undefined ? '' : numberText(decodeXml(v));
			}
			cells[c] = value;
		}
		rows[r] = Array.from(cells, (c) => c ?? '');
	}
	const filled = Array.from(rows, (r) => r ?? []);
	while (filled.length && filled.at(-1)!.every((c) => c === '')) filled.pop();
	return filled;
}

/** Resolve a relationship target against the folder of the part that owns it. */
function resolvePart(base: string, target: string): string {
	if (target.startsWith('/')) return target.slice(1);
	const parts = base.split('/').slice(0, -1);
	for (const segment of target.split('/')) {
		if (segment === '..') parts.pop();
		else if (segment !== '.') parts.push(segment);
	}
	return parts.join('/');
}

/** Every worksheet in the workbook, in tab order. */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
	if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
		throw new Error(
			'This is an older Excel file (.xls). Save it as .xlsx or .csv in Excel, then import that.'
		);
	}
	const entries = await unzip(bytes, 'an .xlsx file is one');
	const decoder = new TextDecoder();
	const files = new Map(entries.map((e) => [e.path.replace(/^\//, ''), e.data]));
	const read = (path: string) => {
		const data = files.get(path);
		return data ? decoder.decode(data) : undefined;
	};

	const rootRels = read('_rels/.rels') ?? '';
	const officeDocument = [...rootRels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)]
		.map((m) => attributes(m[1] ?? ''))
		.find((a) => a.Type?.endsWith('/officeDocument'));
	const workbookPath = officeDocument?.Target
		? resolvePart('', officeDocument.Target)
		: 'xl/workbook.xml';
	const workbook = read(workbookPath);
	if (!workbook) throw new Error('This file has no workbook in it; is it an Excel .xlsx file?');

	const relsPath = workbookPath.replace(/([^/]+)$/, '_rels/$1.rels');
	const rels = new Map<string, { target: string; type: string }>();
	for (const m of (read(relsPath) ?? '').matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) {
		const a = attributes(m[1] ?? '');
		if (a.Id && a.Target) {
			rels.set(a.Id, { target: resolvePart(workbookPath, a.Target), type: a.Type ?? '' });
		}
	}

	const sharedPath = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target;
	const sharedXml = sharedPath ? (read(sharedPath) ?? '') : '';
	const strings = [
		...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)
	].map((m) => runs(m[1] ?? ''));

	const sheets: Sheet[] = [];
	for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
		const a = attributes(m[1] ?? '');
		const id = Object.entries(a).find(([k]) => k === 'r:id' || k.endsWith(':id'))?.[1];
		const rel = id ? rels.get(id) : undefined;
		if (!rel || !rel.type.endsWith('/worksheet')) continue;
		const xml = read(rel.target);
		if (xml === undefined) continue;
		sheets.push({ name: a.name ?? `Sheet${sheets.length + 1}`, rows: parseSheet(xml, strings) });
	}
	if (!sheets.length) throw new Error('This workbook has no worksheets to import.');
	return sheets;
}
