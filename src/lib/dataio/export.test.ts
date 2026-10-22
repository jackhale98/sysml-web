import { afterEach, describe, expect, it, vi } from 'vitest';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import { fileName, isWide, printHtml, saveFile } from './export';

describe('exporting tables', () => {
	it('names files after the view, without characters file systems refuse', () => {
		expect(fileName('Requirements table', 'csv')).toBe('Requirements table.csv');
		expect(fileName('A/B: "C"?', 'xlsx')).toBe('A B C.xlsx');
		expect(fileName('  ', 'csv')).toBe('table.csv');
	});

	it('prints landscape when the table is wide', () => {
		expect(isWide({ header: ['ID', 'Title'], rows: [['R1', 'Short']] })).toBe(false);
		expect(isWide({ header: ['a', 'b', 'c', 'd', 'e', 'f'], rows: [] })).toBe(true);
		expect(
			isWide({
				header: ['ID', 'Text', 'Rationale', 'Notes'],
				rows: [['R1', 'x'.repeat(60), 'y'.repeat(40), 'z'.repeat(30)]]
			})
		).toBe(true);
	});

	it('writes the printed page with the title, project and date, escaped', () => {
		const html = printHtml(
			{ title: 'Gaps <draft>', project: 'Drone & co', header: ['ID'], rows: [['<b>R1</b>']] },
			'21 October 2026'
		);
		expect(html).toContain('<h1>Gaps &lt;draft&gt;</h1>');
		expect(html).toContain('<p>Drone &amp; co · 21 October 2026 · 1 row</p>');
		expect(html).toContain('<td>&lt;b&gt;R1&lt;/b&gt;</td>');
		expect(html).toContain('<th scope="col">ID</th>');
	});
});

describe('saveFile', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('offers the share sheet from a tap of its own when Safari refuses a late one', async () => {
		const share = vi
			.fn()
			.mockRejectedValueOnce(new DOMException('No gesture', 'NotAllowedError'))
			.mockResolvedValueOnce(undefined);
		vi.stubGlobal('navigator', { canShare: () => true, share, userAgent: 'iPhone' });
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		await saveFile('Drone breakdown.png', 'x', 'image/png', true);
		const toast = toasts.items.at(-1)!;
		expect(toast.message).toBe('Drone breakdown.png is ready.');
		toast.action!.run();
		expect(share).toHaveBeenCalledTimes(2);
		expect(share.mock.calls[1]![0].files[0].name).toBe('Drone breakdown.png');
	});
});
