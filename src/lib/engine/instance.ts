import { asset } from '$app/paths';
import { pwa } from '#lib/offline/pwa.svelte.ts';
import { SNAPSHOT_CACHE } from '#lib/offline/caching.ts';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import toolkitRelease from '../../../toolkit.json';
import { toolkitEngine, type Engine } from './client';
import { memoryWarning, startToolkit, type ToolkitClient } from './toolkit/client';

let engine: Engine | undefined;
let toolkit: ToolkitClient | undefined;

// Absolute URLs: the worker resolves relative ones against its own script.
const absolute = (path: string) =>
	new URL(asset(path as Parameters<typeof asset>[0]), location.href).href;

/** Where the toolkit's files are. */
const toolkitFiles = () => ({
	glueUrl: absolute('toolkit/sysmlv2.js'),
	wasmUrl: absolute('toolkit/sysmlv2_bg.wasm'),
	bundleUrl: absolute('toolkit/stdlib/sysml-library.json.gz'),
	preparedUrl: absolute('toolkit/stdlib/sysml-library.prepared.gz'),
	version: toolkitRelease.version,
	snapshotCache: SNAPSHOT_CACHE
});

/**
 * A second engine for one heavy job (writing the standard library as JSON),
 * to `terminate()` once it's done: the memory it took goes with its worker,
 * and the workbench's engine is not slowed down meanwhile.
 */
export function startSpareEngine(): Engine {
	return toolkitEngine(startToolkit(toolkitFiles, { restarts: 0 }));
}

/** The app-wide engine (the sysml-toolkit, in a worker), started on first use. */
export function getEngine(): Engine {
	if (engine) return engine;
	toolkit = startToolkit(toolkitFiles, {
		onReady: (stats) => {
			performance.mark('sysml:toolkit-ready', { detail: stats });
			// Keep the engine for offline use, once it has been used.
			pwa.warmEngineCache();
			if (stats.library === 'source')
				whenIdle(() => wantsSnapshot() && toolkit?.prefetchSnapshot());
		},
		// Once, plainly; the problems list has the reason.
		onFailure: () =>
			toasts.show('Tessera stopped reading the model. Reload the page to try again.', {
				tone: 'error',
				duration: 0
			}),
		onTooLong: (message) => toasts.show(message, { tone: 'error', duration: 0 }),
		onMemoryHigh: (mib) => toasts.show(memoryWarning(mib), { tone: 'info', duration: 0 })
	});
	engine = toolkitEngine(toolkit);
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
