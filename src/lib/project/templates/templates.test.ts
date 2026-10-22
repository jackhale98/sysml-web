/**
 * Every starting point, on the real toolkit as the app opens it: no problems
 * at all, its saved views list and render, and what it is there to show works
 * (the flashlight's mass adds up and is checked, its state machine runs).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { hostEngine, openWorkspace } from '#lib/create/testing.ts';
import { start, step, withVariables } from '#lib/sim/emulator.ts';
import { presentationOf } from '#lib/workbench/views.ts';
import type { ProjectFile } from '../workspace.svelte.ts';
import { loadTemplate, TEMPLATES, type TemplateId } from './catalog.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

async function make(id: TemplateId, name: string, description = ''): Promise<ProjectFile[]> {
	const template = await loadTemplate(id);
	return template.make(name, description, host.viewLibraries()).files;
}

/** Every problem the workspace reports, warnings and notes included. */
async function opened(files: ProjectFile[]) {
	const workspace = await openWorkspace(host, files);
	const problems = workspace.problems.map(
		(p) => `${p.severity} ${p.file}:${p.span.start_row} ${p.message}`
	);
	return { workspace, problems };
}

/** The saved views of the project (not the libraries'), with how each is shown. */
function savedViews(workspace: Awaited<ReturnType<typeof opened>>['workspace']) {
	return workspace.views
		.filter((v) => v.isUsage && !v.builtin && !v.file.startsWith('libraries/'))
		.map((v) => [v.name, presentationOf(v).kind]);
}

describe('starting points', { timeout: 60_000 }, () => {
	it('lists three templates, each with one line', () => {
		expect(TEMPLATES.map((t) => t.id)).toEqual(['blank', 'requirements', 'flashlight']);
		for (const t of TEMPLATES) expect(t.summary.length).toBeLessThan(90);
	});

	it.each(TEMPLATES.map((t) => t.id))(
		'%s has a tour and no problems, however it is named',
		async (id) => {
			for (const name of ['Test rig', 'Flashlight', 'Product', 'System', '2026 bench']) {
				const files = await make(id, name);
				expect(files.some((f) => f.path === 'TOUR.md')).toBe(true);
				const { workspace, problems } = await opened(files);
				expect(problems, `${id} named ${name}`).toEqual([]);
				if (name !== 'Test rig') continue;
				// Every saved view draws something, without warnings.
				const sources = workspace.sourceFiles();
				for (const v of workspace.views.filter((v) => v.isUsage && !v.builtin)) {
					if (v.file.startsWith('libraries/')) continue;
					const shown = presentationOf(v);
					if (shown.kind === 'table') {
						const table = host.renderView(sources, v.name);
						expect(table.warnings, v.name).toEqual([]);
						expect(
							table.rows.length + (table.matrix?.elements.length ?? 0),
							v.name
						).toBeGreaterThan(0);
					} else if (shown.kind === 'diagram') {
						const graph = host.diagram(shown.view, sources, shown.scope);
						expect(graph.nodes.length, v.name).toBeGreaterThan(0);
					}
				}
			}
		}
	);

	it('blank keeps the starter: a first requirement, the system and three views', async () => {
		const files = await make('blank', 'Rover', 'A planetary rover.');
		expect(files.map((f) => f.path)).toEqual([
			'model/Rover.sysml',
			'views/Views.sysml',
			'libraries/Reporting.sysml',
			'libraries/ModelViews.sysml',
			'TOUR.md'
		]);
		const { workspace } = await opened(files);
		expect(workspace.requirements.map((r) => [r.id, r.title, r.satisfiedBy])).toEqual([
			['REQ-001', 'First requirement', ['system']]
		]);
		expect(savedViews(workspace)).toEqual([
			['requirements', 'table'],
			['gaps', 'table'],
			['structure', 'diagram']
		]);
	});

	it('requirements first has the spreadsheet columns, a trace and a report', async () => {
		const files = await make('requirements', 'Pump');
		const { workspace } = await opened(files);
		expect(savedViews(workspace)).toEqual([
			['requirements', 'table'],
			['gaps', 'table'],
			['traceMatrix', 'table'],
			['verificationMatrix', 'table'],
			['specification', 'none']
		]);
		const engine = hostEngine(host);
		const table = await engine.renderView(workspace.sourceFiles(), 'requirements');
		expect(table.columns).toEqual([
			'id',
			'title',
			'text',
			'priority',
			'verificationMethod',
			'status',
			'owner',
			'satisfiedBy',
			'verifiedBy'
		]);
		expect(table.rows.map((r) => r.slice(0, 2))).toEqual([
			['REQ-001', 'Operating temperature'],
			['REQ-002', 'Battery life'],
			['REQ-003', 'Drop resistance'],
			['REQ-004', 'Labelling']
		]);
		const first = table.rows[0]!;
		expect(first.slice(3, 7)).toEqual(['high', 'test', 'open', 'Systems']);
		const gaps = await engine.renderView(workspace.sourceFiles(), 'gaps');
		expect(gaps.rows.map((r) => r[0])).toEqual(['REQ-002', 'REQ-003']);
		const trace = await engine.renderView(workspace.sourceFiles(), 'traceMatrix');
		expect(trace.matrix?.elements.length).toBeGreaterThan(0);
	});

	it('the flashlight adds up its mass, checks it against the limit, and its modes run', async () => {
		const files = await make('flashlight', 'Flashlight');
		const { workspace } = await opened(files);
		expect(savedViews(workspace)).toEqual([
			['partsTree', 'diagram'],
			['connections', 'diagram'],
			['massBudget', 'table'],
			['requirements', 'table'],
			['designChecks', 'table'],
			['modes', 'diagram']
		]);
		const engine = hostEngine(host);

		// 48 g + 4 g + 6 g + 72 g.
		const mass = workspace.elements.find((e) => e.name === 'mass' && e.parent === 'flashlight')!;
		const value = (await engine.evaluate(workspace.sourceFiles(), [mass.id!]))[mass.id!];
		expect(value).toMatchObject({ kind: 'number', value: 130, unit: 'g' });
		const budget = await engine.renderView(workspace.sourceFiles(), 'massBudget');
		expect(budget.rows[0]?.slice(0, 5)).toEqual([
			'flashlight',
			'Flashlight',
			'1',
			'130 g',
			'130 g'
		]);

		// Both requirements are met by the design, and each has a test.
		const verdict = (id: string) => workspace.checks!.checks.find((c) => c.requirement?.id === id);
		expect(verdict('REQ-001')).toMatchObject({
			status: 'satisfied',
			by: 'flashlight',
			limit: { value: 150, unit: 'g' }
		});
		expect(verdict('REQ-002')).toMatchObject({ status: 'satisfied' });
		expect(workspace.requirements.map((r) => [r.id, r.satisfiedBy, r.verifiedBy.length])).toEqual([
			['REQ-001', ['flashlight'], 1],
			['REQ-002', ['flashlight'], 1]
		]);

		// The state machine: off, on with a press, dimmed when the charge runs low, off again.
		const machine = workspace.machines.find((m) => m.name === 'FlashlightModes')!;
		expect(machine).toBeDefined();
		let session = start(machine);
		expect(session.current).toEqual(['off']);
		session = step(machine, session, { event: 'ButtonPress' });
		expect(session.current).toEqual(['on']);
		session = withVariables(machine, session, { charge: 0.05 });
		session = step(machine, session, { event: null });
		expect(session.current).toEqual(['lowBattery']);
		session = step(machine, session, { event: 'ButtonPress' });
		expect(session.current).toEqual(['off']);
	});
});
