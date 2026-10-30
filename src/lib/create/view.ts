/**
 * New views: the kinds of view people can make (tables, diagrams, budgets,
 * checks, reports), what each covers, and the SysML view usage that makes
 * it — typed by a view def of the project's `ModelViews` library (or the
 * standard `StandardViewDefinitions`), narrowed by `expose`, as the demo's
 * views are written.
 */
import { docComment, name as sysmlName } from './sysml';

export type ViewGroup = 'tables' | 'diagrams' | 'analysis' | 'reports';

export const GROUP_TITLES: Record<ViewGroup, string> = {
	tables: 'Tables',
	diagrams: 'Diagrams',
	analysis: 'Budgets and checks',
	reports: 'Reports'
};

/** What a kind of view can be about. */
export type Covers =
	/** Packages (their members) or single elements (requirements, parts). */
	| 'packages'
	/** One part of the design (its parts tree). */
	| 'part'
	/** Packages or parts. */
	| 'packagesAndParts'
	| 'state'
	| 'action'
	| 'interaction'
	/** Nothing to choose: the whole model. */
	| 'everything';

export interface ViewKind {
	id: string;
	group: ViewGroup;
	label: string;
	/** One line, in plain words. */
	description: string;
	/** The view def it is typed by (`ModelViews` or `StandardViewDefinitions`). */
	definition: string;
	library: 'ModelViews' | 'StandardViewDefinitions' | 'Reporting';
	covers: Covers;
	/** Whether choosing what it covers is optional (without it: the whole model). */
	optional?: boolean;
	/** At most one element (a diagram drawn from one part or machine). */
	single?: boolean;
	/** A part is exposed with everything nested in it (`::**`), rather than its members (`::*`). */
	tree?: boolean;
	/** It is a table whose columns can be chosen. */
	table?: boolean;
	/** A budget: of which value, chosen in the form. */
	budget?: boolean;
	/** Extra lines of the view's body (`render asTreeDiagram;`). */
	extra?: string[];
	/** The name a new view of this kind starts with. */
	title: string;
}

