import { beforeAll, describe, expect, it } from 'vitest';
import { editFiles } from '#lib/engine/toolkit/edit-testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import type { EditStep } from '#lib/workbench/actions.ts';
import { ownersOf, portsOf, resolveNode } from './model.ts';
import {
	defaultChoice,
	partName,
	planEdgeRemoval,
	planRelation,
	relationsFor,
	type ModelContext,
	type Plan
} from './relationships.ts';

let host: ToolkitHost;
let files: Record<string, string>;
let ctx: ModelContext;

function contextFor(texts: Record<string, string>): ModelContext {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	const analyses = host.analyzeProject(list);
	const elements = collectElements(analyses);
	return {
		elements,
		owners: ownersOf(buildTree(elements)),
		textOf: (path) => texts[path],
		analyses
	};
}

/** Apply a plan's steps the way the workbench does (the engine for members and declarations). */
function apply(plan: Plan): Record<string, string> {
	let next = { ...files };
	for (const step of plan.steps as EditStep[]) {
		const source = next[step.path]!;
		if (step.kind === 'patch') {
			expect(source).toBe(step.before);
			next[step.path] = step.after;
			continue;
		}
		const edited = editFiles(
			host,
			next,
			step.kind === 'remove'
				? {
						op: 'remove',
						path: step.path,
						name: step.element.name,
						line: step.element.span.start_row,
						...(step.element.id ? { id: step.element.id } : {})
					}
				: step.kind === 'member'
					? {
							op: 'insertMember',
							path: step.path,
							parent: step.parent.name,
							parentLine: step.parent.span.start_row,
							...(step.parent.id ? { parentId: step.parent.id } : {}),
							text: step.text
						}
					: {
							op: 'setDeclaration',
							path: step.path,
							element: step.element.name,
							line: step.element.span.start_row,
							...(step.element.id ? { id: step.element.id } : {}),
							set: step.set
						}
		);
		if ('error' in edited) throw new Error(edited.error);
		next = edited.files;
	}
	return next;
}

const el = (id: string, isDefinition?: boolean, scope: string | null = null): ModelElement => {
	const e = resolveNode(id, isDefinition, scope, ctx.elements, ctx.owners);
	if (!e) throw new Error(`no element ${id}`);
	return e;
};

beforeAll(async () => {
	host = await loadHost();
	files = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
	ctx = contextFor(files);
}, 60_000);

describe('names', () => {
	it('makes lower-camel, unique part names', () => {
		expect(partName('Battery')).toBe('battery');
		expect(partName('PowerDistributionBoard')).toBe('powerDistributionBoard');
		expect(partName("'Flight controller'")).toBe('flightController');
		expect(partName('DroneComponents::GNSSReceiver')).toBe('gnssReceiver');
		expect(partName('Battery', ['battery', 'battery2'])).toBe('battery3');
	});
});

describe('resolving nodes', () => {
	it('follows dotted paths and the diagram scope', () => {
		const battery = el('drone.battery', false);
		expect(battery.typeRef).toBe('Battery');
		expect(el('battery', false, 'drone').key).toBe(battery.key);
		expect(el('DeliveryDrone', true).isDefinition).toBe(true);
	});

	it('reads ports with their direction from the type', () => {
		const ports = portsOf(el('drone.powerDistribution', false), ctx.elements, ctx.owners, (p) =>
			ctx.textOf(p)
		);
		expect(ports.map((p) => `${p.name}:${p.conjugated ? '~' : ''}${p.type}`)).toEqual([
			'powerIn:~PowerPort',
			'rotorPower:PowerPort',
			'avionicsPower:PowerPort'
		]);
	});
});

