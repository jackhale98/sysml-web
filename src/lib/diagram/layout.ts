/**
 * Automatic layout of engine diagram graphs with ELK (layered, orthogonal).
 * ELK is loaded on first use so it stays out of the initial bundle.
 */
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';

export interface Placed {
	node: DiagramNode;
	x: number;
	y: number;
	width: number;
	height: number;
}

export type Direction = 'DOWN' | 'RIGHT';

const CHAR = 7.4;
const HEADER = 46;
const ROW = 19;

/** Estimated box size for a node, from its text. */
export function nodeSize(node: DiagramNode): { width: number; height: number } {
	if (node.kind === 'port') return { width: 22, height: 22 };
	if (node.kind === 'initial_state' || node.kind === 'final_state')
		return { width: 24, height: 24 };
	const rows = node.attributes.map(([k, v]) => `${k} ${v}`);
	const longest = Math.max(
		node.label.length * (CHAR + 0.6),
		(node.stereotype?.length ?? 0) * (CHAR - 0.6),
		...rows.map((r) => r.length * (CHAR - 0.4))
	);
	const width = Math.round(Math.min(340, Math.max(132, longest + 32)));
	const height = HEADER + (rows.length ? 10 + Math.min(rows.length, 8) * ROW : 0);
	return { width, height };
}

let elk: Promise<{ layout(graph: unknown): Promise<ElkResult> }> | undefined;

interface ElkResult {
	children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
}

async function getElk() {
	elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default());
	return elk;
}

/** Positions for every node of the graph. */
export async function layout(graph: DiagramGraph, direction: Direction): Promise<Placed[]> {
	const ids = new Set(graph.nodes.map((n) => n.id));
	const engine = await getElk();
	const result = await engine.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': direction,
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.spacing.nodeNodeBetweenLayers': '64',
			'elk.spacing.nodeNode': '36',
			'elk.spacing.componentComponent': '56',
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES'
		},
		children: graph.nodes.map((node) => ({ id: node.id, ...nodeSize(node) })),
		edges: graph.edges
			.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
			.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] }))
	});
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	return (result.children ?? []).flatMap((c) => {
		const node = byId.get(c.id);
		if (!node) return [];
		return [{ node, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 120, height: c.height ?? 40 }];
	});
}
