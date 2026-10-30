/**
 * The distributions an uncertain value can have, with their moments, their
 * quantile functions (to turn a uniform random number into a sample, and a
 * stratum of a Latin hypercube into one) and the range worst-case analysis
 * takes for them.
 *
 * - **Normal** (mean, standard deviation): a measured or estimated value
 *   whose errors add up from many small causes. Its worst-case range is
 *   mean ± 3 standard deviations (99.73 % of values), unless it comes from
 *   a tolerance band, which is then the range.
 * - **Uniform** (min, max): any value in the range as likely as any other;
 *   what you know is only the range.
 * - **Triangular** (min, mode, max): most likely at the mode, falling to
 *   none at the ends; a range with a best guess.
 * - **A tolerance** (nominal +plus/−minus) is one of these by a stated
 *   reading (`fromTolerance`): `normal` (the band is ± `sigmas` standard
 *   deviations, 3 unless said, centred on the band), `uniform` over the
 *   band, or `triangular` with its mode at the nominal. The band is always
 *   its worst-case range.
 *
 * Every number is in one unit, the caller's; nothing here knows units.
 */

export type Distribution =
	| { kind: 'normal'; mean: number; sd: number }
	| { kind: 'uniform'; min: number; max: number }
	| { kind: 'triangular'; min: number; mode: number; max: number };

/** How a tolerance band is read as a distribution. */
export type ToleranceReading = 'normal' | 'uniform' | 'triangular';

export interface Tolerance {
	nominal: number;
	/** How far above the nominal the band goes (≥ 0). */
	plus: number;
	/** How far below the nominal the band goes (≥ 0). */
	minus: number;
	reading: ToleranceReading;
	/** For the normal reading: how many standard deviations the band spans each way (3 unless said). */
	sigmas?: number;
}

/** The standard deviations each side of the mean a normal's worst-case range spans. */
export const NORMAL_RANGE_SIGMAS = 3;

export function mean(d: Distribution): number {
	switch (d.kind) {
		case 'normal':
			return d.mean;
		case 'uniform':
			return (d.min + d.max) / 2;
		case 'triangular':
			return (d.min + d.mode + d.max) / 3;
	}
}

export function variance(d: Distribution): number {
	switch (d.kind) {
		case 'normal':
			return d.sd * d.sd;
		case 'uniform':
			return (d.max - d.min) ** 2 / 12;
		case 'triangular': {
			const { min: a, mode: c, max: b } = d;
			return (a * a + b * b + c * c - a * b - a * c - b * c) / 18;
		}
	}
}

export const standardDeviation = (d: Distribution): number => Math.sqrt(variance(d));

/** The value below which a share `p` (0 < p < 1) of the distribution lies. */
export function quantile(d: Distribution, p: number): number {
	switch (d.kind) {
		case 'normal':
			return d.mean + d.sd * normalQuantile(p);
		case 'uniform':
			return d.min + (d.max - d.min) * p;
		case 'triangular': {
			const { min: a, mode: c, max: b } = d;
			if (b === a) return a;
			const split = (c - a) / (b - a);
			return p < split
				? a + Math.sqrt(p * (b - a) * (c - a))
				: b - Math.sqrt((1 - p) * (b - a) * (b - c));
		}
	}
}

/** The share of the distribution at or below `x`. */
export function cdf(d: Distribution, x: number): number {
	switch (d.kind) {
		case 'normal':
			return d.sd > 0 ? normalCdf((x - d.mean) / d.sd) : x >= d.mean ? 1 : 0;
		case 'uniform':
			if (x < d.min) return 0;
			if (x >= d.max) return 1;
			return (x - d.min) / (d.max - d.min);
		case 'triangular': {
			const { min: a, mode: c, max: b } = d;
			if (x <= a) return 0;
			if (x >= b) return 1;
			return x <= c ? (x - a) ** 2 / ((b - a) * (c - a)) : 1 - (b - x) ** 2 / ((b - a) * (b - c));
		}
	}
}

/** The range worst-case analysis takes: the distribution's ends, or mean ± 3σ for a normal. */
export function range(d: Distribution): [number, number] {
	switch (d.kind) {
		case 'normal':
			return [d.mean - NORMAL_RANGE_SIGMAS * d.sd, d.mean + NORMAL_RANGE_SIGMAS * d.sd];
		case 'uniform':
		case 'triangular':
			return [d.min, d.max];
	}
}

