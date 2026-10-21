/**
 * The seven diagram views on the demo, from the toolkit (`ToolkitHost.diagram`),
 * compared with the classic engine's graphs: the same nodes and edges where
 * classic was right, and the deliberate differences asserted where it was
 * not (inherited ports, flows and bindings, typing edges, transitions,
 * decision branches, «derive» links, view usages drawn with their filters).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiagramGraph, DiagramView } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

const ENGINE = join(import.meta.dirname, '../../../../../static/engine');

interface Classic {
	initSync(options: { module: Buffer }): void;
	diagram(view: string, files: string, scope: string | null): string;
}

let host: ToolkitHost;
let classic: Classic;
const files = demoFiles();
const timings: Record<string, number> = {};

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(files);
	classic = (await import(/* @vite-ignore */ join(ENGINE, 'sysml_wasm.js'))) as Classic;
	classic.initSync({ module: readFileSync(join(ENGINE, 'sysml_wasm_bg.wasm')) });
}, 60_000);

function toolkit(view: DiagramView, scope: string | null): DiagramGraph {
	const started = performance.now();
	const graph = host.diagram(view, files, scope);
	timings[`${view}:${scope ?? ''}`] = performance.now() - started;
	return graph;
}

const old = (view: DiagramView, scope: string | null): DiagramGraph =>
	JSON.parse(classic.diagram(view, JSON.stringify(files), scope)) as DiagramGraph;

const ids = (g: DiagramGraph) => g.nodes.map((n) => n.id).sort();
const node = (g: DiagramGraph, id: string) => g.nodes.find((n) => n.id === id)!;
const edges = (g: DiagramGraph, kind?: string) =>
	g.edges
		.filter((e) => !kind || e.kind === kind)
		.map((e) => `${e.source} -${e.kind}-> ${e.target}${e.label ? ` (${e.label})` : ''}`)
		.sort();

