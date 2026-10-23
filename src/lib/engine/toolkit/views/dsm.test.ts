/**
 * Dependency matrices (`views/dsm.ts`) from real SysML through the toolkit
 * host: which elements a view lists, the links between them with their
 * direction, ports and parameters standing for their part or action, the
 * kinds a view counts, nested parts, successions through control nodes,
 * derivations and refinements, and the edit that saves a view's setting.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../../protocol';
import type { DependencyMatrix } from '../../types';
import { editFiles } from '../edit-testing';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const LIBRARY: SourceFile = {
	path: 'libraries/DependencyMatrices.sysml',
	text: readFileSync(
		join(import.meta.dirname, '../../../../demo/drone/libraries/DependencyMatrices.sysml'),
		'utf8'
	)
};

/** `from -> to kind` of the counted kinds (or of `kind`), by the items' paths; a link that goes both ways reads `<->`. */
function links(m: DependencyMatrix, kind?: string): string[] {
	return m.links
		.filter((l) => (kind ? l.kind === kind : m.kinds.includes(l.kind)))
		.map(
			(l) => `${m.items[l.from]!.path} ${l.mutual ? '<->' : '->'} ${m.items[l.to]!.path} ${l.kind}`
		)
		.sort();
}

const PLANT = `package Plant {
	private import DependencyMatrices::*;
	public import Catalogue::*;
	package Catalogue {
		item def Water;
		port def Outlet { out item water : Water; }
		interface def Pipe {
			end source : Outlet;
			end sink : ~Outlet;
			flow of Water from source.water to sink.water;
		}
		part def Pump { port outlet : Outlet; port inlet : ~Outlet; part motor : Motor; part impeller : Impeller; connect motor to impeller; }
		part def Motor;
		part def Impeller;
		part def Tank { port outlet : Outlet; port inlet : ~Outlet; }
		part def Controller { ref part watched : Pump; }
	}
	part plant {
		part tank : Tank;
		part pump : Pump;
		part controller : Controller;
		part spare : Pump;
		ref part both : Pump[2] = (pump, spare);
		interface feed : Pipe connect tank.outlet to pump.inlet;
		connect pump.outlet to tank.inlet;
		flow of Water from pump.outlet.water to tank.inlet.water;
	}
	view plantDsm : DependencyMatrix { expose plant::*; }
	view plantN2 : InterfaceN2 { expose plant::*; }
	view plantUses : DependencyMatrix {
		expose plant::*;
		@MatrixRendering { dependencies = "typing; teleport; succession"; order = "clustered"; }
	}
	view plantDeep : DependencyMatrix {
		expose plant::**;
		@MatrixRendering { levels = 2; }
	}
	view catalogue : DependencyMatrix {
		expose Catalogue::*;
		@MatrixRendering { dependencies = "typing"; }
	}
}`;

const plant = (): SourceFile[] => [LIBRARY, { path: 'Plant.sysml', text: PLANT }];

