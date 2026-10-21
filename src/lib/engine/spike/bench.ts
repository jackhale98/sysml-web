/**
 * TEST BUILD of the sysml-toolkit engine (temporary; removed when the app
 * moves to it or drops it). The page side of
 * `bench.worker.ts`. With `?toolkit` in the URL, once the workbench is ready
 * the page starts the toolkit in its own worker, analyses the workspace's
 * files with it, and puts the timings on `window.__toolkitStats` (and logs
 * them). `window.__toolkit.call(op, …)` drives further steps (edits, hover)
 * from Playwright. Without the flag nothing here runs.
 *
 *   ?toolkit                  the toolkit, default library variant (none: no snapshot)
 *   ?toolkit=<variant>        libcache | none | prepared | prepared-stream | subset
 *   ?toolkit=ours             our engine, in a second worker, measured the same way
 *   &tkdelay=<ms>             wait this long after the workbench is ready
 */
import { asset } from '$app/paths';
import demoSubset from './demo-subset.json';

export type Variant = 'libcache' | 'none' | 'prepared' | 'prepared-stream' | 'subset' | 'embedded';
// Measured best general option on a phone, cold: no snapshot (2 MB less to download).
export const DEFAULT_VARIANT: Variant = 'none';

export interface FileText {
	path: string;
	text: string;
}
export interface BenchBoot {
	engine: 'toolkit' | 'ours';
	variant: Variant;
	glueUrl: string;
	wasmUrl: string;
	lib: { bundleUrl: string; libcacheUrl: string; preparedUrl: string; subset?: string[] };
}
export type BenchRequest = { id: number } & (
	| { op: 'boot'; boot: BenchBoot }
	| { op: 'analyze'; files: FileText[] }
	| { op: 'edit'; path: string; text: string }
	| { op: 'extract' }
	| { op: 'navigate'; path: string; offset: number }
	| { op: 'mem' }
	| { op: 'spin' }
);
export type BenchReply =
	| { id: number; ok: true; result: unknown; at: number }
	| { id: number; ok: false; error: string; at: number };
export interface StepStats {
	start: number;
	end: number;
	ms: number;
}
export interface BootStats {
	engine: string;
	version: string;
	variant: string;
	scriptStart: number;
	steps: Record<string, StepStats>;
	memAfterInstantiate: number;
	memAfterLibrary: number;
	resources: {
		name: string;
		transferSize: number;
		encodedBodySize: number;
		decodedBodySize: number;
		start: number;
		end: number;
	}[];
}

type Op = BenchRequest['op'];
type Args<O extends Op> = Omit<Extract<BenchRequest, { op: O }>, 'id' | 'op'>;

export interface Bench {
	call<O extends Op>(op: O, args?: Args<O>): Promise<unknown>;
	terminate(): void;
}

const now = () => performance.timeOrigin + performance.now();

export function startBench(): Bench {
	const worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, (reply: BenchReply) => void>();
	let next = 1;
	worker.onmessage = (event: MessageEvent<BenchReply>) => {
		pending.get(event.data.id)?.(event.data);
		pending.delete(event.data.id);
	};
	return {
		call(op, args) {
			const id = next++;
			return new Promise((resolve, reject) => {
				pending.set(id, (reply) =>
					reply.ok ? resolve(reply.result) : reject(new Error(reply.error))
				);
				worker.postMessage({ id, op, ...(args ?? {}) });
			});
		},
		terminate: () => worker.terminate()
	};
}

export interface Stats {
	params: Record<string, string>;
	/** When the workbench was ready (the model analysed by our engine). */
	workbenchReady?: number;
	spawned?: number;
	boot?: BootStats;
	firstAnalysis?: Record<string, unknown>;
	extract?: Record<string, unknown>;
	ready?: number;
	/** Worker spawn → first analysis done, ms. */
	timeToReadyMs?: number;
	longTasks: { start: number; duration: number }[];
	error?: string;
	done: boolean;
	status?: 'loading' | 'ready' | 'error';
	/** The files analysed, for the stress run. */
	files?: FileText[];
	/** A test that was running when the page last went away. */
	unfinished?: { step: string; variant: string; at: string };
	stressing?: boolean;
	stress?: {
		runs: { ms: number; mem: number }[];
		memBefore: number;
		memAfter: number;
		navigate?: Record<string, unknown>;
		error?: string;
	};
}

declare global {
	interface Window {
		__toolkitStats?: Stats;
		__toolkit?: Bench;
	}
}

/** Watch the main thread from the start, so long tasks before and after are known. */
export function observeLongTasks(into: Stats['longTasks']) {
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries())
				into.push({
					start: performance.timeOrigin + e.startTime,
					duration: Math.round(e.duration)
				});
		}).observe({ type: 'longtask', buffered: true });
	} catch {
		// longtask not supported (not Chromium)
	}
}

export function spikeRequested(url: URL): boolean {
	return url.searchParams.has('toolkit');
}

/** Create the stats object (and the long-task watch) as early as possible. */
export function prepareSpike(url: URL): Stats {
	const stats: Stats = {
		params: Object.fromEntries(url.searchParams),
		longTasks: [],
		done: false,
		unfinished: previousRun()
	};
	window.__toolkitStats = stats;
	observeLongTasks(stats.longTasks);
	return stats;
}

