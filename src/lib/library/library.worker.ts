/// <reference lib="webworker" />
/**
 * Reads the standard library bundle and answers the library browser:
 * decompressing it and indexing ~6,000 declarations takes about 50 ms on a
 * fast computer and several times that on a phone, so it runs here rather
 * than on the main thread. The bundle is fetched and indexed once, on the
 * first request, and kept.
 */
import { buildCatalog, searchCatalog, type BundleFile, type Catalog } from './catalog';
import type { LibraryRequest, LibraryResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let catalog: Promise<Catalog> | undefined;
/** How long reading and indexing took, in milliseconds. */
let timing: { fetch: number; decompress: number; index: number } | undefined;

/** Undo gzip when the server sent the `.gz` file as it is (GitHub Pages); some
 * servers send it with `Content-Encoding: gzip`, so it arrives inflated. */
async function gunzipMaybe(bytes: Uint8Array): Promise<Uint8Array> {
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function load(url: string): Promise<Catalog> {
	const start = performance.now();
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`The standard library could not be loaded (${response.status}).`);
	const packed = new Uint8Array(await response.arrayBuffer());
	const fetched = performance.now();
	const bundle = JSON.parse(new TextDecoder().decode(await gunzipMaybe(packed))) as BundleFile[];
	const decompressed = performance.now();
	const built = buildCatalog(bundle);
	timing = {
		fetch: Math.round(fetched - start),
		decompress: Math.round(decompressed - fetched),
		index: Math.round(performance.now() - decompressed)
	};
	return built;
}

scope.onmessage = async (event: MessageEvent<LibraryRequest>) => {
	const request = event.data;
	let response: LibraryResponse;
	try {
		catalog ??= load(request.url).catch((error: unknown) => {
			catalog = undefined; // try again on the next request
			throw error;
		});
		const lib = await catalog;
		let result: unknown;
		switch (request.method) {
			case 'index':
				result = lib.entries;
				break;
			case 'file': {
				const text = lib.texts.get(request.path);
				if (text === undefined) throw new Error(`There is no library file ${request.path}.`);
				result = { path: request.path, text };
				break;
			}
			case 'search':
				result = searchCatalog(lib, request.query, request.limit);
				break;
			case 'timing':
				result = timing;
				break;
		}
		response = { id: request.id, ok: true, result };
	} catch (error) {
		response = {
			id: request.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
	scope.postMessage(response);
};
