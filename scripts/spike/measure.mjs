// SPIKE: measure an engine inside the app in a real browser (Chromium via
// Playwright), phone-class or desktop, cold or warm cache. One JSON line per
// run is appended to the results file.
//
// usage: node scripts/spike/measure.mjs --target <app|ours|libcache|none|prepared|prepared-stream|subset>
//          [--profile phone|desktop] [--cache cold|warm] [--runs 5] [--edits]
//          [--wasm opt|plain] [--base http://localhost:4575] [--out results.jsonl]
//
// phone  = 390×844, isMobile, hasTouch, Lighthouse slow-4G network (CDP, which
//          reaches the worker's fetches) and a 4× slower CPU for the whole
//          renderer (main thread and workers) by duty-cycling the renderer
//          processes (scripts/spike/cpu-throttle.c; CDP CPU throttling is
//          refused on worker targets). Set CPU_THROTTLE_BIN to the built binary.
// cold   = new browser context, service worker blocked, empty caches.
// warm   = visits until the service worker controls the page and has the
//          engine files cached, then one more visit is measured.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { Cdp } from './cdp.mjs';
import { chromePath, DESKTOP, PHONE, SLOW_4G } from './profiles.mjs';

const { values: opt } = parseArgs({
	options: {
		target: { type: 'string', default: 'libcache' },
		profile: { type: 'string', default: 'phone' },
		cache: { type: 'string', default: 'cold' },
		runs: { type: 'string', default: '5' },
		edits: { type: 'boolean', default: false },
		wasm: { type: 'string', default: 'opt' },
		base: { type: 'string', default: 'http://localhost:4575' },
		out: { type: 'string', default: 'spike-results.jsonl' }
	}
});
const ROOT = path.resolve(import.meta.dirname, '../..');
const phone = opt.profile === 'phone';
const throttleBin = process.env.CPU_THROTTLE_BIN;
if (phone && !throttleBin) throw new Error('set CPU_THROTTLE_BIN (gcc -O2 -o cpu-throttle scripts/spike/cpu-throttle.c)');

const query =
	opt.target === 'app' ? '' : `?toolkit=${opt.target}${opt.wasm === 'plain' ? '&wasm=plain' : ''}`;
const url = `${opt.base}/p/demo${query}`;
const COMPONENTS = 'system/Components.sysml';
const componentsText = fs.readFileSync(path.join(ROOT, 'src/demo/drone', COMPONENTS), 'utf8');
const archText = fs.readFileSync(path.join(ROOT, 'src/demo/drone/system/DroneArchitecture.sysml'), 'utf8');

