/**
 * New DSM's plans: the view each kind writes (pinned), what the form says
 * is wrong, and the plan applied as the app applies it to a new Small
 * system project, which gets the library with its first matrix and to the
 * demo, which has it: each checks clean and reads as a matrix.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { flashlightProject } from '#lib/project/templates/flashlight.ts';
import { write } from './apply';
import { flatten } from './model';
import {
	DSM_KINDS,
	DSM_LIBRARY,
	canCompare,
	dsmExpose,
	dsmKind,
	dsmLibraryWrite,
	dsmProblem,
	dsmTitle,
	dsmViewText,
	planDsm,
	type DsmTarget
} from './dsm';
import { analysed, hostEngine, openWorkspace, problemsOf } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const parts = dsmKind('parts')!;
const flashlight: DsmTarget = {
	qualifiedName: 'Flashlight::flashlight',
	label: 'flashlight',
	kind: 'part',
	isDefinition: false
};

describe('the generators', () => {
	it('each kind is told in plain words, with its library view def', () => {
		for (const k of DSM_KINDS) {
			expect(k.description.length, k.id).toBeGreaterThan(30);
			expect(k.description, k.id).not.toMatch(/usage|expose|metadata|feature/i);
			expect(DSM_LIBRARY.text).toContain(`view def ${k.definition}`);
			expect(k.available).toEqual(expect.arrayContaining(k.kinds));
		}
	});

	it('writes a view of the library’s def, with only the settings that differ', () => {
		expect(
			dsmViewText({
				kind: parts,
				title: 'Flashlight DSM',
				targets: [flashlight],
				kinds: ['connection', 'flow', 'binding'],
				order: 'model'
			})
		).toMatchSnapshot();
		expect(
			dsmViewText({
				kind: dsmKind('n2')!,
				title: 'Flashlight N2',
				doc: 'What passes between the parts.',
				targets: [flashlight],
				deeper: true,
				kinds: ['flow', 'connection', 'allocation'],
				order: 'clustered'
			})
		).toMatchSnapshot();
		expect(
			dsmViewText({
				kind: dsmKind('requirements')!,
				title: 'Requirement DSM',
				targets: [
					{
						qualifiedName: 'Needs',
						label: 'Needs',
						kind: 'package',
						isDefinition: false
					},
					{
						qualifiedName: "Needs::'Run time'",
						label: 'Run time',
						kind: 'requirement',
						isDefinition: false
					}
				],
				kinds: ['derivation', 'refinement'],
				order: 'model'
			})
		).toMatchSnapshot();
	});

	it('exposes a part’s parts, a level deeper, or a requirement itself', () => {
		expect(dsmExpose({}, flashlight)).toBe('Flashlight::flashlight::*');
		expect(dsmExpose({ deeper: true }, flashlight)).toBe('Flashlight::flashlight::**');
		expect(
			dsmExpose({ deeper: true }, { ...flashlight, qualifiedName: 'Parts', kind: 'package' })
		).toBe('Parts::*');
	});

	it('offers what each kind compares', () => {
		expect(canCompare(parts, { kind: 'part', isDefinition: false })).toBe(true);
		expect(canCompare(parts, { kind: 'package', isDefinition: false })).toBe(true);
		expect(canCompare(dsmKind('n2')!, { kind: 'package', isDefinition: false })).toBe(false);
		expect(canCompare(dsmKind('actions')!, { kind: 'action', isDefinition: true })).toBe(true);
		expect(canCompare(dsmKind('requirements')!, { kind: 'requirement', isDefinition: true })).toBe(
			false
		);
	});

	it('names it after what it compares, and says what is missing', () => {
		expect(dsmTitle(parts, [flashlight])).toBe('Flashlight DSM');
		expect(dsmTitle(dsmKind('n2')!, [flashlight])).toBe('Flashlight N2');
		expect(dsmTitle(dsmKind('requirements')!, [])).toBe('Requirement DSM');
		const taken = new Set(['flashlightDSM']);
		const base = { kind: parts, title: 'Torch DSM', targets: [flashlight], taken };
		expect(dsmProblem({ ...base, kinds: ['connection'] })).toBeNull();
		expect(dsmProblem({ ...base, kinds: [] })).toBe('Choose at least one kind of link to count.');
		expect(dsmProblem({ ...base, targets: [], kinds: ['connection'] })).toBe(
			'Choose whose parts to compare.'
		);
		expect(dsmProblem({ ...base, title: 'Flashlight DSM', kinds: ['connection'] })).toMatch(
			/already a view called “Flashlight DSM”/
		);
		expect(dsmProblem({ ...base, kind: undefined, kinds: ['connection'] })).toBe(
			'Choose what kind of matrix to make.'
		);
	});
});

describe('applied', () => {
	it('on a Small system project: the library comes with the first matrix, which checks clean', async () => {
		const { files } = flashlightProject('Flashlight', '', host.viewLibraries());
		const workspace = await openWorkspace(host, files);
		expect(problemsOf(workspace)).toEqual([]);
		expect(dsmLibraryWrite(workspace).files?.map((f) => f.path)).toEqual([DSM_LIBRARY.path]);
		const design = flatten(workspace.tree).find(
			(n) => n.node.element.name === 'flashlight' && n.node.element.kind === 'part'
		)!;
		const plan = planDsm(
			workspace,
			{
				kind: parts,
				title: 'Flashlight DSM',
				targets: [{ ...flashlight, qualifiedName: design.qualifiedName }],
				kinds: ['connection', 'flow'],
				order: 'clustered'
			},
			dsmLibraryWrite(workspace)
		);
		expect(plan.preview).toMatchSnapshot();
		const error = await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(error).toBeNull();
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.text(DSM_LIBRARY.path)).toBe(DSM_LIBRARY.text);
		expect(dsmLibraryWrite(workspace)).toEqual({});
		const info = workspace.views.find((v) => v.name === 'flashlightDSM');
		expect(info?.matrix).toBe('parts');
		const m = await hostEngine(host).dependencyMatrix(workspace.sourceFiles(), 'flashlightDSM');
		expect(m.items.map((i) => i.name)).toEqual(['battery', 'switch', 'led', 'housing']);
		expect(m).toMatchObject({ order: 'clustered', kinds: ['connection', 'flow'] });
		// One undoable step: the library and the view go together.
		workspace.undo();
		expect(workspace.text(DSM_LIBRARY.path)).toBeUndefined();
	});

	it('on the demo: a functional DSM of the delivery flight, next to its views', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		expect(dsmLibraryWrite(workspace)).toEqual({});
		const plan = planDsm(workspace, {
			kind: dsmKind('actions')!,
			title: 'Flight steps',
			targets: [
				{
					qualifiedName: 'DeliveryMission::DeliveryFlight',
					label: 'DeliveryFlight',
					kind: 'action',
					isDefinition: true
				}
			],
			kinds: ['succession'],
			order: 'model'
		});
		const error = await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(error).toBeNull();
		expect(problemsOf(workspace).filter((p) => p.startsWith('views/'))).toEqual([]);
		expect(workspace.text('views/Views.sysml')).toContain(
			'    view flightSteps : FunctionalDsm {\n        expose DeliveryMission::DeliveryFlight::*;\n        @MatrixRendering { dependencies = "succession"; }\n    }'
		);
		const m = await hostEngine(host).dependencyMatrix(workspace.sourceFiles(), 'flightSteps');
		expect(m.kinds).toEqual(['succession']);
		expect(m.items).toHaveLength(8);
	});
});
