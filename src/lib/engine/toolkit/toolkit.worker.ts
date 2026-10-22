/// <reference lib="webworker" />
/**
 * Hosts the sysml-toolkit engine (`@sysml/wasm`, served from `static/toolkit/`
 * and fetched by `scripts/fetch-toolkit.sh`) off the main thread.
 *
 * Library start-up: the first visit resolves the standard library from its
 * sources (no snapshot to download: 3.3 MB in all instead of 15). Once the
 * page is idle it asks for the prepared snapshot, which is stored in Cache
 * Storage; later starts load the library from it (measured on a throttled
 * phone: 2.6 s to ready instead of 8.2 s, and 105 MB of memory instead of 160).
 */
import type { Method, SourceFile } from '../protocol';
import type { DiagramView, EditRequest } from '../types';
import type { Toolkit } from './api';
import { ToolkitHost } from './host';
import { SyntaxServices } from './language';
import type { ToolkitCall, ToolkitInbound, ToolkitInit, ToolkitOutbound } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const started = performance.now();

let init: ToolkitInit | undefined;
let booting: Promise<ToolkitHost> | undefined;
/** Highlighting and formatting, available before the library has loaded. */
let syntax: Promise<SyntaxServices> | undefined;
let syntaxReady: (s: SyntaxServices) => void = () => undefined;
let memory: WebAssembly.Memory | undefined;
let prefetching = false;

function post(message: ToolkitOutbound) {
	scope.postMessage(message);
}

const snapshotKey = (i: ToolkitInit) => `${i.preparedUrl}?v=${encodeURIComponent(i.version)}`;

async function fetchBytes(url: string): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

