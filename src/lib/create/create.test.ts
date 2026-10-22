/**
 * The guided forms' plans, applied to a new project on the real toolkit as
 * the app applies them (engine edits, one undoable step): each writes SysML
 * with no new problems, and the result evaluates — views render, roll-ups
 * add up, limits are checked, trade studies rank.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { presentationOf } from '#lib/workbench/views.ts';
import { starterProject } from '#lib/project/templates/blank.ts';
import type { ProjectFile, Workspace } from '#lib/project/workspace.svelte.ts';
import { write } from './apply';
import { qualifiedName } from './model';
import {
	commonKind,
	librariesWrite,
	partsOf,
	planLimit,
	planRollup,
	planTrade,
	planView,
	requirementsPackage,
	sharedCriteria
} from './plans';
import { analysed, hostEngine, openWorkspace, problemsOf } from './testing';
import { VIEW_KINDS, viewKind, type Target } from './view';
import { limitStatement, limitTitle, nextRequirementId } from './limit';
import { guessBetter, rangeOf } from './trade';
import { convert } from '#lib/engine/quantity.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

/** A new project, as the app makes it, with a small design added to its model. */
function rover(design = ''): ProjectFile[] {
	const { files } = starterProject('Rover', 'A planetary rover.', host.viewLibraries());
	return files.map((f) =>
		f.path === 'model/Rover.sysml' && design
			? { ...f, text: f.text.replace('    part system : System;\n', design) }
			: f
	);
}

const DESIGN = `    part def Wheel {
        attribute mass :> ISQ::mass = 2 [kg];
        attribute price : Real = 40.0;
    }
    part def Body {
        attribute mass :> ISQ::mass = 20 [kg];
    }
    part def Motor {
        attribute mass :> ISQ::mass;
        attribute price : Real;
        attribute power :> ISQ::power;
    }
    part def SmallMotor :> Motor {
        attribute :>> mass = 1.2 [kg];
        attribute :>> price = 100.0;
        attribute :>> power = 300 [W];
    }
    part def BigMotor :> Motor {
        attribute :>> mass = 2 [kg];
        attribute :>> price = 180.0;
        attribute :>> power = 500 [W];
    }
    part def Camera {
        attribute resolution : Real = 12.0;
    }

    part system : System {
        part body : Body;
        part wheels : Wheel[4];
        part motor : Motor {
            attribute :>> mass = 1500 [g];
            attribute :>> price = 150.0;
            attribute :>> power = 400 [W];
        }
        part camera : Camera;
        part spareWheel : Wheel[0..1];
    }

    part spare : Motor {
        attribute :>> mass = 1.4 [kg];
        attribute :>> price = 90.0;
        attribute :>> power = 350 [W];
    }
`;

function element(workspace: Workspace, name: string, parent?: string) {
	const found = workspace.elements.find(
		(e) =>
			e.name === name &&
			e.kind !== 'subject' &&
			(parent === undefined || e.parent === parent) &&
			!e.file.startsWith('libraries/')
	);
	if (!found) throw new Error(`no ${name}`);
	return found;
}

const target = (workspace: Workspace, name: string, parent?: string): Target => {
	const e = element(workspace, name, parent);
	return {
		qualifiedName: qualifiedName(workspace.tree, e.key),
		kind: e.kind,
		isDefinition: e.isDefinition
	};
};

async function features(workspace: Workspace, ids: string[]) {
	return hostEngine(host).elementFeatures(workspace.sourceFiles(), ids);
}

