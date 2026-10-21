import { describe, expect, it } from 'vitest';
import { diffTexts, type TextChange } from './diff';

function apply(text: string, changes: TextChange[]): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from))
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}

describe('diffTexts', () => {
	it('finds nothing to change in equal texts', () => {
		expect(diffTexts('a\nb', 'a\nb')).toEqual([]);
	});

	it('changes only the renamed words', () => {
		const before = 'part def Battery;\npart b : Battery;\n// unchanged\npart c : Battery[2];\n';
		const after = before.replaceAll('Battery', 'Pack');
		const changes = diffTexts(before, after);
		expect(changes).toEqual([
			{ from: 9, to: 16, insert: 'Pack' },
			{ from: 27, to: 34, insert: 'Pack' },
			{ from: 58, to: 65, insert: 'Pack' }
		]);
		expect(apply(before, changes)).toBe(after);
	});

	it('handles inserted and removed lines, and missing final newlines', () => {
		const before = 'a\nb\nc\nd';
		const after = 'a\nx\nc\nd\ne';
		expect(apply(before, diffTexts(before, after))).toBe(after);
		expect(apply('', diffTexts('', 'new\n'))).toBe('new\n');
		expect(apply('gone\n', diffTexts('gone\n', ''))).toBe('');
	});

	it('round-trips random edits', () => {
		let seed = 7;
		const random = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		const words = ['part', 'def', 'A', 'B', '{', '}', ';', '\n', '    ', 'é', '😀'];
		const make = () =>
			Array.from({ length: random(60) }, () => words[random(words.length)]).join(' ');
		for (let i = 0; i < 300; i++) {
			const before = make();
			const lines = before.split('\n');
			const after = lines
				.map((l) => (random(4) === 0 ? make() : l))
				.filter(() => random(8) !== 0)
				.join('\n');
			expect(apply(before, diffTexts(before, after))).toBe(after);
		}
	});
});
