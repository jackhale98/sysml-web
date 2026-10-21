import { describe, expect, it } from 'vitest';
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { LABEL_HEIGHT, labelWidth, overlap, place, type Box } from './labels.svelte.ts';
import { layout } from './layout.ts';

/** A straight edge from (0, 0) down to (0, 200). */
const along = (_: number, t: number) => ({ x: 0, y: 200 * t });
const boxOf = (p: { x: number; y: number }, w: number, h: number): Box => ({
	x: p.x - w / 2,
	y: p.y - h / 2,
	width: w,
	height: h
});

describe('place', () => {
	it('starts at the middle of the edge', () => {
		expect(place([{ width: 80, height: 18 }], along, [])).toEqual([{ x: 0, y: 100 }]);
	});

	it('slides labels on the same line apart', () => {
		const labels = [
			{ width: 80, height: 18 },
			{ width: 80, height: 18 }
		];
		const [a, b] = place(labels, along, []);
		expect(overlap(boxOf(a!, 80, 18), boxOf(b!, 80, 18))).toBe(0);
	});

	it('keeps clear of nodes and of labels already placed', () => {
		const node = { x: -60, y: 80, width: 120, height: 40 };
		const fixed = { x: 0, y: 150 };
		const [first, second] = place(
			[
				{ width: 80, height: 18, fixed },
				{ width: 80, height: 18 }
			],
			along,
			[node]
		);
		expect(first).toEqual(fixed);
		const box = boxOf(second!, 80, 18);
		expect(overlap(box, node)).toBe(0);
		expect(overlap(box, boxOf(fixed, 80, 18))).toBe(0);
	});
});

const state = (id: string): DiagramNode => ({
	id,
	label: id,
	kind: 'state',
	stereotype: '<<state>>',
	attributes: [],
	is_definition: false
});

describe('layout', () => {
	it('routes transitions both ways between two states apart, labels clear of each other and of the states', async () => {
		const graph: DiagramGraph = {
			title: 'stv',
			direction: 'TB',
			subgraphs: [],
			nodes: [state('idle'), state('armed'), state('flying')],
			edges: [
				{ source: 'idle', target: 'armed', kind: 'transition', label: 'ArmCommand [ready]' },
				{ source: 'armed', target: 'idle', kind: 'transition', label: 'DisarmCommand' },
				{ source: 'armed', target: 'flying', kind: 'transition', label: 'TakeOffCommand' },
				{ source: 'flying', target: 'idle', kind: 'transition', label: 'Landed' }
			]
		};
		const { nodes, routes } = await layout(graph, 'DOWN', 'state');
		expect(routes.size).toBe(4);
		const there = [...routes.values()];
		expect(there[0]!.points).not.toEqual(there[1]!.points);

		const labelBoxes = graph.edges.map((e, i) =>
			boxOf(routes.get(i)!.label!, labelWidth(e.label!), LABEL_HEIGHT)
		);
		const nodeBoxes = nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
		for (const [i, a] of labelBoxes.entries()) {
			for (const b of labelBoxes.slice(i + 1)) expect(overlap(a, b)).toBe(0);
			for (const n of nodeBoxes) expect(overlap(a, n)).toBe(0);
		}
	});
});
