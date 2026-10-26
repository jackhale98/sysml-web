/**
 * Assessment benchmark (docs/assessment/10-performance-usability.md): the
 * built app in headless Chromium, every run recorded so the distribution
 * (median, p90, max) can be reported rather than one median.
 *
 * One run, in a fresh browser context (an empty cache, as a first visit):
 *  1. cold start — navigate to the project; the engine ready (library from
 *     source), "Model ready", the checks shown;
 *  2. wait until the engine's prepared library snapshot is in Cache Storage,
 *     then reload: the repeat load (library from the snapshot);
 *  3. first edit — one character in a doc comment of the largest file: next
 *     frame, → analysed, → checked;
 *  4. re-analysis — a second character, the same again;
 *  5. memory and CPU — the worker's WebAssembly memory, the page's JS heap
 *     (CDP Performance.getMetrics), the renderer process's peak resident set
 *     (VmHWM, Linux) and CPU time (CDP SystemInfo.getProcessInfo).
 *
 *   ASSESS_SIZES=demo,10000,50000,100000   projects (demo = src/demo/drone)
 *   ASSESS_RUNS=5                          runs per size (or e.g. "demo:7,10000:5,50000:3")
 *   ASSESS_DEVICE=desktop|phone            phone = Pixel 7 emulation (viewport, touch, DPR)
 *   ASSESS_THROTTLE=6                      DevTools CPU throttling of the page's main thread
 *                                          (ASSESS_THROTTLE_WORKER=1 also asks for the worker;
 *                                          Chromium refuses: "only supported for pages")
 *   ASSESS_DUTY=4                          slow the whole renderer, worker included, about 4×
 *                                          (`assessment-duty-cycle.mjs`, Linux)
 *   ASSESS_OUT=<file.json>                 every run's numbers
 *
 * Run: npx playwright test --config tests/perf/assessment-playwright.config.ts
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
	devices,
	expect,
	test,
	type Browser,
	type BrowserContext,
	type CDPSession,
	type Page
} from '@playwright/test';
import { generateLines, lineCount, type GeneratedFile } from './generate';
import type { Timings } from './stats';

const LONG = 900_000;
const sizes = (process.env.ASSESS_SIZES ?? 'demo,10000').split(',').filter(Boolean);
const runSpec = process.env.ASSESS_RUNS ?? '3';
const device = process.env.ASSESS_DEVICE === 'phone' ? 'phone' : 'desktop';
const throttle = Number(process.env.ASSESS_THROTTLE || 1);
const throttleWorker = process.env.ASSESS_THROTTLE_WORKER === '1';
const duty = Number(process.env.ASSESS_DUTY || 1);

/** A fixed amount of work on the page's main thread and in a worker (ms): how slow the CPU is. */
async function calibrate(page: Page) {
	return page.evaluate(async () => {
		const work = `let x = 0; for (let i = 0; i < 3e7; i++) x = (x + i * 7) % 1000003;`;
		let at = performance.now();
		new Function(work)();
		const main = performance.now() - at;
		const blob = new Blob([
			`onmessage = () => { const t = performance.now(); ${work} postMessage(performance.now() - t); };`
		]);
		const worker = new Worker(URL.createObjectURL(blob));
		at = performance.now();
		const inside = await new Promise<number>((resolve) => {
			worker.onmessage = (e) => resolve(e.data as number);
			worker.postMessage(null);
		});
		const wall = performance.now() - at;
		worker.terminate();
		return { main, worker: inside, workerWall: wall };
	});
}

function runsFor(size: string): number {
	if (/^\d+$/.test(runSpec)) return Number(runSpec);
	const entry = runSpec.split(',').find((e) => e.startsWith(`${size}:`));
	return Number(entry?.split(':')[1] ?? 3);
}