describe('a new view', { timeout: 30_000 }, () => {
	it('of every kind parses, is listed as what it is, and opens', async () => {
		const workspace = await openWorkspace(host, rover(DESIGN));
		expect(problemsOf(workspace)).toEqual([]);
		const choose: Record<string, Target[]> = {
			requirements: [target(workspace, 'Rover')],
			gaps: [target(workspace, 'Rover')],
			bom: [target(workspace, 'system')],
			interfaces: [target(workspace, 'system')],
			trace: [],
			verification: [],
			general: [target(workspace, 'system')],
			interconnection: [target(workspace, 'system')],
			states: [],
			actions: [],
			sequence: [],
			budget: [target(workspace, 'system')],
			checks: [],
			specification: [target(workspace, 'Rover')],
			icd: [target(workspace, 'system')]
		};
		const made: string[] = [];
		for (const kind of VIEW_KINDS) {
			if (['states', 'actions', 'sequence'].includes(kind.id)) continue; // nothing to draw yet
			const plan = planView(workspace, {
				kind,
				title: `My ${kind.title}`,
				doc: `A ${kind.label.toLowerCase()}.`,
				targets: choose[kind.id]!,
				...(kind.budget ? { budgetOf: 'mass' } : {})
			});
			const error = await analysed(workspace, () => write(workspace, plan.label, plan.write));
			expect(error, kind.id).toBeNull();
			made.push(plan.open!.name);
		}
		expect(problemsOf(workspace)).toEqual([]);
		const views = new Map(workspace.views.map((v) => [v.name, v]));
		const shown = made.map((n) => {
			const v = views.get(n);
			return [n, v ? presentationOf(v) : null];
		});
		expect(shown).toEqual([
			['myRequirements', { kind: 'table' }],
			['myRequirementGaps', { kind: 'table' }],
			['myBillOfMaterials', { kind: 'table' }],
			['myInterfaces', { kind: 'table' }],
			['myTraceMatrix', { kind: 'table' }],
			['myVerificationMatrix', { kind: 'table' }],
			['myStructure', { kind: 'diagram', view: 'general', scope: 'RoverViews::myStructure' }],
			['myConnections', { kind: 'diagram', view: 'interconnection', scope: 'system' }],
			['myBudget', { kind: 'table' }],
			['myDesignChecks', { kind: 'table' }],
			['mySpecification', { kind: 'none' }],
			['myInterfaceControlDocument', { kind: 'none' }]
		]);
		// The views were written next to the starter's, as the demo writes them.
		const text = workspace.text('views/Views.sysml')!;
		expect(text).toContain(
			'    view myBillOfMaterials : BillOfMaterials {\n        doc /* A bill of materials. */\n        expose Rover::system::**;\n    }'
		);
		expect(text).toContain('expose Rover::*;');
		const engine = hostEngine(host);
		const bom = await engine.renderView(workspace.sourceFiles(), 'myBillOfMaterials');
		expect(bom.rows.map((r) => r[0])).toEqual([
			'system',
			'system.body',
			'system.camera',
			'system.motor',
			'system.spareWheel',
			'system.wheels'
		]);
		const budget = await engine.renderView(workspace.sourceFiles(), 'myBudget');
		expect(budget.rows[0]?.slice(0, 1)).toEqual(['system']);
		// Undo takes the last one away again.
		expect(workspace.undo()).toBe('Created the view My interface control document');
		expect(workspace.text('views/Views.sysml')).not.toContain('myInterfaceControlDocument');
	});

	it('of a table can choose its columns, and a budget of any value', async () => {
		const workspace = await openWorkspace(host, rover(DESIGN));
		const table = planView(workspace, {
			kind: viewKind('requirements')!,
			title: 'Short list',
			doc: '',
			targets: [],
			columns: ['id', 'title', 'status']
		});
		const cost = planView(workspace, {
			kind: viewKind('budget')!,
			title: 'Price budget',
			doc: '',
			targets: [target(workspace, 'system')],
			budgetOf: 'price'
		});
		expect(cost.preview).toContain('@TableRendering { rows = "budget:price";');
		await analysed(workspace, async () => {
			expect(await write(workspace, table.label, table.write)).toBeNull();
			expect(await write(workspace, cost.label, cost.write)).toBeNull();
		});
		expect(problemsOf(workspace)).toEqual([]);
		const engine = hostEngine(host);
		const list = await engine.renderView(workspace.sourceFiles(), 'shortList');
		expect(list.columns).toEqual(['id', 'title', 'status']);
		const prices = await engine.renderView(workspace.sourceFiles(), 'priceBudget');
		const row = (path: string) => prices.rows.find((r) => r[0] === path);
		// 4 wheels at 40 and a 150 motor (the camera and body have no price).
		expect(row('system')?.[4]).toBe('310');
		expect(row('system.wheels')?.slice(2, 5)).toEqual(['4', '40', '160']);
	});

	it('in a project without saved views makes the views file, with the libraries', async () => {
		const files = rover(DESIGN).filter(
			(f) => !f.path.startsWith('views/') && !f.path.startsWith('libraries/')
		);
		const workspace = await openWorkspace(host, files);
		const engine = hostEngine(host);
		const libraries = await librariesWrite(workspace, engine);
		expect(libraries.files?.map((f) => f.path)).toEqual([
			'libraries/Reporting.sysml',
			'libraries/ModelViews.sysml'
		]);
		const plan = planView(
			workspace,
			{
				kind: viewKind('general')!,
				title: 'Overview',
				doc: '',
				targets: [target(workspace, 'Rover')]
			},
			libraries
		);
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(workspace.text('views/Views.sysml')).toBe(
			'package RoverViews {\n    doc /* Saved views: tables and diagrams that are part of the model. */\n\n    private import StandardViewDefinitions::*;\n\n    view overview : GeneralView {\n        expose Rover::*;\n    }\n}\n'
		);
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.views.find((v) => v.name === 'overview')?.builtin).toBe(false);
		workspace.undo();
		expect(workspace.paths.filter((p) => p.endsWith('.sysml'))).toEqual(['model/Rover.sysml']);
	});
});

