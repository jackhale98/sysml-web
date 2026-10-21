/**
 * Model edits on the toolkit (`edits.ts`), through the host the worker runs,
 * on the demo. The lines each edit changes are pinned in a snapshot
 * (`__snapshots__/edits.test.ts.snap`, recorded when they still matched what
 * the earlier engine wrote, byte for byte); the edits that engine got wrong
 * are asserted below with the reason.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../client';
import type { EditOperation, EditRequest } from '../types';
import { Workspace } from '#lib/project/workspace.svelte.ts';
import { editFiles } from './edit-testing';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
const files = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(demoFiles());
}, 60_000);

type Request = EditOperation & { path: string };

const C = 'system/Components.sysml';
const A = 'system/DroneArchitecture.sysml';
const R = 'requirements/SystemRequirements.sysml';
const I = 'interfaces/DroneInterfaces.sysml';
const FLIGHT = "SystemRequirements::'Flight endurance'";

function ours(request: Request) {
	const edited = editFiles(host, files, request);
	if ('error' in edited) throw new Error(edited.error);
	return { text: edited.files[request.path]!, files: edited.files, result: edited.result };
}

/** The lines an edit changed in a text, as `-` and `+` lines, as a diff shows them. */
function changedLines(before: string, after: string): string {
	const a = before.split('\n');
	const b = after.split('\n');
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let end = 0;
	while (
		end < a.length - start &&
		end < b.length - start &&
		a[a.length - 1 - end] === b[b.length - 1 - end]
	)
		end++;
	return [
		...a.slice(start, a.length - end).map((line) => `- ${line}`),
		...b.slice(start, b.length - end).map((line) => `+ ${line}`)
	].join('\n');
}

