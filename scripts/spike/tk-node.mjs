// SPIKE: shared Node setup for the API-fit scripts: the toolkit from
// static/toolkit, its library (prepared snapshot, streamed), and the demo.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
export const ROOT = path.resolve(import.meta.dirname, '../..');
const PKG = path.join(ROOT, 'static/toolkit');
export const tk = await import(`${PKG}/sysmlv2.js`);
export const exports_ = tk.initSync({
	module: new WebAssembly.Module(fs.readFileSync(`${PKG}/sysmlv2_bg.opt.wasm`))
});
const gun = (f) => zlib.gunzipSync(fs.readFileSync(`${PKG}/stdlib/${f}`));
export const bundle = gun('sysml-library.json.gz').toString('utf8');
export const library = tk.PreparedLibrary.fromSnapshotStream(
	new Uint8Array(gun('sysml-library.prepared.gz')),
	bundle,
	new Uint8Array(gun('sysml-library.libcache.gz')),
	true
);
export function demoFiles(dir = path.join(ROOT, 'src/demo/drone')) {
	const out = [];
	(function walk(d) {
		for (const e of fs
			.readdirSync(d, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.(sysml|kerml)$/.test(e.name))
				out.push({ name: path.relative(dir, p), text: fs.readFileSync(p, 'utf8') });
		}
	})(dir);
	return out;
}
export const open = (files) =>
	tk.Session.fromSourcesWithPreparedLibrary(JSON.stringify(files), library);
export const time = (fn) => {
	const t = performance.now();
	const v = fn();
	return [v, Math.round((performance.now() - t) * 10) / 10];
};
