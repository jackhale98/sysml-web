// Toolkit library-loading options in Node, one option per process (so wasm
// memory is that option's high-water mark).
// usage: node scripts/spike/lib-options.mjs <option> [wasm: opt|plain|<path>]
//   options: libcache | none | prepared | prepared-stream | subset | subset-min
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PKG = path.join(ROOT, 'static/toolkit');
const DEMO = path.join(ROOT, 'src/demo/drone');
const option = process.argv[2] ?? 'libcache';
const wasmArg = process.argv[3] ?? 'opt';
const wasmPath =
	wasmArg === 'opt'
		? `${PKG}/sysmlv2_bg.opt.wasm`
		: wasmArg === 'plain'
			? `${PKG}/sysmlv2_bg.wasm`
			: wasmArg;

const files = [];
(function walk(d) {
	for (const e of fs
		.readdirSync(d, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) walk(p);
		else if (/\.(sysml|kerml)$/.test(e.name))
			files.push({ name: path.relative(DEMO, p), text: fs.readFileSync(p, 'utf8') });
	}
})(DEMO);

const tk = await import(`${PKG}/sysmlv2.js`);
let t = performance.now();
const out = tk.initSync({ module: new WebAssembly.Module(fs.readFileSync(wasmPath)) });
const mem = () => Math.round(out.memory.buffer.byteLength / 1048576);
const r = {
	option,
	wasm: path.basename(wasmPath),
	instantiateMs: Math.round(performance.now() - t),
	memInit: mem()
};
const gun = (f) => zlib.gunzipSync(fs.readFileSync(`${PKG}/stdlib/${f}`));
let bundleText = gun('sysml-library.json.gz').toString('utf8');
if (option.startsWith('subset')) {
	const keep = JSON.parse(
		execFileSync(
			'node',
			[
				path.join(ROOT, 'scripts/spike/lib-subset.mjs'),
				`${PKG}/stdlib/sysml-library.json.gz`,
				DEMO
			],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		)
	);
	let units = JSON.parse(bundleText).filter((u) => keep.includes(u.name));
	if (option === 'subset-min') {
		// Also drop ISQ domain packages the demo does not use, and the
		// re-exports of them in ISQ.sysml (needs an edited ISQ unit: what a
		// member-level library subset upstream would do).
		const drop =
			/ISQ(Acoustics|AtomicNuclear|CharacteristicNumbers|ChemistryMolecular|CondensedMatter|Information|Light)\.sysml$/;
		units = units
			.filter((u) => !drop.test(u.name))
			.map((u) =>
				u.name.endsWith('/ISQ.sysml')
					? {
							...u,
							text: u.text.replace(
								/^\s*public import ISQ(Acoustics|AtomicNuclear|CharacteristicNumbers|ChemistryMolecular|CondensedMatter|Information|Light)::\*;\s*$/gm,
								''
							)
						}
					: u
			);
	}
	r.units = units.length;
	bundleText = JSON.stringify(units);
}
r.bundleChars = bundleText.length;
t = performance.now();
let lib;
if (option === 'libcache')
	lib = new tk.PreparedLibrary(bundleText, new Uint8Array(gun('sysml-library.libcache.gz')));
else if (option === 'prepared')
	lib = tk.PreparedLibrary.fromSnapshot(
		new Uint8Array(gun('sysml-library.prepared.gz')),
		bundleText,
		new Uint8Array(gun('sysml-library.libcache.gz'))
	);
else if (option === 'prepared-stream')
	lib = tk.PreparedLibrary.fromSnapshotStream(
		new Uint8Array(gun('sysml-library.prepared.gz')),
		bundleText,
		new Uint8Array(gun('sysml-library.libcache.gz'))
	);
else lib = new tk.PreparedLibrary(bundleText); // none, subset, subset-min: resolve from source
r.libraryLoadMs = Math.round(performance.now() - t);
r.memAfterLibrary = mem();
const src = JSON.stringify(files);
t = performance.now();
let s = tk.Session.fromSourcesWithPreparedLibrary(src, lib);
const findings = JSON.parse(s.check());
r.firstAnalysisMs = Math.round(performance.now() - t);
r.findings = findings.length;
r.unresolved = s.unresolvedCount();
r.memAfterAnalysis = mem();
let settled = s.settledOutcomes();
const times = [];
for (let i = 0; i < 10; i++) {
	const edited = files.map((f) =>
		f.name.endsWith('Components.sysml')
			? { ...f, text: f.text.replace('mass = 1100 [g]', `mass = ${1100 + i} [g]`) }
			: f
	);
	t = performance.now();
	s.free();
	s = settled
		? tk.Session.fromSourcesSettled(JSON.stringify(edited), lib, settled)
		: tk.Session.fromSourcesWithPreparedLibrary(JSON.stringify(edited), lib);
	JSON.parse(s.check());
	const ns = s.settledOutcomes();
	settled?.free();
	settled = ns;
	times.push(Math.round(performance.now() - t));
}
r.reanalysisMs = times.sort((a, b) => a - b)[5];
r.memAfter10Edits = mem();
r.rssMB = Math.round(process.memoryUsage().rss / 1048576);
console.log(JSON.stringify(r));
