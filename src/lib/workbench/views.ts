/**
 * How a SysML view is presented: views with a `@TableRendering` are tables
 * the engine renders; the standard diagram views (SysML v2 clause 9.2.20)
 * are drawn from what they expose (a general view from the view usage
 * itself, so its filters apply; the others from the element it exposes).
 */
import type { DiagramView, ViewInfo } from '#lib/engine/types.ts';

export type Presentation =
	| { kind: 'table' }
	| { kind: 'diagram'; view: DiagramView; scope: string | null }
	| { kind: 'none' };

/** `DroneArchitecture::drone::*` → `drone`; quotes removed. */
export function exposedName(expose: string): string {
	const path = expose.replace(/::\*\*?$/, '');
	const last = path.split('::').pop() ?? path;
	return last.replace(/^'|'$/g, '');
}

export function presentationOf(view: ViewInfo): Presentation {
	if (view.hasTable) return { kind: 'table' };
	if (!view.isUsage) return { kind: 'none' };
	const exposes = view.exposes ?? [];
	const scope = exposes.length === 1 ? exposedName(exposes[0]!) : null;
	switch (view.definition) {
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

/** Abbreviations engineers write in capitals, even when a name is camel case (`fmeaWorksheet`). */
const ACRONYMS = new Set(['fmea', 'icd', 'bom', 'rpn', 'uav', 'gps', 'id', 'si', 'ui', 'api']);
