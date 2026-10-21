/**
 * The shapes the engine's calls return (`EngineApi`), built from the
 * sysml-toolkit's model by the adapter in `toolkit/` (docs/engine.md).
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
	/** UTF-16 offsets into the file, which the editor prefers (absent where only bytes are known). */
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
	/** The toolkit's element id and qualified name. */
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
	/** The toolkit's element id and qualified name. */
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
	/**
	 * Parallel to `rows` (empty for a pivot): the element behind each row,
	 * and (`byte`) where in its file the row's subject is written, when that
	 * is a statement rather than an element (a `satisfy`, a constraint).
	 */
	sources: { element: string; file: string; line: number; byte?: number }[];
	/** Per column: how its cells can be edited, or null when derived. */
	editable?: (ColumnEdit | null)[];
	/** Fields the view's row provider offers, for choosing columns. */
	availableFields?: string[];
	/** Per column, how its values read, when the row provider says (else guessed from the values). */
	columnKinds?: (ColumnKind | null)[];
	/** Parallel to `rows`, when the provider says more about them (a tree's depth, a total). */
	rowInfo?: RowInfo[];
	/** Opening a row shows where it is written in the text (rather than selecting its element). */
	opensText?: boolean;
}

/**
 * How a column's values read: `quantity` (a number with its unit, right
 * aligned), `number`, `percent`, `check` (a verdict: satisfied, violated or
 * undecided), `tree` (a path, indented by the row's depth), `text`.
 */
export type ColumnKind = 'quantity' | 'number' | 'percent' | 'check' | 'tree' | 'text';

export interface RowInfo {
	/** Depth in a tree (0 for a root). */
	depth?: number;
	/**
	 * `rollup`: the row's value is the sum of the rows under it (it has none
	 * of its own); `total`: a total of the table; `attribute`: a value of the
	 * root that the parts don't add up to (a limit, a payload).
	 */
	role?: 'rollup' | 'total' | 'attribute';
	/** Why a cell is empty or undecided, by column index. */
	notes?: Record<number, string>;
}

// ---- Constraint checks and evaluated values ----------------------------------

export type CheckStatus = 'satisfied' | 'violated' | 'undecided';

/** A value a check depends on, as the engine evaluated it. */
export interface CheckValue {
	/** The feature as written in the constraint (`drone.endurance`). */
	feature: string;
	/** Its value, when known. */
	value: Evaluated;
}

/**
 * One claim the model makes that can be checked: a `satisfy R by x` (R's
 * constraints, with R's subject bound to x), a requirement's constraint
 * that nothing claims to satisfy yet, or an `assert constraint`.
 */
export interface Check {
	kind: 'satisfy' | 'require' | 'assert';
	status: CheckStatus;
	/** Whether there is anything to evaluate (a requirement in words only has not). */
	checkable: boolean;
	/** The engine's verdict line, as it words it. */
	detail: string;
	/** What the verdict means, in plain language. */
	explanation: string;
	/** The requirement, for `satisfy` and `require`. */
	requirement: {
		name: string;
		qualifiedName: string;
		/** Its short name (`SYS-001`). */
		id: string | null;
		elementId: string | null;
	} | null;
	/** What claims to satisfy it, as written (`drone`, `drone.battery`). */
	by: string | null;
	/** The constraint expressions, as written (several joined by `; `). */
	constraint: string;
	/** For an `assert constraint`, its name (if any) and owner. */
	name: string | null;
	values: CheckValue[];
	/**
	 * For a constraint that compares one value with a limit (`x <= 4 [kg]`):
	 * the limit, and how far the value is inside it (negative: outside), in
	 * the limit's unit, with `ratio` = margin / limit.
	 */
	limit?: { feature: string; operator: string; value: number; unit: string | null };
	margin?: { value: number; unit: string | null; ratio: number | null };
	/** Where the claim is written: the `satisfy` statement, or the constraint. */
	file: string;
	span: Span;
	/** Where the constraint is written, when that is elsewhere (a `satisfy`'s requirement). */
	constraintAt?: { file: string; span: Span };
}

export interface CheckReport {
	checks: Check[];
	summary: { satisfied: number; violated: number; undecided: number };
	/** How long verifying took in the worker, ms. */
	ms: number;
}

/**
 * An element's bound value as the engine evaluated it: a number (with its
 * unit, or null for a plain number), something else as text (a boolean, a
 * string, an enum literal's name, a list), nothing (`none`: no value bound)
 * or why it could not (`undecided`).
 */
export type Evaluated =
	| { kind: 'number'; value: number; unit: string | null }
	| { kind: 'text'; text: string }
	| { kind: 'none' }
	| { kind: 'undecided'; reason: string };

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
	Pick<
		ElementDetails,
		'conjugated' | 'specializes' | 'valueKind' | 'abstract' | 'readonly' | 'derived' | 'end'
	>
> & {
	type?: string | null;
	redefines?: string | null;
	multiplicity?: string | null;
	value?: string | null;
	direction?: 'in' | 'out' | 'inout' | null;
	shortName?: string | null;
	doc?: string | null;
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
	| 'binding'
	| 'typing'
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
	/** Where the element the node draws is declared (absent for pseudo states and control nodes). */
	element?: { file: string; start_byte: number };
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

/**
 * A source edit, computed by the engine against the current text of `path`
 * (`source`). Elements are named by their id from the analysis when it is
 * known, else by their name as written (simple or qualified) and the 1-based
 * line of their declaration.
 */
export type EditRequest = EditOperation & {
	path: string;
	source: string;
	/** The whole project (the workspace adds it), so names resolve across files. */
	files?: { path: string; text: string }[];
};

export type EditOperation =
	| { op: 'insertMember'; parent: string; parentLine?: number; parentId?: string; text: string }
	| { op: 'insertTopLevel'; text: string }
	| { op: 'remove'; name: string; line?: number; id?: string }
	/** Rename an element and every reference to it, in every file. */
	| { op: 'rename'; from: string; to: string; line?: number; id?: string }
	| {
			op: 'setField';
			/** Qualified name of the row's element, as in `RenderedTable.sources`. */
			element: string;
			line: number;
			id?: string;
			field: string;
			value: string;
	  }
	| { op: 'setTableColumns'; view: string; columns: string[] }
	| {
			op: 'setDeclaration';
			element: string;
			/** 1-based line of the declaration. */
			line: number;
			id?: string;
			set: DeclarationSet;
	  };

export interface EditResult {
	/** Changes in UTF-16 offsets against the source in the request. */
	changes: { from: number; to: number; insert: string }[];
	/** Changes to other files (a rename's references), against their texts in the request's `files`. */
	otherFiles?: FileChange[];
	/** Syntax errors the edit would introduce (it is not made then). */
	syntaxErrors: string[];
	/** What the person should know about an edit that was made: references it left unresolved. */
	warning?: string;
}
