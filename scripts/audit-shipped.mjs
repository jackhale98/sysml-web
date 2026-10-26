#!/usr/bin/env node
/**
 * `npm audit`, failing only on advisories in code the site ships: the
 * packages the app's bundle is built from and everything they depend on.
 * Tools that only build, test or measure it (Vite, Playwright, Lighthouse CI)
 * never reach a visitor, so their advisories are reported but don't fail.
 *
 * `npm audit --omit=dev` alone is not enough: SvelteKit's convention keeps
 * `svelte`, `@sveltejs/kit` and the icon and font packages in
 * devDependencies although their code is in the bundle.
 *
 *   node scripts/audit-shipped.mjs [--audit-level=high]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** devDependencies whose code ends up in the built site. */
const SHIPPED_DEV = [
	'svelte',
	'@sveltejs/kit',
	'@lucide/svelte',
	'@fontsource-variable/inter',
	'@fontsource-variable/jetbrains-mono',
	'@fontsource-variable/source-serif-4'
];
const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const level = (process.argv.find((a) => a.startsWith('--audit-level=')) ?? '=high').split('=')[1];
if (!LEVELS.includes(level)) throw new Error(`unknown audit level ${level}`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages;

/** Where `name` resolves from the package at `from` (a lock path), as Node would look it up. */
function resolve(from, name) {
	for (let dir = from; ;) {
		const at = `${dir ? `${dir}/` : ''}node_modules/${name}`;
		if (lock[at]) return at;
		if (!dir) return null;
		const up = dir.lastIndexOf('/node_modules/');
		dir = up < 0 ? '' : dir.slice(0, up);
	}
}

const shipped = new Set();
const todo = [...Object.keys(pkg.dependencies ?? {}), ...SHIPPED_DEV].map((n) => resolve('', n));
while (todo.length) {
	const at = todo.pop();
	if (!at || shipped.has(at)) continue;
	shipped.add(at);
	const entry = lock[at];
	for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }))
		todo.push(resolve(at, name));
}

let report;
try {
	report = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
} catch (error) {
	// npm audit exits non-zero when it finds anything; the report is still on stdout.
	report = error.stdout;
	if (!report) throw error;
}
const vulnerabilities = Object.values(JSON.parse(report).vulnerabilities ?? {});
const atLeast = (severity) => LEVELS.indexOf(severity) >= LEVELS.indexOf(level);
const failing = vulnerabilities.filter(
	(v) => atLeast(v.severity) && v.nodes.some((n) => shipped.has(n))
);
const others = vulnerabilities.filter((v) => !failing.includes(v));

console.log(`Shipped packages audited: ${shipped.size}.`);
if (others.length)
	console.log(
		`Not shipped or below ${level}, not failing: ${others.map((v) => `${v.name} (${v.severity})`).join(', ')}.`
	);
if (failing.length) {
	for (const v of failing) {
		const via = v.via.map((x) => (typeof x === 'string' ? x : `${x.title} ${x.url}`)).join('; ');
		console.error(`${v.severity}: ${v.name} ${v.range} — ${via}`);
	}
	console.error(`${failing.length} ${level}-or-worse advisories in shipped code.`);
	process.exit(1);
}
console.log(`No ${level}-or-worse advisories in shipped code.`);
