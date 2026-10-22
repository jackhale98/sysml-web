/**
 * A diagram as a standalone SVG file: real `<rect>`, `<path>` and `<text>`
 * elements with every colour and font inline, drawn from the diagram's
 * graph and the geometry it has on screen (node boxes, edge routes, label
 * positions). No CSS, no `<foreignObject>`, no `<marker>` and no external
 * references, so it opens the same in browsers, Inkscape, Word and
 * PowerPoint. The drawing follows SysmlNode.svelte and SysmlEdge.svelte,
 * inside the SysML diagram frame (`iv [drone]`), without the editor's
 * chrome (handles, selection, highlights).
 */
import { escapeXml } from '#lib/dataio/xml.ts';
import type { DiagramNode } from '#lib/engine/types.ts';
import { METRICS } from '../layout.ts';
import { MAX_ROWS, notationOf, type Notation } from '../notation.ts';
import {
	familyColors,
	TOKENS,
	type ExportTheme,
	type FamilyColors,
	type Tokens
} from './palette.ts';

export interface XY {
	x: number;
	y: number;
}

/** One element of an icon, as Lucide describes it: `['path', { d: '…' }]`. */
export type IconShape = [tag: string, attrs: Record<string, string>];

export interface ExportNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	node: DiagramNode;
	/** The kind icon shown before the keyword (24-unit Lucide geometry). */
	icon?: IconShape[];
}

export interface ExportEdge {
	kind: string;
	/** The route as drawn, an SVG path in diagram coordinates. */
	path: string;
	/** Drawn from the model's target to its source: the start and end notation swap. */
	reversed?: boolean;
	/** The label text (keyword and name), or '' for none. */
	text: string;
	/** The label's centre; the middle of the route when absent. */
	labelAt?: XY | null;
}

export interface ExportDiagram {
	/** The frame's name, as SysML writes it: `iv [drone]`. */
	title: string;
	view: string;
	nodes: ExportNode[];
	edges: ExportEdge[];
}

export interface FontSpec {
	size: number;
	weight?: number;
	mono?: boolean;
	italic?: boolean;
}

/** The width of a text in a font, in px. */
export type Measure = (text: string, font: FontSpec) => number;

export interface SvgOptions {
	theme?: ExportTheme;
	/** Paint the background (white in the light theme); false leaves it transparent. */
	background?: boolean;
	measure?: Measure;
	/** `@font-face` rules to embed (for rasterising, where page fonts are not visible). */
	fontFaces?: string;
}

export interface BuiltSvg {
	svg: string;
	width: number;
	height: number;
}

export const UI_FONT =
	"'Inter Variable', Inter, 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const MONO_FONT =
	"'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Widths close to Inter's and JetBrains Mono's, for when there is no canvas to measure with. */
export const approximateMeasure: Measure = (text, font) =>
	text.length * font.size * (font.mono ? 0.6 : (font.weight ?? 400) >= 600 ? 0.6 : 0.56);

/** Space around the frame, inside it, and the name tag's height. */
const MARGIN = 16;
const PAD = 24;
const TAG = 24;

