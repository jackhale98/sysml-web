/**
 * Model exchange through the code the worker runs: the demo as SysML v2 JSON
 * (structure, the OMG schema, stable ids), a hand-written JSON file as text,
 * and the round trip demo → JSON → text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	changeSet,
	checkStructure,
	compareModels,
	readElements,
	rebaseIds,
	type ElementJson
} from '#lib/exchange/elements.ts';
import { schemaErrors } from '#lib/exchange/schema-testing.ts';
import type { InterchangeExport } from '#lib/exchange/types.ts';
import type { SourceFile } from '../protocol';
import type { ToolkitHost } from './host';
import { mendPrinted, tidy } from './interchange';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
const demo = demoFiles();
let exported: InterchangeExport;
let elements: ElementJson[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fixture = (name: string) =>
	readFileSync(join(import.meta.dirname, '../../exchange/fixtures', name), 'utf8');

beforeAll(async () => {
	host = await loadHost();
	exported = host.exportInterchange(demo, {});
	elements = readElements(exported.json);
}, 60_000);

/** Qualified names of the named elements a set of files declares, with their kinds. */
async function namedElements(files: SourceFile[]): Promise<string[]> {
	const json = host.exportInterchange(files, {}).json;
	const els = readElements(json);
	const byId = new Map(els.map((e) => [e['@id'], e]));
	const names: string[] = [];
	for (const e of els) {
		const path: string[] = [];
		let at: ElementJson | undefined = e;
		let complete = true;
		while (at) {
			const owner = (at.owningRelationship ?? at.owningRelatedElement) as { '@id': string } | null;
			if (!at['@type'].endsWith('Membership') && at['@type'] !== 'Namespace') {
				if (typeof at.declaredName !== 'string') {
					complete = false;
					break;
				}
				path.unshift(at.declaredName);
			}
			at = owner ? byId.get(owner['@id']) : undefined;
		}
		if (complete && path.length) names.push(`${e['@type']} ${path.join('::')}`);
	}
	return names.sort();
}

describe('export', () => {
	it('writes every element with an @id and an @type, once', () => {
		expect(exported.elements).toBe(elements.length);
		expect(elements.length).toBeGreaterThan(6000);
		for (const e of elements) {
			expect(e['@id']).toMatch(UUID);
			expect(e['@type']).toMatch(/^[A-Z]\w+$/);
			expect(e.elementId).toBe(e['@id']);
		}
	});

	it('resolves every reference within the file or to the standard library', () => {
		const ids = new Set(elements.map((e) => e['@id']));
		const report = checkStructure(elements, (id) => !ids.has(id));
		expect(report.duplicates).toEqual([]);
		expect(report.malformed).toEqual([]);
		expect(exported.dangling).toBe(0);
		expect(exported.libraryReferences).toBe(report.outside);
		expect(exported.libraryReferences).toBeGreaterThan(50);
		expect(exported.leftOut).toEqual([]);
	});

	it('is valid against the OMG schema (properties present; derived ones absent)', () => {
		expect(schemaErrors(elements, false)).toEqual([]);
		// Every non-derived property is spelled, defaults included.
		const part = elements.find((e) => e['@type'] === 'PartUsage')!;
		for (const property of [
			'aliasIds',
			'declaredShortName',
			'isAbstract',
			'isComposite',
			'direction'
		])
			expect(part).toHaveProperty(property);
		expect(part).not.toHaveProperty('qualifiedName');
	});

	it('with derived properties, has every property the OMG schema requires', () => {
		const full = readElements(host.exportInterchange(demo, { derived: true }).json);
		expect(full.length).toBeGreaterThan(elements.length);
		expect(schemaErrors(full, true)).toEqual([]);
	}, 60_000);

	it('keeps the same ids from one export to the next, and through edits elsewhere', () => {
		const again = readElements(host.exportInterchange(demo, {}).json);
		expect(again.map((e) => e['@id'])).toEqual(elements.map((e) => e['@id']));
		// Another requirement added: every element that was there keeps its id.
		const path = 'requirements/SystemRequirements.sysml';
		const edited = demo.map((f) =>
			f.path === path
				? { ...f, text: f.text.replace(/\n}\s*$/, "\n    requirement <'SYS-099'> extra;\n}\n") }
				: f
		);
		const after = new Set(
			readElements(host.exportInterchange(edited, {}).json).map((e) => e['@id'])
		);
		expect(elements.filter((e) => !after.has(e['@id']))).toEqual([]);
	}, 60_000);

	it('leaves out references that resolve to nothing, and says which', () => {
		const result = host.exportInterchange(
			[{ path: 'a.sysml', text: 'package P { part x : Nope; part y : P::y; }' }],
			{}
		);
		expect(result.leftOut).toEqual([{ element: 'P::x', reference: 'Nope' }]);
		const els = readElements(result.json);
		expect(checkStructure(els).malformed).toEqual([]);
		expect(result.json).not.toContain('@ref');
	});

	it('includes the standard library with its standard ids, so every reference resolves in the file', () => {
		const small = [
			{ path: 'a.sysml', text: 'package P { part def V { attribute m :> ISQ::mass; } }' }
		];
		const result = host.exportInterchange(small, { library: true });
		const all = readElements(result.json);
		expect(result.libraryElements).toBeGreaterThan(90_000);
		expect(result.dangling).toBe(0);
		const report = checkStructure(all);
		expect(report.duplicates).toEqual([]);
		expect(report.dangling).toEqual([]);
		// Standard ids (KerML 9.1): `Parts::Part` is the same in every tool.
		expect(all.some((e) => e['@id'] === '0774a545-39e3-5bc1-9607-63beabc6bf65')).toBe(true);
	}, 120_000);
});

