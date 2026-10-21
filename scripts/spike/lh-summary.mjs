// SPIKE: summarise Lighthouse results (lhci collect writes .lighthouseci/lhr-*.json).
// usage: node scripts/spike/lh-summary.mjs [.lighthouseci]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? '.lighthouseci';
const byUrl = new Map();
for (const f of fs.readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f))) {
	const lhr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
	const url = lhr.requestedUrl.replace(/^https?:\/\/[^/]+/, '');
	const a = (id) => lhr.audits[id]?.numericValue;
	if (!byUrl.has(url)) byUrl.set(url, []);
	byUrl.get(url).push({
		score: Math.round(lhr.categories.performance.score * 100),
		fcp: a('first-contentful-paint'),
		lcp: a('largest-contentful-paint'),
		tbt: a('total-blocking-time'),
		si: a('speed-index'),
		cls: a('cumulative-layout-shift'),
		bytes: a('total-byte-weight'),
		formFactor: lhr.configSettings.formFactor,
		throttling: lhr.configSettings.throttlingMethod
	});
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cell = (xs, f) => `${f(med(xs))} [${f(Math.min(...xs))}–${f(Math.max(...xs))}]`;
const ms = (x) => Math.round(x).toLocaleString('en-US');
console.log('| URL | runs | form factor / throttling | performance score | FCP ms | LCP ms | TBT ms | Speed Index ms | CLS | total byte weight KB |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const [url, runs] of byUrl)
	console.log(
		`| \`${url}\` | ${runs.length} | ${runs[0].formFactor} / ${runs[0].throttling} | ${cell(runs.map((r) => r.score), String)} | ${cell(runs.map((r) => r.fcp), ms)} | ${cell(runs.map((r) => r.lcp), ms)} | ${cell(runs.map((r) => r.tbt), ms)} | ${cell(runs.map((r) => r.si), ms)} | ${cell(runs.map((r) => r.cls), (x) => x.toFixed(3))} | ${cell(runs.map((r) => r.bytes / 1024), ms)} |`
	);
