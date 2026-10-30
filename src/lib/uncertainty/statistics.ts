/**
 * What a set of samples says: mean, standard deviation, percentiles, a
 * histogram, and the share that meets a limit with its Monte Carlo error.
 */

/** A limit a result is held to (`≤ 4 kg`), in the result's unit. */
export interface Limit {
	operator: '<=' | '<' | '>=' | '>';
	value: number;
}

export interface Histogram {
	/** The lower edge of the first bin. */
	from: number;
	/** The width of every bin (0 when all samples are equal: one bin). */
	width: number;
	counts: number[];
}

export interface SampleSummary {
	/** Samples summarised (those with a finite result). */
	n: number;
	/** Samples whose result was not a finite number (a division by zero), left out. */
	failed: number;
	mean: number;
	/** Sample standard deviation (n − 1). */
	sd: number;
	min: number;
	max: number;
	/** P5, P50 (the median) and P95. */
	p5: number;
	p50: number;
	p95: number;
	histogram: Histogram;
}

/** The p-th quantile (0 ≤ p ≤ 1) of sorted values, interpolated linearly (Hyndman–Fan type 7, Excel's PERCENTILE.INC). */
export function percentileOf(sorted: ArrayLike<number>, p: number): number {
	const n = sorted.length;
	if (!n) return NaN;
	const h = (n - 1) * p;
	const lo = Math.floor(h);
	const hi = Math.min(lo + 1, n - 1);
	return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Equal-width bins from the least to the greatest value. */
export function histogramOf(sorted: ArrayLike<number>, bins = 20): Histogram {
	const n = sorted.length;
	if (!n) return { from: 0, width: 0, counts: [] };
	const from = sorted[0]!;
	const span = sorted[n - 1]! - from;
	if (!(span > 0)) return { from, width: 0, counts: [n] };
	const width = span / bins;
	const counts = new Array<number>(bins).fill(0);
	for (let i = 0; i < n; i++) {
		const bin = Math.min(bins - 1, Math.floor((sorted[i]! - from) / width));
		counts[bin]!++;
	}
	return { from, width, counts };
}

/** Summary of samples (non-finite ones are counted as failed and left out). */
export function summarize(values: ArrayLike<number>, bins = 20): SampleSummary {
	const finite: number[] = [];
	for (let i = 0; i < values.length; i++) {
		const v = values[i]!;
		if (Number.isFinite(v)) finite.push(v);
	}
	const sorted = Float64Array.from(finite).sort();
	const n = sorted.length;
	let sum = 0;
	for (let i = 0; i < n; i++) sum += sorted[i]!;
	const mean = n ? sum / n : NaN;
	let squares = 0;
	for (let i = 0; i < n; i++) squares += (sorted[i]! - mean) ** 2;
	return {
		n,
		failed: values.length - n,
		mean,
		sd: n > 1 ? Math.sqrt(squares / (n - 1)) : 0,
		min: n ? sorted[0]! : NaN,
		max: n ? sorted[n - 1]! : NaN,
		p5: percentileOf(sorted, 0.05),
		p50: percentileOf(sorted, 0.5),
		p95: percentileOf(sorted, 0.95),
		histogram: histogramOf(sorted, bins)
	};
}

export function meets(value: number, limit: Limit): boolean {
	switch (limit.operator) {
		case '<=':
			return value <= limit.value;
		case '<':
			return value < limit.value;
		case '>=':
			return value >= limit.value;
		case '>':
			return value > limit.value;
	}
}

export interface Probability {
	/** The share of samples that meet it (failed samples count as not meeting it). */
	value: number;
	/** How many samples met it, of how many. */
	met: number;
	n: number;
	/**
	 * The 95 % confidence interval of the share (Wilson's score interval),
	 * which stays inside [0, 1] and is honest when every sample met it.
	 */
	low: number;
	high: number;
}

/** The share of `n` samples that met a condition, `met` of them, with its 95 % interval. */
export function probabilityOf(met: number, n: number): Probability {
	const p = n ? met / n : NaN;
	const z = 1.959963984540054;
	const z2 = z * z;
	const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
	const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
	return { value: p, met, n, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}
