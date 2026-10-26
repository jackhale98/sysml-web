import { describe, expect, it } from 'vitest';
import type { CheckReport } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { limitTarget } from './guide.ts';

const requirement = (name: string, more: Partial<ModelElement> = {}): ModelElement =>
	({
		key: `model/M.sysml@${name}`,
		id: `id-${name}`,
		name,
		label: name,
		kind: 'requirement',
		isDefinition: false,
		parent: 'M',
		file: 'model/M.sysml',
		...more
	}) as ModelElement;

const limits = (...ids: string[]) =>
	({
		checks: ids.map((id) => ({ kind: 'satisfy', checkable: true, requirement: { elementId: id } }))
	}) as unknown as CheckReport;

describe('the requirement "Set a limit" starts with', () => {
	const placeholder = requirement('First requirement');
	const written = requirement('Light enough to carry');
	const elements = [
		requirement('SystemRequirement', { isDefinition: true }),
		placeholder,
		written,
		requirement('Library one', { file: 'libraries/L.sysml' })
	];

	it('is the one just written (the latest without a limit), not the first in the file', () => {
		expect(limitTarget({ elements, checks: null }, null)?.name).toBe('Light enough to carry');
	});

	it('is the selected requirement when one is selected', () => {
		expect(limitTarget({ elements, checks: null }, placeholder.key)?.name).toBe(
			'First requirement'
		);
	});

	it('passes over requirements that have a limit already', () => {
		expect(limitTarget({ elements, checks: limits(written.id!) }, null)?.name).toBe(
			'First requirement'
		);
		expect(
			limitTarget({ elements, checks: limits(written.id!, placeholder.id!) }, null)?.name
		).toBe('Light enough to carry');
	});

	it('is nothing without a requirement', () => {
		expect(limitTarget({ elements: [], checks: null }, null)).toBeUndefined();
	});
});
