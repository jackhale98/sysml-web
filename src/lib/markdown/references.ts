/**
 * Model references in a project document (README, TOUR): a code span that
 * names a view, a file or an element becomes a link. An element is named by
 * its simple name, its qualified name (`Package::element`) or a feature
 * chain (`drone.battery`); the segment before the name picks among elements
 * that share it.
 */
import type { ModelElement } from '#lib/project/elements.ts';
import type { ViewInfo } from '#lib/engine/types.ts';

export type Reference =
	| { kind: 'element'; element: ModelElement }
	| { kind: 'view'; name: string }
	| { kind: 'file'; path: string };

/** What a document's references are resolved against. */
export interface ReferenceScope {
	paths: readonly string[];
	views: readonly ViewInfo[];
	elements: readonly ModelElement[];
}

/** How a code span reads as a reference, and the elements it could mean. */
export interface Resolution {
	reference: Reference | null;
	/** Elements with the span's name (for an element reference). */
	candidates: ModelElement[];
	/** Whether the owner segment picked the element (rather than the first of several). */
	byOwner: boolean;
}

const unquote = (s: string) => s.replace(/^'|'$/g, '');

/** `A::B`, `a.b.c` or `A::b.c`, split into names (a quoted name keeps its dots). */
export function segmentsOf(text: string): string[] {
	return (text.match(/'[^']*'|[^:.]+/g) ?? []).map(unquote);
}

export function resolveReference(code: string, scope: ReferenceScope): Resolution {
	const none: Resolution = { reference: null, candidates: [], byOwner: false };
	const text = code.trim();
	if (/\.(sysml|kerml)$/.test(text)) {
		const file = scope.paths.find((p) => p === text || p.endsWith(`/${text}`));
		return { ...none, reference: file ? { kind: 'file', path: file } : null };
	}
	if (!/^[A-Za-z_']/.test(text) || /[\s;{}=*~]/.test(text.replace(/'[^']*'/g, ''))) return none;
	const segments = segmentsOf(text);
	const name = segments.at(-1);
	if (!name) return none;
	const view = scope.views.find((v) => v.name === name && v.isUsage && !v.builtin);
	if (view) return { ...none, reference: { kind: 'view', name: view.name } };
	const owner = segments.length > 1 ? segments.at(-2)! : null;
	const candidates = scope.elements.filter((e) => e.label === name);
	const owned = owner ? candidates.find((e) => unquote(e.parent ?? '') === owner) : undefined;
	const element = owned ?? candidates[0];
	return {
		reference: element ? { kind: 'element', element } : null,
		candidates,
		byOwner: !!owned
	};
}