describe('which relationships fit', () => {
	const kinds = (a: ModelElement, b: ModelElement) =>
		relationsFor(a, b, ctx).map((o) => `${o.kind}:${o.label}`);

	it('offers composition, connection and allocation between parts', () => {
		expect(kinds(el('drone.battery', false), el('drone.powerDistribution', false))).toEqual([
			'connect:connect',
			'compose:is made of',
			'compose:is part of',
			'allocate:is allocated to'
		]);
	});

	it('offers specialization and composition between part definitions', () => {
		expect(kinds(el('Airframe', true), el('Component', true))).toEqual([
			'compose:is made of',
			'compose:is part of'
		]);
		expect(kinds(el('DeliveryDrone', true), el('Battery', true))).toEqual([
			'specialize:specializes',
			'compose:is made of',
			'compose:is part of'
		]);
	});

	it('offers satisfy and verify against requirements, either way round', () => {
		const req = el("'Ingress protection'", false);
		expect(kinds(el('drone.battery', false), req)).toEqual(['satisfy:satisfies']);
		expect(kinds(req, el('drone.camera', false))).toEqual(['satisfy:is satisfied by']);
		expect(kinds(el('windHoldTest', false), req)).toEqual(['verify:verifies']);
	});

	it('offers nothing for a node and itself, or a package', () => {
		expect(kinds(el('drone', false), el('drone', false))).toEqual([]);
		expect(kinds(el('DroneArchitecture', true), el('Battery', true))).toEqual([]);
	});
});

describe('statements', () => {
	const plan = (from: ModelElement, to: ModelElement, label: string) => {
		const option = relationsFor(from, to, ctx).find((o) => o.label === label)!;
		expect(option).toBeDefined();
		const result = planRelation(option, defaultChoice(option, ctx), ctx);
		if (typeof result === 'string') throw new Error(result);
		return result;
	};

	it('"is made of" adds a typed part to the definition', () => {
		const p = plan(el('DeliveryDrone', true), el('drone.battery', false), 'is made of');
		expect(p.statement).toBe('part battery : Battery;');
		expect(p.label).toBe('Battery is now part of DeliveryDrone');
		const after = apply(p)['system/DroneArchitecture.sysml']!;
		expect(after).toContain('        port commandLink : ~CommandLinkPort;');
		expect(after).toMatch(
			/perform action deliveryFlight : DeliveryFlight;\n\s+part battery : Battery;/
		);
	});

	it('"is made of" adds a part to a usage too', () => {
		const p = plan(el('drone', false), el('Motor', true), 'is made of');
		expect(p.statement).toBe('part motor : Motor;');
		expect(p.steps[0]!.kind).toBe('member');
		const after = apply(p)['system/DroneArchitecture.sysml']!;
		expect(after).toContain(
			'attribute :>> endurance = HoverEndurance(battery.usableEnergy, hoverPower);\n        part motor : Motor;\n    }'
		);
	});

	it('satisfy is written beside the other satisfy statements', () => {
		const p = plan(el('drone.camera', false), el("'Ingress protection'", false), 'satisfies');
		expect(p.statement).toBe("satisfy 'Ingress protection' by drone.camera;");
		expect(p.label).toBe('camera now satisfies Ingress protection');
		const after = apply(p)['system/Satisfaction.sysml']!;
		expect(after).toContain(
			"    satisfy 'Controlled parcel release' by drone.payloadRelease;\n    satisfy 'Ingress protection' by drone.camera;"
		);
	});

	it('verify goes into the objective of the verification', () => {
		const p = plan(el('windHoldTest', false), el("'Ingress protection'", false), 'verifies');
		expect(p.statement).toBe("verify 'Ingress protection';");
		const after = apply(p)['verification/VerificationPlan.sysml']!;
		expect(after).toContain("objective { verify 'Wind tolerance'; verify 'Ingress protection'; }");
	});

	it('allocate joins the allocation package, with paths', () => {
		const p = plan(el('drone.camera', false), el('drone.gnss', false), 'is allocated to');
		expect(p.statement).toBe('allocate drone.camera to drone.gnss;');
		expect(apply(p)['behaviour/Allocation.sysml']).toContain(
			'allocate drone.camera to drone.gnss;'
		);
	});

	it('connect picks matching ports and an interface definition', () => {
		const from = el('drone.battery', false);
		const to = el('drone.rotors', false);
		const option = relationsFor(from, to, ctx).find((o) => o.kind === 'connect')!;
		const choice = defaultChoice(option, ctx);
		expect(choice).toEqual({
			fromPort: 'powerOut',
			toPort: 'powerIn',
			interfaceDef: 'PowerSupply'
		});
		const p = planRelation(option, choice, ctx) as Plan;
		expect(p.statement).toBe('interface : PowerSupply connect battery.powerOut to rotors.powerIn;');
		const after = apply(p)['system/DroneArchitecture.sysml']!;
		expect(after).toContain(
			'        interface : PowerSupply connect battery.powerOut to rotors.powerIn;\n    }'
		);
		const plain = planRelation(option, { ...choice, interfaceDef: '' }, ctx) as Plan;
		expect(plain.statement).toBe('connect battery.powerOut to rotors.powerIn;');
	});

	it('connect orders the ends as the interface definition does', () => {
		const option = relationsFor(el('drone.rotors', false), el('drone.battery', false), ctx).find(
			(o) => o.kind === 'connect'
		)!;
		const p = planRelation(option, defaultChoice(option, ctx), ctx) as Plan;
		expect(p.statement).toBe('interface : PowerSupply connect battery.powerOut to rotors.powerIn;');
	});

	it('specializes adds :> to the declaration', () => {
		const p = plan(el('DeliveryDrone', true), el('Battery', true), 'specializes');
		expect(p.label).toBe('DeliveryDrone now specializes Battery');
		expect(apply(p)['system/DroneArchitecture.sysml']).toContain(
			'part def DeliveryDrone :> Battery {'
		);
	});
});