/** From the middle of a line of text to its baseline (Inter's ascent and descent). */
const baseline = (centre: number, size: number) => centre + size * 0.36;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildSvg(diagram: ExportDiagram, options: SvgOptions = {}): BuiltSvg {
	const theme = options.theme ?? 'light';
	const t = TOKENS[theme];
	const measure = options.measure ?? approximateMeasure;
	const draw = new Drawing(t, measure);

	const bounds = new Bounds();
	for (const n of diagram.nodes) {
		bounds.add(n.x, n.y);
		bounds.add(n.x + n.width, n.y + n.height);
	}
	const edges = diagram.edges.map((e) => ({ edge: e, geometry: parsePath(e.path) }));
	for (const { edge, geometry } of edges) {
		for (const p of geometry.points) bounds.add(p.x, p.y, 10);
		const at = edge.labelAt ?? geometry.middle;
		if (edge.text && at) {
			const w = draw.labelWidth(edge.text);
			bounds.add(at.x - w / 2, at.y - 9);
			bounds.add(at.x + w / 2, at.y + 9);
		}
	}

	const body: string[] = [];
	for (const { edge, geometry } of edges) body.push(draw.edge(edge, geometry));
	for (const { edge, geometry } of edges) {
		const at = edge.labelAt ?? geometry.middle;
		if (edge.text && at) body.push(draw.edgeLabel(edge.text, at));
	}
	for (const n of diagram.nodes) {
		const { markup, extra } = draw.node(n, diagram.view);
		body.push(markup);
		if (extra) bounds.add(extra.x, extra.y, 0, extra.x2, extra.y2);
	}

	const box = bounds.box() ?? { x: 0, y: 0, width: 0, height: 0 };
	const titleFont: FontSpec = { size: 12, mono: true };
	const tagWidth = Math.ceil(measure(diagram.title, titleFont)) + 30;
	const frameWidth = Math.ceil(Math.max(box.width + 2 * PAD, tagWidth + 40, 160));
	const frameHeight = Math.ceil(box.height + TAG + 12 + PAD);
	const width = frameWidth + 2 * MARGIN;
	const height = frameHeight + 2 * MARGIN;
	// Centre the drawing across the frame; below the name tag.
	const dx = MARGIN + (frameWidth - box.width) / 2 - box.x;
	const dy = MARGIN + TAG + 12 - box.y;

	const out: string[] = [];
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${UI_FONT}">`,
		`<title>${escapeXml(diagram.title)}</title>`
	);
	if (options.fontFaces) out.push(`<style>${options.fontFaces}</style>`);
	if (options.background !== false) {
		out.push(
			`<rect width="${width}" height="${height}" fill="${theme === 'light' ? t.surface : t.bg}"/>`
		);
	}
	out.push(draw.frame(diagram.title, MARGIN, MARGIN, frameWidth, frameHeight, tagWidth));
	out.push(`<g transform="translate(${r1(dx)} ${r1(dy)})">`, ...body, '</g>', '</svg>');
	return { svg: out.join('\n'), width, height };
}

/** A file name from a view's title: `Drone interconnection` → `drone-interconnection.svg`. */
export function exportFileName(title: string, extension: string): string {
	const base = title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '');
	return `${base || 'diagram'}.${extension}`;
}

/** The largest canvas every browser draws (iOS Safari: 16.7 megapixels, 16384 px a side). */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_000;

/** The scale a PNG of this size can have, at most `wanted`. */
export function pngScale(width: number, height: number, wanted = 2): number {
	return Math.min(
		wanted,
		Math.sqrt(MAX_PIXELS / Math.max(1, width * height)),
		MAX_SIDE / Math.max(1, width),
		MAX_SIDE / Math.max(1, height)
	);
}

// ---- Geometry ---------------------------------------------------------------

class Bounds {
	private x1 = Infinity;
	private y1 = Infinity;
	private x2 = -Infinity;
	private y2 = -Infinity;

	add(x: number, y: number, pad = 0, x2 = x, y2 = y) {
		if (![x, y, x2, y2].every(Number.isFinite)) return;
		this.x1 = Math.min(this.x1, x - pad);
		this.y1 = Math.min(this.y1, y - pad);
		this.x2 = Math.max(this.x2, x2 + pad);
		this.y2 = Math.max(this.y2, y2 + pad);
	}

	box() {
		if (this.x1 === Infinity) return null;
		return { x: this.x1, y: this.y1, width: this.x2 - this.x1, height: this.y2 - this.y1 };
	}
}

export interface PathGeometry {
	/** Every end and control point. */
	points: XY[];
	start: XY | null;
	/** Direction the route leaves its start, and arrives at its end (unit vectors). */
	startDir: XY | null;
	endDir: XY | null;
	end: XY | null;
	/** Halfway along the route (by its straight segments and control polygons). */
	middle: XY | null;
}

