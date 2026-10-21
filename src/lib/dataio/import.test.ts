/**
 * Importing requirements into the demo model, checked with the real engine
 * (WebAssembly in Node): the generated SysML parses, resolves and reads
 * back as the requirements in the sheet.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { editFiles } from '#lib/engine/toolkit/edit-testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { Analysis, EditRequest } from '#lib/engine/types.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import { parseDelimited } from './csv';
import {
	applyImport,
	hasImport,
	membersText,
	withImports,
	type ImportWorkspace
} from './import-apply';
import {
	buildContext,
	defaultDef,
	detectHeaderRow,
	detectTargets,
	enumLiterals,
	freshTarget,
	matchLiteral,
	planImport,
	splitList,
	type ImportContext,
	type ImportOptions
} from './import-plan';

let host: ToolkitHost;
let demo: Record<string, string>;

beforeAll(async () => {
	host = await loadHost();
	demo = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
}, 60_000);

function analyse(files: Record<string, string>): Analysis[] {
	return host.analyzeProject(Object.entries(files).map(([path, text]) => ({ path, text })));
}

function contextFor(files: Record<string, string>): ImportContext {
	const analyses = analyse(files);
	return buildContext(analyses, files, collectRequirements(analyses));
}

/** A workspace over plain texts, editing through the toolkit as the app does. */
function fakeWorkspace(start: Record<string, string>): ImportWorkspace & {
	files: Record<string, string>;
} {
	const ws = {
		files: { ...start },
		text: (path: string) => ws.files[path],
		setText: (path: string, text: string) => {
			ws.files[path] = text;
		},
		get modelPaths() {
			return Object.keys(ws.files);
		},
		sourceFiles: () => Object.entries(ws.files).map(([path, text]) => ({ path, text })),
		async edit(path: string, request: EditRequest) {
			const edited = editFiles(host, ws.files, { ...request, path });
			if ('error' in edited) return edited.error;
			ws.files = edited.files;
			return null;
		}
	};
	return ws;
}

const SHEET = [
	'Req ID;Title;Requirement text;Priority;Verification;Status;Owner;Notes;Parent',
	'SYS-101;Landing light;The drone shall show a light visible from 50 m when it lands.;High;T/I;Open;Zoë Åberg;;STK-002',
	'SYS-102;"Pilot\'s ""abort"" switch";"The pilot shall be able to abort a delivery */ and return home.\nAt any time.";must;Demonstration;Draft;;n/a;SYS-101',
	'SYS-001;Flight endurance;Changed text;low;;;;;',
	'SYS-101;Duplicate;Twice;;;;;;',
	';;;;;;;;',
	'SYS-103;;Only an ID and a text;Urgent;;tbc;;;STK-999'
].join('\n');

function optionsFor(context: ImportContext, rows: string[][], extra: Partial<ImportOptions> = {}) {
	const def = context.defs.find((d) => d.label === 'DroneRequirement')!;
	const fresh = freshTarget(context);
	return {
		targets: detectTargets(rows[0]!, def),
		def,
		destination: { kind: 'new', ...fresh },
		existing: 'skip',
		...extra
	} as ImportOptions;
}

describe('reading the model', () => {
	it('finds requirement definitions with their attributes and enumerations', () => {
		const context = contextFor(demo);
		const drone = context.defs.find((d) => d.label === 'DroneRequirement')!;
		expect(drone.package).toBe('SystemRequirements');
		expect(drone.attributes.map((a) => [a.name, a.valueKind, a.many, a.enumPackage])).toEqual([
			['kind', 'enum', false, 'EngineeringBasics'],
			['priority', 'enum', false, 'EngineeringBasics'],
			['verificationMethod', 'enum', true, 'EngineeringBasics']
		]);
		expect(drone.attributes[1]!.literals).toEqual(['high', 'medium', 'low']);
		expect(defaultDef(context)?.label).toBe('DroneRequirement');
		expect(context.byId.get('SYS-001')?.qualifiedName).toBe(
			"SystemRequirements::'Flight endurance'"
		);
		expect(context.byId.get('SYS-001')?.values['feature:priority']).toBe('high');
		expect(context.byId.get('STK-001')?.values['metadata:StatusInfo.originator']).toBe(
			'Operations'
		);
		expect(freshTarget(context)).toEqual({ path: 'requirements/Imported.sysml', name: 'Imported' });
		expect(context.packages.some((p) => p.qualifiedName === 'SystemRequirements')).toBe(true);
	});

	it('reads enumeration literals from their text', () => {
		expect(
			enumLiterals(`enum def Level {
				doc /* How bad; with a semicolon. */
				enum low;
				medium;
				enum 'very high' { doc /* x */ }
				// enum ignored;
			}`)
		).toEqual(['low', 'medium', 'very high']);
	});
});

