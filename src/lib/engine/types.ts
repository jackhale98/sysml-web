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
	/** The resolved element that satisfies or verifies it (toolkit only). */
	by_id?: string;
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
	| 'general'
	| 'interconnection'
	| 'requirements'
	| 'states'
	| 'packages'
	| 'trace'
	| 'actions'
	| 'sequence';

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
	/**
	 * The standard view it comes down to (`GeneralView`, `InterconnectionView`…)
	 * when it is typed by a view def of the project's that specializes one.
	 */
	standard?: string;
	doc?: string;
	renderAs?: string;
	/** The `expose` targets as written (`P`, `P::*`, `P::**`). */
	exposes?: string[];
	/** From a library the engine bundles, not from the project's files. */
	builtin: boolean;
	/** Whether a `@MatrixRendering` applies: the view is a dependency matrix (DSM) of these elements. */
	matrix?: MatrixElements;
}

/** What a dependency matrix's rows and columns are. */
export type MatrixElements = 'parts' | 'actions' | 'requirements';

/** A relationship a dependency matrix can count, read from the row's element to the column's. */
export type DependencyKind =
	| 'connection'
	| 'flow'
	| 'binding'
	| 'allocation'
	| 'typing'
	| 'satisfy'
	| 'succession'
	| 'derivation'
	| 'refinement';

/**
 * A view as a dependency matrix (`@MatrixRendering`, docs/dsm.md): the
 * elements it exposes, in model order, and every link between them of
 * the kinds this kind of matrix offers; the view's settings say which of
 * them count and how to order and show them.
 */
export interface DependencyMatrix {
	view: string;
	elements: MatrixElements;
	/** The kinds of link the view counts (its `dependencies`). */
	kinds: DependencyKind[];
	/** The kinds this kind of matrix offers, in the order to show them. */
	available: DependencyKind[];
	order: 'model' | 'clustered';
	cells: 'marks' | 'names';
	/** What the parts are of, when the view exposes one element's (`drone`). */
	scope: string | null;
	items: MatrixItem[];
	/** Links of every available kind (not only the counted ones), so a choice shows at once. */
	links: MatrixLink[];
	/** Each item's links to elements the matrix doesn't list, by kind (`binding` to the drone itself). */
	outside: { item: number; kind: DependencyKind; direction: 'out' | 'in'; name: string }[];
	warnings: string[];
}

export interface MatrixItem {
	/** The element's id: an inherited part (`frontLeft.esc`) is its definition's feature. */
	id: string;
	name: string;
	qualifiedName: string;
	/** Its short name: a requirement's ID (`SYS-001`). */
	shortName?: string;
	/** The path from what the matrix is of (`frontLeft.esc`), for a nested part. */
	path: string;
	kind: string;
	/** Its definition's name (`Battery`), for a usage. */
	type: string | null;
	/** How deep below the matrix's scope (0 for its direct members). */
	depth: number;
	/** The item it is nested in, by index. */
	parent: number | null;
	/** Given by a definition (a rotor's `esc`, written in `Rotor`), not written in what it is listed under. */
	inherited?: boolean;
	file: string;
	start: number;
	end: number;
}

export interface MatrixLink {
	from: number;
	to: number;
	kind: DependencyKind;
	/** Connections and bindings go both ways: the cell (to, from) shows them too. */
	mutual: boolean;
	/** The connection's, flow's or feature's name, when it has one. */
	name?: string;
	/** What types it: the interface or connection definition. */
	definition?: string;
	/** What passes: a flow's item. */
	item?: string;
	/**
	 * What an interface carries, from its definition's own flows: each item,
	 * and whether it goes from the first end written to the second.
	 */
	carries?: { item: string; forward: boolean }[];
	/** Its ends as written (`battery.powerOut`), for a connector. */
	ends?: [string, string];
	/** The element that states it, by id, when it has one (the inspector shows it). */
	element?: string;
	/** Where it is written. */
	file: string;
	start: number;
	end: number;
}