describe('a part matrix', () => {
	it('lists the exposed parts in model order, leaving out references', () => {
		const m = host.dependencyMatrix(plant(), 'plantDsm');
		expect(m.elements).toBe('parts');
		expect(m.scope).toBe('plant');
		expect(m.items.map((i) => `${i.name}:${i.type}`)).toEqual([
			'tank:Tank',
			'pump:Pump',
			'controller:Controller',
			'spare:Pump'
		]);
		expect(m.kinds).toEqual(['connection', 'flow', 'binding']);
		expect(m.order).toBe('model');
		expect(m.cells).toBe('marks');
	});

	it('reads links from the row to the column, a port standing for its part', () => {
		const m = host.dependencyMatrix(plant(), 'plantDsm');
		expect(links(m)).toEqual([
			'pump -> tank flow',
			'pump <-> tank connection',
			'tank <-> pump connection'
		]);
		const feed = m.links.find((l) => l.name === 'feed')!;
		expect(feed).toMatchObject({
			definition: 'Pipe',
			ends: ['tank.outlet', 'pump.inlet'],
			carries: [{ item: 'Water', forward: true }],
			mutual: true
		});
		const flow = m.links.find((l) => l.kind === 'flow')!;
		expect(flow.item).toBe('Water');
		// A link with no interface definition: the plain `connect`.
		expect(m.links.filter((l) => l.kind === 'connection' && !l.definition)).toHaveLength(1);
	});

	it('says where each link is written, to show it in the text', () => {
		const files = plant();
		const m = host.dependencyMatrix(files, 'plantDsm');
		const flow = m.links.find((l) => l.kind === 'flow')!;
		const text = files[1]!.text;
		expect(text.slice(flow.start, flow.end)).toBe(
			'flow of Water from pump.outlet.water to tank.inlet.water;'
		);
	});

	it('counts the kinds the view says, in the order offered, and flags the rest', () => {
		const m = host.dependencyMatrix(plant(), 'plantUses');
		expect(m.kinds).toEqual(['typing']);
		expect(m.order).toBe('clustered');
		expect(m.warnings).toEqual([
			'`teleport` is not a kind of dependency this matrix knows; ignored',
			'`succession` does not link these elements; ignored'
		]);
		// The controller watches a pump: what a pump is, the controller uses.
		expect(links(m, 'typing')).toEqual(['pump -> controller typing', 'spare -> controller typing']);
	});

	it('shows an N² chart with names in its cells, of connections and flows', () => {
		const m = host.dependencyMatrix(plant(), 'plantN2');
		expect(m.kinds).toEqual(['connection', 'flow']);
		expect(m.cells).toBe('names');
	});

	it('lists parts a level deeper, each rotor-like part with its own', () => {
		const m = host.dependencyMatrix(plant(), 'plantDeep');
		expect(m.items.map((i) => `${'  '.repeat(i.depth)}${i.path}`)).toEqual([
			'tank',
			'pump',
			'  pump.motor',
			'  pump.impeller',
			'controller',
			'spare',
			'  spare.motor',
			'  spare.impeller'
		]);
		// The definition's connection, read in each part typed by it.
		expect(links(m, 'connection')).toContain('pump.motor <-> pump.impeller connection');
		expect(links(m, 'connection')).toContain('spare.motor <-> spare.impeller connection');
		expect(m.items[2]!.parent).toBe(1);
	});

	it('lists a package of definitions, linked by what uses what', () => {
		const m = host.dependencyMatrix(plant(), 'catalogue');
		expect(m.items.map((i) => i.name)).toEqual(['Pump', 'Motor', 'Impeller', 'Tank', 'Controller']);
		expect(links(m, 'typing')).toEqual([
			'Impeller -> Pump typing',
			'Motor -> Pump typing',
			'Pump -> Controller typing'
		]);
	});
});

describe('the demo', () => {
	const files = demoFiles();

	it('the drone’s parts: power, commands and signals, with the airframe unlinked', () => {
		const m = host.dependencyMatrix(files, 'droneDsm');
		expect(m.items).toHaveLength(12);
		const ls = links(m);
		expect(ls).toContain('battery <-> powerDistribution connection');
		expect(ls).toContain('radio <-> flightController connection');
		expect(ls).toContain('flightController -> frontLeft flow');
		expect(ls).toContain('gnss -> flightController flow');
		expect(ls.filter((l) => l.includes('airframe'))).toEqual([]);
		// The radio's antenna side is bound to the drone's own port: outside the matrix.
		const radio = m.items.findIndex((i) => i.name === 'radio');
		expect(m.outside).toContainEqual({
			item: radio,
			kind: 'binding',
			direction: 'in',
			name: 'drone'
		});
		// Allocations come from actions: noted on the part they are allocated to.
		const camera = m.items.findIndex((i) => i.name === 'camera');
		expect(m.outside).toContainEqual({
			item: camera,
			kind: 'allocation',
			direction: 'in',
			name: 'checkDropZone'
		});
	});

	it('the delivery flight’s steps, through the fork, join, decision and merge', () => {
		const m = host.dependencyMatrix(files, 'deliveryFlightDsm');
		expect(m.elements).toBe('actions');
		expect(links(m, 'succession')).toEqual([
			'checkDropZone -> keepParcel succession',
			'checkDropZone -> releaseParcel succession',
			'descend -> keepParcel succession',
			'descend -> releaseParcel succession',
			'flyToDropPoint -> checkDropZone succession',
			'flyToDropPoint -> descend succession',
			'keepParcel -> returnHome succession',
			'releaseParcel -> returnHome succession',
			'returnHome -> land succession',
			'takeOff -> flyToDropPoint succession'
		]);
	});

	it('requirements: from each need to the requirements derived from it', () => {
		const m = host.dependencyMatrix(files, 'requirementDsm');
		expect(m.items.some((i) => i.name === 'DroneRequirement')).toBe(false);
		expect(m.items.find((i) => i.name === 'Flight endurance')?.shortName).toBe('SYS-001');
		expect(links(m, 'derivation')).toContain('Parcel delivery -> Flight endurance derivation');
		expect(links(m, 'derivation')).toHaveLength(11);
	});

	it('is made once per analysis', () => {
		const first = host.dependencyMatrix(files, 'droneDsm');
		expect(host.dependencyMatrix(files, 'droneDsm')).toBe(first);
	});

	it('marks matrix views in the list of views', () => {
		const views = host.listViews(files);
		expect(views.find((v) => v.name === 'droneDsm')).toMatchObject({
			matrix: 'parts',
			definition: 'DependencyMatrix',
			hasTable: false
		});
		expect(views.find((v) => v.name === 'requirementDsm')?.matrix).toBe('requirements');
		expect(views.find((v) => v.name === 'systemRequirements')?.matrix).toBeUndefined();
	});

	it('the library and the demo views check clean', () => {
		const analyses = host.analyzeProject(files);
		const own = analyses.filter((a) => /DependencyMatrices|views\/Views/.test(a.model.file));
		expect(own).toHaveLength(2);
		for (const a of own) {
			expect(a.model.syntax_errors).toEqual([]);
			expect(a.diagnostics.filter((d) => d.severity !== 'note')).toEqual([]);
		}
	});
});

