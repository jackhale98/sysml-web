/**
 * Propagating uncertain values through a model (a function of them):
 *
 * - **Monte Carlo** (`monteCarlo`): sample every value from its
 *   distribution (independently, or by Latin hypercube), evaluate the model
 *   for each sample, and summarise the results: mean, standard deviation,
 *   P5/P50/P95, a histogram, and the share of samples that meets a limit.
 *   Seeded, so a run is reproducible; 10,000 samples by default, and a time
 *   budget after which it stops with what it has (at least 1,000 samples,
 *   or all asked for when fewer). Several outputs share one set of samples,
 *   so a budget's rows and their total agree sample by sample.
 * - **First order** (`firstOrder`): the model linearised at the values'
 *   means (central differences), and the standard deviations combined
 *   in quadrature (root sum of squares, RSS). Exact for a linear model
 *   (a sum, a stack of dimensions); for a product or a quotient it misses
 *   the second-order terms (a quotient's mean is biased upward by about
 *   x·σy²/y³), which Monte Carlo keeps.
 * - **Worst case** (`worstCase`): every value at the end of its range that
 *   pushes the result furthest each way (interval analysis by vertices).
 *   The direction is found from the model itself, so it is exact for any
 *   model that moves one way with each value over its range: sums, stacks,
 *   products and quotients of positive values. For a model that turns
 *   back inside a range it can understate the extremes.
 *
 * Models are plain functions of a sample vector (`Float64Array`, one number
 * per input in the input's own unit), so they run in a worker and in tests
 * alike. `compile.ts` makes them from the model's expressions.
 */
import { mean, range as rangeOf, standardDeviation } from './distributions.ts';
import { sampleInput, type SamplingMethod, type UncertainInput } from './sampling.ts';
import {
	meets,
	probabilityOf,
	summarize,
	type Limit,
	type Probability,
	type SampleSummary
} from './statistics.ts';

export type Model = (x: Float64Array) => number;

export interface MonteCarloOptions {
	/** How many samples to draw (10,000 unless said). */
	samples?: number;
	/** The seed; the same seed gives the same samples (1 unless said). */
	seed?: number;
	method?: SamplingMethod;
	/** Stop after about this long, ms (250 unless said), keeping at least `MIN_SAMPLES`. */
	timeBudgetMs?: number;
	/** Bins of each histogram (20 unless said). */
	bins?: number;
}

export interface Output {
	model: Model;
	/** A limit the result is held to; the summary then says how often it is met. */
	limit?: Limit;
}

export interface MonteCarloResult extends SampleSummary {
	/** The share of samples that met the output's limit, when it has one. */
	probability?: Probability;
}

export interface MonteCarloRun {
	outputs: MonteCarloResult[];
	/** Samples evaluated (fewer than asked when the time budget ran out). */
	samples: number;
	requested: number;
	method: SamplingMethod;
	seed: number;
	ms: number;
}

export const DEFAULT_SAMPLES = 10_000;
export const DEFAULT_SEED = 1;
export const DEFAULT_TIME_BUDGET_MS = 250;
/** A run cut short by its time budget still evaluates this many samples. */
export const MIN_SAMPLES = 1_000;
/** Samples evaluated between looks at the clock. */
const CHUNK = 500;

/**
 * Sample the inputs and evaluate every output for each sample. `samples`
 * may be given precomputed (one array per input, as `sampleInput` makes
 * them), to share them between runs.
 */
export function monteCarlo(
	inputs: readonly UncertainInput[],
	outputs: readonly Output[],
	options: MonteCarloOptions = {},
	samples?: readonly Float64Array[]
): MonteCarloRun {
	const started = now();
	const requested = Math.max(1, Math.floor(options.samples ?? DEFAULT_SAMPLES));
	const seed = options.seed ?? DEFAULT_SEED;
	const method = options.method ?? 'random';
	const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
	const columns = samples ?? inputs.map((input) => sampleInput(input, requested, method, seed));
	const results = outputs.map(() => new Float64Array(requested));
	const met = outputs.map(() => 0);
	const x = new Float64Array(inputs.length);
	let done = 0;
	while (done < requested) {
		const end = Math.min(requested, done + CHUNK);
		for (let i = done; i < end; i++) {
			for (let k = 0; k < x.length; k++) x[k] = columns[k]![i]!;
			for (let o = 0; o < outputs.length; o++) {
				const value = outputs[o]!.model(x);
				results[o]![i] = value;
				const limit = outputs[o]!.limit;
				if (limit && Number.isFinite(value) && meets(value, limit)) met[o]!++;
			}
		}
		done = end;
		if (done >= MIN_SAMPLES && now() - started > budget) break;
	}
	return {
		outputs: outputs.map((output, o) => {
			const summary = summarize(results[o]!.subarray(0, done), options.bins);
			return output.limit ? { ...summary, probability: probabilityOf(met[o]!, done) } : summary;
		}),
		samples: done,
		requested,
		method,
		seed,
		ms: now() - started
	};
}

export interface FirstOrderResult {
	/** The model at the inputs' means: the first-order estimate of the result's mean. */
	value: number;
	/** √Σ (∂f/∂xᵢ · σᵢ)²: the root sum of squares of each input's contribution. */
	sd: number;
	/** ∂f/∂xᵢ at the means. */
	sensitivities: number[];
	/** Each input's share of the variance (sums to 1 when sd > 0). */
	shares: number[];
}

/** Linearised (first-order, RSS) propagation at the inputs' means. */
export function firstOrder(inputs: readonly UncertainInput[], model: Model): FirstOrderResult {
	const x0 = Float64Array.from(inputs, (input) => mean(input.distribution));
	const value = model(x0);
	const sensitivities = inputs.map((input, i) => {
		const sd = standardDeviation(input.distribution);
		// A step small against the spread: exact for a linear model, close for a smooth one.
		const h = sd > 0 ? sd * 1e-3 : Math.abs(x0[i]!) * 1e-6 || 1e-6;
		const x = Float64Array.from(x0);
		x[i] = x0[i]! + h;
		const up = model(x);
		x[i] = x0[i]! - h;
		const down = model(x);
		return (up - down) / (2 * h);
	});
	const contributions = inputs.map(
		(input, i) => (sensitivities[i]! * standardDeviation(input.distribution)) ** 2
	);
	const variance = contributions.reduce((a, b) => a + b, 0);
	return {
		value,
		sd: Math.sqrt(variance),
		sensitivities,
		shares: contributions.map((c) => (variance > 0 ? c / variance : 0))
	};
}

export interface WorstCaseResult {
	min: number;
	max: number;
	/** Per input: +1 when the result grows with it, −1 when it shrinks, 0 when it doesn't move. */
	directions: number[];
}

/** Every input at the end of its range that pushes the result furthest each way. */
export function worstCase(inputs: readonly UncertainInput[], model: Model): WorstCaseResult {
	const ranges = inputs.map((input) => input.range ?? rangeOf(input.distribution));
	const centre = Float64Array.from(ranges, ([lo, hi]) => (lo + hi) / 2);
	const directions = ranges.map(([lo, hi], i) => {
		const x = Float64Array.from(centre);
		x[i] = hi;
		const up = model(x);
		x[i] = lo;
		const down = model(x);
		return Math.sign(up - down);
	});
	const corner = (towards: number) =>
		Float64Array.from(ranges, ([lo, hi], i) => (directions[i]! * towards >= 0 ? hi : lo));
	const [a, b] = [model(corner(1)), model(corner(-1))];
	return { min: Math.min(a, b), max: Math.max(a, b), directions };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