/** A view rendered as a table by the engine. */
export interface RenderedTable {
	view: string;
	columns: string[];
	/** Per column, as the view writes it (`rpn = Rpn(severity, likelihood, detection)`), to save a choice of columns. */
	columnSpecs?: string[];
	rows: string[][];
	warnings: string[];
	/**
	 * Parallel to `rows` (empty for a pivot): the element behind each row,
	 * and (`byte`) where in its file the row's subject is written, when that
	 * is a statement rather than an element (a `satisfy`, a constraint).
	 */
	sources: {
		element: string;
		file: string;
		line: number;
		byte?: number;
		/** For a row of a metadata annotation (`@Fmea about x { … }`): the annotation's element id. */
		annotation?: string;
	}[];
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
	/** For a trade study table (`rows = "trade"`): the study, evaluated. */
	trade?: TradeStudy;
	/**
	 * For a traceability matrix (`rows = "relation:satisfy"` or `"relation:verify"`,
	 * `pivot = "requirement; by"`): the requirements, the elements and the links
	 * behind the grid. `rows` and `columns` stay the grid (a requirement per row,
	 * `1` where a link is), for export and search.
	 */
	matrix?: TraceMatrix;
	/**
	 * For rows of metadata annotations (`rows = "@Fmea"`): the metadata def
	 * (qualified), and the package new annotations go in (the one the view
	 * exposes, else the one most rows are written in).
	 */
	annotations?: { metadata: string; package: string | null };
	/**
	 * For a pivot whose two fields are bounded scales (FMEA ratings): a grid
	 * of counts with every value of each scale, `rows` down and `columns`
	 * across (the risk matrix).
	 */
	counts?: {
		rows: string;
		columns: string;
		/**
		 * With a `cellLevel` (the risk matrix's `Acceptability(severity,
		 * likelihood)`): each cell's level, parallel to `rows` without their
		 * first cell, and the levels in order, lowest first.
		 */
		levels?: string[][];
		levelValues?: string[];
	};
	/**
	 * Per column whose values are an enum's literals (a field declared with
	 * an enum, a calc that returns one): the literals in the order declared,
	 * lowest first, for sorting and filtering by level.
	 */
	columnLevels?: (Levels | null)[];
}

/** Values in an order: an enum's literals as declared, lowest first. */
export interface Levels {
	/** The enum def's name (`ActionPriorityLevel`), or '' for levels the app names (a control status). */
	enum: string;
	values: string[];
}

/**
 * Requirements down the side (every requirement in scope, linked or not, so
 * gaps show), what satisfies or verifies them across the top.
 */
export interface TraceMatrix {
	relation: 'satisfy' | 'verify';
	/** Parallel to `rows`. */
	requirements: {
		/** The short name (`SYS-001`), or ''. */
		id: string;
		title: string;
		/** The toolkit's element id, when the requirement resolves. */
		elementId: string | null;
	}[];
	/** Parallel to `columns.slice(1)`: what satisfies or verifies, as written there. */
	elements: {
		/** As written in the `satisfy … by` or verification (`drone.flightController`). */
		written: string;
		/** Its declared name (`flightController`). */
		name: string;
		/** What comes before the name as written (`['drone']`). */
		path: string[];
		qualifiedName: string;
		/** The toolkit's element id, when it resolves. */
		elementId: string | null;
		/** Its kind (`part`, `verification`, …), when it resolves. */
		kind: string | null;
	}[];
	/** One per relationship, by index into `requirements` and `elements`. */
	links: {
		row: number;
		column: number;
		/** Where the `satisfy` or `verify` is written (bytes). */
		file: string;
		line: number;
		start: number;
		end: number;
	}[];
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
	/** What is wrong with a cell's value, by column index (a rating outside its scale). */
	problems?: Record<number, string>;
	/** For an FMEA line: the risk controls it names, with their traceability. */
	controls?: LineControl[];
	/** For an FMEA line: its mitigations, with their status. */
	mitigations?: LineMitigation[];
}

/** A risk control an FMEA line names (`riskControls`), with what satisfies and verifies it. */
export interface LineControl {
	/** `RC-001 Battery thermal protection`. */
	label: string;
	/** The requirement's qualified name. */
	element: string;
	satisfiedBy: string[];
	verifiedBy: string[];
}