const DEMO = join(import.meta.dirname, '../../src/demo/drone');
function demoFiles(): GeneratedFile[] {
	const out: GeneratedFile[] = [];
	const walk = (at: string) => {
		for (const name of readdirSync(at).sort()) {
			const path = join(at, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (name.endsWith('.sysml'))
				out.push({ path: relative(DEMO, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(DEMO);
	return out;
}

/** Store the project in this origin's IndexedDB, as `store.ts` does. */
async function store(page: Page, id: string, files: GeneratedFile[]) {
	await page.evaluate(
		async ({ id, files }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('sysml-web', 1);
				request.onupgradeneeded = () =>
					request.result.createObjectStore('projects', { keyPath: 'id' });
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const now = new Date().toISOString();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('projects', 'readwrite');
				tx.objectStore('projects').put({
					id,
					info: { name: `Assessment ${id}` },
					files,
					origin: 'new',
					created: now,
					updated: now
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
		},
		{ id, files }
	);
}

const pageNow = (page: Page) => page.evaluate(() => performance.now());
const marks = (page: Page, name: string) =>
	page.evaluate((name) => performance.getEntriesByName(name).map((m) => m.startTime), name);

async function nextMark(page: Page, name: string, after: number): Promise<number> {
	let found = NaN;
	await expect
		.poll(
			async () => {
				found = (await marks(page, name)).find((t) => t > after) ?? NaN;
				return Number.isFinite(found);
			},
			{ timeout: LONG, intervals: [50] }
		)
		.toBe(true);
	return found;
}

async function longTasks(page: Page, from: number) {
	return page.evaluate((from) => {
		const tasks = ((window as unknown as { __longTasks?: PerformanceEntry[] }).__longTasks ?? [])
			.filter((t) => t.startTime >= from)
			.map((t) => t.duration);
		return {
			longest: Math.max(0, ...tasks),
			blocking: tasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0)
		};
	}, from);
}

interface WorkerStats {
	memoryMiB: number;
}
async function workerStats(page: Page): Promise<WorkerStats | null> {
	for (const worker of page.workers()) {
		const stats = await worker
			.evaluate(() => (self as unknown as { sysmlStats?: () => unknown }).sysmlStats?.())
			.catch(() => null);
		if (stats) return stats as WorkerStats;
	}
	return null;
}

/** Renderer processes: peak resident set (VmHWM, MiB) and CPU seconds, summed over renderers. */
async function renderers(browser: Browser) {
	const session = await browser.newBrowserCDPSession();
	try {
		const { processInfo } = (await session.send('SystemInfo.getProcessInfo')) as {
			processInfo: { type: string; id: number; cpuTime: number }[];
		};
		let peakMiB = 0;
		let cpu = 0;
		for (const p of processInfo.filter((p) => p.type === 'renderer')) {
			cpu += p.cpuTime;
			try {
				const status = readFileSync(`/proc/${p.id}/status`, 'utf8');
				const hwm = Number(/VmHWM:\s+(\d+) kB/.exec(status)?.[1] ?? 0) / 1024;
				peakMiB = Math.max(peakMiB, hwm);
			} catch {
				// Not Linux, or the process is gone.
			}
		}
		return { peakMiB, cpu };
	} finally {
		await session.detach();
	}
}

/**
 * CPU throttling of the page, and (optionally) of every worker it starts:
 * workers are auto-attached paused, throttled, then let go.
 */
async function applyThrottle(page: Page, log: string[]): Promise<CDPSession | null> {
	if (throttle <= 1) return null;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
	if (!throttleWorker) return cdp;
	let id = 1000;
	cdp.on('Target.attachedToTarget', (event) => {
		const { sessionId, targetInfo } = event as {
			sessionId: string;
			targetInfo: { type: string; url: string };
		};
		const send = (method: string, params: object = {}) =>
			cdp
				.send('Target.sendMessageToTarget', {
					sessionId,
					message: JSON.stringify({ id: id++, method, params })
				})
				.catch((e) => log.push(`send ${method}: ${String(e)}`));
		if (targetInfo.type === 'worker')
			void send('Emulation.setCPUThrottlingRate', { rate: throttle }).then(() =>
				send('Runtime.runIfWaitingForDebugger')
			);
		else void send('Runtime.runIfWaitingForDebugger');
	});
	cdp.on('Target.receivedMessageFromTarget', (event) => {
		const { message } = event as { message: string };
		if (/"error"/.test(message) || /"id":10\d\d,"result"/.test(message))
			log.push(message.slice(0, 200));
	});
	await cdp.send('Target.setAutoAttach', {
		autoAttach: true,
		waitForDebuggerOnStart: true,
		flatten: false
	});
	return cdp;
}

/** The time from a key press to the next frame after it (the page's clock). */
async function armFrameProbe(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as { __keyFrame?: Promise<number> };
		w.__keyFrame = new Promise<number>((resolve) => {
			document.addEventListener(
				'keydown',
				(event) => {
					const at = event.timeStamp;
					requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - at), 0));
				},
				{ once: true, capture: true }
			);
		});
	});
}
const frameProbe = (page: Page) =>
	page.evaluate(() => (window as unknown as { __keyFrame: Promise<number> }).__keyFrame);

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: LONG
	});