describe('general view', () => {
	it('draws a package like classic, without the package box (the frame names it)', () => {
		const tk = toolkit('general', 'DroneArchitecture');
		const was = old('general', 'DroneArchitecture');
		expect(ids(tk)).toEqual(ids(was).filter((id) => id !== 'DroneArchitecture'));
		expect(edges(tk, 'composition')).toEqual(edges(was, 'composition'));
		// New: the usage is "defined by" its definition.
		expect(edges(tk, 'typing')).toEqual(['drone -typing-> DeliveryDrone']);
		expect(node(tk, 'drone')).toMatchObject({
			label: 'drone : DeliveryDrone',
			stereotype: '<<part>>',
			is_definition: false
		});
		expect(node(tk, 'DeliveryDrone').attributes).toContainEqual([
			'port',
			'commandLink : ~CommandLinkPort'
		]);
		// Short values join the row; long expressions don't.
		expect(node(tk, 'drone').attributes).toEqual(
			expect.arrayContaining([
				['attribute', 'payloadCapacity = 1 [kg]'],
				['attribute', 'emptyMass']
			])
		);
	});

	it('keeps specializations and definition compositions as classic drew them', () => {
		const tk = toolkit('general', 'DroneComponents');
		const was = old('general', 'DroneComponents');
		expect(ids(tk)).toEqual(ids(was).filter((id) => id !== 'DroneComponents'));
		expect(edges(tk)).toEqual(edges(was));
		expect(node(tk, 'Component').attributes[0]).toEqual(['modifier', 'abstract']);
	});

	it('draws a definition as its parts, typed by the definitions they use', () => {
		const tk = toolkit('general', 'Rotor');
		expect(ids(tk)).toEqual(
			[
				'Component',
				'Motor',
				'Propeller',
				'Rotor',
				'SpeedController',
				'esc',
				'motor',
				'propeller'
			].sort()
		);
		expect(edges(tk, 'composition')).toEqual([
			'Rotor -composition-> esc',
			'Rotor -composition-> motor',
			'Rotor -composition-> propeller'
		]);
		expect(edges(tk, 'typing')).toContain('esc -typing-> SpeedController');
		expect(edges(tk, 'specialization')).toContain('Rotor -specialization-> Component');
	});

	it('draws a usage as its part tree, with dotted ids', () => {
		const tk = toolkit('general', 'drone');
		expect(tk.nodes).toHaveLength(10);
		expect(edges(tk, 'composition')).toContain('drone -composition-> drone.battery');
		// Classic drew the nine parts unconnected, without the drone itself.
		expect(old('general', 'drone').edges).toHaveLength(0);
	});

	it('draws view usages from what they expose, filters applied', () => {
		const catalogue = toolkit('general', 'DroneViews::componentCatalogue');
		// `filter @SysML::PartDefinition`: the part definitions only, not the package.
		expect(catalogue.nodes.every((n) => n.stereotype === '<<part def>>')).toBe(true);
		expect(ids(catalogue)).toEqual(
			ids(toolkit('general', 'DroneComponents')).filter((id) => !/^DroneComponents$/.test(id))
		);
		expect(catalogue.title).toBe('gv [componentCatalogue]');

		const breakdown = toolkit('general', 'DroneViews::droneBreakdown');
		expect(ids(breakdown)).toEqual(ids(toolkit('general', 'drone')));

		const tree = toolkit('general', 'DroneViews::requirementTree');
		expect(tree.nodes).toHaveLength(17);
		expect(tree.nodes.every((n) => n.kind === 'requirement')).toBe(true);
		// The `#derivation` connections, from each derived requirement to its need.
		expect(edges(tree, 'dependency')).toHaveLength(11);
		expect(edges(tree)).toContain(
			"'Flight endurance' -dependency-> 'Parcel delivery' (<<derive>>)"
		);
		expect(node(tree, "'Flight endurance'")).toMatchObject({
			label: "<SYS-001> 'Flight endurance'",
			stereotype: '<<requirement>>'
		});
		expect(node(tree, "'Flight endurance'").attributes[0]![0]).toBe('text');
	});

	it('draws the view usages of a package with what they expose (classic drew none)', () => {
		const tk = toolkit('general', 'DroneViews');
		expect(tk.nodes).toHaveLength(15);
		expect(node(tk, 'componentCatalogue')).toMatchObject({
			label: 'componentCatalogue : GeneralView',
			stereotype: '<<view>>',
			attributes: [
				['expose', 'DroneComponents::*'],
				['filter', '@SysML::PartDefinition']
			]
		});
		expect(old('general', 'DroneViews').nodes.map((n) => n.id)).toEqual(['DroneViews']);
	});

	it('draws every definition of the project without a scope, as classic did', () => {
		const tk = toolkit('general', null);
		const was = old('general', null);
		const packages = was.nodes.filter((n) => n.stereotype === '<<package>>').map((n) => n.id);
		expect(ids(tk)).toEqual(ids(was).filter((id) => !packages.includes(id)));
		expect(edges(tk, 'specialization')).toEqual(edges(was, 'specialization'));
	});

	it('says where each element is declared, so the canvas finds it without guessing', () => {
		const tk = toolkit('general', 'DroneArchitecture');
		const text = files.find((f) => f.path === 'system/DroneArchitecture.sysml')!.text;
		const at = node(tk, 'drone.battery').element!;
		expect(at.file).toBe('system/DroneArchitecture.sysml');
		expect(Buffer.from(text).subarray(at.start_byte).toString().startsWith('part battery')).toBe(
			true
		);
	});
});

