/**
 * Automatic layout of engine diagram graphs with ELK (layered, orthogonal).
 * ELK is loaded on first use so it stays out of the initial bundle.
 */
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { LABEL_HEIGHT, labelWidth } from './labels.svelte.ts';
import { edgeLabelText, MAX_ROWS, notationOf } from './notation.ts';

export interface Placed {
	node: DiagramNode;
	x: number;
	y: number;
	width: number;
	height: number;
}

export type Direction = 'DOWN' | 'RIGHT';

export interface XY {
	x: number;
	y: number;
}

/**
 * How ELK drew an edge: its bends, from the end laid out first (the general
 * end of an `UPWARD` edge) to the other, and the centre of its label.
 */
export interface Route {
	points: XY[];
	label: XY | null;
}

export interface Layout {
	nodes: Placed[];
	/** By the edge's index in `graph.edges`. */
	routes: Map<number, Route>;
}

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
	maxWidth: 320,
	/** A part with ports on both borders may be wider, to keep them on one row. */
	maxPortsWidth: 480
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
	// Ports on both borders sit side by side on a row, when that fits; else the right ones go below.
	const sideWidth = (side: 'left' | 'right') =>
		Math.max(
			0,
			...n.ports.filter((p) => p.side === side).map((p) => p.label.length * MONO_CHAR + 14)
		);
	const [leftPorts, rightPorts] = [sideWidth('left'), sideWidth('right')];
	const sideBySide = leftPorts + rightPorts + 36 <= m.maxPortsWidth;
	const portsWidth = sideBySide
		? leftPorts + rightPorts + 36
		: Math.max(leftPorts, rightPorts) + 28;
	const longest = Math.max(
		node.label.length * NAME_CHAR + 52,
		n.keyword.length * 6.4 + 52,
		...rows.map((r) => r.length * MONO_CHAR + 28),
		n.ports.length ? portsWidth : 0
	);
	const widest = n.ports.length ? m.maxPortsWidth : m.maxWidth;
	let width = Math.min(widest, Math.max(m.minWidth, longest));
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
		height += m.compartmentPad + (sideBySide ? Math.max(left, right) : left + right) * m.row;
	}
	return { width, height: Math.round(height) };
}

/**
 * Relationships drawn from the specific to the general (a specialization,
 * a typing, a derived requirement to its original, a design element to the
 * requirement it satisfies): laid out with the general end first, so
 * supertypes, definitions and requirements sit above what refers to them.
 */
export const UPWARD = new Set(['specialization', 'typing', 'dependency', 'satisfy', 'verify']);

let elk: Promise<{ layout(graph: unknown): Promise<ElkResult> }> | undefined;

interface ElkResult {
	children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
	edges?: {
		id: string;
		sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[];
		labels?: { x?: number; y?: number; width?: number; height?: number }[];
	}[];
}

/** The text drawn on an edge, keyword first; shared with SysmlEdge.svelte. */
export function edgeText(kind: string, label: string | null): string {
	const keyword =
		kind === 'satisfy' || kind === 'verify' || kind === 'allocate'
			? `«${kind}»`
			: kind === 'binding' || kind === 'constraint_binding'
				? '='
				: null;
	return [keyword, edgeLabelText(kind, label)].filter(Boolean).join(' ');
}

async function getElk() {
	elk ??= import('elkjs/lib/elk.bundled.js').then(
		(m) => new m.default() as unknown as { layout(graph: unknown): Promise<ElkResult> }
	);
	return elk;
}

/** Positions for every node of the graph, and the route of every edge between two of them. */
export async function layout(
	graph: DiagramGraph,
	direction: Direction,
	view = 'general'
): Promise<Layout> {
	const ids = new Set(graph.nodes.map((n) => n.id));
	const engine = await getElk();
	const edges = graph.edges.flatMap((e, i) => {
		if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) return [];
		const [from, to] = UPWARD.has(e.kind) ? [e.target, e.source] : [e.source, e.target];
		const text = edgeText(e.kind, e.label);
		// Labels take part in the layout, so ELK keeps them clear of nodes and of each other.
		const labels = text ? [{ text, width: labelWidth(text), height: LABEL_HEIGHT }] : [];
		return [{ id: `e${i}`, sources: [from], targets: [to], labels }];
	});
	const result = await engine.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': direction,
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.spacing.nodeNodeBetweenLayers': '64',
			'elk.layered.spacing.edgeNodeBetweenLayers': '20',
			'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
			'elk.spacing.nodeNode': '36',
			'elk.spacing.edgeNode': '20',
			'elk.spacing.edgeEdge': '14',
			'elk.spacing.edgeLabel': '4',
			'elk.spacing.componentComponent': '56',
			'elk.edgeLabels.placement': 'CENTER',
			'elk.layered.mergeEdges': 'false',
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES'
		},
		children: graph.nodes.map((node) => ({ id: node.id, ...nodeSize(node, view) })),
		edges
	});
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const nodes = (result.children ?? []).flatMap((c) => {
		const node = byId.get(c.id);
		if (!node) return [];
		return [{ node, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 120, height: c.height ?? 40 }];
	});
	const routes = new Map<number, Route>();
	for (const e of result.edges ?? []) {
		const section = e.sections?.[0];
		if (!section) continue;
		const l = e.labels?.[0];
		routes.set(Number(e.id.slice(1)), {
			points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
			label:
				l &&
				l.x !== undefined &&
				l.y !== undefined &&
				l.width !== undefined &&
				l.height !== undefined
					? { x: l.x + l.width / 2, y: l.y + l.height / 2 }
					: null
		});
	}
	return { nodes, routes };
}
