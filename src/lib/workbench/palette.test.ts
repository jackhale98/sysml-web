import { describe, expect, it } from 'vitest';
import {
	commandItems,
	fileItems,
	fuzzyMatch,
	matchItem,
	search,
	segments,
	viewItems,
	MAX_ELEMENTS,
	MAX_RESULTS,
	type PaletteItem,
	type PaletteSources
} from './palette';

function element(label: string, extra: Partial<PaletteItem> = {}): PaletteItem {
	return {
		id: `element:${label}${extra.shortId ?? ''}${extra.library ? ':lib' : ''}`,
		group: 'elements',
		label,
		keyword: 'part def',
		detail: 'model.sysml',
		kind: 'part',
		isDefinition: true,
		action: { type: 'element', key: label, file: 'model.sysml' },
		...extra
	};
}

function sources(elements: PaletteItem[] = [], files: string[] = []): PaletteSources {
	return { elements, views: [], files: fileItems(files), commands: commandItems('system') };
}

function labels(sources_: PaletteSources, query: string): string[] {
	return search(sources_, query).map((r) => r.item.label);
}

describe('fuzzyMatch', () => {
	const score = (q: string, text: string) => fuzzyMatch(q, text)?.score ?? null;

	it('is case-insensitive and reports the matched characters', () => {
		expect(fuzzyMatch('BAT', 'Battery')?.ranges).toEqual([[0, 3]]);
		expect(fuzzyMatch('tter', 'Battery')?.ranges).toEqual([[2, 6]]);
	});

	it('ranks prefix > word start > substring > subsequence', () => {
		const prefix = score('bat', 'Battery')!;
		const wordStart = score('bat', 'Main Battery')!;
		const camelStart = score('bat', 'mainBattery')!;
		const substring = score('att', 'Battery')!;
		const subsequence = score('btr', 'Battery')!;
		expect(prefix).toBeGreaterThan(wordStart);
		expect(wordStart).toBeGreaterThan(substring);
		expect(camelStart).toBeGreaterThan(substring);
		expect(substring).toBeGreaterThan(subsequence);
		expect(subsequence).toBeGreaterThan(0);
	});

	it('prefers the shorter text when the tier is equal', () => {
		expect(score('bat', 'Battery')!).toBeGreaterThan(score('bat', 'BatteryManagementSystem')!);
		expect(score('battery', 'Battery')!).toBeGreaterThan(score('batter', 'Battery')!);
	});

	it('matches initials across words', () => {
		const m = fuzzyMatch('bms', 'BatteryManagementSystem');
		expect(m?.ranges).toEqual([
			[0, 1],
			[7, 8],
			[17, 18]
		]);
	});

	it('finds subsequences and joins adjacent characters', () => {
		expect(fuzzyMatch('btry', 'Battery')?.ranges).toEqual([
			[0, 1],
			[2, 3],
			[5, 7]
		]);
	});

	it('rejects characters that are missing, out of order or far apart', () => {
		expect(fuzzyMatch('xyz', 'Battery')).toBeNull();
		expect(fuzzyMatch('yb', 'Battery')).toBeNull();
		expect(fuzzyMatch('ae', `a${'x'.repeat(40)}e`)).toBeNull();
	});

	it('needs every word of a multi-word query', () => {
		expect(fuzzyMatch('max mass', 'maximum vehicle mass')).not.toBeNull();
		expect(fuzzyMatch('max zebra', 'maximum vehicle mass')).toBeNull();
	});

	it('keeps offsets valid for characters whose lower case changes length', () => {
		expect(fuzzyMatch('bat', 'İBattery')?.ranges).toEqual([[1, 4]]);
	});
});

describe('matchItem', () => {
	it('matches the short id and the keyword', () => {
		const item = element('Battery', { shortId: 'SYS-001' });
		expect(matchItem('sys-001', item)?.ranges.shortId).toEqual([[0, 7]]);
		expect(matchItem('part def', item)?.ranges.keyword).toEqual([
			[0, 4],
			[5, 8]
		]);
		expect(matchItem('part battery', item)).not.toBeNull();
	});

	it('weighs the label above the keyword', () => {
		const byLabel = matchItem('part', element('Part Bin', { keyword: 'item def' }))!;
		const byKeyword = matchItem('part', element('Battery'))!;
		expect(byLabel.score).toBeGreaterThan(byKeyword.score);
	});
});

