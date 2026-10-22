/**
 * The browser benchmark (`npm run bench -- --browser`; docs/performance.md):
 * the built app in headless Chromium on a generated project, as a person
 * uses it — open the project, read the explorer, open the largest file,
 * type a character, complete, hover, open a large table and a large diagram.
 *
 *   BENCH_LINES=10000      project size (one per run of this file)
 *   BENCH_RUNS=3           runs (medians are written)
 *   BENCH_THROTTLE=4       CPU throttling (Chrome's DevTools emulation), off by default
 *   BENCH_OUT=<file.json>  where to write the medians
 *
 * The project is put into the browser's project store (IndexedDB) directly.
 * Times are from the page's clock; long tasks are the main thread's.
 */
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { generateLines, lineCount } from './generate';
import { medians, type Timings } from './stats';

const lines = Number(process.env.BENCH_LINES ?? 10000);
const runs = Number(process.env.BENCH_RUNS ?? 3);
const throttle = Number(process.env.BENCH_THROTTLE || 1);
const LONG = 600_000;
/** For a step that waits on the page rather than the engine's analysis. */
const STEP = 180_000;

const files = generateLines(lines);
const label = `${Math.round(lineCount(files) / 1000)}k${throttle > 1 ? ` (${throttle}× CPU)` : ''}`;
const largest = files.reduce((a, b) => (b.text.length > a.text.length ? b : a)).path;

