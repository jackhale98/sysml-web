/**
 * The toolkit's own structured diagram graphs (`Session.toGraph`), which
 * the interconnection, state and action views start from: it resolves
 * connector ends through feature chains, renders the ports a part
 * inherits from its definition and the definition's supertypes, and
 * reads transitions' triggers, guards and effects. Node ids there are
 * element ids (`usage~port` for an inherited port); the builders turn
 * them into the app's readable ids.
 */
import type { TkSession } from '../api';

export interface TkGraphRow {
	id?: string;
	label: string;
	inherited?: boolean;
}

export interface TkGraphNode {
	id: string;
	qname?: string;
	label: string;
	/** `block`, `port`, `package`, `state`, `control`, `pseudo`, `param`, `note`. */
	kind: string;
	stereo: string;
	metaclass: string;
	parent?: string;
	direction?: string;
	conjugated?: boolean;
	rows?: TkGraphRow[];
}

export interface TkGraphEdge {
	/** The connector, transition or succession element (absent on notes). */
	id?: string;
	kind: string;
	label?: string;
	metaclass?: string;
	source: string;
	target: string;
	sourcePath?: string;
	targetPath?: string;
}

export interface TkGraph {
	nodes: TkGraphNode[];
	edges: TkGraphEdge[];
}

export function toGraph(
	session: TkSession,
	view: 'interconnection' | 'state' | 'action',
	root: string
): TkGraph | null {
	try {
		return JSON.parse(
			session.toGraph(
				JSON.stringify({ view, roots: [root], showNotes: false, showMetadata: false })
			)
		) as TkGraph;
	} catch {
		return null;
	}
}

/** The nodes of a toolkit graph by id, with each node's chain of parents. */
export class TkTree {
	readonly byId: Map<string, TkGraphNode>;
	readonly graph: TkGraph;

	constructor(graph: TkGraph) {
		this.graph = graph;
		this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
	}

	/** `n` and its parents, outermost first. */
	chain(n: TkGraphNode): TkGraphNode[] {
		const list: TkGraphNode[] = [];
		for (
			let at: TkGraphNode | undefined = n;
			at;
			at = at.parent ? this.byId.get(at.parent) : undefined
		) {
			list.unshift(at);
			if (list.length > 64) break;
		}
		return list;
	}

	children(id: string): TkGraphNode[] {
		return this.graph.nodes.filter((n) => n.parent === id);
	}
}

/** `battery : Battery` → `battery`. */
export function labelName(label: string): string {
	return label.split(' : ')[0]!.split(' :> ')[0]!.trim();
}
