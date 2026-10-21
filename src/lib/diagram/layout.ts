/**
 * Automatic layout of engine diagram graphs with ELK (layered, orthogonal).
 * ELK is loaded on first use so it stays out of the initial bundle.
 */
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { MAX_ROWS, notationOf } from './notation.ts';

export interface Placed {
	node: DiagramNode;
	x: number;
	y: number;
	width: number;
	height: number;
}

export type Direction = 'DOWN' | 'RIGHT';

/** Box metrics shared with SysmlNode.svelte (px). */
export const METRICS = {
	header: 50,
	tab: 16,
	compartmentPad: 12,
	compartmentTitle: 16,
	row: 18,
	docLine: 17,
	docLines: 3,
	minWidth: 150,
	maxWidth: 320
};
const NAME_CHAR = 7.7;
const MONO_CHAR = 6.95;
const DOC_CHAR = 6.6;

/** Box size for a node, from its notation; the node is drawn at exactly this size. */
export function nodeSize(node: DiagramNode, view = 'general'): { width: number; height: number } {
	const n = notationOf(node, view);
	switch (n.shape) {
		case 'port':
			return { width: 20, height: 20 };
		case 'initial':
		case 'final':
			return { width: 26, height: 26 };
		case 'decision':
			return { width: 34, height: 34 };
		case 'bar':
			return { width: 72, height: 8 };
	}
	const m = METRICS;
	const rows = n.compartments.flatMap((c) => c.rows);
	const portRows = n.ports.map((p) => p.label);
	const longest = Math.max(
		node.label.length * NAME_CHAR + 52,
		n.keyword.length * 6.4 + 52,
		...rows.map((r) => r.length * MONO_CHAR + 28),
		...portRows.map((r) => r.length * MONO_CHAR + 40)
	);
	let width = Math.min(m.maxWidth, Math.max(m.minWidth, longest));
	if (n.doc) width = Math.max(width, Math.min(m.maxWidth, 240));
	width = Math.round(width);

	let height = m.header;
	if (n.shape === 'package') height += m.tab;
	if (n.doc) {
		const perLine = Math.max(10, Math.floor((width - 24) / DOC_CHAR));
		const lines = Math.min(m.docLines, Math.ceil(n.doc.length / perLine));
		height += m.compartmentPad + lines * m.docLine;
	}
	for (const c of n.compartments) {
		const shown = Math.min(c.rows.length, MAX_ROWS) + (c.rows.length > MAX_ROWS ? 1 : 0);
		height += m.compartmentPad + m.compartmentTitle + shown * m.row;
	}
	if (n.ports.length) {
		const left = n.ports.filter((p) => p.side === 'left').length;
		const right = n.ports.length - left;
		height += m.compartmentPad + Math.max(left, right) * m.row;
	}
	return { width, height: Math.round(height) };
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
export async function layout(
	graph: DiagramGraph,
	direction: Direction,
	view = 'general'
): Promise<Placed[]> {
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
		children: graph.nodes.map((node) => ({ id: node.id, ...nodeSize(node, view) })),
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
