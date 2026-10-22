/**
 * Reviewing risk from the app, applied as the app applies it (one undoable
 * step) to the demo: an FMEA line linked to the risk controls and
 * mitigations that address it, a new control and a new mitigation made for
 * a line, the review flag on a high-priority line without a verified
 * control, and a filtered worksheet saved as a view. Each checks clean and
 * renders; the SysML is pinned.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { RenderedTable } from '#lib/engine/types.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { applySteps } from '#lib/workbench/actions.ts';
import { whereOf } from '#lib/workbench/tableFilters.ts';
import { write } from './apply';
import { flatten } from './model';
import { fmeaKind } from './fmea';
import { planFmeaLine, planLineLinks, planSavedReview, type Linked, type PatchPlan } from './plans';
import { annotationAt, mitigationText, withLineField } from './riskControls';
import { analysed, hostEngine, openWorkspace, problemsOf } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const render = (workspace: Workspace, view: string) =>
	hostEngine(host).renderView(workspace.sourceFiles(), view);
const col = (t: RenderedTable, name: string) => t.rows.map((r) => r[t.columns.indexOf(name)]!);

function linked(workspace: Workspace, qualifiedName: string): Linked {
	const node = flatten(workspace.tree).find((n) => n.qualifiedName === qualifiedName);
	if (!node) throw new Error(`no ${qualifiedName}`);
	const e = node.node.element;
	return { qualifiedName, label: e.label, shortName: e.shortName };
}

/** The toolkit's id of the demo's motor, as the inspector has it. */
function motorId(workspace: Workspace): string {
	return workspace.elements.find((e) => e.name === 'motor' && e.parent === 'Rotor')!.id!;
}

/** The line of the demo's FMEA about a part: where it is written. */
function lineOf(workspace: Workspace, mode: string) {
	const file = 'risk/DesignFmea.sysml';
	const text = workspace.text(file)!;
	const line = text.slice(0, text.indexOf(mode)).split('\n').length - 1;
	const pkg = workspace.elements.find((e) => e.kind === 'package' && e.name === 'DroneFmea')!;
	return { file, line, pkg };
}

async function apply(workspace: Workspace, plan: PatchPlan | string) {
	if (typeof plan === 'string') throw new Error(plan);
	const error = await analysed(workspace, () => applySteps(workspace, plan.label, plan.steps));
	expect(error).toBeNull();
}

describe('a line’s controls', () => {
	const text = `package P {
    @Fmea about a {
        failureMode = "x";
        severity = 1; likelihood = 1; detection = 1;
    }
    @Fmea about b { failureMode = "y"; riskControls = 'RC-1'; }
}`;

	it('are written as references in the line, added, replaced and taken out', () => {
		expect(annotationAt(text, 2)).toMatchObject({ from: text.indexOf('@Fmea about a') });
		const added = withLineField(text, 2, 'riskControls', ["'RC-1'", "'RC-2'"])!;
		expect(added).toContain(
			"severity = 1; likelihood = 1; detection = 1;\n        riskControls = ('RC-1', 'RC-2');\n    }"
		);
		expect(withLineField(added, 2, 'riskControls', ["'RC-3'"])).toContain(
			"        riskControls = 'RC-3';\n    }"
		);
		expect(withLineField(added, 2, 'riskControls', [])).toBe(text);
		// On one line.
		expect(withLineField(text, 6, 'riskControls', [])).toContain(
			'@Fmea about b { failureMode = "y"; }'
		);
		expect(withLineField(text, 6, 'mitigations', ['m'])).toContain(
			`riskControls = 'RC-1'; mitigations = m; }`
		);
		expect(withLineField(text, 1, 'riskControls', ['x'])).toBeNull();
		expect(
			mitigationText({
				name: 'Cell vents',
				description: 'Add vents.',
				kind: 'prevention',
				owner: 'A "B"'
			})
		).toMatchSnapshot();
	});
});