describe('import', () => {
	it('turns a hand-written JSON file into text with no problems', () => {
		const result = host.importInterchange(fixture('garage.json'));
		expect(result.files.map((f) => f.path)).toEqual(['Garage.sysml']);
		const text = result.files[0]!.text;
		expect(text).toContain('package Garage {');
		expect(text).toMatch(/part def Vehicle \{/);
		expect(text).toMatch(/attribute mass :> (\w+::)?mass;/);
		expect(text).toMatch(/part engine : Engine;/);
		expect(text).toMatch(/attribute power : (ScalarValues::)?Real;/);
		expect(text).toMatch(/part car : Vehicle;/);
		expect(text).toContain('A small model written by hand');
		expect(result.problems).toEqual([]);
		expect(result.notes.filter((n) => n.kind !== 'repaired')).toEqual([]);
		expect(result.carried).toBe(result.elements);
	});

	it('reads back as the same elements: saving it again would change nothing', () => {
		const sample = readElements(fixture('garage.json'));
		const { files } = host.importInterchange(fixture('garage.json'));
		const ours = readElements(host.exportInterchange(files, {}).json);
		const { elements: rebased, matched } = rebaseIds(ours, sample);
		expect(matched).toBe(sample.length);
		expect(changeSet(sample, rebased)).toEqual({ created: [], updated: [], deleted: [] });
	});

	it('reports what it leaves out, element by element', () => {
		const sample = JSON.parse(fixture('garage.json')) as ElementJson[];
		const pkg = sample.find((e) => e['@type'] === 'Package')!;
		sample.push(
			{
				'@id': '0b3c2f5e-9a51-4d8e-8f7e-0c0b1f9d2a11',
				'@type': 'OwningMembership',
				owningRelatedElement: { '@id': pkg['@id'] },
				ownedRelatedElement: [{ '@id': '5d0f1e7a-3c2b-4a19-9e8d-7f6a5b4c3d21' }]
			},
			{
				'@id': '5d0f1e7a-3c2b-4a19-9e8d-7f6a5b4c3d21',
				'@type': 'FancyWidget',
				declaredName: 'gizmo',
				owningRelationship: { '@id': '0b3c2f5e-9a51-4d8e-8f7e-0c0b1f9d2a11' }
			}
		);
		(pkg.ownedRelationship as { '@id': string }[]).push({
			'@id': '0b3c2f5e-9a51-4d8e-8f7e-0c0b1f9d2a11'
		});
		// A value the text can't hold: a part at package level is not composite in SysML text.
		sample.find((e) => e.declaredName === 'car')!.isComposite = true;
		const result = host.importInterchange(JSON.stringify(sample));
		const said = result.notes.map((n) => `${n.kind}: ${n.message} ${n.element ?? ''}`).join('\n');
		expect(said).toMatch(/fancy widget/i);
		expect(said).toContain('Garage::gizmo');
		expect(said).toMatch(
			/changed: A part usage reads differently from the file: isComposite true → false\. Garage::car/
		);
		expect(result.files[0]!.text).toContain('part def Vehicle');
	});

	it('says plainly when a file is not SysML v2 JSON', () => {
		expect(() => host.importInterchange('{"name": "a project"}')).toThrow(/no model elements/);
		expect(() => host.importInterchange('not json')).toThrow(/isn’t a JSON file/);
		expect(() => host.importInterchange('[{"@type": "Package"}]')).toThrow(/has no "@id"/);
	});

	it('leaves the standard library out of a file that includes it', () => {
		const small = [
			{ path: 'a.sysml', text: 'package P { part def V { attribute m :> ISQ::mass; } }' }
		];
		const json = host.exportInterchange(small, { library: true }).json;
		const result = host.importInterchange(json);
		expect(result.files.map((f) => f.path)).toEqual(['P.sysml']);
		expect(result.problems).toEqual([]);
		expect(result.notes.map((n) => n.kind)).toContain('library');
	}, 120_000);
});

describe('round trip: the demo → JSON → text', () => {
	it('has no problems and the same elements', async () => {
		const result = host.importInterchange(exported.json);
		expect(result.problems).toEqual([]);
		// Everything the file holds is in the text; the only notes are the printer slips mended.
		expect(result.carried).toBe(result.elements);
		expect(result.notes.filter((n) => n.kind !== 'repaired')).toEqual([]);
		// The same named elements, by qualified name and kind.
		expect(await namedElements(result.files)).toEqual(await namedElements(demo));
		// And the same structure, element by element (ids differ: they come from file names).
		const again = readElements(host.exportInterchange(result.files, {}).json);
		const difference = compareModels(elements, again);
		expect(difference.onlyInFirst).toEqual([]);
		expect(difference.onlyInSecond).toEqual([]);
		expect(difference.changed).toEqual([]);
	}, 120_000);
});

describe('mending printed text', () => {
	it('turns a decision’s else branch and a printed message back into SysML', () => {
		const text = [
			'action def A {',
			'    then decide;',
			'    if x then b;',
			'    transition then c;',
			'    then flow m of : T from a to b {',
			'    }',
			'}'
		].join('\n');
		const { files, messages } = mendPrinted(
			[{ path: 'a.sysml', text }],
			[
				{
					unit: 'a.sysml',
					line: 4,
					col: 5,
					endLine: 4,
					endCol: 9,
					severity: 'error',
					stage: 'context',
					message: 'a transition usage is not allowed in an action body'
				},
				{
					unit: 'a.sysml',
					line: 5,
					col: 5,
					endLine: 5,
					endCol: 9,
					severity: 'error',
					stage: 'semantic',
					message: 'A flow end must … [validateFlowEndSubsetting]'
				}
			]
		);
		expect(files[0]!.text.split('\n')[3]).toBe('    else c;');
		expect(files[0]!.text.split('\n')[4]).toBe('    then message m of T from a to b {');
		expect(messages).toHaveLength(2);
	});

	it('collapses double spaces in code, not in comments or names', () => {
		expect(tidy('    flow  of : T  from a to b;')).toBe('    flow of : T from a to b;');
		expect(tidy("    part 'two  spaces';")).toBe("    part 'two  spaces';");
		expect(tidy('    doc /*\n     * keep  this\n     */')).toBe(
			'    doc /*\n     * keep  this\n     */'
		);
	});
});
