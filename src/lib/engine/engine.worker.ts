/// <reference lib="webworker" />
/**
 * Hosts the SysML engine (WebAssembly) off the main thread. The engine's
 * wasm-bindgen glue is loaded at runtime from `static/engine/`, built by
 * `scripts/build-engine.sh`, so it is not part of the app bundle.
 */
import type { Init, Method, Request, Response, SourceFile } from './protocol';
import type {
	Analysis,
	DiagramGraph,
	EditResult,
	Highlights,
	LibraryEntry,
	LibraryHit,
	LibraryLicense,
	RenderedTable,
	StateMachine,
	StateSession,
	ViewInfo
} from './types';

interface Wasm {
	default(options: { module_or_path: string }): Promise<unknown>;
	version(): string;
	analyze(path: string, source: string): string;
	analyzeProject(files: string): string;
	highlight(source: string): string;
	diagram(view: string, files: string, scope: string | null): string;
	edit(request: string): string;
	listViews(files: string): string;
	renderView(files: string, name: string): string;
	viewLibraries(): string;
	libraryIndex(): string;
	libraryFile(path: string): string;
	librarySearch(query: string, limit: number): string;
	libraryLicense(): string;
	stateMachines(files: string): string;
	stateStep(
		files: string,
		machine: string,
		session: string | null,
		event: string | null,
		variables: string | null
	): string;
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
		JSON.parse(wasm.analyze(path, source)) as Analysis,
	analyzeProject: (wasm, files: unknown): Analysis[] =>
		JSON.parse(wasm.analyzeProject(JSON.stringify(files))) as Analysis[],
	highlight: (wasm, source: string): Highlights => JSON.parse(wasm.highlight(source)) as Highlights,
	diagram: (wasm, view: string, files: unknown, scope: string | null): DiagramGraph =>
		JSON.parse(wasm.diagram(view, JSON.stringify(files), scope)) as DiagramGraph,
	edit: (wasm, request: unknown): EditResult =>
		JSON.parse(wasm.edit(JSON.stringify(request))) as EditResult,
	listViews: (wasm, files: unknown): ViewInfo[] =>
		JSON.parse(wasm.listViews(JSON.stringify(files))) as ViewInfo[],
	renderView: (wasm, files: unknown, name: string): RenderedTable =>
		JSON.parse(wasm.renderView(JSON.stringify(files), name)) as RenderedTable,
	viewLibraries: (wasm): SourceFile[] => JSON.parse(wasm.viewLibraries()) as SourceFile[],
	libraryIndex: (wasm): LibraryEntry[] => JSON.parse(wasm.libraryIndex()) as LibraryEntry[],
	libraryFile: (wasm, path: string): SourceFile => JSON.parse(wasm.libraryFile(path)) as SourceFile,
	librarySearch: (wasm, query: string, limit: number): LibraryHit[] =>
		JSON.parse(wasm.librarySearch(query, limit)) as LibraryHit[],
	libraryLicense: (wasm): LibraryLicense => JSON.parse(wasm.libraryLicense()) as LibraryLicense,
	stateMachines: (wasm, files: unknown): StateMachine[] =>
		JSON.parse(wasm.stateMachines(JSON.stringify(files))) as StateMachine[],
	stateStep: (
		wasm,
		files: unknown,
		machine: string,
		session: unknown,
		event: string | null,
		variables: unknown
	): StateSession =>
		JSON.parse(
			wasm.stateStep(
				JSON.stringify(files),
				machine,
				session ? JSON.stringify(session) : null,
				event,
				variables ? JSON.stringify(variables) : null
			)
		) as StateSession
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
