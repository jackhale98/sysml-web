/**
 * A one-dimensional tolerance stack-up on top of the propagation core: a
 * chain of dimensions, each with a direction (+1 adds to the result, −1
 * takes away from it: a gap is the housing less the parts in it), and the
 * result's worst case, its RSS (first-order) spread and, when asked, a
 * Monte Carlo run, side by side. The model is the linear sum Σ dᵢ·xᵢ,
 * so first order is exact and worst case is the sum of the bands.
 *
 * This is the thin layer `docs/uncertainty.md` describes: reading a chain
 * from the model (dimensions of parts, their directions) and showing the
 * three answers is what a stack-up view adds.
 */
import { fromTolerance, type Distribution, type Tolerance } from './distributions.ts';
import {
	firstOrder,
	monteCarlo,
	worstCase,
	type MonteCarloOptions,
	type MonteCarloResult
} from './propagate.ts';
import type { UncertainInput } from './sampling.ts';
import type { Limit } from './statistics.ts';

export interface StackDimension {
	name: string;
	/** +1 when it adds to the result, −1 when it takes away (or any other coefficient). */
	direction: number;
	/** The dimension as a tolerance band, or a distribution (its range for worst case then follows the distribution). */
	tolerance: Tolerance | { nominal: number; distribution: Distribution; range?: [number, number] };
}

export interface StackResult {
	/** Σ dᵢ · nominalᵢ. */
	nominal: number;
	worstCase: { min: number; max: number };
	/** First order: the mean and standard deviation, and mean ± 3σ (the RSS band). */
	rss: { mean: number; sd: number; low: number; high: number };
	monteCarlo?: MonteCarloResult;
}

export function stackUp(
	dimensions: readonly StackDimension[],
	options: { monteCarlo?: MonteCarloOptions; limit?: Limit } = {}
): StackResult {
	const inputs: UncertainInput[] = dimensions.map((d) => {
		const t = d.tolerance;
		if ('distribution' in t)
			return { name: d.name, distribution: t.distribution, ...(t.range ? { range: t.range } : {}) };
		const { distribution, range } = fromTolerance(t);
		return { name: d.name, distribution, range };
	});
	const directions = dimensions.map((d) => d.direction);
	const model = (x: Float64Array) => {
		let s = 0;
		for (let i = 0; i < directions.length; i++) s += directions[i]! * x[i]!;
		return s;
	};
	const nominal = dimensions.reduce((s, d) => s + d.direction * d.tolerance.nominal, 0);
	const worst = worstCase(inputs, model);
	const first = firstOrder(inputs, model);
	const result: StackResult = {
		nominal,
		worstCase: { min: worst.min, max: worst.max },
		rss: {
			mean: first.value,
			sd: first.sd,
			low: first.value - 3 * first.sd,
			high: first.value + 3 * first.sd
		}
	};
	if (options.monteCarlo)
		result.monteCarlo = monteCarlo(
			inputs,
			[{ model, ...(options.limit ? { limit: options.limit } : {}) }],
			options.monteCarlo
		).outputs[0];
	return result;
}
