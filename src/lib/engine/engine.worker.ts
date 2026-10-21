/// <reference lib="webworker" />
/**
 * Hosts the SysML engine (WebAssembly) off the main thread. The engine's
 * wasm-bindgen glue is loaded at runtime from `static/engine/`, built by
 * `scripts/build-engine.sh`, so it is not part of the app bundle.
 */
import type { Init, Method, Request, Response } from './protocol';
import type { Analysis } from './types';

interface Wasm {
	default(options: { module_or_path: string }): Promise<unknown>;
	version(): string;
	analyze(path: string, source: string): string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: Promise<Wasm> | undefined;

async function load({ glueUrl, wasmUrl }: Init): Promise<Wasm> {
	const wasm = (await import(/* @vite-ignore */ glueUrl)) as Wasm;
	await wasm.default({ module_or_path: wasmUrl });
	return wasm;
}

const handlers: { [M in Method]: (wasm: Wasm, ...params: never[]) => unknown } = {
	version: (wasm) => wasm.version(),
	analyze: (wasm, path: string, source: string): Analysis =>
		JSON.parse(wasm.analyze(path, source)) as Analysis
};

scope.onmessage = async (event: MessageEvent<Init | Request>) => {
	const message = event.data;
	if (!('method' in message)) {
		engine = load(message);
		return;
	}
	let response: Response;
	try {
		if (!engine) throw new Error('engine not initialised');
		const wasm = await engine;
		const handler = handlers[message.method] as (wasm: Wasm, ...params: unknown[]) => unknown;
		response = { id: message.id, ok: true, result: handler(wasm, ...message.params) };
	} catch (error) {
		response = { id: message.id, ok: false, error: String(error) };
	}
	scope.postMessage(response);
};
