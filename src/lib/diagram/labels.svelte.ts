/**
 * Edge label placement for a diagram. Labels on routes ELK drew keep the
 * place it gave them. Every other label starts at the middle of its edge and
 * slides along that edge until it covers no other label and no node. Labels
 * belong to their edges, so they never leave them; when nothing is free, the
 * label goes where it overlaps least.
 */
import { getContext, setContext } from 'svelte';

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface XY {
	x: number;
	y: number;
}

interface Label {
	width: number;
	height: number;
	/** Already placed (by ELK): an obstacle for the others, never moved. */
	fixed?: XY | null;
}

interface Entry extends Label {
	path: string;
	order: number;
}

/** Where along the edge to try, in order (fractions of its length). */
const STOPS = [0.5, 0.38, 0.62, 0.28, 0.72, 0.18, 0.82, 0.1, 0.9];
const GAP = 3;

export function overlap(a: Box, b: Box): number {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Choose a centre for each label. `pointAt(i, t)` gives the point at fraction
 * `t` of label i's edge. Pure, so it is tested without a DOM.
 */
export function place(
	labels: Label[],
	pointAt: (index: number, t: number) => XY,
	obstacles: Box[]
): XY[] {
	const boxAt = (p: XY, label: Label): Box => ({
		x: p.x - label.width / 2 - GAP,
		y: p.y - label.height / 2 - GAP,
		width: label.width + 2 * GAP,
		height: label.height + 2 * GAP
	});
	const placed: Box[] = labels.flatMap((l) => (l.fixed ? [boxAt(l.fixed, l)] : []));
	return labels.map((label, i) => {
		if (label.fixed) return label.fixed;
		let best: { x: number; y: number; cost: number } | null = null;
		for (const t of STOPS) {
			const p = pointAt(i, t);
			const box = boxAt(p, label);
			// Other labels matter most; nodes next; and a little preference for the middle.
			let cost = Math.abs(t - 0.5) * 0.01;
			for (const other of placed) cost += overlap(box, other) * 4;
			for (const node of obstacles) cost += overlap(box, node);
			if (!best || cost < best.cost) best = { x: p.x, y: p.y, cost };
			if (cost < 0.05) break;
		}
		const at = { x: best!.x, y: best!.y };
		placed.push(boxAt(at, label));
		return at;
	});
}

let measurer: CanvasRenderingContext2D | null | undefined;

/** The rendered width of a label's text, with its padding and border. */
export function labelWidth(text: string): number {
	measurer ??=
		typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
	if (!measurer) return text.length * 6.2 + 16;
	measurer.font = '11px Inter, system-ui, sans-serif';
	return Math.ceil(measurer.measureText(text).width) + 16;
}

export const LABEL_HEIGHT = 18;

/** One diagram's labels: edges report their paths, and read back where to draw. */
export class LabelPlacer {
	positions = $state.raw<Record<string, XY>>({});
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read only when placing, never by a template
	private entries = new Map<string, Entry>();
	private obstacles: Box[] = [];
	private frame = 0;
	private order = 0;
	private svgPath: SVGPathElement | null = null;

	set(id: string, path: string, text: string, fixed: XY | null = null) {
		const prev = this.entries.get(id);
		const width = labelWidth(text);
		if (
			prev &&
			prev.path === path &&
			prev.width === width &&
			prev.fixed?.x === fixed?.x &&
			prev.fixed?.y === fixed?.y
		)
			return;
		const order = prev?.order ?? this.order++;
		this.entries.set(id, { path, width, height: LABEL_HEIGHT, fixed, order });
		this.schedule();
	}

	delete(id: string) {
		if (this.entries.delete(id)) this.schedule();
	}

	setObstacles(boxes: Box[]) {
		this.obstacles = boxes;
		this.schedule();
	}

	private schedule() {
		if (this.frame || typeof requestAnimationFrame === 'undefined') return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.compute();
		});
	}

	private compute() {
		this.svgPath ??= document.createElementNS('http://www.w3.org/2000/svg', 'path');
		const path = this.svgPath;
		const items = [...this.entries].sort((a, b) => a[1].order - b[1].order);
		const lengths: number[] = [];
		const result = place(
			items.map(([, e]) => e),
			(i, t) => {
				path.setAttribute('d', items[i]![1].path);
				lengths[i] ??= path.getTotalLength();
				const p = path.getPointAtLength(lengths[i]! * t);
				return { x: p.x, y: p.y };
			},
			this.obstacles
		);
		this.positions = Object.fromEntries(items.map(([id], i) => [id, result[i]!]));
	}
}

const KEY = Symbol('sysml-edge-labels');

export function provideLabels(): LabelPlacer {
	return setContext(KEY, new LabelPlacer());
}

export function useLabels(): LabelPlacer | undefined {
	return getContext<LabelPlacer | undefined>(KEY);
}