describe('interconnection view', () => {
	it('draws the same parts with the same ports as classic, and adds what classic missed', () => {
		const tk = toolkit('interconnection', 'drone');
		const was = old('interconnection', 'drone');
		const parts = (g: DiagramGraph) => g.nodes.filter((n) => n.kind === 'block');
		expect(ids({ ...tk, nodes: parts(tk) })).toEqual(ids(was));
		for (const n of parts(was)) expect(node(tk, n.id).attributes).toEqual(n.attributes);
		expect(edges(tk, 'connection')).toEqual(edges(was, 'connection'));
		// New: the drone's own port, inherited from DeliveryDrone, bound to the radio's.
		expect(node(tk, 'commandLink')).toMatchObject({ kind: 'port' });
		expect(edges(tk, 'binding')).toEqual(['commandLink -binding-> radio']);
		// New: the four item flows (classic's model had no flows with feature-chain ends).
		expect(edges(tk, 'flow')).toEqual([
			'camera -flow-> flightController (Image)',
			'flightController -flow-> payloadRelease (ReleaseCommand)',
			'flightController -flow-> rotors (MotorCommand)',
			'gnss -flow-> flightController (PositionFix)'
		]);
	});

	it('shows ports a part inherits through what it subsets', () => {
		const tk = toolkit('interconnection', 'deliveryService');
		const was = old('interconnection', 'deliveryService');
		expect(ids(tk)).toEqual(ids(was));
		expect(edges(tk)).toEqual(edges(was));
		expect(node(was, 'drone').attributes).toEqual([]);
		expect(node(tk, 'drone')).toMatchObject({
			label: 'drone :> DroneArchitecture::drone',
			attributes: [['port', 'commandLink : ~CommandLinkPort']]
		});
	});

	it("binds a definition's ports to its parts' ports", () => {
		const tk = toolkit('interconnection', 'Rotor');
		expect(edges(tk, 'binding')).toEqual(['control -binding-> esc', 'powerIn -binding-> esc']);
		expect(edges(tk, 'connection')).toEqual([
			'esc -connection-> motor',
			'motor -connection-> propeller'
		]);
	});
});

describe('state transition view', () => {
	it('draws every transition, labelled (classic drew only the initial one)', () => {
		const tk = toolkit('states', 'FlightModes');
		const was = old('states', 'FlightModes');
		expect(ids(tk)).toEqual(ids(was));
		expect(was.edges).toHaveLength(1);
		expect(tk.edges).toHaveLength(12);
		expect(edges(tk)).toEqual(
			expect.arrayContaining([
				'__initial__ -transition-> idle',
				'idle -transition-> armed (ArmCommand [preflightChecksPassed])',
				'flying -transition-> returningHome (when stateOfCharge < returnThreshold)'
			])
		);
		expect(node(tk, 'failsafe').attributes).toEqual([['entry', 'alertOperator']]);
		expect(toolkit('states', null)).toEqual(tk);
	});
});

describe('action flow view', () => {
	it('draws the whole flow, decisions with their guards', () => {
		const tk = toolkit('actions', 'DeliveryFlight');
		const was = old('actions', 'DeliveryFlight');
		expect(tk.nodes).toHaveLength(was.nodes.length);
		// Ids are names now (classic numbered them: act_0, fork_3, …).
		expect(ids(tk)).toEqual(
			[
				'__final__',
				'__initial__',
				'atDropPoint',
				'checkDropZone',
				'decide#1',
				'descend',
				'flyToDropPoint',
				'fork#1',
				'keepParcel',
				'land',
				'readyToReturn',
				'releaseParcel',
				'returnHome',
				'takeOff'
			].sort()
		);
		// Classic lost returnHome and land, and left the decision without branches.
		expect(was.nodes.map((n) => n.label)).not.toContain('returnHome');
		expect(edges(tk)).toEqual(
			expect.arrayContaining([
				'decide#1 -flow-> releaseParcel ([checkDropZone.isClear])',
				'decide#1 -flow-> keepParcel ([else])',
				'land -flow-> __final__'
			])
		);
		// Every node lies on a path from the start to the end.
		const next = (id: string) => tk.edges.filter((e) => e.source === id).map((e) => e.target);
		const reached = new Set<string>(['__initial__']);
		for (const id of reached) for (const n of next(id)) reached.add(n);
		expect([...reached].sort()).toEqual(ids(tk));
		expect(node(tk, 'flyToDropPoint').attributes).toEqual([['in item', 'plan : FlightPlan']]);
	});
});

