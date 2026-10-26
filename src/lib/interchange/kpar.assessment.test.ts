/**
 * Assessment (§8): damaged and hostile project archives (`.kpar` or plain
 * ZIP), read as "Import a project" reads them. Correct behaviour: nothing
 * outside the project is named, nothing is dropped or replaced without a
 * warning, and a damaged archive is refused with a readable reason.
 */
import { describe, expect, it } from 'vitest';
import { unzip, zip } from '#lib/dataio/zip.ts';
import { MAX_UNPACKED, readProjectArchive, writeKpar } from './kpar';

/** A path that stays inside the project: relative, no `..`, no drive or backslash. */
const inside = (path: string) =>
	!path.startsWith('/') &&
	!/^[A-Za-z]:/.test(path) &&
	!path.includes('\\') &&
	!path.split('/').includes('..');

describe('hostile archive paths', () => {
	it('refuses or reports paths that leave the project (../, absolute, drive letters)', async () => {
		const bytes = await zip([
			{ path: 'A.sysml', data: 'package A;' },
			{ path: '../evil.sysml', data: 'package Evil;' },
			{ path: 'model/../../up.sysml', data: 'package Up;' },
			{ path: '/etc/abs.sysml', data: 'package Abs;' },
			{ path: 'C:\\temp\\win.sysml', data: 'package Win;' }
		]);
		const read = await readProjectArchive(bytes, 'x').catch((e: unknown) => e);
		if (read instanceof Error) return; // Refused outright: fine.
		const { files, warnings } = read as Awaited<ReturnType<typeof readProjectArchive>>;
		expect(files.map((f) => f.path).filter((p) => !inside(p))).toEqual([]);
		expect(warnings.join(' ')).toMatch(/evil\.sysml/);
	});

	it('does not let a hostile path leave the project when it is exported again', async () => {
		const read = await readProjectArchive(
			await zip([
				{ path: 'A.sysml', data: 'package A;' },
				{ path: '../evil.sysml', data: 'package Evil;' },
				{ path: 'model\\B.sysml', data: 'package B;' }
			]),
			'x'
		);
		// A Windows-style relative path is kept, with forward slashes; the one leaving is not.
		expect(read.files.map((f) => f.path)).toEqual(['A.sysml', 'model/B.sysml']);
		expect(read.warnings).toEqual([
			'Left out a file whose path leads outside the project: ../evil.sysml.'
		]);
		const exported = await writeKpar({ name: 'x' }, read.files, '2026-10-23T00:00:00Z');
		expect(new TextDecoder('latin1').decode(exported)).not.toContain('evil');
	});
});