/** Ends, directions and extent of an SVG path (M, L, H, V, Q, C, Z; absolute or relative). */
export function parsePath(d: string): PathGeometry {
	const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
	const points: XY[] = [];
	/** Polyline through each segment's control points, for directions and length. */
	const segments: XY[][] = [];
	let cmd = '';
	let i = 0;
	let cur: XY = { x: 0, y: 0 };
	let open: XY = { x: 0, y: 0 };
	const num = () => Number(tokens[i++]);
	const at = (rel: boolean, x: number, y: number): XY =>
		rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
		const rel = cmd === cmd.toLowerCase();
		const c = cmd.toUpperCase();
		if (c === 'Z') {
			segments.push([cur, open]);
			cur = open;
			continue;
		}
		if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i]!)) {
			if (!cmd) i++;
			continue;
		}
		let seg: XY[];
		if (c === 'M') {
			cur = open = at(rel, num(), num());
			points.push(cur);
			cmd = rel ? 'l' : 'L';
			continue;
		} else if (c === 'L') seg = [cur, at(rel, num(), num())];
		else if (c === 'H') {
			const x = num();
			seg = [cur, { x: rel ? cur.x + x : x, y: cur.y }];
		} else if (c === 'V') {
			const y = num();
			seg = [cur, { x: cur.x, y: rel ? cur.y + y : y }];
		} else if (c === 'Q') seg = [cur, at(rel, num(), num()), at(rel, num(), num())];
		else if (c === 'C')
			seg = [cur, at(rel, num(), num()), at(rel, num(), num()), at(rel, num(), num())];
		else {
			i++;
			continue;
		}
		if (seg.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) break;
		segments.push(seg);
		points.push(...seg.slice(1));
		cur = seg[seg.length - 1]!;
	}
	const flat = segments.flat();
	const direction = (from: XY, to: XY) => {
		const len = Math.hypot(to.x - from.x, to.y - from.y);
		return len > 1e-6 ? { x: (to.x - from.x) / len, y: (to.y - from.y) / len } : null;
	};
	let startDir: XY | null = null;
	for (const p of flat.slice(1)) if ((startDir = direction(flat[0]!, p))) break;
	let endDir: XY | null = null;
	const last = flat[flat.length - 1];
	for (let k = flat.length - 2; k >= 0 && last; k--)
		if ((endDir = direction(flat[k]!, last))) break;
	return {
		points,
		start: points[0] ?? null,
		end: last ?? points[points.length - 1] ?? null,
		startDir,
		endDir,
		middle: middleOf(segments)
	};
}

function middleOf(segments: XY[][]): XY | null {
	const pieces = segments.flatMap((s) => s.slice(1).map((p, k) => [s[k]!, p] as const));
	const lengths = pieces.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
	let half = lengths.reduce((a, b) => a + b, 0) / 2;
	if (!pieces.length) return null;
	for (let k = 0; k < pieces.length; k++) {
		const [a, b] = pieces[k]!;
		const len = lengths[k]!;
		if (half <= len || k === pieces.length - 1) {
			const f = len ? Math.min(1, half / len) : 0;
			return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
		}
		half -= len;
	}
	return null;
}

// ---- Relationship notation (SysmlEdge.svelte) -----------------------------

type MarkerKind = 'specialization' | 'typing' | 'composition' | 'membership' | 'open' | 'arrow';

export function edgeStyle(kind: string): {
	start?: MarkerKind;
	end?: MarkerKind;
	dashed?: boolean;
} {
	switch (kind) {
		case 'specialization':
			return { end: 'specialization' };
		case 'composition':
			return { start: 'composition' };
		case 'containment':
			return { start: 'membership' };
		case 'satisfy':
		case 'verify':
		case 'allocate':
		case 'dependency':
			return { end: 'open', dashed: true };
		case 'flow':
		case 'transition':
		case 'message':
			return { end: 'arrow' };
		case 'typing':
			return { end: 'typing' };
		default:
			return {};
	}
}

/**
 * Each marker as DiagramCanvas defines it: its drawing in its own viewBox
 * units, the point placed on the route's end (`ref`), and its scale (marker
 * size over viewBox size, times the edge's 1.5 stroke width).
 */
