/**
 * The toolkit worker, as seen from the page. Starts on the first call. If
 * the worker fails to start or dies (a trap, running out of memory), it is
 * started once more and the calls in flight are sent again; if that fails
 * too, every call fails from then on and `onFailure` runs once.
 *
 * A call the worker doesn't answer within its time limit (`CALL_LIMITS`)
 * fails with a plain reason; the worker is replaced and the calls waiting
 * behind it are sent to the new one, so nothing stays queued behind a call
 * that will never finish. The worker does one call at a time, in order, so
 * a call's clock starts when the one before it is answered (and not before
 * the library has loaded: a slow download is not a stuck call).
 */
import type { EngineApi, Method } from '../protocol';
import type { ToolkitCall, ToolkitInit, ToolkitOutbound, ToolkitStats } from './protocol';

export interface ToolkitClient {
	call<M extends Method>(
		method: M,
		...params: Parameters<EngineApi[M]>
	): Promise<ReturnType<EngineApi[M]>>;
	/** Ask the worker to fetch the prepared snapshot for later starts. */
	prefetchSnapshot(): void;
	/** Set once the toolkit has loaded its library. */
	readonly stats: ToolkitStats | null;
	readonly failed: string | null;
	terminate(): void;
}

/**
 * How long a call may take, ms, by kind. Generous: measured on a generated
 * 100k-line project with the whole browser slowed 4× (a mid-range phone),
 * an analysis took 66 s and the checks about 70 s; the slowest first open
 * seen (in Node, at desktop speed) took 59 s, which would be about 4 minutes
 * on that phone (`docs/performance.md`). Comparing and exchanging read the
 * model twice or write all of it.
 */
export const CALL_LIMITS = {
	/** No model involved: one file's colours or layout, the library's files. */
	quick: 60_000,
	/** Anything that reads the project (an edit re-reads it first). */
	model: 5 * 60_000,
	/** Two models, or the whole model in or out as JSON. */
	twice: 10 * 60_000
} as const;

const QUICK = new Set<Method>(['version', 'highlight', 'format', 'viewLibraries']);
const TWICE = new Set<Method>([
	'compareModels',
	'exportInterchange',
	'importInterchange',
	'mergeInputs',
	'weaveInterchange'
]);

export function callLimit(method: Method): number {
	return QUICK.has(method)
		? CALL_LIMITS.quick
		: TWICE.has(method)
			? CALL_LIMITS.twice
			: CALL_LIMITS.model;
}

/** What a person is told when a call ran out of time. */
export function tooLongMessage(method: Method): string {
	const minutes = Math.round(callLimit(method) / 60_000);
	const what =
		method === 'analyzeProject' || method === 'analyze'
			? 'Reading the model'
			: method === 'checks'
				? 'Checking the model'
				: 'A step';
	return (
		`${what} took longer than ${minutes} minute${minutes === 1 ? '' : 's'}, so Tessera stopped it and started again. ` +
		'If it keeps happening, the project may be too large for this device: try splitting it into smaller projects.'
	);
}

/**
 * WebAssembly memory, MiB, past which the person is warned. The engine can't
 * grow past 2048; a generated 100k-line project opens at about 1,760 and
 * reaches 1,950–2,030 after two edits, 50k lines stays near 1,100.
 */
export const MEMORY_WARNING_MIB = 1600;

/** Said once the engine's memory nears its 2 GiB ceiling. */
export function memoryWarning(mib: number): string {
	const gb = (mib / 1024).toFixed(1);
	return (
		`This project is close to the most Tessera can hold in a browser tab (${gb} of 2 GB used). ` +
		'If it grows much more, the model will stop updating. Move parts of it into separate projects; ' +
		'reloading the page frees some memory for a while.'
	);
}

export interface ToolkitOptions {
	onReady?: (stats: ToolkitStats) => void;
	/** The toolkit could not be started (after one restart): the reason. */
	onFailure?: (reason: string) => void;
	/** How many times to restart a worker that died (default 1). */
	restarts?: number;
	/** The worker to run (tests substitute their own). */
	createWorker?: () => Worker;
	/** A call ran out of time and the worker was replaced: what to tell the person. */
	onTooLong?: (message: string) => void;
	/** The engine's memory passed `MEMORY_WARNING_MIB` (once per client): MiB in use. */
	onMemoryHigh?: (memoryMiB: number) => void;
}

