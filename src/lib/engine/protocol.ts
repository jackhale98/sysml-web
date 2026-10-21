import type {
	Analysis,
	DiagramGraph,
	DiagramView,
	EditRequest,
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

export interface SourceFile {
	path: string;
	text: string;
}

/** Calls the UI can make into the engine worker, with their results. */
export interface EngineApi {
	version(): string;
	analyze(path: string, source: string): Analysis;
	analyzeProject(files: SourceFile[]): Analysis[];
	highlight(source: string): Highlights;
	diagram(view: DiagramView, files: SourceFile[], scope: string | null): DiagramGraph;
	edit(request: EditRequest): EditResult;
	listViews(files: SourceFile[]): ViewInfo[];
	renderView(files: SourceFile[], name: string): RenderedTable;
	/** The view libraries the engine bundles (`Reporting`, `ModelViews`). */
	viewLibraries(): SourceFile[];
	libraryIndex(): LibraryEntry[];
	libraryFile(path: string): SourceFile;
	librarySearch(query: string, limit: number): LibraryHit[];
	libraryLicense(): LibraryLicense;
	stateMachines(files: SourceFile[]): StateMachine[];
	/** Start (null session) or advance a machine; variables override values first. */
	stateStep(
		files: SourceFile[],
		machine: string,
		session: StateSession | null,
		event: string | null,
		variables: Record<string, unknown> | null
	): StateSession;
}

export type Method = keyof EngineApi;

export interface Request<M extends Method = Method> {
	id: number;
	method: M;
	params: Parameters<EngineApi[M]>;
}

export type Response =
	{ id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** First message to the worker: where the engine files are served from. */
export interface Init {
	/** The wasm-bindgen ES module (`sysml_wasm.js`). */
	glueUrl: string;
	/** The WebAssembly binary (`sysml_wasm_bg.wasm`). */
	wasmUrl: string;
}