describe('columns and values', () => {
	it('recognises common headings', () => {
		expect(
			detectTargets(
				[
					'Req ID',
					'Name',
					'Shall statement',
					'Prio',
					'Verification method',
					'State',
					'Responsible',
					'Justification',
					'Derived from',
					'Type',
					'Colour'
				],
				{ name: 'D', label: 'D', package: null, file: '', used: 0, attributes: [] }
			)
		).toEqual([
			'id',
			'name',
			'doc',
			'attr:priority',
			'attr:verificationMethod',
			'status',
			'owner',
			'rationale',
			'parent',
			'attr:kind',
			''
		]);
	});

	it('uses each target once and matches the definition’s own attribute names', () => {
		const def = {
			name: 'D',
			label: 'D',
			package: null,
			file: '',
			used: 0,
			attributes: [
				{ name: 'safetyLevel', type: 'String', valueKind: 'string' as const, many: false }
			]
		};
		expect(detectTargets(['ID', 'Number', 'Safety level'], def)).toEqual([
			'id',
			'',
			'attr:safetyLevel'
		]);
	});

	it('finds the heading row below a title', () => {
		expect(
			detectHeaderRow([['Drone requirements, issue 3'], [], ['ID', 'Text'], ['R1', 'x']])
		).toBe(2);
		expect(
			detectHeaderRow([
				['A', 'B'],
				['1', '2']
			])
		).toBe(0);
	});

	it('matches values to enumeration literals forgivingly', () => {
		const methods = ['test', 'analysis', 'inspection', 'demonstration'];
		expect(splitList('T/A').map((v) => matchLiteral(v, methods))).toEqual(['test', 'analysis']);
		expect(matchLiteral('Inspection', methods)).toBe('inspection');
		expect(matchLiteral('Must', ['high', 'medium', 'low'])).toBe('high');
		expect(matchLiteral('To be confirmed', ['open', 'tbc'])).toBe('tbc');
		expect(matchLiteral('Draft', ['open', 'done'])).toBeNull();
		expect(splitList('test, analysis and inspection')).toEqual(['test', 'analysis', 'inspection']);
	});
});

describe('planning an import', () => {
	it('creates new rows, skips existing and duplicate IDs, and explains what it left out', () => {
		const context = contextFor(demo);
		const rows = parseDelimited(SHEET).rows;
		const plan = planImport(rows.slice(1), 2, optionsFor(context, rows), context);
		expect(plan.create.map((p) => [p.spec.id, p.spec.name])).toEqual([
			['SYS-101', 'Landing light'],
			['SYS-102', 'Pilot’s "abort" switch'],
			['SYS-103', 'SYS-103']
		]);
		expect(plan.skipped).toEqual([
			{ line: 4, reason: 'SYS-001 is already in the model' },
			{ line: 5, reason: 'SYS-101 appears more than once in the sheet' }
		]);
		expect(plan.create[0]!.spec).toMatchObject({
			type: 'DroneRequirement',
			status: 'open',
			owner: 'Zoë Åberg',
			attributes: [
				{ name: 'priority', value: { literals: ['high'] } },
				{ name: 'verificationMethod', value: { literals: ['test', 'inspection'] } }
			]
		});
		expect(plan.notes).toEqual([
			'Statuses that are not one of open, tbd, tbr, tbc, done, closed, left out: ‘Draft’.',
			'Priority values that are not one of high, medium, low, left out: ‘Urgent’.',
			'Parent IDs that are not in the model or the sheet, so no derivation was made: ‘STK-999’.'
		]);
		expect(plan.derivations).toEqual([
			{ original: "StakeholderNeeds::'Safe operation'", derived: ["'Landing light'"] },
			{ original: "'Landing light'", derived: ['\'Pilot’s "abort" switch\''] }
		]);
		expect(plan.imports).toEqual([
			'ModelingMetadata::*',
			'RequirementDerivation::*',
			'EngineeringBasics::*',
			'SystemRequirements::DroneRequirement'
		]);
	});

	it('plans updates for the fields that differ', () => {
		const context = contextFor(demo);
		const rows = parseDelimited(SHEET).rows;
		const plan = planImport(
			rows.slice(1),
			2,
			optionsFor(context, rows, { existing: 'update' }),
			context
		);
		expect(plan.update).toHaveLength(1);
		expect(plan.update[0]!.changes.map((c) => [c.field, c.from, c.to])).toEqual([
			[
				'doc',
				'The drone shall fly for at least 25 minutes with a 1 kg payload in still air before it reaches its landing reserve.',
				'Changed text'
			],
			['feature:priority', 'high', 'low']
		]);
	});
});