/** A mitigation of an FMEA line: one it names, or one that implements one of its controls. */
export interface LineMitigation {
	name: string;
	/** Its qualified name. */
	element: string;
	/** Its status literal (`inProgress`), or ''. */
	status: string;
	/** Whether the line names it (else it implements one of the line's controls). */
	named: boolean;
}

/** One FMEA line about an element, for its details. */
export interface FmeaLineInfo {
	/** Where its `@Fmea` annotation is written. */
	file: string;
	line: number;
	failureMode: string;
	category: string;
	severity: string;
	likelihood: string;
	detection: string;
	/** The ratings before risk reduction, when the line has them. */
	before: { severity: string; likelihood: string; detection: string } | null;
	/** Calculated by the library's calcs ('' when it lacks one). */
	rpn: string;
	rpnBand: string;
	actionPriority: string;
	acceptability: string;
	acceptabilityBefore: string;
	/** The hazard it can lead to, as written. */
	hazard: string;
	controls: LineControl[];
	mitigations: LineMitigation[];
	/** Why the line needs review, in plain words, or null. */
	review: string | null;
}

/**
 * The project's risk policy, as its risk library states it: the zone the
 * `Acceptability` calc gives each severity and likelihood, the thresholds
 * of `RpnBand`, and which figure the worksheets lead with.
 */
export interface RiskPolicy {
	/** `zones[severity - 1][likelihood - 1]`, or null when the library has no `Acceptability`. */
	zones: string[][] | null;
	/** The zones in order, lowest first. */
	zoneLevels: string[];
	/** The thresholds: each `<level>From` attribute of `RpnBand`, in order. */
	bands: { name: string; level: string; value: number }[];
	/** The bands in order, lowest first. */
	bandLevels: string[];
	/** What `FmeaWorksheet` sorts by first, or null when the library has none. */
	lead: 'rpn' | 'actionPriority' | null;
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
	/** Set when the verdict rests on a value the app added up (`evaluation.ts`). Internal, not shown. */
	byApp?: string;
	/** How the problems list words it when violated, when the check says it best itself. */
	problem?: string;
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
	| {
			kind: 'number';
			value: number;
			unit: string | null;
			/**
			 * Set when the app added up a collection of parts the engine leaves
			 * undecided (`evaluation.ts`): which. Internal, not shown.
			 */
			byApp?: string;
	  }
	| { kind: 'text'; text: string }
	| { kind: 'none' }
	| { kind: 'undecided'; reason: string };

// ---- Trade studies ---------------------------------------------------------------

/**
 * A trade study (an analysis typed by `TradeStudies::TradeStudy`),
 * evaluated: each alternative's criteria and score, the alternative its
 * objective selects, and the one the design uses today.
 */
export interface TradeStudy {
	name: string;
	qualifiedName: string;
	elementId: string;
	file: string;
	/** 1-based line of its declaration. */
	line: number;
	/** What the objective asks for: the highest score, the lowest, or unknown (another objective). */
	objective: 'maximize' | 'minimize' | null;
	alternatives: TradeAlternative[];
	/** The evaluation function's attributes, in declaration order. */
	criteria: TradeCriterion[];
	/** The alternative the objective selects; null on a tie, with scores missing, or without an objective. */
	selected: number | null;
	/** The alternatives with the best score (several on a tie). */
	best: number[];
	/** The alternative the design uses today (a part of the design, or bound to by one). */
	current: number | null;
	/** Why nothing is selected, in plain words. */
	note: string | null;
	/** What the app worked out because the engine doesn't yet (internal, not shown). */
	byApp?: string;
}

export interface TradeAlternative {
	/** As the study's subject writes it (`drone.battery`, `batteryOptions::lithiumPolymer`). */
	label: string;
	/** For headings: the last name of the label (`lithiumPolymer`), unless two would read alike. */
	name: string;
	qualifiedName: string;
	elementId: string | null;
	file: string | null;
	line: number;
	doc: string | null;
	/** The evaluation function's result for it. */
	score: Evaluated;
	/** 1 for the best score; equal scores share a rank. */
	rank: number | null;
}

export interface TradeCriterion {
	name: string;
	elementId: string | null;
	file: string;
	line: number;
	doc: string | null;
	/** Each alternative's value, in the order of `alternatives`. */
	values: Evaluated[];
	/** The values as shown, in one unit (empty when unknown). */
	shown: string[];
	/** The weight the score gives it (0.5 for half), when the score is a weighted sum. */
	weight: number | null;
	/** Each alternative's score on this criterion before weighting, when the score has one. */
	scores: (number | null)[] | null;
	/** Whether a higher or a lower value is better, by the objective; null when the score doesn't read it directly. */
	better: 'higher' | 'lower' | null;
	/** The alternatives with the best value (empty when all are equal or `better` is unknown). */
	best: number[];
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
		/** A `terminate` action (`action stop terminate;`): reaching it ends the whole machine. */
		terminate?: boolean;
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
		/** The name the accepted signal is given (`accept r : Reading` → `r`), for guards and effects that read it. */
		payload?: string;
		guard?: string;
		effect?: string;
		line: number;
	}[];
	variables: { name: string; type?: string; value?: unknown; direction?: string; doc?: string }[];
	/** The part the machine belongs to (an `exhibit state` in a part): a signal sent to it is sent to the machine. */
	owner?: string;
	/**
	 * The attributes of the signals the machine accepts or sends, by the
	 * signal's name as written, in declaration order, with their defaults.
	 */
	signals?: Record<string, { name: string; type?: string; value?: unknown }[]>;
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
	/** Simulated time of the step, in seconds since the start. */
	time?: number;
	/** The `do` actions of the states entered, started after their entry actions. */
	do_action?: string | null;
	/** The `do` actions still running in the states exited, stopped before their exit actions. */
	do_stopped?: string | null;
	/** What the step could not do, such as a time trigger whose duration cannot be worked out. */
	notes?: string[];
	/** Why it fired, in a sentence: the event, the condition that turned true, the timer that came due. */
	cause?: string;
	/** The values the guard and condition read when the step was decided (variables and signal values). */
	reads?: Record<string, unknown>;
	/** Transitions that were ready too and gave way to this one. */
	preempted?: string[];
}

