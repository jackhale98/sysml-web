/**
 * Assessment evidence (§4 and §7): requirement identity, traceability, gaps
 * and change impact on the demo, through the same code the app runs (the
 * real toolkit in Node, the workspace's own problems and coverage, the
 * review's semantic diff, the related-elements panel and the DSM).
 *
 * Each test asserts the behaviour a requirements engineer needs; where
 * Fairtide falls short the test is `it.fails` with the gap named, so it
 * flips when the gap is closed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace } from '#lib/create/testing.ts';
import { editFiles } from '#lib/engine/toolkit/edit-testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { merge3 } from '#lib/git/diff.ts';
import { summarize, type ReviewSummary } from '#lib/review/summary.ts';
import { impactOf, reviewFlags } from '#lib/workbench/dsm.ts';
import type { Workspace } from './workspace.svelte';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

type File = { path: string; text: string };
const demo: File[] = demoFiles();
/**
 * The demo's coverage by the one rule (home, tables, report): 16 requirements satisfied and 13
 * verified directly, and the stakeholder needs whose derived requirements all are (four
 * satisfied, three verified); no test results recorded.
 */
const DEMO_COVERAGE = { total: 24, satisfied: 20, verified: 16, passed: 0 };
const R = 'requirements/SystemRequirements.sysml';
const S = 'system/Satisfaction.sysml';
const V = 'verification/VerificationPlan.sysml';
const FM = 'risk/DesignFmea.sysml';
const A = 'system/DroneArchitecture.sysml';

const sorted = (files: File[]) => [...files].sort((a, b) => a.path.localeCompare(b.path));
const asMap = (files: File[]) => Object.fromEntries(files.map((f) => [f.path, f.text]));
const asList = (map: Record<string, string>) =>
	sorted(Object.entries(map).map(([path, text]) => ({ path, text })));
function edit(files: File[], path: string, from: string, to: string): File[] {
	return files.map((f) => {
		if (f.path !== path) return f;
		if (!f.text.includes(from)) throw new Error(`${path} has no ${from}`);
		return { ...f, text: f.text.replace(from, to) };
	});
}
const lineOf = (files: File[], path: string, needle: string) =>
	files
		.find((f) => f.path === path)!
		.text.split('\n')
		.findIndex((l) => l.includes(needle)) + 1;

async function workspace(files: File[]): Promise<Workspace> {
	const ws = await openWorkspace(host, files);
	await analysed(ws, () => {});
	return ws;
}
/** Problems other than the demo's own two risk-review warnings, as `file:line message`. */
const problems = (ws: Workspace) =>
	ws.problems
		.filter((p) => !p.message.includes('drone::camera'))
		.map((p) => `${p.severity} ${p.file}:${p.span.start_row} ${p.message}`);
const row = (ws: Workspace, id: string) => ws.requirements.find((r) => r.id === id);
const review = (base: File[], current: File[]): ReviewSummary =>
	summarize(host.compareModels(base, current).diff);
const lines = (s: ReviewSummary) => [
	...s.impact.map((i) => `Impact: ${i.text}`),
	...s.groups.flatMap((g) => g.items.map((i) => `${g.title}: ${i.text}`))
];

/** The demo with 'Flight endurance' (SYS-001) renamed as the app renames: every reference follows. */
function renamedByEngine(): File[] {
	const result = editFiles(host, asMap(demo), {
		op: 'rename',
		path: R,
		from: 'Flight endurance',
		to: 'Hover endurance',
		line: lineOf(demo, R, "'Flight endurance' : DroneRequirement")
	});
	if ('error' in result) throw new Error(result.error);
	return asList(result.files);
}

/** 'Payload capacity' (SYS-002) cut from SystemRequirements and pasted into a new package and file. */
function movedToNewFile(updateReferences: boolean): File[] {
	const text = demo.find((f) => f.path === R)!.text;
	const block = text.slice(
		text.indexOf("    requirement <'SYS-002'>"),
		text.indexOf("    requirement <'SYS-003'>")
	);
	let files = sorted([
		...edit(demo, R, block, ''),
		{
			path: 'requirements/Payload.sysml',
			text: `package PayloadRequirements {\n    private import SI::*;\n    private import EngineeringBasics::*;\n    private import ModelingMetadata::*;\n    private import SystemRequirements::DroneRequirement;\n${block}}\n`
		}
	]);
	if (updateReferences) {
		for (const path of [S, V])
			files = edit(
				files,
				path,
				'private import SystemRequirements::*;',
				'private import SystemRequirements::*;\n    private import PayloadRequirements::*;'
			);
		files = edit(
			files,
			R,
			"end #derive ::> 'Payload capacity';",
			"end #derive ::> PayloadRequirements::'Payload capacity';"
		);
	}
	return files;
}