describe('requirement views', () => {
	it('draws the same requirements, satisfy and verify links as classic, plus «derive»', () => {
		const tk = toolkit('requirements', null);
		const was = old('requirements', null);
		const requirements = (g: DiagramGraph) =>
			g.nodes
				.filter((n) => n.kind === 'requirement')
				.map((n) => n.id)
				.sort();
		expect(requirements(tk)).toEqual(requirements(was));
		// Satisfiers are named by their path from the design (`drone.battery`, classic: `battery`).
		const last = (s: string) => s.split(' -')[0]!.split('.').pop() + ' -' + s.split(' -')[1];
		expect(edges(tk, 'satisfy').map(last).sort()).toEqual(edges(was, 'satisfy').map(last).sort());
		expect(edges(tk, 'verify')).toEqual(edges(was, 'verify'));
		expect(edges(tk, 'dependency')).toHaveLength(11);
	});

	it('marks requirements nothing satisfies or verifies on the trace view', () => {
		const tk = toolkit('trace', null);
		const status = (id: string) =>
			node(tk, id)
				.attributes.filter(([k]) => k === 'status')
				.map(([, v]) => v);
		expect(status("'Acoustic noise'")).toEqual(['UNSATISFIED', 'UNVERIFIED']);
		expect(status("'Flight endurance'")).toEqual([]);
		expect(edges(tk, 'satisfy')).toHaveLength(12);
		expect(edges(tk, 'verify')).toHaveLength(9);
		// Classic drew requirement definitions only, so its links pointed at nothing.
		const was = old('trace', null);
		expect(was.nodes.some((n) => n.id === "'Acoustic noise'")).toBe(false);
	});
});

describe('package view', () => {
	it('draws the packages and their definitions like classic, joined by membership', () => {
		const tk = toolkit('packages', null);
		const was = old('packages', null);
		expect(ids(tk)).toEqual(ids(was));
		expect(tk.subgraphs.map((s) => s.id).sort()).toEqual(was.subgraphs.map((s) => s.id).sort());
		expect(edges(tk, 'containment')).toContain('DroneComponents -containment-> Battery');
	});
});

describe('names that need quotes', () => {
	const project = [
		{
			path: 'Quoted.sysml',
			text: `package P {
	port def Q { out item x; }
	part def 'Power Unit' { port 'out pin' : Q; }
	part 'my system' {
		part 'power unit' : 'Power Unit';
		part load { port 'in pin' : ~Q; }
		connect 'power unit'.'out pin' to load.'in pin';
		bind 'power unit'.'out pin' = load.'in pin';
	}
	action def 'Do it' {
		first start;
		then decide;
			if true then 'step one';
			else 'step two';
		action 'step one';
		action 'step two';
	}
}`
		}
	];

	it('keeps quoted names whole in ids, labels and connection ends', () => {
		const ic = host.diagram('interconnection', project, 'my system');
		expect(ids(ic)).toEqual(["'power unit'", 'load']);
		expect(node(ic, "'power unit'").attributes).toEqual([['port', "'out pin' : Q"]]);
		expect(edges(ic)).toEqual([
			"'power unit' -binding-> load",
			"'power unit' -connection-> load ('out pin' to 'in pin')"
		]);
		const flow = host.diagram('actions', project, 'Do it');
		expect(edges(flow)).toEqual(
			expect.arrayContaining([
				"decide#1 -flow-> 'step one' ([true])",
				"decide#1 -flow-> 'step two' ([else])"
			])
		);
		host.analyzeProject(files);
	});
});

describe('cost', () => {
	it('draws each view quickly once the model is read', () => {
		for (const [view, scope] of [
			['general', 'DroneArchitecture'],
			['interconnection', 'drone'],
			['states', 'FlightModes'],
			['actions', 'DeliveryFlight'],
			['requirements', null]
		] as const)
			toolkit(view, scope);
		console.log(
			'diagram ms:',
			Object.entries(timings)
				.map(([k, v]) => `${k} ${v.toFixed(1)}`)
				.join(', ')
		);
		for (const ms of Object.values(timings)) expect(ms).toBeLessThan(1000);
	});
});