/** One emulation session: where the machine is and what can happen next. */
export interface StateSession {
	machine: string;
	current: string[];
	step: number;
	variables: Record<string, unknown>;
	trace: SimStep[];
	status: 'running' | 'completed' | 'deadlocked' | 'max steps reached' | string;
	/** Simulated time, in seconds since the start. */
	time?: number;
	/** When each active state was entered, in seconds since the start. */
	entered?: Record<string, number>;
	/**
	 * The time triggers of the active states, by transition index: when it is
	 * due (seconds since the start), or why it will not fire this time.
	 */
	timers?: Record<string, number | string>;
	/** Active states whose `do` action is still running. */
	doing?: string[];
	/** Signals the machine sent to itself, waiting to be taken, oldest first. */
	queue?: { signal: string; values?: Record<string, unknown>; from?: string }[];
	/**
	 * The change triggers of the active states, by transition index: `false`
	 * while the condition is false, `true` once its signal came and waits to
	 * be taken, or why that signal was lost.
	 */
	changes?: Record<string, boolean | string>;
	/** The machine reached a `terminate` action. */
	terminated?: boolean;
	enabled: {
		transition: string;
		index: number;
		from: string;
		to: string;
		trigger?: string;
		guard?: string;
		guardResult?: boolean;
		conditionResult?: boolean;
		/** For a time trigger: when it is due, in seconds since the start. */
		due?: number;
		/** Its signal was sent by the machine and waits: a Step takes it. */
		queued?: boolean;
		ready: boolean;
		reason?: string;
	}[];
	messages?: string[];
}

/** How two elements are related, as the model says it. */
export type RelationKind =
	| 'specializes'
	| 'typed'
	| 'satisfies'
	| 'verifies'
	| 'connects'
	| 'binds'
	| 'flows'
	| 'allocates'
	| 'derives';

/** An element related to another, and how (`EngineApi.related`). */
export interface RelatedElement {
	kind: RelationKind;
	/** `out`: the element says it (it specializes, satisfies… the other); `in`: the other does. */
	direction: 'out' | 'in';
	element: {
		id: string;
		name: string;
		qualifiedName: string | null;
		kind: string;
		isDefinition: boolean;
		file: string;
		start_byte: number;
	};
	/** The connection, flow or allocation that relates them, when it has a name. */
	via?: string;
}