function markerShape(kind: MarkerKind, ink: string, paper: string) {
	switch (kind) {
		case 'specialization':
			return {
				ref: [11, 6],
				scale: (14 / 12) * 1.5,
				body: `<path d="M1 1 L11 6 L1 11 Z" fill="${paper}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="miter"/>`
			};
		case 'typing':
			return {
				ref: [19, 6],
				scale: (22 / 20) * 1.5,
				body:
					`<rect x="0" y="3.5" width="9" height="5" fill="${paper}"/>` +
					`<circle cx="2" cy="6" r="1.4" fill="${ink}"/><circle cx="6" cy="6" r="1.4" fill="${ink}"/>` +
					`<path d="M9 1 L19 6 L9 11 Z" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>`
			};
		case 'composition':
			return {
				ref: [15, 5],
				scale: 1.5,
				body: `<path d="M1 5 L8 1 L15 5 L8 9 Z" fill="${ink}"/>`
			};
		case 'membership':
			return {
				ref: [12.6, 7],
				scale: 1.5,
				body:
					`<circle cx="7" cy="7" r="5.6" fill="${paper}" stroke="${ink}" stroke-width="1.2"/>` +
					`<path d="M7 3.6 V10.4 M3.6 7 H10.4" stroke="${ink}" stroke-width="1.2" fill="none"/>`
			};
		case 'open':
			return {
				ref: [11, 6],
				scale: 1.5,
				body: `<path d="M1 1 L11 6 L1 11" fill="none" stroke="${ink}" stroke-width="1.3"/>`
			};
		case 'arrow':
			return {
				ref: [11, 6],
				scale: (11 / 12) * 1.5,
				body: `<path d="M1 1 L11 6 L1 11 Z" fill="${ink}"/>`
			};
	}
}

// ---- Drawing ----------------------------------------------------------------

