// Compute the standard-library units a project needs: the units declaring the
// packages it names, plus the semantic libraries every model depends on
// implicitly (Kernel Semantic Library + Systems Library), closed transitively
// over `Name::` references and imports. Prints the unit names as JSON.
// usage: node scripts/spike/lib-subset.mjs <bundle.json.gz> <projectDir> [--no-implicit]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [bundlePath, projectDir] = process.argv.slice(2);
const implicit = !process.argv.includes('--no-implicit');
const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(bundlePath)).toString('utf8'));

const declares = new Map(); // package name -> unit name
for (const u of bundle) {
	for (const m of u.text.matchAll(
		/^\s*(?:standard\s+)?(?:library\s+)?package\s+('[^']+'|[A-Za-z_]\w*)/gm
	))
		declares.set(m[1].replace(/'/g, ''), u.name);
}
const refs = (text) => {
	const out = new Set();
	for (const m of text.matchAll(/(?:'([^']+)'|\b([A-Za-z_]\w*))\s*::/g)) out.add(m[1] ?? m[2]);
	for (const m of text.matchAll(/\bimport\s+(?:all\s+)?(?:'([^']+)'|([A-Za-z_]\w*))/g))
		out.add(m[1] ?? m[2]);
	return out;
};
const walk = (d, acc = []) => {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) walk(p, acc);
		else if (/\.(sysml|kerml)$/.test(e.name)) acc.push(fs.readFileSync(p, 'utf8'));
	}
	return acc;
};
const need = new Set();
const queue = [];
const add = (unit) => {
	if (unit && !need.has(unit)) {
		need.add(unit);
		queue.push(unit);
	}
};
for (const text of walk(projectDir)) for (const n of refs(text)) add(declares.get(n));
if (implicit)
	for (const u of bundle)
		if (/^(Kernel Libraries\/Kernel Semantic Library|Systems Library)\//.test(u.name)) add(u.name);
const byName = new Map(bundle.map((u) => [u.name, u]));
while (queue.length) for (const n of refs(byName.get(queue.pop()).text)) add(declares.get(n));
// Keep the bundle's order (it is the load order).
const units = bundle.filter((u) => need.has(u.name)).map((u) => u.name);
const bytes = bundle.filter((u) => need.has(u.name)).reduce((s, u) => s + u.text.length, 0);
const total = bundle.reduce((s, u) => s + u.text.length, 0);
console.error(`${units.length}/${bundle.length} units, ${bytes}/${total} chars`);
console.log(JSON.stringify(units));
