/**
 * Assessment §6.1: the app's own expression evaluator (`sim/expr.ts`), which
 * works out trade-study criteria and sums over collections where the engine
 * doesn't, and runs the simulator's guards. Known answers by hand.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, mapScope, parseExpr, Quantity, type Value } from './expr';

const run = (text: string, vars: Record<string, Value> = {}) =>
	evaluate(parseExpr(text), mapScope(new Map(Object.entries(vars))));
const fails = (text: string) => {
	try {
		run(text);
		return null;
	} catch (error) {
		return (error as Error).message;
	}
};

describe('6.1 the app’s evaluator', () => {
	it('follows KerML precedence', () => {
		// 2 + (3 × 4) = 14; 2 ** (3 ** 2) = 512; (−2) ** 2 = 4; 10 − (4 / 2) = 8; 7 mod 3 = 1;
		// `or` binds looser than `and`: true or (false and false) = true; 1 < 2 == true.
		expect(run('2 + 3 * 4')).toBe(14);
		expect(run('2 ** 3 ** 2')).toBe(512);
		expect(run('-2 ** 2')).toBe(4);
		expect(run('10 - 4 / 2')).toBe(8);
		expect(run('7 % 3')).toBe(1);
		expect(run('true or false and false')).toBe(true);
		expect(run('if 1 > 2 ? 10 else 20')).toBe(20);
	});

	it('refuses division by zero and undefined names, with a reason', () => {
		expect(fails('1 / 0')).toBe('division by zero');
		expect(fails('7 % 0')).toBe('modulo by zero');
		expect(fails('mass + 1')).toBe('undefined variable `mass`');
	});

	it('converts units of one dimension and refuses to mix dimensions', () => {
		// 1 kg + 500 g = 1.5 kg; 1 W·h + 3600 J = 2 W·h.
		expect(run('1 [kg] + 500 [g]')).toEqual(new Quantity(1.5, 'kg'));
		const energy = run('1 [W*h] + 3600 [J]') as Quantity;
		expect(energy.unit).toBe('W*h');
		expect(energy.value).toBeCloseTo(2, 12);
		expect(fails('1 [kg] + 1 [m]')).toBe('cannot apply `+` to 1 [kg] and 1 [m]');
	});

	it('does not add a unit it does not know to one it knows', () => {
		// 1 furlong + 1 m is 201.168 m + 1 m, not "2 furlong": unknown, so it is refused.
		expect(fails('1 [furlong] + 1 [m]') ?? 'no error').toMatch(/cannot apply `\+`/);
		expect(fails('1 [furlong] - 1 [m]') ?? 'no error').toMatch(/cannot apply `-`/);
		expect(fails('sum(1 [furlong], 1 [m])') ?? 'no error').toMatch(/cannot apply/);
		// The same unknown unit adds up with itself.
		expect(run('1 [furlong] + 2 [furlong]')).toEqual(new Quantity(3, 'furlong'));
	});

	it('converts the library’s units: pounds, grains, feet', () => {
		// 7000 gr + 100 g = 7000 gr + 100 / 0.06479891 gr = 8543.2358 gr; 1 lb + 1 kg = 1 + 1 / 0.4535924 lb.
		expect((run('7000 [USCustomaryUnits::gr] + 100 [g]') as Quantity).value).toBeCloseTo(
			7000 + 100 / 0.06479891,
			9
		);
		expect((run('1 [lb] + 1 [kg]') as Quantity).value).toBeCloseTo(1 + 1 / 0.4535924, 12);
		expect((run('1 [ft] + 1 [m]') as Quantity).value).toBeCloseTo(1 + 1 / 0.3048, 12);
	});

	it('compares temperatures across units, and never adds them across units', () => {
		// 20 °C = 293.15 K > 250 K; 50 °F = 283.15 K > 280 K.
		expect(run("20 ['°C'] > 250 [K]")).toBe(true);
		expect(run("50 ['°F'] > 280 [K]")).toBe(true);
		expect(run("max(20 ['°C'], 300 [K])")).toEqual(new Quantity(300 - 273.15, '°C'));
		// 20 °C + 1 K: 21 °C if the kelvin is a difference, -252.15 °C if a temperature. Refused.
		expect(fails("20 ['°C'] + 1 [K]") ?? 'no error').toMatch(/temperature/);
		expect(fails("1 ['°C'] - 1 ['°F']") ?? 'no error').toMatch(/temperature/);
		expect(fails("sum(20 ['°C'], 1 [K])") ?? 'no error').toMatch(/temperature/);
		// In one unit the result is the same whether a value is a temperature or a difference.
		expect(run("20 ['°C'] + 5 ['°C']")).toEqual(new Quantity(25, '°C'));
	});
});
