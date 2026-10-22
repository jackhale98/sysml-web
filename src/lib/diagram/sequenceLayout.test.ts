import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { fitView, layoutSequence, readableView, SEQUENCE, splitLabel } from './sequenceLayout.ts';

const lifeline = (id: string, label = id): DiagramNode => ({
	id,
	label,
	kind: 'lifeline',
	stereotype: '<<part>>',
	attributes: [],
	is_definition: false
});
const message = (source: string, target: string, name: string, payload?: string): DiagramEdge => ({
	source,
	target,
	label: payload ? `${name} of ${payload}` : name,
	kind: 'message',
	message: { name, payload: payload ?? null, doc: null }
});
const graph = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramGraph => ({
	title: 'sv [I]',
	nodes,
	edges,
	subgraphs: [],
	direction: 'top_bottom'
});

describe('sequence layout', () => {
	const g = graph(
		[lifeline('a', 'a : A'), lifeline('b', 'b : B'), lifeline('c', 'c : C')],
		[
			message('a', 'b', 'first', 'Request'),
			message('b', 'c', 'aMuchLongerMessageNameThanTheOthers', 'SomePayloadType'),
			message('c', 'c', 'self'),
			message('c', 'a', 'back')
		]
	);
	const layout = layoutSequence(g);

	it('puts the lifelines left to right and the messages top to bottom, in order', () => {
		const xs = layout.lifelines.map((l) => l.x);
		expect(xs).toEqual([...xs].sort((p, q) => p - q));
		const ys = layout.messages.map((m) => m.y);
		expect(ys).toEqual([...ys].sort((p, q) => p - q));
		expect(new Set(ys).size).toBe(ys.length);
		expect(layout.messages[0]!.y).toBeGreaterThan(layout.lineTop);
		expect(layout.lineBottom).toBeGreaterThan(layout.messages.at(-1)!.y);
		expect(layout.lifelines[0]!.head.y).toBe(SEQUENCE.headTop);
	});

	it('spaces the lifelines so every label fits between its ends', () => {
		for (const m of layout.messages.filter((m) => !m.self)) {
			const [lo, hi] = [Math.min(m.x1, m.x2), Math.max(m.x1, m.x2)];
			expect(m.label.x).toBeGreaterThanOrEqual(lo);
			expect(m.label.x + m.label.width).toBeLessThanOrEqual(hi);
			expect(m.label.y + m.label.height).toBeLessThanOrEqual(m.y);
		}
		// Heads never overlap.
		for (const [i, l] of layout.lifelines.slice(1).entries())
			expect(l.head.x).toBeGreaterThan(
				layout.lifelines[i]!.head.x + layout.lifelines[i]!.head.width
			);
	});

	it('draws a message to its own lifeline as a loop, its label beside it, inside the drawing', () => {
		const self = layout.messages[2]!;
		expect(self.self).toBe(true);
		expect(self.path).toMatch(/^M (\d+) (\d+) H \d+ V \d+ H \d+$/);
		expect(self.label.x).toBeGreaterThan(self.x1);
		expect(self.label.x + self.label.width).toBeLessThanOrEqual(layout.width);
		// The next message starts below the loop.
		expect(layout.messages[3]!.y).toBeGreaterThan(self.y + SEQUENCE.selfHeight);
	});

	it('frames the drawing and names the frame', () => {
		expect(layout.tag.text).toBe('sv [I]');
		expect(layout.frame.x + layout.frame.width).toBeLessThanOrEqual(layout.width);
		expect(layout.frame.y + layout.frame.height).toBeLessThanOrEqual(layout.height);
	});

	it('splits a lifeline label into its name and type', () => {
		expect(splitLabel('drone : DeliveryDrone')).toEqual(['drone', 'DeliveryDrone']);
		expect(splitLabel('vehicle.engine')).toEqual(['vehicle.engine', null]);
	});

	it('fits the view, but keeps a wide sequence readable on a phone', () => {
		const size = { width: 800, height: 600 };
		expect(fitView(size, { width: 1000, height: 800 }).k).toBeCloseTo(1.1);
		const phone = readableView(size, { width: 390, height: 600 }, 0.8);
		expect(phone.k).toBe(0.8);
		expect(phone.x).toBeLessThan(10);
		const desk = readableView(size, { width: 1000, height: 800 }, 0.6);
		expect(desk.k).toBeCloseTo(1.1);
	});
});