/**
 * What the guided forms (`#lib/create`) need to know about an element: what
 * it is one of, how to refer to it, and its features — its own and those
 * its definition and supertypes give it — with their values.
 */
export interface ElementFeatures {
	id: string;
	name: string;
	qualifiedName: string;
	kind: string;
	isDefinition: boolean;
	/** The definitions it is one of, nearest first (qualified): its type and their supertypes, or itself and its supertypes. */
	kinds: string[];
	/**
	 * How to refer to it from another package: import `imports` (a package's
	 * member, qualified), then write `text` (`drone.battery`,
	 * `batteryOptions::lithiumPolymer`). Null for a package.
	 */
	reference: { imports: string; text: string } | null;
	/** For a definition: the project's usages typed by it (qualified names). */
	usedBy: string[];
	features: FeatureInfo[];
}

export interface FeatureInfo {
	/** Unquoted. */
	name: string;
	/** As SysML writes it (quoted when needed). */
	written: string;
	/** `attribute`, `part`, `item`, `port`, `subject`, … */
	kind: string;
	/** Whether the element declares or redefines it itself. */
	own: boolean;
	/** The record that declares it nearest (the element's own when `own`). */
	id: string;
	/** The definition that declares it, when it is not the element's own. */
	declaredBy: string | null;
	/** Where it is first declared (qualified): the element itself, or a definition it redefines it from. */
	declaredIn: string | null;
	/** For a part, item or subject: its type (qualified) and the type's id. */
	type: string | null;
	typeId: string | null;
	/** `ref part` (counted where it is owned, not here). */
	ref: boolean;
	/** A `variation`: alternatives, not part of the design. */
	variation: boolean;
	multiplicity: string | null;
	/** The value as written, own or inherited (null when none is given). */
	value: string | null;
	/** For an attribute: the simple name of its value type (`MassValue`, `Real`, `RotorSpin`). */
	valueType: string | null;
	/** Whether it holds a number (a quantity or a Real, Integer, …). */
	numeric: boolean;
	/** For an attribute: its value in this element, evaluated. */
	evaluated: Evaluated | null;
}

/** How a table column maps back to the model. */
/** One of a usage's attribute values, as the inspector edits it. */
export interface FeatureValue {
	name: string;
	/** As written: the usage's own `:>> name = …`, else what its type gives (or null). */
	value: string | null;
	/** Whether the usage sets it itself. */
	own: boolean;
	/** The definition that declares it, when it is not the usage's own attribute. */
	declaredBy: string | null;
	/**
	 * How to edit it (`feature:<name>` with `setField`), or null when it
	 * can't be here: an expression is edited on the attribute itself.
	 */
	edit: ColumnEdit | null;
	/** The usage's own attribute element, when it sets it itself. */
	elementId?: string;
}

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
	/**
	 * Interconnection views: the border side of a port without a direction,
	 * by its row text, from how its connections run.
	 */
	port_sides?: Record<string, 'left' | 'right'>;
}

export interface DiagramEdge {
	source: string;
	target: string;
	label: string | null;
	kind: EdgeKind;
	/**
	 * Where the element the edge draws is declared: a sequence view's messages,
	 * and the transitions and successions of state and action views (with the
	 * end of their statement, so a diagram can change or remove it).
	 */
	element?: { file: string; start_byte: number; end_byte?: number };
	/** Sequence views: the message an edge draws (edges come in time order). */
	message?: SequenceMessage;
}

/** A message of a sequence view: `message name of Payload from a.sent to b.received`. */
export interface SequenceMessage {
	name: string | null;
	/** The payload's type (or the payload as written when untyped). */
	payload: string | null;
	doc: string | null;
	/** The event occurrences at its ends, when it is sent and received through them. */
	sourceEvent?: string;
	targetEvent?: string;
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
	/** Set one value of a view's own rendering metadata (`@MatrixRendering { order = "clustered"; }`), adding it when the view has none. */
	| {
			op: 'setViewMetadata';
			view: string;
			id?: string;
			metadata: string;
			field: string;
			value: string;
	  }
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
