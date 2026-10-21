/**
 * How diagram nodes map back to model elements, and the model facts the
 * relationship tools need: owners, qualified names, usage paths, ports and
 * whether a name is visible where a statement is written.
 */
import { byteToUtf16, type ModelElement, type TreeNode } from '#lib/project/elements.ts';
import { headerEnd } from './textpatch.ts';

/** Owner of each element, by key. */
export type Owners = Map<string, ModelElement>;

export function ownersOf(tree: TreeNode[]): Owners {
	const owners: Owners = new Map();
	const walk = (nodes: TreeNode[], owner: ModelElement | undefined) => {
		for (const n of nodes) {
			if (owner) owners.set(n.element.key, owner);
			walk(n.children, n.element);
		}
	};
	walk(tree, undefined);
	return owners;
}

/** `Pkg::Def::name`, names as written. */
export function qualifiedName(element: ModelElement, owners: Owners): string {
	const parts = [element.name];
	for (let o = owners.get(element.key); o; o = owners.get(o.key)) parts.unshift(o.name);
	return parts.join('::');
}

/** The outermost package an element is in, or the element itself. */
export function topOf(element: ModelElement, owners: Owners): ModelElement {
	let top = element;
	for (let o = owners.get(element.key); o; o = owners.get(o.key)) top = o;
	return top;
}

/** The package or definition that owns an element's namespace. */
export function namespaceOf(element: ModelElement, owners: Owners): ModelElement | undefined {
	return owners.get(element.key);
}

/**
 * A usage as a feature path from its outermost owning usage: `drone.battery`.
 * `root` is that outermost usage, which a reference has to make visible.
 */
export function usagePath(
	element: ModelElement,
	owners: Owners
): { root: ModelElement; path: string } {
	const chain = [element];
	for (let o = owners.get(element.key); o && !o.isDefinition; o = owners.get(o.key)) {
		chain.unshift(o);
	}
	return { root: chain[0]!, path: chain.map((e) => e.name).join('.') };
}

/** Whether `qualified` (a `::` name) is reachable by its simple name from `host`. */
export function isVisible(
	qualified: string,
	hostQualified: string,
	hostText: string | undefined
): boolean {
	const segments = qualified.split('::');
	const owner = segments.slice(0, -1).join('::');
	// Same namespace, or an enclosing one.
	if (owner === hostQualified || hostQualified.startsWith(owner + '::') || !owner) return true;
	if (!hostText) return false;
	const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const imports = new RegExp(
		`\\bimport\\s+(?:${escape(qualified)}\\s*;|${escape(owner)}::\\*\\*?\\s*;)`
	);
	return imports.test(hostText);
}

/**
 * How to refer to `element` from a statement written in `host`: its simple
 * name when visible there, else its qualified name.
 */
export function referenceFrom(
	element: ModelElement,
	host: ModelElement,
	owners: Owners,
	textOf: (path: string) => string | undefined
): string {
	const qualified = qualifiedName(element, owners);
	return isVisible(qualified, qualifiedName(host, owners), textOf(host.file))
		? element.name
		: qualified;
}

/** A usage path (`drone.battery`) as written from `host`, qualified at its root if needed. */
export function pathFrom(
	element: ModelElement,
	host: ModelElement,
	owners: Owners,
	textOf: (path: string) => string | undefined
): string {
	if (element.isDefinition) return referenceFrom(element, host, owners, textOf);
	const { root, path } = usagePath(element, owners);
	const rootRef = referenceFrom(root, host, owners, textOf);
	return rootRef === root.name ? path : rootRef + path.slice(root.name.length);
}

/**
 * The element a diagram node draws. Ids are names, or dotted paths for
 * nested usages (`drone.battery`); `scope` is the diagram's subject.
 */
