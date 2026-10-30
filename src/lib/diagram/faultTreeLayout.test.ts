import { describe, expect, it } from 'vitest';
import type { FaultTreeDrawing, FaultTreeEvent } from '#lib/engine/types.ts';
import { FAULT_TREE, gateWords, layoutFaultTrees } from './faultTreeLayout.ts';

const event = (
	id: string,
	inputs: string[] = [],
	gate?: FaultTreeEvent['gate']
): FaultTreeEvent => ({
	id,
	name: id,
	kind: id === 'top' ? 'top' : gate ? 'intermediate' : 'basic',
	description: null,
	inputs,
	probability: 0.1,
	...(gate ? { gate } : {})
});

// top = AND(g1, g2), g1 = OR(a, b), g2 = OR(a, c): `a` is under both gates.
const drawing: FaultTreeDrawing = {
	top: 'top',
	events: [
		event('top', ['g1', 'g2'], 'and'),
		event('g1', ['a', 'b'], 'or'),
		event('g2', ['a', 'c'], 'or'),
		event('a'),
		event('b'),
		event('c')
	],
	probability: 0.109,
	tolerable: null,
	status: null,
	cutSets: 2,
	smallestCutSet: 1,
	problems: []
};

describe('fault tree layout', () => {
	it('draws a repeated event under each of its gates, marked, with parents over their causes', () => {
		const [tree] = layoutFaultTrees([drawing]).trees;
		const placed = tree!.events;
		expect(placed.map((p) => p.key)).toEqual([
			'top',
			'top/g1',
			'top/g1/a',
			'top/g1/b',
			'top/g2',
			'top/g2/a',
			'top/g2/c'
		]);
		expect(placed.filter((p) => p.repeated).map((p) => p.key)).toEqual(['top/g1/a', 'top/g2/a']);
		const at = (key: string) => placed.find((p) => p.key === key)!;
		// Four leaves side by side; each gate centred over its two, the top over both gates.
		const w = FAULT_TREE.boxWidth;
		const g = FAULT_TREE.columnGap;
		expect(at('top/g1/b').cx - at('top/g1/a').cx).toBe(w + g);
		expect(at('top/g1').cx).toBe((at('top/g1/a').cx + at('top/g1/b').cx) / 2);
		expect(at('top').cx).toBe((at('top/g1').cx + at('top/g2').cx) / 2);
		expect(at('top/g1/a').y).toBeGreaterThan(at('top/g1').symbolTop + FAULT_TREE.symbolHeight);
		expect(tree!.width).toBe(4 * w + 3 * g);
	});

	it('says a gate in words', () => {
		expect(gateWords({ ...event('v', ['a', 'b', 'c'], 'atLeast'), k: 2 })).toBe('2 of 3');
		expect(gateWords(event('x', ['a'], 'inhibit'))).toBe('INHIBIT');
	});
});
