/**
 * How a use case diagram is laid out and drawn: the use cases of each
 * subject inside its boundary (ELK lays them out, so a use case sits left of
 * those it includes), the boundaries one under another, and the actors in a
 * column on each side, outside, level with the use cases they take part in.
 * An actor stands on the left when it starts more of its use cases than
 * it joins (it is their first actor), else on the right.
 *
 * Lines are straight, from figure to ellipse, as use case diagrams draw
 * them; `straightLine` gives their ends wherever the nodes are dragged.
 * A boundary is not a node: it is drawn around its use cases where they
 * are (`boundaries`), so it grows when one is dragged out.
 */
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import type { Layout, Placed, XY } from './layout.ts';

/** Room around the use cases inside a boundary, and for its name on top. */
export const BOUNDARY = { pad: 28, title: 30 };
/** Between two boundaries, and between a boundary and the actors' columns. */
const GROUP_GAP = 48;
const ACTOR_GAP = 96;
const ACTOR_SPACING = 28;

interface Elk {
	layout(graph: unknown): Promise<{
		children?: { id: string; x?: number; y?: number }[];
	}>;
}

type Size = { width: number; height: number };

export async function useCaseLayout(
	graph: DiagramGraph,
	sizeOf: (node: DiagramNode) => Size,
	elk: Elk
): Promise<Layout> {
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const sizes = new Map(graph.nodes.map((n) => [n.id, sizeOf(n)]));
	const useCases = graph.nodes.filter((n) => n.kind !== 'actor');
	const framed = new Set(graph.subgraphs.flatMap((s) => s.node_ids));
	const groups = [
		...graph.subgraphs.map((s) => ({
			frame: true,
			ids: s.node_ids.filter((id) => byId.has(id))
		})),
		{ frame: false, ids: useCases.filter((n) => !framed.has(n.id)).map((n) => n.id) }
	].filter((g) => g.ids.length);

	const at = new Map<string, XY>();
	let top = 0;
	for (const group of groups) {
		const members = new Set(group.ids);
		const inside = graph.edges.filter(
			(e) => members.has(e.source) && members.has(e.target) && e.source !== e.target
		);
		const result = await elk.layout({
			id: 'group',
			layoutOptions: {
				'elk.algorithm': 'layered',
				'elk.direction': 'RIGHT',
				'elk.spacing.nodeNode': '28',
				'elk.layered.spacing.nodeNodeBetweenLayers': '72',
				'elk.spacing.componentComponent': '28',
				// Use cases that include nothing stack in a column, not a row.
				'elk.aspectRatio': '0.3',
				'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES'
			},
			children: group.ids.map((id) => ({ id, ...sizes.get(id)! })),
			edges: inside.map((e, i) => {
				// A specialization reads from the general use case, left of the specific ones.
				const [from, to] =
					e.kind === 'specialization' ? [e.target, e.source] : [e.source, e.target];
				return { id: `e${i}`, sources: [from], targets: [to] };
			})
		});
		const placed = (result.children ?? []).map((c) => ({ id: c.id, x: c.x ?? 0, y: c.y ?? 0 }));
		const minX = Math.min(...placed.map((p) => p.x));
		const minY = Math.min(...placed.map((p) => p.y));
		const offset = group.frame ? BOUNDARY.title + BOUNDARY.pad : 0;
		let bottom = 0;
		for (const p of placed) {
			const y = top + offset + p.y - minY;
			at.set(p.id, { x: p.x - minX, y });
			bottom = Math.max(bottom, y + sizes.get(p.id)!.height);
		}
		top = bottom + (group.frame ? BOUNDARY.pad : 0) + GROUP_GAP;
	}

	placeActors(graph, sizes, at);
	const nodes: Placed[] = graph.nodes.map((node) => ({
		node,
		...(at.get(node.id) ?? { x: 0, y: 0 }),
		...sizes.get(node.id)!
	}));
	return { nodes, routes: new Map() };
}