describe('damaged archives', () => {
	it('reports two entries with the same path instead of keeping one silently', async () => {
		const bytes = await zip([
			{ path: 'A.sysml', data: 'package A { part def First; }' },
			{ path: 'A.sysml', data: 'package A { part def Second; }' }
		]);
		const read = await readProjectArchive(bytes, 'x');
		expect(read.warnings.join(' ')).toMatch(/A\.sysml/);
		expect(read.warnings).toEqual([
			'The archive holds A.sysml more than once: the last copy was kept, the others left out.'
		]);
		expect(read.files).toEqual([{ path: 'A.sysml', text: 'package A { part def Second; }' }]);
	});

	it('lists a model file that is not UTF-8 as skipped (the reader reports it)', async () => {
		const latin1 = new Uint8Array([
			...new TextEncoder().encode('package Gr'),
			0xf6,
			0xdf,
			0x65,
			0x3b
		]);
		const read = await readProjectArchive(
			await zip([
				{ path: 'A.sysml', data: 'package A;' },
				{ path: 'Größe.sysml', data: latin1 }
			]),
			'x'
		);
		expect(read.files.map((f) => f.path)).toEqual(['A.sysml']);
		expect(read.skipped).toEqual(['Größe.sysml']);
	});

	it('notices a corrupted entry (CRC mismatch) in a plain ZIP', async () => {
		const bytes = await zip([{ path: 'A.sysml', data: 'package Alpha;' }], { store: true });
		// Flip one byte of the stored data ("Alpha" → "Alpxa").
		const at = new TextDecoder('latin1').decode(bytes).indexOf('Alpha') + 3;
		bytes[at] = 'x'.charCodeAt(0);
		const read = await readProjectArchive(bytes, 'x').catch((e: unknown) => e);
		if (read instanceof Error) return;
		expect((read as { warnings: string[] }).warnings.join(' ')).toMatch(/A\.sysml/);
	});

	it('leaves an intact archive without warnings (the CRC check passes good entries)', async () => {
		const bytes = await zip([{ path: 'A.sysml', data: 'package Alpha;\n'.repeat(40) }]);
		const read = await readProjectArchive(bytes, 'x');
		expect(read.warnings).toEqual([]);
		expect(read.files).toHaveLength(1);
	});

	it('detects a corrupted entry in a .kpar through its recorded checksum', async () => {
		const bytes = await writeKpar({ name: 'x' }, [{ path: 'A.sysml', text: 'package Alpha;' }], '');
		const at = new TextDecoder('latin1').decode(bytes).lastIndexOf('Alpha') + 3;
		bytes[at] = 'x'.charCodeAt(0);
		const read = await readProjectArchive(bytes, 'x');
		expect(read.warnings).toEqual([
			'A.sysml has changed since the archive was made (its checksum does not match).'
		]);
	});

	it('reports a file the .kpar lists but does not hold', async () => {
		const full = await writeKpar(
			{ name: 'x' },
			[
				{ path: 'A.sysml', text: 'package A;' },
				{ path: 'B.sysml', text: 'package B;' }
			],
			''
		);
		const { unzip } = await import('#lib/dataio/zip.ts');
		const entries = (await unzip(full)).filter((e) => e.path !== 'B.sysml');
		const read = await readProjectArchive(await zip(entries, { store: true }), 'x');
		expect(read.files.map((f) => f.path)).toEqual(['A.sysml']);
		expect(read.warnings).toEqual(['B.sysml is listed in .meta.json but is not in the archive.']);
	});

	it('refuses an archive cut short (an interrupted download) with a readable reason', async () => {
		const bytes = await writeKpar(
			{ name: 'x' },
			[{ path: 'A.sysml', text: 'package A;\n'.repeat(200) }],
			''
		);
		for (const cut of [0.3, 0.6, 0.95]) {
			const error = await readProjectArchive(
				bytes.slice(0, Math.floor(bytes.length * cut)),
				'x'
			).then(
				() => null,
				(e: unknown) => e
			);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/not a ZIP file|damaged/);
		}
	});

	it('refuses an entry whose compressed data is not valid', async () => {
		const bytes = await zip([{ path: 'A.sysml', data: 'package A;\n'.repeat(50) }]);
		// Overwrite the deflated body (after the 30-byte local header and the name) with noise.
		for (let i = 30 + 'A.sysml'.length; i < 30 + 'A.sysml'.length + 12; i++) bytes[i] = 0xff;
		await expect(readProjectArchive(bytes, 'x')).rejects.toBeInstanceOf(Error);
	});
});

describe('archives too big to open (ZIP bombs)', () => {
	it('refuses an archive that says it unpacks to more than the limit, in plain words', async () => {
		const bytes = await zip([{ path: 'A.sysml', data: 'package A;' }], { store: true });
		// The central directory's "uncompressed size" of the one entry: 46-byte header, offset 24.
		const view = new DataView(bytes.buffer);
		const central = new TextDecoder('latin1').decode(bytes).lastIndexOf('PK\x01\x02');
		view.setUint32(central + 24, MAX_UNPACKED + 1, true);
		await expect(readProjectArchive(bytes, 'x')).rejects.toThrow(
			/unpacks to more than 256 MB, more than this app opens\. It was not opened\./
		);
	});

	it('stops inflating an entry that unpacks to more than it said', async () => {
		const zeros = new Uint8Array(4_000_000);
		const bytes = await zip([{ path: 'A.sysml', data: zeros }]);
		expect(bytes.length).toBeLessThan(40_000);
		// The entry lies about its size: it says 10 bytes.
		const view = new DataView(bytes.buffer);
		const central = new TextDecoder('latin1').decode(bytes).lastIndexOf('PK\x01\x02');
		view.setUint32(central + 24, 10, true);
		await expect(unzip(bytes, '', { maxTotal: 1_000_000 })).rejects.toThrow(
			/unpacks to more than 1 MB/
		);
		// Within the limit it reads (and the archive's own size field is not trusted for the data).
		expect((await unzip(bytes, '', { maxTotal: 5_000_000 }))[0]!.data.length).toBe(4_000_000);
	});
});
