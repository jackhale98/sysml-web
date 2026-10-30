/**
 * The diagram views on the demo (the sequence view: `sequence.test.ts`), from the toolkit (`ToolkitHost.diagram`):
 * nodes and edges, inherited ports, flows and bindings, typing edges,
 * transitions, decision branches, «derive» links, and view usages drawn with
 * their filters.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiagramGraph, DiagramView } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
const files = demoFiles();
const timings: Record<string, number> = {};

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(files);
}, 60_000);

function toolkit(view: DiagramView, scope: string | null): DiagramGraph {
	const started = performance.now();
	const graph = host.diagram(view, files, scope);
	timings[`${view}:${scope ?? ''}`] = performance.now() - started;
	return graph;
}

const ids = (g: DiagramGraph) => g.nodes.map((n) => n.id).sort();
const node = (g: DiagramGraph, id: string) => g.nodes.find((n) => n.id === id)!;
const edges = (g: DiagramGraph, kind?: string) =>
	g.edges
		.filter((e) => !kind || e.kind === kind)
		.map((e) => `${e.source} -${e.kind}-> ${e.target}${e.label ? ` (${e.label})` : ''}`)
		.sort();

describe('general view', () => {
	it('draws a package without the package box (the frame names it)', () => {
		const tk = toolkit('general', 'DroneArchitecture');
		expect(ids(tk)).toEqual([
			'DeliveryDrone',
			'drone',
			'drone.airframe',
			'drone.battery',
			'drone.camera',
			'drone.flightController',
			'drone.frontLeft',
			'drone.frontRight',
			'drone.gnss',
			'drone.payloadRelease',
			'drone.powerDistribution',
			'drone.radio',
			'drone.rearLeft',
			'drone.rearRight'
		]);
		expect(edges(tk, 'composition')).toEqual([
			'drone -composition-> drone.airframe',
			'drone -composition-> drone.battery',
			'drone -composition-> drone.camera',
			'drone -composition-> drone.flightController',
			'drone -composition-> drone.frontLeft',
			'drone -composition-> drone.frontRight',
			'drone -composition-> drone.gnss',
			'drone -composition-> drone.payloadRelease',
			'drone -composition-> drone.powerDistribution',
			'drone -composition-> drone.radio',
			'drone -composition-> drone.rearLeft',
			'drone -composition-> drone.rearRight'
		]);
		// The usage is "defined by" its definition.
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
				['attribute', 'emptyMass'],
				// The reference to the four rotors is a row, not a box.
				['ref part', 'rotors : Rotor [4]']
			])
		);
	});

	it('draws specializations and definition compositions', () => {
		const tk = toolkit('general', 'DroneComponents');
		expect(ids(tk)).toEqual([
			'Airframe',
			'Battery',
			'Camera',
			'Component',
			'FlightController',
			'GnssReceiver',
			'Motor',
			'PayloadRelease',
			'PowerDistributionBoard',
			'Propeller',
			'Rotor',
			'RotorSpin',
			'SpeedController',
			'TelemetryRadio'
		]);
		expect(edges(tk)).toEqual([
			'Airframe -specialization-> Component',
			'Battery -specialization-> Component',
			'Camera -specialization-> Component',
			'FlightController -specialization-> Component',
			'GnssReceiver -specialization-> Component',
			'Motor -specialization-> Component',
			'PayloadRelease -specialization-> Component',
			'PowerDistributionBoard -specialization-> Component',
			'Propeller -specialization-> Component',
			'Rotor -composition-> Motor (motor)',
			'Rotor -composition-> Propeller (propeller)',
			'Rotor -composition-> SpeedController (esc)',
			'Rotor -specialization-> Component',
			'SpeedController -specialization-> Component',
			'TelemetryRadio -specialization-> Component'
		]);
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
		// The drone and its 12 parts; `rotors` refers to four of them and is not a part of its own.
		expect(tk.nodes).toHaveLength(13);
		expect(ids(tk)).not.toContain('drone.rotors');
		expect(edges(tk, 'composition')).toContain('drone -composition-> drone.battery');
	});

	it('draws view usages from what they expose, filters applied', () => {
		const catalogue = toolkit('general', 'DroneViews::componentCatalogue');
		// `filter @SysML::PartDefinition`: the part definitions only, not the package.
		expect(catalogue.nodes.every((n) => n.stereotype === '<<part def>>')).toBe(true);
		expect(ids(catalogue)).toEqual(
			ids(toolkit('general', 'DroneComponents')).filter(
				(id) => id !== 'DroneComponents' && id !== 'RotorSpin'
			)
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

	it('draws the view usages of a package with what they expose', () => {
		const tk = toolkit('general', 'DroneViews');
		expect(tk.nodes).toHaveLength(30);
		expect(node(tk, 'componentCatalogue')).toMatchObject({
			label: 'componentCatalogue : GeneralView',
			stereotype: '<<view>>',
			attributes: [
				['expose', 'DroneComponents::*'],
				['filter', '@SysML::PartDefinition']
			]
		});
	});

	it('draws every definition of the project without a scope', () => {
		const tk = toolkit('general', null);
		const definitions = host
			.analyzeProject(files)
			.flatMap((a) => a.model.definitions)
			.filter((d) => d.kind !== 'package')
			.map((d) => d.name)
			.sort();
		// With the dependency matrices' library: a metadata def and four view defs; and the
		// reporting library's convention marker (a metadata def and its severity enum def); the
		// drone's variation defs (`BatteryOption`, `RadioOption`) and the variability matrix.
		expect(definitions).toHaveLength(118);
		expect(ids(tk)).toEqual(definitions);
		expect(edges(tk, 'specialization')).toEqual([
			'Airframe -specialization-> Component',
			'ArmCommand -specialization-> FlightCommand',
			'Battery -specialization-> Component',
			'BatteryOption -specialization-> Battery',
			'Camera -specialization-> Component',
			'DesignFmeaWorksheet -specialization-> FmeaWorksheet',
			'DisarmCommand -specialization-> FlightCommand',
			'DroneRequirement -specialization-> EngineeringRequirement',
			'FailureMode -specialization-> RiskEvent',
			'FlightController -specialization-> Component',
			'FlightPlan -specialization-> FlightCommand',
			'GnssReceiver -specialization-> Component',
			'Harm -specialization-> RiskEvent',
			'Hazard -specialization-> RiskEvent',
			'HazardousSituation -specialization-> RiskEvent',
			'InterfaceN2 -specialization-> DependencyMatrix',
			'Motor -specialization-> Component',
			'PayloadRelease -specialization-> Component',
			'PowerDistributionBoard -specialization-> Component',
			'ProcessFmeaWorksheet -specialization-> FmeaWorksheet',
			'Propeller -specialization-> Component',
			'RadioOption -specialization-> TelemetryRadio',
			'ReturnHomeCommand -specialization-> FlightCommand',
			'Rotor -specialization-> Component',
			'SpeedController -specialization-> Component',
			'TakeOffCommand -specialization-> FlightCommand',
			'TelemetryRadio -specialization-> Component',
			'UseFmeaWorksheet -specialization-> FmeaWorksheet'
		]);
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
	it('draws the parts with their ports, connections, bindings and flows', () => {
		const tk = toolkit('interconnection', 'drone');
		const parts = tk.nodes.filter((n) => n.kind === 'block');
		const ports: Record<string, string[]> = {
			airframe: [],
			battery: ['powerOut : PowerPort'],
			powerDistribution: [
				'powerIn : ~PowerPort',
				'rotorPower : PowerPort',
				'avionicsPower : PowerPort'
			],
			frontLeft: ['powerIn : ~PowerPort', 'control : ~MotorControlPort'],
			frontRight: ['powerIn : ~PowerPort', 'control : ~MotorControlPort'],
			rearLeft: ['powerIn : ~PowerPort', 'control : ~MotorControlPort'],
			rearRight: ['powerIn : ~PowerPort', 'control : ~MotorControlPort'],
			flightController: [
				'powerIn : ~PowerPort',
				'motorControl : MotorControlPort',
				'navigation : ~NavigationPort',
				'commandLink : ~CommandLinkPort',
				'imageIn : ~ImagePort',
				'releaseControl : ReleaseControlPort'
			],
			gnss: ['navigation : NavigationPort'],
			radio: ['airLink : ~CommandLinkPort', 'controllerLink : CommandLinkPort'],
			camera: ['imageOut : ImagePort'],
			payloadRelease: ['releaseControl : ~ReleaseControlPort']
		};
		// Ports without a direction sit where their connections run.
		expect(node(tk, 'powerDistribution').port_sides).toEqual({
			'powerIn : ~PowerPort': 'left',
			'rotorPower : PowerPort': 'right',
			'avionicsPower : PowerPort': 'right'
		});
		expect(parts.map((n) => n.id).sort()).toEqual(Object.keys(ports).sort());
		for (const n of parts) {
			expect(n.attributes.every(([kind]) => kind === 'port')).toBe(true);
			expect(n.attributes.map(([, text]) => text)).toEqual(ports[n.id]);
		}
		expect(edges(tk, 'connection')).toEqual([
			'battery -connection-> powerDistribution (batteryPower)',
			'powerDistribution -connection-> flightController (avionicsPower)',
			'powerDistribution -connection-> frontLeft (frontLeftPower)',
			'powerDistribution -connection-> frontRight (frontRightPower)',
			'powerDistribution -connection-> rearLeft (rearLeftPower)',
			'powerDistribution -connection-> rearRight (rearRightPower)',
			'radio -connection-> flightController (radioCable)'
		]);
		// The drone's own port, inherited from DeliveryDrone, bound to the radio's.
		expect(node(tk, 'commandLink')).toMatchObject({ kind: 'port' });
		expect(edges(tk, 'binding')).toEqual(['commandLink -binding-> radio']);
		// The item flows, whose ends are feature chains; `rotors`, which nothing connects, is left out.
		expect(ids(tk)).not.toContain('rotors');
		expect(edges(tk, 'flow')).toEqual([
			'camera -flow-> flightController (Image)',
			'flightController -flow-> frontLeft (MotorCommand)',
			'flightController -flow-> frontRight (MotorCommand)',
			'flightController -flow-> payloadRelease (ReleaseCommand)',
			'flightController -flow-> rearLeft (MotorCommand)',
			'flightController -flow-> rearRight (MotorCommand)',
			'gnss -flow-> flightController (PositionFix)'
		]);
	});

	it('names the port at each end of a line, so it is drawn to that port', () => {
		const tk = toolkit('interconnection', 'drone');
		const ends = tk.edges
			.map((e) => `${e.source}.${e.source_port ?? '-'} -> ${e.target}.${e.target_port ?? '-'}`)
			.sort();
		expect(ends).toEqual([
			'battery.powerOut : PowerPort -> powerDistribution.powerIn : ~PowerPort',
			'camera.imageOut : ImagePort -> flightController.imageIn : ~ImagePort',
			'commandLink.- -> radio.airLink : ~CommandLinkPort',
			'flightController.motorControl : MotorControlPort -> frontLeft.control : ~MotorControlPort',
			'flightController.motorControl : MotorControlPort -> frontRight.control : ~MotorControlPort',
			'flightController.motorControl : MotorControlPort -> rearLeft.control : ~MotorControlPort',
			'flightController.motorControl : MotorControlPort -> rearRight.control : ~MotorControlPort',
			'flightController.releaseControl : ReleaseControlPort -> payloadRelease.releaseControl : ~ReleaseControlPort',
			'gnss.navigation : NavigationPort -> flightController.navigation : ~NavigationPort',
			'powerDistribution.avionicsPower : PowerPort -> flightController.powerIn : ~PowerPort',
			'powerDistribution.rotorPower : PowerPort -> frontLeft.powerIn : ~PowerPort',
			'powerDistribution.rotorPower : PowerPort -> frontRight.powerIn : ~PowerPort',
			'powerDistribution.rotorPower : PowerPort -> rearLeft.powerIn : ~PowerPort',
			'powerDistribution.rotorPower : PowerPort -> rearRight.powerIn : ~PowerPort',
			'radio.controllerLink : CommandLinkPort -> flightController.commandLink : ~CommandLinkPort'
		]);
	});

	it('shows ports a part inherits through what it subsets', () => {
		const tk = toolkit('interconnection', 'deliveryService');
		expect(ids(tk)).toEqual(['drone', 'groundStation', 'operator', 'recipient']);
		expect(edges(tk)).toEqual([
			'groundStation -connection-> drone (radioLink)',
			'operator -connection-> groundStation'
		]);
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
	it('draws every transition, labelled', () => {
		const tk = toolkit('states', 'FlightModes');
		expect(ids(tk)).toEqual([
			'__initial__',
			'armed',
			'charging',
			'failsafe',
			'flying',
			'flying.__initial__',
			'flying.cruising',
			'idle',
			'landing',
			'returningHome'
		]);
		expect(tk.edges).toHaveLength(17);
		expect(edges(tk)).toEqual(
			expect.arrayContaining([
				'__initial__ -transition-> idle',
				'idle -transition-> armed (ArmCommand [preflightChecksPassed])',
				'flying -transition-> returningHome (when stateOfCharge < returnThreshold)',
				'charging -transition-> idle (when stateOfCharge >= readyCharge)'
			])
		);
		expect(node(tk, 'failsafe').attributes).toEqual([['entry', 'alertOperator']]);
		expect(toolkit('states', null)).toEqual(tk);
	});
});

describe('action flow view', () => {
	it('draws the whole flow, decisions with their guards', () => {
		const tk = toolkit('actions', 'DeliveryFlight');
		// Ids are names (unnamed control nodes are numbered by kind).
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
	it('draws the requirements with their satisfy, verify and «derive» links', () => {
		const tk = toolkit('requirements', null);
		const requirements = tk.nodes
			.filter((n) => n.kind === 'requirement')
			.map((n) => n.id)
			.sort();
		expect(requirements).toEqual([
			"'Acoustic noise'",
			"'Approved for operation'",
			"'Battery protection'",
			"'Battery thermal protection'",
			"'Command and telemetry link'",
			"'Controlled parcel release'",
			"'Drop-zone clearance check'",
			"'Flight endurance'",
			"'Flying in typical weather'",
			"'Geofencing'",
			"'Hand-over warnings'",
			"'Ingress protection'",
			"'Maximum take-off mass'",
			"'Navigation integrity monitoring'",
			"'Parcel delivery'",
			"'Payload capacity'",
			"'Propeller guards'",
			"'Quiet neighbour'",
			"'Release height interlock'",
			"'Return to home'",
			"'Rotor health monitoring'",
			"'Safe hand-over'",
			"'Safe operation'",
			"'Wind tolerance'",
			'DroneRequirement',
			'EngineeringRequirement',
			'RiskControl'
		]);
		// Satisfiers are named by their path from the design (`drone.battery`).
		expect(edges(tk, 'satisfy')).toContain(
			"drone.battery -satisfy-> 'Battery protection' (<<satisfy>>)"
		);
		const last = (s: string) => s.split(' -')[0]!.split('.').pop() + ' -' + s.split(' -')[1];
		expect(edges(tk, 'satisfy').map(last).sort()).toEqual([
			"battery -satisfy-> 'Battery protection' (<<satisfy>>)",
			"batteryManagementSystem -satisfy-> 'Battery thermal protection' (<<satisfy>>)",
			"drone -satisfy-> 'Flight endurance' (<<satisfy>>)",
			"drone -satisfy-> 'Maximum take-off mass' (<<satisfy>>)",
			"drone -satisfy-> 'Payload capacity' (<<satisfy>>)",
			"dropZoneScan -satisfy-> 'Drop-zone clearance check' (<<satisfy>>)",
			"fitPropellerGuards -satisfy-> 'Propeller guards' (<<satisfy>>)",
			"flightController -satisfy-> 'Geofencing' (<<satisfy>>)",
			"flightController -satisfy-> 'Return to home' (<<satisfy>>)",
			"flightController -satisfy-> 'Wind tolerance' (<<satisfy>>)",
			"navigationIntegrityMonitor -satisfy-> 'Navigation integrity monitoring' (<<satisfy>>)",
			"payloadRelease -satisfy-> 'Controlled parcel release' (<<satisfy>>)",
			"payloadRelease -satisfy-> 'Release height interlock' (<<satisfy>>)",
			"radio -satisfy-> 'Command and telemetry link' (<<satisfy>>)",
			"rotorHealthMonitor -satisfy-> 'Rotor health monitoring' (<<satisfy>>)",
			"warningLabelsAndTone -satisfy-> 'Hand-over warnings' (<<satisfy>>)"
		]);
		expect(edges(tk, 'verify')).toEqual([
			"batteryAbuseTest -verify-> 'Battery protection' (<<verify>>)",
			"batteryAbuseTest -verify-> 'Battery thermal protection' (<<verify>>)",
			"enduranceFlightTest -verify-> 'Flight endurance' (<<verify>>)",
			"failsafeFlightTest -verify-> 'Geofencing' (<<verify>>)",
			"failsafeFlightTest -verify-> 'Return to home' (<<verify>>)",
			"handOverWarningReview -verify-> 'Hand-over warnings' (<<verify>>)",
			"linkRangeTest -verify-> 'Command and telemetry link' (<<verify>>)",
			"massAndPayloadCheck -verify-> 'Maximum take-off mass' (<<verify>>)",
			"massAndPayloadCheck -verify-> 'Payload capacity' (<<verify>>)",
			"propellerGuardInspection -verify-> 'Propeller guards' (<<verify>>)",
			"releaseInterlockTest -verify-> 'Release height interlock' (<<verify>>)",
			"rotorFailureTest -verify-> 'Rotor health monitoring' (<<verify>>)",
			"windHoldTest -verify-> 'Wind tolerance' (<<verify>>)"
		]);
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
		expect(edges(tk, 'satisfy')).toHaveLength(16);
		expect(edges(tk, 'verify')).toHaveLength(13);
	});
});

describe('package view', () => {
	it('draws the packages and their definitions, joined by membership', () => {
		const tk = toolkit('packages', null);
		const names = host
			.analyzeProject(files)
			.flatMap((a) => a.model.definitions)
			.map((d) => d.name)
			.sort();
		expect(ids(tk)).toEqual(names);
		// A frame for each package that has definitions of its own.
		expect(tk.subgraphs.map((s) => s.id).sort()).toEqual([
			'BatteryTrade',
			'DeliveryContext',
			'DeliveryMission',
			'DeliverySequence',
			'DependencyMatrices',
			'DroneArchitecture',
			'DroneComponents',
			'DroneConfigurations',
			'DroneInterfaces',
			'DronePerformance',
			'EngineeringBasics',
			'FlightControl',
			'HazardAnalysis',
			'ModelViews',
			'Reporting',
			'RiskAnalysis',
			'SystemRequirements'
		]);
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