interface Pending {
	message: ToolkitCall;
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export function startToolkit(
	init: () => Omit<ToolkitInit, 'type'>,
	options: ToolkitOptions = {}
): ToolkitClient {
	const pending = new Map<number, Pending>();
	const createWorker =
		options.createWorker ??
		(() => new Worker(new URL('./toolkit.worker.ts', import.meta.url), { type: 'module' }));
	let restartsLeft = options.restarts ?? 1;
	let nextId = 1;
	let worker: Worker | undefined;
	let stats: ToolkitStats | null = null;
	let failed: string | null = null;
	let prefetchWanted = false;
	let config: ToolkitInit | undefined;
	/** The current worker has loaded its library (calls' clocks run). */
	let ready = false;
	let memoryWarned = false;
	/** The call whose clock is running, and its timer. */
	let timing: { id: number; timer: ReturnType<typeof setTimeout> } | undefined;

	/** Start the clock of the oldest call, the one the worker is on. */
	function watch() {
		const head = pending.values().next().value;
		if (timing && timing.id === head?.message.id) return;
		if (timing) clearTimeout(timing.timer);
		timing = undefined;
		if (!head || !ready || !worker) return;
		const { id, method } = head.message;
		timing = { id, timer: setTimeout(() => tooLong(id), callLimit(method)) };
	}

	/** The worker didn't answer in time: fail that call and replace the worker. */
	function tooLong(id: number) {
		timing = undefined;
		const call = pending.get(id);
		if (!call || !worker) return;
		pending.delete(id);
		const message = tooLongMessage(call.message.method);
		console.warn(`[toolkit] ${call.message.method} took too long; restarting the worker`);
		worker.terminate();
		worker = start();
		for (const waiting of pending.values()) worker.postMessage(waiting.message);
		call.reject(new Error(message));
		options.onTooLong?.(message);
	}

	function start(): Worker {
		config ??= { type: 'init', ...init() };
		ready = false;
		const w = createWorker();
		w.onmessage = (event: MessageEvent<ToolkitOutbound>) => receive(w, event.data);
		w.onerror = (event) => {
			event.preventDefault?.();
			died(w, event.message || 'the toolkit worker failed');
		};
		w.postMessage(config);
		if (prefetchWanted && stats) w.postMessage({ type: 'prefetch' });
		return w;
	}

	function receive(from: Worker, message: ToolkitOutbound) {
		if (from !== worker) return;
		switch (message.type) {
			case 'ready':
				stats = message.stats;
				ready = true;
				options.onReady?.(message.stats);
				if (prefetchWanted) from.postMessage({ type: 'prefetch' });
				memory(message.stats.memoryMiB);
				watch();
				return;
			case 'fatal':
				died(from, message.error);
				return;
			case 'prefetched':
				if (!message.cached && message.error)
					console.info('[toolkit] snapshot not cached:', message.error);
				return;
			case 'result': {
				if (message.memoryMiB !== undefined) memory(message.memoryMiB);
				const call = pending.get(message.id);
				if (!call) return;
				if (message.ok) {
					pending.delete(message.id);
					call.resolve(message.result);
				} else if (message.fatal) {
					died(from, message.error);
					return;
				} else {
					pending.delete(message.id);
					call.reject(new Error(message.error));
				}
				watch();
			}
		}
	}

	function memory(mib: number) {
		if (memoryWarned || mib < MEMORY_WARNING_MIB) return;
		memoryWarned = true;
		options.onMemoryHigh?.(mib);
	}

	/** The worker can't be used again: restart it once, else give up. */
	function died(w: Worker, reason: string) {
		if (w !== worker) return;
		w.terminate();
		worker = undefined;
		watch();
		console.warn('[toolkit] worker stopped:', reason);
		if (restartsLeft > 0) {
			restartsLeft--;
			worker = start();
			for (const call of pending.values()) worker.postMessage(call.message);
			return;
		}
		failed = `Tessera stopped reading the model (${reason}). Reload the page to try again.`;
		for (const call of pending.values()) call.reject(new Error(failed));
		pending.clear();
		watch();
		options.onFailure?.(failed);
	}

	return {
		call(method, ...params) {
			if (failed) return Promise.reject(new Error(failed));
			const message = { type: 'call', id: nextId++, method, params } as ToolkitCall;
			return new Promise((resolve, reject) => {
				pending.set(message.id, {
					message,
					resolve: resolve as (value: unknown) => void,
					reject
				});
				worker ??= start();
				worker.postMessage(message);
				watch();
			});
		},
		prefetchSnapshot() {
			prefetchWanted = true;
			if (worker && stats) worker.postMessage({ type: 'prefetch' });
		},
		get stats() {
			return stats;
		},
		get failed() {
			return failed;
		},
		terminate() {
			worker?.terminate();
			worker = undefined;
			watch();
		}
	};
}
