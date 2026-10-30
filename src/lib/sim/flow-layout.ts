/**
 * Layout of an action flow in SysML v2 notation, for the runner: actions as
 * rounded boxes, `start` as a dot, `done` as a ringed dot, forks and joins
 * as bars, decisions and merges as diamonds, successions as arrows (with a
 * branch's guard) and item flows as dashed arrows. ELK places them, as it
 * does state machines (`layout.ts`).
 */
import type { FlowGraph, FlowNode } from './flow.ts';
import { roundedPath, simplify, type Direction, type Point } from './layout.ts';

export interface FlowBox {
	id: string;
	label: string;
	kind: FlowNode['kind'];
	/** `«perform»`, `«accept»`, …; null for a plain action. */
	keyword: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FlowEdgeGeometry {
	index: number;
	from: string;
	to: string;
	kind: 'succession' | 'flow';
	path: string;
	label: { x: number; y: number; width: number; height: number; text: string } | null;
}

export interface FlowLayout {
	direction: Direction;
	width: number;
	height: number;
	nodes: FlowBox[];
	edges: FlowEdgeGeometry[];
}

export const FLOW_METRICS = {
	nameChar: 7.4,
	monoChar: 6.6,
	boxHeight: 44,
	keywordHeight: 14,
	minWidth: 104,
	maxChars: 34,
	dot: 18,
	final: 24,
	bar: 8,
	barLength: 72,
	diamond: 30,
	margin: 20
};

const KEYWORDS: Partial<Record<FlowNode['kind'], string>> = {
	assign: 'assign',
	send: 'send',
	accept: 'accept',
	if: 'if',
	loop: 'loop',
	for: 'for',
	perform: 'perform',
	other: 'not run'
};

/** The text a box shows: the name, or the step as written (shortened). */
export function boxLabel(node: FlowNode): string {
	const text = node.label || node.id;
	const max = FLOW_METRICS.maxChars;
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function boxSize(node: FlowNode, direction: Direction): { width: number; height: number } {
	const m = FLOW_METRICS;
	switch (node.kind) {
		case 'start':
			return { width: m.dot, height: m.dot };
		case 'done':
			return { width: m.final, height: m.final };
		case 'fork':
		case 'join':
			return direction === 'DOWN'
				? { width: m.barLength, height: m.bar }
				: { width: m.bar, height: m.barLength };
		case 'decide':
		case 'merge':
			return { width: m.diamond, height: m.diamond };
		default: {
			const keyword = KEYWORDS[node.kind];
			const label = boxLabel(node);
			const width = Math.max(
				m.minWidth,
				label.length * (node.step && !node.label.match(/^[\w$']+$/) ? m.monoChar : m.nameChar) + 32
			);
			return { width: Math.round(width), height: m.boxHeight + (keyword ? m.keywordHeight : 0) };
		}
	}
}

interface ElkNode {
	id: string;
	width?: number;
	height?: number;
	x?: number;
	y?: number;
	layoutOptions?: Record<string, string>;
	children?: ElkNode[];
	edges?: ElkEdge[];
}

interface ElkEdge {
	id: string;
	sources: string[];
	targets: string[];
	labels?: { id?: string; text: string; width: number; height: number; x?: number; y?: number }[];
	sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
}

const edgeLabel = (e: FlowGraph['edges'][number]): string | null =>
	e.kind === 'flow' ? (e.item ?? e.toFeature ?? null) : e.guard ? `[${e.guard}]` : null;

export function elkFlowGraph(graph: FlowGraph, direction: Direction): ElkNode {
	const m = FLOW_METRICS;
	const ids = new Set(graph.nodes.map((n) => n.id));
	return {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': direction,
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.padding': `[top=${m.margin},left=${m.margin},bottom=${m.margin},right=${m.margin}]`,
			'elk.spacing.nodeNode': '22',
			'elk.spacing.edgeNode': '10',
			'elk.spacing.edgeEdge': '8',
			'elk.spacing.edgeLabel': '3',
			'elk.spacing.componentComponent': '36',
			'elk.layered.spacing.nodeNodeBetweenLayers': '26',
			'elk.layered.spacing.edgeNodeBetweenLayers': '10',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
			'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
			'elk.edgeLabels.placement': 'CENTER',
			'org.eclipse.elk.json.edgeCoords': 'ROOT',
			'org.eclipse.elk.json.shapeCoords': 'ROOT'
		},
		children: graph.nodes.map((n) => ({ id: n.id, ...boxSize(n, direction) })),
		edges: graph.edges
			.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
			.map((e) => {
				const text = edgeLabel(e);
				return {
					id: `e${e.index}`,
					sources: [e.from],
					targets: [e.to],
					labels: text
						? [
								{
									id: `l${e.index}`,
									text,
									width: Math.ceil(Math.min(text.length, 30) * m.monoChar + 12),
									height: 18
								}
							]
						: []
				};
			})
	};
}

export function fromElkFlow(graph: FlowGraph, result: ElkNode, direction: Direction): FlowLayout {
	const placed = new Map((result.children ?? []).map((c) => [c.id, c]));
	const nodes: FlowBox[] = graph.nodes.flatMap((n) => {
		const c = placed.get(n.id);
		if (!c) return [];
		return [
			{
				id: n.id,
				label: boxLabel(n),
				kind: n.kind,
				keyword: KEYWORDS[n.kind] ? `«${KEYWORDS[n.kind]}»` : null,
				x: c.x ?? 0,
				y: c.y ?? 0,
				width: c.width ?? 0,
				height: c.height ?? 0
			}
		];
	});
	const edges: FlowEdgeGeometry[] = [];
	for (const e of result.edges ?? []) {
		const index = Number(e.id.slice(1));
		const source = graph.edges.find((x) => x.index === index);
		const section = e.sections?.[0];
		if (!source || !section) continue;
		const points = simplify([section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
		const l = e.labels?.[0];
		const text = edgeLabel(source);
		edges.push({
			index,
			from: source.from,
			to: source.to,
			kind: source.kind,
			path: roundedPath(points),
			label:
				l && text
					? {
							x: l.x ?? 0,
							y: l.y ?? 0,
							width: l.width,
							height: l.height,
							text: text.length > 30 ? `${text.slice(0, 29)}…` : text
						}
					: null
		});
	}
	return {
		direction,
		width: Math.ceil((result as { width?: number }).width ?? 0),
		height: Math.ceil((result as { height?: number }).height ?? 0),
		nodes,
		edges
	};
}

type Elk = { layout(graph: ElkNode): Promise<ElkNode & { width?: number; height?: number }> };
let elk: Promise<Elk> | undefined;

/** Lay out an action flow in the given direction. */
export async function layoutFlow(graph: FlowGraph, direction: Direction): Promise<FlowLayout> {
	elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default() as unknown as Elk);
	const result = await (await elk).layout(elkFlowGraph(graph, direction));
	return fromElkFlow(graph, result, direction);
}
