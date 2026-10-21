import type {
	Analysis,
	DiagramGraph,
	DiagramView,
	EditRequest,
	EditResult,
	Highlights,
	CodeAction,
	ElementDetails,
	Completion,
	DefinitionTarget,
	FileChange,
	FileRange,
	Hover,
	OutlineItem,
	RenderedTable,
	StateMachine,
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
	elementDetails(
		files: SourceFile[],
		path: string,
		line: number,
		element: string | null
	): ElementDetails;
	complete(files: SourceFile[], path: string, offset: number): Completion;
	hover(files: SourceFile[], path: string, offset: number): Hover | null;
	definition(files: SourceFile[], path: string, offset: number): DefinitionTarget | null;
	references(files: SourceFile[], path: string, offset: number): FileRange[];
	renameSymbol(
		files: SourceFile[],
		path: string,
		offset: number,
		newName: string
	): { changes: FileChange[] } | { error: string };
	outline(files: SourceFile[], path: string): OutlineItem[];
	format(source: string): { changes: { from: number; to: number; insert: string }[] };
	codeActions(files: SourceFile[], path: string, from: number, to: number): CodeAction[];
	stateMachines(files: SourceFile[]): StateMachine[];
}

export type Method = keyof EngineApi;

/** Methods deleted from the classic engine once the toolkit served them (composite.ts checks). */
export type RetiredMethod = 'stateMachines' | 'listViews' | 'renderView' | 'viewLibraries';

/** Methods the classic engine's worker still serves. */
export type ClassicMethod = Exclude<Method, RetiredMethod>;

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
