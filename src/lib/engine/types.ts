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
	/** UTF-16 offsets into the file (from the toolkit engine; absent from the classic one). */
	from?: number;
	to?: number;
}

export interface Definition {
	kind: string;
	name: string;
	super_type: string | null;
	span: Span;
	parent_def?: string;
	short_name?: string;
	doc?: string;
	is_abstract?: boolean;
	/** The toolkit's element id and qualified name (absent from the classic engine). */
	id?: string;
	qualified_name?: string;
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
	/** The toolkit's element id and qualified name (absent from the classic engine). */
	id?: string;
	qualified_name?: string;
}

/** A `satisfy … by …` or a `verify` inside a verification case. */
export interface TraceLink {
	requirement: string;
	by: string;
	span: Span;
	/** The resolved requirement's element id (toolkit only). */
	requirement_id?: string;
}

/** A `connect a to b` (connection or interface usage), ends as written. */
export interface Connection {
	name: string | null;
	type_ref?: string | null;
	source: string;
	target: string;
	span: Span;
}

/** A `view` or `view def` with its `filter` conditions as written. */
export interface ModelView {
	name: string;
	filters: string[];
	span: Span;
}

export interface MetadataAnnotation {
	metadata_type: string;
	/** `[field, value expression]` pairs, values as written in the source. */
	values: [string, string][];
	target: string;
	span: Span;
	/** The metadata definition's qualified name (toolkit only). */
	metadata_qualified_type?: string;
	/** The annotated element's id (toolkit only). */
	target_id?: string;
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
	connections?: Connection[];
	views?: ModelView[];
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

/** Editor language services (all offsets are UTF-16 into the given file). */
export interface Completion {
	from: number;
	to: number;
	items: {
		label: string;
		kind: 'keyword' | 'definition' | 'usage' | 'package' | 'library' | 'snippet' | string;
		detail?: string;
		documentation?: string;
		insertText?: string;
		isSnippet?: boolean;
	}[];
}

export interface Hover {
	from: number;
	to: number;
	markdown: string;
}

/** Where a name is declared: a project file range, or a standard library line. */
export type DefinitionTarget =
	{ path: string; from: number; to: number } | { library: { path: string; line: number } };

export interface FileRange {
	path: string;
	from: number;
	to: number;
}

export interface FileChange extends FileRange {
	insert: string;
}

export interface OutlineItem {
	name: string;
	kind: string;
	detail?: string;
	from: number;
	to: number;
	selectionFrom: number;
	selectionTo: number;
	children: OutlineItem[];
}

export interface CodeAction {
	title: string;
	diagnosticCode?: string;
	changes: FileChange[];
}

/** The editable parts of an element's declaration (engine `elementDetails`). */
export interface ElementDetails {
	name: string;
	shortName?: string;
	kind: string;
	isDefinition: boolean;
	type?: string;
	conjugated?: boolean;
	specializes: string[];
	redefines?: string;
	multiplicity?: string;
	value?: string;
	valueKind?: 'bind' | 'default' | 'initial';
	direction?: 'in' | 'out' | 'inout';
	abstract?: boolean;
	readonly?: boolean;
	derived?: boolean;
	end?: boolean;
	doc?: string;
	qualifiedName: string;
}

/** Fields to change with `setDeclaration`; null, "", false or [] removes. */
export type DeclarationSet = Partial<
	Omit<ElementDetails, 'name' | 'kind' | 'isDefinition' | 'qualifiedName'>
> & {
	[K in 'type' | 'redefines' | 'multiplicity' | 'value' | 'direction' | 'shortName' | 'doc']?:
		string | null;
};

/** A project read from a `.kpar` or ZIP. */
export interface ProjectArchive {
	info: { name: string; description?: string; version?: string } & Record<string, unknown>;
	files: { path: string; text: string }[];
	/** Entries that are not text (images, binaries), left out. */
	skipped: string[];
	warnings: string[];
}

/** A file of the OMG standard library embedded in the engine. */
export interface LibraryEntry {
	path: string;
	package: string;
	kind: 'kerml' | 'sysml';
	size: number;
}

export interface LibraryHit {
	name: string;
	qualifiedName: string;
	kind: string;
	isDefinition: boolean;
	path: string;
	line: number;
	doc?: string;
}

export interface LibraryLicense {
	spdx: string;
	notice: string;
	source?: string;
	licenseUrl?: string;
}

/** A state machine, ready to draw and to emulate. */
export interface StateMachine {
	name: string;
	qualifiedName?: string;
	file: string;
	line: number;
	doc?: string;
	parallel?: boolean;
	states: {
		/** Path for nested states, e.g. `on.motors.idle`. */
		name: string;
		label: string;
		kind: 'initial' | 'state' | 'final';
		parent?: string;
		parallel?: boolean;
		entry?: string;
		do?: string;
		exit?: string;
		doc?: string;
		line: number;
	}[];
	transitions: {
		name?: string;
		from: string;
		to: string;
		trigger?: string;
		guard?: string;
		effect?: string;
		line: number;
	}[];
	variables: { name: string; type?: string; value?: unknown; direction?: string; doc?: string }[];
	warnings?: string[];
}

export interface SimStep {
	step: number;
	from_state: string;
	transition_name: string | null;
	trigger: string | null;
	guard_result: boolean | null;
	effect: string | null;
	to_state: string;
	exit_action: string | null;
	entry_action: string | null;
}

/** One emulation session: where the machine is and what can happen next. */
export interface StateSession {
	machine: string;
	current: string[];
	step: number;
	variables: Record<string, unknown>;
	trace: SimStep[];
	status: 'running' | 'completed' | 'deadlocked' | 'max steps reached' | string;
	enabled: {
		transition: string;
		index: number;
		from: string;
		to: string;
		trigger?: string;
		guard?: string;
		guardResult?: boolean;
		conditionResult?: boolean;
		ready: boolean;
		reason?: string;
	}[];
	messages?: string[];
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
			/** The whole project, so inserted values find their types in other files. */
			files?: { path: string; text: string }[];
	  }
	| { op: 'setTableColumns'; path: string; source: string; view: string; columns: string[] }
	| {
			op: 'setDeclaration';
			path: string;
			source: string;
			element: string;
			/** 1-based line of the declaration. */
			line: number;
			set: DeclarationSet;
	  };

export interface EditResult {
	/** Changes in UTF-16 offsets against the source in the request. */
	changes: { from: number; to: number; insert: string }[];
	/** Syntax errors the edit would introduce. */
	syntaxErrors: string[];
}
