/**
 * Printing and the standalone HTML file: page set-up with a running header
 * and footer, the rules that print only the report (no app around it), and
 * the frame of the downloaded file.
 */
import type { ReportDocument } from './document.ts';

/** A CSS string literal. */
function cssString(text: string): string {
	const escaped = text
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/</g, '\\3C ')
		.replace(/[\n\r]+/g, ' ');
	return `"${escaped}"`;
}

/** `@page`: A4 margins, project and title at the top, the revision and page numbers at the bottom. */
export function pageCss(doc: ReportDocument): string {
	const id = [doc.number, doc.version && `version ${doc.version}`, doc.revision]
		.filter(Boolean)
		.join(' · ');
	return `@page {
	size: A4;
	margin: 20mm 18mm 22mm;
	@top-left { content: ${cssString(doc.project)}; font: 8pt sans-serif; color: #666; }
	@top-right { content: ${cssString(doc.title)}; font: 8pt sans-serif; color: #666; }
	@bottom-left { content: ${cssString(id || doc.date)}; font: 8pt sans-serif; color: #666; }
	@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: #666; }
}
@page :first {
	@top-left { content: none; }
	@top-right { content: none; }
}`;
}

/**
 * In the app, print only the report: everything that neither holds it nor
 * is inside it is hidden, and what holds it stops scrolling and clipping.
 */
export const APP_PRINT_CSS = `@media print {
	html:has(.rd-printable),
	html:has(.rd-printable) body {
		position: static !important;
		inset: auto !important;
		height: auto !important;
		min-height: 0 !important;
		overflow: visible !important;
		background: #fff !important;
	}
	body:has(.rd-printable) :not(:has(.rd-printable)):not(.rd-printable, .rd-printable *) {
		display: none !important;
	}
	body:has(.rd-printable) :has(.rd-printable) {
		display: block !important;
		position: static !important;
		width: auto !important;
		height: auto !important;
		min-height: 0 !important;
		max-height: none !important;
		margin: 0 !important;
		padding: 0 !important;
		border: 0 !important;
		overflow: visible !important;
		box-shadow: none !important;
		background: #fff !important;
		transform: none !important;
		contain: none !important;
	}
	.rd-printable {
		margin: 0 !important;
		padding: 0 !important;
		max-width: none !important;
		border: 0 !important;
		box-shadow: none !important;
	}
}`;

/** The page around the document in the downloaded file. */
export const STANDALONE_CSS = `html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: #f4f4f1; container-type: inline-size; }
.rd { max-width: 50rem; margin: 2.5rem auto 4rem; padding: 3.5rem 4rem 3rem; border-radius: 6px;
	box-shadow: 0 1px 2px rgb(16 18 22 / 0.05), 0 8px 28px rgb(16 18 22 / 0.08); }
@media (max-width: 640px) { .rd { margin: 0; padding: 1.5rem 1rem 2.5rem; border-radius: 0; box-shadow: none; } }
@media print { body { background: #fff; container-type: normal; } .rd { margin: 0; padding: 0; max-width: none; box-shadow: none; } }`;

export function escapeHtml(text: string): string {
	return text.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);
}

/** A single self-contained HTML file around the report's markup. */
export function standaloneHtml(doc: ReportDocument, body: string, reportCss: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Fairtide">
<title>${escapeHtml(doc.title)}</title>
<style>
${reportCss}
${STANDALONE_CSS}
${pageCss(doc)}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