describe('applying an import', () => {
	it('writes a new file that parses, resolves and reads back as the sheet', async () => {
		const context = contextFor(demo);
		const rows = parseDelimited(SHEET).rows;
		const options = optionsFor(context, rows);
		const plan = planImport(rows.slice(1), 2, options, context);
		const ws = fakeWorkspace(demo);
		const result = await applyImport(ws, plan, options, 'Requirements imported from sheet.csv.');
		expect(result).toEqual({ created: 3, updated: 0, path: 'requirements/Imported.sysml' });
		const text = ws.files['requirements/Imported.sysml']!;
		expect(text).toMatchInlineSnapshot(`
			"package Imported {
			    doc /* Requirements imported from sheet.csv. */

			    private import ModelingMetadata::*;
			    private import RequirementDerivation::*;
			    private import EngineeringBasics::*;
			    private import SystemRequirements::DroneRequirement;

			    requirement <'SYS-101'> 'Landing light' : DroneRequirement {
			        doc /* The drone shall show a light visible from 50 m when it lands. */
			        :>> priority = Priority::high;
			        :>> verificationMethod = (VerificationMethod::test, VerificationMethod::inspection);
			        @StatusInfo { status = StatusKind::open; owner = "Zoë Åberg"; }
			    }

			    requirement <'SYS-102'> 'Pilot’s "abort" switch' : DroneRequirement {
			        doc /* The pilot shall be able to abort a delivery * / and return home.
			             * At any time. */
			        :>> priority = Priority::high;
			        :>> verificationMethod = VerificationMethod::demonstration;
			    }

			    requirement <'SYS-103'> 'SYS-103' : DroneRequirement {
			        doc /* Only an ID and a text */
			        @StatusInfo { status = StatusKind::tbc; }
			    }

			    #derivation connection {
			        end #original ::> StakeholderNeeds::'Safe operation';
			        end #derive ::> 'Landing light';
			    }

			    #derivation connection {
			        end #original ::> 'Landing light';
			        end #derive ::> 'Pilot’s "abort" switch';
			    }
			}
			"
		`);

		const analyses = analyse(ws.files);
		const imported = analyses.find((a) => a.model.file === 'requirements/Imported.sysml')!;
		expect(imported.model.syntax_errors).toEqual([]);
		expect(imported.diagnostics.filter((d) => d.severity !== 'note')).toEqual([]);
		const read = collectRequirements(analyses).filter(
			(r) => r.file === 'requirements/Imported.sysml'
		);
		expect(
			read.map((r) => [r.id, r.title, r.priority, r.verificationMethods, r.status, r.owner])
		).toEqual([
			['SYS-101', 'Landing light', 'high', ['test', 'inspection'], 'open', 'Zoë Åberg'],
			['SYS-102', 'Pilot’s "abort" switch', 'high', ['demonstration'], null, null],
			['SYS-103', 'SYS-103', null, [], 'tbc', null]
		]);
	});

	it('adds to an existing package after its imports, writing what it lacks', async () => {
		const context = contextFor(demo);
		const rows = parseDelimited(SHEET).rows;
		const target = context.packages.find((p) => p.qualifiedName === 'StakeholderNeeds')!;
		const options = optionsFor(context, rows, {
			destination: { kind: 'package', package: target }
		});
		const plan = planImport(rows.slice(1), 2, options, context);
		expect(plan.imports).toEqual([
			'ModelingMetadata::*',
			'RequirementDerivation::*',
			'EngineeringBasics::*',
			'SystemRequirements::DroneRequirement'
		]);
		// Inside the package, a parent in the same package is named without qualification.
		expect(plan.derivations[0]!.original).toBe("'Safe operation'");
		const ws = fakeWorkspace(demo);
		const result = await applyImport(ws, plan, options, '');
		expect(result).toMatchObject({ created: 3, path: 'requirements/StakeholderNeeds.sysml' });
		const text = ws.files['requirements/StakeholderNeeds.sysml']!;
		expect(text).toContain(
			"    private import DeliveryContext::*;\n    private import RequirementDerivation::*;\n    private import SystemRequirements::DroneRequirement;\n\n    requirement <'STK-001'>"
		);
		expect(text.match(/import ModelingMetadata/g)).toHaveLength(1);
		expect(text).toMatch(
			/originator = "Customer Service"; }\n {4}}\n\n {4}requirement <'SYS-101'>/
		);
		const analyses = analyse(ws.files);
		const file = analyses.find((a) => a.model.file === 'requirements/StakeholderNeeds.sysml')!;
		expect(file.model.syntax_errors).toEqual([]);
		expect(file.diagnostics.filter((d) => d.severity !== 'note')).toEqual([]);
	});

	it('updates the fields that differ through the engine', async () => {
		const context = contextFor(demo);
		const rows = parseDelimited(
			'ID,Title,Priority,Status,Owner\nSYS-001,Flight time,low,open,J. Hale\nSYS-004,Wind tolerance,medium,closed,'
		).rows;
		const options = optionsFor(context, rows, { existing: 'update' });
		const plan = planImport(rows.slice(1), 2, options, context);
		expect(plan.update.map((u) => u.changes.map((c) => c.field))).toEqual([
			['name', 'feature:priority', 'metadata:StatusInfo.status'],
			['metadata:StatusInfo.status']
		]);
		const ws = fakeWorkspace(demo);
		expect(await applyImport(ws, plan, options, '')).toEqual({
			created: 0,
			updated: 2,
			path: null
		});
		const read = collectRequirements(analyse(ws.files));
		const sys1 = read.find((r) => r.id === 'SYS-001')!;
		expect([sys1.title, sys1.priority, sys1.status]).toEqual(['Flight time', 'low', 'open']);
		expect(read.find((r) => r.id === 'SYS-004')!.status).toBe('closed');
		// The rename reached the references in other files.
		expect(ws.files['requirements/SystemRequirements.sysml']).toContain(
			"end #derive ::> 'Flight time';"
		);
		// Every reference is renamed; prose that mentions the old name (a doc comment) is not.
		expect(
			Object.values(ws.files)
				.join('\n')
				.match(/'Flight endurance'/g)
		).toHaveLength(1);
		expect(ws.files['analysis/Performance.sysml']).toContain(
			"Show that 'Flight endurance' (SYS-001)"
		);
	});

	it('writes 500 rows in one engine edit, quickly', async () => {
		const context = contextFor(demo);
		const header = ['ID', 'Title', 'Text', 'Priority', 'Status'];
		const body = Array.from({ length: 500 }, (_, i) => [
			`BIG-${i + 1}`,
			`Requirement number ${i + 1}`,
			`The system shall do thing ${i + 1} within ${i} ms, as described in the specification.`,
			['high', 'medium', 'low'][i % 3]!,
			'open'
		]);
		const options = optionsFor(context, [header]);
		const plan = planImport(body, 2, options, context);
		const ws = fakeWorkspace(demo);
		const started = performance.now();
		const result = await applyImport(ws, plan, options, '');
		expect(performance.now() - started).toBeLessThan(2000);
		expect(result).toMatchObject({ created: 500 });
		const read = collectRequirements(analyse(ws.files)).filter((r) => r.id?.startsWith('BIG-'));
		expect(read).toHaveLength(500);
	});
});

