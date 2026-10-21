import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { columnIndex, readXlsx } from './xlsx-read';
import { columnName, isNumeric, sheetName, writeXlsx } from './xlsx-write';
import { crc32, unzip, zip } from './zip';

const text = (s: string) => new TextEncoder().encode(s);

describe('zip', () => {
	it('computes the standard CRC-32', () => {
		expect(crc32(text('123456789'))).toBe(0xcbf43926);
	});

	it('round-trips files, deflated and stored', async () => {
		const long = 'requirement '.repeat(500);
		const bytes = await zip([
			{ path: 'a.txt', data: long },
			{ path: 'dir/ünï.xml', data: 'x' }
		]);
		const entries = await unzip(bytes);
		expect(entries.map((e) => e.path)).toEqual(['a.txt', 'dir/ünï.xml']);
		expect(new TextDecoder().decode(entries[0]!.data)).toBe(long);
		expect(new TextDecoder().decode(entries[1]!.data)).toBe('x');
		// Deflate made the repetitive text much smaller.
		expect(bytes.length).toBeLessThan(long.length / 10);
	});

	it('refuses what is not a ZIP', async () => {
		await expect(unzip(text('ID,Title\n'))).rejects.toThrow(/not a ZIP/);
	});
});

describe('readXlsx', () => {
	it('reads a workbook saved by LibreOffice Calc', async () => {
		const bytes = new Uint8Array(
			readFileSync(join(import.meta.dirname, 'fixtures/libreoffice.xlsx'))
		);
		const sheets = await readXlsx(bytes);
		expect(sheets.map((s) => s.name)).toEqual(['Read me', 'Requirements']);
		const rows = sheets[1]!.rows;
		expect(rows[0]).toEqual([
			'Req ID',
			'Title',
			'Requirement text',
			'Priority',
			'Verification',
			'Status',
			'Owner',
			'Max mass (kg)',
			'Parent'
		]);
		expect(rows[1]).toEqual([
			'SYS-101',
			'Landing light',
			'The drone shall show a light visible from 50 m when it lands.',
			'High',
			'T/I',
			'Open',
			'Zoë Åberg',
			'0.1',
			'STK-002'
		]);
		// Entities, a line break inside a cell, a gap and a formula's value.
		expect(rows[2]).toEqual([
			'SYS-102',
			'Pilot\'s "abort" switch',
			'The pilot shall be able to abort a delivery & return home.\nSecond line <with> symbols.',
			'medium',
			'Demonstration',
			'TBD',
			'',
			'12',
			'SYS-101'
		]);
		expect(rows[3]).toEqual(['', '', 'Text only, in column C.', '1']);
	});

	it('reads inline strings, prefixed XML, booleans and rows without references', async () => {
		const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
		const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
		const bytes = await zip([
			{
				path: '_rels/.rels',
				data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${rel}/officeDocument" Target="/xl/workbook.xml"/></Relationships>`
			},
			{
				path: 'xl/workbook.xml',
				data: `<x:workbook xmlns:x="${main}" xmlns:r="${rel}"><x:sheets><x:sheet name="Reqs &amp; more" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>`
			},
			{
				path: 'xl/_rels/workbook.xml.rels',
				data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="${rel}/worksheet" Target="sheets/one.xml"/></Relationships>`
			},
			{
				path: 'xl/sheets/one.xml',
				data:
					`<x:worksheet xmlns:x="${main}"><x:sheetData>` +
					'<x:row><x:c t="inlineStr"><x:is><x:r><x:t>Rich </x:t></x:r><x:r><x:t>text_x000D_</x:t></x:r></x:is></x:c><x:c t="b"><x:v>1</x:v></x:c></x:row>' +
					'<x:row><x:c t="str"><x:v>from a formula</x:v></x:c><x:c/><x:c><x:v>3.0000000000000004</x:v></x:c></x:row>' +
					'</x:sheetData></x:worksheet>'
			}
		]);
		const [sheet] = await readXlsx(bytes);
		expect(sheet!.name).toBe('Reqs & more');
		expect(sheet!.rows).toEqual([
			['Rich text\r', 'TRUE'],
			['from a formula', '', '3.0000000000000004']
		]);
	});

	it('explains that old .xls files must be saved as .xlsx', async () => {
		await expect(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toThrow(/\.xls\)/);
	});

	it('maps column letters', () => {
		expect(columnIndex('A1')).toBe(0);
		expect(columnIndex('Z9')).toBe(25);
		expect(columnIndex('AA10')).toBe(26);
		expect(columnName(0)).toBe('A');
		expect(columnName(27)).toBe('AB');
		expect(columnName(701)).toBe('ZZ');
		expect(columnName(702)).toBe('AAA');
	});
});

describe('writeXlsx', () => {
	const sheet = {
		name: 'Requirements: all [draft]',
		title: 'Requirements',
		header: ['id', 'title', 'text', 'mass'],
		rows: [
			['SYS-001', 'Flight endurance', 'The drone shall fly for 25 min.\nIn still air.', '4.5'],
			['007', 'Leading zero stays text', 'x < y & "z"', '-12'],
			['SYS-003', '', 'Long '.repeat(40), '1e5']
		]
	};

	it('round-trips through the reader, typing numbers', async () => {
		const bytes = await writeXlsx(sheet);
		const [read] = await readXlsx(bytes);
		expect(read!.name).toBe('Requirements all draft');
		expect(read!.rows).toEqual([sheet.header, ...sheet.rows]);
	});

	it('writes a frozen bold header, fitted widths, a filter and landscape print setup', async () => {
		const files = new Map(
			(await unzip(await writeXlsx(sheet))).map((e) => [e.path, new TextDecoder().decode(e.data)])
		);
		expect([...files.keys()]).toEqual([
			'[Content_Types].xml',
			'_rels/.rels',
			'docProps/core.xml',
			'xl/workbook.xml',
			'xl/_rels/workbook.xml.rels',
			'xl/styles.xml',
			'xl/sharedStrings.xml',
			'xl/worksheets/sheet1.xml'
		]);
		const xml = files.get('xl/worksheets/sheet1.xml')!;
		expect(xml).toContain(
			'<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
		);
		expect(xml).toContain('<autoFilter ref="A1:D4"/>');
		expect(xml).toContain('orientation="landscape"');
		// Header cells use the bold style; numbers are numbers, IDs with leading zeros are text.
		expect(xml).toMatch(/<c r="A1" s="1" t="s">/);
		expect(xml).toContain('<c r="D2" s="3"><v>4.5</v></c>');
		expect(xml).toContain('<c r="D3" s="3"><v>-12</v></c>');
		expect(xml).toMatch(/<c r="A3" s="3" t="s">/);
		expect(xml).toMatch(/<c r="D4" s="3" t="s">/);
		// Widths follow the content; the long text column is capped and wraps.
		expect(xml).toContain('<col min="1" max="1" width="9" customWidth="1"/>');
		expect(xml).toContain('<col min="3" max="3" width="60" customWidth="1"/>');
		expect(xml).toMatch(/<c r="C2" s="2" t="s">/);
		expect(files.get('xl/styles.xml')).toContain('<font><b/>');
		expect(files.get('xl/workbook.xml')).toContain('<sheet name="Requirements all draft"');
		expect(files.get('xl/workbook.xml')).toContain("'Requirements all draft'!$1:$1");
		expect(files.get('xl/sharedStrings.xml')).toContain('x &lt; y &amp; &quot;z&quot;');
		expect(files.get('xl/sharedStrings.xml')).toContain(
			'<t xml:space="preserve">The drone shall fly for 25 min.\nIn still air.</t>'
		);
	});

	it('cleans sheet names to what Excel accepts', () => {
		expect(sheetName('a/b\\c?d*e[f]g:h')).toBe('a b c d e f g h');
		expect(sheetName("'quoted'")).toBe('quoted');
		expect(sheetName('x'.repeat(40))).toHaveLength(31);
		expect(sheetName('  ')).toBe('Sheet1');
	});

	it('types only plain decimals as numbers', () => {
		expect(isNumeric('12')).toBe(true);
		expect(isNumeric('-0.5')).toBe(true);
		expect(isNumeric('007')).toBe(false);
		expect(isNumeric('1e5')).toBe(false);
		expect(isNumeric('1,5')).toBe(false);
		expect(isNumeric('12345678901234567')).toBe(false);
	});
});
