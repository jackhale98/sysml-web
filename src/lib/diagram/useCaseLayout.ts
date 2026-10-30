/**
 * How a use case diagram is laid out and drawn, as use case diagrams are:
 * the use cases of each subject in a column inside its boundary, in the
 * order they are written, a use case another includes right under it (set
 * in a little, the «include» arrow pointing down); the boundaries one under
 * another; the actors in a column on each side, outside, level with the use
 * cases they take part in. An actor stands on the left when it starts more
 * of its use cases than it joins (it is their first actor), else on the
 * right. A long list of use cases wraps into more columns.
 *
 * Not ELK's layered layout: it puts an included use case beside the one
 * that includes it, where the lines from the actors on the right cross it.
 *
 * Lines are straight, from figure to ellipse; `straightLine` gives their
 * ends wherever the nodes are dragged. A boundary is not a node: it is
 * drawn around its use cases where they are (`boundaries`), so it grows
 * when one is dragged out.
 */
import type { DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import type { Layout, Placed, XY } from './layout.ts';

/** Room around the use cases inside a boundary, and for its name on top. */
export const BOUNDARY = { pad: 28, title: 30 };
/**
 * Between two use cases (more above one that is included, for the «include»
 * arrow and its label), two columns, two boundaries; an included one's indent.
 */
const ROW_GAP = 24;
const INCLUDE_GAP = 44;
const COLUMN_GAP = 56;
const GROUP_GAP = 48;
const INDENT = 44;
/** Use cases in a column before the next one starts. */
const PER_COLUMN = 7;
/** Between a boundary and the actors' columns, and between two actors. */
const ACTOR_GAP = 96;
const ACTOR_SPACING = 28;

type Size = { width: number; height: number };

export function useCaseLayout(graph: DiagramGraph, sizeOf: (node: DiagramNode) => Size): Layout {
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
	const included = new Set(graph.edges.filter((e) => e.kind === 'include').map((e) => e.target));

	const at = new Map<string, XY>();
	let top = 0;
	for (const group of groups) {
		const y0 = top + (group.frame ? BOUNDARY.title + BOUNDARY.pad : 0);
		const columns = Math.ceil(group.ids.length / PER_COLUMN);
		const perColumn = Math.ceil(group.ids.length / columns);
		let [x, y, columnWidth, bottom] = [0, y0, 0, y0];
		group.ids.forEach((id, i) => {
			if (i && i % perColumn === 0) {
				x += columnWidth + COLUMN_GAP;
				[y, columnWidth] = [y0, 0];
			}
			const indent = included.has(id) && i % perColumn ? INDENT : 0;
			if (indent) y += INCLUDE_GAP - ROW_GAP;
			const { width, height } = sizes.get(id)!;
			at.set(id, { x: x + indent, y });
			columnWidth = Math.max(columnWidth, indent + width);
			y += height + ROW_GAP;
			bottom = Math.max(bottom, y - ROW_GAP);
		});
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
