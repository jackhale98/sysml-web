import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	changeSet,
	checkStructure,
	compareModels,
	keyLabel,
	ownershipKeys,
	readElements,
	rebaseIds,
	type ElementJson
} from './elements';

const text = readFileSync(join(import.meta.dirname, 'fixtures/garage.json'), 'utf8');
const garage = () => readElements(text);

describe('reading a file', () => {
	it('reads a flat array of elements', () => {
		expect(garage()).toHaveLength(21);
	});

	it('reads what an API server answers: data versions with payloads', () => {
		const versions = garage().map((e) => ({ identity: { '@id': e['@id'] }, payload: e }));
		versions.push({ identity: { '@id': 'gone' }, payload: null as unknown as ElementJson });
		expect(readElements(JSON.stringify(versions))).toHaveLength(21);
	});

	it('says what is wrong, plainly', () => {
		expect(() => readElements('{')).toThrow(/isn’t a JSON file/);
		expect(() => readElements('{"name": "x"}')).toThrow(/no model elements/);
		expect(() => readElements('[1]')).toThrow(/Item 1 .* not an element/);
		expect(() => readElements('[{"@id": "a"}]')).toThrow(/Element a has no "@type"/);
		expect(() => readElements('[]')).toThrow(/no model elements/);
	});
});

describe('structure', () => {
	it('finds references to nothing, and accepts the standard library’s', () => {
		const els = garage();
		const ids = new Set(els.map((e) => e['@id']));
		const outside = [
			...new Set(els.flatMap((e) => JSON.stringify(e).match(/[0-9a-f-]{36}/g) ?? []))
		].filter((id) => !ids.has(id));
		// ISQ::mass and ScalarValues::Real, each referred to twice (e.g. `type` and `general`).
		expect(outside).toHaveLength(2);
		expect(checkStructure(els).dangling).toHaveLength(4);
		const known = checkStructure(els, (id) => outside.includes(id));
		expect(known.dangling).toEqual([]);
		expect(known.outside).toBe(4);
		expect(known.duplicates).toEqual([]);
	});

	it('flags duplicate ids and values that are not references', () => {
		const els = garage();
		els.push({ ...els[3]! });
		els[5]!.type = { '@ref': 'Name' };
		const report = checkStructure(els);
		expect(report.duplicates).toEqual([els[3]!['@id']]);
		expect(report.malformed).toEqual([{ from: els[5]!['@id'], property: 'type' }]);
	});
});

describe('matching by place', () => {
	it('gives every element a key from names and positions, not ids', () => {
		const keys = ownershipKeys(garage());
		expect(new Set(keys.values()).size).toBe(21);
		const label = (name: string) =>
			keyLabel(keys.get(garage().find((e) => e.declaredName === name)!['@id'])!);
		expect(label('engine')).toBe('Garage::Vehicle::engine');
		expect(label('Garage')).toBe('Garage');
	});

	it('finds no difference between the same model with other ids', () => {
		const ours = garage();
		const rebased = rebaseIds(ours, ours).elements;
		const renamed = ours.map((e) => ({ ...e, '@id': `x-${e['@id']}` }));
		expect(compareModels(ours, rebased)).toEqual({
			onlyInFirst: [],
			onlyInSecond: [],
			changed: []
		});
		expect(compareModels(ours, renamed).changed).toEqual([]);
	});

	it('says which properties changed', () => {
		const before = garage();
		const after = garage();
		after.find((e) => e.declaredName === 'power')!.declaredName = 'output';
		after.find((e) => e['@type'] === 'Documentation')!.body = 'Changed.';
		const difference = compareModels(before, after);
		expect(difference.changed).toEqual([
			expect.objectContaining({ type: 'Documentation', properties: ['body'] }),
			// Engine now owns a membership that sits elsewhere.
			expect.objectContaining({ type: 'PartDefinition', properties: ['ownedRelationship'] })
		]);
		// A renamed element sits elsewhere: gone in one, new in the other.
		expect(difference.onlyInFirst.map((d) => keyLabel(d.key))).toContain('Garage::Engine::power');
		expect(difference.onlyInSecond.map((d) => keyLabel(d.key))).toContain('Garage::Engine::output');
	});

	it('lists what to send: created, updated and deleted', () => {
		const base = garage();
		const next = garage().filter((e) => e['@type'] !== 'Documentation');
		next.find((e) => e.declaredName === 'car')!.isAbstract = true;
		next.push({ '@id': 'new-1', '@type': 'Comment', body: 'Hi' });
		const changes = changeSet(base, next);
		expect(changes.created.map((e) => e['@id'])).toEqual(['new-1']);
		expect(changes.updated.map((e) => e.declaredName)).toEqual(['car']);
		expect(changes.deleted).toEqual([base.find((e) => e['@type'] === 'Documentation')!['@id']]);
	});

	it('ignores properties the base has and ours doesn’t spell (a server’s derived values)', () => {
		const base = garage().map((e) => ({ ...e, owner: null, isLibraryElement: false }));
		expect(changeSet(base, garage())).toEqual({ created: [], updated: [], deleted: [] });
	});
});
