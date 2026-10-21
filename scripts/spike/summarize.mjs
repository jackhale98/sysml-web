// SPIKE: summarise measure.mjs results: median and [min–max] per scenario.
// usage: node scripts/spike/summarize.mjs results.jsonl [more.jsonl…] > summary.md
import fs from 'node:fs';

const rows = process.argv
	.slice(2)
	.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const groups = new Map();
for (const r of rows) {
	if (r.failed) continue;
	const key = `${r.profile} · ${r.cache} · ${r.target}${r.wasm === 'plain' ? ' (plain wasm)' : ''}`;
	if (!groups.has(key)) groups.set(key, []);
	groups.get(key).push(r);
}
const failures = rows.filter((r) => r.failed);

const median = (xs) => {
	const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
	if (!s.length) return null;
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (xs, unit = '', digits = 0) => {
	const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
	if (!s.length) return '–';
	const f = (x) => (digits ? x.toFixed(digits) : Math.round(x).toLocaleString('en-US'));
	const lo = Math.min(...s), hi = Math.max(...s);
	return lo === hi ? `${f(lo)}${unit}` : `${f(median(s))}${unit} [${f(lo)}–${f(hi)}]`;
};
const s = (x) => (x / 1000);
const get = (list, fn) => list.map((r) => { try { return fn(r); } catch { return undefined; } });

const out = [];
const table = (title, cols, fns) => {
	out.push(`\n### ${title}\n`);
	out.push(`| scenario | n | ${cols.join(' | ')} |`);
	out.push(`|---|---|${cols.map(() => '---').join('|')}|`);
	for (const [key, list] of groups) {
		const cells = fns.map((fn) => fn(list));
		if (cells.every((c) => c === '–')) continue;
		out.push(`| ${key} | ${list.length} | ${cells.join(' | ')} |`);
	}
};

table(
	'Page and time to ready (s, from navigation start unless noted)',
	['FCP', 'LCP', 'workbench ready (our engine analysed)', 'measured engine: worker spawn → first analysis done', 'engine ready (from navigation)'],
	[
		(l) => fmt(get(l, (r) => s(r.page.fcp)), ' s', 2),
		(l) => fmt(get(l, (r) => s(r.page.lcp)), ' s', 2),
		(l) => fmt(get(l, (r) => s(r.page.workspaceReady)), ' s', 2),
		(l) => fmt(get(l, (r) => s(r.spike.timeToReadyMs)), ' s', 2),
		(l) => fmt(get(l, (r) => s(r.spike.ready)), ' s', 2)
	]
);
const step = (name) => (l) => fmt(get(l, (r) => r.spike.steps[name]?.ms));
table(
	'Boot steps inside the worker (ms; downloads run in parallel, the wasm compiles while it streams)',
	['glue import', 'wasm download + compile', 'bundle download', 'libcache download', 'prepared download', 'instantiate', 'decompress', 'library load', 'first analysis', '…of which build', '…check', 'model extract (outline+rows)'],
	[
		step('glueImport'),
		step('wasmDownloadAndCompile'),
		step('bundleDownload'),
		step('libcacheDownload'),
		step('preparedDownload'),
		step('instantiate'),
		step('decompress'),
		step('libraryLoad'),
		(l) => fmt(get(l, (r) => r.spike.firstAnalysis.ms)),
		(l) => fmt(get(l, (r) => r.spike.firstAnalysis.buildMs)),
		(l) => fmt(get(l, (r) => r.spike.firstAnalysis.checkMs)),
		(l) => fmt(get(l, (r) => r.spike.extract?.ms))
	]
);
const edit = (size) => (l) => fmt(get(l, (r) => median(r.edits[size])));
table(
	'Re-analysis after editing one file, and editor round trips (ms; per run the median of 5 edits of each size, then median [min–max] over runs)',
	['small (value)', 'medium (+6 lines)', 'large (+150 lines)', '20-edit series', 'ours: incl. listViews + stateMachines', 'LSP / hover first', 'hover again', 'definition'],
	[
		edit('small'),
		edit('medium'),
		edit('large'),
		edit('series20'),
		(l) => fmt(get(l, (r) => r.spike.firstAnalysis.withViewsAndMachinesMs)),
		(l) => fmt(get(l, (r) => (r.navigate.lspInitMs ?? 0) + r.navigate.hoverMs[0])),
		(l) => fmt(get(l, (r) => median(r.navigate.hoverMs.slice(1))), '', 1),
		(l) => fmt(get(l, (r) => median(r.navigate.definitionMs)), '', 1)
	]
);
const mem = (label, fn) => (l) => fmt(get(l, (r) => fn(r.memory.find((m) => m.label === label))));
table(
	'Memory (MiB). wasm = WebAssembly.Memory buffer size in the measured worker; heap = CDP Runtime.getHeapUsage on that worker (JS used / ArrayBuffer backing stores); renderer = RSS / PSS of the page\'s renderer process from /proc (page + both workers + service worker)',
	['wasm after instantiate', 'wasm after library', 'wasm after 1st analysis', 'wasm after 50 edits', 'worker JS heap used', 'worker backing stores', 'renderer RSS (ready)', 'renderer PSS (ready)', 'renderer RSS after edits', 'page JS heap'],
	[
		(l) => fmt(get(l, (r) => r.spike.memAfterInstantiate), '', 1),
		(l) => fmt(get(l, (r) => r.spike.memAfterLibrary), '', 1),
		(l) => fmt(get(l, (r) => r.spike.firstAnalysis.mem), '', 1),
		(l) => fmt(get(l, (r) => r.edits.memSeries20.at(-1)), '', 1),
		mem('ready', (m) => m.benchWorkerHeap.usedMB),
		mem('ready', (m) => m.benchWorkerHeap.backingStoreMB),
		mem('ready', (m) => m.renderer.rss),
		mem('ready', (m) => m.renderer.pss),
		mem('after navigation', (m) => m.renderer.rss),
		mem('ready', (m) => m.pageJsHeapUsedMB)
	]
);
table(
	'Main-thread long tasks (from a PerformanceObserver installed at document start)',
	['before workbench ready: count', 'blocking ms (Σ over 50 ms)', 'after workbench ready: count', 'blocking ms', 'longest'],
	[
		(l) => fmt(get(l, (r) => r.longTasks.beforeWorkspaceReady.count)),
		(l) => fmt(get(l, (r) => r.longTasks.beforeWorkspaceReady.blockingMs)),
		(l) => fmt(get(l, (r) => r.longTasks.afterWorkspaceReady.count)),
		(l) => fmt(get(l, (r) => r.longTasks.afterWorkspaceReady.blockingMs)),
		(l) => fmt(get(l, (r) => r.longTasks.afterWorkspaceReady.max))
	]
);
const served = (re) => (l) => fmt(get(l, (r) => Object.entries(r.served ?? {}).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v.bytes, 0) / 1e6), ' MB', 2);
table(
	'Bytes the server sent (gzip as GitHub Pages would; MB = 10^6 bytes)',
	['our engine (app + bench)', 'toolkit total', 'toolkit wasm', 'toolkit glue', 'stdlib bundle', 'libcache', 'prepared', 'everything'],
	[
		served(/^\/engine\//),
		served(/^\/toolkit\//),
		served(/^\/toolkit\/sysmlv2_bg/),
		served(/^\/toolkit\/sysmlv2\.js/),
		served(/json\.gz$/),
		served(/libcache/),
		served(/prepared/),
		served(/./)
	]
);
table('Load averages during the runs (1-min)', ['load'], [(l) => fmt(get(l, (r) => r.load[0]), '', 2)]);
if (failures.length) out.push(`\nFailed runs: ${failures.map((f) => `${f.profile}/${f.cache}/${f.target} run ${f.run}: ${f.failed.slice(0, 120)}`).join('; ')}`);
console.log(out.join('\n'));
