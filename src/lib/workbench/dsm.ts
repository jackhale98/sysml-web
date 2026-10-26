/**
 * What a dependency matrix says, in words people read, and what the app
 * works out from it: the links in each cell, a suggested order that groups
 * linked elements into modules, what a change to one element reaches, the
 * review flags, and the grid as a spreadsheet exports it.
 *
 * The suggested modules (docs/dsm.md): links are counted both ways as
 * weights between elements; elements linked to exactly the same others
 * (four rotors, each powered by the board and commanded by the flight
 * controller) start as one group; then the two groups whose joining most
 * raises the share of links inside groups over what chance would give
 * (modularity) are joined, again and again, while that share rises. Ties go
 * to the pair that comes first in the model, so the same model always gives
 * the same suggestion. Groups of two or more are the suggested modules, in
 * the order of their first element; elements with no links come last.
 */
import type { ExportTable } from '#lib/dataio/export.ts';
import type {
	DependencyKind,
	DependencyMatrix,
	MatrixItem,
	MatrixLink
} from '#lib/engine/types.ts';
import { humanize } from './traceGrid.ts';

/** How each kind of link is named, marked in a cell and said in a sentence. */
export const KIND_WORDS: Record<
	DependencyKind,
	{ label: string; one: string; mark: string; legend: string }
> = {
	connection: {
		label: 'Connections',
		one: 'connection',
		mark: 'C',
		legend: 'connected (a connection or interface)'
	},
	flow: { label: 'Flows', one: 'flow', mark: 'F', legend: 'passes an item to' },
	binding: { label: 'Bindings', one: 'binding', mark: 'B', legend: 'bound to (the same thing)' },
	allocation: { label: 'Allocations', one: 'allocation', mark: 'A', legend: 'allocated to' },
	typing: {
		label: 'Uses',
		one: 'use',
		mark: 'U',
		legend: 'used by (types one of its features)'
	},
	satisfy: { label: 'Satisfies', one: 'satisfy link', mark: 'S', legend: 'satisfies' },
	succession: { label: 'Comes next', one: 'step after', mark: 'N', legend: 'is followed by' },
	derivation: { label: 'Derivations', one: 'derivation', mark: 'D', legend: 'has derived from it' },
	refinement: { label: 'Refinements', one: 'refinement', mark: 'R', legend: 'is refined by' }
};

/** "1 connection", "2 flows". */
export function kindCount(kind: DependencyKind, count: number): string {
	return `${count} ${count === 1 ? KIND_WORDS[kind].one : KIND_WORDS[kind].label.toLowerCase()}`;
}

/** An element's name for display: "Power distribution", "SYS-001 Flight endurance". */
export function itemLabel(item: MatrixItem): string {
	const name = humanize(item.name);
	return item.shortName ? `${item.shortName} ${name}` : name;
}

/** "Front left › Esc" for a nested part. */
export function itemPathLabel(m: DependencyMatrix, index: number): string {
	const out: string[] = [];
	for (let at: number | null = index; at !== null; at = m.items[at]!.parent)
		out.unshift(itemLabel(m.items[at]!));
	return out.join(' › ');
}

/** One sentence for a link, read from the row's element to the column's. */
export function linkSentence(m: DependencyMatrix, link: MatrixLink, row: number): string {
	const from = itemLabel(m.items[link.from]!);
	const to = itemLabel(m.items[link.to]!);
	// A link that goes both ways, read from the other end.
	const [a, b] = link.from === row ? [from, to] : [to, from];
	const via = link.name ? ` (${humanize(link.name)})` : '';
	switch (link.kind) {
		case 'connection':
			return `${a} is connected to ${b}${via}${link.definition ? `, by a ${humanize(link.definition).toLowerCase()} interface` : ''}`;
		case 'flow':
			return `${a} passes ${link.item ? humanize(link.item).toLowerCase() : 'an item'} to ${b}${via}`;
		case 'binding':
			return `${a} is bound to ${b}`;
		case 'allocation':
			return `${a} is allocated to ${b}${via}`;
		case 'typing':
			return `${b} uses ${a}${link.name ? ` as its ${humanize(link.name).toLowerCase()}` : ''}`;
		case 'satisfy':
			return `${a} satisfies ${b}`;
		case 'succession':
			return `${a} is followed by ${b}`;
		case 'derivation':
			return `${b} is derived from ${a}`;
		case 'refinement':
			return `${b} refines ${a}`;
	}
}

