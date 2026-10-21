/**
 * The OMG SysML v2 standard library, for browsing and search: the files of
 * the sysml-toolkit's library bundle, read and indexed in a worker on first
 * use (nothing is downloaded until a library view or search needs it).
 */
import { asset } from '$app/paths';
import type { LibraryEntry, LibraryHit, LibraryLicense } from '#lib/engine/types.ts';
import type { SourceFile } from '#lib/engine/protocol.ts';
import { licenseFor, libraryLicense as license } from './license';
import type { LibraryCall, LibraryRequest, LibraryResponse } from './protocol';

/** Where the toolkit's library bundle is served (`scripts/fetch-toolkit.sh`). */
export const BUNDLE_PATH = 'toolkit/stdlib/sysml-library.json.gz';

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function start(): Worker {
	if (worker) return worker;
	const w = new Worker(new URL('./library.worker.ts', import.meta.url), { type: 'module' });
	w.onmessage = (event: MessageEvent<LibraryResponse>) => {
		const response = event.data;
		const call = pending.get(response.id);
		if (!call) return;
		pending.delete(response.id);
		if (response.ok) call.resolve(response.result);
		else call.reject(new Error(response.error));
	};
	w.onerror = (event) => {
		const error = new Error(event.message || 'The standard library could not be read');
		for (const call of pending.values()) call.reject(error);
		pending.clear();
		worker = undefined;
		w.terminate();
	};
	worker = w;
	return w;
}

function call<T>(request: LibraryCall): Promise<T> {
	const id = nextId++;
	// Absolute: the worker resolves relative URLs against its own script.
	const url = new URL(asset(BUNDLE_PATH), location.href).href;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
		start().postMessage({ ...request, id, url } satisfies LibraryRequest);
	});
}

/** The library's files in path order: path, declared package, kind and size. */
export function libraryIndex(): Promise<LibraryEntry[]> {
	return call({ method: 'index' });
}

/** The text of one library file. Throws for an unknown path. */
export function libraryFile(path: string): Promise<SourceFile> {
	return call({ method: 'file', path });
}

/**
 * The library's definitions and usages whose name matches `query`: exact
 * names first, then prefixes, then words inside names; definitions before
 * usages. A query with `::` matches qualified names.
 */
export function librarySearch(query: string, limit: number): Promise<LibraryHit[]> {
	if (!query.trim() || limit <= 0) return Promise.resolve([]);
	return call({ method: 'search', query, limit });
}

/** How long the worker took to fetch, decompress and index the bundle (ms). */
export function libraryTiming(): Promise<{ fetch: number; decompress: number; index: number }> {
	return call({ method: 'timing' });
}

/** The standard library's licence (EPL-2.0). */
export function libraryLicense(): LibraryLicense {
	return license;
}

export { licenseFor };
