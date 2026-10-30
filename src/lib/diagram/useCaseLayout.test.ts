/**
 * The use case diagram's layout (`useCaseLayout.ts`) on the demo's delivery
 * use cases, laid out as the canvas lays them out: the use cases inside the
 * drone's boundary, the actors outside it on the left and the right, level
 * with their use cases; and where a straight line meets an ellipse or a
 * stick figure.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { layout, nodeSize } from './layout.ts';
import { notationOf } from './notation.ts';
import { boundaries, FIGURE, straightLine, type Outline } from './useCaseLayout.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) =>
	a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

describe('use case layout', () => {
	it('puts the use cases in the boundary and the actors outside it, on both sides', async () => {
		const files = demoFiles();
		host.analyzeProject(files);
		const graph = host.diagram('usecases', files, 'DroneViews::deliveryUseCases');
		const { nodes, routes } = await layout(graph, 'RIGHT', 'usecases');
		const at = new Map(nodes.map((p) => [p.node.id, p]));
		const [frame] = boundaries(
			graph.subgraphs,
			nodes.map((p) => ({ ...p, id: p.node.id }))
		);
		expect(frame).toMatchObject({ label: 'DeliveryDrone' });
		for (const id of ['DeliverParcel', 'VerifyDropZone', 'PlanRoute', 'ChargeBattery'])
			expect(inside(at.get(id)!, frame!), id).toBe(true);
		for (const id of ['Operator', 'Recipient', 'AviationAuthority'])
			expect(overlaps(at.get(id)!, frame!), id).toBe(false);
		// Who starts a use case stands left of the boundary; the others right of it.
		expect(at.get('Operator')!.x + at.get('Operator')!.width).toBeLessThan(frame!.x);
		expect(at.get('Recipient')!.x).toBeGreaterThan(frame!.x + frame!.width);
		expect(at.get('AviationAuthority')!.x).toBeGreaterThan(frame!.x + frame!.width);
		// A use case sits left of the one it includes.
		expect(at.get('DeliverParcel')!.x).toBeLessThan(at.get('VerifyDropZone')!.x);
		// Nothing overlaps.
		for (const a of nodes)
			for (const b of nodes)
				if (a !== b) expect(overlaps(a, b), `${a.node.id} ${b.node.id}`).toBe(false);
		// The lines are drawn straight, wherever the nodes go: there are no routes.
		expect(routes.size).toBe(0);
	});

	it('sizes an ellipse to its name and objective, and a figure to its name', () => {
		const useCase = (objective?: string) => ({
			id: 'U',
			label: 'DeliverParcel',
			kind: 'use_case' as const,
			stereotype: '<<use case def>>',
			attributes: objective ? [['objective', objective] as [string, string]] : [],
			is_definition: true
		});
		const plain = nodeSize(useCase(), 'usecases');
		const long = nodeSize(useCase('The recipient has the parcel. '.repeat(4)), 'usecases');
		expect(plain.width).toBeGreaterThan(plain.height);
		expect(long.height).toBeGreaterThan(plain.height);
		// Elsewhere a use case is still a box with compartments.
		expect(notationOf(useCase('x'), 'general').shape).toBe('box');
		expect(notationOf(useCase('x'), 'usecases').shape).toBe('usecase');
		const actor = { ...useCase(), kind: 'actor' as const, label: 'AviationAuthority' };
		expect(notationOf(actor, 'usecases').shape).toBe('actor');
		expect(nodeSize(actor, 'usecases').width).toBeGreaterThan(
			nodeSize({ ...actor, label: 'X' }, 'usecases').width
		);
	});

	it('ends a straight line on the ellipse and beside the figure', () => {
		const actor: Outline = { x: 0, y: 0, width: 80, height: 84, shape: 'actor' };
		const ellipse: Outline = { x: 200, y: 0, width: 200, height: FIGURE.height, shape: 'ellipse' };
		const [from, to] = straightLine(actor, ellipse);
		expect(from.x).toBeCloseTo(40 + FIGURE.width / 2 + 4);
		expect(from.y).toBeCloseTo(FIGURE.height / 2);
		// The ellipse's leftmost point, on the same level.
		expect(to.x).toBeCloseTo(200);
		expect(to.y).toBeCloseTo(FIGURE.height / 2);
		// At an angle, the end is on the ellipse: (dx/a)² + (dy/b)² = 1.
		const below: Outline = { ...ellipse, x: 100, y: 200 };
		const [, end] = straightLine(actor, below);
		const [a, b] = [below.width / 2, below.height / 2];
		const [cx, cy] = [below.x + a, below.y + b];
		expect(((end.x - cx) / a) ** 2 + ((end.y - cy) / b) ** 2).toBeCloseTo(1);
	});
});
