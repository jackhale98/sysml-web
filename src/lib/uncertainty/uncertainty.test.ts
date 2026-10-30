/**
 * The propagation core against answers known in closed form. Monte Carlo
 * results are held to bounds of a few standard errors of the estimate
 * (each test says which, and why); the runs are seeded, so each test
 * gives the same numbers every time and the bounds are a statement of the
 * method's accuracy rather than a source of flaky failures.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, parseExpr, Quantity } from '#lib/sim/expr.ts';
import {
	cdf,
	compile,
	CompileError,
	constant,
	DEFAULT_SAMPLES,
	firstOrder,
	fromTolerance,
	input,
	mean,
	monteCarlo,
	normalCdf,
	normalQuantile,
	percentileOf,
	probabilityOf,
	problemOf,
	quantile,
	Random,
	range,
	sampleInput,
	stackUp,
	standardDeviation,
	summarize,
	uniforms,
	variance,
	worstCase,
	type Distribution,
	type UncertainInput
} from './index';

const normal = (m: number, sd: number): Distribution => ({ kind: 'normal', mean: m, sd });
const sum = (x: Float64Array) => x.reduce((a, b) => a + b, 0);

describe('the random numbers', () => {
	it('repeat with the same seed and stream, and differ between streams', () => {
		const draw = (seed: number, stream: string) => {
			const r = new Random(seed, stream);
			return Array.from({ length: 5 }, () => r.next());
		};
		expect(draw(7, 'a')).toEqual(draw(7, 'a'));
		expect(draw(7, 'a')).not.toEqual(draw(7, 'b'));
		expect(draw(7, 'a')).not.toEqual(draw(8, 'a'));
	});

	it('are uniform in (0, 1)', () => {
		const r = new Random(1);
		const n = 100_000;
		const u = Array.from({ length: n }, () => r.next());
		expect(Math.min(...u)).toBeGreaterThan(0);
		expect(Math.max(...u)).toBeLessThan(1);
		// The mean of n uniforms has a standard error of √(1/12n) ≈ 0.0009: within 4 of them.
		expect(Math.abs(u.reduce((a, b) => a + b, 0) / n - 0.5)).toBeLessThan(
			4 * Math.sqrt(1 / 12 / n)
		);
		// Ten equal bins hold n/10 each, ± 4 binomial standard deviations (√(n·0.1·0.9) ≈ 95).
		const bins = new Array(10).fill(0);
		for (const x of u) bins[Math.floor(x * 10)]++;
		for (const count of bins)
			expect(Math.abs(count - n / 10)).toBeLessThan(4 * Math.sqrt(n * 0.09));
	});
});

describe('the distributions', () => {
	it('have the textbook moments', () => {
		expect(mean({ kind: 'uniform', min: 2, max: 8 })).toBe(5);
		expect(variance({ kind: 'uniform', min: 2, max: 8 })).toBe(3);
		// Triangular (a, c, b) = (1, 2, 6): mean (a+b+c)/3 = 3, variance (a²+b²+c²−ab−ac−bc)/18 = 21/18.
		const tri: Distribution = { kind: 'triangular', min: 1, mode: 2, max: 6 };
		expect(mean(tri)).toBe(3);
		expect(variance(tri)).toBeCloseTo(21 / 18, 12);
		expect(standardDeviation(normal(1, 0.25))).toBe(0.25);
	});

	it('invert their CDFs', () => {
		for (const d of [
			normal(10, 2),
			{ kind: 'uniform', min: -1, max: 3 } as const,
			{ kind: 'triangular', min: 1, mode: 2, max: 6 } as const
		])
			for (const p of [0.001, 0.05, 0.3, 0.5, 0.95, 0.999])
				expect(cdf(d, quantile(d, p))).toBeCloseTo(p, 9);
		expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 12);
		expect(normalQuantile(0.05)).toBeCloseTo(-1.6448536269514722, 12);
		expect(normalCdf(-3)).toBeCloseTo(0.0013498980316301, 14);
		expect(normalCdf(5)).toBeCloseTo(1 - 2.866515718791939e-7, 14);
	});

	it('read a tolerance band by the stated convention', () => {
		// 100 +6/−4: the band is 96 to 106 whatever the reading.
		const t = { nominal: 100, plus: 6, minus: 4 };
		const asNormal = fromTolerance({ ...t, reading: 'normal' });
		// ±3σ: centred on the band (101), σ = band / 6.
		expect(asNormal.distribution).toEqual({ kind: 'normal', mean: 101, sd: 10 / 6 });
		expect(asNormal.range).toEqual([96, 106]);
		expect(fromTolerance({ ...t, reading: 'normal', sigmas: 2 }).distribution).toEqual(
			normal(101, 2.5)
		);
		expect(fromTolerance({ ...t, reading: 'uniform' }).distribution).toEqual({
			kind: 'uniform',
			min: 96,
			max: 106
		});
		expect(fromTolerance({ ...t, reading: 'triangular' }).distribution).toEqual({
			kind: 'triangular',
			min: 96,
			mode: 100,
			max: 106
		});
		// A normal without a band is taken at ±3σ for worst case.
		expect(range(normal(10, 2))).toEqual([4, 16]);
	});

	it('say what is wrong with their numbers', () => {
		expect(problemOf(normal(1, -1))).toBe('the standard deviation is negative');
		expect(problemOf({ kind: 'uniform', min: 2, max: 1 })).toBe('the minimum is above the maximum');
		expect(problemOf({ kind: 'triangular', min: 0, mode: 3, max: 2 })).toBe(
			'the most likely value is outside the range'
		);
		expect(problemOf(normal(NaN, 1))).toBe('a number is missing');
		expect(problemOf(normal(1, 0))).toBeNull();
	});

	it('are sampled with their moments (uniform and triangular)', () => {
		const n = 50_000;
		for (const d of [
			{ kind: 'uniform', min: 2, max: 8 } as const,
			{ kind: 'triangular', min: 1, mode: 2, max: 6 } as const
		]) {
			const s = summarize(sampleInput({ name: d.kind, distribution: d }, n, 'random', 3));
			const sd = standardDeviation(d);
			// The sample mean's standard error is σ/√n: within 4 of them.
			expect(Math.abs(s.mean - mean(d))).toBeLessThan((4 * sd) / Math.sqrt(n));
			// The sample variance's relative standard error is √((κ−1)/n), κ the kurtosis
			// (1.8 uniform, 2.4 triangular): 0.4 % and 0.53 % at n = 50,000. Within 4 of them.
			const kurtosis = d.kind === 'uniform' ? 1.8 : 2.4;
			expect(Math.abs(s.sd ** 2 / variance(d) - 1)).toBeLessThan(4 * Math.sqrt((kurtosis - 1) / n));
		}
	});
});

describe('Latin hypercube sampling', () => {
	it('puts one sample in each of n equal strata', () => {
		const n = 1000;
		const u = uniforms(n, 'latin-hypercube', new Random(5));
		const strata = new Set(Array.from(u, (x) => Math.floor(x * n)));
		expect(strata.size).toBe(n);
	});

	it('settles a sum’s mean far better than independent draws', () => {
		const inputs: UncertainInput[] = [
			{ name: 'a', distribution: normal(10, 1) },
			{ name: 'b', distribution: { kind: 'uniform', min: 0, max: 6 } }
		];
		const error = (method: 'random' | 'latin-hypercube') =>
			Math.abs(
				monteCarlo(inputs, [{ model: sum }], { samples: 2000, method }).outputs[0]!.mean - 13
			);
		// Each value's strata are all covered, so a sum's mean is nearly exact.
		expect(error('latin-hypercube')).toBeLessThan(1e-3);
		expect(error('random')).toBeGreaterThan(error('latin-hypercube'));
	});
});

describe('propagation with known answers', () => {
	const x = { name: 'x', distribution: normal(10, 3) };
	const y = { name: 'y', distribution: normal(20, 4) };

	it('adds normals: mean and variance add', () => {
		const n = 20_000;
		const run = monteCarlo([x, y], [{ model: sum }], { samples: n });
		const out = run.outputs[0]!;
		expect(run.samples).toBe(n);
		// X + Y ~ N(30, 5²). Mean: standard error 5/√n ≈ 0.035, within 4. Standard deviation:
		// standard error σ/√(2n) ≈ 0.025 for a normal, within 4.
		expect(Math.abs(out.mean - 30)).toBeLessThan((4 * 5) / Math.sqrt(n));
		expect(Math.abs(out.sd - 5)).toBeLessThan((4 * 5) / Math.sqrt(2 * n));
		// First order is exact for a sum.
		const first = firstOrder([x, y], sum);
		expect(first.value).toBeCloseTo(30, 9);
		expect(first.sd).toBeCloseTo(5, 6);
		expect(first.shares[0]).toBeCloseTo(9 / 25, 6);
	});

	it('finds percentiles within their Monte Carlo error', () => {
		const n = 20_000;
		const out = monteCarlo([x, y], [{ model: sum }], { samples: n }).outputs[0]!;
		// The standard error of the p-quantile estimate is √(p(1−p)/n) / f(q_p), f the density there:
		// 0.075 at P5 and P95, 0.044 at P50 for N(30, 5²) and n = 20,000. Within 4 of them.
		const density = (z: number) => Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI) / 5;
		for (const [p, got] of [
			[0.05, out.p5],
			[0.5, out.p50],
			[0.95, out.p95]
		] as const) {
			const z = normalQuantile(p);
			const se = Math.sqrt((p * (1 - p)) / n) / density(z);
			expect(Math.abs(got - (30 + 5 * z))).toBeLessThan(4 * se);
		}
		expect(out.histogram.counts.reduce((a, b) => a + b, 0)).toBe(n);
	});

	it('shows where first order falls short: a product’s variance', () => {
		// X ~ N(10, 3²), Y ~ N(5, 2²), independent. Var(XY) = μx²σy² + μy²σx² + σx²σy²
		// = 400 + 225 + 36 = 661 exactly; first order drops σx²σy²: 625.
		const a = { name: 'a', distribution: normal(10, 3) };
		const b = { name: 'b', distribution: normal(5, 2) };
		const product = (v: Float64Array) => v[0]! * v[1]!;
		expect(firstOrder([a, b], product).sd).toBeCloseTo(25, 6);
		const n = 100_000;
		const out = monteCarlo([a, b], [{ model: product }], { samples: n }).outputs[0]!;
		// The product's kurtosis is about 4.6, so the standard deviation's standard error is
		// about σ·√((κ−1)/4n) ≈ 0.08 at n = 100,000: within 4 (0.31) of √661 = 25.71, and so
		// clear of first order's 25.
		expect(Math.abs(out.sd - Math.sqrt(661))).toBeLessThan(0.31);
		expect(out.mean).toBeCloseTo(50, 0);
	});

	it('shows where first order falls short: a quotient’s mean', () => {
		// X ~ N(10, 0.5²), Y ~ N(5, 0.5²): E[X/Y] = (μx/μy)(1 + c² + 3c⁴ + …) with c = σy/μy = 0.1,
		// so 2.0206, where first order says 2.
		const a = { name: 'a', distribution: normal(10, 0.5) };
		const b = { name: 'b', distribution: normal(5, 0.5) };
		const quotient = (v: Float64Array) => v[0]! / v[1]!;
		expect(firstOrder([a, b], quotient).value).toBeCloseTo(2, 9);
		const n = 100_000;
		const out = monteCarlo([a, b], [{ model: quotient }], { samples: n }).outputs[0]!;
		// The quotient's standard deviation is about 0.226: the mean's standard error is
		// 0.0007, within 4 (0.003) of 2.0206.
		expect(Math.abs(out.mean - 2.0206)).toBeLessThan(0.003);
	});

	it('gives the share that meets a limit, with its interval', () => {
		const n = 20_000;
		const run = monteCarlo([x, y], [{ model: sum, limit: { operator: '<=', value: 38 } }], {
			samples: n
		});
		const p = run.outputs[0]!.probability!;
		// P(N(30, 5²) ≤ 38) = Φ(1.6) = 0.9452; binomial standard error √(p(1−p)/n) ≈ 0.0016, within 4.
		expect(Math.abs(p.value - normalCdf(1.6))).toBeLessThan(4 * Math.sqrt((0.9452 * 0.0548) / n));
		expect(p.low).toBeLessThan(p.value);
		expect(p.high).toBeGreaterThan(p.value);
		expect(p.n).toBe(n);
		// Every sample met it: the interval still says how sure that is.
		const all = probabilityOf(10_000, 10_000);
		expect(all.value).toBe(1);
		expect(all.high).toBe(1);
		expect(all.low).toBeCloseTo(0.99962, 5);
	});

	it('is reproducible with a seed', () => {
		const run = (seed?: number, method?: 'latin-hypercube') =>
			monteCarlo([x, y], [{ model: sum }], {
				samples: 3000,
				...(seed ? { seed } : {}),
				...(method ? { method } : {})
			}).outputs[0]!;
		expect(run()).toEqual(run());
		expect(run(42)).toEqual(run(42));
		expect(run(42, 'latin-hypercube')).toEqual(run(42, 'latin-hypercube'));
		expect(run(42).mean).not.toBe(run(43).mean);
		// A value's samples don't depend on the other values in the run (its own stream).
		const alone = monteCarlo([x], [{ model: (v) => v[0]! }], { samples: 100 }).outputs[0]!;
		const together = monteCarlo([y, x], [{ model: (v) => v[1]! }], { samples: 100 }).outputs[0]!;
		expect(together).toEqual(alone);
	});

	it('takes 10,000 samples unless told otherwise, and stops at its time budget', () => {
		expect(DEFAULT_SAMPLES).toBe(10_000);
		expect(monteCarlo([x], [{ model: (v) => v[0]! }]).samples).toBe(10_000);
		// A model that takes 0.1 ms a sample would take 2 s for 20,000: stopped near the budget.
		const slow = (v: Float64Array) => {
			const until = performance.now() + 0.1;
			while (performance.now() < until);
			return v[0]!;
		};
		const run = monteCarlo([x], [{ model: slow }], { samples: 20_000, timeBudgetMs: 50 });
		expect(run.requested).toBe(20_000);
		expect(run.samples).toBe(1_000);
		expect(run.outputs[0]!.n).toBe(1_000);
	});

	it('counts samples with no finite result as failed', () => {
		const out = monteCarlo(
			[{ name: 'u', distribution: { kind: 'uniform', min: -1, max: 1 } }],
			[{ model: (v) => (v[0]! < 0 ? 1 / 0 : v[0]!), limit: { operator: '<=', value: 2 } }],
			{ samples: 1000 }
		).outputs[0]!;
		expect(out.failed + out.n).toBe(1000);
		expect(out.failed).toBeGreaterThan(400);
		expect(out.probability!.value).toBe(out.n / 1000);
	});
});

describe('worst case and RSS', () => {
	it('agree with a hand-worked 4-part linear stack', () => {
		// A housing 50.00 ± 0.10 holds three parts, 20.00 ± 0.05, 15.00 ± 0.05 and 14.50 ± 0.08;
		// the gap is the housing less the parts.
		const t = (nominal: number, tol: number) =>
			({ nominal, plus: tol, minus: tol, reading: 'normal' }) as const;
		const result = stackUp(
			[
				{ name: 'housing', direction: 1, tolerance: t(50, 0.1) },
				{ name: 'a', direction: -1, tolerance: t(20, 0.05) },
				{ name: 'b', direction: -1, tolerance: t(15, 0.05) },
				{ name: 'c', direction: -1, tolerance: t(14.5, 0.08) }
			],
			{ monteCarlo: { samples: 20_000 }, limit: { operator: '>=', value: 0.4 } }
		);
		// Nominal gap: 50 − 20 − 15 − 14.5 = 0.50.
		expect(result.nominal).toBeCloseTo(0.5, 12);
		// Worst case: the tolerances add, ±(0.10 + 0.05 + 0.05 + 0.08) = ±0.28.
		expect(result.worstCase.min).toBeCloseTo(0.22, 12);
		expect(result.worstCase.max).toBeCloseTo(0.78, 12);
		// RSS: √(0.10² + 0.05² + 0.05² + 0.08²) = √0.0214 = 0.14629 at ±3σ, so σ = 0.048762.
		expect(result.rss.sd).toBeCloseTo(Math.sqrt(0.0214) / 3, 9);
		expect(result.rss.low).toBeCloseTo(0.5 - Math.sqrt(0.0214), 9);
		expect(result.rss.high).toBeCloseTo(0.5 + Math.sqrt(0.0214), 9);
		// Monte Carlo: P(gap ≥ 0.4) = Φ(0.1/0.048762) = Φ(2.0508) = 0.97985; standard error
		// √(p(1−p)/n) ≈ 0.001 at n = 20,000, within 4.
		const mc = result.monteCarlo!;
		expect(Math.abs(mc.probability!.value - normalCdf(0.1 / (Math.sqrt(0.0214) / 3)))).toBeLessThan(
			0.004
		);
		expect(Math.abs(mc.sd - Math.sqrt(0.0214) / 3)).toBeLessThan((4 * 0.04876) / Math.sqrt(40_000));
	});

	it('finds the corners of a quotient', () => {
		// Endurance = energy / power: least at the least energy and the most power.
		const inputs: UncertainInput[] = [
			{ name: 'energy', distribution: { kind: 'uniform', min: 180, max: 190 } },
			{ name: 'power', distribution: normal(400, 10) }
		];
		const w = worstCase(inputs, (v) => v[0]! / v[1]!);
		expect(w.min).toBeCloseTo(180 / 430, 12);
		expect(w.max).toBeCloseTo(190 / 370, 12);
		expect(w.directions).toEqual([1, -1]);
	});
});

describe('compiling expressions', () => {
	const bind = (values: Record<string, { index: number; unit: string | null }>) => ({
		name: (n: string) => (values[n] ? input(values[n].index, values[n].unit) : null)
	});
	/** The compiled expression and the app's evaluator agree on the same values. */
	function agrees(source: string, units: Record<string, string | null>, at: number[]) {
		const names = Object.keys(units);
		const compiled = compile(
			parseExpr(source),
			bind(Object.fromEntries(names.map((n, i) => [n, { index: i, unit: units[n]! }])))
		);
		const values = new Map(
			names.map((n, i) => [n, units[n] ? new Quantity(at[i]!, units[n]!) : at[i]!])
		);
		const expected = evaluate(parseExpr(source), { get: (n) => values.get(n) });
		const got = compiled.at(Float64Array.from(at));
		if (typeof expected === 'boolean') return expect(got).toBe(expected ? 1 : 0);
		const magnitude = expected instanceof Quantity ? expected.value : (expected as number);
		expect(compiled.unit).toBe(expected instanceof Quantity ? expected.unit : null);
		// The compiled value is in SI: back to the evaluator's unit.
		const factor = compiled.unit
			? compile(parseExpr(`1 [${compiled.unit}]`), bind({})).at(new Float64Array(0))
			: 1;
		expect(got / factor).toBeCloseTo(magnitude, 9);
	}

	it('agrees with the app’s evaluator, units and all', () => {
		agrees('a + b', { a: 'kg', b: 'g' }, [1.1, 5]);
		agrees('a + 5', { a: 'g' }, [100]);
		agrees('energy / power', { energy: 'W*h', power: 'W' }, [183.6, 400]);
		agrees('(energy / power) [min]', { energy: 'W*h', power: 'W' }, [183.6, 400]);
		agrees('limit - m', { limit: 'kg', m: 'g' }, [4, 3770]);
		agrees('m <= 4 [kg]', { m: 'g' }, [3770]);
		agrees('e >= 25 [min] and e < 1 [h]', { e: 's' }, [1652]);
		agrees('sum(a, b, c) * 2', { a: 'g', b: 'kg', c: 'g' }, [10, 0.02, 30]);
		agrees('max(a, b) - min(a, b)', { a: 'mm', b: 'm' }, [650, 0.6]);
		agrees('rss(a, b)', { a: 'mm', b: 'mm' }, [3, 4]);
		agrees('if a > 1 [kg] ? a else 2 * a', { a: 'g' }, [1500]);
		agrees('a ** 2 / b', { a: 'm', b: 's' }, [3, 2]);
		agrees('capacity * fraction', { capacity: 'W*h', fraction: null }, [216, 0.85]);
	});

	it('folds what reads no input to a constant', () => {
		const c = compile(parseExpr('2 [kg] + 500 [g]'), bind({}));
		expect(c.constant).toBe(true);
		expect(c.at(new Float64Array(0))).toBeCloseTo(2.5, 12);
		expect(constant(5, 'g').at(new Float64Array(0))).toBeCloseTo(0.005, 15);
	});

	it('refuses what it can’t sample rather than guess', () => {
		const refuse = (source: string, units: Record<string, string | null> = { a: 'kg' }) =>
			expect(() =>
				compile(
					parseExpr(source),
					bind(
						Object.fromEntries(Object.keys(units).map((n, i) => [n, { index: i, unit: units[n]! }]))
					)
				)
			).toThrow(CompileError);
		refuse('a + 1 [m]');
		refuse('t + 1 [K]', { t: '°C' });
		refuse('a % 2');
		refuse('b + 1');
		refuse('a + 1 [furlongs]');
		refuse('"text"');
	});
});

describe('percentiles', () => {
	it('interpolate as Excel’s PERCENTILE.INC does', () => {
		const sorted = [1, 2, 3, 4, 5];
		expect(percentileOf(sorted, 0.5)).toBe(3);
		expect(percentileOf(sorted, 0.05)).toBeCloseTo(1.2, 12);
		expect(percentileOf(sorted, 0.95)).toBeCloseTo(4.8, 12);
	});
});
