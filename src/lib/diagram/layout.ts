/**
 * Automatic layout of engine diagram graphs with ELK (layered, orthogonal).
 * ELK is loaded on first use so it stays out of the initial bundle.
 */
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { LABEL_HEIGHT, labelWidth } from './labels.svelte.ts';
import { edgeLabelText, MAX_ROWS, notationOf, type BorderPort } from './notation.ts';
import { useCaseLayout } from './useCaseLayout.ts';

export interface Placed {
	node: DiagramNode;
	x: number;
	y: number;
	width: number;
	height: number;
}

export type Direction = 'DOWN' | 'RIGHT';

/**
 * The most nodes a diagram lays out. ELK runs on the page's main thread and
 * its time grows faster than the node count; a bigger view says how to
 * narrow it instead (docs/performance.md).
 */
export const MAX_NODES = 500;

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
		case 'actor':
			// A stick figure with its name below.
			return {
				width: Math.round(Math.min(180, Math.max(72, node.label.length * NAME_CHAR + 12))),
				height: 84
			};
		case 'usecase':
			return useCaseSize(node.label, n.keyword, objectiveOf(n));
	}
	const m = METRICS;
	const rows = n.compartments.flatMap((c) => c.rows);
	const { sideBySide, width: portsWidth } = portColumns(n.ports);
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

/** The text of a use case's objective, which its ellipse shows under its name. */
export function objectiveOf(n: {
	compartments: { title: string; rows: string[] }[];
}): string | null {
	return n.compartments.find((c) => c.title === 'objective')?.rows[0] ?? null;
}

/** Lines of objective a use case's ellipse shows at most. */
export const OBJECTIVE_LINES = 3;
const OBJECTIVE_CHAR = 6.1;

/**
 * A use case's ellipse: wide enough that its keyword, name and objective
 * fit in the box inscribed in it (about 70% of its width and height).
 */
export function useCaseSize(
	label: string,
	keyword: string,
	objective: string | null
): { width: number; height: number } {
	const text = Math.max(label.length * NAME_CHAR, (keyword.length + 2) * 6.4);
	const width = Math.round(Math.min(300, Math.max(objective ? 230 : 160, text / 0.72 + 16)));
	if (!objective) return { width, height: 72 };
	const perLine = Math.max(10, Math.floor((width * 0.68) / OBJECTIVE_CHAR));
	const lines = Math.min(OBJECTIVE_LINES, Math.ceil(objective.length / perLine));
	return { width, height: 76 + lines * 15 };
}

/** Ports on both borders sit side by side on a row, when that fits; else the right ones go below. */
function portColumns(ports: BorderPort[]): { sideBySide: boolean; width: number } {
	const sideWidth = (side: 'left' | 'right') =>
		Math.max(
			0,
			...ports.filter((p) => p.side === side).map((p) => p.label.length * MONO_CHAR + 14)
		);
	const [left, right] = [sideWidth('left'), sideWidth('right')];
	const sideBySide = left + right + 36 <= METRICS.maxPortsWidth;
	return { sideBySide, width: sideBySide ? left + right + 36 : Math.max(left, right) + 28 };
}

/** Where a box's border ports are: by port key, the middle of its square, from the box's top left. */
export function portAnchors(
	node: DiagramNode,
	view = 'general'
): Map<string, XY & { side: 'left' | 'right' }> {
	const anchors = new Map<string, XY & { side: 'left' | 'right' }>();
	const { ports } = notationOf(node, view);
	if (!ports.length) return anchors;
	const { width, height } = nodeSize(node, view);
	const { sideBySide } = portColumns(ports);
	const left = ports.filter((p) => p.side === 'left');
	const right = ports.filter((p) => p.side === 'right');
	const m = METRICS;
	const shown = sideBySide ? Math.max(left.length, right.length) : left.length + right.length;
	// The ports compartment closes the box: half its padding, then a row per port.
	const top = height - m.compartmentPad - shown * m.row + m.compartmentPad / 2;
	left.forEach((p, i) => anchors.set(p.key, { side: 'left', x: 0, y: top + (i + 0.5) * m.row }));
	const below = sideBySide ? 0 : left.length;
	right.forEach((p, i) =>
		anchors.set(p.key, { side: 'right', x: width, y: top + (below + i + 0.5) * m.row })
	);
	return anchors;
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
		kind === 'satisfy' || kind === 'verify' || kind === 'allocate' || kind === 'include'
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
	if (view === 'usecases') return useCaseLayout(graph, (n) => nodeSize(n, view));
	const ids = new Set(graph.nodes.map((n) => n.id));
	const engine = await getElk();
	// Border ports, fixed where the box draws them, so lines run to them.
	const anchors = new Map(graph.nodes.map((n) => [n.id, portAnchors(n, view)]));
	const portId = (node: string, key: string | undefined) =>
		key && anchors.get(node)?.has(key) ? `${node}\u0000${key}` : node;
	const edges = graph.edges.flatMap((e, i) => {
		if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) return [];
		const source = portId(e.source, e.source_port);
		const target = portId(e.target, e.target_port);
		const [from, to] = UPWARD.has(e.kind) ? [target, source] : [source, target];
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
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			// A state machine reads from where it starts: the transitions that go back
			// up are the ones to states declared earlier.
			...(view === 'states' ? { 'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER' } : {})
		},
		children: graph.nodes.map((node) => {
			const ports = [...(anchors.get(node.id) ?? [])].map(([key, at]) => ({
				id: `${node.id}\u0000${key}`,
				x: at.x,
				y: at.y,
				width: 0,
				height: 0,
				layoutOptions: { 'elk.port.side': at.side === 'left' ? 'WEST' : 'EAST' }
			}));
			return {
				id: node.id,
				...nodeSize(node, view),
				...(ports.length ? { ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } } : {})
			};
		}),
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
