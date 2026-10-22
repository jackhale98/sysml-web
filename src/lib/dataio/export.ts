/**
 * Exporting a rendered table: as CSV, as an Excel workbook, or printed (and
 * so saved as PDF from the print dialog). Loaded when someone exports, so
 * none of it is in the workbench's first download.
 */
import { download } from '#lib/project/sources.ts';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import { writeDelimited } from './csv';
import { escapeXml } from './xml';

export interface ExportTable {
	/** The view's title, e.g. "Requirements table". */
	title: string;
	project: string;
	/** Column headings as shown. */
	header: string[];
	rows: string[][];
	/** The view's description, printed under the title. */
	doc?: string;
}

/** A file name from a title: `Requirements table.csv`, without characters file systems refuse. */
export function fileName(title: string, extension: string): string {
	const base = title
		// eslint-disable-next-line no-control-regex -- control characters are what is removed
		.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return `${base || 'table'}.${extension}`;
}

/**
 * Hand a file to the person: the share sheet on phones (Files, Mail, Excel…),
 * a download elsewhere or when sharing is not possible.
 */
export async function saveFile(
	name: string,
	data: Uint8Array | string,
	type: string,
	share: boolean
): Promise<void> {
	// A Home Screen app on iPhone or iPad can't download at all: the share sheet is the way out.
	if ((share || downloadsBlocked()) && typeof navigator.canShare === 'function') {
		const file = new File([data as BlobPart], name, { type });
		if (navigator.canShare({ files: [file] })) {
			const files = { files: [file], title: name };
			try {
				await navigator.share(files);
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				// Safari allows the share sheet only straight from a tap, and making the
				// file took longer than that: offer it with a tap of its own.
				if (error instanceof DOMException && error.name === 'NotAllowedError') {
					toasts.show(`${name} is ready.`, {
						tone: 'success',
						duration: 0,
						action: {
							label: 'Share or save',
							run: () => void navigator.share(files).catch(() => {})
						}
					});
					return;
				}
			}
		}
	}
	download(name, data, type);
}

/** An installed web app on iOS or iPadOS, where `<a download>` does nothing. */
function downloadsBlocked(): boolean {
	const ios =
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const standalone =
		(navigator as Navigator & { standalone?: boolean }).standalone === true ||
		matchMedia('(display-mode: standalone)').matches;
	return ios && standalone;
}

export async function exportCsv(table: ExportTable, share: boolean) {
	const csv = writeDelimited([table.header, ...table.rows]);
	await saveFile(fileName(table.title, 'csv'), csv, 'text/csv;charset=utf-8', share);
}

export async function exportXlsx(table: ExportTable, share: boolean) {
	const { writeXlsx } = await import('./xlsx-write');
	const bytes = await writeXlsx({
		name: table.title,
		title: `${table.title} — ${table.project}`,
		header: table.header,
		rows: table.rows
	});
	await saveFile(
		fileName(table.title, 'xlsx'),
		bytes,
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		share
	);
}

const SHEET_CLASS = 'sysml-print-sheet';

/** Whether a table needs a landscape page: many columns or much text across. */
export function isWide(table: Pick<ExportTable, 'header' | 'rows'>): boolean {
	const widths = table.header.map((h, c) =>
		Math.min(40, Math.max(h.length, ...table.rows.slice(0, 50).map((r) => (r[c] ?? '').length)))
	);
	return table.header.length > 5 || widths.reduce((a, b) => a + b, 0) > 90;
}

/** The printable page: title, project and date, then the table. */
export function printHtml(table: ExportTable, date: string): string {
	const head = table.header.map((h) => `<th scope="col">${escapeXml(h)}</th>`).join('');
	const body = table.rows
		.map(
			(r) => `<tr>${table.header.map((_, c) => `<td>${escapeXml(r[c] ?? '')}</td>`).join('')}</tr>`
		)
		.join('');
	const count = `${table.rows.length} ${table.rows.length === 1 ? 'row' : 'rows'}`;
	return (
		`<header><h1>${escapeXml(table.title)}</h1>` +
		`<p>${escapeXml(table.project)} · ${escapeXml(date)} · ${count}</p>` +
		(table.doc ? `<p class="doc">${escapeXml(table.doc)}</p>` : '') +
		`</header><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
	);
}

/**
 * Print the table on its own: a print-only copy of it is added to the page
 * and everything else is hidden from the printer, so the browser's dialog
 * prints (or saves as PDF) just the table, on whatever paper is chosen there
 * (A4, Letter…), landscape when the table is wide.
 */
export function printTable(table: ExportTable) {
	document.querySelectorAll(`.${SHEET_CLASS}, #${SHEET_CLASS}-style`).forEach((e) => e.remove());
	const date = new Date().toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	const sheet = document.createElement('div');
	sheet.className = SHEET_CLASS;
	sheet.innerHTML = printHtml(table, date);
	const style = document.createElement('style');
	style.id = `${SHEET_CLASS}-style`;
	style.textContent = printCss(isWide(table));
	document.head.append(style);
	document.body.append(sheet);
	const previousTitle = document.title;
	// The PDF's suggested file name comes from the document title.
	document.title = `${table.title} — ${table.project}`;
	const cleanup = () => {
		window.removeEventListener('afterprint', later);
		sheet.remove();
		style.remove();
		document.title = previousTitle;
	};
	// Some browsers report the end of printing before they have laid the page out.
	const later = () => setTimeout(cleanup, 1000);
	window.addEventListener('afterprint', later);
	window.print();
}

function printCss(landscape: boolean): string {
	return `
.${SHEET_CLASS} { display: none; }
@media print {
	@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
	html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
	body > *:not(.${SHEET_CLASS}) { display: none !important; }
	.${SHEET_CLASS} {
		display: block; color: #111; background: #fff;
		font: 9pt/1.35 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
	}
	.${SHEET_CLASS} header { margin-bottom: 4mm; }
	.${SHEET_CLASS} h1 { margin: 0 0 1mm; font-size: 15pt; }
	.${SHEET_CLASS} header p { margin: 0; color: #444; }
	.${SHEET_CLASS} header .doc { margin-top: 1mm; max-width: 60em; }
	.${SHEET_CLASS} table { width: 100%; border-collapse: collapse; }
	.${SHEET_CLASS} thead { display: table-header-group; }
	.${SHEET_CLASS} tr { break-inside: avoid; }
	.${SHEET_CLASS} th, .${SHEET_CLASS} td {
		padding: 1.2mm 1.6mm; border: 0.2mm solid #bbb; text-align: left; vertical-align: top;
		overflow-wrap: break-word; white-space: pre-wrap;
	}
	.${SHEET_CLASS} td:first-child { white-space: nowrap; }
	.${SHEET_CLASS} th {
		background: #eef0f3; font-weight: 650; white-space: nowrap;
		-webkit-print-color-adjust: exact; print-color-adjust: exact;
	}
}`;
}
