/**
 * Layout of a state machine in SysML v2 notation: states as rounded boxes
 * (nested states inside their parent, parallel regions side by side),
 * pseudostates as dots, and transitions as orthogonal arrows with their
 * `trigger [guard] / effect` labels. ELK does the placement; it is loaded on
 * first use so it stays out of the initial bundle.
 */
import type { StateMachine } from '#lib/engine/types.ts';

export type Direction = 'DOWN' | 'RIGHT';
export type MachineState = StateMachine['states'][number];
export type MachineTransition = StateMachine['transitions'][number];

export interface Point {
	x: number;
	y: number;
}

export interface Row {
	keyword: 'entry' | 'do' | 'exit';
	text: string;
}

export interface StateBox {
	/** The state's path, e.g. `on.motors.idle`. */
	id: string;
	label: string;
	/** `region`: a child of a parallel state, drawn as a compartment, not a box. */
	kind: 'initial' | 'final' | 'state' | 'region';
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
	parent: string | null;
	composite: boolean;
	parallel: boolean;
	rows: Row[];
	doc?: string;
	line: number;
}

export interface EdgeLabel {
	x: number;
	y: number;
	width: number;
	height: number;
	lines: LabelLine[];
}

/** A label line, split into its parts so they can be styled. */
export type LabelLine = { part: 'trigger' | 'guard' | 'effect'; text: string }[];

export interface EdgeGeometry {
	/** Index in `machine.transitions` (the engine's `enabled[].index`). */
	index: number;
	from: string;
	to: string;
	points: Point[];
	/** SVG path with rounded corners; also the token's motion path. */
	path: string;
	label: EdgeLabel | null;
}

