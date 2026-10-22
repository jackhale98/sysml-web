/**
 * Semantic diff: one version of the model as the comparison reads it (a
 * `ModelSnapshot`, made in the engine worker from the toolkit's model), and
 * what changed between two of them (a `ModelDiff`). Plain data, so it
 * crosses the worker boundary and is easy to build by hand in tests.
 */
import type { CheckStatus } from '#lib/engine/types.ts';

/** How an engineer groups changes. */
export type Category = 'requirements' | 'design' | 'behaviour' | 'verification' | 'risk' | 'other';

/** Where something is written: file, 1-based line and UTF-16 offsets of its whole text. */
export interface Location {
	path: string;
	line: number;
	from: number;
	to: number;
}

/** A named element of one version. */
export interface SnapElement extends Location {
	/** The toolkit's element id (derived from the qualified name, see docs/engine.md). */
	id: string;
	/** The name as written (quoted when needed). */
	name: string;
	qualifiedName: string;
	/** The name as people read it (`Noise at night`). */
	title: string;
	/** A feature path people read: `Motor.mass`, `drone.battery`, `SYS-003` (no packages). */
	label: string;
	/** The app's kind (`part`, `attribute`, `requirement`, …). */
	kind: string;
	isDefinition: boolean;
	/** The nearest named element it is in. */
	ownerId: string | null;
	category: Category;
	/**
	 * What it says about itself, as people read it, by property: `type`,
	 * `multiplicity`, `value`, `specializes`, `redefines`, `direction`,
	 * `doc`, `shortName`, `abstract`, `constraint`, and `metadata:<Type>.<field>`
	 * (a requirement's status, an FMEA line's ratings). Only those set.
	 */
	props: Record<string, string>;
	/** Its text with its name taken out, whitespace collapsed: what renames and moves are matched by. */
	body: string;
}

export type RelationKind =
	| 'satisfy'
	| 'verify'
	| 'allocate'
	| 'connect'
	| 'interface'
	| 'flow'
	| 'bind'
	| 'derive'
	| 'succession'
	| 'transition'
	| 'other';

/** An unnamed element that relates others: a `satisfy`, `connect`, `flow`, `allocate`, … */
export interface SnapRelation extends Location {
	kind: RelationKind;
	/** The named element it is written in. */
	ownerId: string | null;
	/** Element ids it refers to (resolved by the engine), matched through renames. */
	refs: string[];
	/** What it says, as written (names), whitespace collapsed: matched with renames substituted. */
	key: string;
	/** For people: `'Flight endurance' by drone`, `esc to motor`. */
	text: string;
	category: Category;
}

/** A requirement check (a `satisfy` claim, a requirement's constraint, an `assert`). */
export interface SnapCheck extends Location {
	kind: 'satisfy' | 'require' | 'assert';
	/** The requirement's id, matched through renames. */
	requirementId: string | null;
	/** `SYS-003`, or the assertion's name or constraint. */
	label: string;
	/** The requirement's name as people read it (`Maximum take-off mass`). */
	title: string | null;
	/** What claims to satisfy it, as written (`drone`). */
	by: string | null;
	/** The value its constraint compares with a limit (`drone.takeOffMass`). */
	subject: string | null;
	status: CheckStatus;
	/** Why, briefly: `4.05 kg > 4 kg`. */
	reason: string | null;
	/** How far inside the limit, as people read it (`380 g`), when it has one. */
	margin: string | null;
}

/** A budget table's grand total. */
export interface SnapBudget {
	/** The view's name. */
	view: string;
	/** `Drone mass budget`. */
	title: string;
	/** What it adds up (`drone`). */
	root: string;
	total: string;
}

/** One version of the model. */
export interface ModelSnapshot {
	elements: SnapElement[];
	relations: SnapRelation[];
	checks: SnapCheck[];
	budgets: SnapBudget[];
	/** Evaluated attribute values, by element id, as people read them (`3.62 kg`). */
	values: Record<string, string>;
	/** Files with syntax errors (their broken parts are left out of the comparison). */
	brokenFiles: string[];
}

// ---- What changed ------------------------------------------------------------

export type ChangeKind = 'added' | 'removed' | 'renamed' | 'moved' | 'changed';

export interface PropertyChange {
	property: string;
	before: string | null;
	after: string | null;
}

/** The element on one side of a change. */
export interface ElementSide extends Location {
	id: string;
	label: string;
	title: string;
	qualifiedName: string;
	/** The label of the element it is in. */
	owner: string | null;
}

export interface ElementChange {
	/** Renamed or moved elements can also have changed properties. */
	change: ChangeKind;
	category: Category;
	kind: string;
	isDefinition: boolean;
	shortName: string | null;
	before?: ElementSide;
	after?: ElementSide;
	properties: PropertyChange[];
	/** What came or went with an added or removed element (its members, the relations in it). */
	members: string[];
}

export interface RelationChange {
	change: 'added' | 'removed';
	relation: RelationKind;
	category: Category;
	text: string;
	/** The label of the element it is written in. */
	owner: string | null;
	/** That element's id in the new version, when it is there. */
	ownerId: string | null;
	at: Location;
	/** Ids (on its side) of the elements it refers to. */
	refs: string[];
}

/** A check whose verdict changed (or a new check that fails). */
export interface VerdictChange {
	label: string;
	title: string | null;
	by: string | null;
	subject: string | null;
	requirementId: string | null;
	before: CheckStatus | null;
	after: CheckStatus | null;
	beforeReason: string | null;
	afterReason: string | null;
	/** The check's verdict didn't change, but how close it is to its limit did. */
	marginBefore: string | null;
	marginAfter: string | null;
	at: Location | null;
}

/** A computed value that changed though its own expression didn't. */
export interface ValueChange {
	id: string;
	label: string;
	before: string;
	after: string;
	at: Location;
}

export interface BudgetChange {
	view: string;
	title: string;
	root: string;
	before: string | null;
	after: string | null;
}

export interface ModelDiff {
	elements: ElementChange[];
	relations: RelationChange[];
	verdicts: VerdictChange[];
	values: ValueChange[];
	budgets: BudgetChange[];
	/** Files that didn't parse in either version (a note for the reader). */
	brokenFiles: string[];
}

/** The engine's answer to `compareModels`. */
export interface ModelComparison {
	diff: ModelDiff;
	/** Time in the worker, ms: analysing the base (0 when cached), the current version, and the diff. */
	ms: { base: number; current: number; diff: number };
}