describe('requirement identity: rename, move, file rename, merge', { timeout: 120_000 }, () => {
	it('a rename through the app keeps the ID, the links and the coverage, and reads as a rename', async () => {
		const files = renamedByEngine();
		const ws = await workspace(files);
		expect(problems(ws)).toEqual([]);
		expect(row(ws, 'SYS-001')).toMatchObject({
			title: 'Hover endurance',
			satisfiedBy: ['drone'],
			verifiedBy: ['enduranceFlightTest']
		});
		expect(ws.coverage).toEqual(DEMO_COVERAGE);
		const said = lines(review(demo, files));
		expect(said).toContain('Requirements: Renamed requirement `SYS-001` to `Hover endurance`');
		expect(said.filter((l) => /Added requirement|Removed requirement/.test(l))).toEqual([]);
	});

	// The review used to list an unnamed `objective` in another file (analysis enduranceBudget),
	// whose doc names the requirement, as removed and added.
	it('the review of that rename lists nothing but the rename', () => {
		expect(lines(review(demo, renamedByEngine()))).toEqual([
			'Requirements: Renamed requirement `SYS-001` to `Hover endurance`'
		]);
	});

	it('a rename typed in the text leaves each old reference reported where it is written', async () => {
		const files = edit(
			demo,
			R,
			"requirement <'SYS-001'> 'Flight endurance'",
			"requirement <'SYS-001'> 'Hover endurance'"
		);
		const ws = await workspace(files);
		expect(problems(ws)).toEqual([
			`warning ${R}:${lineOf(files, R, "end #derive ::> 'Flight endurance'")} unresolved reference \`Flight endurance\``,
			`warning ${S}:${lineOf(files, S, "satisfy 'Flight endurance'")} unresolved reference \`Flight endurance\``,
			`warning ${V}:${lineOf(files, V, "verify 'Flight endurance'")} unresolved reference \`Flight endurance\``
		]);
		// Coverage follows the model as it now resolves: SYS-001 has lost both links, and the need
		// derived into it (STK-001) is no longer covered through it: its derivation names a
		// requirement that isn't there.
		expect(row(ws, 'SYS-001')).toMatchObject({ satisfiedBy: [], verifiedBy: [] });
		expect(row(ws, 'STK-001')).toMatchObject({ satisfied: null, verified: null });
		expect(ws.coverage).toEqual({ total: 24, satisfied: 18, verified: 14, passed: 0 });
	});

	it('a move to another package and file, with references updated, keeps ID, links and coverage', async () => {
		const files = movedToNewFile(true);
		const ws = await workspace(files);
		expect(problems(ws)).toEqual([]);
		expect(row(ws, 'SYS-002')).toMatchObject({
			file: 'requirements/Payload.sysml',
			satisfiedBy: ['drone'],
			verifiedBy: ['massAndPayloadCheck']
		});
		expect(ws.coverage).toEqual(DEMO_COVERAGE);
		const said = lines(review(demo, files));
		expect(said).toContain(
			'Requirements: Moved requirement `SYS-002` ‘Payload capacity’ from `SystemRequirements` to `PayloadRequirements`'
		);
		expect(said.filter((l) => /Added requirement|Removed requirement/.test(l))).toEqual([]);
	});

	it('the same move without updating references is reported at each reference', async () => {
		const ws = await workspace(movedToNewFile(false));
		expect(problems(ws).map((p) => p.replace(/:\d+ /, ' '))).toEqual([
			`warning ${R} unresolved reference \`Payload capacity\``,
			`warning ${S} unresolved reference \`Payload capacity\``,
			`warning ${V} unresolved reference \`Payload capacity\``
		]);
		expect(row(ws, 'SYS-002')).toMatchObject({ satisfiedBy: [], verifiedBy: [] });
	});

	it('a file rename changes the engine’s element ids but not the ID, links, coverage or review', async () => {
		const files = sorted(demo.map((f) => (f.path === R ? { ...f, path: 'reqs/System.sysml' } : f)));
		const idOf = (fs: File[]) =>
			host
				.analyzeProject(fs)
				.flatMap((a) => a.model.usages)
				.find((u) => u.short_name?.includes('SYS-001'))!.id;
		// Internal ids derive from the file (unit) name: they are not an identity to rely on.
		expect(idOf(files)).not.toBe(idOf(demo));
		const ws = await workspace(files);
		expect(problems(ws)).toEqual([]);
		expect(row(ws, 'SYS-001')).toMatchObject({
			satisfiedBy: ['drone'],
			verifiedBy: ['enduranceFlightTest']
		});
		expect(ws.coverage).toEqual(DEMO_COVERAGE);
		expect(lines(review(demo, files))).toEqual([
			'Other: Moved package `SystemRequirements` to the file `reqs/System.sysml`'
		]);
	});

	it('a clean Git merge of a rename and a new link by the old name reports the dangling link', async () => {
		const renamed = asMap(renamedByEngine());
		const base = asMap(demo)[S]!;
		const theirs = base.replace(
			'    // Open gaps',
			"    satisfy 'Flight endurance' by drone.battery;\n\n    // Open gaps"
		);
		const merged = merge3(base, renamed[S]!, theirs);
		expect(merged).not.toBeNull(); // no textual conflict
		const files = asList({ ...renamed, [S]: merged! });
		const ws = await workspace(files);
		expect(problems(ws)).toEqual([
			`warning ${S}:${lineOf(files, S, "satisfy 'Flight endurance' by drone.battery")} unresolved reference \`Flight endurance\``
		]);
	});

	it('a clean Git merge that gives two requirements one ID in one package is an error', async () => {
		const base = asMap(demo)[R]!;
		const mine = base.replace(
			'    // ---- Environment ----',
			"    requirement <'SYS-012'> 'Night noise' : DroneRequirement;\n\n    // ---- Environment ----"
		);
		const theirs = base.replace(
			'    // ---- Safety ----',
			"    requirement <'SYS-012'> 'Landing light' : DroneRequirement;\n\n    // ---- Safety ----"
		);
		const merged = merge3(base, mine, theirs);
		expect(merged).not.toBeNull();
		const ws = await workspace(asList({ ...asMap(demo), [R]: merged! }));
		expect(problems(ws).filter((p) => p.startsWith('error'))).toEqual([
			expect.stringMatching(/SYS-012.*already used/)
		]);
	});

	it('two requirements in different packages sharing an ID are flagged at each', async () => {
		const files = sorted([
			...demo,
			{
				path: 'requirements/Extra.sysml',
				text: "package ExtraRequirements {\n    requirement <'SYS-001'> 'Another endurance';\n}\n"
			}
		]);
		const ws = await workspace(files);
		expect(problems(ws).filter((p) => p.includes('SYS-001')).length).toBeGreaterThanOrEqual(2);
	});
});

