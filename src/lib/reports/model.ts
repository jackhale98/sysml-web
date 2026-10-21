/**
 * The model as reports read it: elements with their qualified paths and
 * members, `expose` scoping, and references (`drone.battery`,
 * `Package::'Name'`) resolved to elements.
 *
 * The engine's per-file models are flat and names are matched by text, as
 * elsewhere in the app; the semantic engine will supply resolved ids and
 * owned features, and these helpers will become lookups.
 */
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
import { unescapeName } from '#lib/project/names.ts';

export interface ModelIndex {
	elements: ModelElement[];
	byKey: Map<string, ModelElement>;
	/** Names from the root package down to the element, unquoted. */
	path: Map<string, string[]>;
	owner: Map<string, ModelElement>;
	children: Map<string, ModelElement[]>;
	isLibrary: (file: string) => boolean;
}

export function indexModel(tree: TreeNode[], isLibrary: (file: string) => boolean): ModelIndex {
	const index: ModelIndex = {
		elements: [],
		byKey: new Map(),
		path: new Map(),
		owner: new Map(),
		children: new Map(),
		isLibrary
	};
	const visit = (nodes: TreeNode[], prefix: string[], owner: ModelElement | null) => {
		for (const node of nodes) {
			const e = node.element;
			const path = [...prefix, e.label];
			index.elements.push(e);
			index.byKey.set(e.key, e);
			index.path.set(e.key, path);
			if (owner) index.owner.set(e.key, owner);
			index.children.set(
				e.key,
				node.children.map((c) => c.element)
			);
			visit(node.children, path, e);
		}
	};
	visit(tree, [], null);
	return index;
}

export interface Expose {
	path: string[];
	/** `P` (P and what is in it), `P::*` (its members), `P::**` (everything inside it). */
	mode: 'self' | 'members' | 'all';
}

export function parseExpose(expose: string): Expose {
	const text = expose.trim();
	const mode = text.endsWith('::**') ? 'all' : text.endsWith('::*') ? 'members' : 'self';
	const path = splitName(text.replace(/::\*\*?$/, ''));
	return { path, mode };
}

/** `A::'b c'::d` → `['A', 'b c', 'd']`; dots split feature chains too when asked. */
export function splitName(name: string, chains = false): string[] {
	const parts: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < name.length; i++) {
		const c = name[i]!;
		if (c === "'" && name[i - 1] !== '\\') quoted = !quoted;
		if (!quoted && c === ':' && name[i + 1] === ':') {
			parts.push(current);
			current = '';
			i++;
		} else if (!quoted && chains && c === '.') {
			parts.push(current);
			current = '';
		} else {
			current += c;
		}
	}
	parts.push(current);
	return parts.map((p) => unescapeName(p.trim())).filter(Boolean);
}

/** Whether `path` ends with `suffix`. */
function endsWith(path: string[], suffix: string[]): boolean {
	if (suffix.length > path.length) return false;
	const offset = path.length - suffix.length;
	return suffix.every((s, i) => path[offset + i] === s);
}

/**
 * Whether an element is in a view's scope. Expose targets may be written
 * relative to an import (`drone::*`), so they match the end of a path.
 * No exposes means the whole model (outside the libraries).
 */
export function inScope(index: ModelIndex, element: ModelElement, exposes: Expose[]): boolean {
	const path = index.path.get(element.key);
	if (!path) return false;
	if (!exposes.length) return !index.isLibrary(element.file);
	return pathInScope(path, exposes);
}

export function pathInScope(path: string[], exposes: Expose[]): boolean {
	return exposes.some(({ path: target, mode }) => {
		if (mode === 'members') return endsWith(path.slice(0, -1), target);
		for (let k = path.length - (mode === 'all' ? 1 : 0); k > 0; k--) {
			if (endsWith(path.slice(0, k), target)) return true;
		}
		return false;
	});
}

/** The nearest package around an element. */
export function packageOf(index: ModelIndex, element: ModelElement): ModelElement | null {
	let owner = index.owner.get(element.key);
	while (owner && owner.kind !== 'package') owner = index.owner.get(owner.key);
	return owner ?? null;
}

/** `~PowerPort[2]` → `PowerPort`; `Pkg::Port` → `Port`. */
export function typeName(typeRef: string | null): string | null {
	if (!typeRef) return null;
	const bare = typeRef
		.replace(/^~/, '')
		.replace(/\[[^\]]*\]\s*$/, '')
		.trim();
	if (!bare || bare.startsWith(':')) return null;
	return splitName(bare).at(-1) ?? null;
}

function prefer(candidates: ModelElement[], index: ModelIndex, near?: ModelElement) {
	if (candidates.length <= 1) return candidates[0];
	// Own model first, then near the context, then the least nested.
	const score = (e: ModelElement) =>
		(index.isLibrary(e.file) ? 0 : 4) +
		(near && e.file === near.file ? 2 : 0) -
		(index.path.get(e.key)?.length ?? 0) / 100;
	return candidates.toSorted((a, b) => score(b) - score(a))[0];
}

/** The definition a type reference names. */
export function definitionOf(
	index: ModelIndex,
	typeRef: string | null,
	near?: ModelElement
): ModelElement | undefined {
	const name = typeName(typeRef);
	if (!name) return undefined;
	const qualified = splitName((typeRef ?? '').replace(/^~/, '').replace(/\[[^\]]*\]\s*$/, ''));
	const candidates = index.elements.filter((e) => e.isDefinition && e.label === name);
	const exact =
		qualified.length > 1
			? candidates.filter((e) => endsWith(index.path.get(e.key)!, qualified))
			: [];
	return prefer(exact.length ? exact : candidates, index, near);
}

/**
 * An element's features: its own members, then those of its definition and
 * the definition's supertypes (inherited ports, items, attributes).
 */
export function membersOf(index: ModelIndex, element: ModelElement): ModelElement[] {
	const seen = new Set<string>();
	const out: ModelElement[] = [];
	let current: ModelElement | undefined = element;
	for (let depth = 0; current && depth < 8; depth++) {
		if (seen.has(current.key)) break;
		seen.add(current.key);
		for (const child of index.children.get(current.key) ?? []) {
			if (!out.some((m) => m.label === child.label)) out.push(child);
		}
		current = definitionOf(index, current.typeRef, current);
	}
	return out;
}

/**
 * The element a reference names: a qualified name (`A::B`), a feature
 * chain (`drone.battery.powerOut`) or a plain name, looked up near an
 * element when given (the owner of a connection, say).
 */
export function resolveReference(
	index: ModelIndex,
	reference: string,
	near?: ModelElement
): ModelElement | undefined {
	const segments = splitName(reference.replace(/^~/, ''), true);
	if (!segments.length) return undefined;
	// Start from the first segment, nearest the context first.
	let start: ModelElement | undefined;
	if (near) {
		for (let scope: ModelElement | undefined = near; scope && !start;) {
			start = membersOf(index, scope).find((m) => m.label === segments[0]);
			scope = index.owner.get(scope.key);
		}
	}
	start ??= prefer(
		index.elements.filter((e) => e.label === segments[0]),
		index,
		near
	);
	let current = start;
	for (const segment of segments.slice(1)) {
		if (!current) break;
		current = membersOf(index, current).find((m) => m.label === segment);
	}
	if (current) return current;
	// Fall back to the last segment, preferring an owner named like the one before it.
	const last = segments.at(-1)!;
	const before = segments.at(-2);
	const candidates = index.elements.filter((e) => e.label === last);
	return (
		candidates.find((e) => before && index.owner.get(e.key)?.label === before) ??
		prefer(candidates, index, near)
	);
}
