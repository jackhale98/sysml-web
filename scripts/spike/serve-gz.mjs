// SPIKE: serve build/ the way GitHub Pages does, for measurements: gzip
// (level 6, Node's default) for compressible types including application/wasm,
// `.gz` files as they are (application/gzip, no Content-Encoding), clean URLs
// (`/p/demo` → `p/demo.html`), `404.html` with status 404 for anything else,
// `Cache-Control: max-age=600` and ETags.
// usage: node scripts/spike/serve-gz.mjs [port=4575] [dir=build]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const port = Number(process.argv[2] ?? 4575);
const root = path.resolve(process.argv[3] ?? 'build');
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.gz': 'application/gzip',
	'.ts': 'text/plain; charset=utf-8'
};
const compressible = /^(text\/|application\/(javascript|json|wasm|manifest\+json)|image\/svg)/;
const cache = new Map();
/** Bytes sent per path since the last `GET /__stats?reset` (for the measurement harness). */
let sent = {};

function load(file) {
	const mtime = fs.statSync(file).mtimeMs;
	let entry = cache.get(file);
	if (!entry || entry.mtime !== mtime) {
		const body = fs.readFileSync(file);
		const type = types[path.extname(file)] ?? 'application/octet-stream';
		const gz = compressible.test(type) ? zlib.gzipSync(body, { level: 6 }) : null;
		const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
		entry = { body, gz, type, etag, mtime };
		cache.set(file, entry);
	}
	return entry;
}

function resolveFile(pathname) {
	const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
	const candidates = [clean, clean + '.html', path.join(clean, 'index.html')];
	for (const c of candidates) {
		const full = path.join(root, c);
		if (full.startsWith(root) && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
	}
	return null;
}

http
	.createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		if (url.pathname === '/__stats') {
			const body = JSON.stringify(sent);
			if (url.searchParams.has('reset')) sent = {};
			res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			return res.end(body);
		}
		let file = resolveFile(url.pathname);
		let status = 200;
		if (!file) {
			file = path.join(root, '404.html');
			status = 404;
		}
		const entry = load(file);
		if (status === 200 && req.headers['if-none-match'] === entry.etag) {
			res.writeHead(304, { ETag: entry.etag, 'Cache-Control': 'max-age=600' });
			return res.end();
		}
		const gzip = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
		const body = gzip ? entry.gz : entry.body;
		res.writeHead(status, {
			'Content-Type': entry.type,
			'Content-Length': body.length,
			'Cache-Control': 'max-age=600',
			ETag: entry.etag,
			Vary: 'Accept-Encoding',
			...(gzip ? { 'Content-Encoding': 'gzip' } : {})
		});
		const key = url.pathname + url.search;
		sent[key] = sent[key] ?? { requests: 0, bytes: 0, gzip: !!gzip };
		sent[key].requests++;
		sent[key].bytes += req.method === 'HEAD' ? 0 : body.length;
		res.end(req.method === 'HEAD' ? undefined : body);
	})
	.listen(port, () => console.log(`serving ${root} on http://localhost:${port} (GitHub-Pages-like gzip)`));