/** Edits whose changed lines are pinned in the snapshot. */
const pinned: [string, Request][] = [
	[
		'adds a definition with a body to a package',
		{
			op: 'insertMember',
			path: C,
			parent: 'DroneComponents',
			text: 'part def Parachute :> Component {\n    attribute :>> mass = 300 [g];\n}'
		}
	],
	[
		'appends a package to a file',
		{ op: 'insertTopLevel', path: C, text: 'package Spares {\n    part def SpareBattery;\n}' }
	],
	['removes an attribute nothing refers to', { op: 'remove', path: C, name: 'maxPower' }],
	['renames a definition in its file', { op: 'rename', path: C, from: 'Propeller', to: 'Prop' }],
	[
		'changes a multiplicity written after the type',
		{ op: 'setDeclaration', path: A, element: 'rotors', line: 44, set: { multiplicity: '6' } }
	],
	[
		'adds a multiplicity after the name',
		{ op: 'setDeclaration', path: A, element: 'battery', line: 36, set: { multiplicity: '2' } }
	],
	[
		'changes a direction',
		{ op: 'setDeclaration', path: I, element: 'power', line: 57, set: { direction: 'inout' } }
	],
	[
		'removes a direction',
		{ op: 'setDeclaration', path: I, element: 'power', line: 57, set: { direction: null } }
	],
	[
		'adds a specialization',
		{
			op: 'setDeclaration',
			path: C,
			element: 'Camera',
			line: 0,
			set: { specializes: ['Component', 'Airframe'] }
		}
	],
	[
		'removes the specializations',
		{ op: 'setDeclaration', path: C, element: 'Airframe', line: 0, set: { specializes: [] } }
	],
	[
		'makes a definition abstract',
		{ op: 'setDeclaration', path: C, element: 'Camera', line: 0, set: { abstract: true } }
	],
	[
		'makes a definition concrete',
		{ op: 'setDeclaration', path: C, element: 'Component', line: 0, set: { abstract: false } }
	],
	[
		'changes a value',
		{ op: 'setDeclaration', path: C, element: 'capacity', line: 0, set: { value: '300 [W*h]' } }
	],
	[
		'removes a value',
		{ op: 'setDeclaration', path: C, element: 'capacity', line: 0, set: { value: null } }
	],
	[
		'makes a value a default',
		{ op: 'setDeclaration', path: C, element: 'capacity', line: 0, set: { valueKind: 'default' } }
	],
	[
		'changes a one-line doc comment',
		{
			op: 'setDeclaration',
			path: C,
			element: 'Battery',
			line: 0,
			set: { doc: 'A new description.' }
		}
	],
	[
		'lays out a doc comment like the one it replaces',
		{
			op: 'setDeclaration',
			path: C,
			element: 'Rotor',
			line: 0,
			set: { doc: 'One unit.\nTwo lines.' }
		}
	],
	[
		'wraps a long doc comment to the old one’s width',
		{
			op: 'setDeclaration',
			path: C,
			element: 'DroneComponents',
			line: 0,
			set: {
				doc: 'The component catalogue: a very long single line that keeps going well past the width of the old comment so that it wraps.'
			}
		}
	],
	[
		'removes a doc comment',
		{ op: 'setDeclaration', path: C, element: 'Battery', line: 0, set: { doc: null } }
	],
	[
		'gives a declaration without a body a doc comment',
		{ op: 'setDeclaration', path: C, element: 'maxPower', line: 0, set: { doc: 'Peak power.' } }
	],
	[
		'adds a short name',
		{ op: 'setDeclaration', path: C, element: 'Battery', line: 0, set: { shortName: 'BAT' } }
	],
	[
		'changes a short name (a label as the element)',
		{
			op: 'setDeclaration',
			path: R,
			element: 'Flight endurance',
			line: 22,
			set: { shortName: 'SYS-101' }
		}
	],
	[
		'removes a short name',
		{
			op: 'setDeclaration',
			path: R,
			element: 'Flight endurance',
			line: 22,
			set: { shortName: null }
		}
	],
	[
		'sets an enum cell',
		{ op: 'setField', path: R, element: FLIGHT, line: 22, field: 'feature:priority', value: 'low' }
	],
	[
		'clears an enum cell',
		{ op: 'setField', path: R, element: FLIGHT, line: 22, field: 'feature:priority', value: '' }
	],
	[
		'sets a list of enum literals, quoting a keyword',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'feature:verificationMethod',
			value: 'test, analysis'
		}
	],
	[
		'sets a metadata field',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'metadata:StatusInfo.status',
			value: 'open'
		}
	],
	[
		'adds a field to a one-line annotation',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'metadata:StatusInfo.originator',
			value: 'Ops'
		}
	],
	[
		'clears a field inside a one-line annotation',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'metadata:StatusInfo.owner',
			value: ''
		}
	],
	[
		'changes a string field',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'metadata:Rationale.text',
			value: 'Short.'
		}
	],
	[
		'removes an annotation whose only field is cleared',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'metadata:Rationale.text',
			value: ''
		}
	],
	[
		'adds an annotation after the others',
		{
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'metadata:Issue.text',
			value: 'Check the reserve.'
		}
	],
	[
		'sets a short name cell',
		{ op: 'setField', path: R, element: FLIGHT, line: 22, field: 'shortName', value: 'SYS-101' }
	],
	[
		'sets a doc cell',
		{ op: 'setField', path: R, element: FLIGHT, line: 22, field: 'doc', value: 'Shorter.' }
	],
	[
		'sets an enum on an element found by name alone',
		{
			op: 'setField',
			path: R,
			element: "SystemRequirements::'Wind tolerance'",
			line: 0,
			field: 'feature:kind',
			value: 'safety'
		}
	],
	[
		'keeps the unit of a number',
		{
			op: 'setField',
			path: C,
			element: 'DroneComponents::Battery',
			line: 0,
			field: 'feature:mass',
			value: '1150'
		}
	],
	[
		'chooses the columns of a view def',
		{
			op: 'setTableColumns',
			path: 'libraries/ModelViews.sysml',
			view: 'RequirementsTable',
			columns: ['id', 'title', 'status']
		}
	],
	[
		'removes a type, keeping the multiplicity',
		{ op: 'setDeclaration', path: A, element: 'airframe', line: 35, set: { type: null } }
	]
];