describe('segments', () => {
	it('splits a text into plain and matched runs', () => {
		expect(segments('Battery', [[0, 3]])).toEqual([
			{ text: 'Bat', hit: true },
			{ text: 'tery', hit: false }
		]);
		expect(segments('Battery', undefined)).toEqual([{ text: 'Battery', hit: false }]);
		expect(
			segments('abc', [
				[1, 2],
				[0, 1]
			])
		).toEqual([
			{ text: 'ab', hit: true },
			{ text: 'c', hit: false }
		]);
	});
});

describe('search', () => {
	it('offers the best views and the commands for an empty query', () => {
		const packages = Array.from({ length: 9 }, (_, i) => ({
			element: {
				key: `k${i}`,
				name: `Pkg${i}`,
				label: `Pkg${i}`
			},
			children: i === 7 ? [{ element: { key: 'c' }, children: [] }] : []
		}));
		const all = {
			...sources(),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			views: viewItems(packages as any)
		};
		const results = search(all, '  ');
		expect(results.filter((r) => r.item.group === 'views')).toHaveLength(6);
		expect(results[0]?.item.label).toBe('Pkg7');
		expect(results.filter((r) => r.item.group === 'commands')).toHaveLength(8);
		expect(results.every((r) => r.match === null)).toBe(true);
	});

	it('orders groups elements, views, files, commands', () => {
		const s: PaletteSources = {
			...sources([element('Overview Part')], ['overview.sysml']),
			views: viewItems([
				{
					element: { key: 'v', name: 'Overview', label: 'Overview' },
					children: []
				} as never
			])
		};
		const groups = search(s, 'overview').map((r) => r.item.group);
		expect(groups).toEqual(['elements', 'views', 'files', 'commands']);
	});

	it('caps elements at eight and the total at fifty', () => {
		const many = Array.from({ length: 30 }, (_, i) => element(`Battery ${i}`));
		const results = search(sources(many), 'battery');
		expect(results.filter((r) => r.item.group === 'elements')).toHaveLength(MAX_ELEMENTS);

		const files = Array.from({ length: 80 }, (_, i) => `battery${i}.sysml`);
		expect(search(sources(many, files), 'battery').length).toBe(MAX_RESULTS);
	});

	it('sorts the best match first and keeps source order on ties', () => {
		const s = sources([element('Main Battery'), element('Battery'), element('Battery')]);
		const found = search(s, 'battery').filter((r) => r.item.group === 'elements');
		expect(found.map((r) => r.item.label)).toEqual(['Battery', 'Battery', 'Main Battery']);
	});

	it('shows library elements only when nothing else matches', () => {
		const lib = element('ISQ', { library: true });
		expect(labels(sources([lib]), 'isq')).toEqual(['ISQ']);
		// A single character is too little to dig into the libraries.
		expect(labels(sources([element('Zed', { library: true })]), 'z')).toEqual([]);
		// A command that matches suppresses the library fallback.
		const withHit = sources([element('Themed', { library: true })]);
		expect(labels(withHit, 'theme')).toEqual(['Switch theme']);
		// Non-library elements are unaffected.
		expect(labels(sources([element('Battery')]), 'bat')).toEqual(['Battery']);
	});

	it('finds commands by label and by alias', () => {
		expect(labels(sources(), 'diagram only')[0]).toBe('Show diagram only');
		expect(labels(sources(), 'dark')).toContain('Switch theme');
		expect(search(sources(), 'problems')[0]?.item.action).toEqual({ type: 'show-problems' });
	});

	it('returns nothing when nothing matches', () => {
		expect(search(sources([element('Battery')], ['a.sysml']), 'qqqq')).toEqual([]);
	});
});
