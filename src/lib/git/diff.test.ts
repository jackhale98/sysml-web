import { describe, expect, it } from 'vitest';
import { blobSha, diffStats, hunks, lineDiff, merge3, splitLines } from './diff.ts';

const lines = (...l: string[]) => l.map((x) => `${x}\n`).join('');

describe('lineDiff', () => {
	it('keeps line endings so lines join back into the text', () => {
		expect(splitLines('a\nb\nc')).toEqual(['a\n', 'b\n', 'c']);
		expect(splitLines('')).toEqual([]);
	});

	it('finds added, removed and unchanged lines with numbers', () => {
		const diff = lineDiff(lines('a', 'b', 'c', 'd'), lines('a', 'x', 'c', 'd', 'e'));
		expect(diff.map((l) => `${l.op[0]}${l.text.trim()}`)).toEqual([
			'ea',
			'db',
			'ax',
			'ec',
			'ed',
			'ae'
		]);
		expect(diff.find((l) => l.text === 'x\n')).toMatchObject({ new: 2 });
		expect(diff.find((l) => l.text === 'b\n')).toMatchObject({ old: 2 });
		expect(diffStats(diff)).toEqual({ added: 2, removed: 1 });
	});

	it('is minimal on interleaved edits', () => {
		const a = lines('1', '2', '3', '4', '5', '6', '7');
		const b = lines('1', '3', '4', 'X', '5', '7', '8');
		const diff = lineDiff(a, b);
		expect(diffStats(diff)).toEqual({ added: 2, removed: 2 });
		// Rebuilding both sides from the diff gives the texts back.
		expect(
			diff
				.filter((l) => l.op !== 'add')
				.map((l) => l.text)
				.join('')
		).toBe(a);
		expect(
			diff
				.filter((l) => l.op !== 'del')
				.map((l) => l.text)
				.join('')
		).toBe(b);
	});

	it('handles new and emptied files', () => {
		expect(diffStats(lineDiff('', lines('a', 'b')))).toEqual({ added: 2, removed: 0 });
		expect(diffStats(lineDiff(lines('a', 'b'), ''))).toEqual({ added: 0, removed: 2 });
	});

	it('folds long unchanged runs into hunks with context', () => {
		const before = Array.from({ length: 40 }, (_, i) => `line ${i}\n`).join('');
		const after = before.replace('line 5\n', 'five\n').replace('line 30\n', 'thirty\n');
		const result = hunks(lineDiff(before, after), 2);
		expect(result).toHaveLength(2);
		expect(result[0]!.skipped).toBe(3);
		expect(result[0]!.lines.map((l) => l.op)).toEqual([
			'equal',
			'equal',
			'del',
			'add',
			'equal',
			'equal'
		]);
		expect(result[1]!.skipped).toBe(20);
	});
});

describe('merge3', () => {
	const base = lines('part def A;', 'part def B;', 'part def C;', 'part def D;', 'part def E;');

	it('combines changes to different lines', () => {
		const mine = base.replace('part def A;', 'part def A1;');
		const theirs = base.replace('part def E;', 'part def E1;');
		expect(merge3(base, mine, theirs)).toBe(
			lines('part def A1;', 'part def B;', 'part def C;', 'part def D;', 'part def E1;')
		);
	});

	it('refuses changes to the same line', () => {
		const mine = base.replace('part def C;', 'part def Mine;');
		const theirs = base.replace('part def C;', 'part def Theirs;');
		expect(merge3(base, mine, theirs)).toBeNull();
	});

	it('refuses changes to adjacent lines and insertions at the same place', () => {
		expect(
			merge3(base, base.replace('part def B;', 'B2;'), base.replace('part def C;', 'C2;'))
		).toBeNull();
		expect(
			merge3(
				base,
				base.replace('part def C;\n', 'part def C;\nmine;\n'),
				base.replace('part def C;\n', 'part def C;\ntheirs;\n')
			)
		).toBeNull();
	});

	it('accepts the same change made on both sides', () => {
		const mine = base.replace('part def C;', 'part def Same;').replace('part def A;', 'a;');
		const theirs = base.replace('part def C;', 'part def Same;');
		expect(merge3(base, mine, theirs)).toBe(mine);
	});
});

describe('blobSha', () => {
	it('matches git hash-object', async () => {
		// `printf 'hello\n' | git hash-object --stdin`
		expect(await blobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
		expect(await blobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
	});
});