/** A text element; `anchor` start, middle or end. */
function text(
	x: number,
	y: number,
	content: string,
	font: FontSpec,
	fill: string,
	anchor: 'start' | 'middle' | 'end' = 'start'
): string {
	const attrs = [
		`x="${r1(x)}"`,
		`y="${r1(baseline(y, font.size))}"`,
		`font-size="${font.size}"`,
		font.weight && font.weight !== 400 ? `font-weight="${font.weight}"` : '',
		font.italic ? 'font-style="italic"' : '',
		font.mono ? `font-family="${MONO_FONT}"` : '',
		anchor !== 'start' ? `text-anchor="${anchor}"` : '',
		`fill="${fill}"`
	].filter(Boolean);
	return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

const ICON_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
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

/** Fonts of a node (SysmlNode.svelte). */
const F = {
	keyword: { size: 11 },
	// 600, not the canvas's 650: SVG 1.1 consumers (Inkscape, Office) take only whole hundreds.
	name: { size: 13, weight: 600 },
	title: { size: 11, italic: true },
	row: { size: 11.5, mono: true },
	more: { size: 11 },
	doc: { size: 11.5 },
	port: { size: 11, mono: true },
	label: { size: 11 }
} satisfies Record<string, FontSpec>;

class Drawing {
	constructor(
		private t: Tokens,
		private measure: Measure
	) {}

	labelWidth(content: string) {
		return Math.ceil(this.measure(content, F.label)) + 16;
	}

	/** The text, cut with an ellipsis to fit `max` px. */
	fit(content: string, font: FontSpec, max: number): string {
		if (this.measure(content, font) <= max) return content;
		const chars = [...content];
		let lo = 0;
		let hi = chars.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (this.measure(chars.slice(0, mid).join('') + '…', font) <= max) lo = mid;
			else hi = mid - 1;
		}
		return chars.slice(0, lo).join('').trimEnd() + '…';
	}

	/** Words into at most `lines` lines of `max` px; the last cut with an ellipsis. */
	wrap(content: string, font: FontSpec, max: number, lines: number): string[] {
		const words = content.split(/\s+/).filter(Boolean);
		const out: string[] = [];
		let line = '';
		for (let k = 0; k < words.length; k++) {
			const next = line ? `${line} ${words[k]}` : words[k]!;
			if (!line || this.measure(next, font) <= max) {
				line = next;
				continue;
			}
			if (out.length === lines - 1) {
				out.push(this.fit([line, ...words.slice(k)].join(' '), font, max));
				return out;
			}
			out.push(line);
			line = words[k]!;
		}
		if (line) out.push(line);
		return out.map((l) => this.fit(l, font, max));
	}

	frame(title: string, x: number, y: number, w: number, h: number, tagWidth: number) {
		const t = this.t;
		const tw = Math.min(tagWidth, w - 8);
		return [
			`<g>`,
			`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="none" stroke="${t.text3}" stroke-width="1"/>`,
			`<path d="M${x + 0.5} ${y + TAG} H${x + tw} L${x + tw + 8} ${y + TAG - 8} V${y + 0.5}" fill="${t.surface}" stroke="${t.text3}" stroke-width="1"/>`,
			text(
				x + 10,
				y + TAG / 2 + 0.5,
				this.fit(title, { size: 12, mono: true }, tw - 16),
				{ size: 12, mono: true },
				t.text2
			),
			`</g>`
		].join('');
	}

	edge(edge: ExportEdge, g: PathGeometry): string {
		if (!g.start || !g.end) return '';
		const t = this.t;
		const style = edgeStyle(edge.kind);
		const [startKind, endKind] = edge.reversed
			? [style.end, style.start]
			: [style.start, style.end];
		const parts = [
			`<path d="${escapeXml(edge.path)}" fill="none" stroke="${t.text2}" stroke-opacity="0.85" stroke-width="1.5"${style.dashed ? ' stroke-dasharray="5 4"' : ''}/>`
		];
		if (startKind && g.startDir) {
			// `auto-start-reverse`: at the start the marker points away from the route.
			parts.push(this.marker(startKind, g.start, { x: -g.startDir.x, y: -g.startDir.y }));
		}
		if (endKind && g.endDir) parts.push(this.marker(endKind, g.end, g.endDir));
		return `<g>${parts.join('')}</g>`;
	}

	private marker(kind: MarkerKind, at: XY, dir: XY): string {
		const m = markerShape(kind, this.t.text2, this.t.surface);
		const angle = r1((Math.atan2(dir.y, dir.x) * 180) / Math.PI);
		return `<g transform="translate(${r1(at.x)} ${r1(at.y)}) rotate(${angle}) scale(${Math.round(m.scale * 1000) / 1000}) translate(${-m.ref[0]!} ${-m.ref[1]!})">${m.body}</g>`;
	}

	edgeLabel(content: string, at: XY): string {
		const t = this.t;
		const w = this.labelWidth(content);
		return (
			`<g><rect x="${r1(at.x - w / 2 + 0.5)}" y="${r1(at.y - 8.5)}" width="${w - 1}" height="17" rx="8.5" fill="${t.surface}" stroke="${t.border}" stroke-width="1"/>` +
			text(at.x, at.y, content, F.label, t.text2, 'middle') +
			'</g>'
		);
	}

	node(
		n: ExportNode,
		view: string
	): { markup: string; extra?: { x: number; y: number; x2: number; y2: number } } {
		const notation = notationOf(n.node, view);
		const colors = familyColors(this.t, notation.family);
		const open = `<g transform="translate(${r1(n.x)} ${r1(n.y)})">`;
		const { width: w, height: h } = n;
		const t = this.t;
		switch (notation.shape) {
			case 'port': {
				const label = n.node.label;
				const lw = this.measure(label, F.port);
				return {
					markup:
						open +
						`<rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" fill="${t.surface}" stroke="${colors.line}" stroke-width="1.5"/>` +
						text(w / 2, h + 3 + 7, label, F.port, t.text2, 'middle') +
						'</g>',
					extra: { x: n.x + w / 2 - lw / 2, y: n.y, x2: n.x + w / 2 + lw / 2, y2: n.y + h + 18 }
				};
			}
			case 'initial':
				return {
					markup: open + `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${t.text}"/></g>`
				};
			case 'final':
				return {
					markup:
						open +
						`<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 1}" fill="${t.surface}" stroke="${t.text}" stroke-width="2"/>` +
						`<circle cx="${w / 2}" cy="${h / 2}" r="${r1((w / 2 - 2) * 0.64)}" fill="${t.text}"/></g>`
				};
			case 'decision': {
				const i = 1.06;
				return {
					markup:
						open +
						`<path d="M${w / 2} ${i} L${w - i} ${h / 2} L${w / 2} ${h - i} L${i} ${h / 2} Z" fill="${t.surface}" stroke="${colors.line}" stroke-width="1.5"/></g>`
				};
			}
			case 'bar':
				return {
					markup: open + `<rect width="${w}" height="${h}" rx="1" fill="${t.text}"/></g>`
				};
			default:
				return { markup: open + this.box(n, notation, colors) + '</g>' };
		}
	}

	/** A definition or usage box, with its compartments and border ports. */
	private box(n: ExportNode, notation: Notation, colors: FamilyColors): string {
		const t = this.t;
		const m = METRICS;
		const pkg = notation.shape === 'package';
		const w = n.width;
		const top = pkg ? m.tab : 0;
		const h = n.height - top;
		const radius = notation.isDefinition || pkg ? 2 : 14;
		const B = 1.5;
		const out: string[] = [];

		if (pkg) {
			const tabW = Math.min(w * 0.45, 88);
			out.push(
				`<path d="M0.75 ${top + 1} V2.75 Q0.75 1.75 2.75 1.75 H${r1(tabW - 2.75)} Q${r1(tabW - 0.75)} 1.75 ${r1(tabW - 0.75)} 2.75 V${top + 1}" fill="${colors.tab}" stroke="${colors.line}" stroke-width="1.5"/>`
			);
		}
		// Natural heights of the compartments, shrunk together when they overflow the box (flex).
		const sections: { kind: 'doc' | 'rows' | 'ports'; height: number; index?: number }[] = [];
		const portRows = this.portRows(notation, w);
		let docLines: string[] = [];
		if (notation.doc) {
			docLines = this.wrap(notation.doc, F.doc, w - 2 * B - 24, m.docLines);
			sections.push({ kind: 'doc', height: 1 + 12 + docLines.length * m.docLine });
		}
		notation.compartments.forEach((c, index) => {
			const shown = Math.min(c.rows.length, MAX_ROWS) + (c.rows.length > MAX_ROWS ? 1 : 0);
			sections.push({ kind: 'rows', height: 1 + 12 + 16 + shown * m.row, index });
		});
		if (portRows.length) sections.push({ kind: 'ports', height: 1 + 12 + portRows.length * m.row });
		const inner = h - 2 * B;
		const headH = sections.length ? m.header : inner;
		const natural = sections.reduce((a, s) => a + s.height, 0);
		const overflow = headH + natural - inner;
		const shrink = overflow > 0 && natural > 0 ? overflow / natural : 0;

		// Box and header fill.
		const ri = Math.max(0, radius - B);
		const tl = pkg ? 0 : ri;
		const x0 = B;
		const y0 = top + B;
		const x1 = w - B;
		const yh = y0 + headH;
		const bottomR = sections.length ? 0 : ri;
		out.push(
			`<rect x="0.75" y="${top + 0.75}" width="${r1(w - 1.5)}" height="${r1(h - 1.5)}" rx="${pkg ? 0 : radius - 0.75}" fill="${t.surface}" stroke="none"/>`,
			`<path d="${roundedRect(x0, y0, x1, yh, tl, ri, bottomR, bottomR)}" fill="${colors.tint}"/>`
		);

		// Header: «keyword» with the kind's icon, and the name.
		const headTop = y0 + (headH - 33) / 2;
		const keyword = `«${notation.isAbstract ? 'abstract ' : ''}${notation.keyword}»`;
		const kwText = this.fit(keyword, F.keyword, w - 2 * B - 24 - 16);
		const kwWidth = this.measure(kwText, F.keyword);
		const icon = n.icon?.length ? n.icon : null;
		const groupW = (icon ? 16 : 0) + kwWidth;
		const gx = w / 2 - groupW / 2;
		const kwY = headTop + 7;
		if (icon) {
			const shapes = icon
				.filter(([tag]) => ICON_TAGS.has(tag))
				.map(([tag, attrs]) => {
					const a = Object.entries(attrs)
						.filter(([k]) => ICON_ATTRS.has(k))
						.map(([k, v]) => `${k}="${escapeXml(v)}"`)
						.join(' ');
					return `<${tag} ${a}/>`;
				})
				.join('');
			out.push(
				`<g transform="translate(${r1(gx)} ${r1(kwY - 6)}) scale(0.5)" fill="none" stroke="${colors.ink}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`
			);
		}
		out.push(text(gx + (icon ? 16 : 0), kwY, kwText, F.keyword, t.text2));
		const nameFont = { ...F.name, italic: notation.isAbstract };
		out.push(
			text(
				w / 2,
				headTop + 14 + 2 + 8.5,
				this.fit(n.node.label, nameFont, w - 2 * B - 24),
				nameFont,
				t.text,
				'middle'
			)
		);

		// Compartments, each under a rule.
		let y = yh;
		const rule = (at: number) =>
			`<path d="M${x0} ${r1(at + 0.5)} H${x1}" stroke="${colors.line}" stroke-width="1"/>`;
		const maxRow = w - 2 * B - 24;
		for (const s of sections) {
			const height = s.height * (1 - shrink);
			out.push(rule(y));
			const cTop = y + 1 + 6;
			if (s.kind === 'doc') {
				docLines.forEach((line, k) =>
					out.push(text(x0 + 12, cTop + k * m.docLine + m.docLine / 2, line, F.doc, t.text2))
				);
			} else if (s.kind === 'rows') {
				const c = notation.compartments[s.index!]!;
				out.push(text(w / 2, cTop + 8, c.title, F.title, t.text3, 'middle'));
				const rows = c.rows.slice(0, MAX_ROWS);
				rows.forEach((row, k) =>
					out.push(
						text(
							x0 + 12,
							cTop + 16 + k * m.row + m.row / 2,
							this.fit(row, F.row, maxRow),
							F.row,
							t.text2
						)
					)
				);
				if (c.rows.length > MAX_ROWS) {
					out.push(
						text(
							x0 + 12,
							cTop + 16 + rows.length * m.row + m.row / 2,
							`+${c.rows.length - MAX_ROWS} more`,
							F.more,
							t.text3
						)
					);
				}
			} else {
				portRows.forEach((row, k) => {
					const cy = cTop + k * m.row + m.row / 2;
					if (row.left) {
						out.push(this.portSquare(x0 - 6.5, cy, colors));
						out.push(text(x0 + 12, cy, row.left, F.row, t.text2));
					}
					if (row.right) {
						out.push(this.portSquare(x1 + 6.5 - 10, cy, colors));
						out.push(text(x1 - 12, cy, row.right, F.row, t.text2, 'end'));
					}
				});
			}
			y += height;
		}
		// The border last, over the fills.
		out.push(
			`<rect x="0.75" y="${top + 0.75}" width="${r1(w - 1.5)}" height="${r1(h - 1.5)}" rx="${pkg ? 0 : radius - 0.75}" fill="none" stroke="${colors.line}" stroke-width="1.5"/>`
		);
		return out.join('');
	}

	private portSquare(x: number, cy: number, colors: FamilyColors) {
		return `<rect x="${r1(x + 0.75)}" y="${r1(cy - 5 + 0.75)}" width="8.5" height="8.5" fill="${this.t.surface}" stroke="${colors.line}" stroke-width="1.5"/>`;
	}

	/**
	 * Border ports, row by row: the left list and the right list side by
	 * side when both fit across the box, else the right list below (as the
	 * node's wrapping flex row lays them out).
	 */
	private portRows(n: Notation, w: number): { left?: string; right?: string }[] {
		if (!n.ports.length) return [];
		const left = n.ports.filter((p) => p.side === 'left').map((p) => p.label);
		const right = n.ports.filter((p) => p.side === 'right').map((p) => p.label);
		const widthOf = (list: string[]) =>
			list.length ? Math.max(...list.map((l) => this.measure(l, F.row))) + 12 : 0;
		const room = w - 3;
		const together = widthOf(left) + 8 + widthOf(right) <= room;
		const fitAll = (list: string[]) => list.map((l) => this.fit(l, F.row, room - 12));
		const [l, r] = [fitAll(left), fitAll(right)];
		if (together) {
			return Array.from({ length: Math.max(l.length, r.length) }, (_, k) => ({
				left: l[k],
				right: r[k]
			}));
		}
		return [...l.map((left) => ({ left })), ...r.map((right) => ({ right }))];
	}
}

/** A rectangle path with its own radius per corner (top-left, top-right, bottom-right, bottom-left). */
function roundedRect(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	tl: number,
	tr: number,
	br: number,
	bl: number
): string {
	const n = (v: number) => r1(v);
	return [
		`M${n(x0)} ${n(y0 + tl)}`,
		tl ? `A${n(tl)} ${n(tl)} 0 0 1 ${n(x0 + tl)} ${n(y0)}` : '',
		`H${n(x1 - tr)}`,
		tr ? `A${n(tr)} ${n(tr)} 0 0 1 ${n(x1)} ${n(y0 + tr)}` : '',
		`V${n(y1 - br)}`,
		br ? `A${n(br)} ${n(br)} 0 0 1 ${n(x1 - br)} ${n(y1)}` : '',
		`H${n(x0 + bl)}`,
		bl ? `A${n(bl)} ${n(bl)} 0 0 1 ${n(x0)} ${n(y1 - bl)}` : '',
		'Z'
	]
		.filter(Boolean)
		.join(' ');
}
