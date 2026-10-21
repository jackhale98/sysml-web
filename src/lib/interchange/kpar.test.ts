/**
 * `.kpar` reading and writing, with the fixtures of `sysml-interchange`
 * (our Rust engine's crate) ported, plus round trips with that engine in
 * WebAssembly: what it writes reads here, and what this writes reads there.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { unzip, zip } from '#lib/dataio/zip.ts';
import {
	computeChecksums,
	readKpar,
	readProjectArchive,
	verifyChecksums,
	writeKpar,
	writeKparArchive,
	type Kpar,
	type ProjectMeta
} from './kpar';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function sample(): Promise<Kpar> {
	const kpar: Kpar = {
		info: {
			name: 'Drone',
			description: 'Example',
			version: '0.1.0',
			usage: [
				{
					resource: 'https://www.omg.org/spec/SysML/20250201/Systems-Library.kpar',
					versionConstraint: '2.0.0'
				}
			]
		},
		meta: {
			index: { Drone: 'Drone.sysml' },
			created: '2026-10-21T00:00:00Z',
			metamodel: 'https://www.omg.org/spec/SysML/20250201'
		},
		files: new Map([['Drone.sysml', encode('package Drone;\n')]])
	};
	await computeChecksums(kpar);
	return kpar;
}

describe('kpar', () => {
	it('round-trips and is deterministic', async () => {
		const kpar = await sample();
		const bytes = await writeKparArchive(kpar);
		expect(await writeKparArchive(kpar)).toEqual(bytes);
		const back = await readKpar(bytes);
		expect(back.info).toEqual(kpar.info);
		expect(back.meta).toEqual(kpar.meta);
		expect([...back.files]).toEqual([...kpar.files]);
		expect(await verifyChecksums(back)).toEqual([]);
	});

	it('stores entries uncompressed, metadata first, then files in path order', async () => {
		const bytes = await writeKpar(
			{ name: 'P' },
			[
				{ path: 'b/Z.sysml', text: 'package Z;' },
				{ path: 'a.sysml', text: 'package A;' }
			],
			'2026-10-21T00:00:00Z'
		);
		expect((await unzip(bytes)).map((e) => e.path)).toEqual([
			'.project.json',
			'.meta.json',
			'a.sysml',
			'b/Z.sysml'
		]);
		// Method 0 (stored) in the first local header.
		expect(new DataView(bytes.buffer, bytes.byteOffset).getUint16(8, true)).toBe(0);
	});

	it('writes the SHA256 of each file, as OMG does', async () => {
		const kpar = await sample();
		expect(kpar.meta.checksum).toEqual({
			'Drone.sysml': {
				value: createHash('sha256').update('package Drone;\n').digest('hex'),
				algorithm: 'SHA256'
			}
		});
	});

	it('detects tampering', async () => {
		const kpar = await sample();
		kpar.files.set('Drone.sysml', encode('package Other;\n'));
		expect(await verifyChecksums(kpar)).toEqual([{ type: 'mismatch', path: 'Drone.sysml' }]);
		kpar.files.delete('Drone.sysml');
		expect(await verifyChecksums(kpar)).toEqual([{ type: 'missing', path: 'Drone.sysml' }]);
	});

	it('reads list-form checksums and keeps unknown fields', async () => {
		const meta: ProjectMeta = {
			index: {},
			created: 'x',
			checksum: { 'a.sysml': [{ value: '00', algorithm: 'SHA1' }] },
			vendor: 1
		};
		const bytes = await zip([
			{ path: '.project.json', data: JSON.stringify({ name: 'A', extra: { kept: true } }) },
			{ path: '.meta.json', data: JSON.stringify(meta) },
			{ path: 'a.sysml', data: 'package A;' }
		]);
		const kpar = await readKpar(bytes);
		expect(kpar.meta.vendor).toBe(1);
		expect(kpar.info.extra).toEqual({ kept: true });
		expect(await verifyChecksums(kpar)).toEqual([
			{ type: 'unsupported', path: 'a.sysml', algorithm: 'SHA1' }
		]);
		// Unknown fields survive a write, after the known ones.
		const again = await readKpar(await writeKparArchive(kpar));
		expect(again.meta.vendor).toBe(1);
		expect(Object.keys(again.info)).toEqual(['name', 'extra']);
	});

	it('refuses an archive without its metadata', async () => {
		const bytes = await zip([{ path: 'a.sysml', data: 'package A;' }]);
		await expect(readKpar(bytes)).rejects.toThrow(/no top-level \.project\.json/);
		await expect(readKpar(encode('not a zip'))).rejects.toThrow(/not a ZIP/);
	});

	it('indexes each file’s top-level names, first file first', async () => {
		const bytes = await writeKpar(
			{ name: 'Demo' },
			[
				{ path: 'model/A.sysml', text: 'package A { part def B; }' },
				{ path: 'model/C.sysml', text: 'package <c> C; package A;' },
				{ path: 'README.md', text: '# Demo' }
			],
			'2026-10-21T00:00:00Z'
		);
		const read = await readProjectArchive(bytes, 'fallback');
		expect(read.info.name).toBe('Demo');
		expect(read.files.map((f) => f.path)).toEqual(['README.md', 'model/A.sysml', 'model/C.sysml']);
		expect(read.warnings).toEqual([]);
		const kpar = await readKpar(bytes);
		expect(kpar.meta.index).toEqual({ A: 'model/A.sysml', C: 'model/C.sysml', c: 'model/C.sysml' });
		expect(Object.keys(kpar.meta.checksum!)).toEqual([
			'README.md',
			'model/A.sysml',
			'model/C.sysml'
		]);
	});

	it('reads a plain ZIP with a top folder, leaving binaries out', async () => {
		const bytes = await zip([
			{ path: 'drone-main/model/A.sysml', data: 'package A;' },
			{ path: 'drone-main/logo.png', data: new Uint8Array([0xff, 0xfe, 0x00]) }
		]);
		const read = await readProjectArchive(bytes, 'fallback');
		expect(read.info.name).toBe('drone-main');
		expect(read.files).toEqual([{ path: 'model/A.sysml', text: 'package A;' }]);
		expect(read.skipped).toEqual(['logo.png']);
		expect(read.warnings).toEqual([]);
	});

	it('names a project without a folder or .project.json after the file', async () => {
		const bytes = await zip([
			{ path: 'A.sysml', data: 'package A;' },
			{ path: 'docs/B.md', data: '# B' }
		]);
		const read = await readProjectArchive(bytes, 'my-model');
		expect(read.info).toEqual({ name: 'my-model' });
		expect(read.files.map((f) => f.path)).toEqual(['A.sysml', 'docs/B.md']);
	});

	it('warns about changed files and unreadable metadata instead of failing', async () => {
		const kpar = await sample();
		kpar.files.set('Drone.sysml', encode('package Changed;\n'));
		const changed = await readProjectArchive(await writeKparArchive(kpar), 'x');
		expect(changed.warnings).toEqual([
			'Drone.sysml has changed since the archive was made (its checksum does not match).'
		]);
		const broken = await readProjectArchive(
			await zip([
				{ path: '.project.json', data: '{ name: ' },
				{ path: 'A.sysml', data: 'package A;' }
			]),
			'broken'
		);
		expect(broken.info.name).toBe('broken');
		expect(broken.warnings[0]).toMatch(/\.project\.json is not valid JSON/);
	});
});

// --- Round trips with the classic engine (WebAssembly in Node) ----------------

const ENGINE = join(import.meta.dirname, '../../../static/engine');
const DEMO = join(import.meta.dirname, '../../demo/drone');
const CREATED = '2026-10-21T12:00:00Z';

interface Wasm {
	initSync(options: { module: Buffer }): void;
	readKpar(bytes: Uint8Array): string;
	readProjectArchive(bytes: Uint8Array, fallbackName: string): string;
	writeKpar(info: string, files: string, created: string): Uint8Array;
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
	);
}

describe.skipIf(!existsSync(join(ENGINE, 'sysml_wasm.js')))('kpar and the classic engine', () => {
	let wasm: Wasm;
	let info: Record<string, unknown>;
	let files: { path: string; text: string }[];

	beforeAll(async () => {
		wasm = (await import(join(ENGINE, 'sysml_wasm.js'))) as Wasm;
		wasm.initSync({ module: readFileSync(join(ENGINE, 'sysml_wasm_bg.wasm')) });
		info = JSON.parse(readFileSync(join(DEMO, '.project.json'), 'utf8')) as Record<string, unknown>;
		files = walk(DEMO)
			.filter((p) => !p.endsWith('.project.json'))
			.map((p) => ({ path: relative(DEMO, p), text: readFileSync(p, 'utf8') }))
			.sort((a, b) => (a.path < b.path ? -1 : 1));
	});

	it('reads what the engine writes', async () => {
		const bytes = wasm.writeKpar(JSON.stringify(info), JSON.stringify(files), CREATED);
		const read = await readProjectArchive(bytes, 'fallback');
		expect(read.info).toEqual(info);
		expect(read.files).toEqual(files);
		expect(read.skipped).toEqual([]);
		expect(read.warnings).toEqual([]);

		const kpar = await readKpar(bytes);
		expect(kpar.meta.created).toBe(CREATED);
		expect(await verifyChecksums(kpar)).toEqual([]);
		// The engine indexes top-level definitions; ours agrees on every one.
		const ours = await readKpar(await writeKpar(info, files, CREATED));
		for (const [name, path] of Object.entries(kpar.meta.index)) {
			expect(ours.meta.index[name], name).toBe(path);
		}
		expect(ours.meta.checksum).toEqual(kpar.meta.checksum);
	});

	it('writes what the engine reads', async () => {
		const bytes = await writeKpar(info, files, CREATED);
		const read = JSON.parse(wasm.readProjectArchive(bytes, 'fallback')) as {
			info: unknown;
			files: unknown;
			skipped: unknown;
			warnings: unknown;
		};
		expect(read.info).toEqual(info);
		expect(read.files).toEqual(files);
		expect(read.skipped).toEqual([]);
		expect(read.warnings).toEqual([]);

		const strict = JSON.parse(wasm.readKpar(bytes)) as {
			meta: ProjectMeta;
			files: string[];
			checksumProblems: string[];
		};
		expect(strict.checksumProblems).toEqual([]);
		expect(strict.files).toEqual(files.map((f) => f.path));
		expect(strict.meta.created).toBe(CREATED);
		expect(strict.meta.index.DroneArchitecture).toMatch(/\.sysml$/);
	});

	it('reads a repository ZIP the way the engine does', async () => {
		const bytes = await zip([
			{ path: 'drone-main/.project.json', data: JSON.stringify(info) },
			...files.map((f) => ({ path: `drone-main/${f.path}`, data: f.text })),
			{ path: 'drone-main/assets/logo.png', data: new Uint8Array([0x89, 0x50, 0xff, 0xd8]) }
		]);
		const theirs = JSON.parse(wasm.readProjectArchive(bytes, 'fallback')) as unknown;
		expect(await readProjectArchive(bytes, 'fallback')).toEqual(theirs);
	});

	it('round-trips a project with odd paths and text through both', async () => {
		const odd = [
			{ path: 'Ünïcode/Модель.sysml', text: "package 'Модель' { doc /* ✓ */ }\n" },
			{ path: 'empty.sysml', text: '' }
		];
		const viaEngine = wasm.writeKpar(JSON.stringify({ name: 'Odd' }), JSON.stringify(odd), CREATED);
		const viaUs = await writeKpar({ name: 'Odd' }, odd, CREATED);
		expect((await readProjectArchive(viaEngine, 'x')).files).toEqual(
			[...odd].sort((a, b) => (a.path < b.path ? -1 : 1))
		);
		const back = JSON.parse(wasm.readProjectArchive(viaUs, 'x')) as { files: unknown };
		expect(back.files).toEqual((await readProjectArchive(viaUs, 'x')).files);
		expect(decode((await unzip(viaUs))[0]!.data)).toBe('{"name":"Odd"}');
	});
});

// --- The OMG library archives, when the release is checked out next to us -------

const RELEASE = join(
	import.meta.dirname,
	'../../../../sysml-cli-main/sysml-v2-release/sysml.library.kpar'
);

describe.skipIf(!existsSync(RELEASE))('the OMG library archives', () => {
	it('load, verify their checksums and survive a write/read round trip', async () => {
		const names = readdirSync(RELEASE).filter((n) => n.endsWith('.kpar'));
		expect(names.length).toBe(10);
		for (const name of names) {
			const kpar = await readKpar(new Uint8Array(readFileSync(join(RELEASE, name))));
			expect(await verifyChecksums(kpar), name).toEqual([]);
			for (const file of Object.values(kpar.meta.index)) expect(kpar.files.has(file)).toBe(true);
			const back = await readKpar(await writeKparArchive(kpar));
			expect(back.info, name).toEqual(kpar.info);
			expect(back.meta, name).toEqual(kpar.meta);
			expect([...back.files.keys()]).toEqual([...kpar.files.keys()]);
		}
	});
});