export const VIEW_KINDS: readonly ViewKind[] = [
	{
		id: 'requirements',
		group: 'tables',
		label: 'Requirements table',
		description: 'Each requirement with its ID, statement, status and what meets it.',
		definition: 'RequirementsTable',
		library: 'ModelViews',
		covers: 'packages',
		optional: true,
		table: true,
		title: 'Requirements'
	},
	{
		id: 'gaps',
		group: 'tables',
		label: 'Requirement gaps',
		description: 'Requirements nothing meets yet, or nothing tests.',
		definition: 'RequirementGaps',
		library: 'ModelViews',
		covers: 'packages',
		optional: true,
		table: true,
		title: 'Requirement gaps'
	},
	{
		id: 'bom',
		group: 'tables',
		label: 'Bill of materials',
		description: 'What a design is made of, with how many of each.',
		definition: 'BillOfMaterials',
		library: 'ModelViews',
		covers: 'part',
		single: true,
		tree: true,
		table: true,
		title: 'Bill of materials'
	},
	{
		id: 'interfaces',
		group: 'tables',
		label: 'Interfaces',
		description: 'Every port, what flows through it and what it connects to.',
		definition: 'InterfaceTable',
		library: 'ModelViews',
		covers: 'packagesAndParts',
		optional: true,
		tree: true,
		table: true,
		title: 'Interfaces'
	},
	{
		id: 'trace',
		group: 'tables',
		label: 'Trace matrix',
		description: 'Requirements down the side, the parts that meet them across the top.',
		definition: 'TraceMatrix',
		library: 'ModelViews',
		covers: 'everything',
		title: 'Trace matrix'
	},
	{
		id: 'verification',
		group: 'tables',
		label: 'Verification matrix',
		description: 'Requirements down the side, the tests that check them across the top.',
		definition: 'VerificationMatrix',
		library: 'ModelViews',
		covers: 'everything',
		title: 'Verification matrix'
	},
	{
		id: 'general',
		group: 'diagrams',
		label: 'General diagram',
		description: 'Boxes and lines: parts, what they are made of and how they relate.',
		definition: 'GeneralView',
		library: 'StandardViewDefinitions',
		covers: 'packagesAndParts',
		tree: true,
		title: 'Structure'
	},
	{
		id: 'interconnection',
		group: 'diagrams',
		label: 'Interconnection diagram',
		description: 'The parts inside one part, with their ports and the connections between them.',
		definition: 'InterconnectionView',
		library: 'StandardViewDefinitions',
		covers: 'part',
		single: true,
		title: 'Connections'
	},
	{
		id: 'states',
		group: 'diagrams',
		label: 'State diagram',
		description: 'The modes something can be in, and what makes it switch.',
		definition: 'StateTransitionView',
		library: 'StandardViewDefinitions',
		covers: 'state',
		single: true,
		title: 'States'
	},
	{
		id: 'actions',
		group: 'diagrams',
		label: 'Action flow diagram',
		description: 'The steps of a process, in order, with decisions and parallel paths.',
		definition: 'ActionFlowView',
		library: 'StandardViewDefinitions',
		covers: 'action',
		single: true,
		title: 'Process'
	},
	{
		id: 'sequence',
		group: 'diagrams',
		label: 'Sequence diagram',
		description: 'Who tells whom what, in time order from top to bottom.',
		definition: 'SequenceView',
		library: 'StandardViewDefinitions',
		covers: 'interaction',
		single: true,
		title: 'Sequence'
	},
	{
		id: 'usecases',
		group: 'diagrams',
		label: 'Use case diagram',
		description: 'What the system does for the people around it, and who takes part in what.',
		definition: 'UseCaseView',
		library: 'ModelViews',
		covers: 'packagesAndParts',
		optional: true,
		title: 'Use cases'
	},
	{
		id: 'budget',
		group: 'analysis',
		label: 'Budget',
		description: 'Adds up a value — mass, power, cost — over the parts of a design.',
		definition: 'MassBudget',
		library: 'ModelViews',
		covers: 'part',
		single: true,
		tree: true,
		budget: true,
		title: 'Budget'
	},
	{
		id: 'checks',
		group: 'analysis',
		label: 'Design checks',
		description: 'Does the design meet its requirements? Each limit, checked against the values.',
		definition: 'ConstraintChecks',
		library: 'ModelViews',
		covers: 'everything',
		table: true,
		title: 'Design checks'
	},
	{
		id: 'specification',
		group: 'reports',
		label: 'Specification',
		description: 'A document of the requirements, with their trace and gaps, to send for review.',
		definition: 'SpecificationDocument',
		library: 'ModelViews',
		covers: 'packages',
		title: 'Specification'
	},
	{
		id: 'icd',
		group: 'reports',
		label: 'Interface control document',
		description: 'A document of how the parts connect: interfaces, ports and what flows.',
		definition: 'InterfaceControlDocument',
		library: 'ModelViews',
		covers: 'packagesAndParts',
		title: 'Interface control document'
	}
];

export function viewKind(id: string): ViewKind | undefined {
	return VIEW_KINDS.find((k) => k.id === id);
}

/** An element a view can cover, as the model tree gives it. */
export interface Target {
	qualifiedName: string;
	/** `package`, `part`, `requirement`, `state`, … */
	kind: string;
	isDefinition: boolean;
}

/** Which elements the kind's picker offers. */
export function canCover(kind: ViewKind, target: Target): boolean {
	const t = target.kind;
	switch (kind.covers) {
		case 'packages':
			return t === 'package' || (t === 'requirement' && !target.isDefinition);
		case 'part':
			return t === 'part' && !target.isDefinition;
		case 'packagesAndParts':
			return t === 'package' || t === 'part';
		case 'state':
			return t === 'state' || t === 'exhibit';
		case 'action':
			return t === 'action' || t === 'perform';
		case 'interaction':
			return t === 'occurrence' || t === 'interaction' || (t === 'part' && target.isDefinition);
		case 'everything':
			return false;
	}
}

/**
 * What `expose` says for a target: a package's members (`P::*`); a part's
 * members, or everything nested in it for a tree (`drone::**`); a single
 * element itself (a requirement, a state machine).
 */