describe('edits', () => {
	it.each(pinned)('%s', (_, request) => {
		expect(changedLines(files[request.path]!, ours(request).text)).toMatchSnapshot();
	});
});

describe('edits the earlier engine got wrong', () => {
	it('puts a new member before the closing brace, which keeps its indentation', () => {
		// The earlier engine inserted after the brace line's indentation, moving `}` to column 0.
		const { text } = ours({
			op: 'insertMember',
			path: C,
			parent: 'Battery',
			text: 'attribute cellCount : ScalarValues::Integer = 6;'
		});
		expect(text).toContain(
			'        port powerOut : PowerPort;\n        attribute cellCount : ScalarValues::Integer = 6;\n    }\n\n    part def PowerDistributionBoard'
		);
	});

	it('renames every reference in every file, but not prose', () => {
		// The earlier engine renamed words in one file only, comments included.
		const { files: after, result } = ours({
			op: 'setField',
			path: R,
			element: FLIGHT,
			line: 22,
			field: 'name',
			value: 'Endurance'
		});
		expect(after[R]).toContain("requirement <'SYS-001'> Endurance : DroneRequirement {");
		expect(result.otherFiles?.map((c) => c.path).sort()).toEqual([
			'system/Satisfaction.sysml',
			'verification/VerificationPlan.sysml'
		]);
		expect(after['system/Satisfaction.sysml']).not.toContain("'Flight endurance'");
		expect(after['analysis/Performance.sysml']).toContain("Show that 'Flight endurance' (SYS-001)");
	});

	it('adds a view usage’s columns after its last statement, typed as it resolves', () => {
		const { text } = ours({
			op: 'setTableColumns',
			path: 'views/Views.sysml',
			view: 'systemRequirements',
			columns: ['id', 'title']
		});
		expect(text).toContain(
			'        expose SystemRequirements::*;\n        @TableRendering { columns = "id; title"; }\n    }'
		);
	});

	it('writes metadata and enum types the shortest way that resolves', () => {
		const { text } = ours({
			op: 'setField',
			path: 'requirements/StakeholderNeeds.sysml',
			element: "StakeholderNeeds::'Parcel delivery'",
			line: 14,
			field: 'metadata:Rationale.text',
			value: 'Why.'
		});
		expect(text).toContain('@Rationale { text = "Why."; }');
	});
});

describe('edits the app makes although references break', () => {
	it('removes a used definition and says what no longer resolves', () => {
		const { text, result } = ours({ op: 'remove', path: C, name: 'Motor' });
		expect(text).not.toContain('part def Motor');
		expect(result.warning).toBe(
			// `part motor : Motor`, and `motor.mass` and `motor.powerDraw` through it.
			'3 references to Motor no longer resolve (DroneComponents::Rotor::motor).'
		);
	});

	it('changes a type that its features’ references depend on, with a warning', () => {
		const { text, result } = ours({
			op: 'setDeclaration',
			path: A,
			element: 'camera',
			line: 48,
			set: { type: 'Motor' }
		});
		expect(text).toContain('part camera : Motor;');
		expect(result.warning).toBe(
			'Some references no longer resolve as before: imageOut (line 70), image (line 70), mass (line 77).'
		);
	});
});

