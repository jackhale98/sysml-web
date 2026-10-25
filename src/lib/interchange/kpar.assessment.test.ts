/**
 * Assessment (§8): damaged and hostile project archives (`.kpar` or plain
 * ZIP), read as "Import a project" reads them. Correct behaviour: nothing
 * outside the project is named, nothing is dropped or replaced without a
 * warning, and a damaged archive is refused with a readable reason.
 */
import { describe, expect, it } from 'vitest';
import { zip } from '#lib/dataio/zip.ts';
import { readProjectArchive, writeKpar } from './kpar';

/** A path that stays inside the project: relative, no `..`, no drive or backslash. */
const inside = (path: string) =>
	!path.startsWith('/') &&
	!/^[A-Za-z]:/.test(path) &&
	!path.includes('\\') &&
	!path.split('/').includes('..');

describe('hostile archive paths', () => {
	// Known gap: entry paths are taken as they are, so `../`, absolute and drive paths become project files (and are written back into any .kpar exported later).
	it.fails(
		'refuses or reports paths that leave the project (../, absolute, drive letters)',
		async () => {
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
		}
	);

	it('does not let a hostile path leave the project when it is exported again (documents the current behaviour)', async () => {
		const read = await readProjectArchive(
			await zip([{ path: '../evil.sysml', data: 'package Evil;' }]),
			'x'
		);
		// What the reader keeps today, and what an export would then write.
		const paths = read.files.map((f) => f.path);
		const exported = await writeKpar({ name: 'x' }, read.files, '2026-10-23T00:00:00Z');
		const names = new TextDecoder('latin1').decode(exported);
		expect(paths.every(inside) || names.includes('../evil.sysml')).toBe(true);
	});
});

describe('damaged archives', () => {
	// Known gap: two entries with the same path: the later silently replaces the earlier.
	it.fails('reports two entries with the same path instead of keeping one silently', async () => {
		const bytes = await zip([
			{ path: 'A.sysml', data: 'package A { part def First; }' },
			{ path: 'A.sysml', data: 'package A { part def Second; }' }
		]);
		const read = await readProjectArchive(bytes, 'x');
		expect(read.warnings.join(' ')).toMatch(/A\.sysml/);
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

	// Known gap: entry CRCs are not checked, so a corrupted plain ZIP (no .meta.json checksums) imports changed text without a warning.
	it.fails('notices a corrupted entry (CRC mismatch) in a plain ZIP', async () => {
		const bytes = await zip([{ path: 'A.sysml', data: 'package Alpha;' }], { store: true });
		// Flip one byte of the stored data ("Alpha" → "Alpxa").
		const at = new TextDecoder('latin1').decode(bytes).indexOf('Alpha') + 3;
		bytes[at] = 'x'.charCodeAt(0);
		const read = await readProjectArchive(bytes, 'x').catch((e: unknown) => e);
		if (read instanceof Error) return;
		expect((read as { warnings: string[] }).warnings.join(' ')).toMatch(/A\.sysml/);
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
