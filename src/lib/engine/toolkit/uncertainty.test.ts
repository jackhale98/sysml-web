/**
 * Uncertain values in a model (`uncertainty.ts`): read from the Uncertainty
 * library's attributes, sampled through the model's own expressions, and
 * shown by the checks and the budgets. Known answers come from the demo's
 * numbers worked by hand; Monte Carlo results are held to four standard
 * errors (the runs are seeded, so the numbers don't change between runs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalCdf } from '#lib/uncertainty/index.ts';
import type { SourceFile } from '../protocol';
import type { Check } from '../types';
import type { Evaluation } from './evaluation';
import type { ToolkitHost } from './host';
import { demoFiles, exactDemoFiles, loadHost } from './testing';

let host: ToolkitHost;
const files = demoFiles();
const byId = (checks: Check[], id: string) => checks.find((c) => c.requirement?.id === id)!;
const library: SourceFile = {
	path: 'libraries/Uncertainty.sysml',
	text: readFileSync(
		join(import.meta.dirname, '../../../demo/drone/libraries/Uncertainty.sysml'),
		'utf8'
	)
};
/** The analysis's evaluation (internal), for its spreads. */
const evaluationOf = (f: SourceFile[]) => {
	const internal = host as unknown as {
		build(f: SourceFile[]): unknown;
		evaluationOf(b: unknown): Evaluation;
	};
	return internal.evaluationOf(internal.build(f));
};

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(files);
}, 60_000);

