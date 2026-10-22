/**
 * A sequence diagram as a standalone SVG file, drawn from the geometry the
 * canvas shows (`sequenceLayout.ts`): the SysML frame, lifeline heads as
 * rounded usage boxes tinted by kind, dashed lifelines, and the numbered
 * messages with open arrowheads. Like `svg.ts`, every colour and font is
 * inline (no CSS, `<marker>` or `<foreignObject>`), in the light theme
 * unless asked, and without the canvas's selection and highlights.
 */
import { escapeXml } from '#lib/dataio/xml.ts';
import { SEQUENCE, labelParts, type SequenceLayout } from '../sequenceLayout.ts';
import { familyColors, mixOklab, TOKENS, type ExportTheme } from './palette.ts';
import {
	approximateMeasure,
	MONO_FONT,
	UI_FONT,
	type BuiltSvg,
	type FontSpec,
	type IconShape,
	type SvgOptions
} from './svg.ts';

/** `--syntax-keyword` in each theme (global.css): the `of` before a payload. */
const KEYWORD: Record<ExportTheme, string> = { light: '#8a2c8f', dark: '#d79bf0' };

const F = {
	keyword: { size: 11 },
	// Whole hundreds: SVG 1.1 consumers (Inkscape, Office) take no other weights.
	head: { size: 13, weight: 600 },
	type: { size: 13 },
	number: { size: 10.5, weight: 600 },
	name: { size: 12.5, weight: 600 },
	payload: { size: 11.5, mono: true },
	of: { size: 11.5, mono: true, italic: true },
	title: { size: 12, mono: true }
} satisfies Record<string, FontSpec>;

const r1 = (n: number) => Math.round(n * 10) / 10;

function text(
	x: number,
	y: number,
	content: string,
	font: FontSpec,
	fill: string,
	anchor: 'start' | 'middle' = 'start'
): string {
	const attrs = [
		`x="${r1(x)}"`,
		`y="${r1(y + font.size * 0.36)}"`,
		`font-size="${font.size}"`,
		font.weight && font.weight !== 400 ? `font-weight="${font.weight}"` : '',
		font.italic ? 'font-style="italic"' : '',
		font.mono ? `font-family="${MONO_FONT}"` : '',
		anchor !== 'start' ? `text-anchor="${anchor}"` : '',
		`fill="${fill}"`
	];
	return `<text ${attrs.filter(Boolean).join(' ')}>${escapeXml(content)}</text>`;
}

const ICON_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
/** Only geometry is kept from an icon's shapes (no classes or styles). */
const ICON_ATTRS = new Set([
	'd',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'width',
	'height',
	'points'
]);

export interface SequenceSvgOptions extends SvgOptions {
	/** Each lifeline's kind icon (24-unit Lucide shapes), by lifeline index. */
	icons?: (IconShape[] | undefined)[];
}

