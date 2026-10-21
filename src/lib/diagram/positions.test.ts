import { describe, expect, it } from 'vitest';
import {
	diagramKey,
	freeSpot,
	parseLayout,
	placeAround,
	renamedNode,
	serializeLayout,
	withPositions,
	type Box
} from './positions.ts';

describe('layout file', () => {
	it('round-trips positions per diagram, one node per line', () => {
		const file = withPositions({}, diagramKey('general', 'DroneArchitecture'), {
			drone: { x: 10.4, y: 20.6 },
			'drone.battery': { x: -5, y: 300 }
		});
		const text = serializeLayout(file);
		expect(text).toBe(
			'{\n\t"general:DroneArchitecture": {\n\t\t"drone": [10, 21],\n\t\t"drone.battery": [-5, 300]\n\t}\n}\n'
		);
		expect(parseLayout(text)).toEqual({
			'general:DroneArchitecture': { drone: [10, 21], 'drone.battery': [-5, 300] }
		});
	});

	it('tolerates broken or foreign content', () => {
		expect(parseLayout('not json')).toEqual({});
		expect(parseLayout('{"a:b": {"x": [1], "y": [1, 2]}, "c": 3}')).toEqual({ 'a:b': { y: [1, 2] } });
	});

	it('clears a diagram', () => {
		const file = withPositions({}, 'k', { a: { x: 1, y: 2 } });
		expect(withPositions(file, 'k', null)).toEqual({});
		expect(serializeLayout({})).toBe('{}\n');
	});
});

describe('placing new nodes', () => {
	const box = (id: string, x: number, y: number): Box => ({ id, x, y, width: 100, height: 50 });

	it('uses the automatic layout when nothing is pinned', () => {
		const placed = placeAround([box('a', 0, 0), box('b', 0, 100)], new Map());
		expect(placed.get('b')).toEqual({ x: 0, y: 100 });
	});

	it('keeps pinned nodes and moves the others with them', () => {
		const auto = [box('a', 0, 0), box('b', 0, 120)];
		const placed = placeAround(auto, new Map([['a', { x: 500, y: 500 }]]));
		expect(placed.get('a')).toEqual({ x: 500, y: 500 });
		expect(placed.get('b')).toEqual({ x: 500, y: 620 });
	});

	it('steps aside when the spot is taken', () => {
		const auto = [box('a', 0, 0), box('b', 0, 120), box('c', 0, 240)];
		const placed = placeAround(
			auto,
			new Map([
				['a', { x: 0, y: 0 }],
				['b', { x: 0, y: 240 }]
			])
		);
		const c = placed.get('c')!;
		const b = { ...box('b', 0, 240) };
		expect(freeSpot({ ...box('c', c.x, c.y) }, [b])).toEqual(box('c', c.x, c.y));
	});

	it('recognises a rename', () => {
		expect(renamedNode(['a', 'b'], ['a', 'c'])).toEqual(['b', 'c']);
		expect(renamedNode(['a', 'b'], ['a', 'b', 'c'])).toBeNull();
	});
});