describe('emitted text', () => {
	it('matches what the engine writes when the same fields are set one by one in a table', async () => {
		const spec = {
			id: 'SYS-201',
			name: 'Night operation',
			type: 'DroneRequirement',
			doc: 'The drone shall fly at night.',
			attributes: [
				{
					name: 'kind',
					value: {
						kind: 'enum' as const,
						enumName: 'RequirementKind',
						literals: ['functional'],
						many: false
					}
				},
				{
					name: 'priority',
					value: { kind: 'enum' as const, enumName: 'Priority', literals: ['low'], many: false }
				},
				{
					name: 'verificationMethod',
					value: {
						kind: 'enum' as const,
						enumName: 'VerificationMethod',
						literals: ['test', 'analysis'],
						many: true
					}
				}
			],
			status: 'open',
			owner: 'R. Tanaka',
			rationale: 'Winter "evenings".'
		};
		const path = 'requirements/SystemRequirements.sysml';
		const ws = fakeWorkspace(demo);
		const insert = (text: string) =>
			ws.edit(path, {
				op: 'insertMember',
				path,
				source: ws.files[path]!,
				parent: 'SystemRequirements',
				text
			});
		expect(
			await insert(
				"requirement <'SYS-201'> 'Night operation' : DroneRequirement {\n    doc /* The drone shall fly at night. */\n}"
			)
		).toBeNull();
		const line = ws.files[path]!.split('\n').findIndex((l) => l.includes("<'SYS-201'>")) + 1;
		for (const [field, value] of [
			['feature:kind', 'functional'],
			['feature:priority', 'low'],
			['feature:verificationMethod', 'test, analysis'],
			['metadata:StatusInfo.status', 'open'],
			['metadata:StatusInfo.owner', 'R. Tanaka'],
			['metadata:Rationale.text', 'Winter "evenings".']
		] as const) {
			const error = await ws.edit(path, {
				op: 'setField',
				path,
				source: ws.files[path]!,
				element: "SystemRequirements::'Night operation'",
				line,
				field,
				value,
				files: ws.sourceFiles()
			});
			expect(error).toBeNull();
		}
		const byEngine = ws.files[path]!;
		const ours = fakeWorkspace(demo);
		ours.files[path] = demo[path]!;
		const { requirementText } = await import('./sysml-text');
		await ours.edit(path, {
			op: 'insertMember',
			path,
			source: ours.files[path]!,
			parent: 'SystemRequirements',
			text: requirementText(spec)
		});
		expect(ours.files[path]).toBe(byEngine);
	});
});

