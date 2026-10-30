/**
 * ReqIF import and export, on hand-written files shaped like what DOORS
 * Next, DOORS, Polarion and Jama export, checked with the real engine
 * (WebAssembly in Node): the SysML an import writes parses, resolves and
 * reads back as the file's requirements; a second import of a changed file
 * updates them in place; an export follows the ReqIF schema's rules and
 * imports back into an empty project as the same requirements and links.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { editFiles } from '#lib/engine/toolkit/edit-testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { Analysis, EditRequest } from '#lib/engine/types.ts';
import { collectRequirements, type RequirementRow } from '#lib/project/requirements.ts';
import type { ImportWorkspace } from './import-apply';
import { buildContext, plainText, type ImportContext } from './import-plan';
import { problemList, readReqif, xhtmlText, type ReqifDocument } from './reqif';
import { applyReqif, packageLine } from './reqif-apply';
import {
	defaultObjectRole,
	defaultRelationRole,
	detectReqifTargets,
	nodesText,
	planReqif,
	readRefinements,
	reqifColumns,
	reqifHasWork,
	reqifTarget,
	REQIF_LIBRARY_PATH,
	type ReqifOptions
} from './reqif-plan';
import { checkReqif, textXhtml, writeReqif } from './reqif-write';
import { parseXml } from './xml-tree';
import { zip } from './zip';

let host: ToolkitHost;
let demo: Record<string, string>;

beforeAll(async () => {
	host = await loadHost();
	demo = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
}, 60_000);

const fixture = (name: string) =>
	readFileSync(join(import.meta.dirname, 'fixtures/reqif', name), 'utf8');
const bytes = (text: string) => new TextEncoder().encode(text);
const read = (text: string, name = 'test.reqif') => readReqif(bytes(text), name);

function analyse(files: Record<string, string>): Analysis[] {
	return host.analyzeProject(Object.entries(files).map(([path, text]) => ({ path, text })));
}

function contextFor(files: Record<string, string>): ImportContext {
	const analyses = analyse(files);
	return buildContext(analyses, files, collectRequirements(analyses, files));
}

function rowsOf(files: Record<string, string>): RequirementRow[] {
	return collectRequirements(analyse(files), files);
}

/** Errors (syntax and diagnostics) in the given files. */
function errors(files: Record<string, string>, only?: (path: string) => boolean): string[] {
	return analyse(files).flatMap((a) =>
		!only || only(a.model.file)
			? [
					...a.model.syntax_errors.map((e) => `${a.model.file}: ${e.message}`),
					...a.diagnostics
						.filter((d) => d.severity === 'error')
						.map((d) => `${d.file}: ${d.message}`)
				]
			: []
	);
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

/** The options the dialog starts with: detected attributes, the definition most requirements use. */
function optionsFor(
	doc: ReqifDocument,
	context: ImportContext,
	extra: Partial<ReqifOptions> = {}
): ReqifOptions {
	const def =
		extra.def !== undefined
			? extra.def
			: (context.defs.find((d) => d.label === 'DroneRequirement') ?? null);
	return {
		targets: detectReqifTargets(reqifColumns(doc), def),
		objectRoles: {},
		relationRoles: {},
		destination: { kind: 'new', ...reqifTarget(doc, context) },
		existing: 'update',
		...extra,
		def
	};
}

/** Import `text` into `files`; the files after, and the plan. */
async function importInto(
	files: Record<string, string>,
	doc: ReqifDocument,
	extra: Partial<ReqifOptions> = {}
) {
	const context = contextFor(files);
	const options = optionsFor(doc, context, extra);
	const plan = planReqif(doc, options, context, readRefinements(files));
	const ws = fakeWorkspace(files);
	const result = await applyReqif(ws, plan, options, `Requirements imported from ${doc.name}.`);
	if (typeof result === 'string') throw new Error(result);
	return { files: ws.files, plan, result, options };
}

describe('reading ReqIF', () => {
	it('reads a DOORS Next export: types, enumerations, XHTML, defaults and the hierarchy', async () => {
		const doc = await read(fixture('doors-next.reqif'), 'doors-next.reqif');
		expect(problemList(doc)).toEqual([]);
		expect(doc.title).toBe('System Requirements');
		expect(doc.tool).toMatch(/DOORS Next/);
		expect([...doc.types.values()].map((t) => [t.name, t.kind])).toEqual([
			['Heading', 'object'],
			['System Requirement', 'object'],
			['Information', 'object'],
			['Derived From', 'relation'],
			['Satisfies', 'relation'],
			['Module', 'specification']
		]);
		expect(doc.datatypes.get('_dt_priority')?.values.map((v) => v.name)).toEqual([
			'High',
			'Medium',
			'Low'
		]);
		const value = (object: string, attribute: string) =>
			doc.objects.get(object)?.values.get(attribute);
		expect(value('_so_1002', '_ad_r_text')).toBe(
			'The drone shall hover for at least 20 minutes with a 1 kg payload.\n\nConditions:\n\n- still air,\n- 15 °C at sea level.'
		);
		// A line break inside a paragraph stays one.
		expect(value('_so_1003', '_ad_r_text')).toBe(
			'The drone shall land with at least 15 % of its battery charge left.\nThe reserve shall be shown to the pilot.'
		);
		expect(value('_so_1002', '_ad_r_vm')).toBe('Test, Analysis');
		expect(value('_so_1002', '_ad_r_id')).toBe('1002');
		// No status of its own: the attribute's default.
		expect(value('_so_1003', '_ad_r_status')).toBe('Draft');
		const spec = doc.specifications[0]!;
		expect(spec.name).toBe('System Requirements');
		expect(spec.children.map((c) => [c.object, c.children.map((g) => g.object)])).toEqual([
			['_so_1001', ['_so_1002', '_so_1004']],
			['_so_1005', ['_so_1006', '_so_1007']]
		]);
		expect(spec.children[0]!.children[0]!.children[0]!.object).toBe('_so_1003');
		expect(doc.relations.map((r) => [r.source, r.target, r.type])).toEqual([
			['_so_1007', '_so_1006', '_rt_derives'],
			['_so_1003', '_so_1002', '_rt_derives'],
			['_so_1006', '_so_1002', '_rt_satisfies']
		]);
	});

	it('reads Polarion’s prefixed XHTML, numbered lists, tables, booleans and reals', async () => {
		const doc = await read(fixture('polarion.reqif'));
		expect(problemList(doc)).toEqual([]);
		const v = (o: string, a: string) => doc.objects.get(o)?.values.get(a);
		expect(v('ID_DRN-12', 'ID_AD_sw_description')).toBe(
			'The attitude controller shall run at 400 Hz or faster, and:\n\n1. read the IMU every cycle;\n2. log a missed deadline.'
		);
		expect(v('ID_DRN-13', 'ID_AD_sw_description')).toBe(
			'The mixer shall keep each motor command within the limits below.\n\nLimit | Value\nMinimum | 5 %\nMaximum | 95 %'
		);
		expect(v('ID_DRN-12', 'ID_AD_sw_safety')).toBe('true');
		expect(v('ID_DRN-12', 'ID_AD_sw_effort')).toBe('3.5');
		// The hierarchy entry gives CHILDREN before OBJECT, as the schema orders them.
		expect(doc.specifications[0]!.children[0]!.children.map((c) => c.object)).toEqual([
			'ID_DRN-12',
			'ID_DRN-13',
			'ID_DRN-14'
		]);
	});

	it('keeps nested lists of a DOORS export indented', async () => {
		const doc = await read(fixture('doors-classic.reqif'));
		expect(doc.objects.get('_D9_O3')?.values.get('_D9_OTX')).toBe(
			'Each telemetry frame shall carry:\n- position,\n- battery state, with\n  - voltage\n  - charge left'
		);
	});

	it('reads a .reqifz and names the attachments it leaves out', async () => {
		const archive = await zip([
			{ path: 'jama.reqif', data: bytes(fixture('jama.reqif')) },
			{ path: 'attachments/landing-zone.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }
		]);
		const doc = await readReqif(archive, 'needs.reqifz');
		expect(problemList(doc)).toEqual([]);
		expect(doc.objects.size).toBe(3);
		expect(doc.objects.get('jama-item-88002')?.values.get('jama-STK-description')).toBe(
			'The operator needs the drone to land only where nobody stands.\n\n[attachment: landing-zone.png]'
		);
		expect(doc.attachments).toEqual(['attachments/landing-zone.png']);
	});

	it('turns XHTML into text people read', () => {
		const text = (xml: string) => xhtmlText(parseXml(xml));
		expect(
			text(
				'<div xmlns="http://www.w3.org/1999/xhtml"><h2>Title</h2><p>One <a href="https://example.com/x">link</a>.</p><ol start="3"><li>three</li><li>four</li></ol><pre>a  b\n  c</pre></div>'
			)
		).toBe('Title\n\nOne link (https://example.com/x).\n\n3. three\n4. four\n\na b\nc');
		expect(text('<div>a<br/><br/>b</div>')).toBe('a\n\nb');
	});
});

describe('malformed ReqIF is reported, never dropped without a word', () => {
	const wrap = (content: string) =>
		`<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT>${content}</REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>`;

	it('refuses what is not XML, saying where', async () => {
		await expect(read('<REQ-IF>\n  <THE-HEADER>\n</REQ-IF>', 'broken.reqif')).rejects.toThrow(
			'broken.reqif is not well-formed XML. Line 3: </REQ-IF> closes <THE-HEADER> (opened on line 2).'
		);
		await expect(read('<REQ-IF a="1" a="2"/>')).rejects.toThrow('has attribute a twice');
		await expect(read('<REQ-IF>Tom & Jerry</REQ-IF>')).rejects.toThrow(
			'an “&” that does not start an entity'
		);
		await expect(read('')).rejects.toThrow('there is no XML in it');
	});

	it('refuses XML that is not ReqIF, and a .reqifz without a .reqif', async () => {
		await expect(read('<workbook/>', 'book.reqif')).rejects.toThrow(
			'book.reqif is not a ReqIF file: it holds <workbook> where ReqIF has <REQ-IF>.'
		);
		const archive = await zip([{ path: 'readme.txt', data: bytes('hi') }]);
		await expect(readReqif(archive, 'x.reqifz')).rejects.toThrow('x.reqifz holds no .reqif file.');
	});

	it('names references to nothing, identifiers used twice and values of unknown attributes', async () => {
		const doc = await read(
			wrap(`
			<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="s" LAST-CHANGE="2026-01-01T00:00:00Z" MAX-LENGTH="10"/></DATATYPES>
			<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="t" LAST-CHANGE="2026-01-01T00:00:00Z" LONG-NAME="Req"><SPEC-ATTRIBUTES>
				<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="text" LAST-CHANGE="2026-01-01T00:00:00Z" LONG-NAME="ReqIF.Text"><TYPE><DATATYPE-DEFINITION-STRING-REF>s</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>
			</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE></SPEC-TYPES>
			<SPEC-OBJECTS>
				<SPEC-OBJECT IDENTIFIER="o1" LAST-CHANGE="2026-01-01T00:00:00Z"><VALUES>
					<ATTRIBUTE-VALUE-STRING THE-VALUE="kept"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>text</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
					<ATTRIBUTE-VALUE-STRING THE-VALUE="lost"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>nope</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
					<ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>text</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES><ENUM-VALUE-REF>gone</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION>
				</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>
				<SPEC-OBJECT IDENTIFIER="o1" LAST-CHANGE="2026-01-01T00:00:00Z"><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>
				<SPEC-OBJECT IDENTIFIER="o2" LAST-CHANGE="2026-01-01T00:00:00Z"><TYPE><SPEC-OBJECT-TYPE-REF>missing</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>
				<SPEC-OBJECT LAST-CHANGE="2026-01-01T00:00:00Z"><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>
			</SPEC-OBJECTS>
			<SPECIFICATIONS><SPECIFICATION IDENTIFIER="sp" LAST-CHANGE="2026-01-01T00:00:00Z"><CHILDREN>
				<SPEC-HIERARCHY IDENTIFIER="h1" LAST-CHANGE="2026-01-01T00:00:00Z"><OBJECT><SPEC-OBJECT-REF>ghost</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
			</CHILDREN></SPECIFICATION></SPECIFICATIONS>`)
		);
		expect(problemList(doc)).toEqual([
			'Values of attributes that are not defined, left out: nope on line 9.',
			'Values of another kind than their attribute, left out: text on line 10.',
			'IDENTIFIERs used more than once (the first is kept): o1 on line 12.',
			'Spec objects whose type is not defined: o2 on line 13.',
			'Elements without an IDENTIFIER, left out: SPEC-OBJECT on line 14.',
			'Hierarchy entries that point to no spec object (what is under them is kept): ghost on line 17.'
		]);
		expect(doc.objects.get('o1')?.values.get('text')).toBe('kept');
	});
});

describe('matching attributes', () => {
	it('recognises what DOORS Next, DOORS, Polarion and Jama call the parts of a requirement', async () => {
		const context = contextFor(demo);
		const def = context.defs.find((d) => d.label === 'DroneRequirement')!;
		const detect = async (name: string) => {
			const doc = await read(fixture(name));
			const columns = reqifColumns(doc);
			const targets = detectReqifTargets(columns, def);
			return Object.fromEntries(columns.map((c, i) => [c.name, targets[i]]));
		};
		expect(await detect('doors-next.reqif')).toEqual({
			'ReqIF.ForeignID': 'id',
			'ReqIF.Name': 'name',
			'ReqIF.Text': 'doc',
			Status: 'status',
			Priority: 'attr:priority',
			'Verification Method': 'attr:verificationMethod',
			'Modified On': ''
		});
		expect(await detect('doors-classic.reqif')).toEqual({
			'Absolute Number': 'id',
			'Object Heading': 'heading',
			'Object Text': 'doc',
			'Created By': ''
		});
		expect(await detect('polarion.reqif')).toEqual({
			'ReqIF.ForeignID': 'id',
			'ReqIF.ChapterName': 'heading',
			'ReqIF.Name': 'name',
			'ReqIF.Text': 'doc',
			Status: 'status',
			Severity: 'attr:priority',
			'ReqIF.ForeignCreatedBy': '',
			'Safety Relevant': '',
			'Initial Estimate': ''
		});
		expect(await detect('jama.reqif')).toEqual({
			Name: 'name',
			ID: 'id',
			'Global ID': '',
			Description: 'doc',
			Status: 'status',
			Priority: 'attr:priority',
			Rationale: 'rationale'
		});
	});

	it('guesses what object and relation types are', async () => {
		const doc = await read(fixture('doors-next.reqif'));
		const role = (id: string) => defaultObjectRole(doc.types.get(id)!);
		expect([role('_ot_heading'), role('_ot_sysreq'), role('_ot_info')]).toEqual([
			'heading',
			'requirement',
			'skip'
		]);
		const relation = (name: string) =>
			defaultRelationRole({ id: '', name, kind: 'relation', attributes: [] });
		expect(
			[
				'Derived From',
				'derives',
				'Derived by',
				'refines',
				'Refined By',
				'Satisfies',
				'relates to'
			].map(relation)
		).toEqual(['derived-from', 'derives', 'derives', 'refines', 'refined-by', 'skip', 'skip']);
	});
});

describe('importing ReqIF', () => {
	it('adds a DOORS Next module as packages and requirements that parse, resolve and read back', async () => {
		const doc = await read(fixture('doors-next.reqif'), 'doors-next.reqif');
		const { files, plan, result } = await importInto(demo, doc);
		expect(result).toEqual({
			created: 4,
			updated: 0,
			path: 'requirements/SystemRequirements2.sysml'
		});
		expect(plan.counts).toEqual({ packages: 2, derivations: 2, refinements: 0 });
		expect(plan.notes).toEqual([
			'Statuses that are not one of open, tbd, tbr, tbc, done, closed, left out: ‘Approved’, ‘Draft’ (2 objects).',
			'Requirements under another requirement in the file, added next to it in the same package: ‘1’.',
			'Objects left out, by type: ‘Information (1)’.',
			'Relations left out, by type: ‘Satisfies’.'
		]);
		expect(files[REQIF_LIBRARY_PATH]).toContain('metadata def ReqIF');
		const path = 'requirements/SystemRequirements2.sysml';
		expect(errors(files, (p) => p === path || p === REQIF_LIBRARY_PATH)).toEqual([]);
		expect(files[path]).toContain(`package SystemRequirements2 {
    doc /* Requirements imported from doors-next.reqif. */

    private import ModelingMetadata::*;
    private import EngineeringBasics::*;
    private import SystemRequirements::DroneRequirement;
    private import ReqIFInterchange::*;
    private import RequirementDerivation::*;

    @ReqIF { identifier = "_spec_sysreq"; }

    package 'Flight performance' {
        @ReqIF { identifier = "_so_1001"; }

        requirement <'1002'> 'Hover endurance' : DroneRequirement {
            doc /* The drone shall hover for at least 20 minutes with a 1 kg payload.
                 *
                 * Conditions:
                 *
                 * - still air,
                 * - 15 °C at sea level. */
            :>> priority = Priority::high;
            :>> verificationMethod = (VerificationMethod::test, VerificationMethod::'analysis');
            @ReqIF { identifier = "_so_1002"; }
        }`);
		expect(files[path]).toContain(`    #derivation connection {
        end #original ::> 'Flight performance'::'Hover endurance';
        end #derive ::> 'Flight performance'::'Battery reserve';
    }`);

		const rows = rowsOf(files).filter((r) => r.file === path);
		expect(rows.map((r) => [r.id, r.title, r.status, r.priority])).toEqual([
			['1002', 'Hover endurance', null, 'high'],
			['1003', 'Battery reserve', null, 'medium'],
			['1006', 'Geofence', 'tbd', 'high'],
			['1007', 'Geofence warning', null, 'medium']
		]);
		const byKey = new Map(rows.map((r) => [r.key, r.id]));
		expect(rows.map((r) => [r.id, r.derivedFrom.map((k) => byKey.get(k))])).toEqual([
			['1002', []],
			['1003', ['1002']],
			['1006', []],
			['1007', ['1006']]
		]);
	});

	it('updates in place on a second import of the changed file, and puts what is new under its heading', async () => {
		const original = await read(fixture('doors-next.reqif'), 'doors-next.reqif');
		const first = await importInto(demo, original);
		const path = 'requirements/SystemRequirements2.sysml';

		// The same file again: nothing to do.
		const context = contextFor(first.files);
		const again = planReqif(original, optionsFor(original, context), context);
		expect([again.create.length, again.update.length, again.unchanged]).toEqual([0, 0, 4]);
		expect(reqifHasWork(again)).toBe(false);

		// The next export: a text and a priority changed, a requirement and a relation added.
		const changed = fixture('doors-next.reqif')
			.replace('at least 15 % of its battery', 'at least 20 % of its battery')
			.replace(
				'<VALUES><ENUM-VALUE-REF>_ev_prio_high</ENUM-VALUE-REF></VALUES>\n            </ATTRIBUTE-VALUE-ENUMERATION>\n          </VALUES>\n          <TYPE><SPEC-OBJECT-TYPE-REF>_ot_sysreq</SPEC-OBJECT-TYPE-REF></TYPE>\n        </SPEC-OBJECT>\n        <SPEC-OBJECT IDENTIFIER="_so_1007"',
				'<VALUES><ENUM-VALUE-REF>_ev_prio_low</ENUM-VALUE-REF></VALUES>\n            </ATTRIBUTE-VALUE-ENUMERATION>\n          </VALUES>\n          <TYPE><SPEC-OBJECT-TYPE-REF>_ot_sysreq</SPEC-OBJECT-TYPE-REF></TYPE>\n        </SPEC-OBJECT>\n        <SPEC-OBJECT IDENTIFIER="_so_1007"'
			)
			.replace(
				'</SPEC-OBJECTS>',
				`<SPEC-OBJECT IDENTIFIER="_so_1008" LAST-CHANGE="2026-10-01T00:00:00.000Z"><VALUES>
					<ATTRIBUTE-VALUE-INTEGER THE-VALUE="1008"><DEFINITION><ATTRIBUTE-DEFINITION-INTEGER-REF>_ad_r_id</ATTRIBUTE-DEFINITION-INTEGER-REF></DEFINITION></ATTRIBUTE-VALUE-INTEGER>
					<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>_ad_r_name</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>Geofence override</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
					<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>_ad_r_text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>Only the operator shall be able to lift the geofence.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
				</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>_ot_sysreq</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>
				</SPEC-OBJECTS>`
			)
			.replace(
				'</SPEC-RELATIONS>',
				`<SPEC-RELATION IDENTIFIER="_sr_4" LAST-CHANGE="2026-10-01T00:00:00.000Z"><SOURCE><SPEC-OBJECT-REF>_so_1008</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>_so_1006</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>_rt_derives</SPEC-RELATION-TYPE-REF></TYPE></SPEC-RELATION>
				</SPEC-RELATIONS>`
			)
			.replace(
				'<SPEC-HIERARCHY IDENTIFIER="_sh_7"',
				'<SPEC-HIERARCHY IDENTIFIER="_sh_8" LAST-CHANGE="2026-10-01T00:00:00.000Z"><OBJECT><SPEC-OBJECT-REF>_so_1008</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>\n<SPEC-HIERARCHY IDENTIFIER="_sh_7"'
			);
		const doc = await read(changed, 'doors-next.reqif');
		const second = await importInto(first.files, doc);
		expect(
			second.plan.update.map((u) => [u.existing.row.id, u.changes.map((c) => [c.label, c.to])])
		).toEqual([
			[
				'1003',
				[
					[
						'Text',
						'The drone shall land with at least 20 % of its battery charge left.\nThe reserve shall be shown to the pilot.'
					]
				]
			],
			['1006', [['Priority', 'low']]]
		]);
		expect(second.plan.create.map((c) => c.spec.id)).toEqual(['1008']);
		expect(second.plan.root).toEqual([]);
		expect(second.plan.anchored.map((a) => a.package.qualifiedName)).toEqual([
			'SystemRequirements2::Safety'
		]);
		expect(second.result).toEqual({ created: 1, updated: 2, path });

		// No second file, no duplicates; the new requirement under its heading, derived as the file says.
		expect(Object.keys(second.files).filter((p) => p.startsWith('requirements/'))).toEqual(
			Object.keys(first.files).filter((p) => p.startsWith('requirements/'))
		);
		expect(errors(second.files, (p) => p === path)).toEqual([]);
		const rows = rowsOf(second.files).filter((r) => r.file === path);
		expect(rows.map((r) => r.id)).toEqual(['1002', '1003', '1006', '1007', '1008']);
		const row = (id: string) => rows.find((r) => r.id === id)!;
		expect(plainText(row('1003').text)).toContain('at least 20 %');
		expect(row('1006').priority).toBe('low');
		expect(row('1008').derivedFrom).toEqual([row('1006').key]);
		const safety = second.files[path]!.slice(second.files[path]!.indexOf('package Safety'));
		expect(safety.indexOf("'Geofence override'")).toBeGreaterThan(0);
		expect(safety.indexOf("'Geofence override'")).toBeLessThan(safety.indexOf('\n    }'));
	});

	it('finds requirements again by their ReqIF IDENTIFIER, when they have no ID', async () => {
		const doc = await read(fixture('doors-next.reqif'), 'doors-next.reqif');
		const noIds = (context: ImportContext) => {
			const options = optionsFor(doc, context);
			return { targets: options.targets.map((t) => (t === 'id' ? '' : t)) };
		};
		const first = await importInto(demo, doc, noIds(contextFor(demo)));
		expect(first.plan.create.map((c) => c.spec.id)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined
		]);
		const context = contextFor(first.files);
		const again = planReqif(doc, optionsFor(doc, context, noIds(context)), context);
		expect([again.create.length, again.update.length, again.unchanged]).toEqual([0, 0, 4]);
	});

	it('writes refinements and names the relations it leaves out (Polarion, no definition)', async () => {
		const doc = await read(fixture('polarion.reqif'), 'polarion.reqif');
		const files = { ...demo };
		const { files: after, plan } = await importInto(files, doc, {
			def: null,
			relationRoles: { ID_SRT_parent: 'derived-from' }
		});
		expect(plan.counts).toEqual({ packages: 1, derivations: 0, refinements: 1 });
		expect(plan.notes).toEqual([
			'Statuses that are not one of open, tbd, tbr, tbc, done, closed, left out: ‘Approved’, ‘Draft’, ‘Reviewed’.',
			'Relations left out, by type: ‘relates to’.',
			'‘has parent’ relations whose ends are not requirements of this import or the model, left out: ‘ID_REL_12_SYS’.'
		]);
		const path = 'requirements/SoftwareRequirementsSpecification.sysml';
		expect(after[path]).toContain(
			"#refinement dependency 'Flight control software'::'Motor saturation alarm' to 'Flight control software'::'Motor output limits';"
		);
		expect(errors(after, (p) => p === path)).toEqual([]);
		expect(readRefinements(after)).toEqual(
			new Set(['Motor saturation alarm → Motor output limits'])
		);
		// Imported again: the refinement is there already.
		const context = contextFor(after);
		const again = planReqif(
			doc,
			optionsFor(doc, context, { def: null, relationRoles: { ID_SRT_parent: 'derived-from' } }),
			context,
			readRefinements(after)
		);
		expect(reqifHasWork(again)).toBe(false);
	});

	it('takes headings from a heading attribute when every object has the same type (DOORS)', async () => {
		const doc = await read(fixture('doors-classic.reqif'), 'icd.reqif');
		const { files, plan } = await importInto(demo, doc, { def: null });
		const path = 'requirements/GroundStationICD.sysml';
		expect(nodesText(plan.root)).toContain("package 'Telemetry link' {");
		expect(plan.create.map((c) => [c.spec.id, c.spec.name])).toEqual([
			['2', '2'],
			['3', '3']
		]);
		expect(errors(files, (p) => p === path)).toEqual([]);
	});
});

describe('exporting ReqIF', () => {
	const now = new Date('2026-10-30T12:00:00Z');

	it('writes the demo’s requirements as ReqIF that follows the schema’s rules', () => {
		const xml = writeReqif({ context: contextFor(demo), title: 'Delivery drone', now });
		expect(checkReqif(xml)).toEqual([]);
		expect(xml).toContain('<SPECIFICATION IDENTIFIER="tessera-spec-SystemRequirements"');
		expect(xml).toContain('<SPEC-OBJECT IDENTIFIER="tessera-req-SYS-001"');
		expect(xml).toContain(
			'<ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="tessera-feature-verificationMethod"'
		);
		expect(xml.match(/<SPEC-RELATION /g)?.length).toBe(
			rowsOf(demo).reduce((n, r) => n + r.derivedFrom.length, 0)
		);
		// The same model gives the same file.
		expect(writeReqif({ context: contextFor(demo), title: 'Delivery drone', now })).toBe(xml);
	});

	it('gives imported requirements back the identifiers they came with', async () => {
		const doc = await read(fixture('doors-next.reqif'), 'doors-next.reqif');
		const { files } = await importInto(demo, doc);
		const xml = writeReqif({ context: contextFor(files), title: 'Delivery drone', now });
		expect(checkReqif(xml)).toEqual([]);
		for (const id of ['_spec_sysreq', '_so_1001', '_so_1002', '_so_1007'])
			expect(xml).toContain(`IDENTIFIER="${id}"`);
	});

	it('imports back into an empty project as the same requirements and derivations', async () => {
		const xml = writeReqif({ context: contextFor(demo), title: 'Delivery drone', now });
		const doc = await read(xml, 'Delivery drone requirements.reqif');
		expect(problemList(doc)).toEqual([]);
		const empty = {
			'libraries/EngineeringBasics.sysml': demo['libraries/EngineeringBasics.sysml']!
		};
		const { files, plan } = await importInto(empty, doc, {
			def: contextFor(empty).defs.find((d) => d.label === 'EngineeringRequirement')!
		});
		expect(plan.notes).toEqual([]);
		expect(errors(files)).toEqual([]);
		const summary = (rows: RequirementRow[]) => {
			const byKey = new Map(rows.map((r) => [r.key, r.id]));
			return rows
				.map((r) => ({
					id: r.id,
					title: r.title,
					text: plainText(r.text),
					kind: r.kind,
					priority: r.priority,
					verification: r.verificationMethods,
					status: r.status,
					owner: r.owner,
					rationale: r.rationale,
					derivedFrom: r.derivedFrom.map((k) => byKey.get(k)).sort()
				}))
				.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
		};
		const before = summary(rowsOf(demo).filter((r) => !r.file.startsWith('libraries/')));
		const after = summary(rowsOf(files));
		expect(after).toEqual(before);
	});

	it('turns text into XHTML paragraphs and lists', () => {
		expect(textXhtml('First line\nwrapped.\n\n- one\n- two <b>\n\n1. a\n2. b')).toBe(
			'<xhtml:div><xhtml:p>First line wrapped.</xhtml:p><xhtml:ul><xhtml:li>one</xhtml:li><xhtml:li>two &lt;b&gt;</xhtml:li></xhtml:ul><xhtml:ol><xhtml:li>a</xhtml:li><xhtml:li>b</xhtml:li></xhtml:ol></xhtml:div>'
		);
	});

	it('finds what breaks the schema’s rules', () => {
		const xml = writeReqif({ context: contextFor(demo), title: 'x', now });
		expect(checkReqif(xml.replace('<TITLE>x</TITLE>', ''))).toEqual([
			expect.stringMatching(/<REQ-IF-HEADER> has no <TITLE>/)
		]);
		const twice = xml.replace(
			'IDENTIFIER="tessera-req-SYS-002"',
			'IDENTIFIER="tessera-req-SYS-001"'
		);
		expect(checkReqif(twice).join('\n')).toMatch(/IDENTIFIER tessera-req-SYS-001 is used twice/);
		expect(checkReqif(twice).join('\n')).toMatch(
			/points to tessera-req-SYS-002, which is not in the file/
		);
		expect(checkReqif(xml.replace(/ LAST-CHANGE="[^"]*"/, ''))).toEqual([
			expect.stringMatching(/has no LAST-CHANGE/)
		]);
		const moved = xml.replace(
			/(<TYPE><SPEC-OBJECT-TYPE-REF>tessera-type-requirement<\/SPEC-OBJECT-TYPE-REF><\/TYPE>)\n(\s*)<\/SPEC-OBJECT>/,
			'$1\n$2<VALUES/>\n$2</SPEC-OBJECT>'
		);
		expect(checkReqif(moved).join('\n')).toMatch(/<VALUES> is out of place in <SPEC-OBJECT>/);
		expect(checkReqif('<REQ-IF')).toEqual([expect.stringMatching(/never closed/)]);
	});
});

describe('helpers', () => {
	it('finds where a package is declared, comments left out', () => {
		const text =
			"package A {\n    // package B {\n    package B {\n        package 'C d' {\n        }\n    }\n}\n";
		expect(packageLine(text, "A::B::'C d'")).toBe(4);
		expect(packageLine(text, 'A::B')).toBe(3);
		expect(packageLine(text, 'A::X')).toBeNull();
	});
});