describe('the demo’s uncertain values', () => {
	it('say how often the endurance requirement is met', () => {
		const endurance = byId(host.checks(files).checks, 'SYS-001');
		expect(endurance.status).toBe('satisfied');
		const spread = endurance.spread!;
		expect(spread.inputs).toEqual(['drone.battery.capacity', 'drone.battery.usableFraction']);
		expect(spread.samples).toBe(10_000);
		// endurance = capacity × fraction / 400 W ≥ 25 min means capacity × fraction ≥ 166.67 W·h.
		// With capacity ~ N(216, 6²) and fraction ~ U(0.8, 0.9): P = mean over f of Φ((216 − 166.67/f)/6).
		const steps = 2000;
		let exact = 0;
		for (let i = 0; i < steps; i++) {
			const f = 0.8 + (0.1 * (i + 0.5)) / steps;
			exact += normalCdf((216 - (25 * 60 * 400) / 3600 / f) / 6) / steps;
		}
		expect(exact).toBeCloseTo(0.9887, 4);
		// The share's standard error is √(p(1−p)/n) ≈ 0.0011: within 4 of them.
		expect(Math.abs(spread.met.share - exact)).toBeLessThan(
			4 * Math.sqrt((exact * (1 - exact)) / 10_000)
		);
		expect(spread.met.low).toBeLessThan(spread.met.share);
		expect(endurance.explanation).toBe(
			`Met in ${(spread.met.share * 100).toFixed(1)} % of cases: drone.endurance = 27.54 min, in 90 % of cases between 25.59 and 29.54 min (needs ≥ 25 min).`
		);
		// The endurance itself: mean ≈ 216 × 0.85 / 400 W = 27.54 min; σ by first order
		// √((6/216)² + (0.0289/0.85)²) × 27.54 min = 1.209 min. Within 4 standard errors.
		const value = spread.value!;
		expect(value.unit).toBe('s');
		expect(value.nominal).toBeCloseTo(1652.4, 6);
		expect(Math.abs(value.mean - 1652.4)).toBeLessThan((4 * 72.5) / Math.sqrt(10_000));
		expect(Math.abs(value.sd / 60 - 1.209)).toBeLessThan((4 * 1.209) / Math.sqrt(2 * 10_000));
		// Worst case: 210 → 222 W·h is ±3σ of the capacity, the fraction's ends: 0.8 × 198 W·h … 0.9 × 234 W·h.
		expect(value.worstCase.min / 60).toBeCloseTo((198 * 0.8 * 60) / 400, 9);
		expect(value.worstCase.max / 60).toBeCloseTo((234 * 0.9 * 60) / 400, 9);
		expect(value.histogram.counts.reduce((a, b) => a + b, 0)).toBe(10_000);
	});

	it('give the take-off mass a range, and the share within its limit', () => {
		const mass = byId(host.checks(files).checks, 'SYS-003');
		// The battery's tolerance, +60/−40 g read as ±3σ normal, is centred at 1110 g with σ = 100/6 g.
		const value = mass.spread!.value!;
		expect(mass.spread!.inputs).toEqual(['drone.battery.mass']);
		expect(value.nominal).toBe(3770);
		expect(value.unit).toBe('g');
		expect(Math.abs(value.mean - 3780)).toBeLessThan((4 * (100 / 6)) / Math.sqrt(10_000));
		expect(Math.abs(value.sd - 100 / 6)).toBeLessThan((4 * (100 / 6)) / Math.sqrt(2 * 10_000));
		expect(value.worstCase.min).toBeCloseTo(3730, 9);
		expect(value.worstCase.max).toBeCloseTo(3830, 9);
		// 4 kg is 13σ away: every sample is within it.
		expect(mass.spread!.met).toMatchObject({ share: 1, met: 10_000, n: 10_000 });
		// P5 and P95 by hand: 3780 g ∓ 1.645 × 16.67 g = 3752.6 g and 3807.4 g (this run: 3.752 and 3.808 kg).
		expect(mass.explanation).toBe(
			'Met in all 10,000 sampled cases: drone.takeOffMass = 3.77 kg, in 90 % of cases between 3.752 and 3.808 kg (needs ≤ 4 kg).'
		);
	});

	it('show in the mass budget, the same samples as the check', () => {
		const table = host.renderView(files, 'droneMassBudget');
		expect(table.columns).toEqual([
			'path',
			'type',
			'quantity',
			'each',
			'total',
			'likelyRange',
			'share',
			'limit',
			'margin',
			'check',
			'withinLimit'
		]);
		const kinds = table.columnKinds!;
		expect([kinds[5], kinds[10]]).toEqual(['quantity', 'percent']);
		const row = (path: string) => table.rows.find((r) => r[0] === path)!;
		expect(row('drone.battery').slice(4, 6)).toEqual(['1100 g', '1082 – 1138 g']);
		// An exact part has no range; an assembly over the battery has the battery's spread.
		expect(row('drone.airframe')[5]).toBe('');
		expect(row('drone')[5]).toBe('2752 – 2808 g');
		expect(row('drone.takeOffMass').slice(4)).toEqual([
			'3.77 kg',
			'3.752 – 3.808 kg',
			'',
			'≤ 4 kg',
			'0.23 kg (5.8 %)',
			'satisfied',
			'100 %'
		]);
	});

	it('vary the four motors independently in the power budget', () => {
		const table = host.renderView(files, 'dronePowerBudget');
		const row = (path: string) => table.rows.find((r) => r[0] === path)!;
		// One motor: 92 W ± 1.645 × 4 W for 90 % of cases.
		const [low, high] = row('drone.frontLeft.motor')[5]!.replace(' W', '').split(' – ').map(Number);
		expect(Math.abs(low! - (92 - 1.645 * 4))).toBeLessThan(0.3);
		expect(Math.abs(high! - (92 + 1.645 * 4))).toBeLessThan(0.3);
		// Four independent motors: σ = 4 W × √4 = 8 W, so 397 W ± 13.2 W (not ± 26.3 W, as one
		// motor counted four times would give).
		const total = row('drone')[5]!.replace(' W', '').split(' – ').map(Number);
		expect(Math.abs((total[1]! - total[0]!) / 2 - 1.645 * 8)).toBeLessThan(0.6);
		// The hover power is measured, not added up: exact, no range.
		expect(row('drone.hoverPower')[5]).toBe('');
	});

	it('are the same every time the model is analysed', () => {
		const first = byId(host.checks(files).checks, 'SYS-001').explanation;
		const edited = files.map((f) => ({ ...f, text: `${f.text}\n` }));
		host.analyzeProject(edited);
		expect(byId(host.checks(edited).checks, 'SYS-001').explanation).toBe(first);
		host.analyzeProject(files);
	});

	it('sample the demo’s mass budget quickly', () => {
		// A fresh analysis, so the spreads are built and sampled anew.
		const edited = files.map((f) => ({ ...f, text: `${f.text}\n\n` }));
		host.analyzeProject(edited);
		host.checks(edited);
		const started = performance.now();
		const table = host.renderView(edited, 'droneMassBudget');
		const ms = performance.now() - started;
		const spreads = evaluationOf(edited).spreads;
		// 10,000 samples of every row (31 outputs from one run), not cut short by the time budget.
		expect(spreads.options.samples).toBe(10_000);
		const takeOff = spreads.feature('DroneArchitecture::drone', 'takeOffMass')!;
		const [spread] = spreads.run([{ built: takeOff, nominal: { value: 3770, unit: 'g' } }]);
		expect(spread!.samples).toBe(10_000);
		expect(table.columns).toContain('likelyRange');
		// About 50 ms in Node for the table with its spreads; generous for a loaded machine.
		expect(ms).toBeLessThan(1000);
		host.analyzeProject(files);
	});
});

