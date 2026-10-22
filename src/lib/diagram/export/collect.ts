/**
 * What an exported diagram draws, read from the canvas as it stands: every
 * node where it is (not only those in view), each edge's route as drawn,
 * and where its label sits. Selection, highlights and handles are left out.
 */
import type { Edge, Node } from '@xyflow/svelte';
import { edgeText } from '../layout.ts';
import type { SysmlEdgeData, SysmlNodeData } from '../types.ts';
import type { ExportDiagram, IconShape, XY } from './svg.ts';

const ICON_ATTRS = [
	'd',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'width',
	'height',
	'points'
];

/** The kind icon a node shows, as shapes (Lucide draws it as plain SVG). */
function iconOf(element: Element | null): IconShape[] | undefined {
	const svg = element?.querySelector('.keyword svg');
	if (!svg) return undefined;
	return [...svg.children].map((child) => [
		child.tagName.toLowerCase(),
		Object.fromEntries(
			ICON_ATTRS.flatMap((name) => {
				const value = child.getAttribute(name);
				return value === null ? [] : [[name, value]];
			})
		)
	]);
}

const near = (a: XY | undefined, b: XY) =>
	!!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

export function collectDiagram(
	host: HTMLElement,
	title: string,
	view: string,
	nodes: Node<SysmlNodeData>[],
	edges: Edge<SysmlEdgeData>[],
	labelPositions: Record<string, XY>
): ExportDiagram {
	const nodeEl = (id: string) =>
		host.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
	const position = new Map(nodes.map((n) => [n.id, n.position]));
	return {
		title,
		view,
		nodes: nodes.map((n) => ({
			id: n.id,
			x: n.position.x,
			y: n.position.y,
			width: n.width ?? n.measured?.width ?? 0,
			height: n.height ?? n.measured?.height ?? 0,
			node: n.data.node,
			icon: iconOf(nodeEl(n.id))
		})),
		edges: edges.flatMap((e) => {
			if (!e.data) return [];
			const drawn = host
				.querySelector(
					`.svelte-flow__edge[data-id="${CSS.escape(e.id)}"] path.svelte-flow__edge-path`
				)
				?.getAttribute('d');
			const route = e.data.route;
			// ELK's route holds while both ends are where the layout put them (as SysmlEdge draws it).
			const routed =
				route && near(position.get(e.source), route.from) && near(position.get(e.target), route.to)
					? route
					: null;
			const path =
				drawn ??
				(routed ? routed.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') : null);
			if (!path) return [];
			return [
				{
					kind: e.data.kind,
					path,
					reversed: e.data.reversed,
					text: edgeText(e.data.kind, e.data.label),
					labelAt: routed?.label ?? labelPositions[e.id] ?? null
				}
			];
		})
	};
}
