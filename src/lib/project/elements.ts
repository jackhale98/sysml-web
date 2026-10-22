/**
 * The model's named elements across files, as the explorer, inspector and
 * selection see them. Built from the engine's per-file models; the semantic
 * engine (Phase 1) will supply ids and resolved relationships instead.
 */
import type { Analysis, Span } from '#lib/engine/types.ts';
import { unescapeName } from './names';

export interface ModelElement {
	/** Unique within the project: `file@startByte`. */
	key: string;
	/** Name as written (may be quoted). */
	name: string;
	/** Name for display (unescaped). */
	label: string;
	/** Engine kind, e.g. `part`, `requirement`, `package`. */
	kind: string;
	isDefinition: boolean;
	/** Name of the owning definition or package, as written. */
	parent: string | null;
	/** Type (`: Type`) or specialization (`:> Super`). */
	typeRef: string | null;
	shortName: string | null;
	doc: string | null;
	multiplicity: string | null;
	value: string | null;
	file: string;
	span: Span;
	/** The toolkit's element id, which edits address it by. */
	id?: string;
}

export interface TreeNode {
	element: ModelElement;
	children: TreeNode[];
}

/** Every named definition and usage in the analysed files. */
export function collectElements(analyses: Iterable<Analysis>): ModelElement[] {
	const elements: ModelElement[] = [];
	for (const { model } of analyses) {
		for (const d of model.definitions) {
			if (!d.name) continue;
			elements.push({
				key: `${model.file}@${d.span.start_byte}`,
				name: d.name,
				label: unescapeName(d.name),
				kind: d.kind,
				isDefinition: true,
				parent: d.parent_def ?? null,
				typeRef: d.super_type,
				shortName: d.short_name ? unescapeName(d.short_name) : null,
				doc: d.doc ?? null,
				multiplicity: null,
				value: null,
				file: model.file,
				span: d.span,
				...(d.id ? { id: d.id } : {})
			});
		}
		for (const u of model.usages) {
			if (!u.name) continue;
			elements.push({
				key: `${model.file}@${u.span.start_byte}`,
				name: u.name,
				label: unescapeName(u.name),
				kind: u.kind,
				isDefinition: false,
				parent: u.parent_def ?? null,
				typeRef: u.type_ref,
				shortName: u.short_name ? unescapeName(u.short_name) : null,
				doc: u.doc ?? null,
				multiplicity: u.multiplicity ?? null,
				value: u.value_expr ?? null,
				file: model.file,
				span: u.span,
				...(u.id ? { id: u.id } : {})
			});
		}
	}
	return elements;
}

/**
 * Nest elements under their owners. Owners are matched by name within the
 * same file (the engine's model is flat), so ambiguous names nest under the
 * enclosing span.
 */
export function buildTree(elements: ModelElement[]): TreeNode[] {
	const nodes = new Map(elements.map((e) => [e.key, { element: e, children: [] as TreeNode[] }]));
	// Candidates for an owner, by file and name (a linear scan per element was quadratic).
	const named = new Map<string, ModelElement[]>();
	for (const e of elements) {
		const key = `${e.file}\u0000${e.name}`;
		const list = named.get(key);
		if (list) list.push(e);
		else named.set(key, [e]);
	}
	const roots: TreeNode[] = [];
	for (const node of nodes.values()) {
		const child = node.element;
		const owner = child.parent
			? findOwner(named.get(`${child.file}\u0000${child.parent}`) ?? [], child)
			: undefined;
		const parentNode = owner ? nodes.get(owner.key) : undefined;
		if (parentNode) parentNode.children.push(node);
		else roots.push(node);
	}
	const sort = (list: TreeNode[]) => {
		list.sort(
			(a, b) =>
				(a.element.file === b.element.file ? 0 : a.element.file.localeCompare(b.element.file)) ||
				a.element.span.start_byte - b.element.span.start_byte
		);
		for (const n of list) sort(n.children);
	};
	sort(roots);
	return roots;
}

/** The innermost of `candidates` (same file, named as `child`'s parent) that encloses it. */
function findOwner(candidates: ModelElement[], child: ModelElement): ModelElement | undefined {
	let best: ModelElement | undefined;
	for (const e of candidates) {
		if (e === child) continue;
		if (e.span.start_byte > child.span.start_byte || e.span.end_byte < child.span.end_byte)
			continue;
		// The innermost enclosing element with that name.
		if (!best || e.span.start_byte >= best.span.start_byte) best = e;
	}
	return best;
}

/** The innermost element whose span contains a UTF-8 byte offset of a file. */
export function elementAt(
	elements: ModelElement[],
	file: string,
	byte: number
): ModelElement | undefined {
	let best: ModelElement | undefined;
	for (const e of elements) {
		if (e.file !== file || byte < e.span.start_byte || byte > e.span.end_byte) continue;
		if (!best || e.span.end_byte - e.span.start_byte < best.span.end_byte - best.span.start_byte) {
			best = e;
		}
	}
	return best;
}

/** UTF-16 string offset → UTF-8 byte offset. */
export function utf16ToByte(text: string, offset: number): number {
	return new TextEncoder().encode(text.slice(0, offset)).length;
}

/** UTF-8 byte offset → UTF-16 string offset. */
export function byteToUtf16(text: string, byte: number): number {
	const bytes = new TextEncoder().encode(text);
	return new TextDecoder().decode(bytes.subarray(0, byte)).length;
}