/** A tolerance band read as a distribution, and the band. */
export function fromTolerance(t: Tolerance): {
	distribution: Distribution;
	range: [number, number];
} {
	const low = t.nominal - t.minus;
	const high = t.nominal + t.plus;
	const range: [number, number] = [low, high];
	switch (t.reading) {
		case 'normal': {
			const sigmas = t.sigmas ?? NORMAL_RANGE_SIGMAS;
			return {
				distribution: { kind: 'normal', mean: (low + high) / 2, sd: (high - low) / (2 * sigmas) },
				range
			};
		}
		case 'uniform':
			return { distribution: { kind: 'uniform', min: low, max: high }, range };
		case 'triangular':
			return { distribution: { kind: 'triangular', min: low, mode: t.nominal, max: high }, range };
	}
}

/** What is wrong with a distribution's numbers, in a phrase, or null when nothing is. */
export function problemOf(d: Distribution): string | null {
	const numbers =
		d.kind === 'normal'
			? [d.mean, d.sd]
			: d.kind === 'uniform'
				? [d.min, d.max]
				: [d.min, d.mode, d.max];
	if (!numbers.every(Number.isFinite)) return 'a number is missing';
	switch (d.kind) {
		case 'normal':
			return d.sd < 0 ? 'the standard deviation is negative' : null;
		case 'uniform':
			return d.min > d.max ? 'the minimum is above the maximum' : null;
		case 'triangular':
			return d.min > d.max
				? 'the minimum is above the maximum'
				: d.mode < d.min || d.mode > d.max
					? 'the most likely value is outside the range'
					: null;
	}
}

// ---- The standard normal distribution ----

/**
 * Φ⁻¹(p), the standard normal quantile: Acklam's rational approximation
 * (relative error below 1.2e-9), refined by one Halley step.
 */
export function normalQuantile(p: number): number {
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a = [
		-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
		-3.066479806614716e1, 2.506628277459239
	];
	const b = [
		-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
		-1.328068155288572e1
	];
	const c = [
		-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
		4.374664141464968, 2.938163982698783
	];
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
	const low = 0.02425;
	let x: number;
	if (p < low) {
		const q = Math.sqrt(-2 * Math.log(p));
		x =
			(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
	} else if (p <= 1 - low) {
		const q = p - 0.5;
		const r = q * q;
		x =
			((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
			(((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
	} else {
		const q = Math.sqrt(-2 * Math.log(1 - p));
		x =
			-(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
	}
	// One Halley step against the accurate CDF.
	const e = normalCdf(x) - p;
	const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
	return x - u / (1 + (x * u) / 2);
}

/** Φ(x), the standard normal CDF, from `erfc`. */
export function normalCdf(x: number): number {
	return 0.5 * erfc(-x / Math.SQRT2);
}

/**
 * The complementary error function: erf's Taylor series below |x| = 2.5,
 * else erfc's continued fraction (Lentz's method); relative error below
 * 1e-9 over the whole line, far below what a Monte Carlo run resolves.
 */
export function erfc(x: number): number {
	const ax = Math.abs(x);
	let tail: number;
	if (ax < 2.5) {
		// erf(x) = 2/√π · Σ (−1)ⁿ x^(2n+1) / (n! (2n+1))
		let term = ax;
		let sum = ax;
		for (let n = 1; n < 200; n++) {
			term *= (-ax * ax) / n;
			const add = term / (2 * n + 1);
			sum += add;
			if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
		}
		tail = 1 - (2 / Math.sqrt(Math.PI)) * sum;
	} else {
		// erfc(x) = e^(−x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …))))
		const tiny = 1e-300;
		let f = ax;
		let c = ax;
		let d = 0;
		for (let n = 1; n < 500; n++) {
			const a = n / 2;
			d = ax + a * d;
			d = Math.abs(d) < tiny ? tiny : d;
			c = ax + a / c;
			c = Math.abs(c) < tiny ? tiny : c;
			d = 1 / d;
			const delta = c * d;
			f *= delta;
			if (Math.abs(delta - 1) < 1e-16) break;
		}
		tail = Math.exp(-ax * ax) / (Math.sqrt(Math.PI) * f);
	}
	return x >= 0 ? tail : 2 - tail;
}
