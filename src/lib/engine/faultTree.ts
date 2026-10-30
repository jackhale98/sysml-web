/**
 * Fault tree analysis, as pure functions over a tree of gates and basic
 * events (the `FaultTreeAnalysis` library's meaning; `toolkit/views/faultTrees.ts`
 * reads the trees from a model).
 *
 * - **Minimal cut sets**, bottom-up (MOCUS's sets, built from the leaves):
 *   an OR gate's cut sets are its inputs' together, an AND gate's every
 *   union of one of each input's, a k-out-of-n gate's those of every k of
 *   its inputs; after each gate the sets that contain another are dropped
 *   (absorption). A basic event under several gates is the same event in
 *   each, so `A·A = A` and `A + A·B = A` hold: a repeated event is never
 *   counted twice.
 * - **The top event's probability**, exactly, from a binary decision diagram
 *   of the tree (Shannon decomposition: P(f) = p·P(f|x) + (1 − p)·P(f|¬x)),
 *   with basic events independent. The rare-event approximation (the sum of
 *   the cut sets' probabilities) and the min-cut upper bound
 *   (1 − Π(1 − P(cut set))) are given beside it, labelled.
 * - **Importance** of each basic event: Birnbaum (P(top | x certain) −
 *   P(top | x impossible)), Fussell-Vesely (the probability of the union of
 *   the cut sets that contain x, over the top event's), and the risk
 *   achievement and reduction worths.
 *
 * Multiplying probabilities up through the gates (AND: Π p, OR: 1 − Π(1 − p))
 * is right only when no basic event appears twice; with a repeated event it
 * is wrong, which is why the probability comes from the diagram instead.
 */

export type GateKind = 'and' | 'or' | 'atLeast' | 'inhibit';

export interface Gate {
	kind: GateKind;
	/** For `atLeast`: how many of the inputs must occur. */
	k?: number;
	/** The gate's inputs: other gates' ids, or basic events' (any id that is not a gate). */
	inputs: string[];
}

export interface FaultTree {
	/** The top event: a gate's id. */
	top: string;
	/** Gates by the id of the event they belong to. */
	gates: Record<string, Gate>;
}

/** A cut set: basic event ids, sorted. */
export type CutSet = string[];

export class FaultTreeError extends Error {}

/** More cut sets than this and the tree is too large to expand (the message says so). */
export const MAX_CUT_SETS = 20_000;

/** The basic events of a tree (inputs that are not gates), in the order first met from the top. */
export function basicEvents(tree: FaultTree): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const walk = (id: string, path: Set<string>) => {
		const gate = tree.gates[id];
		if (!gate) {
			if (!seen.has(id)) {
				seen.add(id);
				out.push(id);
			}
			return;
		}
		if (path.has(id)) throw new FaultTreeError(`the tree has a loop through \`${id}\``);
		path.add(id);
		for (const input of gate.inputs) walk(input, path);
		path.delete(id);
	};
	walk(tree.top, new Set());
	return out;
}

/** What is wrong with a gate, or null: no inputs, a `k` that doesn't fit, an inhibit without one cause and one condition. */
export function gateProblem(gate: Gate): string | null {
	const n = gate.inputs.length;
	if (!n) return 'it has no causes';
	if (gate.kind === 'atLeast') {
		if (gate.k === undefined || !Number.isInteger(gate.k)) return 'an atLeast gate needs a whole k';
		if (gate.k < 1 || gate.k > n)
			return `k is ${gate.k}, but it has ${n} cause${n === 1 ? '' : 's'}`;
	}
	return null;
}

// --- Minimal cut sets ------------------------------------------------------------

/**
 * The minimal cut sets of the top event, smallest first, then by their
 * events. Throws `FaultTreeError` for a loop, a gate that doesn't fit, or a
 * tree with more than `MAX_CUT_SETS` cut sets.
 */
export function minimalCutSets(tree: FaultTree): CutSet[] {
	basicEvents(tree); // finds loops
	const memo = new Map<string, CutSet[]>();
	const of = (id: string): CutSet[] => {
		const known = memo.get(id);
		if (known) return known;
		const gate = tree.gates[id];
		let sets: CutSet[];
		if (!gate) sets = [[id]];
		else {
			const problem = gateProblem(gate);
			if (problem) throw new FaultTreeError(`\`${id}\`: ${problem}`);
			const inputs = gate.inputs.map(of);
			switch (gate.kind) {
				case 'or':
					sets = minimize(inputs.flat());
					break;
				case 'and':
				case 'inhibit':
					sets = inputs.reduce(product, [[]]);
					break;
				case 'atLeast':
					sets = minimize(combinations(inputs, gate.k!).flatMap((c) => c.reduce(product, [[]])));
					break;
			}
		}
		if (sets.length > MAX_CUT_SETS)
			throw new FaultTreeError(
				`\`${id}\` has more than ${MAX_CUT_SETS} cut sets: the tree is too large to expand`
			);
		memo.set(id, sets);
		return sets;
	};
	return of(tree.top).toSorted(
		(a, b) => a.length - b.length || a.join('\0').localeCompare(b.join('\0'))
	);
}

