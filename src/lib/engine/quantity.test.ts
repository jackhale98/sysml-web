import { describe, expect, it } from 'vitest';
import {
	convert,
	formatMagnitude,
	exactMagnitude,
	formatQuantity,
	isAffine,
	parseLiteral,
	parseUnit,
	qualifiedUnit,
	readable,
	sameDimension,
	sumQuantities,
	whyNoSum
} from './quantity';

describe('units', () => {
	it('knows FIT, the failure rate unit the Reliability library declares', () => {
		// 1 FIT is one failure in 10⁹ hours: 1000 FIT is 10⁻⁶ per hour.
		expect(convert(1000, 'FIT', 'h^-1')).toBeCloseTo(1e-6, 18);
		expect(convert(2.5e-6, 'h**-1', 'FIT')).toBeCloseTo(2500, 9);
		expect(sameDimension('FIT', 'Hz')).toBe(true);
		expect(qualifiedUnit('FIT')).toBe('Reliability::FIT');
		// A power as the toolkit gives it (`h**-1`) reads as written in SysML.
		expect(formatQuantity({ value: 2, unit: 'h**-1' })).toBe('2 h^-1');
		// Failure rates in either unit add up, as a reliability budget adds them.
		expect(
			sumQuantities([
				{ value: 200, unit: 'FIT' },
				{ value: 3e-6, unit: 'h**-1' }
			])
		).toEqual({ value: expect.closeTo(3200, 9), unit: 'FIT' });
	});

	it('reads the library’s units, compound and qualified', () => {
		expect(parseUnit('kg')?.factor).toBe(1);
		expect(parseUnit('g')?.factor).toBe(1e-3);
		expect(parseUnit('mm')?.factor).toBeCloseTo(1e-3);
		expect(parseUnit('W*h')?.factor).toBe(3600);
		expect(parseUnit('kW*h')?.factor).toBe(3.6e6);
		expect(parseUnit('SI::km')?.factor).toBe(1000);
		expect(parseUnit('m/s^2')?.dimension).toEqual([1, 0, -2, 0, 0, 0, 0, 0, 0]);
		// As the library writes them: quoted, with `⋅` and superscripts, or by name or alias.
		expect(parseUnit("SI::'m⋅s⁻²'")?.dimension).toEqual(parseUnit('m/s^2')?.dimension);
		expect(parseUnit("SI::'km/h'")?.factor).toBeCloseTo(1 / 3.6, 15);
		expect(parseUnit('USCustomaryUnits::lb')?.factor).toBe(0.4535924);
		expect(parseUnit('kilogram')?.factor).toBe(1);
		expect(parseUnit('psi')?.factor).toBeCloseTo(4.448222 / 0.0254 ** 2, 9);
		expect(parseUnit('lb/ft^3')?.factor).toBeCloseTo(0.4535924 / 0.3048 ** 3, 9);
		// Prefixed units the library doesn't declare are unknown, as they are to the engine.
		expect(parseUnit('mg')).toBeNull();
		expect(parseUnit('kN')).toBeNull();
		expect(parseUnit('min')?.factor).toBe(60);
		expect(parseUnit('furlong')).toBeNull();
		expect(parseUnit('kg*')).toBeNull();
	});

	it('converts within a dimension and refuses across', () => {
		expect(convert(1652.4, 's', 'min')).toBeCloseTo(27.54);
		expect(convert(2770, 'g', 'kg')).toBeCloseTo(2.77);
		expect(convert(216, 'W*h', 'J')).toBe(777600);
		expect(convert(1, 'kg', 'W')).toBeNull();
		expect(convert(1, 'kg', 'furlong')).toBeNull();
		expect(sameDimension('W*h', 'J')).toBe(true);
		expect(sameDimension('W', 'J')).toBe(false);
	});

	it('picks the unit a person reads a value in', () => {
		const endurance = readable({ value: 1652.4, unit: 's' });
		expect(endurance.unit).toBe('min');
		expect(endurance.value).toBeCloseTo(27.54);
		const mass = readable({ value: 2770, unit: 'g' });
		expect(mass.unit).toBe('kg');
		expect(mass.value).toBeCloseTo(2.77);
		expect(readable({ value: 650, unit: 'g' })).toEqual({ value: 650, unit: 'g' });
		expect(readable({ value: 0.42, unit: 'kg' }).unit).toBe('g');
		expect(readable({ value: 183.6, unit: 'W*h' })).toEqual({ value: 183.6, unit: 'W*h' });
		expect(readable({ value: 397, unit: 'W' })).toEqual({ value: 397, unit: 'W' });
		expect(readable({ value: 3, unit: null })).toEqual({ value: 3, unit: null });
		expect(readable({ value: 3, unit: 'furlong' })).toEqual({ value: 3, unit: 'furlong' });
	});

	it('writes magnitudes with four significant digits and no trailing zeros', () => {
		expect(formatMagnitude(27.540000000001)).toBe('27.54');
		expect(formatMagnitude(2.77)).toBe('2.77');
		expect(formatMagnitude(0.23000000000000043)).toBe('0.23');
		expect(formatMagnitude(1100)).toBe('1100');
		expect(formatMagnitude(12345.6)).toBe('12346');
		expect(formatMagnitude(-0.0000001)).toBe('0');
		expect(formatMagnitude(0)).toBe('0');
		expect(formatQuantity({ value: 0.42, unit: 'kg' })).toBe('0.42 kg');
		expect(formatQuantity({ value: 183.6, unit: 'W*h' })).toBe('183.6 W·h');
		expect(formatQuantity({ value: 4, unit: null })).toBe('4');
	});

	it('converts a temperature with its zero shift, and never adds temperatures', () => {
		expect(convert(20, '°C', 'K')).toBeCloseTo(293.15, 12);
		expect(convert(212, '°F', '°C')).toBeCloseTo(100, 12);
		expect(convert(0, '°F', 'K')).toBeCloseTo(255.372222, 6);
		expect(convert(300, 'K', '°C_abs')).toBeCloseTo(26.85, 12);
		// In a product it is a difference: 1 J/(kg·°C) = 1 J/(kg·K).
		expect(convert(1, 'J/(kg*°C)', 'J/(kg*K)')).toBe(1);
		expect(isAffine('°C')).toBe(true);
		expect(isAffine('K')).toBe(false);
		// 20 °C + 20 °C is 40 °C only if one is a difference; as two temperatures it is nonsense.
		const warm = { value: 20, unit: '°C' };
		expect(sumQuantities([warm, warm])).toBeNull();
		expect(sumQuantities([warm, { value: 1, unit: 'K' }])).toBeNull();
		expect(whyNoSum([warm, warm])).toBe("are temperatures (°C), which don't add up");
	});

	it('says why quantities do not add up', () => {
		const g = { value: 1, unit: 'g' };
		expect(whyNoSum([g, { value: 1, unit: 'm' }])).toBe(
			"are in g and m, which don't convert to one another"
		);
		expect(whyNoSum([g, { value: 1, unit: null }])).toBe(
			"are in g and plain numbers (no unit), which don't add up"
		);
		expect(whyNoSum([g, { value: 1, unit: 'kg' }])).toBeNull();
	});

	it('qualifies a unit by the package that declares it, for text the engine reads', () => {
		expect(qualifiedUnit('kg')).toBe('SI::kg');
		expect(qualifiedUnit('lb')).toBe('USCustomaryUnits::lb');
		expect(qualifiedUnit('km/h')).toBe("SI::'km/h'");
		expect(qualifiedUnit('kg*m/s^2')).toBe('SI::kg*SI::m/SI::s^2');
		expect(qualifiedUnit('furlong')).toBeNull();
	});

	it('writes every digit a value has for an export', () => {
		expect(exactMagnitude(0.7 * 1000)).toBe('700');
		expect(exactMagnitude(1652.4123456789)).toBe('1652.4123456789');
		expect(exactMagnitude(2 / 3)).toBe('0.666666666666667');
		expect(exactMagnitude(0)).toBe('0');
	});

	it('adds quantities in the first one’s unit', () => {
		expect(
			sumQuantities([
				{ value: 650, unit: 'g' },
				{ value: 1.1, unit: 'kg' }
			])
		).toEqual({ value: 1750, unit: 'g' });
		// Pounds, ounces and grains convert as the library defines them.
		expect(
			sumQuantities([
				{ value: 500, unit: 'g' },
				{ value: 2, unit: 'lb' },
				{ value: 7000, unit: 'gr' }
			])?.value
		).toBeCloseTo(500 + 907.1848 + 453.59237, 9);
		expect(
			sumQuantities([
				{ value: 1, unit: 'g' },
				{ value: 1, unit: 'W' }
			])
		).toBeNull();
		expect(sumQuantities([])).toBeNull();
	});

	it('reads literals as SysML writes them', () => {
		expect(parseLiteral('25 [min]')).toEqual({ value: 25, unit: 'min' });
		expect(parseLiteral('4 [SI::kg]')).toEqual({ value: 4, unit: 'kg' });
		expect(parseLiteral(' 0.85 ')).toEqual({ value: 0.85, unit: null });
		expect(parseLiteral('1.5e3 [W]')).toEqual({ value: 1500, unit: 'W' });
		expect(parseLiteral('drone.mass')).toBeNull();
	});
});
