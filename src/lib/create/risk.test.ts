/**
 * The risk forms' plans, applied as the app applies them (engine edits,
 * one undoable step) to a new "Small system" project, which gets the risk
 * libraries with its first FMEA, and to the demo, which has them: a sheet
 * of each kind of FMEA with its worksheet, lines added and removed, a
 * hazard with its harms and controls in the hazard log, and a risk
 * matrix. Each checks clean and renders; the generators' SysML is pinned.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { RenderedTable } from '#lib/engine/types.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { flashlightProject } from '#lib/project/templates/flashlight.ts';
import type { ProjectFile, Workspace } from '#lib/project/workspace.svelte.ts';
import { removeAnnotation } from '#lib/workbench/actions.ts';
import { write } from './apply';
import {
	FMEA_KINDS,
	canAnalyse,
	fmeaKind,
	fmeaLineProblem,
	fmeaLineText,
	fmeaPackageText,
	kindOfWorksheet,
	packageViewText,
	ratingMeaning
} from './fmea';
import {
	CONTROL_KINDS,
	SEVERITY_CLASSES,
	controlText,
	hazardMembers,
	hazardProblem
} from './hazard';
import { flatten } from './model';
import {
	hazardsPackage,
	nextControlId,
	planFmea,
	planFmeaLine,
	planHazard,
	planRiskMatrix,
	riskLibrariesWrite,
	type Chosen
} from './plans';
import { RISK_LIBRARIES } from './riskLibraries';
import { analysed, hostEngine, openWorkspace, problemsOf } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const design = fmeaKind('design')!;
const process = fmeaKind('process')!;
const use = fmeaKind('use')!;

function chosen(workspace: Workspace, qualifiedName: string): Chosen {
	const node = flatten(workspace.tree).find((n) => n.qualifiedName === qualifiedName);
	if (!node) throw new Error(`no ${qualifiedName}`);
	return { qualifiedName, label: node.node.element.label };
}

function packageOf(workspace: Workspace, name: string) {
	const pkg = workspace.elements.find((e) => e.kind === 'package' && e.name === name);
	if (!pkg) throw new Error(`no package ${name}`);
	return pkg;
}

const render = (workspace: Workspace, view: string) =>
	hostEngine(host).renderView(workspace.sourceFiles(), view);
const col = (t: RenderedTable, name: string) => t.rows.map((r) => r[t.columns.indexOf(name)]!);

function flashlight(): ProjectFile[] {
	return flashlightProject('Flashlight', '', host.viewLibraries()).files;
}

describe('the generators', () => {
	it('each kind of FMEA is told in plain words, and has the library’s worksheet', () => {
		const library = RISK_LIBRARIES.find((l) => l.package === 'RiskAnalysis')!.text;
		for (const k of FMEA_KINDS) {
			expect(k.description.length, k.id).toBeGreaterThan(30);
			expect(library).toContain(`view def ${k.worksheet} :> FmeaWorksheet`);
			expect(library).toContain(`enum ${k.literal};`);
			expect(kindOfWorksheet(`RiskAnalysis::${k.worksheet}`)).toBe(k);
		}
		expect(ratingMeaning('severity', 10)).toMatch(/hurt/);
		expect(ratingMeaning('detection', 1)).toMatch(/Always caught/);
	});

	it('the severity classes and control kinds are the library’s', () => {
		const library = RISK_LIBRARIES.find((l) => l.package === 'HazardAnalysis')!.text;
		for (const c of SEVERITY_CLASSES) expect(library).toContain(`${c.literal} = ${c.value};`);
		for (const c of CONTROL_KINDS) expect(library).toContain(`enum ${c.literal};`);
	});

	it('write a sheet, its view, a line and a hazard as the demo writes them', () => {
		expect(
			fmeaPackageText({
				kind: design,
				packageName: 'PumpDesignFmea',
				covers: ['pump'],
				imports: ['RiskAnalysis::*', 'Pump::pump']
			})
		).toMatchSnapshot();
		expect(
			packageViewText('pumpDesignFmea', 'DesignFmeaWorksheet', 'PumpDesignFmea', 'The pump.')
		).toMatchSnapshot();
		expect(
			fmeaLineText({
				about: 'pump::seal',
				failureMode: 'Seal wears out',
				effect: 'Water leaks "slowly"',
				cause: '',
				category: use.literal,
				severity: 6,
				likelihood: 4,
				detection: 7,
				hazard: "'Hot water leak'"
			})
		).toMatchSnapshot();
		expect(
			hazardMembers({
				name: 'Hot water leak',
				description: 'Hot water escapes from the pump.',
				situation: { name: 'Someone nearby', description: 'A person stands next to it.' },
				harms: [{ name: 'Scald', description: '', severity: 'serious' }],
				existingHarms: ['slip'],
				controls: [
					{
						id: 'RC-001',
						title: 'Seal check',
						statement: 'The pump shall stop when its seal leaks.',
						hierarchy: 'protectiveMeasure'
					}
				]
			}).join('\n')
		).toMatchSnapshot();
		expect(
			controlText(
				{ id: 'RC-2', title: 'Warn', statement: 'Label it.', hierarchy: 'informationForSafety' },
				'leak'
			)
		).toContain("requirement <'RC-2'> Warn : RiskControl {");
	});

	it('say what is missing before anything is written', () => {
		const ratings = { severity: 5, likelihood: 5, detection: 11 };
		expect(fmeaLineProblem({ about: null, failureMode: '', ratings, kind: design })).toBe(
			'Choose the part that can fail.'
		);
		expect(fmeaLineProblem({ about: 'x', failureMode: '', ratings, kind: use })).toBe(
			'Say what the user could do wrong.'
		);
		expect(fmeaLineProblem({ about: 'x', failureMode: 'y', ratings, kind: design })).toBe(
			'Choose a detection from 1 to 10.'
		);
		const spec = {
			name: 'Leak',
			description: '',
			situation: null,
			harms: [],
			existingHarms: [],
			controls: [{ id: 'RC-1', title: 'Check', statement: '', hierarchy: 'protectiveMeasure' }]
		};
		expect(hazardProblem({ ...spec, name: '' }, 'hazard', new Set())).toMatch(/Name the hazard/);
		expect(hazardProblem(spec, 'harms', new Set())).toBe('Add at least one harm it can cause.');
		expect(hazardProblem(spec, 'controls', new Set())).toBe(
			'Say what “Check” requires (a “shall” statement).'
		);
		expect(nextControlId(['SYS-001', 'RC-001', 'RC-002'])).toBe('RC-003');
		expect(nextControlId(['SYS-001'])).toBe('RC-001');
	});
});

describe('on a new Small system project', { timeout: 60_000 }, () => {
	it('a first design FMEA brings the risk libraries, and its worksheet opens empty', async () => {
		const workspace = await openWorkspace(host, flashlight());
		expect(workspace.text('libraries/RiskAnalysis.sysml')).toBeUndefined();
		const libraries = await riskLibrariesWrite(workspace, hostEngine(host));
		expect(libraries.files?.map((f) => f.path)).toEqual([
			'libraries/RiskAnalysis.sysml',
			'libraries/HazardAnalysis.sysml'
		]);
		const plan = planFmea(
			workspace,
			{
				kind: design,
				title: 'Flashlight design FMEA',
				covers: [chosen(workspace, 'FlashlightDesign::flashlight')]
			},
			libraries
		);
		expect(plan.preview).toMatchSnapshot();
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.text('libraries/RiskAnalysis.sysml')).toBe(RISK_LIBRARIES[0]!.text);
		const sheet = await render(workspace, plan.open!.name);
		expect(sheet.columns[0]).toBe('part');
		expect(sheet.rows).toEqual([]);
		expect(sheet.annotations).toEqual({
			metadata: 'RiskAnalysis::Fmea',
			package: 'FlashlightDesignFMEA'
		});
		// Lines: one per failure mode, each with its RPN and action priority.
		const pkg = packageOf(workspace, 'FlashlightDesignFMEA');
		const line = planFmeaLine(workspace, {
			pkg,
			kind: design,
			element: chosen(workspace, 'FlashlightDesign::flashlight::battery'),
			failureMode: 'Cells leak',
			effect: 'Corroded contacts; the light fails',
			cause: 'Left in for years',
			severity: 7,
			likelihood: 4,
			detection: 8
		});
		expect(line.preview).toMatchSnapshot();
		await analysed(workspace, () => write(workspace, line.label, line.write));
		expect(problemsOf(workspace)).toEqual([]);
		const after = await render(workspace, plan.open!.name);
		expect(after.rows).toEqual([
			[
				'flashlight::battery',
				'Cells leak',
				'7',
				'4',
				'8',
				'224',
				'high',
				'high',
				'reduce',
				'',
				'Corroded contacts; the light fails',
				'Left in for years'
			]
		]);
		// Removing the line takes it out of the text, as one undoable step.
		const source = after.sources[0]!;
		await analysed(workspace, () =>
			removeAnnotation(
				workspace,
				{ file: source.file, line: source.line, annotation: source.annotation! },
				'Removed the line'
			)
		);
		expect(workspace.text(source.file)).not.toContain('Cells leak');
		expect((await render(workspace, plan.open!.name)).rows).toEqual([]);
		expect(workspace.undo()).toBe('Removed the line');
		expect(workspace.text(source.file)).toContain('Cells leak');
		expect(workspace.undo()).toBe(line.label);
		expect(workspace.undo()).toBe('Created the design FMEA Flashlight design FMEA');
		expect(workspace.text('libraries/RiskAnalysis.sysml')).toBeUndefined();
	});

	it('a hazard with its harms and controls makes the hazard log; a disagreeing line is flagged', async () => {
		const workspace = await openWorkspace(host, flashlight());
		const libraries = await riskLibrariesWrite(workspace, hostEngine(host));
		expect(hazardsPackage(workspace)).toBeNull();
		const plan = planHazard(
			workspace,
			{
				spec: {
					name: 'Hot battery',
					description: 'The battery heats up when shorted.',
					situation: { name: 'Held in the hand', description: 'The user holds the light.' },
					harms: [
						{ name: 'Burned hand', description: 'A burn to the hand.', severity: 'serious' },
						{ name: 'Dropped light', description: '', severity: 'negligible' }
					],
					existingHarms: [],
					controls: [
						{
							id: 'RC-001',
							title: 'Thermal fuse',
							statement: 'The battery holder shall cut the current above 60 °C.',
							hierarchy: 'protectiveMeasure'
						}
					]
				},
				existingHarms: []
			},
			libraries
		);
		expect(plan.preview).toMatchSnapshot();
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const log = await render(workspace, plan.view);
		expect(log.rows).toEqual([
			[
				'Hot battery',
				'The battery heats up when shorted.',
				'Burned hand, Dropped light',
				'serious',
				'RC-001 Thermal fuse',
				'',
				''
			]
		]);
		// The control is a requirement: what implements and verifies it are ordinary trace links.
		expect(workspace.requirements.map((r) => [r.id, r.title])).toContainEqual([
			'RC-001',
			'Thermal fuse'
		]);
		// A line whose severity is not the worst harm of its hazard is a problem.
		const fmea = planFmea(
			workspace,
			{ kind: design, title: 'Battery FMEA', covers: [] },
			await riskLibrariesWrite(workspace, hostEngine(host))
		);
		await analysed(workspace, () => write(workspace, fmea.label, fmea.write));
		const line = planFmeaLine(workspace, {
			pkg: packageOf(workspace, 'BatteryFMEA'),
			kind: design,
			element: chosen(workspace, 'FlashlightDesign::Battery'),
			failureMode: 'Short circuit',
			effect: '',
			cause: '',
			severity: 4,
			likelihood: 2,
			detection: 5,
			hazard: chosen(workspace, "RoverHazards::'Hot battery'")
		});
		expect(line.preview).toContain("hazard = 'Hot battery';");
		await analysed(workspace, () => write(workspace, line.label, line.write));
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.problems.filter((p) => p.code === 'check').map((p) => p.message)).toEqual([
			'Severity is 4, but its hazard Hot battery can lead to Burned hand, which is serious (6) (@Fmea about Battery).'
		]);
		const sheet = await render(workspace, fmea.open!.name);
		expect(sheet.rowInfo?.[0]?.problems?.[2]).toMatch(/^Severity is 4, but/);
		// A risk matrix of the sheet.
		const matrix = planRiskMatrix(workspace, { packageName: 'BatteryFMEA', title: 'Battery FMEA' });
		expect(matrix.preview).toMatchSnapshot();
		await analysed(workspace, () => write(workspace, matrix.label, matrix.write));
		expect(problemsOf(workspace)).toEqual([]);
		const grid = await render(workspace, matrix.name);
		expect(grid.counts).toMatchObject({ rows: 'severity', columns: 'likelihood' });
		expect(grid.rows.find((r) => r[0] === '4')?.[2]).toBe('1');
		expect(grid.rows).toHaveLength(10);
	});
});

describe('on the demo', { timeout: 60_000 }, () => {
	it('a process FMEA of the delivery flight, and a use FMEA of the parcel delivery', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		expect((await riskLibrariesWrite(workspace, hostEngine(host))).files).toBeUndefined();
		const flight = chosen(workspace, 'DeliveryMission::DeliveryFlight');
		const pfmea = planFmea(workspace, {
			kind: process,
			title: 'Delivery flight process FMEA',
			covers: [flight]
		});
		await analysed(workspace, () => write(workspace, pfmea.label, pfmea.write));
		expect(problemsOf(workspace)).toEqual([]);
		const release = chosen(workspace, 'DeliveryMission::DeliveryFlight::releaseParcel');
		const element = workspace.elements.find((e) => e.name === 'releaseParcel')!;
		expect(canAnalyse(process, element)).toBe(true);
		expect(canAnalyse(design, element)).toBe(false);
		const line = planFmeaLine(workspace, {
			pkg: packageOf(workspace, 'DeliveryFlightProcessFMEA'),
			kind: process,
			element: release,
			failureMode: 'Latch opens too early',
			effect: 'The parcel falls from height',
			cause: 'Release before the drop point',
			severity: 8,
			likelihood: 2,
			detection: 6,
			hazard: chosen(workspace, 'DroneFmea::uncontrolledDescent')
		});
		await analysed(workspace, () => write(workspace, line.label, line.write));
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.problems.filter((p) => p.code === 'check')).toEqual([]);
		const sheet = await render(workspace, pfmea.open!.name);
		expect(sheet.columns[0]).toBe('processStep');
		expect(sheet.rows[0]!.slice(0, 2)).toEqual([
			'DeliveryFlight::releaseParcel',
			'Latch opens too early'
		]);
		// The design worksheet doesn't show process lines.
		expect((await render(workspace, 'fmeaWorksheet')).rows).toHaveLength(6);

		const ufmea = planFmea(workspace, {
			kind: use,
			title: 'Parcel delivery use FMEA',
			covers: [chosen(workspace, 'DeliveryMission::DeliverParcel')]
		});
		await analysed(workspace, () => write(workspace, ufmea.label, ufmea.write));
		const useLine = planFmeaLine(workspace, {
			pkg: packageOf(workspace, 'ParcelDeliveryUseFMEA'),
			kind: use,
			element: chosen(workspace, 'DeliveryMission::DeliverParcel::prepareFlight'),
			failureMode: 'Uploads the wrong flight plan',
			effect: 'The parcel goes to the wrong place',
			cause: 'Plans are named alike',
			severity: 5,
			likelihood: 4,
			detection: 4
		});
		await analysed(workspace, () => write(workspace, useLine.label, useLine.write));
		expect(problemsOf(workspace)).toEqual([]);
		const uses = await render(workspace, ufmea.open!.name);
		expect(uses.columns.slice(0, 2)).toEqual(['task', 'useError']);
		expect(uses.rows[0]!.slice(0, 2)).toEqual([
			'DeliverParcel::prepareFlight',
			'Uploads the wrong flight plan'
		]);
		expect(workspace.text(`risk/ParcelDeliveryUseFMEA.sysml`)).toContain(
			"category = RiskCategory::'use';"
		);
	});

	it('a worksheet cell edits its line: a rating out of scale is flagged, a kind is a literal', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		const { setField } = await import('#lib/workbench/actions.ts');
		const all = await render(workspace, 'FmeaWorksheet');
		const battery = all.sources[0]!;
		await analysed(workspace, () =>
			setField(workspace, battery, 'metadata:Fmea.severity', '14', 'Set severity')
		);
		expect(workspace.problems.filter((p) => p.code === 'check').map((p) => p.message)).toEqual([
			'Severity is 14, outside the scale of 1 to 10 (@Fmea about drone::battery).',
			'Severity is 14, but its hazard batteryFire can lead to burnInjury, which is critical (8) (@Fmea about drone::battery).'
		]);
		const flagged = await render(workspace, 'fmeaWorksheet');
		const at = flagged.rows.findIndex((r) => r[0] === 'drone::battery');
		expect(flagged.rowInfo?.[at]?.problems?.[2]).toBe(
			'Severity is 14, outside the scale of 1 to 10.'
		);
		// The RPN and the action priority wait for a rating in scale (the line sorts last).
		expect(at).toBe(5);
		expect(flagged.rows[at]!.slice(5, 7)).toEqual(['', '']);
		const category = all.columns.indexOf('category');
		expect(all.editable?.[category]?.options).toContain('use');
		await analysed(workspace, () =>
			setField(workspace, battery, 'metadata:Fmea.category', 'use', 'Set category')
		);
		expect(workspace.text('risk/DesignFmea.sysml')).toContain("category = RiskCategory::'use';");
		expect(problemsOf(workspace)).toEqual([]);
		const after = await render(workspace, 'FmeaWorksheet');
		expect(col(after, 'category')[col(after, 'element').indexOf('drone::battery')]).toBe('use');
	});

	it('a new hazard goes beside the demo’s, into its hazard log, leading to a harm it has', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		expect(hazardsPackage(workspace)?.name).toBe('DroneFmea');
		const plan = planHazard(workspace, {
			spec: {
				name: 'Parcel drop',
				description: 'The parcel falls from the drone.',
				situation: null,
				harms: [],
				existingHarms: [],
				controls: [
					{
						id: nextControlId(workspace.requirements.map((r) => r.id)),
						title: 'Latch interlock',
						statement: 'The latch shall open only when the drone hovers at the drop point.',
						hierarchy: 'inherentSafety'
					}
				]
			},
			existingHarms: [chosen(workspace, 'DroneFmea::impactInjury')]
		});
		expect(plan.view).toBe('hazardLog');
		expect(plan.write.files).toEqual([]);
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const text = workspace.text('risk/DesignFmea.sysml')!;
		expect(text).toContain("connection : Causation connect 'Parcel drop' to impactInjury;");
		expect(text).toContain("requirement <'RC-004'> 'Latch interlock' : RiskControl {");
		const log = await render(workspace, 'hazardLog');
		expect(log.rows.find((r) => r[0] === 'Parcel drop')).toEqual([
			'Parcel drop',
			'The parcel falls from the drone.',
			'impactInjury',
			'critical',
			'RC-004 Latch interlock',
			'',
			''
		]);
	});
});
