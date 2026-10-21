import { describe, expect, it } from 'vitest';
import { applyChanges, minimalChange } from './workspace.svelte.ts';

describe('minimalChange', () => {
	it('keeps the common prefix and suffix', () => {
		const from = 'part def A;\npart def B;\n';
		const to = 'part def A;\n    part x;\npart def B;\n';
		const change = minimalChange(from, to)!;
		expect(change).toEqual({ from: 12, to: 12, insert: '    part x;\n' });
		expect(applyChanges(from, [change])).toBe(to);
	});

	it('round-trips deletions and replacements', () => {
		for (const [a, b] of [
			['abcdef', 'abef'],
			['aaa', 'aaaa'],
			['xyz', ''],
			['', 'new']
		] as const) {
			expect(applyChanges(a, [minimalChange(a, b)!])).toBe(b);
		}
		expect(minimalChange('same', 'same')).toBeNull();
	});
});