export function exposeFor(kind: ViewKind, target: Target): string {
	const q = target.qualifiedName;
	if (target.kind === 'package')
		return kind.tree && kind.id === 'interfaces' ? `${q}::**` : `${q}::*`;
	if (target.kind === 'part') {
		if (target.isDefinition) return kind.covers === 'interaction' ? q : `${q}::*`;
		return kind.tree ? `${q}::**` : `${q}::*`;
	}
	return q;
}

/** The budget table of a value: the bundled ones for mass and power, else a table of its own. */
export function budgetDefinition(attribute: string): string | null {
	if (attribute === 'mass') return 'MassBudget';
	if (attribute === 'powerDraw') return 'PowerBudget';
	return null;
}

export const BUDGET_COLUMNS = 'path; type; quantity; each; total; share; limit; margin; check';

export interface ViewSpec {
	kind: ViewKind;
	/** The view's name (an identifier, `massBudget`). */
	name: string;
	doc?: string;
	/** What it covers; empty: the whole model. */
	targets: Target[];
	/** Chosen columns of a table, when they differ from its definition's. */
	columns?: string[];
	/** For a budget: the attribute added up. */
	budgetOf?: string;
	/** How the view def and `TableRendering` are spelled where the view is written. */
	spell?: (qualified: string) => string;
}

/** The view usage, as the demo writes its views. */
export function viewText(spec: ViewSpec): string {
	const spell = spec.spell ?? ((q: string) => q);
	const { kind } = spec;
	const lines: string[] = [];
	let definition: string | null = `${kind.library}::${kind.definition}`;
	const rendering: string[] = [];
	if (kind.budget) {
		const attribute = spec.budgetOf ?? 'mass';
		const bundled = budgetDefinition(attribute);
		if (bundled) definition = `ModelViews::${bundled}`;
		else {
			definition = null;
			rendering.push(`rows = "budget:${attribute}";`, `columns = "${BUDGET_COLUMNS}";`);
		}
	}
	if (spec.columns?.length) rendering.push(`columns = "${spec.columns.join('; ')}";`);
	lines.push(`view ${sysmlName(spec.name)}${definition ? ` : ${spell(definition)}` : ''} {`);
	if (spec.doc?.trim()) lines.push(`    ${docComment(spec.doc)}`);
	if (rendering.length)
		lines.push(`    @${spell('Reporting::TableRendering')} { ${rendering.join(' ')} }`);
	const exposes = [...new Set(spec.targets.map((t) => exposeFor(kind, t)))];
	for (const e of exposes) lines.push(`    expose ${e};`);
	for (const e of kind.extra ?? []) lines.push(`    ${e}`);
	lines.push('}');
	return lines.join('\n');
}

/** What is wrong with the choices, in plain words, or null. */
export function viewProblem(spec: {
	kind: ViewKind | undefined;
	title: string;
	targets: Target[];
	taken: ReadonlySet<string>;
	name: string;
}): string | null {
	if (!spec.kind) return 'Choose what kind of view to make.';
	if (!spec.title.trim()) return 'Give the view a name.';
	if (spec.taken.has(spec.name))
		return `There is already a view called “${spec.title.trim()}”. Choose another name.`;
	const k = spec.kind;
	if (k.covers !== 'everything' && !k.optional && !spec.targets.length)
		return `Choose ${coverPrompt(k).toLowerCase()}`;
	if (k.single && spec.targets.length > 1)
		return `A ${k.label.toLowerCase()} shows one element: choose one.`;
	return null;
}

/** The question the "what it covers" step asks. */
export function coverPrompt(kind: ViewKind): string {
	switch (kind.covers) {
		case 'packages':
			return 'Which packages or requirements it lists.';
		case 'part':
			return kind.budget
				? 'Which design to add up (a part with parts).'
				: 'Which part of the design it shows.';
		case 'packagesAndParts':
			return kind.single ? 'Which part it shows.' : 'Which packages or parts it shows.';
		case 'state':
			return 'Which state machine it shows.';
		case 'action':
			return 'Which process (action) it shows.';
		case 'interaction':
			return 'Which interaction it shows.';
		case 'everything':
			return 'It covers the whole model.';
	}
}
