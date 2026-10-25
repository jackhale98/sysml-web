#!/usr/bin/env node
/**
 * A plain static file server for the assessment's deployment check
 * (docs/assessment/10-performance-usability.md): serves a `build/` made with
 * `BASE_PATH=<base>` under that base path, falls back to `404.html` for
 * unknown paths (as GitHub Pages and most static hosts do) and can send a
 * strict Content-Security-Policy, as a locked-down intranet host might.
 *
 *   node tests/perf/assessment-static-server.mjs <build dir> <base path> <port> [--csp]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const [dir, base = '', port = '4329'] = process.argv.slice(2);
const csp = process.argv.includes('--csp');
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.gz': 'application/gzip',
	'.txt': 'text/plain',
	'.md': 'text/markdown'
};
/** No third-party origins; WebAssembly compiled in the worker; inline styles and SvelteKit's inline start script. */
const POLICY = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"frame-ancestors 'none'"
].join('; ');

createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	if (!url.pathname.startsWith(base)) {
		res.writeHead(404).end('outside the base path');
		return;
	}
	const rel = normalize(decodeURIComponent(url.pathname.slice(base.length)) || '/');
	let file = join(dir, rel);
	if (!file.startsWith(normalize(dir))) {
		res.writeHead(403).end();
		return;
	}
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
	let status = 200;
	if (!existsSync(file)) {
		file = join(dir, '404.html');
		status = 404;
	}
	const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
	if (csp) headers['content-security-policy'] = POLICY;
	res.writeHead(status, headers);
	createReadStream(file).pipe(res);
}).listen(Number(port), () =>
	console.log(`serving ${dir} at http://localhost:${port}${base}/${csp ? ' with a CSP' : ''}`)
);