/** Undo gzip when the server sent a `.gz` file as it is (GitHub Pages does). */
async function gunzipMaybe(bytes: Uint8Array): Promise<Uint8Array> {
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The cached prepared snapshot, if an earlier visit stored one for this release. */
async function cachedSnapshot(i: ToolkitInit): Promise<Uint8Array | null> {
	try {
		const cache = await caches.open(i.snapshotCache);
		const response = await cache.match(snapshotKey(i));
		return response ? new Uint8Array(await response.arrayBuffer()) : null;
	} catch {
		return null; // No Cache Storage (private mode, file://): start from source.
	}
}

async function boot(i: ToolkitInit): Promise<ToolkitHost> {
	// Everything downloads at once; the wasm compiles while it streams in.
	const compiled = WebAssembly.compileStreaming(fetch(i.wasmUrl));
	const glue = import(/* @vite-ignore */ i.glueUrl) as Promise<Toolkit>;
	const bundleBytes = fetchBytes(i.bundleUrl);
	const snapshot = cachedSnapshot(i);
	const tk = await glue;
	({ memory } = await tk.default({ module_or_path: await compiled }));
	tk.install_panic_hook?.();
	const early = new SyntaxServices(tk);
	syntaxReady(early);
	const bundle = new TextDecoder().decode(await gunzipMaybe(await bundleBytes));
	const libraryStart = performance.now();
	let library: ToolkitHost['library'] | undefined;
	let from: 'snapshot' | 'source' = 'source';
	const prepared = await snapshot;
	if (prepared) {
		try {
			library = tk.PreparedLibrary.fromSnapshotStream(await gunzipMaybe(prepared), bundle, null);
			from = 'snapshot';
		} catch (error) {
			// Another build's snapshot, or a damaged one: forget it and resolve from source.
			console.warn('[toolkit] prepared snapshot refused, loading from source', error);
			void caches.open(i.snapshotCache).then((c) => c.delete(snapshotKey(i)));
		}
	}
	library ??= new tk.PreparedLibrary(bundle, null);
	const host = new ToolkitHost(tk, library, early);
	post({
		type: 'ready',
		stats: {
			version: tk.version(),
			bootMs: Math.round(performance.now() - started),
			library: from,
			libraryMs: Math.round(performance.now() - libraryStart),
			memoryMiB: memoryMiB()
		}
	});
	return host;
}

const memoryMiB = () => (memory ? Math.round(memory.buffer.byteLength / 1048576) : 0);

/** Download the prepared snapshot into Cache Storage, unless it is there already. */
async function prefetch(i: ToolkitInit) {
	if (prefetching) return;
	prefetching = true;
	try {
		const cache = await caches.open(i.snapshotCache);
		const key = snapshotKey(i);
		// Snapshots of other releases are of no use any more.
		for (const request of await cache.keys()) if (request.url !== key) await cache.delete(request);
		if (await cache.match(key)) {
			post({ type: 'prefetched', cached: true });
			return;
		}
		const response = await fetch(i.preparedUrl);
		if (!response.ok) throw new Error(`${i.preparedUrl}: ${response.status}`);
		await cache.put(key, response);
		post({ type: 'prefetched', cached: true });
	} catch (error) {
		post({ type: 'prefetched', cached: false, error: String(error) });
	} finally {
		prefetching = false;
	}
}

type Handler = (host: ToolkitHost, ...params: never[]) => unknown;
const handlers: { [M in Method]: Handler } = {
	version: (host) => host.version(),
	analyze: (host, path: string, source: string) => host.analyze(path, source),
	analyzeProject: (host, files: SourceFile[]) => host.analyzeProject(files),
	elementDetails: (host, files: SourceFile[], path: string, line: number, element: string | null) =>
		host.elementDetails(files, path, line, element),
	featureValues: (host, files: SourceFile[], id: string) => host.featureValues(files, id),
	stateMachines: (host, files: SourceFile[]) => host.stateMachines(files),
	highlight: (host, source: string) => host.highlight(source),
	format: (host, source: string) => host.format(source),
	complete: (host, files: SourceFile[], path: string, offset: number) =>
		host.complete(files, path, offset),
	hover: (host, files: SourceFile[], path: string, offset: number) =>
		host.hover(files, path, offset),
	definition: (host, files: SourceFile[], path: string, offset: number) =>
		host.definition(files, path, offset),
	references: (host, files: SourceFile[], path: string, offset: number) =>
		host.references(files, path, offset),
	renameSymbol: (host, files: SourceFile[], path: string, offset: number, newName: string) =>
		host.renameSymbol(files, path, offset, newName),
	outline: (host, files: SourceFile[], path: string) => host.outline(files, path),
	codeActions: (host, files: SourceFile[], path: string, from: number, to: number) =>
		host.codeActions(files, path, from, to),
	edit: (host, request: EditRequest) => host.edit(request),
	diagram: (host, view: DiagramView, files: SourceFile[], scope: string | null) =>
		host.diagram(view, files, scope),
	listViews: (host, files: SourceFile[]) => host.listViews(files),
	renderView: (host, files: SourceFile[], name: string) => host.renderView(files, name),
	viewLibraries: (host) => host.viewLibraries(),
	checks: (host, files: SourceFile[]) => host.checks(files),
	evaluate: (host, files: SourceFile[], ids: string[]) => host.evaluate(files, ids)
};

/** A trap or a failed memory grow leaves the instance unusable: the page restarts the worker. */
function isFatal(error: unknown): boolean {
	return (
		error instanceof WebAssembly.RuntimeError ||
		(error instanceof RangeError && /memory|allocation/i.test(error.message)) ||
		/unreachable|out of memory/i.test(String(error))
	);
}

async function call(message: ToolkitCall) {
	try {
		if (!booting || !syntax) throw new Error('toolkit not initialised');
		if (message.method === 'highlight' || message.method === 'format') {
			const tools = await Promise.race([syntax, booting.then((h) => h.syntax)]);
			const [source] = message.params as [string];
			const result =
				message.method === 'highlight' ? tools.highlight(source) : tools.format(source);
			post({ type: 'result', id: message.id, ok: true, result });
			return;
		}
		const host = await booting;
		const handler = handlers[message.method] as (host: ToolkitHost, ...p: unknown[]) => unknown;
		post({ type: 'result', id: message.id, ok: true, result: handler(host, ...message.params) });
	} catch (error) {
		const fatal = isFatal(error);
		post({ type: 'result', id: message.id, ok: false, error: String(error), fatal });
	}
}

scope.onmessage = (event: MessageEvent<ToolkitInbound>) => {
	const message = event.data;
	if (message.type === 'init') {
		init = message;
		syntax = new Promise((resolve) => (syntaxReady = resolve));
		booting = boot(message);
		booting.catch((error: unknown) => post({ type: 'fatal', error: String(error) }));
	} else if (message.type === 'prefetch') {
		if (init) {
			const i = init;
			// Only once the library is up, so the download doesn't compete with start-up.
			void booting?.then(() => prefetch(i)).catch(() => undefined);
		}
	} else void call(message);
};