describe('adding up a value', { timeout: 30_000 }, () => {
	it('sums the parts that have it, counting a fixed number of parts, and makes a budget', async () => {
		const workspace = await openWorkspace(host, rover(DESIGN));
		const engine = hostEngine(host);
		const system = element(workspace, 'system');
		const { [system.id!]: f } = await features(workspace, [system.id!]);
		const parts = partsOf(f!);
		const children = await features(
			workspace,
			parts.map((p) => p.id)
		);
		const plan = planRollup(workspace, {
			element: system,
			features: f!,
			attribute: f!.features.find((x) => x.name === 'mass')!,
			each: 'mass',
			parts: parts.map((p) => ({ feature: p, features: children[p.id] })),
			budget: { title: 'System mass budget' }
		});
		expect(plan.rollup.terms.map((t) => t.text)).toEqual([
			'body.mass',
			'sum(wheels.mass)',
			'motor.mass'
		]);
		expect(plan.rollup.left).toEqual([
			{ part: 'camera', why: 'it has no mass' },
			{ part: 'spareWheel', why: 'how many there are isn’t fixed ([0..1])' }
		]);
		expect(plan.preview).toContain(
			'attribute :>> mass = body.mass + sum(wheels.mass) + motor.mass;'
		);
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const model = workspace.text('model/Rover.sysml')!;
		expect(model).toContain('    private import NumericalFunctions::sum;\n');
		expect(model).toContain(
			'        part spareWheel : Wheel[0..1];\n        attribute :>> mass = body.mass + sum(wheels.mass) + motor.mass;\n    }'
		);
		const mass = workspace.elements.find((e) => e.name === 'mass' && e.parent === 'system')!;
		const value = (await engine.evaluate(workspace.sourceFiles(), [mass.id!]))[mass.id!];
		// 20 kg + 4 × 2 kg + 1.5 kg.
		expect(value).toMatchObject({ kind: 'number', value: 29.5, unit: 'kg' });
		const budget = await engine.renderView(workspace.sourceFiles(), 'systemMassBudget');
		expect(budget.columns.slice(0, 5)).toEqual(['path', 'type', 'quantity', 'each', 'total']);
		expect(budget.rows[0]?.slice(0, 5)).toEqual(['system', 'System', '1', '29.5 kg', '29.5 kg']);
		expect(plan.open?.name).toBe('systemMassBudget');
	});

	it('gives an attribute it declares itself the sum as its value', async () => {
		const design = DESIGN.replace(
			'    part system : System {',
			'    part def Rig {\n        attribute mass :> ISQ::mass;\n        part left : Wheel;\n        part right : Wheel;\n        part rotors : Wheel[2] = (left, right);\n    }\n\n    part system : System {'
		);
		const workspace = await openWorkspace(host, rover(design));
		expect(problemsOf(workspace)).toEqual([]);
		const rig = element(workspace, 'Rig');
		const { [rig.id!]: f } = await features(workspace, [rig.id!]);
		const parts = partsOf(f!);
		const children = await features(
			workspace,
			parts.map((p) => p.id)
		);
		const plan = planRollup(workspace, {
			element: rig,
			features: f!,
			attribute: f!.features.find((x) => x.name === 'mass')!,
			each: 'mass',
			parts: parts.map((p) => ({ feature: p, features: children[p.id] })),
			budget: null
		});
		expect(plan.rollup.left).toEqual([
			{ part: 'rotors', why: 'its parts (left, right) are counted already' }
		]);
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(workspace.text('model/Rover.sysml')).toContain(
			'attribute mass :> ISQ::mass = left.mass + right.mass;'
		);
		expect(problemsOf(workspace)).toEqual([]);
		const mass = workspace.elements.find((e) => e.name === 'mass' && e.parent === 'Rig')!;
		const value = (await hostEngine(host).evaluate(workspace.sourceFiles(), [mass.id!]))[mass.id!];
		expect(value).toMatchObject({ kind: 'number', value: 4, unit: 'kg' });
	});

	it('adds a collection bound to named parts with collect, as the demo does', async () => {
		const design = DESIGN.replace(
			'    part system : System {',
			'    part def Pair {\n        attribute mass :> ISQ::mass;\n    }\n    part rig : Pair {\n        part carrier {\n            part a : Wheel;\n            part b : Wheel;\n        }\n        part wheels : Wheel[2] = (carrier.a, carrier.b);\n    }\n\n    part system : System {'
		);
		const workspace = await openWorkspace(host, rover(design));
		expect(problemsOf(workspace)).toEqual([]);
		const rig = element(workspace, 'rig');
		const { [rig.id!]: f } = await features(workspace, [rig.id!]);
		const parts = partsOf(f!);
		const children = await features(
			workspace,
			parts.map((p) => p.id)
		);
		const plan = planRollup(workspace, {
			element: rig,
			features: f!,
			attribute: f!.features.find((x) => x.name === 'mass')!,
			each: 'mass',
			parts: parts.map((p) => ({ feature: p, features: children[p.id] })),
			budget: null
		});
		expect(plan.rollup.terms.map((t) => t.text)).toEqual([
			'sum(wheels->collect { in p : Wheel; p.mass })'
		]);
		expect(plan.rollup.left).toEqual([{ part: 'carrier', why: 'it has no mass' }]);
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const text = workspace.text('model/Rover.sysml')!;
		expect(text).toContain('private import ControlFunctions::collect;');
		const mass = workspace.elements.find((e) => e.name === 'mass' && e.parent === 'rig')!;
		const value = (await hostEngine(host).evaluate(workspace.sourceFiles(), [mass.id!]))[mass.id!];
		// Decided by the toolkit itself: each of the two wheels' 2 kg.
		expect(value).toEqual({ kind: 'number', value: 4, unit: 'kg' });
	});
});

