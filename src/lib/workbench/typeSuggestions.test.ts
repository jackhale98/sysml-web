import { describe, expect, it } from 'vitest';
import type { LibraryHit } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import {
	commonValueTypes,
	definitionKinds,
	imports,
	librarySuggestions,
	projectSuggestions
} from './typeSuggestions.ts';

const span = { start_row: 1, start_col: 1, end_row: 1, end_col: 1, start_byte: 0, end_byte: 0 };
let n = 0;
const def = (name: string, kind = 'part', over: Partial<ModelElement> = {}): ModelElement => ({
	key: `a.sysml@${n++}`,
	name,
	label: name,
	kind,
	isDefinition: true,
	parent: null,
	typeRef: null,
	shortName: null,
	doc: null,
	multiplicity: null,
	value: null,
	file: 'structure/Parts.sysml',
	span,
	...over
});

describe('imports', () => {
	const file =
		'package P {\n  private import ISQ::*;\n  import ScalarValues::Real;\n  import Lib::**;\n}';
	it('sees wildcard, re-exporting, recursive and single imports', () => {
		expect(imports(file, 'ISQBase::MassValue')).toBe(true);
		expect(imports(file, 'ScalarValues::Real')).toBe(true);
		expect(imports(file, 'ScalarValues::Integer')).toBe(false);
		expect(imports(file, 'Lib::Inner::Thing')).toBe(true);
		expect(imports(file, 'Parts::Part')).toBe(false);
	});
});

describe('projectSuggestions', () => {
	const elements = [
		def('Battery', 'part', { doc: 'Stores energy.\nMore.' }),
		def('BatteryPack'),
		def('Motor'),
		def('battery', 'part', { isDefinition: false }),
		def('PowerPort', 'port')
	];
	it('offers definitions of the right kind, alphabetically when nothing is typed', () => {
		expect(projectSuggestions(elements, ['part'], '').map((s) => s.label)).toEqual([
			'Battery',
			'BatteryPack',
			'Motor'
		]);
	});
	it('ranks matches and leaves out excluded names', () => {
		const found = projectSuggestions(elements, ['part'], 'batt', ['BatteryPack']);
		expect(found.map((s) => s.label)).toEqual(['Battery']);
		expect(found[0]).toMatchObject({
			insert: 'Battery',
			detail: 'Parts.sysml',
			description: 'Stores energy.'
		});
	});
});

describe('library suggestions', () => {
	const hit = (qualifiedName: string, kind: string): LibraryHit => ({
		name: qualifiedName.split('::').pop()!,
		qualifiedName,
		kind,
		isDefinition: true,
		path: 'x.sysml',
		line: 1
	});
	it('keeps the right kinds and qualifies names the file does not import', () => {
		const hits = [hit('ISQBase::MassValue', 'attribute def'), hit('Parts::Part', 'part def')];
		const kinds = definitionKinds('attribute').library;
		const found = librarySuggestions(hits, kinds, 'mass', 'package P { }');
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ label: 'MassValue', insert: 'ISQBase::MassValue' });
		expect(librarySuggestions(hits, kinds, 'mass', 'import ISQ::*;')[0]!.insert).toBe('MassValue');
	});
	it('lists common value types with what they mean', () => {
		const common = commonValueTypes('import ScalarValues::*;');
		expect(common[0]).toMatchObject({ label: 'Real', insert: 'Real', kind: 'datatype' });
		expect(common.find((c) => c.label === 'MassValue')?.insert).toBe('ISQBase::MassValue');
	});
});
