/**
 * Units of measure for the emulator's expressions: `5 [km]`, `30 [km/h]`,
 * `9.81 [SI::'m/s²']`. The units are the standard library's, shared with
 * the tables and the inspector (`engine/quantity.ts`): a unit is a library
 * unit or a product of powers of them, so `km/h` and `m/s` convert to each
 * other without a table entry for the pair. A lone `°C` or `°F` converts
 * with its scale's zero shift (100 °C is 373.15 K).
 */
import {
	convert as convertQuantity,
	normalizeUnit,
	parseUnit as parseQuantityUnit
} from '#lib/engine/quantity.ts';

export { normalizeUnit };

export interface Unit {
	factor: number;
	/** Exponents of length, mass, time, current, temperature, amount, luminous intensity, angle, solid angle. */
	dims: readonly number[];
	/** Kelvin at the scale's zero, for a lone `°C` or `°F`; 0 otherwise. */
	offset: number;
}

/** The scale and dimensions of a unit, or null when a symbol is unknown. */
export function parseUnit(text: string): Unit | null {
	const info = parseQuantityUnit(text);
	return info && { factor: info.factor, dims: info.dimension, offset: info.offset };
}

export function sameDimension(a: Unit, b: Unit): boolean {
	return a.dims.every((d, i) => d === b.dims[i]);
}

/**
 * `value` in unit `from`, expressed in unit `to`. Throws when either unit is
 * unknown or they measure different things.
 */
export function convert(value: number, from: string, to: string): number {
	if (normalizeUnit(from) === normalizeUnit(to)) return value;
	const converted = convertQuantity(value, from, to);
	if (converted === null) throw new Error(`no conversion from \`${from}\` to \`${to}\``);
	return converted;
}

/**
 * A simulated time or duration in seconds, said plainly: `45 s`, `25 min`,
 * `1 min 30 s`, `2 h 5 min`. Fractions of a second keep up to three decimals.
 */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds)) return String(seconds);
	const s = Math.round(Math.abs(seconds) * 1000) / 1000;
	const sign = seconds < 0 && s > 0 ? '-' : '';
	if (s < 60) return `${sign}${s} s`;
	const parts: string[] = [];
	const days = Math.floor(s / 86400);
	const hours = Math.floor((s % 86400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const rest = Math.round((s % 60) * 1000) / 1000;
	if (days) parts.push(`${days} d`);
	if (hours) parts.push(`${hours} h`);
	if (minutes) parts.push(`${minutes} min`);
	if (rest) parts.push(`${rest} s`);
	return sign + parts.join(' ');
}
