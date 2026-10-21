/**
 * The toolkit worker, as seen from the page. Starts on the first call. If
 * the worker fails to start or dies (a trap, running out of memory), it is
 * started once more and the calls in flight are sent again; if that fails
 * too, every call fails from then on and `onFailure` runs once.
 */
import type { EngineApi } from '../protocol';
import type {
	ToolkitCall,
	ToolkitInit,
	ToolkitMethod,
	ToolkitOutbound,
	ToolkitStats
} from './protocol';

export interface ToolkitClient {
	call<M extends ToolkitMethod>(
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

export interface ToolkitOptions {
	/** The module has downloaded (the library loads next): the network is free again. */
	onLoaded?: () => void;
	onReady?: (stats: ToolkitStats) => void;
	/** The toolkit could not be started (after one restart): the reason. */
	onFailure?: (reason: string) => void;
	/** How many times to restart a worker that died (default 1). */
	restarts?: number;
	/** The worker to run (tests substitute their own). */
	createWorker?: () => Worker;
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

	function start(): Worker {
		config ??= { type: 'init', ...init() };
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
			case 'loaded':
				options.onLoaded?.();
				return;
			case 'ready':
				stats = message.stats;
				options.onReady?.(message.stats);
				if (prefetchWanted) from.postMessage({ type: 'prefetch' });
				return;
			case 'fatal':
				died(from, message.error);
				return;
			case 'prefetched':
				if (!message.cached && message.error)
					console.info('[toolkit] snapshot not cached:', message.error);
				return;
			case 'result': {
				const call = pending.get(message.id);
				if (!call) return;
				if (message.ok) {
					pending.delete(message.id);
					call.resolve(message.result);
				} else if (message.fatal) {
					died(from, message.error);
				} else {
					pending.delete(message.id);
					call.reject(new Error(message.error));
				}
			}
		}
	}

	/** The worker can't be used again: restart it once, else give up. */
	function died(w: Worker, reason: string) {
		if (w !== worker) return;
		w.terminate();
		worker = undefined;
		console.warn('[toolkit] worker stopped:', reason);
		if (restartsLeft > 0) {
			restartsLeft--;
			worker = start();
			for (const call of pending.values()) worker.postMessage(call.message);
			return;
		}
		failed = `The SysML engine stopped working (${reason}). Reload the page to try again.`;
		for (const call of pending.values()) call.reject(new Error(failed));
		pending.clear();
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
		}
	};
}
