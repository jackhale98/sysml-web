/**
 * Write a table as an Excel workbook (Office Open XML, ECMA-376): one sheet
 * named after the view, a bold header row that stays put while scrolling and
 * filters, columns sized to their content, numbers stored as numbers, and a
 * page setup that prints landscape, one page wide, with the header on each
 * page. Hand-written XML in a small ZIP: no spreadsheet library.
 */
import { escapeXml } from './xml';
import { zip } from './zip';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Widest column, in characters; longer text wraps. */
const MAX_WIDTH = 60;

export interface SheetData {
	/** The sheet's name (the view's title); cleaned up to Excel's rules. */
	name: string;
	header: string[];
	rows: string[][];
	/** Document title in the file's properties. */
	title?: string;
}

/** Excel's column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
	let name = '';
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
		name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	}
	return name;
}

/** A sheet name Excel accepts: ≤ 31 characters, none of `[]:*?/\`, no outer apostrophes. */
export function sheetName(name: string): string {
	const clean = name
		.replace(/[[\]:*?/\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^'+|'+$/g, '')
		.slice(0, 31)
		.trim();
	return clean || 'Sheet1';
}

/** Whether a cell is stored as a number: plain decimals, no leading zeros (IDs stay text). */
export function isNumeric(cell: string): boolean {
	return cell.length <= 15 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(cell);
}

function width(cell: string): number {
	return Math.max(0, ...cell.split('\n').map((line) => [...line].length));
}

function text(value: string): string {
	const preserve = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : '';
	return `<t${preserve}>${escapeXml(value)}</t>`;
}

export async function writeXlsx(sheet: SheetData): Promise<Uint8Array> {
	const name = sheetName(sheet.name);
	const columns = Math.max(sheet.header.length, ...sheet.rows.map((r) => r.length), 1);
	const strings: string[] = [];
	const index = new Map<string, number>();
	const shared = (value: string) => {
		let i = index.get(value);
		if (i === undefined) {
			i = strings.length;
			strings.push(value);
			index.set(value, i);
		}
		return i;
	};

	const widths = Array.from({ length: columns }, (_, c) =>
		Math.min(
			MAX_WIDTH,
			Math.max(6, width(sheet.header[c] ?? '') + 4, ...sheet.rows.map((r) => width(r[c] ?? '') + 2))
		)
	);
	const wraps = widths.map(
		(w, c) => w >= MAX_WIDTH || sheet.rows.some((r) => (r[c] ?? '').includes('\n'))
	);

	const rowXml = (cells: string[], r: number, header: boolean) => {
		const out: string[] = [];
		cells.forEach((cell, c) => {
			if (cell === '') return;
			const ref = `${columnName(c)}${r}`;
			const style = header ? 1 : wraps[c] ? 2 : 3;
			if (!header && isNumeric(cell)) out.push(`<c r="${ref}" s="${style}"><v>${cell}</v></c>`);
			else out.push(`<c r="${ref}" s="${style}" t="s"><v>${shared(cell)}</v></c>`);
		});
		return `<row r="${r}">${out.join('')}</row>`;
	};

	const last = `${columnName(columns - 1)}${sheet.rows.length + 1}`;
	const range = `A1:${last}`;
	const quotedName = `'${name.replace(/'/g, "''")}'`;
	const absolute = `${quotedName}!$A$1:$${columnName(columns - 1)}$${sheet.rows.length + 1}`;

	const worksheet =
		XML_HEAD +
		`<worksheet xmlns="${MAIN}" xmlns:r="${REL}">` +
		'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
		`<dimension ref="${range}"/>` +
		'<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
		'<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
		'<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
		'</sheetView></sheetViews>' +
		'<sheetFormatPr defaultRowHeight="15"/>' +
		`<cols>${widths
			.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
			.join('')}</cols>` +
		'<sheetData>' +
		rowXml(sheet.header, 1, true) +
		sheet.rows.map((row, i) => rowXml(row, i + 2, false)).join('') +
		'</sheetData>' +
		`<autoFilter ref="${range}"/>` +
		'<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
		'<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
		'</worksheet>';

	const sharedStrings =
		XML_HEAD +
		`<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">` +
		strings.map((s) => `<si>${text(s)}</si>`).join('') +
		'</sst>';

	const workbook =
		XML_HEAD +
		`<workbook xmlns="${MAIN}" xmlns:r="${REL}">` +
		'<bookViews><workbookView/></bookViews>' +
		`<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
		'<definedNames>' +
		`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${escapeXml(absolute)}</definedName>` +
		`<definedName name="_xlnm.Print_Titles" localSheetId="0">${escapeXml(quotedName)}!$1:$1</definedName>` +
		'</definedNames>' +
		'</workbook>';

	const styles =
		XML_HEAD +
		`<styleSheet xmlns="${MAIN}">` +
		'<fonts count="2">' +
		'<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
		'<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
		'</fonts>' +
		'<fills count="3">' +
		'<fill><patternFill patternType="none"/></fill>' +
		'<fill><patternFill patternType="gray125"/></fill>' +
		'<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F5"/><bgColor indexed="64"/></patternFill></fill>' +
		'</fills>' +
		'<borders count="2">' +
		'<border><left/><right/><top/><bottom/><diagonal/></border>' +
		'<border><left/><right/><top/><bottom style="thin"><color rgb="FFB7BCC4"/></bottom><diagonal/></border>' +
		'</borders>' +
		'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
		'<cellXfs count="4">' +
		'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
		'<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
		'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
		'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
		'</cellXfs>' +
		'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
		'</styleSheet>';

	const core =
		XML_HEAD +
		'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
		`<dc:title>${escapeXml(sheet.title ?? name)}</dc:title>` +
		'<dc:creator>Tessera</dc:creator>' +
		'</cp:coreProperties>';

	const contentTypes =
		XML_HEAD +
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
		'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
		'<Default Extension="xml" ContentType="application/xml"/>' +
		'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
		'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
		'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
		'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
		'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
		'</Types>';

	const rootRels =
		XML_HEAD +
		`<Relationships xmlns="${PKG_REL}">` +
		`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
		`<Relationship Id="rId2" Type="${PKG_REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
		'</Relationships>';

	const workbookRels =
		XML_HEAD +
		`<Relationships xmlns="${PKG_REL}">` +
		`<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
		`<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
		`<Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
		'</Relationships>';

	return zip([
		{ path: '[Content_Types].xml', data: contentTypes },
		{ path: '_rels/.rels', data: rootRels },
		{ path: 'docProps/core.xml', data: core },
		{ path: 'xl/workbook.xml', data: workbook },
		{ path: 'xl/_rels/workbook.xml.rels', data: workbookRels },
		{ path: 'xl/styles.xml', data: styles },
		{ path: 'xl/sharedStrings.xml', data: sharedStrings },
		{ path: 'xl/worksheets/sheet1.xml', data: worksheet }
	]);
}
