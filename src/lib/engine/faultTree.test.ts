/**
 * Fault tree analysis against examples worked by hand: cut sets, the top
 * event's probability (exact, rare-event and min-cut upper bound), and the
 * importance measures. Every expected number below is worked out in the
 * comment beside it.
 */
import { describe, expect, it } from 'vitest';
import {
	FaultTreeError,
	importance,
	minCutUpperBound,
	minimalCutSets,
	naiveGateProbability,
	probabilityFromRate,
	rareEventApproximation,
	topEventProbability,
	unionProbability,
	type FaultTree
} from './faultTree';

const all = (p: number, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, p]));

describe('minimal cut sets and the top event', () => {
	it('an OR over an AND', () => {
		// TOP = A + B·C
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'or', inputs: ['A', 'G1'] },
				G1: { kind: 'and', inputs: ['B', 'C'] }
			}
		};
		const p = { A: 0.1, B: 0.2, C: 0.3 };
		const sets = minimalCutSets(tree);
		expect(sets).toEqual([['A'], ['B', 'C']]);
		// Exact: 1 − (1 − 0.1)(1 − 0.2·0.3) = 1 − 0.9·0.94 = 0.154.
		expect(topEventProbability(tree, p)).toBeCloseTo(0.154, 12);
		// Rare event: 0.1 + 0.06 = 0.16; upper bound: the cut sets share no event, so it is exact.
		expect(rareEventApproximation(sets, p)).toBeCloseTo(0.16, 12);
		expect(minCutUpperBound(sets, p)).toBeCloseTo(0.154, 12);
	});

	it('a repeated event: gate-by-gate arithmetic is wrong, the cut sets are right', () => {
		// TOP = (A + B)·(A + C) = A + A·C + A·B + B·C = A + B·C  (A appears under both gates)
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'and', inputs: ['G1', 'G2'] },
				G1: { kind: 'or', inputs: ['A', 'B'] },
				G2: { kind: 'or', inputs: ['A', 'C'] }
			}
		};
		const p = all(0.1, 'A', 'B', 'C');
		expect(minimalCutSets(tree)).toEqual([['A'], ['B', 'C']]);
		// Exact: P(A) + P(B·C) − P(A·B·C) = 0.1 + 0.01 − 0.001 = 0.109.
		expect(topEventProbability(tree, p)).toBeCloseTo(0.109, 12);
		// Multiplying through the gates: P(G1) = P(G2) = 0.19, so 0.19² = 0.0361 — a third of the truth.
		expect(naiveGateProbability(tree, p)).toBeCloseTo(0.0361, 12);
		const sets = minimalCutSets(tree);
		expect(rareEventApproximation(sets, p)).toBeCloseTo(0.11, 12);
		// 1 − (1 − 0.1)(1 − 0.01) = 0.109: exact here, as {A} and {B, C} share nothing.
		expect(minCutUpperBound(sets, p)).toBeCloseTo(0.109, 12);
	});

	it('two out of three', () => {
		const tree: FaultTree = {
			top: 'TOP',
			gates: { TOP: { kind: 'atLeast', k: 2, inputs: ['A', 'B', 'C'] } }
		};
		const p = all(0.1, 'A', 'B', 'C');
		const sets = minimalCutSets(tree);
		expect(sets).toEqual([
			['A', 'B'],
			['A', 'C'],
			['B', 'C']
		]);
		// Exact: 3·p²(1 − p) + p³ = 3·0.01·0.9 + 0.001 = 0.028.
		expect(topEventProbability(tree, p)).toBeCloseTo(0.028, 12);
		expect(naiveGateProbability(tree, p)).toBeCloseTo(0.028, 12);
		// Rare event 3·0.01 = 0.03; upper bound 1 − 0.99³ = 0.029701 (the sets share events).
		expect(rareEventApproximation(sets, p)).toBeCloseTo(0.03, 12);
		expect(minCutUpperBound(sets, p)).toBeCloseTo(0.029701, 12);
	});

	it('cut sets that share an event: the upper bound is above the exact value', () => {
		// TOP = A·(B + C) = A·B + A·C
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'and', inputs: ['A', 'G1'] },
				G1: { kind: 'or', inputs: ['B', 'C'] }
			}
		};
		const p = all(0.1, 'A', 'B', 'C');
		const sets = minimalCutSets(tree);
		expect(sets).toEqual([
			['A', 'B'],
			['A', 'C']
		]);
		// Exact: 0.1·(1 − 0.9²) = 0.019; rare event 0.02; upper bound 1 − 0.99² = 0.0199.
		expect(topEventProbability(tree, p)).toBeCloseTo(0.019, 12);
		expect(rareEventApproximation(sets, p)).toBeCloseTo(0.02, 12);
		expect(minCutUpperBound(sets, p)).toBeCloseTo(0.0199, 12);
	});

	it('absorption: A + A·B is A', () => {
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'or', inputs: ['A', 'G1'] },
				G1: { kind: 'and', inputs: ['A', 'B'] }
			}
		};
		expect(minimalCutSets(tree)).toEqual([['A']]);
		expect(topEventProbability(tree, { A: 0.3, B: 0.5 })).toBeCloseTo(0.3, 12);
	});

	it('a voting gate under an AND with a repeated event', () => {
		// TOP = (A + B)·2oo3(A, C, D) = (A + B)·(A·C + A·D + C·D)
		//     = A·C + A·D + A·C·D + B·A·C + B·A·D + B·C·D = A·C + A·D + B·C·D
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'and', inputs: ['G1', 'G2'] },
				G1: { kind: 'or', inputs: ['A', 'B'] },
				G2: { kind: 'atLeast', k: 2, inputs: ['A', 'C', 'D'] }
			}
		};
		expect(minimalCutSets(tree)).toEqual([
			['A', 'C'],
			['A', 'D'],
			['B', 'C', 'D']
		]);
		// Given A: C + D, 0.19; without A: B·C·D, 0.001. So 0.1·0.19 + 0.9·0.001 = 0.0199.
		expect(topEventProbability(tree, all(0.1, 'A', 'B', 'C', 'D'))).toBeCloseTo(0.0199, 12);
	});

	it('an inhibit gate is its cause and its condition', () => {
		const tree: FaultTree = {
			top: 'TOP',
			gates: { TOP: { kind: 'inhibit', inputs: ['cause', 'condition'] } }
		};
		expect(minimalCutSets(tree)).toEqual([['cause', 'condition']]);
		expect(topEventProbability(tree, { cause: 0.01, condition: 0.5 })).toBeCloseTo(0.005, 12);
	});

	it('refuses loops, gates that do not fit and events without a probability', () => {
		const loop: FaultTree = {
			top: 'TOP',
			gates: { TOP: { kind: 'or', inputs: ['G1'] }, G1: { kind: 'or', inputs: ['TOP', 'A'] } }
		};
		expect(() => minimalCutSets(loop)).toThrow(/loop through `TOP`/);
		const k: FaultTree = {
			top: 'TOP',
			gates: { TOP: { kind: 'atLeast', k: 3, inputs: ['A', 'B'] } }
		};
		expect(() => minimalCutSets(k)).toThrow(/k is 3, but it has 2 causes/);
		const empty: FaultTree = { top: 'TOP', gates: { TOP: { kind: 'and', inputs: [] } } };
		expect(() => minimalCutSets(empty)).toThrow(FaultTreeError);
		const tree: FaultTree = { top: 'TOP', gates: { TOP: { kind: 'or', inputs: ['A', 'B'] } } };
		expect(() => topEventProbability(tree, { A: 0.1 })).toThrow(/`B` has no probability/);
	});
});