export function sequenceSvg(layout: SequenceLayout, options: SequenceSvgOptions = {}): BuiltSvg {
	const theme = options.theme ?? 'light';
	const t = TOKENS[theme];
	const measure = options.measure ?? approximateMeasure;
	const { width, height } = layout;
	const ink = mixOklab(t.text2, theme === 'light' ? t.surface : t.bg, 0.85);
	const out: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${UI_FONT}">`,
		`<title>${escapeXml(layout.tag.text)}</title>`
	];
	if (options.fontFaces) out.push(`<style>${options.fontFaces}</style>`);
	if (options.background !== false)
		out.push(
			`<rect width="${width}" height="${height}" fill="${theme === 'light' ? t.surface : t.bg}"/>`
		);

	// The frame and its name.
	const f = layout.frame;
	out.push(
		`<rect x="${f.x + 0.5}" y="${f.y + 0.5}" width="${f.width - 1}" height="${f.height - 1}" fill="none" stroke="${t.text3}" stroke-width="1"/>`,
		`<path d="${layout.tag.path}" fill="${t.surface}" stroke="${t.text3}" stroke-width="1"/>`,
		text(f.x + 10, f.y + SEQUENCE.tagHeight / 2 + 0.5, layout.tag.text, F.title, t.text2)
	);

	// Lifelines.
	for (const l of layout.lifelines) {
		const colors = familyColors(t, l.family);
		out.push(
			`<path d="M${l.x} ${layout.lineTop} V${layout.lineBottom}" stroke="${mixOklab(colors.ink, t.text3, 0.3)}" stroke-width="1.5" stroke-dasharray="6 5"/>`
		);
	}

	// Messages: the arrow, an open arrowhead, the events and the label.
	for (const m of layout.messages) {
		out.push(`<path d="${m.path}" fill="none" stroke="${ink}" stroke-width="1.5"/>`);
		const endX = m.self ? m.x1 + 1 : m.x2 - Math.sign(m.x2 - m.x1);
		const endY = m.self ? m.y + SEQUENCE.selfHeight : m.y;
		const dir = m.self ? -1 : Math.sign(m.x2 - m.x1);
		out.push(
			`<path d="M${r1(endX - dir * 10)} ${endY - 4.5} L${endX} ${endY} L${r1(endX - dir * 10)} ${endY + 4.5}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
		);
		if (m.edge.message?.sourceEvent)
			out.push(
				`<circle cx="${m.x1}" cy="${m.y}" r="3.5" fill="${t.surface}" stroke="${ink}" stroke-width="1.5"/>`
			);
		if (m.edge.message?.targetEvent)
			out.push(
				`<circle cx="${m.x2}" cy="${endY}" r="3.5" fill="${t.surface}" stroke="${ink}" stroke-width="1.5"/>`
			);

		const { number, name, payload } = labelParts(m.index, m.edge);
		const parts: { text: string; font: FontSpec; fill: string; gap: number }[] = [];
		if (name) parts.push({ text: name, font: F.name, fill: t.text, gap: 0 });
		if (payload) {
			parts.push({ text: 'of', font: F.of, fill: KEYWORD[theme], gap: name ? 5 : 0 });
			parts.push({ text: payload, font: F.payload, fill: t.text2, gap: 7 });
		}
		const chip = Math.max(15, measure(number, F.number) + 6);
		const content = chip + 7 + parts.reduce((sum, p) => sum + p.gap + measure(p.text, p.font), 0);
		const cy = m.label.y + m.label.height / 2;
		let x = m.self ? m.label.x + 10 : m.label.x + (m.label.width - content) / 2;
		out.push(
			`<rect x="${r1(x)}" y="${r1(cy - 7.5)}" width="${r1(chip)}" height="15" rx="7.5" fill="${mixOklab(t.text3, t.surface, 0.14)}"/>`,
			text(x + chip / 2, cy, number, F.number, t.text2, 'middle')
		);
		x += chip + 7;
		for (const p of parts) {
			x += p.gap;
			out.push(text(x, cy, p.text, p.font, p.fill));
			x += measure(p.text, p.font);
		}
	}

	// Lifeline heads, over the lines.
	for (const l of layout.lifelines) {
		const colors = familyColors(t, l.family);
		const { x, y, width: w, height: h } = l.head;
		out.push(
			`<rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${h - 1.5}" rx="13.25" fill="${colors.tint}" stroke="${colors.line}" stroke-width="1.5"/>`
		);
		const keyword = `«${l.keyword}»`;
		const icon = options.icons?.[l.index];
		const kwWidth = measure(keyword, F.keyword);
		const groupW = (icon ? 16 : 0) + kwWidth;
		const gx = x + w / 2 - groupW / 2;
		const kwY = y + h / 2 - 9;
		if (icon) {
			const shapes = icon
				.filter(([tag]) => ICON_TAGS.has(tag))
				.map(
					([tag, attrs]) =>
						`<${tag} ${Object.entries(attrs)
							.filter(([k]) => ICON_ATTRS.has(k))
							.map(([k, v]) => `${k}="${escapeXml(v)}"`)
							.join(' ')}/>`
				)
				.join('');
			out.push(
				`<g transform="translate(${r1(gx)} ${r1(kwY - 6)}) scale(0.5)" fill="none" stroke="${colors.ink}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`
			);
		}
		out.push(text(gx + (icon ? 16 : 0), kwY, keyword, F.keyword, t.text2));
		const nameY = y + h / 2 + 8;
		// `name : Type`; SVG collapses a leading space, so the gap is measured.
		const type = l.type ? `: ${l.type}` : '';
		const gap = type ? measure(' ', F.type) : 0;
		const total = measure(l.name, F.head) + gap + measure(type, F.type);
		const nx = x + w / 2 - total / 2;
		out.push(text(nx, nameY, l.name, F.head, t.text));
		if (type) out.push(text(nx + measure(l.name, F.head) + gap, nameY, type, F.type, t.text2));
	}

	out.push('</svg>');
	return { svg: out.join('\n'), width, height };
}
