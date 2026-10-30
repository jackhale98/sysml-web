/**
 * Geometry of a fault tree diagram (`FaultTreeDrawing`s): each tree
 * top-down, an event's box with its symbol under it (its gate, or a basic
 * event's circle, an undeveloped event's diamond, a condition's oval), and
 * from each gate a line down to a bus over its causes. A tidy tree: leaves
 * side by side in the order the model writes them, each parent centred
 * over its causes. An event under several gates (a repeated event) is
 * drawn under each, marked as repeated, as fault tree diagrams do. Pure.
 */
import type { FaultTreeDrawing, FaultTreeEvent } from '#lib/engine/types.ts';

export const FAULT_TREE = {
	margin: 24,
	boxWidth: 184,
	boxHeight: 62,
	/** Between a box and the symbol under it. */
	symbolGap: 6,
	symbolWidth: 36,
	symbolHeight: 34,
	/** Above a row of causes: where the bus from their gate runs. */
	busRise: 18,
	/** Between one row's symbols and the next row's boxes. */
	rowGap: 40,
	columnGap: 18,
	/** Between two trees, one under the other. */
	treeGap: 56
};

export interface PlacedEvent {
	/** Unique in the drawing: the path from the top event (a repeated event is placed once per path). */
	key: string;
	event: FaultTreeEvent;
	/** The box's top-left corner. */
	x: number;
	y: number;
	/** The symbol's centre x and top y. */
	cx: number;
	symbolTop: number;
	/** Drawn elsewhere in the same tree too. */
	repeated: boolean;
	depth: number;
}

export interface TreeLayout {
	drawing: FaultTreeDrawing;
	events: PlacedEvent[];
	/** Connector paths: box to symbol, gate down to the bus, bus across, down to each cause. */
	links: string[];
	/** The tree's top y (for its heading). */
	y: number;
	width: number;
	height: number;
}

export interface FaultTreeLayout {
	trees: TreeLayout[];
	width: number;
	height: number;
}

const G = FAULT_TREE;
const rowHeight = G.boxHeight + G.symbolGap + G.symbolHeight + G.rowGap;

export function layoutFaultTrees(drawings: FaultTreeDrawing[]): FaultTreeLayout {
	const trees: TreeLayout[] = [];
	let y = G.margin;
	let width = 0;
	for (const drawing of drawings) {
		const tree = layoutTree(drawing, G.margin, y);
		trees.push(tree);
		y += tree.height + G.treeGap;
		width = Math.max(width, tree.width + 2 * G.margin);
	}
	return { trees, width, height: trees.length ? y - G.treeGap + G.margin : 0 };
}

function layoutTree(drawing: FaultTreeDrawing, left: number, top: number): TreeLayout {
	const byId = new Map(drawing.events.map((e) => [e.id, e]));
	// How many places each event is drawn in (a repeated event, more than one).
	const uses = new Map<string, number>();
	const count = (id: string, path: string[]) => {
		uses.set(id, (uses.get(id) ?? 0) + 1);
		for (const input of byId.get(id)?.inputs ?? [])
			if (!path.includes(input)) count(input, [...path, id]);
	};
	count(drawing.top, []);

	interface Node {
		key: string;
		event: FaultTreeEvent;
		children: Node[];
		width: number;
		depth: number;
	}
	const build = (id: string, path: string[], depth: number): Node | null => {
		const event = byId.get(id);
		if (!event) return null;
		const children = event.inputs
			.filter((input) => !path.includes(input))
			.map((input) => build(input, [...path, id], depth + 1))
			.filter((n): n is Node => !!n);
		const span =
			children.reduce((sum, c) => sum + c.width, 0) + G.columnGap * (children.length - 1);
		return {
			key: [...path, id].join('/'),
			event,
			children,
			width: Math.max(G.boxWidth, children.length ? span : 0),
			depth
		};
	};
	const root = build(drawing.top, [], 0);
	const events: PlacedEvent[] = [];
	const links: string[] = [];
	let depthMax = 0;
	const place = (node: Node, x0: number) => {
		depthMax = Math.max(depthMax, node.depth);
		const cx = x0 + node.width / 2;
		const y = top + node.depth * rowHeight;
		const symbolTop = y + G.boxHeight + G.symbolGap;
		events.push({
			key: node.key,
			event: node.event,
			x: cx - G.boxWidth / 2,
			y,
			cx,
			symbolTop,
			repeated: (uses.get(node.event.id) ?? 0) > 1,
			depth: node.depth
		});
		links.push(`M ${cx} ${y + G.boxHeight} V ${symbolTop}`);
		if (!node.children.length) return;
		const busY = y + rowHeight - G.busRise;
		let x = x0;
		const centres: number[] = [];
		for (const child of node.children) {
			place(child, x);
			centres.push(x + child.width / 2);
			x += child.width + G.columnGap;
		}
		const childTop = y + rowHeight;
		links.push(`M ${cx} ${symbolTop + G.symbolHeight} V ${busY}`);
		if (centres.length > 1)
			links.push(`M ${Math.min(...centres, cx)} ${busY} H ${Math.max(...centres, cx)}`);
		for (const c of centres) links.push(`M ${c} ${busY} V ${childTop}`);
	};
	if (root) place(root, left);
	return {
		drawing,
		events,
		links,
		y: top,
		width: root?.width ?? 0,
		height: root ? depthMax * rowHeight + G.boxHeight + G.symbolGap + G.symbolHeight : 0
	};
}

/** A gate's or a basic event's symbol, centred on `cx` from `top`, as an SVG path. */
export function symbolPath(event: FaultTreeEvent, cx: number, top: number): string {
	const w = G.symbolWidth / 2;
	const h = G.symbolHeight;
	const b = top + h;
	if (event.gate === 'and')
		return `M ${cx - w} ${b} V ${top + w} A ${w} ${w} 0 0 1 ${cx + w} ${top + w} V ${b} Z`;
	if (event.gate === 'or' || event.gate === 'atLeast')
		return `M ${cx - w} ${b} Q ${cx} ${b - 9} ${cx + w} ${b} Q ${cx + w - 2} ${top + 12} ${cx} ${top} Q ${cx - w + 2} ${top + 12} ${cx - w} ${b} Z`;
	if (event.gate === 'inhibit')
		return `M ${cx} ${top} L ${cx + w} ${top + h / 4} V ${b - h / 4} L ${cx} ${b} L ${cx - w} ${b - h / 4} V ${top + h / 4} Z`;
	const r = h / 2 - 2;
	const cy = top + h / 2;
	if (event.kind === 'undeveloped')
		return `M ${cx} ${cy - r} L ${cx + r + 4} ${cy} L ${cx} ${cy + r} L ${cx - r - 4} ${cy} Z`;
	if (event.kind === 'conditioning')
		return `M ${cx - w} ${cy} A ${w} ${r - 3} 0 1 0 ${cx + w} ${cy} A ${w} ${r - 3} 0 1 0 ${cx - w} ${cy} Z`;
	return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

/** How a gate reads in words: `OR`, `AND`, `2 of 3`, `INHIBIT`. */
export function gateWords(event: FaultTreeEvent): string {
	switch (event.gate) {
		case 'and':
			return 'AND';
		case 'or':
			return 'OR';
		case 'inhibit':
			return 'INHIBIT';
		case 'atLeast':
			return `${event.k ?? '?'} of ${event.inputs.length}`;
		default:
			return '';
	}
}
