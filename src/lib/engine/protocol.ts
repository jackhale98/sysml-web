import type {
	Analysis,
	CheckReport,
	Evaluated,
	DiagramGraph,
	DiagramView,
	EditRequest,
	EditResult,
	Highlights,
	CodeAction,
	ElementDetails,
	ElementFeatures,
	FeatureValue,
	Completion,
	DefinitionTarget,
	FileChange,
	FileRange,
	Hover,
	OutlineItem,
	RenderedTable,
	StateMachine,
	TradeStudy,
	ViewInfo
} from './types';
import type { ModelComparison } from '#lib/review/types.ts';
import type {
	InterchangeExport,
	InterchangeExportOptions,
	InterchangeImport
} from '#lib/exchange/types.ts';

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
	/** A usage's attribute values: its own, then those its definition (and its supertypes) declare. */
	featureValues(files: SourceFile[], id: string): FeatureValue[];
	/** What the guided forms need about elements: kinds, how to refer to them, features with values. */
	elementFeatures(files: SourceFile[], ids: string[]): Record<string, ElementFeatures>;
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
	/** Every constraint and `satisfy` claim of the project, decided (cached per analysis). */
	checks(files: SourceFile[]): CheckReport;
	/** Elements' bound values, evaluated, by element id (cached per analysis). */
	evaluate(files: SourceFile[], ids: string[]): Record<string, Evaluated>;
	/** Every trade study of the project, evaluated (cached per analysis). */
	tradeStudies(files: SourceFile[]): TradeStudy[];
	/** What changed from `base` to `current`, element by element (`#lib/review/semantic.ts`). */
	compareModels(base: SourceFile[], current: SourceFile[]): ModelComparison;
	/** The project as SysML v2 JSON (KerML 10.4 element JSON). */
	exportInterchange(files: SourceFile[], options: InterchangeExportOptions): InterchangeExport;
	/** SysML v2 JSON as project files, and what didn't carry over. */
	importInterchange(json: string): InterchangeImport;
}

export type Method = keyof EngineApi;