export interface Separator {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface MachineLayout {
	direction: Direction;
	width: number;
	height: number;
	/** Outer boxes first, so children paint over their parents. */
	states: StateBox[];
	edges: EdgeGeometry[];
	/** Dashed lines between the regions of parallel states. */
	separators: Separator[];
}

/** Box metrics shared with MachineDiagram.svelte (px). */
export const METRICS = {
	head: 36,
	row: 18,
	rowsPad: 10,
	initial: 16,
	final: 22,
	minWidth: 96,
	nameChar: 7.6,
	monoChar: 6.6,
	labelLine: 15,
	labelPad: 6,
	labelMaxChars: 24,
	regionHead: 24,
	pad: 16,
	margin: 20
};

/** `trigger [guard] / effect`, split over lines when long. */
export function labelLines(t: MachineTransition): LabelLine[] {
	const max = METRICS.labelMaxChars;
	const parts: LabelLine = [];
	const add = (part: LabelLine[number]['part'], text: string) => {
		// Break a long part between words, so one guard does not make a label very wide.
		let chunk = '';
		for (const word of text.split(' ')) {
			if (chunk && chunk.length + 1 + word.length > max) {
				parts.push({ part, text: chunk });
				chunk = word;
			} else chunk = chunk ? `${chunk} ${word}` : word;
		}
		if (chunk) parts.push({ part, text: chunk });
	};
	if (t.trigger) add('trigger', t.trigger);
	if (t.guard) add('guard', `[${t.guard}]`);
	if (t.effect) add('effect', `/ ${t.effect}`);
	const lines: LabelLine[] = [];
	let line: LabelLine = [];
	let length = 0;
	for (const p of parts) {
		if (line.length && length + 1 + p.text.length > max) {
			lines.push(line);
			line = [];
			length = 0;
		}
		length += (line.length ? 1 : 0) + p.text.length;
		line.push(p);
	}
	if (line.length) lines.push(line);
	return lines;
}

export function lineText(line: LabelLine): string {
	return line.map((p) => p.text).join(' ');
}

/** The full label text, on one line. */
export function labelText(t: MachineTransition): string {
	return labelLines(t).map(lineText).join(' ');
}

function labelSize(lines: LabelLine[]): { width: number; height: number } {
	const chars = Math.max(...lines.map((l) => lineText(l).length));
	return {
		width: Math.ceil(chars * METRICS.monoChar + 16),
		height: lines.length * METRICS.labelLine + METRICS.labelPad
	};
}

export function rowsOf(s: MachineState): Row[] {
	const rows: Row[] = [];
	if (s.entry) rows.push({ keyword: 'entry', text: s.entry });
	if (s.do) rows.push({ keyword: 'do', text: s.do });
	if (s.exit) rows.push({ keyword: 'exit', text: s.exit });
	return rows;
}

/** Height of the name and entry/do/exit compartments. */
export function headHeight(s: MachineState): number {
	const rows = rowsOf(s).length;
	return METRICS.head + (rows ? rows * METRICS.row + METRICS.rowsPad : 0);
}

/** Size of a simple (non-composite) state. */
export function stateSize(s: MachineState): { width: number; height: number } {
	if (s.kind === 'initial') return { width: METRICS.initial, height: METRICS.initial };
	if (s.kind === 'final') return { width: METRICS.final, height: METRICS.final };
	const rows = rowsOf(s);
	const width = Math.max(
		METRICS.minWidth,
		s.label.length * METRICS.nameChar + 36,
		...rows.map((r) => (r.keyword.length + 1 + r.text.length) * METRICS.monoChar + 28)
	);
	return { width: Math.round(width), height: headHeight(s) };
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

/** Children of each state path (`''` is the machine itself), in model order. */
export function childrenOf(machine: StateMachine): Map<string, MachineState[]> {
	const map = new Map<string, MachineState[]>();
	for (const s of machine.states) {
		const key = s.parent ?? '';
		const list = map.get(key) ?? [];
		list.push(s);
		map.set(key, list);
	}
	return map;
}

/** Whether a state is a region: a child of a parallel state with states of its own. */
function isRegion(
	s: MachineState,
	byName: Map<string, MachineState>,
	children: Map<string, MachineState[]>
) {
	return !!s.parent && !!byName.get(s.parent)?.parallel && (children.get(s.name)?.length ?? 0) > 0;
}

/** The ELK graph for a machine, in absolute coordinates. */
export function elkGraph(machine: StateMachine, direction: Direction): ElkNode {
	const children = childrenOf(machine);
	const byName = new Map(machine.states.map((s) => [s.name, s]));
	const m = METRICS;

	const node = (s: MachineState): ElkNode => {
		const kids = children.get(s.name) ?? [];
		if (!kids.length) return { id: s.name, ...stateSize(s) };
		const region = isRegion(s, byName, children);
		const top = region ? m.regionHead : headHeight(s) + 10;
		const side = region ? 10 : m.pad;
		const minWidth = Math.max(m.minWidth, s.label.length * m.nameChar + 40);
		return {
			id: s.name,
			layoutOptions: {
				'elk.padding': `[top=${top},left=${side},bottom=${side},right=${side}]`,
				'elk.nodeSize.constraints': 'MINIMUM_SIZE',
				'elk.nodeSize.minimum': `(${Math.round(minWidth)},${top + 24})`,
				...(s.parallel
					? {
							'elk.spacing.componentComponent': '36',
							'elk.spacing.nodeNode': '36'
						}
					: {})
			},
			children: kids.map(node)
		};
	};

	const ids = new Set(machine.states.map((s) => s.name));
	const edges: ElkEdge[] = [];
	machine.transitions.forEach((t, index) => {
		if (!ids.has(t.from) || !ids.has(t.to)) return;
		const lines = labelLines(t);
		edges.push({
			id: `t${index}`,
			sources: [t.from],
			targets: [t.to],
			labels: lines.length ? [{ id: `l${index}`, text: labelText(t), ...labelSize(lines) }] : []
		});
	});

	return {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': direction,
			'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.padding': `[top=${m.margin},left=${m.margin},bottom=${m.margin},right=${m.margin}]`,
			'elk.spacing.nodeNode': '16',
			'elk.spacing.edgeNode': '8',
			'elk.spacing.edgeEdge': '6',
			'elk.spacing.edgeLabel': '2',
			'elk.spacing.componentComponent': '40',
			'elk.layered.spacing.nodeNodeBetweenLayers': '20',
			'elk.layered.spacing.edgeNodeBetweenLayers': '8',
			'elk.layered.spacing.edgeEdgeBetweenLayers': '6',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
			'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
			'elk.layered.mergeEdges': 'false',
			'elk.edgeLabels.placement': 'CENTER',
			'org.eclipse.elk.json.edgeCoords': 'ROOT',
			'org.eclipse.elk.json.shapeCoords': 'ROOT'
		},
		children: (children.get('') ?? []).map(node),
		edges
	};
}

/** Turn ELK's result into boxes, paths and separators. */
export function fromElk(machine: StateMachine, result: ElkNode, direction: Direction) {
	const children = childrenOf(machine);
	const byName = new Map(machine.states.map((s) => [s.name, s]));
	const placed = new Map<string, { x: number; y: number; width: number; height: number }>();
	const visit = (n: ElkNode) => {
		for (const c of n.children ?? []) {
			placed.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
			visit(c);
		}
	};
	visit(result);

	const depthOf = (s: MachineState): number => {
		let depth = 0;
		for (let p = s.parent; p; p = byName.get(p)?.parent) depth++;
		return depth;
	};

	const states: StateBox[] = [];
	for (const s of machine.states) {
		const box = placed.get(s.name);
		if (!box) continue;
		const composite = (children.get(s.name)?.length ?? 0) > 0;
		states.push({
			id: s.name,
			label: s.label,
			kind: isRegion(s, byName, children) ? 'region' : s.kind,
			...box,
			depth: depthOf(s),
			parent: s.parent ?? null,
			composite,
			parallel: !!s.parallel && composite,
			rows: rowsOf(s),
			doc: s.doc,
			line: s.line
		});
	}
	states.sort((a, b) => a.depth - b.depth);

	// Regions: stretch them across their parallel state and divide with dashed lines.
	const separators: Separator[] = [];
	for (const p of states.filter((s) => s.parallel)) {
		const regions = states.filter((s) => s.parent === p.id && s.kind === 'region');
		if (regions.length < 2) continue;
		const top = p.y + headHeight(byName.get(p.id)!);
		const sideBySide = regions.every((a, i) =>
			regions.every((b, j) => i === j || a.x + a.width <= b.x || b.x + b.width <= a.x)
		);
		const axis = sideBySide ? 'x' : 'y';
		const size = sideBySide ? 'width' : 'height';
		regions.sort((a, b) => a[axis] - b[axis]);
		for (let i = 0; i < regions.length - 1; i++) {
			const a = regions[i]!;
			const b = regions[i + 1]!;
			const at = (a[axis] + a[size] + b[axis]) / 2;
			separators.push(
				sideBySide
					? { x1: at, y1: top, x2: at, y2: p.y + p.height }
					: { x1: p.x, y1: at, x2: p.x + p.width, y2: at }
			);
		}
	}

	const edges: EdgeGeometry[] = [];
	for (const e of result.edges ?? []) {
		const index = Number(e.id.slice(1));
		const t = machine.transitions[index];
		const section = e.sections?.[0];
		if (!t || !section) continue;
		const points = simplify([section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
		const l = e.labels?.[0];
		const lines = labelLines(t);
		edges.push({
			index,
			from: t.from,
			to: t.to,
			points,
			path: roundedPath(points),
			label:
				l && lines.length
					? { x: l.x ?? 0, y: l.y ?? 0, width: l.width, height: l.height, lines }
					: null
		});
	}
	edges.sort((a, b) => a.index - b.index);

	return {
		direction,
		width: Math.ceil(result.width ?? 0),
		height: Math.ceil(result.height ?? 0),
		states,
		edges,
		separators
	} satisfies MachineLayout;
}

/** Drop repeated and collinear points. */
export function simplify(points: Point[]): Point[] {
	const out: Point[] = [];
	for (const p of points) {
		const last = out.at(-1);
		if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
		const before = out.at(-2);
		if (last && before && collinear(before, last, p)) out.pop();
		out.push(p);
	}
	return out;
}

function collinear(a: Point, b: Point, c: Point) {
	return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 0.5;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** An SVG path through the points, with rounded corners. */
export function roundedPath(points: Point[], radius = 8): string {
	if (!points.length) return '';
	const [first, ...rest] = points;
	let d = `M ${r1(first!.x)} ${r1(first!.y)}`;
	for (let i = 0; i < rest.length; i++) {
		const p = rest[i]!;
		const prev = points[i]!;
		const next = rest[i + 1];
		if (!next) {
			d += ` L ${r1(p.x)} ${r1(p.y)}`;
			break;
		}
		const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
		const outLen = Math.hypot(next.x - p.x, next.y - p.y);
		const r = Math.min(radius, inLen / 2, outLen / 2);
		const a = { x: p.x - ((p.x - prev.x) / inLen) * r, y: p.y - ((p.y - prev.y) / inLen) * r };
		const b = { x: p.x + ((next.x - p.x) / outLen) * r, y: p.y + ((next.y - p.y) / outLen) * r };
		d += ` L ${r1(a.x)} ${r1(a.y)} Q ${r1(p.x)} ${r1(p.y)} ${r1(b.x)} ${r1(b.y)}`;
	}
	return d;
}

/** Scale and offset that fit a layout into a viewport. */
export function fitTransform(
	layout: { width: number; height: number },
	viewport: { width: number; height: number },
	padding = 16,
	maxScale = 1.35
): { k: number; x: number; y: number } {
	const w = Math.max(1, viewport.width - padding * 2);
	const h = Math.max(1, viewport.height - padding * 2);
	const k = Math.max(0.15, Math.min(maxScale, w / layout.width, h / layout.height));
	return {
		k,
		x: (viewport.width - layout.width * k) / 2,
		y: (viewport.height - layout.height * k) / 2
	};
}

/**
 * Fit, but never below a readable scale: when the whole machine would be too
 * small, keep the scale and centre on the focus box (the active state).
 */
export function readableTransform(
	layout: { width: number; height: number },
	viewport: { width: number; height: number },
	minScale: number,
	focus?: { x: number; y: number; width: number; height: number }
): { k: number; x: number; y: number } {
	const fit = fitTransform(layout, viewport);
	if (fit.k >= minScale) return fit;
	const k = minScale;
	const center = (size: number, total: number, at: number) =>
		total * k <= size
			? (size - total * k) / 2
			: Math.min(16, Math.max(size - total * k - 16, size / 2 - at * k));
	const fx = focus ? focus.x + focus.width / 2 : layout.width / 2;
	const fy = focus ? focus.y + focus.height / 2 : 0;
	return {
		k,
		x: center(viewport.width, layout.width, fx),
		y: center(viewport.height, layout.height, fy)
	};
}

/** Of several layouts, the one that shows largest in the viewport. */
export function bestFit<T extends { width: number; height: number }>(
	layouts: T[],
	viewport: { width: number; height: number }
): T | undefined {
	let best: T | undefined;
	let bestScale = -1;
	for (const l of layouts) {
		const k = fitTransform(l, viewport, 16, Infinity).k;
		if (k > bestScale + 0.02) {
			best = l;
			bestScale = k;
		}
	}
	return best;
}

type Elk = { layout(graph: ElkNode): Promise<ElkNode & { width?: number; height?: number }> };
let elk: Promise<Elk> | undefined;

async function getElk(): Promise<Elk> {
	elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default() as unknown as Elk);
	return elk;
}

/** Lay out a machine in the given direction. */
export async function layoutMachine(
	machine: StateMachine,
	direction: Direction
): Promise<MachineLayout> {
	const engine = await getElk();
	const result = await engine.layout(elkGraph(machine, direction));
	return fromElk(machine, result, direction);
}
