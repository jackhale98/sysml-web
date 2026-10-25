/**
 * Assessment (docs/assessment/01-language.md, checklist 1.1 "preserve valid
 * constructs the graphical interface cannot display or edit"): edits made
 * through the app — the inspector's and tables' engine edits (`edits.ts`)
 * and the guided forms' writes (`src/lib/create`) — on a file full of
 * constructs no diagram or form shows (notes, comments with locales,
 * quoted and short names, prefix metadata, individuals, time slices,
 * variations, `derived`/`constant`, calculations, `->collect`, succession
 * flows, textual representations, dependencies, filters, aliases,
 * conjugated ports, tabs and non-ASCII text). Every edit must leave the
 * rest of the file byte for byte as it was, and the model without new
 * problems.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { write } from '#lib/create/apply.ts';
import { openWorkspace } from '#lib/create/testing.ts';
import type { EditOperation } from '../types';
import { editFiles } from './edit-testing';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

const PATH = 'model/Exotic.sysml';
const TEXT = `package Exotic {
	// Tabs, a line note and unusual layout are kept as written.
	private import ScalarValues::*;
	private import ControlFunctions::*;
	private import Exotic::'Quoted Package'::**;

	//* A multi-line note: never part of the model,
	    but part of the file. */
	/* A comment with ünïcödé, an emoji 🚁 and 	tabs. */
	comment Cmt about Plain locale "en_US" /* A localised comment. */

	metadata def Tag;
	package <'X-1'> 'Quoted Package' {
		part def 'Odd Name';
	}
	part def Plain {
		attribute mass : Real default 1.0;
		part sub : Plain[0..*] ordered nonunique;
		ref part link : 'Odd Name'[0..1];
	}
	#Tag part tagged : Plain;
	individual part def Unit1 :> Plain;
	occurrence def Life {
		timeslice early;
		snapshot start;
	}
	variation part def Choice :> Plain {
		variant part a : Plain;
		variant part b : Plain;
	}
	abstract part def Base {
		derived ref part r : Plain[1];
		constant attribute k : Real = 2.0;
	}
	part def Calc {
		calc twice { in x : Real; return : Real = x * 2; }
		attribute y = twice(3.0);
		attribute doubled = (1.0, 2.0, 3.0)->collect { in i : Real; i * 2 };
	}
	action def Seq {
		action a { out item o : Real; }
		action b { in item i : Real; }
		succession flow f from a.o to b.i;
		first a then b;
	}
	part def Holder {
		attribute v : Real;
		rep python language "python" /* print(v) */
	}
	dependency from Plain to Base;
	view def V { filter @SysML::PartUsage; }
	alias PlainAlias for Plain;
	port def P { in attribute x : Real; }
	part conj { port p : ~P; }
	attribute def Weird { attribute 'with space' : Real; }
	part ordinary : Plain {
		attribute :>> mass = 2.5;
	}
}
`;

/** Text no edit below targets: each must survive every edit verbatim. */
const UNTOUCHED = [
	'\t// Tabs, a line note and unusual layout are kept as written.\n',
	"\tprivate import Exotic::'Quoted Package'::**;\n",
	'\t//* A multi-line note: never part of the model,\n\t    but part of the file. */\n',
	'\t/* A comment with ünïcödé, an emoji 🚁 and \ttabs. */\n',
	'locale "en_US" /* A localised comment. */\n',
	"\tpackage <'X-1'> 'Quoted Package' {\n\t\tpart def 'Odd Name';\n\t}\n",
	'\tindividual part def Unit1 :> ',
	'\toccurrence def Life {\n\t\ttimeslice early;\n\t\tsnapshot start;\n\t}\n',
	'\t\tvariant part a : ',
	'\t\tderived ref part r : ',
	'\t\tconstant attribute k : Real = 2.0;\n',
	'\t\tcalc twice { in x : Real; return : Real = x * 2; }\n',
	'\t\tattribute doubled = (1.0, 2.0, 3.0)->collect { in i : Real; i * 2 };\n',
	'\t\tsuccession flow f from a.o to b.i;\n',
	'\t\trep python language "python" /* print(v) */\n',
	'\tview def V { filter @SysML::PartUsage; }\n',
	'\tpart conj { port p : ~P; }\n',
	"\tattribute def Weird { attribute 'with space' : Real; }\n"
];

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const problems = (text: string) => {
	const [a] = host.analyzeProject([{ path: PATH, text }]);
	return [...a!.model.syntax_errors, ...a!.diagnostics].map(
		(p) => `${p.span.start_row}: ${p.message}`
	);
};

const elementOf = (qualified: string) => {
	const [a] = host.analyzeProject([{ path: PATH, text: TEXT }]);
	const e = [...a!.model.definitions, ...a!.model.usages].find(
		(x) => x.qualified_name === qualified
	);
	if (!e) throw new Error(`no ${qualified}`);
	return e;
};

describe('edits on a file of constructs the app does not draw', () => {
	it('the file is valid SysML with no problems', () => {
		expect(problems(TEXT)).toEqual([]);
	});

	const edits: {
		label: string;
		element: string;
		op: (e: ReturnType<typeof elementOf>) => EditOperation;
	}[] = [
		{
			label: 'a value (inspector)',
			element: 'Exotic::ordinary::mass',
			op: (e) => ({
				op: 'setDeclaration',
				element: e.qualified_name!,
				line: e.span.start_row,
				id: e.id,
				set: { value: '3.5' }
			})
		},
		{
			label: 'a multiplicity (inspector)',
			element: 'Exotic::Plain::sub',
			op: (e) => ({
				op: 'setDeclaration',
				element: e.qualified_name!,
				line: e.span.start_row,
				id: e.id,
				set: { multiplicity: '1..*' }
			})
		},
		{
			label: 'a type, after prefix metadata (inspector)',
			element: 'Exotic::tagged',
			op: (e) => ({
				op: 'setDeclaration',
				element: e.qualified_name!,
				line: e.span.start_row,
				id: e.id,
				set: { type: 'Choice' }
			})
		},
		{
			label: 'a doc comment (inspector)',
			element: 'Exotic::Holder',
			op: (e) => ({
				op: 'setDeclaration',
				element: e.qualified_name!,
				line: e.span.start_row,
				id: e.id,
				set: { doc: 'Holds a value.' }
			})
		},
		{
			label: 'a new member next to a textual representation (diagram, form)',
			element: 'Exotic::Holder',
			op: (e) => ({
				op: 'insertMember',
				parent: e.qualified_name!,
				parentLine: e.span.start_row,
				parentId: e.id,
				text: 'attribute w : Real;'
			})
		},
		{
			label: 'a removal (diagram, explorer)',
			element: 'Exotic::Calc::y',
			op: (e) => ({ op: 'remove', name: e.qualified_name!, line: e.span.start_row, id: e.id })
		}
	];

	for (const { label, element, op } of edits) {
		it(`${label} changes only that declaration`, () => {
			const e = elementOf(element);
			const out = editFiles(host, { [PATH]: TEXT }, { path: PATH, ...op(e) });
			if ('error' in out) throw new Error(out.error);
			const after = out.files[PATH]!;
			expect(after).not.toBe(TEXT);
			// Every change is inside the element's lines (a removal takes its whole line).
			const lineStart = TEXT.lastIndexOf('\n', e.span.from!) + 1;
			const lineEnd = TEXT.indexOf('\n', e.span.to!) + 1;
			expect(out.result.otherFiles ?? []).toEqual([]);
			for (const c of out.result.changes) {
				expect(c.from).toBeGreaterThanOrEqual(lineStart);
				expect(c.to).toBeLessThanOrEqual(lineEnd);
			}
			for (const piece of UNTOUCHED) expect(after).toContain(piece);
			expect(problems(after)).toEqual([]);
		});
	}

	it('a rename changes only the name, wherever it is referred to', () => {
		const e = elementOf('Exotic::Plain');
		const out = editFiles(
			host,
			{ [PATH]: TEXT },
			{ path: PATH, op: 'rename', from: 'Plain', to: 'Basic', line: e.span.start_row, id: e.id }
		);
		if ('error' in out) throw new Error(out.error);
		const after = out.files[PATH]!;
		expect(TEXT).not.toContain('Basic');
		expect(after.replaceAll('Basic', 'Plain')).toBe(TEXT);
		// The alias, the comment's `about`, the dependency and the specializations follow.
		expect(after).toContain('alias PlainAlias for Basic;');
		expect(after).toContain('comment Cmt about Basic');
		expect(after).toContain('dependency from Basic to Base;');
		expect(problems(after)).toEqual([]);
	});

	it('a guided form’s write (new members and an import) leaves the rest as it was', async () => {
		const workspace = await openWorkspace(host, [{ path: PATH, text: TEXT }]);
		const pkg = workspace.elements.find((x) => x.name === 'Exotic' && x.kind === 'package')!;
		const holder = workspace.elements.find((x) => x.name === 'Holder')!;
		expect(
			await write(workspace, 'Add', {
				imports: [{ pkg, targets: ['SI::*'] }],
				members: [{ parent: holder, text: 'attribute limit : Real = 4.0;' }]
			})
		).toBeNull();
		const after = workspace.text(PATH)!;
		expect(after).toContain('private import SI::*;');
		expect(after).toContain('attribute limit : Real = 4.0;');
		for (const piece of UNTOUCHED) expect(after).toContain(piece);
		// Removing exactly the two additions gives the original back.
		const lines = after.split('\n').filter((l) => !/import SI::\*;|attribute limit/.test(l));
		expect(lines.join('\n')).toBe(TEXT);
		expect(problems(after)).toEqual([]);
	});
});
