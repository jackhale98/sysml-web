import { asset } from '$app/paths';
import { pwa } from '#lib/offline/pwa.svelte.ts';
import { startEngine, type Engine } from './client';

let engine: Engine | undefined;

/** The app-wide engine, started on first use. */
export function getEngine(): Engine {
	// Absolute URLs: the worker resolves relative ones against its own script.
	const absolute = (path: string) => new URL(path, location.href).href;
	engine ??= startEngine(
		() => ({
			glueUrl: absolute(asset('engine/sysml_wasm.js')),
			wasmUrl: absolute(asset('engine/sysml_wasm_bg.wasm'))
		}),
		// Keep the engine for offline use, once it has been used.
		{ onReady: () => pwa.warmEngineCache() }
	);
	return engine;
}
