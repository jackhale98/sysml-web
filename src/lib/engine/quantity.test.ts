import { describe, expect, it } from 'vitest';
import {
	convert,
	formatMagnitude,
	formatQuantity,
	parseLiteral,
	parseUnit,
	readable,
	sameDimension,
	sumQuantities
} from './quantity';

describe('units', () => {
	it('reads prefixed, compound and qualified unit symbols', () => {
		expect(parseUnit('kg')?.factor).toBe(1);
		expect(parseUnit('g')?.factor).toBe(1e-3);
		expect(parseUnit('mm')?.factor).toBeCloseTo(1e-3);
		expect(parseUnit('W*h')?.factor).toBe(3600);
		expect(parseUnit('kW*h')?.factor).toBe(3.6e6);
		expect(parseUnit('SI::km')?.factor).toBe(1000);
		expect(parseUnit('m/s^2')?.dimension).toEqual([1, 0, -2, 0, 0, 0, 0]);
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

	it('adds quantities in the first one’s unit', () => {
		expect(
			sumQuantities([
				{ value: 650, unit: 'g' },
				{ value: 1.1, unit: 'kg' }
			])
		).toEqual({ value: 1750, unit: 'g' });
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