describe('traceability and gaps', { timeout: 120_000 }, () => {
	it('coverage comes from the satisfy and verify relationships, and follows them', async () => {
		const ws = await workspace(
			edit(
				edit(
					demo,
					S,
					'    // Open gaps',
					"    satisfy 'Ingress protection' by drone;\n    // Open gaps"
				),
				V,
				"objective { verify 'Command and telemetry link'; }",
				'objective { }'
			)
		);
		expect(row(ws, 'SYS-005')!.satisfiedBy).toEqual(['drone']);
		expect(row(ws, 'SYS-010')!.verifiedBy).toEqual([]);
		// By the rule: the need SYS-005 is derived from (STK-003) is satisfied now, and the one
		// SYS-010 is derived from (STK-001) no longer verified.
		expect(row(ws, 'STK-003')!.satisfied).toBe('derived');
		expect(row(ws, 'STK-001')!.verified).toBeNull();
		expect(ws.coverage).toEqual({ total: 24, satisfied: 22, verified: 14, passed: 0 });
	});

	it('the home view’s gaps and the Requirement gaps table name the same requirements', async () => {
		const files = edit(
			demo,
			'views/Views.sysml',
			'    // Diagrams.',
			'    view gaps : RequirementGaps;\n    // Diagrams.'
		);
		const ws = await workspace(files);
		// The home view's gaps, by the one coverage rule (`HomeView.svelte`).
		const home = ws.requirements
			.filter((r) => !r.satisfied || !r.verified)
			.map((r) => r.id)
			.sort();
		const table = host.renderView(files, 'gaps');
		const ids = table.rows.map((r) => r[table.columns.indexOf('id')]!).sort();
		expect(ids).toEqual(home);
		expect(home).toEqual(
			expect.arrayContaining(['SYS-005', 'SYS-006', 'SYS-011', 'RC-003', 'RC-007'])
		);
		// A need whose derived requirements are all satisfied and verified is not a gap.
		expect(home).not.toContain('STK-001');
	});

	it('a satisfy whose target is not a requirement is an error', async () => {
		const ws = await workspace(
			edit(demo, S, '    // Open gaps', '    satisfy drone by drone.battery;\n    // Open gaps')
		);
		expect(problems(ws)).toEqual([
			expect.stringMatching(
				/^error system\/Satisfaction\.sysml:\d+ SatisfyRequirementUsage must reference a RequirementUsage/
			)
		]);
	});

	it('a circular derivation is reported, naming the circle', async () => {
		const files = edit(
			demo,
			R,
			'    // ---- Derivation: which need each requirement comes from ----',
			"    #derivation connection { end #original ::> 'Flight endurance'; end #derive ::> 'Payload capacity'; }\n" +
				"    #derivation connection { end #original ::> 'Payload capacity'; end #derive ::> 'Flight endurance'; }\n"
		);
		const ws = await workspace(files);
		expect(problems(ws).filter((p) => /circular|cycle/i.test(p))).toEqual([
			`warning ${R}:${lineOf(files, R, "end #original ::> 'Flight endurance'; end #derive ::> 'Payload capacity'")} Circular derivation: SYS-001 Flight endurance → SYS-002 Payload capacity → SYS-001 Flight endurance. A requirement can’t be derived, through others, from itself.`
		]);
	});

	it('an FMEA line naming a risk control that does not exist is reported at the line', async () => {
		const files = edit(demo, FM, "riskControls = 'RC-001';", "riskControls = 'RC-099';");
		const ws = await workspace(files);
		expect(problems(ws)).toEqual([
			`warning ${FM}:${lineOf(files, FM, "riskControls = 'RC-099'")} unresolved reference \`RC-099\``
		]);
	});

	it('an architecture rename carries the FMEA line with it; removing the part orphans it visibly', async () => {
		const result = editFiles(host, asMap(demo), {
			op: 'rename',
			path: A,
			from: 'battery',
			to: 'powerPack',
			line: lineOf(demo, A, 'part battery : Battery;')
		});
		if ('error' in result) throw new Error(result.error);
		const renamed = asList(result.files);
		expect(problems(await workspace(renamed))).toEqual([]);
		const sheet = host.renderView(renamed, 'fmeaWorksheet');
		expect(sheet.rows.map((r) => r[0])).toContain('drone::powerPack');

		const removed = edit(demo, A, '        part battery : Battery;\n', '');
		const ws = await workspace(removed);
		expect(problems(ws)).toContain(
			`warning ${FM}:${lineOf(removed, FM, '@Fmea about drone::battery')} unresolved reference \`drone::battery\``
		);
	});

	it('a verification case’s planned verdict is not a recorded result: checks come from design values', () => {
		const checks = host.checks(demo).checks;
		// Checks are requirement constraints and assertions evaluated against the design…
		expect(checks.some((c) => c.requirement?.id === 'SYS-001' && c.status === 'satisfied')).toBe(
			true
		);
		// …and no verification case (VC-001 enduranceFlightTest, `verdict = PassIf(…)`) is one of them.
		expect(checks.filter((c) => /enduranceFlightTest|VC-0/.test(JSON.stringify(c)))).toEqual([]);
	});

	// The DSM's "no links" flag used to ignore links to elements outside the matrix, so with
	// allocations counted every step of the delivery flight was flagged, allocated or not.
	it('the functional DSM, counting allocations, flags only steps no part is allocated', () => {
		const files = edit(
			demo,
			'behaviour/Allocation.sysml',
			'    allocate drone.deliveryFlight.land to drone.flightController;\n',
			''
		);
		const m = host.dependencyMatrix(files, 'deliveryFlightDsm');
		expect(m.available).toContain('allocation');
		const flagged = reviewFlags(m, ['allocation']).unlinked.map((i) => m.items[i]!.name);
		// `land` is the one step left without an allocation.
		expect(flagged).toContain('land');
		expect(flagged).not.toContain('takeOff');
	});
});

