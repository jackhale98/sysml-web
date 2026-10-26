import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	LAYOUT_FILE,
	LAYOUT_FORMAT,
	diagramKey,
	layoutFormat,
	freeSpot,
	parseLayout,
	parseShown,
	placeAround,
	renamedNode,
	serializeLayout,
	withPositions,
	withShown,
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
			'{\n\t"#format": 1,\n\t"general:DroneArchitecture": {\n\t\t"drone": [10, 21],\n\t\t"drone.battery": [-5, 300]\n\t}\n}\n'
		);
		expect(parseLayout(text)).toEqual({
			'general:DroneArchitecture': { drone: [10, 21], 'drone.battery': [-5, 300] }
		});
	});

	it('tolerates broken or foreign content', () => {
		expect(parseLayout('not json')).toEqual({});
		expect(parseLayout('{"a:b": {"x": [1], "y": [1, 2]}, "c": 3}')).toEqual({
			'a:b': { y: [1, 2] }
		});
	});

	it('keeps what a diagram hides and adds beside its positions', () => {
		const key = diagramKey('general', 'DroneArchitecture');
		const file = withPositions({}, key, { drone: { x: 1, y: 2 } });
		const shown = withShown({}, key, { hidden: ['drone.radio', 'drone.camera', 'drone.radio'] });
		const text = serializeLayout(file, shown);
		expect(text).toBe(
			'{\n\t"#format": 1,\n\t"general:DroneArchitecture": {\n\t\t"#hidden": ["drone.camera", "drone.radio"],\n\t\t"drone": [1, 2]\n\t}\n}\n'
		);
		// Positions read past it; older versions of the app ignore it.
		expect(parseLayout(text)).toEqual({ [key]: { drone: [1, 2] } });
		expect(parseShown(text)).toEqual({
			[key]: { hidden: ['drone.camera', 'drone.radio'], added: [] }
		});
		// A diagram with only hidden or added elements is kept; with neither, dropped.
		const added = withShown(shown, 'general:', { added: ['P::Q'] });
		expect(parseShown(serializeLayout({}, added))).toEqual(added);
		expect(withShown(shown, key, { hidden: [] })).toEqual({});
		// Tidying the layout up forgets the positions, not what is hidden.
		const tidied = serializeLayout(withPositions(file, key, null), shown);
		expect(parseLayout(tidied)).toEqual({});
		expect(parseShown(tidied)).toEqual(shown);
		expect(parseShown('{"k": {"#hidden": [1, "a", ""]}}')).toEqual({
			k: { hidden: ['a'], added: [] }
		});
	});

	it('says its format version; a file written before it did is version 1 and reads the same', () => {
		// As the previous build wrote it, in a stored project (src/lib/project/store.test.ts).
		const stored = JSON.parse(
			readFileSync(
				join(import.meta.dirname, '../project/fixtures/formats/stored-project-v1.json'),
				'utf8'
			)
		) as { files: { path: string; text: string }[] };
		const v1 = stored.files.find((f) => f.path === LAYOUT_FILE)!.text;
		expect(v1).not.toContain('#format');
		expect(layoutFormat(v1)).toBe(1);
		// Written again, it gains the version line and nothing else changes.
		const again = serializeLayout(parseLayout(v1), parseShown(v1));
		expect(again).toBe(v1.replace(/^\{\n/, `{\n\t"#format": ${LAYOUT_FORMAT},\n`));
		expect(layoutFormat(again)).toBe(LAYOUT_FORMAT);
		expect(parseLayout(again)).toEqual(parseLayout(v1));
		expect(parseShown(again)).toEqual(parseShown(v1));
		expect(layoutFormat('not json')).toBe(1);
		expect(layoutFormat('{"#format": 2}')).toBe(2);
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