/** Edits of one file, by size. */
function edited(size, i) {
	if (size === 'small') return componentsText.replace('mass = 1100 [g]', `mass = ${1101 + i} [g]`);
	const block = (n) =>
		Array.from(
			{ length: n },
			(_, k) => `    part def Spare${i}_${k} {
        attribute :>> mass = ${10 + k} [g];
        attribute ratedPower : ISQ::PowerValue = ${k + 1} [W];
        port supply : PowerPort;
        doc /* A spare part added by the edit benchmark. */
    }`
		).join('\n');
	const at = componentsText.lastIndexOf('}');
	const n = size === 'medium' ? 1 : 25; // 6 lines, or 150 lines
	return componentsText.slice(0, at) + block(n) + '\n' + componentsText.slice(at);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function procMem(pid) {
	try {
		const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
		const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
		const hwm = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
		const roll = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
		const pss = Number(/^Pss:\s+(\d+)/m.exec(roll)?.[1] ?? 0) / 1024;
		return { rss: Math.round(rss), peakRss: Math.round(hwm), pss: Math.round(pss) };
	} catch {
		return null;
	}
}

async function runOnce(run) {
	const port = 9600 + Math.floor(Math.random() * 300);
	const browser = await chromium.launch({
		executablePath: chromePath(),
		args: [`--remote-debugging-port=${port}`, '--no-sandbox', '--enable-precise-memory-info']
	});
	const cdp = await Cdp.connect(port);
	const procs = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
	const browserPid = (await procs()).find((p) => p.type === 'browser').id;
	let throttle;
	if (phone) throttle = spawn(throttleBin, [String(browserPid), '4', '10'], { stdio: 'ignore' });
	const context = await browser.newContext({
		...(phone ? PHONE : DESKTOP),
		serviceWorkers: opt.cache === 'cold' ? 'block' : 'allow'
	});
	const page = await context.newPage();
	const session = await context.newCDPSession(page);
	await session.send('Network.enable');
	if (phone) await session.send('Network.emulateNetworkConditions', SLOW_4G);
	await session.send('Performance.enable');
	const { targetInfo } = await session.send('Target.getTargetInfo');
	const { sessionId: pageSession } = await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true });
	const workers = new Map();
	cdp.on((m) => {
		if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'worker')
			workers.set(m.params.targetInfo.url, m.params.sessionId);
	});
	await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
	// Bytes over the wire per URL, from the network domain (includes worker fetches).
	const wire = new Map();
	const urls = new Map();
	session.on('Network.responseReceived', (e) => urls.set(e.requestId, { url: e.response.url, fromSW: e.response.fromServiceWorker, fromCache: e.response.fromDiskCache }));
	session.on('Network.loadingFinished', (e) => {
		const u = urls.get(e.requestId);
		if (u) wire.set(u.url, { bytes: e.encodedDataLength, fromSW: u.fromSW, fromCache: u.fromCache });
	});

	const isDone = opt.target === 'app' ? () => performance.getEntriesByName('sysml:workspace-ready').length > 0 : () => window.__toolkitStats?.done;
	if (opt.cache === 'warm') {
		// Visit until the service worker controls the page and holds the engine files.
		for (let visit = 0; visit < 4; visit++) {
			await page.goto(url, { waitUntil: 'load' });
			await page.waitForFunction(isDone, null, { timeout: 900000, polling: 500 });
			await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 120000 });
			const cached = await page.evaluate(async (target) => {
				const keys = [];
				for (const name of await caches.keys()) if (name.includes('engine')) for (const r of await (await caches.open(name)).keys()) keys.push(new URL(r.url).pathname);
				const want = target === 'app' || target === 'ours' ? ['/engine/sysml_wasm_bg.wasm'] : ['/toolkit/sysmlv2_bg.opt.wasm', '/toolkit/stdlib/sysml-library.json.gz'];
				return want.every((w) => keys.includes(w));
			}, opt.target);
			if (cached && visit > 0) break;
			await sleep(1000);
		}
		wire.clear();
		workers.clear();
	}
	const t0 = Date.now();
	await page.goto(url, { waitUntil: 'load' });
	await page.waitForFunction(isDone, null, { timeout: 900000, polling: 250 });
	const result = { run, target: opt.target, profile: opt.profile, cache: opt.cache, wasm: opt.wasm, load: os.loadavg().map((x) => +x.toFixed(2)), wallMs: Date.now() - t0 };

	result.page = await page.evaluate(async () => {
		const lcp = await new Promise((resolve) => {
			new PerformanceObserver((l) => resolve(l.getEntries().at(-1)?.startTime)).observe({ type: 'largest-contentful-paint', buffered: true });
			setTimeout(() => resolve(null), 1000);
		});
		const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
		const ready = performance.getEntriesByName('sysml:workspace-ready')[0];
		return {
			timeOrigin: performance.timeOrigin,
			fcp: Math.round(fcp ?? -1),
			lcp: Math.round(lcp ?? -1),
			workspaceReady: Math.round(ready?.startTime ?? -1),
			ourEngineAnalysisMs: Math.round(ready?.detail?.millis ?? -1),
			controlled: !!navigator.serviceWorker?.controller
		};
	});
	const heapOf = async (match) => {
		const sid = [...workers.entries()].find(([u]) => u.includes(match))?.[1];
		if (!sid) return null;
		try {
			const h = await cdp.send('Runtime.getHeapUsage', {}, sid);
			return { usedMB: +(h.usedSize / 1048576).toFixed(1), totalMB: +(h.totalSize / 1048576).toFixed(1), backingStoreMB: +((h.backingStorageSize ?? 0) / 1048576).toFixed(1) };
		} catch (e) {
			return { error: e.message };
		}
	};
	const memory = async (label) => {
		const renderers = (await procs()).filter((p) => p.type === 'renderer').map((p) => ({ pid: p.id, ...procMem(p.id) }));
		const main = renderers.sort((a, b) => (b.rss ?? 0) - (a.rss ?? 0))[0];
		const metrics = Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
		return {
			label,
			benchWorkerHeap: await heapOf('bench.worker'),
			appEngineWorkerHeap: await heapOf('engine.worker'),
			pageJsHeapUsedMB: +(metrics.JSHeapUsedSize / 1048576).toFixed(1),
			pageJsHeapTotalMB: +(metrics.JSHeapTotalSize / 1048576).toFixed(1),
			renderer: main,
			renderersRssMB: renderers.reduce((s, r) => s + (r.rss ?? 0), 0)
		};
	};
	result.memory = [await memory('ready')];
	if (opt.target !== 'app') {
		const stats = await page.evaluate(() => window.__toolkitStats);
		const origin = result.page.timeOrigin;
		const rel = (t) => (t ? Math.round(t - origin) : null);
		result.spike = {
			error: stats.error,
			workbenchReady: rel(stats.workbenchReady),
			spawned: rel(stats.spawned),
			workerScriptStart: rel(stats.boot?.scriptStart),
			ready: rel(stats.ready),
			timeToReadyMs: stats.timeToReadyMs,
			steps: Object.fromEntries(Object.entries(stats.boot?.steps ?? {}).map(([k, v]) => [k, { ms: v.ms, start: rel(v.start), end: rel(v.end) }])),
			memAfterInstantiate: stats.boot?.memAfterInstantiate,
			memAfterLibrary: stats.boot?.memAfterLibrary,
			firstAnalysis: stats.firstAnalysis,
			extract: stats.extract,
			resources: stats.boot?.resources.map((r) => ({ name: r.name, transferSize: r.transferSize, encoded: r.encodedBodySize, decoded: r.decodedBodySize, ms: Math.round(r.end - r.start) })),
			// Main-thread long tasks from the moment the workbench was ready until the engine was.
			longTasksDuringSpike: stats.longTasks.filter((t) => t.start >= stats.workbenchReady && t.start <= (stats.ready ?? Infinity) + 2000).map((t) => ({ at: rel(t.start), ms: t.duration })),
			longTasksBefore: stats.longTasks.filter((t) => t.start < stats.workbenchReady).map((t) => ({ at: rel(t.start), ms: t.duration }))
		};
		if (opt.edits && !stats.error) {
			const call = (op, args) => page.evaluate(([o, a]) => window.__toolkit.call(o, a), [op, args]);
			const edits = { small: [], medium: [], large: [] };
			for (const size of ['small', 'medium', 'large'])
				for (let i = 0; i < 5; i++) {
					edits[size].push(await call('edit', { path: COMPONENTS, text: edited(size, i) }));
					// back to the original, so each edit is a change of that size
					await call('edit', { path: COMPONENTS, text: componentsText });
				}
			const series = [];
			for (let i = 0; i < 20; i++) series.push(await call('edit', { path: COMPONENTS, text: edited('small', i + 10) }));
			result.edits = {
				small: edits.small.map((e) => e.ms),
				medium: edits.medium.map((e) => e.ms),
				large: edits.large.map((e) => e.ms),
				series20: series.map((e) => e.ms),
				memSeries20: series.map((e) => e.mem),
				findings: series.at(-1).findings
			};
			result.memory.push(await memory('after 50 edits'));
			const offset = archText.indexOf(': Battery') + 3;
			const nav = [];
			for (let i = 0; i < 5; i++) nav.push(await call('navigate', { path: 'system/DroneArchitecture.sysml', offset }));
			result.navigate = {
				lspInitMs: nav[0].lspInitMs,
				memAfterLspInit: nav[0].memAfterLspInit,
				hoverMs: nav.map((n) => n.hoverMs),
				definitionMs: nav.map((n) => n.definitionMs),
				hover: nav[0].hover,
				definition: nav[0].definition
			};
			result.memory.push(await memory('after navigation'));
			const lt = await page.evaluate(() => window.__toolkitStats.longTasks);
			result.longTasksTotal = lt.length;
		}
	} else {
		result.memory[0].note = 'app only: our engine in the app worker';
	}
	result.wire = Object.fromEntries([...wire.entries()].filter(([u]) => /engine\/|toolkit\//.test(u)).map(([u, v]) => [u.replace(opt.base, ''), v]));
	result.wireTotal = [...wire.values()].reduce((s, v) => s + v.bytes, 0);
	throttle?.kill('SIGTERM');
	await sleep(100);
	await browser.close();
	cdp.close();
	return result;
}

const runs = Number(opt.runs);
console.error(`[measure] ${url} profile=${opt.profile} cache=${opt.cache} runs=${runs} load=${os.loadavg().map((x) => x.toFixed(2))}`);
for (let i = 0; i < runs; i++) {
	try {
		const r = await runOnce(i);
		fs.appendFileSync(opt.out, JSON.stringify(r) + '\n');
		console.error(`[measure] run ${i}: ttr=${r.spike?.timeToReadyMs ?? '-'} ms first=${r.spike?.firstAnalysis?.ms ?? '-'} wsReady=${r.page.workspaceReady} mem=${r.spike?.firstAnalysis?.mem ?? '-'}MB load=${r.load.join(',')} err=${r.spike?.error ?? ''}`);
	} catch (e) {
		console.error(`[measure] run ${i} failed:`, e);
		fs.appendFileSync(opt.out, JSON.stringify({ run: i, target: opt.target, profile: opt.profile, cache: opt.cache, failed: String(e) }) + '\n');
	}
}
