import { describe, expect, it } from 'vitest';
import type { Analysis, Span } from '#lib/engine/types.ts';
import { buildTree, byteToUtf16, collectElements, elementAt, utf16ToByte } from './elements';

const span = (start_byte: number, end_byte: number): Span => ({
	start_row: 1,
	start_col: 1,
	end_row: 1,
	end_col: 1,
	start_byte,
	end_byte
});

const analysis: Analysis = {
	diagnostics: [],
	model: {
		file: 'a.sysml',
		syntax_errors: [],
		satisfactions: [],
		verifications: [],
		definitions: [
			{ kind: 'package', name: 'Drone', super_type: null, span: span(0, 100) },
			{ kind: 'part', name: 'Frame', super_type: null, span: span(10, 40), parent_def: 'Drone' }
		],
		usages: [
			{
				kind: 'part',
				name: 'arm',
				type_ref: 'Arm',
				multiplicity: '4',
				span: span(20, 30),
				parent_def: 'Frame'
			},
			{ kind: 'part', name: "'top cover'", type_ref: null, span: span(50, 60), parent_def: 'Drone' }
		]
	}
};

describe('elements', () => {
	const elements = collectElements([analysis]);

	it('collects definitions and usages with display labels', () => {
		expect(elements.map((e) => e.label)).toEqual(['Drone', 'Frame', 'arm', 'top cover']);
		expect(elements.find((e) => e.name === 'arm')).toMatchObject({
			isDefinition: false,
			typeRef: 'Arm',
			multiplicity: '4'
		});
	});

	it('nests elements under their owners', () => {
		const [root] = buildTree(elements);
		expect(root?.element.label).toBe('Drone');
		expect(root?.children.map((c) => c.element.label)).toEqual(['Frame', 'top cover']);
		expect(root?.children[0]?.children.map((c) => c.element.label)).toEqual(['arm']);
	});

	it('finds the innermost element at an offset', () => {
		expect(elementAt(elements, 'a.sysml', 25)?.name).toBe('arm');
		expect(elementAt(elements, 'a.sysml', 45)?.name).toBe('Drone');
		expect(elementAt(elements, 'b.sysml', 25)).toBeUndefined();
	});

	it('converts between UTF-16 and UTF-8 offsets', () => {
		const text = 'a°b';
		expect(utf16ToByte(text, 2)).toBe(3);
		expect(byteToUtf16(text, 3)).toBe(2);
	});
});
