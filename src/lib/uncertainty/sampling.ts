/**
 * Samples of uncertain values: plain Monte Carlo (independent random
 * draws) or Latin hypercube sampling, both seeded and reproducible.
 *
 * Each value is sampled through its distribution's quantile function from
 * uniform numbers in (0, 1). With **Latin hypercube** sampling the range
 * (0, 1) is cut into n equal strata, each value takes one number from each
 * stratum in a random order (its own permutation), so every value covers
 * its whole distribution evenly even with few samples: means and spreads
 * settle with fewer samples than independent draws. The first k of n such
 * samples are still unbiased draws (each row is uniform), so a run cut short
 * by its time budget stays correct; it only loses some of the evenness.
 *
 * Each value draws from its own stream (`Random`'s stream name), so its
 * samples are the same whichever other values a run includes.
 */
import { quantile, type Distribution } from './distributions.ts';
import { Random } from './random.ts';

export type SamplingMethod = 'random' | 'latin-hypercube';

/** An uncertain value: a name (its stream), its distribution and its worst-case range. */
export interface UncertainInput {
	name: string;
	distribution: Distribution;
	/** The range worst-case analysis takes; the distribution's own (`range`) when left out. */
	range?: [number, number];
}

/** `n` uniform numbers in (0, 1), drawn independently or one per stratum. */
export function uniforms(n: number, method: SamplingMethod, random: Random): Float64Array {
	const out = new Float64Array(n);
	if (method === 'random') {
		for (let i = 0; i < n; i++) out[i] = random.next();
		return out;
	}
	// A random permutation of the strata (Fisher–Yates), then a random point in each.
	const order = new Int32Array(n);
	for (let i = 0; i < n; i++) order[i] = i;
	for (let i = n - 1; i > 0; i--) {
		const j = random.below(i + 1);
		const t = order[i]!;
		order[i] = order[j]!;
		order[j] = t;
	}
	for (let i = 0; i < n; i++) out[i] = (order[i]! + random.next()) / n;
	return out;
}

/** `n` samples of one value, from its own stream of the seed. */
export function sampleInput(
	input: UncertainInput,
	n: number,
	method: SamplingMethod,
	seed: number
): Float64Array {
	const u = uniforms(n, method, new Random(seed, input.name));
	const d = input.distribution;
	for (let i = 0; i < n; i++) u[i] = quantile(d, u[i]!);
	return u;
}