describe('removing a drawn relationship', () => {
	const remove = (...args: Parameters<typeof planEdgeRemoval>) => {
		const result = planEdgeRemoval(...args);
		if (typeof result === 'string') throw new Error(result);
		return apply(result);
	};

	it('removes a satisfy statement', () => {
		const after = remove(
			'satisfy',
			'<<satisfy>>',
			el('battery', false),
			el("'Battery protection'", false),
			ctx
		)['system/Satisfaction.sysml']!;
		expect(after).not.toContain("satisfy 'Battery protection'");
		expect(after).toContain("satisfy 'Command and telemetry link' by drone.radio;");
	});

	it('removes a verify from an objective', () => {
		const after = remove(
			'verify',
			'<<verify>>',
			el('failsafeFlightTest', false),
			el("'Geofencing'", false),
			ctx
		)['verification/VerificationPlan.sysml']!;
		expect(after).toContain("objective {\n            verify 'Return to home';\n        }");
	});

	it('removes a named interface connection', () => {
		const after = remove(
			'connection',
			'batteryPower',
			el('battery', false, 'drone'),
			el('powerDistribution', false, 'drone'),
			ctx
		)['system/DroneArchitecture.sysml']!;
		expect(after).not.toContain('batteryPower');
		expect(after).toContain('interface rotorPower');
	});

	it('removes a specialization and a composed part', () => {
		expect(
			remove('specialization', null, el('Airframe', true), el('Component', true), ctx)[
				'system/Components.sysml'
			]
		).toContain('part def Airframe {');
		expect(
			remove('composition', 'esc', el('Rotor', true), el('SpeedController', true), ctx)[
				'system/Components.sysml'
			]
		).not.toContain('part esc');
	});

	it('removes an allocation', () => {
		const after = remove('allocate', null, el('checkDropZone', false), el('camera', false), ctx)[
			'behaviour/Allocation.sysml'
		]!;
		expect(after).not.toContain('checkDropZone');
	});

	it('explains lines that are not a statement', () => {
		expect(planEdgeRemoval('flow', null, el('drone', false), el('drone', false), ctx)).toMatch(
			/comes from the text/
		);
	});
});