describe('impact of a requirement change', { timeout: 120_000 }, () => {
	it('a tighter limit shows the verdict it breaks first in the review', () => {
		const s = review(
			demo,
			edit(demo, R, '{ system.endurance >= 25 [min] }', '{ system.endurance >= 35 [min] }')
		);
		expect(s.impact[0]!.text).toMatch(
			/now violates `SYS-001` ‘Flight endurance’ \(27\.54 min < 35 min\)$/
		);
	});

	it('the related panel shows one hop: what satisfies, verifies and derives a requirement', () => {
		const id = host
			.analyzeProject(demo)
			.flatMap((a) => a.model.usages)
			.find((u) => u.short_name?.includes('SYS-001'))!.id!;
		const related = host.related(demo, id).map((r) => `${r.direction} ${r.kind} ${r.element.name}`);
		expect(related).toEqual(
			expect.arrayContaining([
				'in satisfies drone',
				'in verifies enduranceFlightTest',
				'out derives Parcel delivery'
			])
		);
	});

	it('the requirement DSM’s change impact follows derivation from a need', () => {
		const m = host.dependencyMatrix(demo, 'requirementDsm');
		const start = m.items.findIndex((i) => i.shortName === 'STK-001');
		const reached = [...impactOf(m, m.kinds, start).keys()].map((i) => m.items[i]!.shortName);
		expect(reached.sort()).toEqual(['SYS-001', 'SYS-002', 'SYS-010']);
	});

	it('the related panel of a risk control lists the FMEA lines that rely on it', () => {
		const id = host
			.analyzeProject(demo)
			.flatMap((a) => a.model.usages)
			.find((u) => u.short_name?.includes('RC-001'))!.id!;
		const related = host.related(demo, id).map((r) => `${r.kind} ${r.element.qualifiedName}`);
		// The line `@Fmea about drone::battery { riskControls = 'RC-001'; … }`: by the part it is about.
		expect(related.some((r) => r.endsWith(' DroneArchitecture::drone::battery'))).toBe(true);
	});

	it('a reworded risk control names the verification, mitigation and FMEA line it affects', () => {
		const said = lines(
			review(
				demo,
				edit(
					demo,
					FM,
					'shall disconnect the pack and alert',
					'shall disconnect the pack within 1 s and alert'
				)
			)
		).join('\n');
		expect(said).toContain('RC-001');
		expect(said).toContain('batteryAbuseTest');
		expect(said).toContain('batteryManagementSystem');
		expect(said).toMatch(/drone\.battery|Thermal runaway/);
	});
});

