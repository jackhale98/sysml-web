import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiagramNode } from '#lib/engine/types.ts';
import { nodeSize } from '../layout.ts';
import { familyColors, mixOklab, TOKENS } from './palette.ts';
import {
	buildSvg,
	edgeStyle,
	exportFileName,
	parsePath,
	pngScale,
	type ExportDiagram,
	type ExportNode
} from './svg.ts';

const graphNode = (over: Partial<DiagramNode>): DiagramNode => ({
	id: 'X',
	label: 'X',
	kind: 'block',
	stereotype: null,
	attributes: [],
	is_definition: false,
	...over
});

function placed(node: DiagramNode, x: number, y: number, view = 'general'): ExportNode {
	return { id: node.id, x, y, ...nodeSize(node, view), node };
}

const battery = graphNode({
	id: 'battery',
	label: 'battery : Battery',
	stereotype: '<<part>>',
	attributes: [
		['out port', 'powerOut : PowerPort'],
		['attribute', 'mass = 1100 [g]']
	]
});
const board = graphNode({
	id: 'board',
	label: 'board : PowerDistributionBoard',
	stereotype: '<<part>>',
	attributes: [['in port', 'powerIn : ~PowerPort']]
});

const interconnection: ExportDiagram = {
	title: 'iv [drone]',
	view: 'interconnection',
	nodes: [placed(battery, 0, 0, 'interconnection'), placed(board, 400, 0, 'interconnection')],
	edges: [{ kind: 'flow', path: 'M 200 60 L 400 60', text: 'batteryPower' }]
};

const count = (svg: string, pattern: RegExp) => svg.match(pattern)?.length ?? 0;

