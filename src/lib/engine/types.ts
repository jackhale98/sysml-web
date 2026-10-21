/**
 * JSON shapes returned by the SysML engine (`sysml-wasm`).
 *
 * These mirror `sysml-core`'s serialized `Model` and `Diagnostic`. Only the
 * fields the app reads are typed; the engine may send more.
 */

export interface Span {
	/** 1-based line of the first character. */
	start_row: number;
	/** 1-based column of the first character. */
	start_col: number;
	end_row: number;
	end_col: number;
	start_byte: number;
	end_byte: number;
}

export interface Definition {
	kind: string;
	name: string;
	super_type: string | null;
	span: Span;
	parent_def?: string;
	short_name?: string;
	doc?: string;
}

export interface Usage {
	kind: string;
	name: string;
	type_ref: string | null;
	span: Span;
	parent_def?: string;
	short_name?: string;
	doc?: string;
	value_expr?: string;
	redefinition?: string;
	multiplicity?: string;
}

/** A `satisfy … by …` or a `verify` inside a verification case. */
export interface TraceLink {
	requirement: string;
	by: string;
	span: Span;
}

export interface MetadataAnnotation {
	metadata_type: string;
	/** `[field, value expression]` pairs, values as written in the source. */
	values: [string, string][];
	target: string;
	span: Span;
}

export interface SyntaxError {
	message: string;
	span: Span;
}

export interface Model {
	file: string;
	definitions: Definition[];
	usages: Usage[];
	satisfactions: TraceLink[];
	verifications: TraceLink[];
	annotations?: MetadataAnnotation[];
	syntax_errors: SyntaxError[];
}

export type Severity = 'error' | 'warning' | 'note';

export interface Diagnostic {
	file: string;
	span: Span;
	severity: Severity;
	code: string;
	message: string;
	explanation?: string;
	suggestion?: string;
}

/** Result of `analyze(path, source)`. */
export interface Analysis {
	model: Model;
	diagnostics: Diagnostic[];
}

/** Result of `highlight(source)`. */
export interface Highlights {
	/** Capture names, e.g. `keyword`, `type.definition`. */
	names: string[];
	/** Flat `[from, to, nameIndex, …]` in UTF-16 offsets. */
	spans: number[];
}

export type DiagramView =
	'general' | 'interconnection' | 'requirements' | 'states' | 'packages' | 'trace' | 'actions';

/** A `view def` or `view` usage in the project or the bundled libraries. */
export interface ViewInfo {
	name: string;
	qualifiedName?: string;
	file: string;
	isUsage: boolean;
	/** Whether a `@TableRendering` applies, so the view renders as a table. */
	hasTable: boolean;
	/** For a usage, the view def it is typed by (e.g. `GeneralView`). */
	definition?: string;
	doc?: string;
	renderAs?: string;
	/** The `expose` targets as written (`P`, `P::*`, `P::**`). */
	exposes?: string[];
	/** From a library the engine bundles, not from the project's files. */
	builtin: boolean;
}

/** A view rendered as a table by the engine. */
export interface RenderedTable {
	view: string;
	columns: string[];
	rows: string[][];
	warnings: string[];
	/** Parallel to `rows` (empty for a pivot): the element behind each row. */
	sources: { element: string; file: string; line: number }[];
	/** Per column: how its cells can be edited, or null when derived. */
	editable?: (ColumnEdit | null)[];
	/** Fields the view's row provider offers, for choosing columns. */
	availableFields?: string[];
}

/** How a table column maps back to the model. */
export interface ColumnEdit {
	/** `name`, `shortName`, `doc`, `feature:priority`, `metadata:StatusInfo.status`, … */
	field: string;
	kind: 'text' | 'longText' | 'enum' | 'number' | 'enumList';
	/** Enum literal names, for `enum` and `enumList`. */
	options?: string[];
}

export type NodeKind =
	| 'block'
	| 'port'
	| 'state'
	| 'action'
	| 'decision'
	| 'fork'
	| 'join'
	| 'requirement'
	| 'constraint'
	| 'package'
	| 'initial_state'
	| 'final_state'
	| 'note'
	| 'use_case'
	| 'actor'
	| 'lifeline';

export type EdgeKind =
	| 'composition'
	| 'specialization'
	| 'connection'
	| 'flow'
	| 'transition'
	| 'satisfy'
	| 'verify'
	| 'allocate'
	| 'dependency'
	| 'containment'
	| 'constraint_binding'
	| 'message';

export interface DiagramNode {
	id: string;
	label: string;
	kind: NodeKind;
	stereotype: string | null;
	/** Compartment rows: `[keyword, text]`. */
	attributes: [string, string][];
	is_definition: boolean;
}

export interface DiagramEdge {
	source: string;
	target: string;
	label: string | null;
	kind: EdgeKind;
}

export interface DiagramGraph {
	title: string;
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	subgraphs: { id: string; label: string; node_ids: string[] }[];
	direction: string;
}

/** A source edit, computed by the engine against the current text. */
export type EditRequest =
	| { op: 'insertMember'; path: string; source: string; parent: string; text: string }
	| { op: 'insertTopLevel'; source: string; text: string }
	| { op: 'remove'; path: string; source: string; name: string }
	| { op: 'rename'; path: string; source: string; from: string; to: string }
	| {
			op: 'setField';
			path: string;
			source: string;
			/** Qualified name of the row's element, as in `RenderedTable.sources`. */
			element: string;
			line: number;
			field: string;
			value: string;
	  }
	| { op: 'setTableColumns'; path: string; source: string; view: string; columns: string[] };

export interface EditResult {
	/** Changes in UTF-16 offsets against the source in the request. */
	changes: { from: number; to: number; insert: string }[];
	/** Syntax errors the edit would introduce. */
	syntaxErrors: string[];
}