/** Every union of one set of `a` and one of `b`, minimized. */
function product(a: CutSet[], b: CutSet[]): CutSet[] {
	const out: CutSet[] = [];
	for (const x of a) for (const y of b) out.push(union(x, y));
	return minimize(out);
}

const union = (a: CutSet, b: CutSet): CutSet => [...new Set([...a, ...b])].sort();

/** Without duplicates and without sets that contain another (absorption). */
function minimize(sets: CutSet[]): CutSet[] {
	const unique = [...new Map(sets.map((s) => [s.join('\0'), s])).values()].sort(
		(a, b) => a.length - b.length
	);
	const kept: CutSet[] = [];
	for (const set of unique)
		if (!kept.some((k) => k.length <= set.length && k.every((e) => set.includes(e))))
			kept.push(set);
	return kept;
}

function combinations<T>(items: T[], k: number): T[][] {
	if (k === 0) return [[]];
	if (items.length < k) return [];
	const [first, ...rest] = items as [T, ...T[]];
	return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

// --- Probability -----------------------------------------------------------------

/** Probabilities of the basic events, by id (each between 0 and 1). */
export type Probabilities = Record<string, number>;

/** The probability of a cut set: its events all occur (independent events). */
export function cutSetProbability(set: CutSet, p: Probabilities): number {
	return set.reduce((acc, e) => acc * probabilityOf(p, e), 1);
}

function probabilityOf(p: Probabilities, id: string): number {
	const value = p[id];
	if (value === undefined || !Number.isFinite(value))
		throw new FaultTreeError(`\`${id}\` has no probability`);
	return value;
}

/** The rare-event approximation: the sum of the cut sets' probabilities (an upper bound, good when they are small). */
export function rareEventApproximation(sets: CutSet[], p: Probabilities): number {
	return sets.reduce((acc, s) => acc + cutSetProbability(s, p), 0);
}

/** The min-cut upper bound: 1 − Π(1 − P(cut set)), exact when no event is in two cut sets. */
export function minCutUpperBound(sets: CutSet[], p: Probabilities): number {
	return 1 - sets.reduce((acc, s) => acc * (1 - cutSetProbability(s, p)), 1);
}

/** The top event's probability, exactly (basic events independent). */
export function topEventProbability(tree: FaultTree, p: Probabilities): number {
	const bdd = new Bdd(basicEvents(tree));
	return bdd.probability(bdd.ofTree(tree), p);
}

/**
 * The probability of the union of cut sets, exactly (for Fussell-Vesely):
 * over the given order of the events.
 */
export function unionProbability(sets: CutSet[], p: Probabilities, order?: string[]): number {
	const bdd = new Bdd(order ?? [...new Set(sets.flat())]);
	return bdd.probability(bdd.ofCutSets(sets), p);
}

/**
 * The gate-by-gate product (AND: Π p, OR: 1 − Π(1 − p), k out of n by
 * counting): what multiplying up the tree gives. Exact only when no basic
 * event appears twice; kept to show (and test) how it goes wrong.
 */
export function naiveGateProbability(tree: FaultTree, p: Probabilities): number {
	const of = (id: string): number => {
		const gate = tree.gates[id];
		if (!gate) return probabilityOf(p, id);
		const q = gate.inputs.map(of);
		switch (gate.kind) {
			case 'or':
				return 1 - q.reduce((acc, x) => acc * (1 - x), 1);
			case 'and':
			case 'inhibit':
				return q.reduce((acc, x) => acc * x, 1);
			case 'atLeast': {
				// The chance that at least k of independent inputs occur.
				let dist = [1];
				for (const x of q) {
					const next = Array<number>(dist.length + 1).fill(0);
					dist.forEach((v, i) => {
						next[i] = next[i]! + v * (1 - x);
						next[i + 1] = next[i + 1]! + v * x;
					});
					dist = next;
				}
				return dist.slice(gate.k ?? 1).reduce((a, b) => a + b, 0);
			}
		}
	};
	return of(tree.top);
}

// --- Importance ------------------------------------------------------------------

export interface Importance {
	event: string;
	/** P(top | event certain) − P(top | event impossible). */
	birnbaum: number;
	/** P(union of the cut sets that contain the event) / P(top). */
	fussellVesely: number;
	/** Risk achievement worth: P(top | event certain) / P(top). */
	achievementWorth: number;
	/** Risk reduction worth: P(top) / P(top | event impossible) (Infinity when that is 0). */
	reductionWorth: number;
}

/** The importance of each basic event, in the order the tree meets them. */
export function importance(tree: FaultTree, p: Probabilities, sets?: CutSet[]): Importance[] {
	const order = basicEvents(tree);
	const bdd = new Bdd(order);
	const root = bdd.ofTree(tree);
	const top = bdd.probability(root, p);
	const cuts = sets ?? minimalCutSets(tree);
	return order.map((event) => {
		const certain = bdd.probability(root, { ...p, [event]: 1 });
		const impossible = bdd.probability(root, { ...p, [event]: 0 });
		const containing = cuts.filter((s) => s.includes(event));
		const share = containing.length ? bdd.probability(bdd.ofCutSets(containing), p) : 0;
		return {
			event,
			birnbaum: certain - impossible,
			fussellVesely: top > 0 ? share / top : 0,
			achievementWorth: top > 0 ? certain / top : 0,
			reductionWorth: impossible > 0 ? top / impossible : Infinity
		};
	});
}

/** A basic event's probability over `hours` at a constant failure rate per hour: 1 − e^(−λt). */
export function probabilityFromRate(perHour: number, hours: number): number {
	return -Math.expm1(-perHour * hours);
}

// --- A reduced ordered binary decision diagram -------------------------------------

/** Node ids: 0 is false, 1 is true. */
type Node = number;

class Bdd {
	/** By node id: its variable's index, low (variable false) and high (true) children. */
	private readonly nodes: { v: number; lo: Node; hi: Node }[] = [
		{ v: Infinity, lo: 0, hi: 0 },
		{ v: Infinity, lo: 1, hi: 1 }
	];
	private readonly unique = new Map<string, Node>();
	private readonly applied = new Map<string, Node>();
	private readonly index: Map<string, number>;

	constructor(private readonly order: string[]) {
		this.index = new Map(order.map((id, i) => [id, i]));
	}

	private node(v: number, lo: Node, hi: Node): Node {
		if (lo === hi) return lo;
		const key = `${v},${lo},${hi}`;
		let id = this.unique.get(key);
		if (id === undefined) {
			id = this.nodes.length;
			this.nodes.push({ v, lo, hi });
			this.unique.set(key, id);
		}
		return id;
	}

	variable(id: string): Node {
		let v = this.index.get(id);
		if (v === undefined) {
			v = this.order.length;
			this.order.push(id);
			this.index.set(id, v);
		}
		return this.node(v, 0, 1);
	}

	apply(op: 'and' | 'or', a: Node, b: Node): Node {
		if (op === 'and') {
			if (a === 0 || b === 0) return 0;
			if (a === 1) return b;
			if (b === 1) return a;
		} else {
			if (a === 1 || b === 1) return 1;
			if (a === 0) return b;
			if (b === 0) return a;
		}
		if (a === b) return a;
		const key = `${op}${Math.min(a, b)},${Math.max(a, b)}`;
		const known = this.applied.get(key);
		if (known !== undefined) return known;
		const x = this.nodes[a]!;
		const y = this.nodes[b]!;
		const v = Math.min(x.v, y.v);
		const [alo, ahi] = x.v === v ? [x.lo, x.hi] : [a, a];
		const [blo, bhi] = y.v === v ? [y.lo, y.hi] : [b, b];
		const result = this.node(v, this.apply(op, alo, blo), this.apply(op, ahi, bhi));
		this.applied.set(key, result);
		return result;
	}

	/** At least `k` of the functions true: (f₁ ∧ AL(k−1, rest)) ∨ AL(k, rest). */
	private atLeast(k: number, fs: Node[]): Node {
		const memo = new Map<string, Node>();
		const go = (k: number, from: number): Node => {
			if (k <= 0) return 1;
			if (fs.length - from < k) return 0;
			const key = `${k},${from}`;
			const known = memo.get(key);
			if (known !== undefined) return known;
			const result = this.apply(
				'or',
				this.apply('and', fs[from]!, go(k - 1, from + 1)),
				go(k, from + 1)
			);
			memo.set(key, result);
			return result;
		};
		return go(k, 0);
	}

	ofTree(tree: FaultTree): Node {
		const memo = new Map<string, Node>();
		const of = (id: string): Node => {
			const known = memo.get(id);
			if (known !== undefined) return known;
			const gate = tree.gates[id];
			let result: Node;
			if (!gate) result = this.variable(id);
			else {
				const problem = gateProblem(gate);
				if (problem) throw new FaultTreeError(`\`${id}\`: ${problem}`);
				const inputs = gate.inputs.map(of);
				if (gate.kind === 'or') result = inputs.reduce((a, b) => this.apply('or', a, b), 0);
				else if (gate.kind === 'atLeast') result = this.atLeast(gate.k!, inputs);
				else result = inputs.reduce((a, b) => this.apply('and', a, b), 1);
			}
			memo.set(id, result);
			return result;
		};
		return of(tree.top);
	}

	ofCutSets(sets: CutSet[]): Node {
		return sets.reduce(
			(acc, set) =>
				this.apply(
					'or',
					acc,
					set.reduce((a, e) => this.apply('and', a, this.variable(e)), 1 as Node)
				),
			0 as Node
		);
	}

	probability(root: Node, p: Probabilities): number {
		const memo = new Map<Node, number>();
		const go = (n: Node): number => {
			if (n === 0) return 0;
			if (n === 1) return 1;
			const known = memo.get(n);
			if (known !== undefined) return known;
			const { v, lo, hi } = this.nodes[n]!;
			const q = probabilityOf(p, this.order[v]!);
			const result = q * go(hi) + (1 - q) * go(lo);
			memo.set(n, result);
			return result;
		};
		return go(root);
	}
}