describe('setting a limit', { timeout: 30_000 }, () => {
	it('on a requirement writes a checked constraint whose verdict follows the value', async () => {
		const design = DESIGN.replace(
			'        part camera : Camera;\n',
			'        part camera : Camera;\n        attribute :>> mass = 29.5 [kg];\n'
		);
		const workspace = await openWorkspace(host, rover(design));
		const req = element(workspace, "'First requirement'");
		const { [req.id!]: f } = await features(workspace, [req.id!]);
		const subject = f!.features.find((x) => x.kind === 'subject')!;
		expect(subject).toMatchObject({ name: 'system', type: 'Rover::System' });
		const plan = planLimit(workspace, {
			attribute: 'mass',
			limit: { kind: 'atMost', value: 30, unit: 'kg' },
			requirement: { element: req, features: f! },
			subject: { name: subject.name, type: subject.type!, add: false }
		});
		expect(plan.preview).toContain('require constraint { system.mass <= 30 [kg] }');
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const check = () => workspace.checks!.checks.find((c) => c.requirement?.id === 'REQ-001')!;
		expect(check()).toMatchObject({ status: 'satisfied', limit: { value: 30, unit: 'kg' } });
		// Heavier wheels break it.
		await analysed(workspace, () =>
			workspace.setText(
				'model/Rover.sysml',
				workspace
					.text('model/Rover.sysml')!
					.replace('attribute :>> mass = 29.5 [kg];', 'attribute :>> mass = 31 [kg];')
			)
		);
		expect(check().status).toBe('violated');
		expect(check().margin).toMatchObject({ value: -1, unit: 'kg' });
	});

	it('between two numbers writes two constraints', async () => {
		const workspace = await openWorkspace(host, rover(DESIGN));
		const req = element(workspace, "'First requirement'");
		const { [req.id!]: f } = await features(workspace, [req.id!]);
		const plan = planLimit(workspace, {
			attribute: 'mass',
			limit: { kind: 'between', low: 10, value: 40, unit: 'kg' },
			requirement: { element: req, features: f! },
			subject: { name: 'system', type: 'Rover::System', add: false }
		});
		expect(plan.write.members?.map((m) => m.text)).toEqual([
			'require constraint { system.mass >= 10 [kg] }',
			'require constraint { system.mass <= 40 [kg] }'
		]);
	});

	it('from a value makes a requirement with its subject and a satisfy link', async () => {
		const workspace = await openWorkspace(host, rover(DESIGN));
		const motor = element(workspace, 'motor', 'system');
		const { [motor.id!]: f } = await features(workspace, [motor.id!]);
		const power = f!.features.find((x) => x.name === 'power')!;
		expect(power).toMatchObject({
			numeric: true,
			valueType: 'PowerValue',
			declaredIn: 'Rover::Motor'
		});
		const limit = { kind: 'atLeast' as const, value: 350, unit: 'W' };
		const pkg = requirementsPackage(workspace)!;
		expect(pkg.name).toBe('Rover');
		const id = nextRequirementId(workspace.requirements.map((r) => r.id));
		expect(id).toBe('REQ-002');
		const plan = planLimit(workspace, {
			attribute: 'power',
			limit,
			subject: { name: 'motor', type: f!.kinds[0]!, add: true },
			satisfyBy: f!,
			create: {
				id,
				title: limitTitle('power', limit),
				statement: limitStatement('motor', 'power', limit),
				pkg
			}
		});
		expect(plan.write.members?.map((m) => m.text)).toEqual([
			"requirement <'REQ-002'> 'Minimum power' {\n    doc /* The motor's power shall be at least 350 W. */\n    subject motor : Motor;\n    require constraint { motor.power >= 350 [W] }\n}",
			"satisfy 'Minimum power' by system.motor;"
		]);
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const check = workspace.checks!.checks.find((c) => c.requirement?.id === 'REQ-002');
		expect(check).toMatchObject({ status: 'satisfied', by: 'system.motor' });
		expect(workspace.requirements.find((r) => r.id === 'REQ-002')?.satisfiedBy).toEqual([
			'system.motor'
		]);
	});

	it('on a value the part declares itself subsets the part, so the value resolves', async () => {
		const design = DESIGN.replace(
			'        part camera : Camera;\n',
			'        part camera : Camera;\n        attribute cost : Real = 12.0;\n'
		);
		const workspace = await openWorkspace(host, rover(design));
		const system = element(workspace, 'system');
		const { [system.id!]: f } = await features(workspace, [system.id!]);
		const cost = f!.features.find((x) => x.name === 'cost')!;
		expect(cost.declaredIn).toBe('Rover::system');
		const limit = { kind: 'atMost' as const, value: 10, unit: null };
		const plan = planLimit(workspace, {
			attribute: 'cost',
			limit,
			subject: { name: 'system', type: f!.qualifiedName, subsets: true, add: true },
			satisfyBy: f!,
			create: {
				id: 'REQ-002',
				title: limitTitle('cost', limit),
				statement: limitStatement('system', 'cost', limit),
				pkg: requirementsPackage(workspace)!
			}
		});
		expect(plan.write.members?.[0]?.text).toContain('subject system :> system;');
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.checks!.checks.find((c) => c.requirement?.id === 'REQ-002')).toMatchObject({
			status: 'violated'
		});
	});
});

