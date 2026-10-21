import { asset } from '$app/paths';
import { pwa } from '#lib/offline/pwa.svelte.ts';
import { SNAPSHOT_CACHE } from '#lib/offline/caching.ts';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import toolkitRelease from '../../../toolkit.json';
import { startEngine, type Engine } from './client';
import { composeEngine } from './composite';
import { startToolkit, type ToolkitClient } from './toolkit/client';

let engine: Engine | undefined;
let toolkit: ToolkitClient | undefined;

// Absolute URLs: the workers resolve relative ones against their own script.
const absolute = (path: string) =>
	new URL(asset(path as Parameters<typeof asset>[0]), location.href).href;

/** The app-wide engine (the toolkit, with the classic engine for what isn't ported yet), started on first use. */
export function getEngine(): Engine {
	if (engine) return engine;
	const classic = startEngine(
		() => ({
			glueUrl: absolute('engine/sysml_wasm.js'),
			wasmUrl: absolute('engine/sysml_wasm_bg.wasm')
		}),
		// Keep the engine for offline use, once it has been used.
		{ onReady: () => pwa.warmEngineCache() }
	);
	toolkit = startToolkit(
		() => ({
			glueUrl: absolute('toolkit/sysmlv2.js'),
			wasmUrl: absolute('toolkit/sysmlv2_bg.wasm'),
			bundleUrl: absolute('toolkit/stdlib/sysml-library.json.gz'),
			preparedUrl: absolute('toolkit/stdlib/sysml-library.prepared.gz'),
			version: toolkitRelease.version,
			snapshotCache: SNAPSHOT_CACHE
		}),
		{
			// On a slow network the toolkit's download comes first (analysis waits for it);
			// the classic engine (tables, diagrams, edits) downloads while the library loads.
			onLoaded: () => void classic.version().catch(() => undefined),
			onReady: (stats) => {
				performance.mark('sysml:toolkit-ready', { detail: stats });
				pwa.warmEngineCache();
				if (stats.library === 'source')
					whenIdle(() => wantsSnapshot() && toolkit?.prefetchSnapshot());
			},
			onFailure: (reason) => toasts.show(reason, { tone: 'error', duration: 0 })
		}
	);
	engine = composeEngine(classic, toolkit);
	return engine;
}

/** Numbers about the toolkit's start-up, once it has started. */
export function toolkitStats() {
	return toolkit?.stats ?? null;
}

function whenIdle(run: () => void) {
	const idle = window.requestIdleCallback ?? ((then: () => void) => setTimeout(then, 3000));
	idle(() => run(), { timeout: 15_000 });
}

/** Not on a metered or slow connection: the snapshot is a 10 MB download. */
function wantsSnapshot(): boolean {
	const connection = (
		navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
	).connection;
	return !connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType ?? '');
}
