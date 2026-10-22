import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { layoutSequence } from '../sequenceLayout.ts';
import { TOKENS } from './palette.ts';
import { sequenceSvg } from './sequence.ts';

const lifeline = (id: string, label: string, stereotype = '<<ref part>>'): DiagramNode => ({
	id,
	label,
	kind: 'lifeline',
	stereotype,
	attributes: [],
	is_definition: false
});
const message = (
	source: string,
	target: string,
	name: string,
	payload: string | null,
	events: { sourceEvent?: string; targetEvent?: string } = {}
): DiagramEdge => ({
	source,
	target,
	label: payload ? `${name} of ${payload}` : name,
	kind: 'message',
	element: { file: 'I.sysml', start_byte: 0 },
	message: { name, payload, doc: null, ...events }
});
const graph: DiagramGraph = {
	title: 'sv [ParcelDelivery]',
	nodes: [
		lifeline('operator', 'operator : Operator'),
		lifeline('station', 'station : GroundStation')
	],
	edges: [
		message('operator', 'station', 'planDelivery', 'FlightPlan'),
		message('station', 'station', 'check', null, { sourceEvent: 'a', targetEvent: 'b' }),
		message('station', 'operator', 'report', 'Telemetry & <Status>')
	],
	subgraphs: [],
	direction: 'top_bottom'
};

describe('sequence diagram export', () => {
	const layout = layoutSequence(graph);
	const { svg, width, height } = sequenceSvg(layout);

	it('is a standalone SVG of the size drawn, with no CSS or markers', () => {
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect([width, height]).toEqual([layout.width, layout.height]);
		for (const banned of ['<style', 'class=', 'var(', '<marker', 'foreignObject', 'url('])
			expect(svg).not.toContain(banned);
		expect(svg).toContain('<title>sv [ParcelDelivery]</title>');
	});

	it('draws the frame, the heads, the dashed lifelines and every message in order', () => {
		expect(svg.match(/stroke-dasharray="6 5"/g)).toHaveLength(2);
		expect(svg.match(/rx="13.25"/g)).toHaveLength(2);
		const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
		expect(texts).toEqual([
			'sv [ParcelDelivery]',
			'1',
			'planDelivery',
			'of',
			'FlightPlan',
			'2',
			'check',
			'3',
			'report',
			'of',
			'Telemetry &amp; &lt;Status&gt;',
			'«ref part»',
			'operator',
			': Operator',
			'«ref part»',
			'station',
			': GroundStation'
		]);
		// The self message's events are drawn on its lifeline.
		expect(svg.match(/<circle /g)).toHaveLength(2);
	});

	it('uses the light theme unless asked, and can leave the background out', () => {
		expect(svg).toContain(`fill="${TOKENS.light.surface}"`);
		const dark = sequenceSvg(layout, { theme: 'dark', background: false }).svg;
		expect(dark).toContain(TOKENS.dark.text);
		expect(dark).not.toContain(TOKENS.light.text);
		expect(dark).not.toMatch(/<rect width="\d+" height="\d+"/);
	});

	it('draws kind icons from their geometry only', () => {
		const icons = [[['path', { d: 'M1 1h2', class: 'x', style: 'color:red' }]] as const];
		const withIcon = sequenceSvg(layout, {
			icons: icons.map((shapes) => shapes.map(([tag, attrs]) => [tag, { ...attrs }]))
		}).svg;
		expect(withIcon).toContain('<path d="M1 1h2"/>');
		expect(withIcon).not.toContain('color:red');
	});
});