describe('a new trade study', { timeout: 30_000 }, () => {
	it('compares parts and part defs on weighted criteria, ranked as the engine reads it', async () => {
		const workspace = await openWorkspace(host, rover(DESIGN));
		const ids = [
			element(workspace, 'motor', 'system').id!,
			element(workspace, 'spare').id!,
			element(workspace, 'SmallMotor').id!,
			element(workspace, 'BigMotor').id!
		];
		const all = await features(workspace, ids);
		const alternatives = ids.map((id) => all[id]!);
		expect(commonKind(alternatives)).toBe('Rover::Motor');
		const shared = sharedCriteria(alternatives);
		expect(shared.map((c) => c.name)).toEqual(['mass', 'price', 'power']);
		const valuesOf = (name: string, unit: string | null) =>
			alternatives.map((a) => {
				const v = a.features.find((f) => f.name === name)!.evaluated;
				if (v?.kind !== 'number') return null;
				return unit && v.unit ? convert(v.value, v.unit, unit) : v.value;
			});
		const criterion = (name: string, unit: string | null, weight: number) => {
			const better = guessBetter(name);
			const range = rangeOf(valuesOf(name, unit), better)!;
			const valueType = shared.find((s) => s.name === name)!.valueType;
			return { attribute: name, valueType, better, weight, ...range, unit, cutoff: null };
		};
		expect(guessBetter('mass')).toBe('lower');
		expect(guessBetter('power')).toBe('lower');
		const criteria = [
			criterion('mass', 'kg', 30),
			criterion('price', null, 30),
			{ ...criterion('power', 'W', 40), better: 'higher' as const, worst: 300, best: 500 }
		];
		criteria[1]!.cutoff = { kind: 'atMost', value: 170, unit: null } as never;
		const plan = planTrade(workspace, {
			title: 'Motor choice',
			question: 'Which motor should the rover use?',
			alternatives,
			kind: 'Rover::Motor',
			criteria
		});
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.text('analysis/MotorChoice.sysml')).toMatchSnapshot();
		const [study] = await hostEngine(host).tradeStudies(workspace.sourceFiles());
		expect(study).toMatchObject({ name: 'motorChoiceStudy', objective: 'maximize', note: null });
		expect(study!.alternatives.map((a) => [a.name, a.rank])).toEqual([
			['system.motor', 3],
			['spare', 1],
			['smallMotor', 2],
			['bigMotor', 4]
		]);
		expect(
			study!.alternatives.map((a) =>
				a.score.kind === 'number' ? Number(a.score.value.toFixed(4)) : null
			)
		).toEqual([0.4875, 0.625, 0.5667, 0]);
		expect(study!.criteria.map((c) => [c.name, c.weight, c.better])).toEqual([
			['mass', 0.3, 'lower'],
			['price', 0.3, 'lower'],
			['power', 0.4, 'higher']
		]);
		expect(study!.selected).toBe(1);
		const table = await hostEngine(host).renderView(workspace.sourceFiles(), plan.open!.name);
		expect(table.trade?.qualifiedName).toBe('MotorChoice::motorChoiceStudy');
		expect(workspace.undo()).toBe('Created the trade study Motor choice');
		expect(workspace.text('analysis/MotorChoice.sysml')).toBeUndefined();
	});
});

describe('values the forms rely on', { timeout: 30_000 }, () => {
	it('a quantity without a type of its own is edited as a number with its unit', async () => {
		const workspace = await openWorkspace(host, rover());
		const system = element(workspace, 'system');
		const [mass] = await hostEngine(host).featureValues(workspace.sourceFiles(), system.id!);
		expect(mass).toMatchObject({ name: 'mass', edit: { field: 'feature:mass', kind: 'number' } });
		const error = await analysed(workspace, async () => {
			const { setField } = await import('#lib/workbench/actions.ts');
			return setField(
				workspace,
				{ element: system.name, file: system.file, line: system.span.start_row, id: system.id! },
				'feature:mass',
				'30 [kg]',
				'Set mass of system'
			);
		});
		expect(error).toBeNull();
		expect(workspace.text('model/Rover.sysml')).toContain(':>> mass = 30 [kg];');
	});
});