describe('buildSvg', () => {
	it('draws every node, its compartments, ports and the edge as plain SVG', () => {
		const { svg, width, height } = buildSvg(interconnection);
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
		for (const text of [
			'battery : Battery',
			'board : PowerDistributionBoard',
			'«part»',
			'out powerOut : PowerPort',
			'in powerIn : ~PowerPort',
			'mass = 1100 [g]',
			'attributes',
			'batteryPower'
		]) {
			expect(svg).toContain(`>${text}</text>`);
		}
		// Nothing a document consumer would trip on.
		expect(svg).not.toMatch(/foreignObject|<marker|url\(|var\(--|class=|<image|href=/);
	});

	it('fits the whole drawing inside the SysML frame, named as in the standard', () => {
		const { svg, width, height } = buildSvg(interconnection);
		expect(svg).toContain('<title>iv [drone]</title>');
		expect(svg).toMatch(/<text [^>]*>iv \[drone\]<\/text>/);
		// Two nodes side by side (the second ends at x = 400 + its width) plus the frame's margins.
		const right = 400 + nodeSize(board, 'interconnection').width;
		expect(width).toBeGreaterThanOrEqual(right + 2 * 24);
		expect(height).toBeGreaterThan(nodeSize(battery, 'interconnection').height + 24);
		// The frame: an outline and the name tag with its cut corner.
		expect(svg).toMatch(/<rect x="16.5" y="16.5" width="\d+" height="\d+" fill="none"/);
	});

	it('draws the SysML notation of each relationship at the right end', () => {
		const general: ExportDiagram = {
			title: 'gv [Parts]',
			view: 'general',
			nodes: [],
			edges: [
				{ kind: 'specialization', path: 'M 0 0 L 0 100', text: '' },
				{ kind: 'composition', path: 'M 100 0 L 100 100', text: '' },
				{ kind: 'satisfy', path: 'M 200 0 L 200 100', text: '«satisfy»' },
				{ kind: 'connection', path: 'M 300 0 L 300 100', text: '' }
			]
		};
		const { svg } = buildSvg(general);
		// Hollow triangle pointing down the route at its end (100); filled diamond at the start.
		expect(svg).toContain('translate(0 100) rotate(90)');
		expect(svg).toContain('translate(100 0) rotate(-90)');
		expect(svg).toContain('d="M1 5 L8 1 L15 5 L8 9 Z"');
		expect(svg).toContain('d="M1 1 L11 6 L1 11 Z" fill="#ffffff"');
		// Dashed with an open arrow; plain connections have neither.
		expect(count(svg, /stroke-dasharray="5 4"/g)).toBe(1);
		expect(svg).toContain('d="M1 1 L11 6 L1 11" fill="none"');
		expect(count(svg, /rotate\(/g)).toBe(3);
		expect(svg).toContain('>«satisfy»</text>');
	});

	it('swaps the ends of an edge drawn from the general end', () => {
		const { svg } = buildSvg({
			title: 'gv [T]',
			view: 'general',
			nodes: [],
			edges: [{ kind: 'specialization', path: 'M 0 0 L 0 100', reversed: true, text: '' }]
		});
		// The triangle sits at the route's start, pointing back up to it.
		expect(svg).toContain('translate(0 0) rotate(-90)');
	});

	it('escapes names and drops characters XML cannot hold', () => {
		const odd = graphNode({ id: 'a', label: '\'<b> & "c"\'\u0001', stereotype: '<<part def>>' });
		const { svg } = buildSvg({
			title: 'gv [<x> & "y"]',
			view: 'general',
			nodes: [placed(odd, 0, 0)],
			edges: [{ kind: 'flow', path: 'M 0 0 L 50 0', text: 'a < b && c' }]
		});
		expect(svg).toContain('&lt;b&gt; &amp; &quot;c&quot;');
		expect(svg).toContain('gv [&lt;x&gt; &amp; &quot;y&quot;]');
		expect(svg).toContain('a &lt; b &amp;&amp; c');
		expect(svg).not.toContain('\u0001');
		expect(svg).not.toMatch(/<b>|&(?!amp;|lt;|gt;|quot;)/);
	});

	it('cuts long text to its box with an ellipsis, as the canvas does', () => {
		const long = graphNode({
			id: 'p',
			label: 'p : P',
			stereotype: '<<part def>>',
			is_definition: true,
			attributes: [['attribute', `note = "${'x'.repeat(200)}"`]]
		});
		const { svg } = buildSvg({
			title: 'gv [P]',
			view: 'general',
			nodes: [placed(long, 0, 0)],
			edges: []
		});
		expect(svg).toMatch(/>note = &quot;x+…<\/text>/);
	});

	it('draws definitions square-cornered and usages rounded, in the kind colour', () => {
		const def = graphNode({
			id: 'D',
			label: 'Battery',
			stereotype: '<<part def>>',
			is_definition: true
		});
		const use = graphNode({ id: 'u', label: 'u : Battery', stereotype: '<<part>>' });
		const req = graphNode({
			id: 'r',
			label: 'R1',
			kind: 'requirement',
			stereotype: '<<requirement>>'
		});
		const { svg } = buildSvg({
			title: 'gv [K]',
			view: 'general',
			nodes: [placed(def, 0, 0), placed(use, 300, 0), placed(req, 600, 0)],
			edges: []
		});
		const structure = familyColors(TOKENS.light, 'structure');
		const requirement = familyColors(TOKENS.light, 'requirement');
		expect(svg).toContain(`rx="1.25" fill="none" stroke="${structure.line}"`);
		expect(svg).toContain(`rx="13.25" fill="none" stroke="${structure.line}"`);
		expect(svg).toContain(`fill="${structure.tint}"`);
		expect(svg).toContain(`stroke="${requirement.line}"`);
	});

	it('draws the kind icon from its shapes, keeping only geometry', () => {
		const node = placed(graphNode({ id: 'a', label: 'a', stereotype: '<<part>>' }), 0, 0);
		node.icon = [
			['path', { d: 'M1 1 L2 2', onclick: 'alert(1)' }],
			['script', { src: 'x' }],
			['circle', { cx: '12', cy: '12', r: '3' }]
		];
		const { svg } = buildSvg({ title: 'gv [A]', view: 'general', nodes: [node], edges: [] });
		expect(svg).toContain('<path d="M1 1 L2 2"/>');
		expect(svg).toContain('<circle cx="12" cy="12" r="3"/>');
		expect(svg).not.toMatch(/script|onclick/);
	});

	it('draws pseudo states, decisions and fork bars', () => {
		const { svg } = buildSvg({
			title: 'stv [M]',
			view: 'states',
			nodes: [
				placed(graphNode({ id: 'i', label: '', kind: 'initial_state' }), 0, 0),
				placed(graphNode({ id: 'f', label: '', kind: 'final_state' }), 100, 0),
				placed(graphNode({ id: 'd', label: 'd', kind: 'decision' }), 200, 0),
				placed(graphNode({ id: 'j', label: 'j', kind: 'fork' }), 300, 0)
			],
			edges: []
		});
		expect(count(svg, /<circle /g)).toBe(3);
		expect(svg).toMatch(/<path d="M17 1.06 L32.94 17/);
		expect(svg).toContain('<rect width="72" height="8" rx="1"');
	});

	it('draws a use case diagram: ellipses, stick figures, the boundary and «include»', () => {
		const deliver = graphNode({
			id: 'DeliverParcel',
			label: 'DeliverParcel',
			kind: 'use_case',
			stereotype: '<<use case def>>',
			is_definition: true,
			attributes: [['objective', 'Parcel delivered.']]
		});
		const verify = graphNode({
			id: 'VerifyDropZone',
			label: 'VerifyDropZone',
			kind: 'use_case',
			stereotype: '<<use case def>>',
			is_definition: true
		});
		const operator = graphNode({ id: 'Operator', label: 'Operator', kind: 'actor' });
		const { svg } = buildSvg({
			title: 'uc [deliveryUseCases]',
			view: 'usecases',
			boundaries: [{ id: 's', label: 'DeliveryDrone', x: 172, y: -58, width: 600, height: 200 }],
			nodes: [
				placed(operator, 0, 0, 'usecases'),
				placed(deliver, 200, 0, 'usecases'),
				placed(verify, 520, 0, 'usecases')
			],
			edges: [
				{ kind: 'actor', path: 'M 59 30 L 200 50', text: '' },
				{ kind: 'include', path: 'M 430 50 L 520 36', text: '«include»' }
			]
		});
		expect(count(svg, /<ellipse /g)).toBe(2);
		// The figure's head and body, its name below.
		expect(svg).toContain('<path d="M15 16.5 V37 M3 25 H27 M15 37 L4 58 M15 37 L26 58"');
		for (const text of [
			'Operator',
			'DeliverParcel',
			'«use case def»',
			'Parcel delivered.',
			'DeliveryDrone',
			'«include»',
			'uc [deliveryUseCases]'
		])
			expect(svg).toContain(`>${text}</text>`);
		// The boundary is drawn first, under the rest; the include is dashed, the actor's line not.
		expect(svg.indexOf('>DeliveryDrone</text>')).toBeLessThan(svg.indexOf('<ellipse'));
		expect(count(svg, /stroke-dasharray="5 4"/g)).toBe(1);
	});

	it('paints a background unless asked not to, and can match the dark theme', () => {
		const light = buildSvg(interconnection).svg;
		expect(light).toMatch(/<rect width="\d+" height="\d+" fill="#ffffff"\/>/);
		const clear = buildSvg(interconnection, { background: false }).svg;
		expect(clear).not.toMatch(/<rect width="\d+" height="\d+" fill=/);
		const dark = buildSvg(interconnection, { theme: 'dark' }).svg;
		expect(dark).toMatch(/<rect width="\d+" height="\d+" fill="#0f1012"\/>/);
		expect(dark).toContain(`fill="${TOKENS.dark.text}"`);
	});

	it('embeds font faces when given (for rasterising)', () => {
		const { svg } = buildSvg(interconnection, { fontFaces: '@font-face{font-family:X}' });
		expect(svg).toContain('<style>@font-face{font-family:X}</style>');
		expect(buildSvg(interconnection).svg).not.toContain('<style>');
	});
});

describe('parsePath', () => {
	it('reads the ends and directions of rounded orthogonal routes', () => {
		const g = parsePath('M 0 0 L 0 44 Q 0 50 6 50 L 100 50');
		expect(g.start).toEqual({ x: 0, y: 0 });
		expect(g.end).toEqual({ x: 100, y: 50 });
		expect(g.startDir).toEqual({ x: 0, y: 1 });
		expect(g.endDir).toEqual({ x: 1, y: 0 });
	});

	it('reads Svelte Flow smooth-step paths (commas, relative commands)', () => {
		const g = parsePath('M10,10L10,20Q10,25 15,25L40,25');
		expect(g.end).toEqual({ x: 40, y: 25 });
		const rel = parsePath('m 10 10 h 20 v 20');
		expect(rel.end).toEqual({ x: 30, y: 30 });
		expect(rel.endDir).toEqual({ x: 0, y: 1 });
	});

	it('finds the middle of a route for an unplaced label', () => {
		expect(parsePath('M 0 0 L 100 0').middle).toEqual({ x: 50, y: 0 });
		expect(parsePath('M 0 0 L 0 50 L 50 50').middle).toEqual({ x: 0, y: 50 });
	});
});

describe('edgeStyle', () => {
	it('follows SysmlEdge.svelte', () => {
		expect(edgeStyle('specialization')).toEqual({ end: 'specialization' });
		expect(edgeStyle('composition')).toEqual({ start: 'composition' });
		expect(edgeStyle('containment')).toEqual({ start: 'membership' });
		expect(edgeStyle('verify')).toEqual({ end: 'open', dashed: true });
		expect(edgeStyle('transition')).toEqual({ end: 'arrow' });
		expect(edgeStyle('typing')).toEqual({ end: 'typing' });
		expect(edgeStyle('binding')).toEqual({});
		expect(edgeStyle('include')).toEqual({ end: 'open', dashed: true });
		expect(edgeStyle('actor')).toEqual({});
	});
});

describe('exportFileName', () => {
	it('makes a file name from the view title', () => {
		expect(exportFileName('Drone interconnection', 'svg')).toBe('drone-interconnection.svg');
		expect(exportFileName('Délivery / flow: «v2»', 'png')).toBe('delivery-flow-v2.png');
		expect(exportFileName('***', 'svg')).toBe('diagram.svg');
	});
});

describe('palette', () => {
	it('matches the design tokens in global.css, light and dark', () => {
		const css = readFileSync('src/lib/styles/global.css', 'utf8');
		const block = (selector: string) => {
			const start = css.indexOf(selector);
			return css.slice(start, css.indexOf('}', start));
		};
		const value = (text: string, name: string) =>
			text.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,6})`))?.[1];
		for (const [theme, text] of [
			['light', block(':root {')],
			['dark', block(":root[data-theme='dark'] {")]
		] as const) {
			const t = TOKENS[theme];
			const pairs: [string, string][] = [
				['bg', t.bg],
				['surface', t.surface],
				['border', t.border],
				['border-strong', t.borderStrong],
				['text', t.text],
				['text-2', t.text2],
				['text-3', t.text3],
				...Object.entries(t.kinds).map(([k, v]) => [`kind-${k}`, v] as [string, string])
			];
			for (const [name, hex] of pairs) expect(value(text, name), `${theme} --${name}`).toBe(hex);
		}
	});

	it('mixes colours in Oklab as color-mix() does', () => {
		expect(mixOklab('#ffffff', '#000000', 1)).toBe('#ffffff');
		expect(mixOklab('#3b5bdb', '#3b5bdb', 0.3)).toBe('#3b5bdb');
		// Halfway between black and white in Oklab is a mid grey (L = 0.5), not #808080.
		expect(mixOklab('#ffffff', '#000000', 0.5)).toBe('#636363');
	});
});

describe('pngScale', () => {
	it('is 2× unless the image would be larger than browsers draw', () => {
		expect(pngScale(1200, 800)).toBe(2);
		expect(pngScale(6000, 4000)).toBeCloseTo(Math.sqrt(16_000_000 / 24_000_000));
		expect(pngScale(20_000, 100)).toBeCloseTo(0.8);
	});
});
