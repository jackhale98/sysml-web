import { describe, expect, it } from 'vitest';
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
import { describingPackage, docSummary } from './model.ts';

const span = { start_row: 1, start_col: 1, end_row: 1, end_col: 1, start_byte: 0, end_byte: 0 };
const pkg = (label: string, file = `${label}.sysml`): TreeNode => ({
	element: {
		key: `${file}@0`,
		name: label,
		label,
		kind: 'package',
		isDefinition: true,
		parent: null,
		typeRef: null,
		shortName: null,
		doc: null,
		multiplicity: null,
		value: null,
		file,
		span
	} satisfies ModelElement,
	children: []
});

describe('describingPackage', () => {
	it('takes the only package', () => {
		expect(describingPackage([pkg('PumpSystem')], 'Anything')?.label).toBe('PumpSystem');
	});
	it('takes the package named like the project, then one sharing its start', () => {
		const tree = [pkg('Views'), pkg('Drone'), pkg('PumpSystem')];
		expect(describingPackage(tree, 'drone')?.label).toBe('Drone');
		expect(describingPackage(tree, 'Pump')?.label).toBe('PumpSystem');
		expect(describingPackage(tree, 'Cooling loop')).toBeNull();
	});
});

describe('docSummary', () => {
	it('keeps the first paragraph on one line', () => {
		expect(docSummary('A pump skid\nfor a cooling loop.\n\nMore detail.')).toBe(
			'A pump skid for a cooling loop.'
		);
	});
});