/**
 * What passes from the row's element to the column's through a link: an
 * interface's items in that direction, a flow's item. For an N² chart's
 * cell.
 */
export function passes(link: MatrixLink, row: number): string[] {
	if (link.kind === 'flow') return link.item ? [humanize(link.item)] : [];
	if (link.kind !== 'connection') return [];
	const forward = link.from === row;
	return (link.carries ?? []).filter((c) => c.forward === forward).map((c) => humanize(c.item));
}

/** The matrix's links of the counted kinds, by cell: `row:column` → links (mutual ones in both cells). */
export function cellsOf(
	m: DependencyMatrix,
	kinds: readonly DependencyKind[]
): Map<string, MatrixLink[]> {
	const cells = new Map<string, MatrixLink[]>();
	const add = (r: number, c: number, l: MatrixLink) => {
		const key = `${r}:${c}`;
		const list = cells.get(key);
		if (!list) cells.set(key, [l]);
		else if (!list.includes(l)) list.push(l);
	};
	for (const l of m.links) {
		if (!kinds.includes(l.kind)) continue;
		add(l.from, l.to, l);
		if (l.mutual) add(l.to, l.from, l);
	}
	return cells;
}

/** For each element, the elements it leads to (out) and those that lead to it (in). */
export function neighbours(
	m: DependencyMatrix,
	kinds: readonly DependencyKind[]
): { out: Set<number>[]; in: Set<number>[] } {
	const out = m.items.map(() => new Set<number>());
	const inn = m.items.map(() => new Set<number>());
	for (const l of m.links) {
		if (!kinds.includes(l.kind)) continue;
		out[l.from]!.add(l.to);
		inn[l.to]!.add(l.from);
		if (l.mutual) {
			out[l.to]!.add(l.from);
			inn[l.from]!.add(l.to);
		}
	}
	return { out, in: inn };
}

/**
 * What a change to `start` may reach: the elements it leads to, then what
 * those lead to, and so on, along the counted kinds. Each with its
 * distance: 1 directly, 2 or more through others.
 */
export function impactOf(
	m: DependencyMatrix,
	kinds: readonly DependencyKind[],
	start: number
): Map<number, number> {
	const { out } = neighbours(m, kinds);
	const reached = new Map<number, number>();
	let frontier = [start];
	for (let distance = 1; frontier.length; distance++) {
		const next: number[] = [];
		for (const at of frontier)
			for (const to of [...out[at]!].sort((a, b) => a - b))
				if (to !== start && !reached.has(to)) {
					reached.set(to, distance);
					next.push(to);
				}
		frontier = next;
	}
	return reached;
}

export interface Clustering {
	/** The items in the suggested order. */
	order: number[];
	/** The suggested modules (two or more items each), in order. */
	modules: number[][];
}

/** Model order: items as declared, no modules. */
export function modelOrder(m: DependencyMatrix): Clustering {
	return { order: m.items.map((_, i) => i), modules: [] };
}

