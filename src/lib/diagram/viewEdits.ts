/**
 * What a diagram shows, changed without changing what the model says:
 * taking an element off a diagram and adding elements to it. A saved view
 * (a `view` usage) says what it shows in its `expose` lines, so there the
 * text changes; any other diagram keeps it beside its positions in the
 * layout file (`positions.ts`).
 *
 * Pure: the model is passed in as a `ModelContext`; edits come back as
 * `EditStep`s for `applySteps`.
 */
import type { DiagramGraph } from '#lib/engine/types.ts';
import { byteToUtf16, type ModelElement } from '#lib/project/elements.ts';
import type { EditStep } from '#lib/workbench/actions.ts';
import { qualifiedName } from './model.ts';
import type { ModelContext } from './relationships.ts';
import { bodyOf, directText, insertLineAfter, removeStatement } from './textpatch.ts';

/** One `expose` statement of a view, as written. */
export interface Expose {
	/** The name it exposes, without its `::*` or `::**`. */
	target: string;
	/** `''` the element itself, `*` its members, `**` it and everything in it, `*::**` everything in it. */
	members: '' | '*' | '**' | '*::**';
	/** The statement, `expose` to `;`, in the file's text (UTF-16 offsets). */
	from: number;
	to: number;
}

/** A view's `expose` statements, those directly in its body, in order. */
export function exposesOf(view: ModelElement, ctx: ModelContext): Expose[] {
	const text = ctx.textOf(view.file);
	if (text === undefined) return [];
	const body = bodyOf(
		text,
		byteToUtf16(text, view.span.start_byte),
		byteToUtf16(text, view.span.end_byte)
	);
	if (!body) return [];
	const own = directText(text, body.open, body.close);
	const found: Expose[] = [];
	for (const m of own.matchAll(/\bexpose\s+([^;{[]+?)\s*(?:\[[^\]]*\]\s*)?;/g)) {
		const written = m[1]!.replace(/\s+/g, '');
		const members = /::\*::\*\*$/.test(written)
			? '*::**'
			: /::\*\*$/.test(written)
				? '**'
				: /::\*$/.test(written)
					? '*'
					: '';
		const from = body.open + 1 + m.index;
		found.push({
			target: written.replace(/(::\*)?::\*\*?$/, ''),
			members,
			from,
			to: from + m[0].length
		});
	}
	return found;
}

const plain = (name: string) => name.replace(/'/g, '');

/** Whether `target` (as an expose writes it) names the element with this qualified name. */
function names(target: string, qualified: string): boolean {
	return `::${plain(qualified)}`.endsWith(`::${plain(target)}`);
}

/** How an expose shows an element: itself, as something inside what it names, or not at all. */
export function coverage(e: Expose, qualified: string): 'itself' | 'inside' | null {
	if (names(e.target, qualified)) return e.members === '' || e.members === '**' ? 'itself' : null;
	if (!e.members) return null;
	const segments = qualified.split('::');
	for (let i = segments.length - 1; i > 0; i--) {
		if (!names(e.target, segments.slice(0, i).join('::'))) continue;
		// `X::*` shows X's own members; the others everything inside X.
		return e.members !== '*' || i === segments.length - 1 ? 'inside' : null;
	}
	return null;
}

/** Taking an element off a saved view: the `expose` lines to remove, and whether others still show it. */
export interface Unexposed {
	/** The view's text without the element's own `expose` lines (none when it has none). */
	steps: EditStep[];
	/** The statements removed, for the confirmation. */
	removed: string[];
	/** Whether another `expose` still shows it, so the diagram has to hide it too. */
	stillShown: boolean;
}

export function planUnexpose(
	view: ModelElement,
	element: ModelElement,
	ctx: ModelContext
): Unexposed {
	const text = ctx.textOf(view.file);
	const qualified = qualifiedName(element, ctx.owners);
	const exposes = exposesOf(view, ctx);
	const own = exposes.filter((e) => e.members === '' && names(e.target, qualified));
	const others = exposes.filter((e) => !own.includes(e));
	const stillShown = others.some((e) => coverage(e, qualified));
	// Without any `expose`, a view shows the whole model: then it is only hidden.
	if (text === undefined || !own.length || !others.length) {
		return { steps: [], removed: [], stillShown: true };
	}
	let after = text;
	for (const e of [...own].sort((a, b) => b.from - a.from)) {
		after = removeStatement(after, e.from, e.to);
	}
	return {
		steps: [{ kind: 'patch', path: view.file, before: text, after }],
		removed: own.map((e) => text.slice(e.from, e.to)),
		stillShown
	};
}

/**
 * `expose` lines that add elements to a saved view, after its last one
 * (each named by its qualified name, which resolves from anywhere).
 * Elements an `expose` already names are left out; null when there is
 * nothing to add.
 */
export function planExpose(
	view: ModelElement,
	elements: ModelElement[],
	ctx: ModelContext
): { steps: EditStep[]; added: ModelElement[] } | null {
	const text = ctx.textOf(view.file);
	if (text === undefined) return null;
	const exposes = exposesOf(view, ctx);
	const added = elements.filter((element, i) => {
		const qualified = qualifiedName(element, ctx.owners);
		return (
			elements.findIndex((e) => e.key === element.key) === i &&
			!exposes.some((e) => coverage(e, qualified) === 'itself')
		);
	});
	if (!added.length) return null;
	// A view without `expose` shows the whole model already.
	const last = exposes.at(-1);
	if (!last) return null;
	let after = text;
	for (const e of [...added].reverse()) {
		after = insertLineAfter(after, last.to, `expose ${qualifiedName(e, ctx.owners)};`).text;
	}
	return { steps: [{ kind: 'patch', path: view.file, before: text, after }], added };
}

/** The graph without the hidden nodes and the lines to and from them. */
export function withoutHidden(graph: DiagramGraph, hidden: readonly string[]): DiagramGraph {
	if (!hidden.length) return graph;
	const gone = new Set(hidden);
	if (!graph.nodes.some((n) => gone.has(n.id))) return graph;
	return {
		...graph,
		nodes: graph.nodes.filter((n) => !gone.has(n.id)),
		edges: graph.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
		subgraphs: graph.subgraphs.map((s) => ({
			...s,
			node_ids: s.node_ids.filter((id) => !gone.has(id))
		}))
	};
}