describe('requirements and their refinements', () => {
	const text = `package Needs {
		private import DependencyMatrices::*;
		requirement <'N-1'> speed;
		requirement <'N-2'> topSpeed;
		requirement <'N-3'> range;
		#refinement dependency topSpeed to speed;
		view needs : RequirementDsm { expose Needs::*; }
		view everything : RequirementDsm;
	}`;
	const files = (): SourceFile[] => [LIBRARY, { path: 'Needs.sysml', text }];

	it('reads from what is refined to what refines it', () => {
		const m = host.dependencyMatrix(files(), 'needs');
		expect(m.items.map((i) => `${i.shortName} ${i.name}`)).toEqual([
			'N-1 speed',
			'N-2 topSpeed',
			'N-3 range'
		]);
		expect(links(m)).toEqual(['speed -> topSpeed refinement']);
	});

	it('without expose: every requirement of the project’s packages', () => {
		const m = host.dependencyMatrix(files(), 'everything');
		expect(m.items.map((i) => i.name)).toEqual(['speed', 'topSpeed', 'range']);
	});
});

describe('saving a setting', () => {
	it('writes the view’s own @MatrixRendering, then changes it in place', () => {
		const start = { [LIBRARY.path]: LIBRARY.text, 'Plant.sysml': PLANT };
		const first = editFiles(host, start, {
			op: 'setViewMetadata',
			path: 'Plant.sysml',
			view: 'plantDsm',
			metadata: 'MatrixRendering',
			field: 'order',
			value: 'clustered'
		});
		if ('error' in first) throw new Error(first.error);
		expect(first.files['Plant.sysml']).toContain(
			'view plantDsm : DependencyMatrix { expose plant::*;'
		);
		expect(first.files['Plant.sysml']).toMatch(/@MatrixRendering \{ order = "clustered"; \}/);
		const second = editFiles(host, first.files, {
			op: 'setViewMetadata',
			path: 'Plant.sysml',
			view: 'plantDsm',
			metadata: 'MatrixRendering',
			field: 'dependencies',
			value: 'connection; allocation'
		});
		if ('error' in second) throw new Error(second.error);
		expect(second.files['Plant.sysml']).toMatch(
			/@MatrixRendering \{ order = "clustered";\s*dependencies = "connection; allocation"; \}/
		);
		const m = host.dependencyMatrix(
			Object.entries(second.files).map(([path, text]) => ({ path, text })),
			'plantDsm'
		);
		expect(m).toMatchObject({ order: 'clustered', kinds: ['connection', 'allocation'] });
	});
});
