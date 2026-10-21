import type {
	ClassicMethod,
	EngineApi,
	Init,
	Method,
	Request,
	Response,
	RetiredMethod
} from './protocol';

/** The engine, as seen from the UI: every call is asynchronous. */
export type Engine = {
	[M in Method]: (...params: Parameters<EngineApi[M]>) => Promise<ReturnType<EngineApi[M]>>;
} & { terminate(): void };

/** The classic engine: the methods it still serves. */
export type ClassicEngine = Omit<Engine, RetiredMethod>;

/**
 * The engine in a Web Worker, loading it from the given URLs. The worker
 * (and its WebAssembly download) starts on the first call, so a page can
 * paint before the engine competes for the network. The URLs may be given
 * as a function, so they are only worked out then (not while prerendering).
 * `onReady` runs once, after the engine first answers.
 */
export function startEngine(
	urls: Init | (() => Init),
	options: { onReady?: () => void } = {}
): ClassicEngine {
	const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	let nextId = 1;
	let started: Worker | undefined;
	let onReady = options.onReady;

	function worker(): Worker {
		if (started) return started;
		const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (event: MessageEvent<Response>) => {
			const response = event.data;
			const call = pending.get(response.id);
			if (!call) return;
			pending.delete(response.id);
			if (response.ok) {
				onReady?.();
				onReady = undefined;
				call.resolve(response.result);
			} else call.reject(new Error(response.error));
		};
		w.onerror = (event) => {
			const error = new Error(event.message || 'The SysML engine failed to start');
			for (const call of pending.values()) call.reject(error);
			pending.clear();
		};
		w.postMessage((typeof urls === 'function' ? urls() : urls) satisfies Init);
		started = w;
		return w;
	}

	function call<M extends ClassicMethod>(method: M, ...params: Parameters<EngineApi[M]>) {
		const id = nextId++;
		return new Promise<ReturnType<EngineApi[M]>>((resolve, reject) => {
			pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			worker().postMessage({ id, method, params } satisfies Request<M>);
		});
	}

	return {
		version: (...params) => call('version', ...params),
		analyze: (...params) => call('analyze', ...params),
		analyzeProject: (...params) => call('analyzeProject', ...params),
		highlight: (...params) => call('highlight', ...params),
		complete: (...params) => call('complete', ...params),
		hover: (...params) => call('hover', ...params),
		definition: (...params) => call('definition', ...params),
		references: (...params) => call('references', ...params),
		renameSymbol: (...params) => call('renameSymbol', ...params),
		outline: (...params) => call('outline', ...params),
		format: (...params) => call('format', ...params),
		elementDetails: (...params) => call('elementDetails', ...params),
		codeActions: (...params) => call('codeActions', ...params),
		terminate: () => started?.terminate()
	};
}