describe('what the toolkit refuses', () => {
	const fails = (request: Request) => {
		const edited = editFiles(host, files, request);
		return 'error' in edited ? edited.error : null;
	};

	it('refuses text that does not parse as a syntax error', () => {
		const result = host.edit({
			op: 'insertMember',
			path: C,
			source: files[C]!,
			files: demoFiles(),
			parent: 'Battery',
			text: 'part x : Motor'
		});
		expect(result.syntaxErrors[0]).toMatch(/does not parse/);
		expect(result.changes).toEqual([]);
	});

	it('checks enum literals and what a declaration can say', () => {
		expect(
			fails({
				op: 'setField',
				path: R,
				element: FLIGHT,
				line: 22,
				field: 'feature:priority',
				value: 'urgent'
			})
		).toBe("`urgent` is not one of Priority's literals: high, medium, low");
		expect(
			fails({ op: 'setDeclaration', path: C, element: 'Battery', line: 0, set: { type: 'X' } })
		).toBe('`type` cannot be set on a `part def` declaration');
		expect(
			fails({
				op: 'setTableColumns',
				path: 'libraries/ModelViews.sysml',
				view: 'RequirementsTable',
				columns: []
			})
		).toBe('a view def needs at least one column');
		expect(fails({ op: 'remove', path: C, name: 'Nothing' })).toBe('element `Nothing` not found');
	});

	it('leaves a file with a syntax error alone', () => {
		const broken = {
			...files,
			[C]: files[C]!.replace('port powerOut : PowerPort;', 'port powerOut : PowerPort')
		};
		const edited = editFiles(host, broken, { op: 'remove', path: C, name: 'maxPower' });
		expect('error' in edited && edited.error).toMatch(/syntax error; fix it/);
		// Other files can still be edited.
		const other = editFiles(host, broken, {
			op: 'setDeclaration',
			path: A,
			element: 'rotors',
			line: 44,
			set: { multiplicity: '6' }
		});
		expect('files' in other && other.files[A]).toContain('ref part rotors : Rotor[6] = (');
	});
});

describe('addressing', () => {
	it('finds an element by id, whatever line is given', () => {
		const id = host
			.analyzeProject(demoFiles())
			.find((a) => a.model.file === A)!
			.model.usages.find((u) => u.name === 'rotors')!.id!;
		const { text } = ours({
			op: 'setDeclaration',
			path: A,
			element: 'whatever',
			line: 1,
			id,
			set: { multiplicity: '8' }
		});
		expect(text).toContain('ref part rotors : Rotor[8] = (');
	});

	it('picks the element declared on the given line among same-named ones', () => {
		// Several components declare `powerIn`; line 46 is the distribution board's.
		const { text } = ours({
			op: 'setDeclaration',
			path: C,
			element: 'powerIn',
			line: 46,
			set: { direction: 'in' }
		});
		expect(text.split('\n')[45]).toBe('        in port powerIn : ~PowerPort;');
	});
});

describe('in the workspace', () => {
	it('applies edits in every file they change, and undo restores the exact text', async () => {
		const engine = {
			version: async () => host.version(),
			analyzeProject: async (f: { path: string; text: string }[]) => host.analyzeProject(f),
			listViews: async () => [],
			stateMachines: async () => [],
			checks: async (f: { path: string; text: string }[]) => host.checks(f),
			edit: async (request: EditRequest) => host.edit(request)
		} as unknown as Engine;
		const workspace = new Workspace();
		await workspace.open({ id: 'demo', info: { name: 'Demo' }, files: demoFiles() }, engine);
		const before = { ...workspace.files };
		const error = await workspace.transact('Renamed', () =>
			workspace.edit(C, {
				op: 'rename',
				path: C,
				source: workspace.text(C)!,
				from: 'Battery',
				to: 'Pack'
			})
		);
		expect(error).toBeNull();
		expect(workspace.text(A)).toContain('part battery : Pack;');
		await workspace.transact('Deleted', () =>
			workspace.edit(C, { op: 'remove', path: C, source: workspace.text(C)!, name: 'Camera' })
		);
		expect(workspace.warnings[0]).toMatch(/references to Camera no longer resolve/);
		workspace.undo();
		workspace.undo();
		for (const [path, text] of Object.entries(before)) expect(workspace.text(path)).toBe(text);
	});

	it('runs a series of edits on the session the previous edit left', () => {
		let texts = { ...files };
		const started = performance.now();
		for (const value of ['low', 'medium', 'high', 'low', 'medium']) {
			const edited = editFiles(host, texts, {
				op: 'setField',
				path: R,
				element: FLIGHT,
				line: 22,
				field: 'feature:priority',
				value
			});
			if ('error' in edited) throw new Error(edited.error);
			texts = edited.files;
		}
		// Without the kept session each edit would rebuild it (~150 ms here).
		expect(performance.now() - started).toBeLessThan(1500);
		expect(texts[R]).toContain(':>> priority = Priority::medium;');
	});
});
