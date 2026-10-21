import { describe, expect, it } from 'vitest';
import {
	EnumLiteral,
	EvalError,
	ParseError,
	Quantity,
	display,
	evaluate,
	evaluateCondition,
	mapScope,
	parseExpr,
	type Value
} from './expr.ts';
import { convert, normalizeUnit, parseUnit } from './units.ts';

const vars = (values: Record<string, Value> = {}) => mapScope(new Map(Object.entries(values)));
const run = (source: string, values: Record<string, Value> = {}) =>
	evaluate(parseExpr(source), vars(values));
const fails = (source: string, values: Record<string, Value> = {}) => {
	try {
		run(source, values);
	} catch (error) {
		expect(error).toBeInstanceOf(EvalError);
		return (error as Error).message;
	}
	throw new Error(`${source} did not fail`);
};

describe('parsing', () => {
	it('follows KerML precedence', () => {
		expect(run('1 + 2 * 3')).toBe(7);
		expect(run('(1 + 2) * 3')).toBe(9);
		expect(run('1 - 2 - 3')).toBe(-4);
		expect(run('2 ** 3 ** 2')).toBe(512);
		expect(run('-2 ** 2')).toBe(4);
		expect(run('2 ^ -1')).toBe(0.5);
		expect(run('not true and false')).toBe(false);
		expect(run('true or false and false')).toBe(true);
		expect(run('false implies false or true')).toBe(true);
		expect(run('1 < 2 == true')).toBe(true);
		expect(run('if 1 > 2 ? 10 else if true ? 20 else 30')).toBe(20);
	});

	it('reads literals, names, calls and units', () => {
		expect(parseExpr('1_000.5e1')).toEqual({ kind: 'literal', value: 10005 });
		expect(parseExpr('.5')).toEqual({ kind: 'literal', value: 0.5 });
		expect(parseExpr('"a \\"b\\""')).toEqual({ kind: 'literal', value: 'a "b"' });
		expect(parseExpr('self.battery.soc')).toEqual({ kind: 'name', name: 'self.battery.soc' });
		expect(parseExpr("Modes::'Low power'")).toEqual({ kind: 'name', name: "Modes::'Low power'" });
		expect(parseExpr('max(a, 2)')).toMatchObject({ kind: 'call', name: 'max' });
		expect(parseExpr("9.81 [SI::'m/s²']")).toMatchObject({ kind: 'unit', unit: 'm/s^2' });
		expect(parseExpr('x !== y')).toMatchObject({ op: '!=' });
		expect(parseExpr('!a & b | c')).toMatchObject({
			op: 'or',
			left: { op: 'and', left: { kind: 'unary', op: 'not' } }
		});
	});

	it('rejects what it does not support', () => {
		for (const text of [
			'',
			'a +',
			'x @ T',
			'a..b',
			'x->sum()',
			'(a',
			'f(a,',
			'"open',
			'a b',
			'[s]'
		]) {
			expect(() => parseExpr(text), text).toThrow(ParseError);
		}
	});
});

describe('evaluation', () => {
	it('does arithmetic, comparison and logic like the Rust evaluator', () => {
		expect(run('10 / 4')).toBe(2.5);
		expect(run('7 % 3')).toBe(1);
		expect(run('"ab" + "c"')).toBe('abc');
		expect(run('x > 3 and y < 3', { x: 5, y: 2 })).toBe(true);
		expect(run('1 == true')).toBe(false);
		expect(run('null == null')).toBe(true);
		expect(run('a xor b', { a: true, b: true })).toBe(false);
		// Numbers are truthy when non-zero.
		expect(run('1 and 2')).toBe(true);
		expect(run('not 0')).toBe(true);
	});

	it('explains what it cannot do in the Rust evaluator’s words', () => {
		expect(fails('missing + 1')).toBe('undefined variable `missing`');
		expect(fails('1 / 0')).toBe('division by zero');
		expect(fails('1 % 0')).toBe('modulo by zero');
		expect(fails('"a" < "b"')).toBe('cannot apply `<` to "a" and "b"');
		expect(fails('true + 1.5')).toBe('cannot apply `+` to true and 1.5');
		expect(fails('"x" and true')).toBe('cannot apply `and` to "x"');
		expect(fails('not "x"')).toBe('cannot apply `not` to "x"');
		expect(fails('abs(1, 2)')).toBe('abs expects 1 argument(s), got 2');
		expect(fails('sqrt(-1)')).toBe('sqrt of negative number');
		expect(fails('min()')).toBe('min requires at least 1 argument');
		expect(fails('max("a")')).toBe('max expects numeric argument, got "a"');
		expect(fails('nope(1)')).toBe('unknown function `nope`');
		expect(fails('convert(1, "kg", "m")')).toBe('no conversion from `kg` to `m`');
		expect(() => evaluateCondition(parseExpr('"x"'), vars())).toThrow(
			'constraint did not evaluate to bool, got "x"'
		);
	});

	it('has the Rust evaluator’s functions', () => {
		expect(run('abs(-3) + floor(2.7) + ceil(2.1) + round(2.5) + round(-2.5)')).toBe(
			3 + 2 + 3 + 3 - 3
		);
		expect(run('sqrt(16)')).toBe(4);
		expect(run('min(3, 1, 2) + max(3, 1, 2)')).toBe(4);
		expect(run('sum(1, 2, 3) + sum()')).toBe(6);
		expect(run('product(2, 3, 4)')).toBe(24);
		expect(run('mean(2, 4) + avg(1, 3)')).toBe(5);
		expect(run('rss(3, 4)')).toBe(5);
		expect(run('count(1, 1, 1)')).toBe(3);
		expect(run('clamp(5, 0, 3) + clamp(-1, 0, 3)')).toBe(3);
		expect(run('convert(1, "kg", "g")')).toBe(1000);
		expect(run('Math::abs(-1)')).toBe(1);
	});

	it('short-circuits `and`, `or` and `implies`, and `??` stands in for no value', () => {
		expect(run('false and missing')).toBe(false);
		expect(run('true or missing')).toBe(true);
		expect(run('false implies missing')).toBe(true);
		expect(fails('true and missing')).toBe('undefined variable `missing`');
		expect(run('missing ?? 3')).toBe(3);
		expect(run('x ?? 3', { x: 1 })).toBe(1);
		expect(run('null ?? "d"')).toBe('d');
	});

	it('reads `self.x` and enum literals', () => {
		expect(run('self.x + 1', { x: 1 })).toBe(2);
		const cruise = run('Mode::cruise');
		expect(cruise).toBeInstanceOf(EnumLiteral);
		expect(display(cruise)).toBe('Mode::cruise');
		expect(run('m == Mode::cruise', { m: 'cruise' })).toBe(true);
		expect(run('m == Mode::cruise', { m: 'Mode::cruise' })).toBe(true);
		expect(run('m != Mode::cruise', { m: new EnumLiteral('Other::hover') })).toBe(true);
		expect(run('Mode::cruise == Other::cruise')).toBe(true);
		// A qualified name whose last part is a variable reads the variable.
		expect(run('Machine::x * 2', { x: 4 })).toBe(8);
	});
});