describe('on the demo', { timeout: 60_000 }, () => {
	it('the worksheet shows each line’s controls, whether they are verified, and the mitigations', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		const sheet = await render(workspace, 'fmeaWorksheet');
		const at = (part: string, mode?: string) =>
			sheet.rows.findIndex((r) => r[0] === part && (!mode || r[1] === mode));
		expect(col(sheet, 'riskControls')).toEqual([
			'RC-007 Drop-zone clearance check',
			'RC-001 Battery thermal protection',
			'RC-002 Rotor health monitoring',
			'RC-002 Rotor health monitoring',
			'',
			'RC-004 Propeller guards, RC-006 Hand-over warnings',
			'RC-003 Navigation integrity monitoring',
			'RC-003 Navigation integrity monitoring',
			'RC-005 Release height interlock'
		]);
		expect(sheet.rowInfo?.[at('drone::battery')]?.controls).toEqual([
			{
				label: 'RC-001 Battery thermal protection',
				element: "DroneFmea::'Battery thermal protection'",
				satisfiedBy: ['batteryManagementSystem'],
				verifiedBy: ['batteryAbuseTest']
			}
		]);
		// The camera's control is implemented (in progress) but not verified yet.
		expect(sheet.rowInfo?.[at('drone::camera')]?.controls?.[0]).toMatchObject({
			satisfiedBy: ['dropZoneScan'],
			verifiedBy: []
		});
		expect(sheet.rowInfo?.[at('drone::camera')]?.mitigations).toEqual([
			{
				name: 'dropZoneScan',
				element: 'DroneFmea::dropZoneScan',
				status: 'inProgress',
				named: true
			}
		]);
		// The mitigation that implements a line's control counts, though the line doesn't name it.
		expect(sheet.rowInfo?.[at('drone::rotors::motor')]?.mitigations?.[0]).toMatchObject({
			name: 'rotorHealthMonitor',
			status: 'verified',
			named: false
		});
		const reduction = await render(workspace, 'riskReduction');
		expect(reduction.columns).toEqual([
			'element',
			'failureMode',
			'rpnBefore',
			'rpn',
			'priorityBefore',
			'actionPriority',
			'acceptabilityBefore',
			'acceptability',
			'riskControls',
			'controlStatus',
			'mitigations',
			'mitigationStatus'
		]);
		expect(reduction.rows.find((r) => r[0] === 'drone::battery')!.slice(2)).toEqual([
			'384',
			'144',
			'high',
			'medium',
			'unacceptable',
			'reduce',
			'RC-001 Battery thermal protection',
			'verified',
			'batteryManagementSystem',
			'verified'
		]);
		// Every line assessed before its controls is lower now, or as low.
		for (const r of reduction.rows) expect(Number(r[3]), r[1]).toBeLessThanOrEqual(Number(r[2]));
		const lines = host.fmeaLines(workspace.sourceFiles(), motorId(workspace));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			failureMode: 'Motor stops or loses torque',
			rpn: '96',
			rpnBand: 'medium',
			actionPriority: 'medium',
			acceptability: 'reduce',
			review: null
		});
	});

	it('links a line to more controls and a mitigation, and makes new ones, in one step each', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		const at = lineOf(workspace, 'Motor stops or loses torque');
		const rc1 = linked(workspace, "DroneFmea::'Battery thermal protection'");
		const rc2 = linked(workspace, "DroneFmea::'Rotor health monitoring'");
		const monitor = linked(workspace, 'DroneFmea::rotorHealthMonitor');
		await apply(
			workspace,
			planLineLinks(workspace, {
				...at,
				controls: [rc2, rc1],
				mitigations: [monitor],
				label: 'Linked RC-001'
			})
		);
		expect(problemsOf(workspace)).toEqual([]);
		expect(workspace.text(at.file)).toContain("riskControls = ('RC-002', 'RC-001');");
		let sheet = await render(workspace, 'fmeaWorksheet');
		const motor = col(sheet, 'part').indexOf('drone::rotors::motor');
		expect(sheet.rows[motor]![sheet.columns.indexOf('riskControls')]).toBe(
			'RC-002 Rotor health monitoring, RC-001 Battery thermal protection'
		);

		// A new control on the line's hazard, and a new mitigation, made for it.
		const plan = planLineLinks(workspace, {
			...lineOf(workspace, 'Motor stops or loses torque'),
			controls: [rc2],
			mitigations: [monitor],
			newControl: {
				id: 'RC-008',
				title: 'Motor current limit',
				statement: 'The motor driver shall limit the current to 30 A.',
				hierarchy: 'protectiveMeasure',
				hazard: 'uncontrolledDescent'
			},
			newMitigation: {
				name: 'currentLimiter',
				description: 'Add a current limiter to each motor driver.',
				kind: 'prevention',
				owner: 'R. Tanaka'
			},
			label: 'Added RC-008'
		});
		if (typeof plan === 'string') throw new Error(plan);
		expect(plan.preview).toMatchSnapshot();
		await apply(workspace, plan);
		expect(problemsOf(workspace)).toEqual([]);
		sheet = await render(workspace, 'fmeaWorksheet');
		expect(sheet.rows[motor]![sheet.columns.indexOf('riskControls')]).toBe(
			'RC-002 Rotor health monitoring, RC-008 Motor current limit'
		);
		const log = await render(workspace, 'hazardLog');
		expect(log.rows.find((r) => r[0] === 'uncontrolledDescent')?.join()).toContain('RC-008');
		const lines = host.fmeaLines(workspace.sourceFiles(), motorId(workspace));
		expect(lines[0]!.mitigations.map((m) => `${m.name} ${m.status}`)).toEqual([
			'rotorHealthMonitor verified',
			'currentLimiter proposed'
		]);
	});

	it('a new line names its controls and mitigations, and can bring a new control', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		const pkg = workspace.elements.find((e) => e.kind === 'package' && e.name === 'DroneFmea')!;
		const node = flatten(workspace.tree).find(
			(n) => n.qualifiedName === 'DroneArchitecture::drone::camera'
		)!;
		const plan = planFmeaLine(workspace, {
			pkg,
			kind: fmeaKind('design')!,
			element: { qualifiedName: node.qualifiedName, label: 'camera' },
			failureMode: 'Lens fogs up',
			effect: 'No picture of the drop zone',
			cause: 'Humidity',
			severity: 4,
			likelihood: 5,
			detection: 3,
			controls: [linked(workspace, "DroneFmea::'Navigation integrity monitoring'")],
			mitigations: [linked(workspace, 'DroneFmea::navigationIntegrityMonitor')],
			newControl: {
				id: 'RC-008',
				title: 'Lens heater',
				statement: 'The camera shall keep its lens above the dew point.',
				hierarchy: 'inherentSafety'
			}
		});
		expect(plan.preview).toMatchSnapshot();
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const sheet = await render(workspace, 'fmeaWorksheet');
		const row = sheet.rows.find((r) => r[1] === 'Lens fogs up')!;
		expect(row[sheet.columns.indexOf('riskControls')]).toBe(
			'RC-003 Navigation integrity monitoring, RC-008 Lens heater'
		);
	});

	it('flags a high-priority line without a verified control, until one is', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		const file = 'risk/DesignFmea.sysml';
		const before = workspace.text(file)!;
		// The radio's line rated high (severity 9, likelihood 6): its control RC-003 is not verified.
		const after = before.replace(
			'severity = 6; likelihood = 5; detection = 2;',
			'severity = 9; likelihood = 6; detection = 2;'
		);
		await analysed(workspace, () =>
			applySteps(workspace, 'Rated', [{ kind: 'patch', path: file, before, after }])
		);
		const sheet = await render(workspace, 'fmeaWorksheet');
		const radio = col(sheet, 'part').indexOf('drone::radio');
		expect(sheet.rows[radio]![sheet.columns.indexOf('actionPriority')]).toBe('high');
		expect(sheet.rows[radio]![sheet.columns.indexOf('acceptability')]).toBe('unacceptable');
		// (Severity 9 is not the worst harm of its hazard either, which is flagged too.)
		expect(sheet.rowInfo?.[radio]?.problems).toMatchObject({
			[sheet.columns.indexOf('acceptability')]:
				'The risk is unacceptable by the risk policy (severity 9, likelihood 6): reduce it before release.',
			[sheet.columns.indexOf('riskControls')]:
				'Its action priority is high and none of its risk controls is verified yet: link a risk control and verify it.'
		});
		const problems = host
			.checks(workspace.sourceFiles())
			.checks.filter((c) => c.status === 'violated')
			.map((c) => c.problem);
		expect(problems).toEqual(
			expect.arrayContaining([
				'The risk is unacceptable by the risk policy (severity 9, likelihood 6): reduce it before release (@Fmea about drone::radio).',
				'Its action priority is high and none of its risk controls is verified yet: link a risk control and verify it (@Fmea about drone::radio).'
			])
		);
		// Linked to the verified RC-001 instead: no longer a review item, still unacceptable.
		const at = lineOf(workspace, 'Command link lost');
		await apply(
			workspace,
			planLineLinks(workspace, {
				...at,
				controls: [linked(workspace, "DroneFmea::'Battery thermal protection'")],
				mitigations: [],
				label: 'Linked'
			})
		);
		const now = await render(workspace, 'fmeaWorksheet');
		expect(Object.keys(now.rowInfo?.[radio]?.problems ?? {})).toEqual([
			String(now.columns.indexOf('severity')),
			String(now.columns.indexOf('acceptability'))
		]);
	});

	it('saves a filtered worksheet as a view, which shows the same lines', async () => {
		const workspace = await openWorkspace(host, demoFiles());
		const sheet = await render(workspace, 'fmeaWorksheet');
		const { where, left } = whereOf(sheet, [
			{ column: 'actionPriority', kind: 'levels', values: ['medium', 'high'] },
			{ column: 'rpn', kind: 'range', min: 90, max: null }
		]);
		expect(left).toEqual([]);
		const plan = planSavedReview(workspace, {
			title: 'Lines to review',
			definition: 'RiskAnalysis::DesignFmeaWorksheet',
			exposes: ['DroneFmea::*'],
			where,
			doc: 'The design FMEA: action priority ≥ medium, RPN ≥ 90.'
		});
		expect(plan.preview).toMatchSnapshot();
		await analysed(workspace, () => write(workspace, plan.label, plan.write));
		expect(problemsOf(workspace)).toEqual([]);
		const saved = await render(workspace, plan.name);
		// The design worksheet's own condition (its category) still applies.
		expect(col(saved, 'failureMode')).toEqual([
			'A person under the drop point is not seen',
			'Thermal runaway',
			'Motor stops or loses torque'
		]);
		// The demo's saved review: the lines the policy says to reduce.
		expect(col(await render(workspace, 'fmeaReview'), 'acceptability')).toEqual([
			'unacceptable',
			'reduce',
			'reduce',
			'reduce',
			'reduce'
		]);
	});
});
