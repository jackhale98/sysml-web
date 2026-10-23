/**
 * How a SysML view is presented: views with a `@TableRendering` are tables
 * the engine renders; the standard diagram views (SysML v2 clause 9.2.20)
 * are drawn from what they expose (a general view from the view usage
 * itself, so its filters apply; the others from the element it exposes).
 */
import type { DiagramView, ViewInfo } from '#lib/engine/types.ts';

export type Presentation =
	| { kind: 'table' }
	| { kind: 'matrix' }
	| { kind: 'diagram'; view: DiagramView; scope: string | null }
	| { kind: 'none' };

/** `DroneArchitecture::drone::*` → `drone`; quotes removed. */
export function exposedName(expose: string): string {
	const path = expose.replace(/::\*\*?$/, '');
	const last = path.split('::').pop() ?? path;
	return last.replace(/^'|'$/g, '');
}

/** A view with no view def, drawn by how it says to render: `render asTreeDiagram;`. */
const RENDERED_AS: Record<string, string> = {
	asTreeDiagram: 'GeneralView',
	asInterconnectionDiagram: 'InterconnectionView'
};

export function presentationOf(view: ViewInfo): Presentation {
	if (view.matrix) return { kind: 'matrix' };
	if (view.hasTable) return { kind: 'table' };
	if (!view.isUsage) return { kind: 'none' };
	const exposes = view.exposes ?? [];
	const scope = exposes.length === 1 ? exposedName(exposes[0]!) : null;
	switch (view.standard ?? view.definition ?? RENDERED_AS[view.renderAs ?? '']) {
		case 'GeneralView':
			// The view itself is the scope: the engine draws what it exposes, filtered.
			if (exposes.length && !view.builtin)
				return { kind: 'diagram', view: 'general', scope: view.qualifiedName ?? view.name };
			return { kind: 'diagram', view: 'general', scope };
		case 'InterconnectionView':
			return scope ? { kind: 'diagram', view: 'interconnection', scope } : { kind: 'none' };
		case 'StateTransitionView':
			return { kind: 'diagram', view: 'states', scope };
		case 'ActionFlowView':
			return { kind: 'diagram', view: 'actions', scope };
		case 'SequenceView':
			return { kind: 'diagram', view: 'sequence', scope };
		default:
			return { kind: 'none' };
	}
}

/** "requirementCoverage" → "Requirement coverage"; "RequirementGaps" → "Requirement gaps". */
export function viewTitle(name: string): string {
	const words = name
		.replace(/^'|'$/g, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/\s+/);
	return words
		.map((w, i) => {
			const lower = w.toLowerCase();
			if (ACRONYMS.has(lower) || (w.length > 1 && w === w.toUpperCase())) return w.toUpperCase();
			return i === 0 ? w[0]!.toUpperCase() + w.slice(1) : lower;
		})
		.join(' ');
}

/**
 * A name in pieces a narrow column may break between: at a change from a
 * lower-case letter or digit to a capital (`burn|Injury`), after `::`, `.`
 * and `_`, and at a hyphen between words — never inside a word
 * (`burnIn|jury`) or an ID (`RC-001`). Spaces break as usual.
 */
export function breakable(text: string): string[] {
	return text
		.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=::|[._])(?=[^\s:._-])|(?<=[a-z]-)(?=[a-z])/)
		.filter(Boolean);
}

/** Abbreviations engineers write in capitals, even when a name is camel case (`fmeaWorksheet`). */
const ACRONYMS = new Set([
	'fmea',
	'icd',
	'bom',
	'rpn',
	'uav',
	'gps',
	'id',
	'si',
	'ui',
	'api',
	'dsm'
]);

/** The headings saved views are listed under, in order. */
export type ViewFamily =
	| 'requirements'
	| 'structure'
	| 'interfaces'
	| 'behaviour'
	| 'analysis'
	| 'risk'
	| 'documents'
	| 'other';

export const VIEW_FAMILIES: readonly { id: ViewFamily; title: string }[] = [
	{ id: 'requirements', title: 'Requirements' },
	{ id: 'structure', title: 'Structure' },
	{ id: 'interfaces', title: 'Interfaces' },
	{ id: 'behaviour', title: 'Behaviour' },
	{ id: 'analysis', title: 'Budgets & analysis' },
	{ id: 'risk', title: 'Risk' },
	{ id: 'documents', title: 'Documents' },
	{ id: 'other', title: 'Other' }
];

const FAMILY_OF: Record<string, ViewFamily> = {
	RequirementsTable: 'requirements',
	RequirementGaps: 'requirements',
	TraceMatrix: 'requirements',
	VerificationMatrix: 'requirements',
	RequirementsTraceMatrix: 'requirements',
	GeneralView: 'structure',
	BillOfMaterials: 'structure',
	ModelStats: 'structure',
	InterfaceTable: 'interfaces',
	PortTable: 'interfaces',
	ConnectionTable: 'interfaces',
	InterconnectionView: 'interfaces',
	DependencyMatrix: 'interfaces',
	InterfaceN2: 'interfaces',
	FunctionalDsm: 'behaviour',
	RequirementDsm: 'requirements',
	AllocationMatrix: 'behaviour',
	StateTransitionView: 'behaviour',
	ActionFlowView: 'behaviour',
	SequenceView: 'behaviour',
	MassBudget: 'analysis',
	PowerBudget: 'analysis',
	ConstraintChecks: 'analysis',
	TradeStudyTable: 'analysis',
	SpecificationDocument: 'documents',
	InterfaceControlDocument: 'documents'
};

/** Which heading a saved view goes under, from the view def it is typed by. */
export function viewFamily(view: ViewInfo): ViewFamily {
	const definition = view.definition?.split('::').pop() ?? '';
	const known = FAMILY_OF[definition];
	if (known) return known;
	if (view.renderAs === 'asDocument') return 'documents';
	const words = `${definition} ${view.name}`;
	if (/fmea|hazard|risk/i.test(words)) return 'risk';
	if (/budget|check|trade|analysis/i.test(words)) return 'analysis';
	if (/requirement/i.test(words)) return 'requirements';
	return 'other';
}

/** Views grouped by family, in the families' order, without empty groups. */
export function groupViews<T>(
	views: readonly T[],
	info: (v: T) => ViewInfo
): { id: ViewFamily; title: string; views: T[] }[] {
	return VIEW_FAMILIES.map((f) => ({
		...f,
		views: views.filter((v) => viewFamily(info(v)) === f.id)
	})).filter((g) => g.views.length);
}