describe('units', () => {
	it('carries units and converts between compatible ones', () => {
		expect(run('5 [km] > 500 [m]')).toBe(true);
		expect(run('10 [m/s] > 30 [km/h]')).toBe(true);
		expect(run('1 [h] == 60 [min]')).toBe(true);
		expect(run('1 [kg] + 500 [g]')).toEqual(new Quantity(1.5, 'kg'));
		expect(run('x + 1 [km]', { x: new Quantity(500, 'm') })).toEqual(new Quantity(1500, 'm'));
		// A bare number takes the other side's unit.
		expect(run('x < 3 [V]', { x: 2 })).toBe(true);
		expect(run('2 [m] * 3')).toEqual(new Quantity(6, 'm'));
		expect(run('6 [m] / 2 [s]')).toEqual(new Quantity(3, 'm/s'));
		const speed = run('(6 [m] / 2 [s]) [km/h]') as Quantity;
		expect(speed.unit).toBe('km/h');
		expect(speed.value).toBeCloseTo(10.8, 9);
		expect(run('max(1 [km], 300 [m])')).toEqual(new Quantity(1, 'km'));
		expect(display(run('5 [kg]'))).toBe('5 [kg]');
	});

	it('refuses to mix different quantities, and compares unknown units by value', () => {
		expect(fails('1 [kg] + 1 [m]')).toBe('cannot apply `+` to 1 [kg] and 1 [m]');
		expect(fails('1 [kg] < 1 [m]')).toBe('cannot apply `<` to 1 [kg] and 1 [m]');
		expect(run('1 [kg] == 1 [m]')).toBe(false);
		expect(run('2 [widget] > 1 [gadget]')).toBe(true);
	});

	it('normalises and converts units', () => {
		expect(normalizeUnit(" SI::'km/h' ")).toBe('km/h');
		expect(normalizeUnit('N·m')).toBe('N*m');
		expect(parseUnit('kg*m/s^2')).toMatchObject({ factor: 1 });
		expect(parseUnit('N')).toMatchObject({ dims: parseUnit('kg*m/s^2')!.dims });
		expect(parseUnit('m/(s*s)')!.dims).toEqual(parseUnit('m/s^2')!.dims);
		expect(parseUnit('furlong')).toBeNull();
		expect(convert(1, 'kg', 'g')).toBe(1000);
		expect(convert(1, 'm', 'ft')).toBeCloseTo(3.28084, 5);
		expect(convert(1, 'g', 'lb')).toBeCloseTo(0.00220462, 7);
		expect(convert(100, '°C', 'K')).toBeCloseTo(373.15, 9);
		expect(convert(212, 'degF', '°C')).toBeCloseTo(100, 9);
		expect(convert(Math.PI, 'rad', 'deg')).toBeCloseTo(180, 9);
		expect(convert(1, 'kWh', 'MJ')).toBeCloseTo(3.6, 9);
		expect(convert(101325, 'Pa', 'psi')).toBeCloseTo(14.696, 3);
		expect(() => convert(1, 'kg', 'm')).toThrow('no conversion from `kg` to `m`');
	});
});