describe('a model without uncertain values', () => {
	it('reads exactly as before: no spread, no new columns, the same words', () => {
		const exact = exactDemoFiles();
		host.analyzeProject(exact);
		expect(evaluationOf(exact).spreads.any).toBe(false);
		const checks = host.checks(exact).checks;
		expect(checks.some((c) => c.spread)).toBe(false);
		expect(byId(checks, 'SYS-001').explanation).toBe(
			'Met: drone.endurance = 27.54 min (needs ≥ 25 min).'
		);
		expect(byId(checks, 'SYS-003').explanation).toBe(
			'Met: drone.takeOffMass = 3.77 kg (needs ≤ 4 kg).'
		);
		for (const view of ['droneMassBudget', 'dronePowerBudget']) {
			const table = host.renderView(exact, view);
			expect(table.columns).toEqual([
				'path',
				'type',
				'quantity',
				'each',
				'total',
				'share',
				'limit',
				'margin',
				'check'
			]);
		}
		expect(host.renderView(exact, 'designChecks').rows[2]![5]).toBe(
			'Met: drone.endurance = 27.54 min (needs ≥ 25 min).'
		);
		host.analyzeProject(files);
	});
});

describe('uncertain values in a small model', () => {
	const model = (value: string, tolerance: string, limit = '1.104 [kg]'): SourceFile[] => [
		library,
		{
			path: 'Scale.sysml',
			text: `package Scale {
    private import ISQ::*;
    private import SI::*;
    part def Load {
        attribute m :> mass = ${value} {
            attribute tolerance : Uncertainty::Tolerance { ${tolerance} }
        }
        assert constraint light { m <= ${limit} }
    }
}
`
		}
	];

	it('reads a tolerance in g on a value in kg', () => {
		const f = model('1.1 [kg]', ':>> plus = 5 [g];');
		host.analyzeProject(f);
		const [check] = host.checks(f).checks;
		// ±5 g is ±3σ: σ = 5/3 g, so P(m ≤ 1.104 kg) = Φ(4 g / (5/3 g)) = Φ(2.4) = 0.9918.
		expect(check!.status).toBe('satisfied');
		const share = check!.spread!.met.share;
		expect(Math.abs(share - normalCdf(2.4))).toBeLessThan(
			4 * Math.sqrt((0.9918 * 0.0082) / 10_000)
		);
		expect(check!.spread!.value!.unit).toBe('kg');
		expect(check!.spread!.value!.worstCase.min).toBeCloseTo(1.095, 12);
		expect(check!.spread!.value!.worstCase.max).toBeCloseTo(1.105, 12);
		expect(check!.explanation).toMatch(
			/^Met in 99\.\d % of cases: m = 1\.1 kg, in 90 % of cases between /
		);
	});

	it('takes the reading and the sigmas a tolerance states', () => {
		// Read as uniform, ±5 g: P(m ≤ 1.104 kg) = 9/10.
		const f = model(
			'1.1 [kg]',
			':>> plus = 5 [g]; :>> reading = Uncertainty::ToleranceReading::uniform;'
		);
		host.analyzeProject(f);
		const share = host.checks(f).checks[0]!.spread!.met.share;
		expect(Math.abs(share - 0.9)).toBeLessThan(4 * Math.sqrt((0.9 * 0.1) / 10_000));
		// ±5 g as ±2σ: σ = 2.5 g, P = Φ(1.6).
		const g = model('1.1 [kg]', ':>> plus = 5 [g]; :>> sigmas = 2.0;');
		host.analyzeProject(g);
		const two = host.checks(g).checks[0]!.spread!.met.share;
		expect(Math.abs(two - normalCdf(1.6))).toBeLessThan(4 * Math.sqrt((0.945 * 0.055) / 10_000));
	});

	it('says when it can’t read the numbers, and takes the value as exact', () => {
		const f = model('1.1 [kg]', ':>> plus = 5 [m];');
		host.analyzeProject(f);
		const [check] = host.checks(f).checks;
		expect(check!.spread).toBeUndefined();
		expect(check!.explanation).toBe('Met: m = 1.1 kg (needs ≤ 1.104 kg).');
		expect([...evaluationOf(f).spreads.problems.values()]).toEqual([
			"`plus` is in `m`, which doesn't convert to the value's `kg`"
		]);
	});

	it('words a check not met at the values given', () => {
		const f = model('1.105 [kg]', ':>> plus = 5 [g]; :>> minus = 10 [g];');
		host.analyzeProject(f);
		const [check] = host.checks(f).checks;
		expect(check!.status).toBe('violated');
		// The band is 1.095 to 1.110 kg (centre 1.1025, σ = 2.5 g): P(m ≤ 1.104) = Φ(0.6) = 0.7257.
		expect(Math.abs(check!.spread!.met.share - normalCdf(0.6))).toBeLessThan(0.02);
		expect(check!.explanation).toMatch(
			/^Met in only 7\d\.\d % of cases; not met at the values given: m = 1\.105 kg, in 90 % of cases between /
		);
		host.analyzeProject(files);
	});
});