describe('modelling conventions', { timeout: 120_000 }, () => {
	it('a view marked as a convention lists what breaks it under Problems, at each element', async () => {
		const files = edit(
			demo,
			'views/Views.sysml',
			'    // Diagrams.',
			'    view noOwner : RequirementsTable {\n' +
				'        @TableRendering { where = "owner == \\"\\""; }\n' +
				'        @Convention { rule = "Every requirement names its owner."; }\n' +
				'    }\n    // Diagrams.'
		);
		const ws = await workspace(files);
		const broken = problems(ws).filter((p) => p.includes('convention noOwner'));
		expect(broken).toHaveLength(7);
		expect(broken[0]).toBe(
			`warning ${FM}:${lineOf(files, FM, "requirement <'RC-001'>")} Every requirement names its owner. (convention noOwner): RC-001`
		);
		// The rest of the model breaks nothing new.
		expect(problems(ws).filter((p) => !p.includes('convention noOwner'))).toEqual([]);
	});

	it('a saved view with `where` lists the requirements that break a convention (no owner)', () => {
		const files = edit(
			demo,
			'views/Views.sysml',
			'    // Diagrams.',
			'    view noOwner : RequirementsTable { @TableRendering { where = "owner == \\"\\""; } }\n    // Diagrams.'
		);
		const t = host.renderView(files, 'noOwner');
		expect(t.rows.map((r) => r[0]).sort()).toEqual([
			'RC-001',
			'RC-002',
			'RC-003',
			'RC-004',
			'RC-005',
			'RC-006',
			'RC-007'
		]);
	});
});
