/**
 * Geometry of a sequence diagram (`DiagramGraph` of the `sequence` view):
 * lifeline heads along the top, a dashed lifeline down from each, and one
 * row per message, top to bottom in the order the engine gives them.
 * Lifelines are spaced so every message's label fits between the two
 * lifelines it joins. Pure: text is measured by the caller's `measure`.
 */
import type { DiagramEdge, DiagramGraph, DiagramNode } from '#lib/engine/types.ts';
import { familyOf, type Family } from '#lib/ui/kinds.ts';

/** The fonts the diagram draws with; `measure` gets one of these. */
export type TextStyle = 'name' | 'keyword' | 'label' | 'payload' | 'number';

export type Measure = (text: string, style: TextStyle) => number;

/** Character-count estimate, for tests and before fonts load. */
export const estimate: Measure = (text, style) =>
	text.length * { name: 7.6, keyword: 6.3, label: 7.1, payload: 6.7, number: 6.4 }[style];

export const SEQUENCE = {
	margin: 24,
	/** The diagram frame: inset from the drawing's edge, and its name tag's height. */
	frameInset: 8,
	tagHeight: 24,
	/** Where the heads start: below the frame's name tag. */
	headTop: 50,
	headHeight: 50,
	headMin: 128,
	headMax: 228,
	/** Least room between two heads. */
	headGap: 28,
	/** From the heads' bottom to the first message. */
	firstRow: 52,
	row: 56,
	/** A message to its own lifeline: how far its loop goes out and down. */
	selfWidth: 30,
	selfHeight: 24,
	labelHeight: 22,
	/** Between the label and its arrow. */
	labelGap: 3,
	labelPad: 10,
	/** Below the last message. */
	tail: 36
};

export interface LifelineBox {
	node: DiagramNode;
	index: number;
	/** `operator` of `operator : Operator`. */
	name: string;
	/** `Operator`, or null when untyped. */
	type: string | null;
	/** `ref part`. */
	keyword: string;
	family: Family;
	/** The lifeline's x. */
	x: number;
	head: { x: number; y: number; width: number; height: number };
}

export interface MessageArrow {
	edge: DiagramEdge;
	/** Position in time order, from 0. */
	index: number;
	from: number;
	to: number;
	self: boolean;
	y: number;
	x1: number;
	x2: number;
	/** The arrow, from its sender to its receiver. */
	path: string;
	/** The label's box: above a straight arrow, beside a self message's loop. */
	label: { x: number; y: number; width: number; height: number };
	name: string | null;
	payload: string | null;
}

export interface SequenceLayout {
	lifelines: LifelineBox[];
	messages: MessageArrow[];
	/** The SysML diagram frame around it all, and its name tag (`sv [Interaction]`). */
	frame: { x: number; y: number; width: number; height: number };
	tag: { text: string; width: number; path: string };
	width: number;
	height: number;
	/** Where the dashed lifelines run, top to bottom. */
	lineTop: number;
	lineBottom: number;
}

/** `«ref part»` → `ref part`; the family colours the head. */
function keywordOf(node: DiagramNode): string {
	return node.stereotype?.replace(/^<<|>>$/g, '').trim() || 'part';
}

/** `operator : Operator` → [operator, Operator]. */
export function splitLabel(label: string): [string, string | null] {
	const at = label.indexOf(' : ');
	return at < 0 ? [label, null] : [label.slice(0, at), label.slice(at + 3)];
}

/** The parts of a message's label as drawn: its number, name, then `of Payload`. */
export function labelParts(
	index: number,
	edge: DiagramEdge
): { number: string; name: string | null; payload: string | null } {
	const name = edge.message?.name ?? (edge.message ? null : edge.label);
	const payload = edge.message?.payload ?? null;
	return { number: `${index + 1}`, name, payload };
}

function labelWidth(index: number, edge: DiagramEdge, measure: Measure): number {
	const { number, name, payload } = labelParts(index, edge);
	let width = measure(number, 'number') + 8;
	if (name) width += measure(name, 'label');
	if (payload) width += (name ? measure(' ', 'label') : 0) + measure(`of ${payload}`, 'payload');
	return Math.ceil(width + SEQUENCE.labelPad * 2);
}

