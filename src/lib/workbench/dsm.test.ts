/**
 * The app's reading of a dependency matrix: cells, the suggested modules
 * (deterministic, whatever the links' order), what a change reaches, review
 * flags, sentences and the export, on the demo's drone as the engine reads
 * it and on small matrices made by hand.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DependencyMatrix, MatrixLink } from '#lib/engine/types.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import {
	cellsOf,
	cluster,
	impactOf,
	linkSentence,
	matrixExport,
	passes,
	reviewFlags
} from './dsm.ts';

let drone: DependencyMatrix;
beforeAll(async () => {
	const host = await loadHost();
	drone = host.dependencyMatrix(demoFiles(), 'droneDsm');
}, 60_000);

const names = (m: DependencyMatrix, items: Iterable<number>) =>
	[...items].map((i) => m.items[i]!.name);

/** A matrix of `n` elements named a, b, c… with links `a>b` (one way) or `a-b` (both ways). */
function made(n: number, written: string[]): DependencyMatrix {
	const items = Array.from({ length: n }, (_, i) => ({
		id: String(i),
		name: String.fromCharCode(97 + i),
		qualifiedName: String.fromCharCode(97 + i),
		path: String.fromCharCode(97 + i),
		kind: 'part',
		type: null,
		depth: 0,
		parent: null,
		file: 'a.sysml',
		start: 0,
		end: 0
	}));
	const at = (c: string) => c.charCodeAt(0) - 97;
	const links: MatrixLink[] = written.map((w) => ({
		from: at(w[0]!),
		to: at(w[2]!),
		kind: w[1] === '-' ? 'connection' : 'flow',
		mutual: w[1] === '-',
		file: 'a.sysml',
		start: 0,
		end: 0,
		...(w[1] === '-' ? { definition: 'Cable' } : { item: 'Water' })
	}));
	return {
		view: 'v',
		elements: 'parts',
		kinds: ['connection', 'flow'],
		available: ['connection', 'flow'],
		order: 'model',
		cells: 'marks',
		scope: null,
		items,
		links,
		outside: [],
		warnings: []
	};
}

describe('cells', () => {
	it('a flow fills its row’s cell only; a connection both', () => {
		const m = made(3, ['a>b', 'b-c']);
		const cells = cellsOf(m, m.kinds);
		expect([...cells.keys()].sort()).toEqual(['0:1', '1:2', '2:1']);
		expect(cellsOf(m, ['flow']).size).toBe(1);
	});

	it('reads each link from the row, in plain words', () => {
		const m = made(3, ['a>b', 'b-c']);
		expect(linkSentence(m, m.links[0]!, 0)).toBe('A passes water to B');
		expect(linkSentence(m, m.links[1]!, 2)).toBe('C is connected to B, by a cable interface');
	});

	it('an interface carries its items one way or the other', () => {
		const power = drone.links.find((l) => l.name === 'radioCable')!;
		const radio = drone.items.findIndex((i) => i.name === 'radio');
		const controller = drone.items.findIndex((i) => i.name === 'flightController');
		expect(passes(power, radio)).toEqual(['Flight command']);
		expect(passes(power, controller)).toEqual(['Telemetry']);
	});
});

describe('suggested modules', () => {
	it('the drone: power and propulsion, and the avionics; the airframe, unlinked, last', () => {
		const { order, modules } = cluster(drone, drone.kinds);
		expect(modules.map((g) => names(drone, g))).toEqual([
			['battery', 'powerDistribution', 'frontLeft', 'frontRight', 'rearLeft', 'rearRight'],
			['flightController', 'gnss', 'radio', 'camera', 'payloadRelease']
		]);
		expect(names(drone, order).at(-1)).toBe('airframe');
		expect(order).toHaveLength(drone.items.length);
	});

	it('is the same whatever order the links come in', () => {
		const shuffled = { ...drone, links: drone.links.toReversed() };
		const rotated = { ...drone, links: [...drone.links.slice(5), ...drone.links.slice(0, 5)] };
		const expected = cluster(drone, drone.kinds);
		expect(cluster(shuffled, drone.kinds)).toEqual(expected);
		expect(cluster(rotated, drone.kinds)).toEqual(expected);
	});

	it('two pairs joined by one link stay two modules', () => {
		const m = made(5, ['a-b', 'a>b', 'c-d', 'd>c', 'b>c']);
		expect(cluster(m, m.kinds)).toEqual({
			order: [0, 1, 2, 3, 4],
			modules: [
				[0, 1],
				[2, 3]
			]
		});
	});

	it('nothing linked: model order, no modules', () => {
		const m = made(3, []);
		expect(cluster(m, m.kinds)).toEqual({ order: [0, 1, 2], modules: [] });
	});
});

describe('change impact', () => {
	it('follows links out of the element, directly then through others', () => {
		const m = made(5, ['a>b', 'b>c', 'c-d', 'e>a']);
		expect([...impactOf(m, m.kinds, 0)]).toEqual([
			[1, 1],
			[2, 2],
			[3, 3]
		]);
		// Only flows: the connection to d doesn't count.
		expect([...impactOf(m, ['flow'], 0)]).toEqual([
			[1, 1],
			[2, 2]
		]);
	});

	it('the battery reaches what it powers, and what they command; not the sensors feeding them', () => {
		const battery = drone.items.findIndex((i) => i.name === 'battery');
		const reached = impactOf(drone, drone.kinds, battery);
		expect(names(drone, reached.keys()).sort()).toEqual([
			'flightController',
			'frontLeft',
			'frontRight',
			'payloadRelease',
			'powerDistribution',
			'radio',
			'rearLeft',
			'rearRight'
		]);
		expect(
			names(
				drone,
				[...reached].filter(([, d]) => d === 1).map(([i]) => i)
			)
		).toEqual(['powerDistribution']);
	});
});

describe('review flags', () => {
	it('a connection with no interface definition, and an element with no links', () => {
		const m = made(3, ['a-b']);
		m.links[0]!.definition = undefined;
		const flags = reviewFlags(m, m.kinds);
		expect(flags.untyped).toHaveLength(1);
		expect(flags.unlinked).toEqual([2]);
		expect(reviewFlags(drone, drone.kinds).unlinked.map((i) => drone.items[i]!.name)).toEqual([
			'airframe'
		]);
	});
});

describe('export', () => {
	it('numbers the elements, marks each cell, the diagonal filled', () => {
		const m = made(3, ['a>b', 'a-b', 'b-c']);
		const table = matrixExport(m, m.kinds, [0, 1, 2], { title: 'DSM', project: 'p' });
		expect(table.header).toEqual(['#', 'Element', '1', '2', '3']);
		expect(table.rows).toEqual([
			['1', 'A', '■', 'F C', ''],
			['2', 'B', 'C', '■', 'C'],
			['3', 'C', '', 'C', '■']
		]);
		const n2 = matrixExport({ ...m, cells: 'names' }, m.kinds, [0, 1, 2], {
			title: 'N2',
			project: 'p'
		});
		expect(n2.rows[0]).toEqual(['1', 'A', '■', 'Water; Cable', '']);
	});
});
