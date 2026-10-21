/// <reference lib="webworker" />
/**
 * Hosts the SysML engine (WebAssembly) off the main thread. The engine's
 * wasm-bindgen glue is loaded at runtime from `static/engine/`, built by
 * `scripts/build-engine.sh`, so it is not part of the app bundle.
 */
import type { ClassicMethod, Init, Request, Response, SourceFile } from './protocol';
import type { Analysis, Highlights, RenderedTable, ViewInfo } from './types';

interface Wasm {
	default(options: { module_or_path: string }): Promise<unknown>;
	version(): string;
	analyze(path: string, source: string): string;
	analyzeProject(files: string): string;
	highlight(source: string): string;
	listViews(files: string): string;
	renderView(files: string, name: string): string;
	viewLibraries(): string;
	elementDetails(files: string, path: string, line: number, element: string | null): string;
	complete(files: string, path: string, offset: number): string;
	hover(files: string, path: string, offset: number): string;
	definition(files: string, path: string, offset: number): string;
	references(files: string, path: string, offset: number): string;
	renameSymbol(files: string, path: string, offset: number, newName: string): string;
	outline(files: string, path: string): string;
	format(source: string): string;
	codeActions(files: string, path: string, from: number, to: number): string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: Promise<Wasm> | undefined;

async function load({ glueUrl, wasmUrl }: Init): Promise<Wasm> {
	const wasm = (await import(/* @vite-ignore */ glueUrl)) as Wasm;
	await wasm.default({ module_or_path: wasmUrl });
	return wasm;
}

/** The project as JSON for the engine, reused while it is unchanged. */
let lastFiles: { json: string; key: string } | undefined;
function cachedFiles(files: unknown): string {
	const list = files as { path: string; text: string }[];
	const key = list.map((f) => `${f.path}:${f.text.length}:${f.text.slice(-64)}`).join('|');
	if (lastFiles?.key !== key) lastFiles = { key, json: JSON.stringify(list) };
	return lastFiles.json;
}

const handlers: { [M in ClassicMethod]: (wasm: Wasm, ...params: never[]) => unknown } = {
	version: (wasm) => wasm.version(),
	analyze: (wasm, path: string, source: string): Analysis =>
		JSON.parse(wasm.analyze(path, source)) as Analysis,
	analyzeProject: (wasm, files: unknown): Analysis[] =>
		JSON.parse(wasm.analyzeProject(JSON.stringify(files))) as Analysis[],
	highlight: (wasm, source: string): Highlights => JSON.parse(wasm.highlight(source)) as Highlights,
	listViews: (wasm, files: unknown): ViewInfo[] =>
		JSON.parse(wasm.listViews(JSON.stringify(files))) as ViewInfo[],
	renderView: (wasm, files: unknown, name: string): RenderedTable =>
		JSON.parse(wasm.renderView(JSON.stringify(files), name)) as RenderedTable,
	viewLibraries: (wasm): SourceFile[] => JSON.parse(wasm.viewLibraries()) as SourceFile[],
	complete: (wasm, files: unknown, path: string, offset: number) =>
		JSON.parse(wasm.complete(cachedFiles(files), path, offset)) as unknown,
	hover: (wasm, files: unknown, path: string, offset: number) =>
		JSON.parse(wasm.hover(cachedFiles(files), path, offset)) as unknown,
	definition: (wasm, files: unknown, path: string, offset: number) =>
		JSON.parse(wasm.definition(cachedFiles(files), path, offset)) as unknown,
	references: (wasm, files: unknown, path: string, offset: number) =>
		JSON.parse(wasm.references(cachedFiles(files), path, offset)) as unknown,
	renameSymbol: (wasm, files: unknown, path: string, offset: number, newName: string) =>
		JSON.parse(wasm.renameSymbol(cachedFiles(files), path, offset, newName)) as unknown,
	outline: (wasm, files: unknown, path: string) =>
		JSON.parse(wasm.outline(cachedFiles(files), path)) as unknown,
	format: (wasm, source: string) => JSON.parse(wasm.format(source)) as unknown,
	elementDetails: (wasm, files: unknown, path: string, line: number, element: string | null) =>
		JSON.parse(wasm.elementDetails(cachedFiles(files), path, line, element)) as unknown,
	codeActions: (wasm, files: unknown, path: string, from: number, to: number) =>
		JSON.parse(wasm.codeActions(cachedFiles(files), path, from, to)) as unknown
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
		const handler = handlers[message.method as ClassicMethod] as
			((wasm: Wasm, ...params: unknown[]) => unknown) | undefined;
		if (!handler) throw new Error(`the classic engine no longer serves ${message.method}`);
		response = { id: message.id, ok: true, result: handler(wasm, ...message.params) };
	} catch (error) {
		response = { id: message.id, ok: false, error: String(error) };
	}
	scope.postMessage(response);
};