export function resolveNode(
	id: string,
	isDefinition: boolean | undefined,
	scope: string | null,
	elements: ModelElement[],
	owners: Owners
): ModelElement | undefined {
	const segments = splitPath(id);
	const name = segments.at(-1)!;
	let candidates = elements.filter((e) => e.name === name);
	if (segments.length > 1) {
		const chained = candidates.filter((e) => {
			let o = owners.get(e.key);
			for (let i = segments.length - 2; i >= 0; i--, o = o && owners.get(o.key)) {
				if (o?.name !== segments[i]) return false;
			}
			return true;
		});
		if (chained.length) candidates = chained;
	}
	const score = (e: ModelElement) =>
		(isDefinition === undefined || e.isDefinition === isDefinition ? 4 : 0) +
		(scope && inScope(e, scope, owners) ? 2 : 0) +
		(e.file.startsWith('libraries/') ? 0 : 1);
	const depth = (e: ModelElement) => {
		let d = 0;
		for (let o = owners.get(e.key); o; o = owners.get(o.key)) d++;
		return d;
	};
	// Best score first; among equals, the shallowest (a package's part over a subject).
	return candidates.sort((a, b) => score(b) - score(a) || depth(a) - depth(b))[0];
}

function inScope(element: ModelElement, scope: string, owners: Owners): boolean {
	for (let o = owners.get(element.key); o; o = owners.get(o.key)) {
		if (o.name === scope) return true;
	}
	return false;
}

/** `drone.'flight controller'.x` → segments, keeping quoted names whole. */
export function splitPath(path: string): string[] {
	return path.match(/'(?:[^'\\]|\\.)*'|[^.]+/g) ?? [path];
}

/** The text of an element's declaration, from its span. */
export function declarationText(element: ModelElement, text: string | undefined): string {
	if (!text) return '';
	const from = byteToUtf16(text, element.span.start_byte);
	const to = byteToUtf16(text, element.span.end_byte);
	const head = headerEnd(text, from, to);
	return text.slice(from, head ? head.index : to);
}

export interface PortInfo {
	name: string;
	/** Port definition, as written, without `~`. */
	type: string | null;
	conjugated: boolean;
}

/**
 * Ports a part offers: its own, those of its type and the type's
 * supertypes (one inheritance chain, no cycles).
 */
export function portsOf(
	element: ModelElement,
	elements: ModelElement[],
	owners: Owners,
	textOf: (path: string) => string | undefined
): PortInfo[] {
	const ports: PortInfo[] = [];
	const seen = new Set<string>();
	const collect = (owner: ModelElement) => {
		if (seen.has(owner.key)) return;
		seen.add(owner.key);
		for (const e of elements) {
			if (e.kind !== 'port' || owners.get(e.key)?.key !== owner.key) continue;
			if (ports.some((p) => p.name === e.name)) continue;
			const decl = declarationText(e, textOf(e.file));
			ports.push({
				name: e.name,
				type: e.typeRef,
				conjugated: /:\s*~/.test(decl)
			});
		}
		const type = owner.typeRef ? findDefinition(owner.typeRef, elements) : undefined;
		if (type) collect(type);
	};
	collect(element);
	return ports;
}

/** A definition by (possibly qualified) name. */
export function findDefinition(
	reference: string,
	elements: ModelElement[]
): ModelElement | undefined {
	const name = reference.split('::').pop()?.trim();
	return elements.find((e) => e.isDefinition && e.name === name);
}

export interface InterfaceEnd {
	name: string;
	type: string;
	conjugated: boolean;
}

/** The `end` features of an interface definition, read from its text. */
export function interfaceEnds(def: ModelElement, text: string | undefined): InterfaceEnd[] {
	if (!text) return [];
	const body = text.slice(
		byteToUtf16(text, def.span.start_byte),
		byteToUtf16(text, def.span.end_byte)
	);
	const ends: InterfaceEnd[] = [];
	for (const m of body.matchAll(/\bend\s+(?:port\s+)?([\w']+)\s*:\s*(~?)\s*([\w:']+)/g)) {
		ends.push({ name: m[1]!, type: m[3]!.split('::').pop()!, conjugated: m[2] === '~' });
	}
	return ends;
}