describe('import text helpers', () => {
	it('knows when an import is already there', () => {
		const text = 'package P {\n    private import ISQ::*;\n    import A::B;\n}';
		expect(hasImport(text, 'ISQ::*')).toBe(true);
		expect(hasImport(text, 'A::B')).toBe(true);
		expect(hasImport(text, 'A::*')).toBe(false);
		expect(hasImport('private import A::*;', 'A::B')).toBe(true);
	});

	it('places imports after the doc comment when the package has none', () => {
		expect(withImports('package P {\n    doc /* About P. */\n    part x;\n}\n', 1, ['A::*'])).toBe(
			'package P {\n    doc /* About P. */\n\n    private import A::*;\n\n    part x;\n}\n'
		);
		expect(withImports('package P {\n}\n', 1, ['A::*'])).toBe(
			'package P {\n    private import A::*;\n}\n'
		);
		expect(
			withImports('package P {\n    doc\n    /*\n     * Long.\n     */\n\n    part x;\n}', 1, [
				'A::*'
			])
		).toBe(
			'package P {\n    doc\n    /*\n     * Long.\n     */\n\n    private import A::*;\n\n    part x;\n}'
		);
	});

	it('emits members separated by blank lines', () => {
		const context = contextFor(demo);
		const rows = [
			['ID', 'Title'],
			['X-1', 'One'],
			['X-2', 'Two']
		];
		const plan = planImport(rows.slice(1), 2, optionsFor(context, rows), context);
		expect(membersText(plan)).toBe(
			"requirement <'X-1'> One : DroneRequirement;\n\nrequirement <'X-2'> Two : DroneRequirement;"
		);
	});
});