export function layoutSequence(graph: DiagramGraph, measure: Measure = estimate): SequenceLayout {
	const S = SEQUENCE;
	const nodes = graph.nodes.filter((n) => n.kind === 'lifeline');
	const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
	const heads = nodes.map((node) => {
		const [name, type] = splitLabel(node.label);
		const keyword = keywordOf(node);
		const text =
			measure(name, 'name') + (type ? measure(` : ${type}`, 'name') * 0.94 : 0) + S.labelPad * 3;
		const width = Math.round(
			Math.min(S.headMax, Math.max(S.headMin, text, measure(`«${keyword}»`, 'keyword') + 44))
		);
		return { node, name, type, keyword, width };
	});

	const edges = graph.edges
		.map((edge, i) => ({ edge, i }))
		.filter(
			({ edge }) => edge.kind === 'message' && indexOf.has(edge.source) && indexOf.has(edge.target)
		);
	const widths = edges.map(({ edge }, index) => labelWidth(index, edge, measure));

	// Gaps between neighbouring lifelines: room for the heads, then for each label.
	const gaps = heads.slice(1).map((h, i) => heads[i]!.width / 2 + h.width / 2 + S.headGap);
	let tailRoom = heads.length ? heads.at(-1)!.width / 2 : 0;
	const spans = edges
		.map(({ edge }, index) => ({
			from: indexOf.get(edge.source)!,
			to: indexOf.get(edge.target)!,
			need: widths[index]!
		}))
		.map((s) => ({ lo: Math.min(s.from, s.to), hi: Math.max(s.from, s.to), need: s.need }))
		.sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
	for (const s of spans) {
		if (s.lo === s.hi) {
			const need = S.selfWidth + 8 + s.need + 12;
			if (s.lo < gaps.length) gaps[s.lo] = Math.max(gaps[s.lo]!, need);
			else tailRoom = Math.max(tailRoom, need);
			continue;
		}
		const need = s.need + 24;
		let have = 0;
		for (let i = s.lo; i < s.hi; i++) have += gaps[i]!;
		if (have >= need) continue;
		const extra = (need - have) / (s.hi - s.lo);
		for (let i = s.lo; i < s.hi; i++) gaps[i] = gaps[i]! + extra;
	}

	const lineTop = S.headTop + S.headHeight;
	const xs: number[] = [];
	let x = S.margin + (heads[0]?.width ?? 0) / 2;
	for (let i = 0; i < heads.length; i++) {
		xs.push(Math.round(x));
		x += gaps[i] ?? 0;
	}
	const lifelines: LifelineBox[] = heads.map((h, i) => ({
		node: h.node,
		index: i,
		name: h.name,
		type: h.type,
		keyword: h.keyword,
		family: familyOf(h.keyword.replace(/^ref\s+/, '').replace(/ /g, '_')),
		x: xs[i]!,
		head: {
			x: Math.round(xs[i]! - h.width / 2),
			y: S.headTop,
			width: h.width,
			height: S.headHeight
		}
	}));

	const messages: MessageArrow[] = [];
	let y = lineTop + S.firstRow;
	for (const [index, { edge }] of edges.entries()) {
		const from = indexOf.get(edge.source)!;
		const to = indexOf.get(edge.target)!;
		const self = from === to;
		const x1 = xs[from]!;
		const x2 = xs[to]!;
		const width = widths[index]!;
		const { name, payload } = labelParts(index, edge);
		if (self) {
			const out = x1 + S.selfWidth;
			messages.push({
				edge,
				index,
				from,
				to,
				self,
				y,
				x1,
				x2,
				path: `M ${x1} ${y} H ${out} V ${y + S.selfHeight} H ${x1 + 1}`,
				label: {
					x: out + 8,
					y: Math.round(y + S.selfHeight / 2 - S.labelHeight / 2),
					width,
					height: S.labelHeight
				},
				name,
				payload
			});
			y += S.row + S.selfHeight;
		} else {
			const dir = Math.sign(x2 - x1);
			messages.push({
				edge,
				index,
				from,
				to,
				self,
				y,
				x1,
				x2,
				path: `M ${x1 + dir} ${y} H ${x2 - dir}`,
				label: {
					x: Math.round((x1 + x2) / 2 - width / 2),
					y: y - S.labelGap - S.labelHeight,
					width,
					height: S.labelHeight
				},
				name,
				payload
			});
			y += S.row;
		}
	}

	const lineBottom = y - S.row + S.tail + (messages.length ? 0 : S.row);
	const tagText = graph.title;
	const tagWidth = Math.ceil(measure(tagText, 'payload') + 30);
	const right = Math.max(
		(xs.at(-1) ?? S.margin) + tailRoom,
		...messages.map((m) => m.label.x + m.label.width),
		S.frameInset + tagWidth + 16
	);
	const width = Math.ceil(right + S.margin);
	const height = Math.ceil(lineBottom + S.margin);
	const f = S.frameInset;
	const t = S.tagHeight;
	return {
		lifelines,
		messages,
		frame: { x: f, y: f, width: width - 2 * f, height: height - 2 * f },
		tag: {
			text: tagText,
			width: tagWidth,
			// A name box with its bottom-right corner cut, as SysML frames are named.
			path: `M ${f} ${f + t} H ${f + tagWidth - 9} L ${f + tagWidth} ${f + t - 9} V ${f}`
		},
		width,
		height,
		lineTop,
		lineBottom
	};
}

export interface View {
	k: number;
	x: number;
	y: number;
}

/** The whole diagram, centred, as large as fits (never above `max`). */
export function fitView(
	size: { width: number; height: number },
	viewport: { width: number; height: number },
	padding = 16,
	max = 1.1
): View {
	const k = Math.max(
		0.15,
		Math.min(
			max,
			(viewport.width - padding * 2) / size.width,
			(viewport.height - padding * 2) / size.height
		)
	);
	return {
		k,
		x: (viewport.width - size.width * k) / 2,
		y: (viewport.height - size.height * k) / 2
	};
}

/**
 * Fit, but never smaller than `min`: a long sequence is read from the top
 * (scrolled down), a wide one from the left (scrolled across).
 */
export function readableView(
	size: { width: number; height: number },
	viewport: { width: number; height: number },
	min = 0.75,
	max = 1.1
): View {
	const fit = fitView(size, viewport, 16, max);
	if (fit.k >= min) return fit;
	const k = Math.max(min, Math.min(max, (viewport.width - 24) / size.width));
	return {
		k,
		x: size.width * k > viewport.width ? 4 : (viewport.width - size.width * k) / 2,
		y: 4
	};
}