describe('importance', () => {
	it('Birnbaum, Fussell-Vesely and the worths of A + B·C', () => {
		// The repeated-event tree above: TOP = A + B·C, every p = 0.1, P(TOP) = 0.109.
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'and', inputs: ['G1', 'G2'] },
				G1: { kind: 'or', inputs: ['A', 'B'] },
				G2: { kind: 'or', inputs: ['A', 'C'] }
			}
		};
		const measures = importance(tree, all(0.1, 'A', 'B', 'C'));
		const of = (id: string) => measures.find((m) => m.event === id)!;
		expect(measures.map((m) => m.event)).toEqual(['A', 'B', 'C']);
		// Birnbaum of A: P(TOP | A) − P(TOP | not A) = 1 − 0.01 = 0.99.
		expect(of('A').birnbaum).toBeCloseTo(0.99, 12);
		// Of B: P(A + C) − P(A) = 0.19 − 0.1 = 0.09; C the same.
		expect(of('B').birnbaum).toBeCloseTo(0.09, 12);
		expect(of('C').birnbaum).toBeCloseTo(0.09, 12);
		// Fussell-Vesely: P({A}) / P(TOP) = 0.1 / 0.109; P({B, C}) / P(TOP) = 0.01 / 0.109.
		expect(of('A').fussellVesely).toBeCloseTo(0.1 / 0.109, 12);
		expect(of('B').fussellVesely).toBeCloseTo(0.01 / 0.109, 12);
		// Achievement worth of A: 1 / 0.109; reduction worth: 0.109 / 0.01 = 10.9.
		expect(of('A').achievementWorth).toBeCloseTo(1 / 0.109, 12);
		expect(of('A').reductionWorth).toBeCloseTo(10.9, 10);
	});

	it('Fussell-Vesely takes the union of the cut sets that share an event', () => {
		// TOP = A·B + A·C (p = 0.1): every cut set has A, so FV(A) = 1; FV(B) = 0.01 / 0.019.
		const tree: FaultTree = {
			top: 'TOP',
			gates: {
				TOP: { kind: 'and', inputs: ['A', 'G1'] },
				G1: { kind: 'or', inputs: ['B', 'C'] }
			}
		};
		const measures = importance(tree, all(0.1, 'A', 'B', 'C'));
		expect(measures[0]!.fussellVesely).toBeCloseTo(1, 12);
		expect(measures[1]!.fussellVesely).toBeCloseTo(0.01 / 0.019, 12);
		// The union of A·B and A·C: 0.1·0.19 = 0.019, not 0.01 + 0.01.
		expect(
			unionProbability(
				[
					['A', 'B'],
					['A', 'C']
				],
				all(0.1, 'A', 'B', 'C')
			)
		).toBeCloseTo(0.019, 12);
	});
});

describe('probability from a failure rate', () => {
	it('is 1 − e^(−λt)', () => {
		// λ = 10⁻⁴ per hour over 1000 hours: 1 − e^(−0.1) = 0.0951625819…
		expect(probabilityFromRate(1e-4, 1000)).toBeCloseTo(0.09516258196404048, 15);
		// Small λt: about λt − (λt)²/2 (2000 FIT for half an hour: 10⁻⁶ − 5·10⁻¹³).
		expect(probabilityFromRate(2000e-9, 0.5)).toBeCloseTo(1e-6 - 0.5e-12, 15);
	});
});