async function toolkitReady(page: Page) {
	await nextMark(page, 'sysml:toolkit-ready', 0);
	return page.evaluate(() => {
		const m = performance.getEntriesByName('sysml:toolkit-ready')[0] as PerformanceMark;
		return { at: m.startTime, ...(m.detail as { library: string; bootMs: number }) };
	});
}

async function snapshotCached(page: Page) {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					for (const name of await caches.keys())
						if (
							name.endsWith('toolkit-snapshot') &&
							(await (await caches.open(name)).keys()).length
						)
							return true;
					return false;
				}),
			{ timeout: 120_000, intervals: [500] }
		)
		.toBe(true);
}

async function typeInDocComment(page: Page, char: string) {
	await armFrameProbe(page);
	const from = await pageNow(page);
	await page.keyboard.type(char);
	const frame = await frameProbe(page);
	const analysed = (await nextMark(page, 'sysml:analysed', from)) - from;
	const checked = (await nextMark(page, 'sysml:checked', from)) - from;
	const tasks = await longTasks(page, from);
	return { frame, analysed, checked, longest: tasks.longest, blocking: tasks.blocking };
}

async function measure(
	browser: Browser,
	context: BrowserContext,
	page: Page,
	files: GeneratedFile[],
	id: string,
	t: Timings,
	log: string[]
) {
	const largest = files
		// Not a library file: those open read-only.
		.filter((f) => f.text.includes('doc /*') && !f.path.startsWith('libraries/'))
		.reduce((a, b) => (b.text.length > a.text.length ? b : a)).path;
	await page.goto('/projects');
	await store(page, id, files);
	const cdp = await applyThrottle(page, log);
	// The duty cycler looks for new renderers every half second.
	if (duty > 1) await page.waitForTimeout(1500);
	const speed = await calibrate(page);
	t['calibration: main thread ms'] = speed.main;
	t['calibration: worker ms'] = speed.worker;
	t['calibration: worker wall ms'] = speed.workerWall;
	const cpu0 = (await renderers(browser)).cpu;

	const step = (name: string) =>
		console.log(`${new Date().toISOString().slice(11, 19)} ${id}: ${name}`);
	step('cold start');
	// 1. Cold start.
	await page.goto(`/p/${id}`);
	await ready(page);
	const boot = await toolkitReady(page);
	t['cold: engine ready'] = boot.at;
	t['cold: library from snapshot'] = boot.library === 'snapshot' ? 1 : 0;
	t['cold: model ready'] = (await marks(page, 'sysml:workspace-ready'))[0] ?? NaN;
	t['cold: checks shown'] = await nextMark(page, 'sysml:checked', 0);
	const coldTasks = await longTasks(page, 0);
	t['cold: longest task'] = coldTasks.longest;
	t['cold: blocking time'] = coldTasks.blocking;
	const afterCold = await renderers(browser);
	t['cold: renderer CPU s'] = afterCold.cpu - cpu0;
	t['cold: renderer peak RSS MiB'] = afterCold.peakMiB;
	t['cold: worker wasm MiB'] = (await workerStats(page))?.memoryMiB ?? NaN;

	step('waiting for the snapshot');
	// 2. Repeat load, once the snapshot is cached (the page asks for it when idle).
	await snapshotCached(page);
	step('repeat load');
	await page.reload();
	await ready(page);
	const again = await toolkitReady(page);
	t['repeat: engine ready'] = again.at;
	t['repeat: library from snapshot'] = again.library === 'snapshot' ? 1 : 0;
	t['repeat: model ready'] = (await marks(page, 'sysml:workspace-ready'))[0] ?? NaN;
	t['repeat: checks shown'] = await nextMark(page, 'sysml:checked', 0);
	t['repeat: worker wasm MiB'] = (await workerStats(page))?.memoryMiB ?? NaN;

	step('edits');
	// 3–4. First edit and a second one, in the largest file's text.
	const name = largest.split('/').pop()!;
	if (device === 'phone') {
		// Phone layout: files are listed in the Views catalogue.
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Views' })
			.click();
		await page
			.getByRole('button', { name: new RegExp(`^${name.replace(/[.]/g, '\\.')}`) })
			.first()
			.click();
	} else {
		await page.getByRole('tab', { name: 'Files' }).click();
		await page.getByRole('button', { name, exact: true }).first().click();
	}
	const textButton = page.getByRole('button', { name: 'Text', exact: true });
	if (await textButton.isVisible().catch(() => false)) await textButton.click();
	// On a phone the text opens to read; "Edit text" makes it editable.
	const editText = page.getByRole('button', { name: 'Edit text' });
	if (await editText.isVisible().catch(() => false)) await editText.click();
	await expect(page.locator('.cm-content .cm-line').first()).toBeVisible({ timeout: LONG });
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type('doc /*');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.press('ArrowRight');
	const cpu1 = (await renderers(browser)).cpu;
	const first = await typeInDocComment(page, 'x');
	t['edit 1: key → next frame'] = first.frame;
	t['edit 1: → analysed'] = first.analysed;
	t['edit 1: → checked'] = first.checked;
	t['edit 1: longest task'] = first.longest;
	const second = await typeInDocComment(page, 'y');
	t['edit 2: key → next frame'] = second.frame;
	t['edit 2: → analysed'] = second.analysed;
	t['edit 2: → checked'] = second.checked;
	t['edit 2: longest task'] = second.longest;
	t['edits: renderer CPU s'] = (await renderers(browser)).cpu - cpu1;

	// 5. Memory at the end.
	const end = await renderers(browser);
	t['end: renderer peak RSS MiB'] = end.peakMiB;
	t['end: worker wasm MiB'] = (await workerStats(page))?.memoryMiB ?? NaN;
	const perf = await context.newCDPSession(page);
	await perf.send('Performance.enable');
	const { metrics } = (await perf.send('Performance.getMetrics')) as {
		metrics: { name: string; value: number }[];
	};
	const metric = (n: string) => metrics.find((m) => m.name === n)?.value ?? NaN;
	t['end: page JS heap used MiB'] = metric('JSHeapUsedSize') / 1048576;
	t['end: page JS heap total MiB'] = metric('JSHeapTotalSize') / 1048576;
	t['end: DOM nodes'] = metric('Nodes');
	t['crossOriginIsolated'] = (await page.evaluate(() => self.crossOriginIsolated)) ? 1 : 0;
	await cdp?.detach().catch(() => undefined);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...pixel7 } = devices['Pixel 7'];
