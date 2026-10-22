import { describe, expect, it } from 'vitest';
import type { ModelElement } from '#lib/project/elements.ts';
import {
	commandItems,
	openFileItems,
	fileItems,
	selectionItems,
	fuzzyMatch,
	matchItem,
	search,
	segments,
	tableRowItems,
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
		expect(results.filter((r) => r.item.group === 'commands')).toHaveLength(
			commandItems('system').length
		);
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
		expect(labels(sources([element('Zed', { library: true })]), 'z')).not.toContain('Zed');
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

	it('offers a new file, and renaming, moving and deleting the file on show', () => {
		expect(search(sources(), 'new file')[0]?.item.action).toEqual({
			type: 'file',
			request: { kind: 'new' }
		});
		expect(openFileItems(null)).toEqual([]);
		const withFile = { ...sources(), commands: openFileItems('structure/Power.sysml') };
		expect(labels(withFile, 'file').sort()).toEqual(['Delete file', 'Move file', 'Rename file']);
		expect(search(withFile, 'delete file')[0]?.item).toMatchObject({
			detail: 'Power.sysml',
			action: { type: 'file', request: { kind: 'delete', path: 'structure/Power.sysml' } }
		});
	});

	it('returns nothing when nothing matches', () => {
		expect(search(sources([element('Battery')], ['a.sysml']), 'qqqq')).toEqual([]);
	});
});

describe('table rows', () => {
	const columns = ['ID', 'Title', 'Text', 'Priority'];
	const rows = [
		['SYS-001', 'Flight endurance', 'The drone shall fly 25 min.', 'high'],
		['SYS-007', 'Geofencing', 'The drone shall not leave the geofence.', 'high'],
		['SYS-008', 'Return home', 'Return to base when the geofence is lost.', 'low']
	];
	const items = tableRowItems('RequirementsTable', 'Requirements', columns, rows);

	it('names rows by their title column and finds them by any cell', () => {
		expect(items[1]).toMatchObject({ label: 'Geofencing', shortId: 'SYS-007', group: 'rows' });
		const s: PaletteSources = {
			...sources(),
			rows: items,
			table: { view: 'RequirementsTable', title: 'Requirements', count: () => 2 }
		};
		const results = search(s, 'geofence');
		expect(
			results
				.slice(0, 2)
				.map((r) => r.item.label)
				.sort()
		).toEqual(['Geofencing', 'Return home']);
		expect(results[2]?.item.action).toEqual({
			type: 'filter',
			view: 'RequirementsTable',
			query: 'geofence'
		});
	});

	it('finds rows by ID and offers no filter for a single hit', () => {
		const s: PaletteSources = {
			...sources(),
			rows: items,
			table: { view: 'RequirementsTable', title: 'Requirements', count: () => 1 }
		};
		const results = search(s, 'SYS-001').filter((r) => r.item.group === 'rows');
		expect(results.map((r) => r.item.action)).toEqual([
			{ type: 'row', view: 'RequirementsTable', index: 0 }
		]);
	});
});

describe('making views', () => {
	it('offers a saved view per kind for a query, and not the bare view defs', async () => {
		const { modelViewItems, newViewItems } = await import('./palette.ts');
		const items = newViewItems([{ id: 'bom', label: 'Bill of materials', description: 'd' }]);
		expect(items[0]).toMatchObject({
			label: 'New view: Bill of materials',
			quiet: true,
			action: { type: 'create', request: { kind: 'view', viewKind: 'bom' } }
		});
		const base = { file: 'views/V.sysml', hasTable: true, builtin: false };
		expect(
			modelViewItems([
				{ ...base, name: 'BillOfMaterials', isUsage: false },
				{ ...base, name: 'bom', isUsage: true, definition: 'BillOfMaterials' },
				{ ...base, name: 'chapter', isUsage: true, file: 'libraries/ModelViews.sysml' }
			]).map((i) => i.label)
		).toEqual(['BOM']);
		const s = {
			elements: [],
			views: [],
			files: [],
			commands: [...commandItems('system'), ...items]
		};
		expect(search(s, '').some((r) => r.item.quiet)).toBe(false);
		expect(search(s, 'bill of').map((r) => r.item.label)).toContain('New view: Bill of materials');
	});
});

describe('selectionItems', () => {
	const part = {
		key: 'model.sysml@10',
		label: 'battery',
		file: 'model.sysml'
	} as unknown as ModelElement;
	const isLibrary = (file: string) => file.startsWith('libraries/');

	it('offers to duplicate the selected element, found by "copy" too', () => {
		const items = selectionItems(part, isLibrary);
		expect(items.map((i) => [i.label, i.action])).toEqual([
			['Duplicate battery', { type: 'duplicate', key: 'model.sysml@10' }]
		]);
		const sources_ = { ...sources([]), commands: [...items, ...commandItems('system')] };
		expect(labels(sources_, 'copy')[0]).toBe('Duplicate battery');
		expect(labels(sources_, 'dup')[0]).toBe('Duplicate battery');
	});

	it('offers nothing without a selection, or for a library element', () => {
		expect(selectionItems(undefined, isLibrary)).toEqual([]);
		expect(selectionItems({ ...part, file: 'libraries/Units.sysml' }, isLibrary)).toEqual([]);
	});
});
