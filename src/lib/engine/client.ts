import type { EngineApi, Init, Method, Request, Response } from './protocol';

/** The engine, as seen from the UI: every call is asynchronous. */
export type Engine = {
	[M in Method]: (...params: Parameters<EngineApi[M]>) => Promise<ReturnType<EngineApi[M]>>;
} & { terminate(): void };

/** Start the engine in a Web Worker, loading it from the given URLs. */
export function startEngine(urls: Init): Engine {
	const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	let nextId = 1;

	worker.onmessage = (event: MessageEvent<Response>) => {
		const response = event.data;
		const call = pending.get(response.id);
		if (!call) return;
		pending.delete(response.id);
		if (response.ok) call.resolve(response.result);
		else call.reject(new Error(response.error));
	};
	worker.onerror = (event) => {
		const error = new Error(event.message || 'The SysML engine failed to start');
		for (const call of pending.values()) call.reject(error);
		pending.clear();
	};
	worker.postMessage(urls satisfies Init);

	function call<M extends Method>(method: M, ...params: Parameters<EngineApi[M]>) {
		const id = nextId++;
		return new Promise<ReturnType<EngineApi[M]>>((resolve, reject) => {
			pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			worker.postMessage({ id, method, params } satisfies Request<M>);
		});
	}

	return {
		version: (...params) => call('version', ...params),
		analyze: (...params) => call('analyze', ...params),
		analyzeProject: (...params) => call('analyzeProject', ...params),
		highlight: (...params) => call('highlight', ...params),
		diagram: (...params) => call('diagram', ...params),
		edit: (...params) => call('edit', ...params),
		listViews: (...params) => call('listViews', ...params),
		renderView: (...params) => call('renderView', ...params),
		viewLibraries: (...params) => call('viewLibraries', ...params),
		libraryIndex: (...params) => call('libraryIndex', ...params),
		complete: (...params) => call('complete', ...params),
		hover: (...params) => call('hover', ...params),
		definition: (...params) => call('definition', ...params),
		references: (...params) => call('references', ...params),
		renameSymbol: (...params) => call('renameSymbol', ...params),
		outline: (...params) => call('outline', ...params),
		format: (...params) => call('format', ...params),
		elementDetails: (...params) => call('elementDetails', ...params),
		codeActions: (...params) => call('codeActions', ...params),
		readProjectArchive: (...params) => call('readProjectArchive', ...params),
		writeKpar: (...params) => call('writeKpar', ...params),
		libraryFile: (...params) => call('libraryFile', ...params),
		librarySearch: (...params) => call('librarySearch', ...params),
		libraryLicense: (...params) => call('libraryLicense', ...params),
		stateMachines: (...params) => call('stateMachines', ...params),
		stateStep: (...params) => call('stateStep', ...params),
		terminate: () => worker.terminate()
	};
}
