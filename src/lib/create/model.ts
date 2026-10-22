/**
 * The model tree as the forms read it: where an element sits (its owners),
 * its qualified name, the package around it, and the elements a picker
 * offers. Pure, over the workspace's tree.
 */
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';

/** The nodes from a root down to the element (empty when it isn't in the tree). */
export function pathTo(tree: readonly TreeNode[], key: string): TreeNode[] {
	for (const node of tree) {
		if (node.element.key === key) return [node];
		const inner = pathTo(node.children, key);
		if (inner.length) return [node, ...inner];
	}
	return [];
}

/** `DroneArchitecture::drone::battery`, as written. */
export function qualifiedName(tree: readonly TreeNode[], key: string): string {
	return pathTo(tree, key)
		.map((n) => n.element.name)
		.join('::');
}

/** The innermost package that contains the element (itself, when it is one). */
export function enclosingPackage(tree: readonly TreeNode[], key: string): ModelElement | null {
	const path = pathTo(tree, key);
	for (let i = path.length - 1; i >= 0; i--)
		if (path[i]!.element.kind === 'package') return path[i]!.element;
	return null;
}

/** The element that owns this one (null at the top). */
export function ownerOf(tree: readonly TreeNode[], key: string): ModelElement | null {
	const path = pathTo(tree, key);
	return path.length > 1 ? path[path.length - 2]!.element : null;
}

/** The node of an element. */
export function nodeOf(tree: readonly TreeNode[], key: string): TreeNode | undefined {
	return pathTo(tree, key).at(-1);
}

/** Every node, depth first, with its depth and qualified name. */
export function flatten(
	tree: readonly TreeNode[],
	keep: (e: ModelElement) => boolean = () => true
): { node: TreeNode; depth: number; qualifiedName: string }[] {
	const out: { node: TreeNode; depth: number; qualifiedName: string }[] = [];
	const walk = (nodes: readonly TreeNode[], depth: number, prefix: string) => {
		for (const node of nodes) {
			const q = prefix ? `${prefix}::${node.element.name}` : node.element.name;
			if (keep(node.element)) out.push({ node, depth, qualifiedName: q });
			walk(node.children, depth + 1, q);
		}
	};
	walk(tree, 0, '');
	return out;
}

/**
 * The definitions an element is one of, by name as written, nearest first:
 * a usage's type, a definition itself, then what they specialize — read
 * from the tree (the engine's answer, `elementFeatures`, is exact; this is
 * for filtering a picker before anything is chosen).
 */
export function kindChain(elements: readonly ModelElement[], element: ModelElement): string[] {
	const chain: string[] = [];
	const definitionNamed = (name: string) => {
		const simple = name.split('::').pop()!.replace(/^~/, '');
		return elements.find((e) => e.isDefinition && e.name === simple && e.kind === element.kind);
	};
	let at: ModelElement | undefined = element.isDefinition
		? element
		: element.typeRef
			? definitionNamed(element.typeRef)
			: undefined;
	if (!at && element.typeRef && !element.isDefinition)
		chain.push(element.typeRef.split('::').pop()!.trim());
	while (at && !chain.includes(at.name) && chain.length < 32) {
		chain.push(at.name);
		const next: string | null = at.typeRef;
		at = next ? definitionNamed(next.split(',')[0]!.trim()) : undefined;
		if (!at && next) chain.push(next.split('::').pop()!.trim());
	}
	return chain;
}
