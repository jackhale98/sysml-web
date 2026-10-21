import { describe, expect, it } from 'vitest';
import { flightModes, nestedMachine } from './fixtures.ts';
import {
	bestFit,
	elkGraph,
	fitTransform,
	labelLines,
	labelText,
	layoutMachine,
	readableTransform,
	roundedPath,
	simplify,
	stateSize
} from './layout.ts';

const inside = (
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number }
) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

describe('labels', () => {
	it('writes trigger [guard] / effect', () => {
		expect(labelText(flightModes.transitions[1]!)).toBe('ArmCommand [preflightChecksPassed]');
		expect(labelText(nestedMachine.transitions[2]!)).toBe('Go [count > 2] / inc');
		expect(labelLines(flightModes.transitions[0]!)).toEqual([]);
	});

	it('breaks long labels between parts', () => {
		const lines = labelLines({
			from: 'a',
			to: 'b',
			line: 1,
			trigger: 'ArmCommand',
			guard: 'preflightChecksPassed and batteryOk',
			effect: 'spinUp'
		});
		expect(lines.map((l) => l.map((p) => p.part))).toEqual([
			['trigger'],
			['guard'],
			['guard', 'effect']
		]);
		expect(lines.flat().every((p) => p.text.length <= 24)).toBe(true);
	});

	it('wraps a long change trigger between words', () => {
		const lines = labelLines(flightModes.transitions[6]!);
		expect(lines.map((l) => l.map((p) => p.text).join(' '))).toEqual([
			'when stateOfCharge <',
			'returnThreshold'
		]);
	});
});

describe('shapes', () => {
	it('sizes pseudostates and states with compartments', () => {
		const [entry, , , flying] = flightModes.states;
		expect(stateSize(entry!)).toEqual({ width: 16, height: 16 });
		const simple = stateSize(flightModes.states[1]!);
		expect(stateSize(flying!).height).toBeGreaterThan(simple.height);
	});

	it('builds a nested ELK graph and skips transitions to unknown states', () => {
		const graph = elkGraph(nestedMachine, 'DOWN');
		const par = graph.children!.find((c) => c.id === 'par')!;
		expect(par.children!.map((c) => c.id)).toEqual(['par.motors', 'par.lights']);
		expect(par.children![0]!.children!.map((c) => c.id)).toContain('par.motors.idle');
		// `then fin` names a state the engine could not find; it still has a box, so it stays.
		expect(graph.edges!.length).toBe(nestedMachine.transitions.length);
	});
});

describe('layout', () => {
	it('places every state and routes every transition of the demo', async () => {
		const layout = await layoutMachine(flightModes, 'DOWN');
		expect(layout.states).toHaveLength(flightModes.states.length);
		expect(layout.edges).toHaveLength(flightModes.transitions.length);
		for (const e of layout.edges) {
			expect(e.points.length).toBeGreaterThanOrEqual(2);
			expect(e.path.startsWith('M')).toBe(true);
		}
		const labelled = layout.edges.filter((e) => e.label);
		expect(labelled).toHaveLength(flightModes.transitions.length - 1);
		for (const s of layout.states) {
			expect(inside(s, { x: 0, y: 0, width: layout.width, height: layout.height })).toBe(true);
		}
	});

	it('keeps nested states inside their parent and divides parallel regions', async () => {
		const layout = await layoutMachine(nestedMachine, 'RIGHT');
		const byId = new Map(layout.states.map((s) => [s.id, s]));
		for (const s of layout.states) {
			if (s.parent) expect(inside(s, byId.get(s.parent)!)).toBe(true);
		}
		expect(byId.get('par.motors')!.kind).toBe('region');
		expect(byId.get('on')!.composite).toBe(true);
		expect(byId.get('par')!.parallel).toBe(true);
		expect(layout.separators).toHaveLength(1);
		// Parents are listed before their children so children paint on top.
		const order = layout.states.map((s) => s.id);
		expect(order.indexOf('on')).toBeLessThan(order.indexOf('on.low'));
	});
});

describe('geometry', () => {
	it('drops duplicate and collinear points', () => {
		expect(
			simplify([
				{ x: 0, y: 0 },
				{ x: 0, y: 0 },
				{ x: 0, y: 5 },
				{ x: 0, y: 10 },
				{ x: 10, y: 10 }
			])
		).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 10 },
			{ x: 10, y: 10 }
		]);
	});

	it('rounds corners', () => {
		expect(
			roundedPath([
				{ x: 0, y: 0 },
				{ x: 0, y: 40 },
				{ x: 40, y: 40 }
			])
		).toBe('M 0 0 L 0 32 Q 0 40 8 40 L 40 40');
		expect(roundedPath([])).toBe('');
	});

	it('keeps a readable scale and centres on the focus', () => {
		const big = { width: 1000, height: 1000 };
		const view = { width: 400, height: 400 };
		expect(readableTransform(big, view, 0.2).k).toBeCloseTo(0.368);
		const t = readableTransform(big, view, 0.8, { x: 460, y: 460, width: 80, height: 80 });
		expect(t.k).toBe(0.8);
		expect(t.x).toBeCloseTo(200 - 500 * 0.8);
		// Near an edge, the layout's border stays near the viewport's.
		expect(readableTransform(big, view, 0.8, { x: 0, y: 0, width: 80, height: 80 }).x).toBe(16);
	});

	it('fits and picks the direction that shows largest', () => {
		const fit = fitTransform({ width: 200, height: 100 }, { width: 432, height: 432 }, 16);
		expect(fit.k).toBe(1.35);
		expect(fit.x).toBeCloseTo((432 - 270) / 2);
		const tall = { width: 100, height: 600 };
		const wide = { width: 600, height: 100 };
		expect(bestFit([tall, wide], { width: 800, height: 400 })).toBe(wide);
		expect(bestFit([tall, wide], { width: 390, height: 700 })).toBe(tall);
	});
});