/** Store the project in this origin's IndexedDB, as `store.ts` does. */
async function store(page: Page, id: string) {
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
					info: { name: `Benchmark ${id}` },
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

/** Long tasks on the main thread since `from` (page clock): count, total, longest, blocking time. */
async function longTasks(page: Page, from: number, to = Infinity) {
	return page.evaluate(
		({ from, to }) => {
			const tasks = ((window as unknown as { __longTasks?: PerformanceEntry[] }).__longTasks ?? [])
				.filter((t) => t.startTime >= from && t.startTime < to)
				.map((t) => t.duration);
			return {
				count: tasks.length,
				longest: Math.max(0, ...tasks),
				blocking: tasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0)
			};
		},
		{ from, to }
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

/** Wait for a locator and return the page time it took from `from`. */
async function until(page: Page, from: number, check: () => Promise<void>): Promise<number> {
	await check();
	return (await pageNow(page)) - from;
}

interface WorkerStats {
	memoryMiB: number;
	calls: { method: string; at: number; ms: number }[];
	callCount: number;
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

/**
 * Steps: each logs its start, and the engine's time in the step before it
 * (the worker's calls, summed) goes into `<step>: worker`.
 */
class Steps {
	private name = '';
	private seen = 0;
	constructor(
		private readonly page: Page,
		private readonly timings: Timings
	) {}

	async next(name: string) {
		const stats = await workerStats(this.page);
		// (Builds before the worker listed its calls have no `calls`.)
		if (stats?.calls) {
			const fresh = stats.calls.slice(-(stats.callCount - this.seen) || stats.calls.length);
			if (this.name && stats.callCount > this.seen) {
				this.timings[`${this.name}: worker`] = fresh.reduce((sum, c) => sum + c.ms, 0);
				console.log(`    worker: ${fresh.map((c) => `${c.method} ${c.ms}`).join(', ')}`);
			}
			this.seen = stats.callCount;
		}
		this.name = name;
		if (name) console.log(`${new Date().toISOString().slice(11, 19)} ${label}: ${name}`);
	}
}

async function measure(page: Page, round: number, timings: Timings) {
	const steps = new Steps(page, timings);
	const id = `bench-${lines}-${round}`;
	await page.goto('/projects');
	await store(page, id);
	if (throttle > 1) {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
	}

	await steps.next('open');
	// Open: navigation → "Model ready" (analysis, views, machines), then the checks.
	await page.goto(`/p/${id}`);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: LONG
	});
	timings['open: model ready'] = (await marks(page, 'sysml:workspace-ready'))[0] ?? NaN;
	timings['open: checks'] = await nextMark(page, 'sysml:checked', 0);
	const opened = await longTasks(page, 0);
	timings['open: long tasks'] = opened.count;
	timings['open: longest task'] = opened.longest;
	timings['open: blocking time'] = opened.blocking;
	timings['explorer: tree items'] = await page.getByRole('treeitem').count();
	timings['explorer: DOM nodes'] = await page.locator('nav.explorer *').count();
	timings['page: DOM nodes'] = await page.locator('*').count();

	await steps.next('explorer');
	// Scroll the explorer to the end and back: the time to the next frame after each.
	timings['explorer: scroll'] = await page.locator('nav.explorer').evaluate(async (nav) => {
		const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		const started = performance.now();
		nav.scrollTop = nav.scrollHeight;
		await frame();
		await frame();
		nav.scrollTop = 0;
		await frame();
		await frame();
		return performance.now() - started;
	});

	await steps.next('editor');
	// The largest file, as text.
	let from = await pageNow(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: largest.split('/').pop()!, exact: true }).click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	timings['editor: open largest file'] = await until(page, from, () =>
		expect(page.locator('.cm-content .cm-line').first()).toBeVisible({ timeout: LONG })
	);

	await steps.next('keystroke');
	// One character in a doc comment → the analysis of it on the page.
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type('doc /* A ');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	// The match is selected: put the cursor after it, inside the comment.
	await page.keyboard.press('ArrowRight');
	from = await pageNow(page);
	await page.keyboard.type('x');
	const analysed = await nextMark(page, 'sysml:analysed', from);
	timings['edit: keystroke → analysed'] = analysed - from;
	timings['edit: keystroke → checks'] = (await nextMark(page, 'sysml:checked', from)) - from;
	const typing = await longTasks(page, from);
	timings['edit: longest task'] = typing.longest;
	timings['edit: blocking time'] = typing.blocking;

	await steps.next('completion');
	// Completion of a type name (`subject sys : S…`).
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type('subject sys : ');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.press('ArrowRight');
	from = await pageNow(page);
	await page.keyboard.press('Control+Space');
	timings['editor: completion'] = await until(page, from, () =>
		expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: STEP })
	);
	await page.keyboard.press('Escape');

	await steps.next('hover');
	// Hover a type name (the editor waits ~300 ms before asking).
	const type = page
		.locator('.cm-content')
		.getByText(/^S\d+System$/)
		.first();
	await type.scrollIntoViewIfNeeded();
	from = await pageNow(page);
	await type.hover();
	timings['editor: hover'] = await until(page, from, () =>
		expect(page.locator('.cm-tooltip-hover')).toBeVisible({ timeout: STEP })
	);
	await page.mouse.move(0, 0);

	await steps.next('table');
	// The table of every requirement.
	await page.getByRole('tab', { name: 'Model' }).click();
	const views = page.locator('section[aria-labelledby="views-heading"]');
	from = await pageNow(page);
	await views.getByRole('button', { name: 'All requirements', exact: true }).click();
	const table = page.getByRole('region', { name: 'All requirements view' });
	timings['table: all requirements'] = await until(page, from, () =>
		expect(table.locator('tbody tr').first()).toBeVisible({ timeout: LONG })
	);
	timings['table: rows in DOM'] = await table.locator('tbody tr').count();
	const tabled = await longTasks(page, from);
	timings['table: longest task'] = tabled.longest;

	await steps.next('diagram');
	// The product's interconnection diagram (every subsystem on the bus).
	from = await pageNow(page);
	await views.getByRole('button', { name: 'Product interconnection', exact: true }).click();
	const diagram = page.getByRole('region', { name: /Product interconnection diagram/ });
	timings['diagram: product interconnection'] = await until(page, from, () =>
		expect(
			diagram
				.locator('.svelte-flow__node')
				.first()
				.or(diagram.getByText(/too many/i))
		).toBeVisible({ timeout: LONG })
	);
	timings['diagram: nodes'] = await diagram.locator('.svelte-flow__node').count();
	const drawn = await longTasks(page, from);
	timings['diagram: longest task'] = drawn.longest;

	await steps.next('');
	timings['memory: worker MiB'] = (await workerStats(page))?.memoryMiB ?? NaN;
	timings['memory: page JS MiB'] = await page.evaluate(
		() =>
			((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
				NaN) / 1048576
	);
}

test(`the app on a ${label} project`, async ({ browser }) => {
	test.setTimeout(LONG * runs * 2);
	const all: Timings[] = [];
	for (let round = 0; round < runs; round++) {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.addInitScript(() => {
			const tasks: PerformanceEntry[] = [];
			(window as unknown as { __longTasks: PerformanceEntry[] }).__longTasks = tasks;
			new PerformanceObserver((list) => tasks.push(...list.getEntries())).observe({
				type: 'longtask',
				buffered: true
			});
		});
		const timings: Timings = {};
		try {
			await measure(page, round, timings);
		} catch (error) {
			console.log(`${label}: run ${round} stopped: ${String(error).split('\n')[0]}`);
		}
		all.push(timings);
		await context.close();
	}
	const result = medians(all);
	console.log(JSON.stringify(result, null, 1));
	if (process.env.BENCH_OUT)
		writeFileSync(process.env.BENCH_OUT, JSON.stringify({ [label]: result }));
});