/** The suggested order and modules (see the top of this file). Deterministic. */
export function cluster(m: DependencyMatrix, kinds: readonly DependencyKind[]): Clustering {
	const weight = m.items.map(() => new Map<number, number>());
	for (const l of m.links) {
		if (!kinds.includes(l.kind) || l.from === l.to) continue;
		weight[l.from]!.set(l.to, (weight[l.from]!.get(l.to) ?? 0) + 1);
		weight[l.to]!.set(l.from, (weight[l.to]!.get(l.from) ?? 0) + 1);
	}
	const degree = weight.map((w) => [...w.values()].reduce((a, b) => a + b, 0));
	const total = degree.reduce((a, b) => a + b, 0) / 2;
	const linked = m.items.map((_, i) => i).filter((i) => degree[i]! > 0);
	const unlinked = m.items.map((_, i) => i).filter((i) => degree[i] === 0);
	if (!total) return { order: m.items.map((_, i) => i), modules: [] };

	// Start: elements linked to exactly the same others share a group.
	const signature = (i: number) => [...weight[i]!.keys()].sort((a, b) => a - b).join(',');
	let groups: number[][] = [];
	const bySignature = new Map<string, number[]>();
	for (const i of linked) {
		const key = signature(i);
		const group = bySignature.get(key);
		if (group) group.push(i);
		else {
			const fresh = [i];
			bySignature.set(key, fresh);
			groups.push(fresh);
		}
	}

	const between = (a: number[], b: number[]) => {
		let sum = 0;
		for (const i of a) for (const j of b) sum += weight[i]!.get(j) ?? 0;
		return sum;
	};
	const share = (g: number[]) => g.reduce((s, i) => s + degree[i]!, 0) / (2 * total);
	// Join while it raises modularity: the gain of joining a and b is 2·(e_ab/2m − a_a·a_b).
	for (;;) {
		let best: { a: number; b: number; gain: number } | null = null;
		for (let a = 0; a < groups.length; a++)
			for (let b = a + 1; b < groups.length; b++) {
				const e = between(groups[a]!, groups[b]!);
				if (!e) continue;
				const gain = 2 * (e / (2 * total) - share(groups[a]!) * share(groups[b]!));
				if (gain > 1e-12 && (!best || gain > best.gain + 1e-12)) best = { a, b, gain };
			}
		if (!best) break;
		const joined = [...groups[best.a]!, ...groups[best.b]!].sort((x, y) => x - y);
		groups = groups.filter((_, i) => i !== best.a && i !== best.b);
		groups.push(joined);
		groups.sort((x, y) => x[0]! - y[0]!);
	}
	groups.sort((x, y) => x[0]! - y[0]!);
	return {
		order: [...groups.flat(), ...unlinked],
		modules: groups.filter((g) => g.length > 1)
	};
}

/**
 * What to review: links with no interface definition, and elements with no
 * links of the counted kinds at all, in the matrix or to elements outside it
 * (a step allocated to a part is linked, though the matrix lists only steps).
 */
export function reviewFlags(
	m: DependencyMatrix,
	kinds: readonly DependencyKind[]
): { untyped: MatrixLink[]; unlinked: number[] } {
	const untyped = kinds.includes('connection')
		? m.links.filter((l) => l.kind === 'connection' && !l.definition)
		: [];
	const { out, in: inn } = neighbours(m, kinds);
	const outside = new Set(m.outside.filter((o) => kinds.includes(o.kind)).map((o) => o.item));
	const unlinked = m.items.flatMap((_, i) =>
		out[i]!.size || inn[i]!.size || outside.has(i) ? [] : [i]
	);
	return { untyped, unlinked };
}

/** The marks of a cell's links, one per kind, with how many of each. */
export function cellMarks(links: readonly MatrixLink[]): { kind: DependencyKind; count: number }[] {
	const counts = new Map<DependencyKind, number>();
	for (const l of links) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
	return [...counts].map(([kind, count]) => ({ kind, count }));
}

/**
 * The grid for a spreadsheet: a row per element with its number and name,
 * a column per element by number, each cell its marks (`C`, `F 2`) or, for
 * an N² chart, what passes; the diagonal marked `■`.
 */
export function matrixExport(
	m: DependencyMatrix,
	kinds: readonly DependencyKind[],
	order: readonly number[],
	meta: Pick<ExportTable, 'title' | 'project' | 'doc'>
): ExportTable {
	const cells = cellsOf(m, kinds);
	const number = new Map(order.map((item, i) => [item, i + 1]));
	return {
		...meta,
		header: ['#', 'Element', ...order.map((i) => String(number.get(i)))],
		rows: order.map((r) => [
			String(number.get(r)),
			itemPathLabel(m, r),
			...order.map((c) => {
				if (r === c) return '■';
				const links = cells.get(`${r}:${c}`) ?? [];
				if (m.cells === 'names') {
					const names = links.flatMap((l) => [
						...(l.kind === 'connection' && l.definition ? [humanize(l.definition)] : []),
						...passes(l, r)
					]);
					return [...new Set(names)].join('; ');
				}
				return cellMarks(links)
					.map((x) => `${KIND_WORDS[x.kind].mark}${x.count > 1 ? ` ${x.count}` : ''}`)
					.join(' ');
			})
		])
	};
}