const contextOptions = device === 'phone' ? pixel7 : { viewport: { width: 1440, height: 900 } };

for (const size of sizes) {
	const files = size === 'demo' ? demoFiles() : generateLines(Number(size));
	const label = `${size === 'demo' ? 'demo' : `${Math.round(lineCount(files) / 1000)}k`} ${device}${throttle > 1 ? ` ${throttle}x${throttleWorker ? '+worker' : ''}` : ''}${duty > 1 ? ` duty ${duty}x` : ''}`;
	test(`assessment: ${label}`, async ({ browser }) => {
		const runs = runsFor(size);
		test.setTimeout(LONG * runs);
		const all: (Timings & { error?: string })[] = [];
		for (let round = 0; round < runs; round++) {
			const context = await browser.newContext(contextOptions);
			const cycler =
				duty > 1
					? spawn(
							'node',
							[
								join(import.meta.dirname, 'assessment-duty-cycle.mjs'),
								String(process.pid),
								String(duty)
							],
							{ stdio: 'ignore' }
						)
					: null;
			const page = await context.newPage();
			await page.addInitScript(() => {
				const tasks: PerformanceEntry[] = [];
				(window as unknown as { __longTasks: PerformanceEntry[] }).__longTasks = tasks;
				new PerformanceObserver((list) => tasks.push(...list.getEntries())).observe({
					type: 'longtask',
					buffered: true
				});
			});
			const t: Timings & { error?: string } = {};
			const log: string[] = [];
			const started = Date.now();
			try {
				await measure(browser, context, page, files, `assess-${size}-${round}`, t, log);
			} catch (error) {
				t.error = String(error).split('\n')[0];
				console.log(`${label}: run ${round} stopped: ${t.error}`);
			}
			t['run wall s'] = (Date.now() - started) / 1000;
			if (log.length) console.log(`${label}: cdp log ${log.slice(0, 6).join(' | ')}`);
			console.log(`${label} run ${round}: ${JSON.stringify(t)}`);
			all.push(t);
			cycler?.kill('SIGTERM');
			await context.close();
		}
		const out = process.env.ASSESS_OUT;
		if (out) {
			let previous: Record<string, unknown> = {};
			try {
				previous = JSON.parse(readFileSync(out, 'utf8'));
			} catch {
				// first size
			}
			writeFileSync(
				out,
				JSON.stringify(
					{ ...previous, [label]: { lines: lineCount(files), files: files.length, runs: all } },
					null,
					1
				)
			);
		}
		expect(all.length).toBe(runs);
	});
}