/** Start the measured engine once the workbench is ready, and analyse `files` with it. */
export async function runSpike(stats: Stats, files: FileText[]) {
	stats.workbenchReady = now();
	const params = new URLSearchParams(location.search);
	const which = params.get('toolkit') || DEFAULT_VARIANT;
	const delay = Number(params.get('tkdelay') ?? 0);
	if (delay) await new Promise((r) => setTimeout(r, delay));
	const absolute = (path: string) =>
		new URL(asset(path.slice(1) as Parameters<typeof asset>[0]), location.href).href;
	const boot: BenchBoot =
		which === 'ours'
			? {
					engine: 'ours',
					variant: 'embedded',
					// A query of its own, so it is not answered from the HTTP cache the app's
					// engine just filled (the service worker matches by path, so a warm
					// visit still gets it from the engine cache).
					glueUrl: absolute('/engine/sysml_wasm.js') + '?bench',
					wasmUrl: absolute('/engine/sysml_wasm_bg.wasm') + '?bench',
					lib: { bundleUrl: '', libcacheUrl: '', preparedUrl: '' }
				}
			: {
					engine: 'toolkit',
					variant: which as Variant,
					glueUrl: absolute('/toolkit/sysmlv2.js'),
					// The release's module is already size-optimised.
					wasmUrl: absolute('/toolkit/sysmlv2_bg.wasm'),
					lib: {
						bundleUrl: absolute('/toolkit/stdlib/sysml-library.json.gz'),
						libcacheUrl: absolute('/toolkit/stdlib/sysml-library.libcache.gz'),
						preparedUrl: absolute('/toolkit/stdlib/sysml-library.prepared.gz')
					}
				};
	try {
		if (boot.variant === 'subset') boot.lib.subset = demoSubset;
		mark({ step: 'loading', variant: boot.variant });
		stats.status = 'loading';
		changed();
		stats.spawned = now();
		const bench = startBench();
		window.__toolkit = bench;
		stats.boot = (await bench.call('boot', { boot })) as BootStats;
		changed();
		stats.firstAnalysis = (await bench.call('analyze', { files })) as Record<string, unknown>;
		stats.ready = now();
		stats.timeToReadyMs = Math.round(stats.ready - stats.spawned);
		if (boot.engine === 'toolkit')
			stats.extract = (await bench.call('extract')) as Record<string, unknown>;
		console.info(
			'[toolkit-spike]',
			JSON.stringify({ ...stats, longTasks: stats.longTasks.length })
		);
		stats.status = 'ready';
	} catch (error) {
		stats.error = String(error);
		stats.status = 'error';
		console.error('[toolkit-spike]', error);
	}
	stats.done = true;
	stats.files = files;
	unmark();
	changed();
}

// ---- For testing on a phone: results on screen, a stress run, crash detection ----

const MARK = 'sysml-toolkit-test';

/** Note what is running, so a tab the OS closed mid-test is noticed on reload. */
function mark(what: { step: string; variant: string }) {
	try {
		localStorage.setItem(MARK, JSON.stringify({ ...what, at: new Date().toISOString() }));
	} catch {
		// storage unavailable: no crash detection
	}
}
function unmark() {
	try {
		localStorage.removeItem(MARK);
	} catch {
		// storage unavailable
	}
}
function previousRun(): Stats['unfinished'] {
	try {
		const raw = localStorage.getItem(MARK);
		localStorage.removeItem(MARK);
		return raw ? (JSON.parse(raw) as Stats['unfinished']) : undefined;
	} catch {
		return undefined;
	}
}

/** Tell the on-screen panel the numbers changed. */
function changed() {
	window.dispatchEvent(new Event('toolkit-stats'));
}

/**
 * Edit one file `count` times (adding and removing a comment line), timing
 * each re-analysis and watching memory; then time hover and go to definition.
 */
export async function stress(stats: Stats, count = 20) {
	const bench = window.__toolkit;
	const files = stats.files;
	if (!bench || !files?.length || stats.stressing) return;
	const file = files.find((f) => /DroneArchitecture/.test(f.path)) ?? files[0]!;
	stats.stressing = true;
	stats.stress = { runs: [], memBefore: 0, memAfter: 0 };
	mark({ step: 'stress test', variant: stats.boot?.variant ?? '' });
	changed();
	try {
		stats.stress.memBefore = ((await bench.call('mem')) as { mem: number }).mem;
		for (let i = 1; i <= count; i++) {
			const text =
				i % 2
					? `${file.text}
// edit ${i}
`
					: file.text;
			const result = (await bench.call('edit', { path: file.path, text })) as {
				ms: number;
				mem: number;
			};
			stats.stress.runs.push({ ms: result.ms, mem: result.mem });
			changed();
		}
		const at = file.text.search(/\b[A-Z][A-Za-z]+\b/);
		stats.stress.navigate = (await bench.call('navigate', {
			path: file.path,
			offset: Math.max(0, at) + 1
		})) as Record<string, unknown>;
		stats.stress.memAfter = ((await bench.call('mem')) as { mem: number }).mem;
	} catch (error) {
		stats.stress.error = String(error);
	}
	stats.stressing = false;
	unmark();
	changed();
}

/** Everything measured, as text to paste into a message. */
export function report(stats: Stats): string {
	const nav = navigator as Navigator & { deviceMemory?: number };
	return JSON.stringify(
		{
			url: location.href,
			userAgent: navigator.userAgent,
			deviceMemoryGB: nav.deviceMemory,
			...stats,
			files: stats.files?.length,
			longTasks: stats.longTasks.length,
			boot: stats.boot && { ...stats.boot, resources: undefined }
		},
		null,
		1
	);
}