/** Each actor in the left or the right column, level with its use cases, none overlapping. */
function placeActors(graph: DiagramGraph, sizes: Map<string, Size>, at: Map<string, XY>) {
	const actors = graph.nodes.filter((n) => n.kind === 'actor').map((n) => n.id);
	if (!actors.length) return;
	const links = graph.edges.filter((e) => e.kind === 'actor');
	// The first actor of a use case is the one who starts it. An actor that starts more
	// of its use cases than it joins stands on the left, the others on the right.
	const score = new Map<string, number>();
	const started = new Set<string>();
	for (const e of links) {
		const first = !started.has(e.target);
		started.add(e.target);
		score.set(e.source, (score.get(e.source) ?? 0) + (first ? 1 : -1));
	}
	const linked = (id: string) => links.filter((e) => e.source === id).map((e) => e.target);
	const side = new Map<string, 'left' | 'right'>();
	for (const id of actors) if (score.has(id)) side.set(id, score.get(id)! > 0 ? 'left' : 'right');
	// An actor without use cases (a general one) stands with those that specialize it.
	for (const id of actors) {
		if (side.has(id)) continue;
		const specific = graph.edges.find((e) => e.kind === 'specialization' && e.target === id);
		side.set(id, (specific && side.get(specific.source)) ?? 'left');
	}

	const boxes = [...at].map(([id, p]) => ({ ...p, ...sizes.get(id)! }));
	const left = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0;
	const right = boxes.length ? Math.max(...boxes.map((b) => b.x + b.width)) : 0;
	const middle = (id: string) => at.get(id)!.y + sizes.get(id)!.height / 2;
	const wanted = new Map<string, number>();
	for (const id of actors) {
		const ys = linked(id)
			.filter((u) => at.has(u))
			.map(middle);
		if (ys.length) wanted.set(id, ys.reduce((a, b) => a + b, 0) / ys.length);
	}
	for (const id of actors) {
		if (wanted.has(id)) continue;
		const ys = graph.edges
			.filter((e) => e.kind === 'specialization' && e.target === id && wanted.has(e.source))
			.map((e) => wanted.get(e.source)!);
		wanted.set(id, ys.length ? Math.max(...ys) + 120 : 0);
	}

	for (const column of ['left', 'right'] as const) {
		const ids = actors
			.filter((id) => side.get(id) === column)
			.sort((a, b) => wanted.get(a)! - wanted.get(b)!);
		const framed = graph.subgraphs.length ? BOUNDARY.pad : 0;
		let floor = -Infinity;
		for (const id of ids) {
			const { width, height } = sizes.get(id)!;
			const y = Math.max(wanted.get(id)! - height / 2, floor);
			const x = column === 'left' ? left - framed - ACTOR_GAP - width : right + framed + ACTOR_GAP;
			at.set(id, { x: Math.round(x), y: Math.round(y) });
			floor = y + height + ACTOR_SPACING;
		}
	}
}

/** A drawn boundary: its subject's name and where it is, from where its use cases are now. */
export interface Boundary {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export function boundaries(
	subgraphs: DiagramGraph['subgraphs'],
	nodes: readonly { id: string; x: number; y: number; width: number; height: number }[]
): Boundary[] {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	return subgraphs.flatMap((s) => {
		const members = s.node_ids.flatMap((id) => byId.get(id) ?? []);
		if (!members.length) return [];
		const x = Math.min(...members.map((m) => m.x)) - BOUNDARY.pad;
		const y = Math.min(...members.map((m) => m.y)) - BOUNDARY.pad - BOUNDARY.title;
		const x2 = Math.max(...members.map((m) => m.x + m.width)) + BOUNDARY.pad;
		const y2 = Math.max(...members.map((m) => m.y + m.height)) + BOUNDARY.pad;
		return [{ id: s.id, label: s.label, x, y, width: x2 - x, height: y2 - y }];
	});
}

/** A node's outline, for where a straight line meets it. */
export interface Outline {
	x: number;
	y: number;
	width: number;
	height: number;
	/** `ellipse` for a use case, `actor` for a stick figure, else a box. */
	shape: 'ellipse' | 'actor' | 'box';
}

/** Where an actor's figure is in its node: the head and body, above its name. */
export const FIGURE = { width: 30, height: 60 };

function centre(o: Outline): XY {
	return o.shape === 'actor'
		? { x: o.x + o.width / 2, y: o.y + FIGURE.height / 2 }
		: { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}

/** Where the ray from the outline's centre towards `to` leaves it. */
function exit(o: Outline, to: XY): XY {
	const c = centre(o);
	const dx = to.x - c.x;
	const dy = to.y - c.y;
	if (!dx && !dy) return c;
	if (o.shape === 'ellipse') {
		const a = o.width / 2;
		const b = o.height / 2;
		const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
		return { x: c.x + dx * t, y: c.y + dy * t };
	}
	const half =
		o.shape === 'actor'
			? { x: FIGURE.width / 2 + 4, y: FIGURE.height / 2 }
			: { x: o.width / 2, y: o.height / 2 };
	const t = Math.min(dx ? half.x / Math.abs(dx) : Infinity, dy ? half.y / Math.abs(dy) : Infinity);
	return { x: c.x + dx * t, y: c.y + dy * t };
}

/** A straight line between two nodes, from border to border. */
export function straightLine(from: Outline, to: Outline): [XY, XY] {
	return [exit(from, centre(to)), exit(to, centre(from))];
}

/** The outline a node of a use case diagram has, at a place and size. */
export function outlineOf(
	node: Pick<DiagramNode, 'kind'>,
	box: { x: number; y: number; width: number; height: number }
): Outline {
	const shape = node.kind === 'use_case' ? 'ellipse' : node.kind === 'actor' ? 'actor' : 'box';
	return { ...box, shape };
}
