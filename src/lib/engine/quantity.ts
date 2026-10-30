/**
 * Quantities as the engine evaluates them — a number and a unit symbol as
 * SysML writes it (`kg`, `W*h`, `m/s^2`, `'°C'`) — converted between units
 * of the same dimension and written for people to read. Shared by the
 * engine's tables and checks (in the worker), the inspector and forms (on
 * the page) and the app's evaluator (`sim/expr.ts`).
 *
 * The units are the bundled standard library's (`SI`, `USCustomaryUnits`),
 * with the factors its definitions give (`unitTable.ts`, generated from it):
 * products, quotients and powers of them convert too (`km/h`, `lb/ft^3`).
 * A unit outside them is shown as written and never converted.
 *
 * A temperature in `°C` or `°F` is on a scale with a zero shift: a lone
 * value converts with it (20 °C is 293.15 K), and such values are never
 * added to values in another unit, nor summed (`sumQuantities`): whether
 * one is a temperature or a difference of two decides the answer.
 */
import { ALIASES, UNITS } from './unitTable';

/** Exponents of length, mass, time, current, temperature, amount, luminous intensity, angle, solid angle. */
type Dimension = readonly number[];

export interface UnitInfo {
	/** Factor to the coherent SI unit of the dimension (g → 0.001 kg). */
	factor: number;
	dimension: Dimension;
	/** Kelvin at the scale's zero, for a lone `°C` or `°F`; 0 otherwise. */
	offset: number;
}

const DIMS = 9;
const D = (...exponents: number[]): Dimension =>
	Array.from({ length: DIMS }, (_, i) => exponents[i] ?? 0);
const LENGTH = D(1);
const MASS = D(0, 1);
const TIME = D(0, 0, 1);
const POWER = D(2, 1, -3);
const ENERGY = D(2, 1, -2);
const NONE = D();

/**
 * A unit symbol as typed in brackets, in the form the table is keyed by:
 * no qualifier, quotes or spaces, `·`/`⋅` as `*`, `**` and superscripts as
 * `^` (`SI::'m⋅s⁻²'` → `m*s^-2`).
 */
export function normalizeUnit(text: string): string {
	return text
		.replace(/(?:[A-Za-z_]\w*::)+/g, '')
		.replace(/'/g, '')
		.replace(/\s+/g, '')
		.replace(/[·⋅]/g, '*')
		.replace(/\*\*/g, '^')
		.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (sup) => `^${[...sup].map((c) => SUPERSCRIPT[c]).join('')}`);
}

const SUPERSCRIPT: Record<string, string> = {
	'⁻': '-',
	'⁰': '0',
	'¹': '1',
	'²': '2',
	'³': '3',
	'⁴': '4',
	'⁵': '5',
	'⁶': '6',
	'⁷': '7',
	'⁸': '8',
	'⁹': '9'
};

/** Units of the libraries the app adds to projects, beside the standard library's. */
const EXTRA_UNITS: [string, UnitInfo, string][] = [
	['FIT', { factor: 1e-9 / 3600, dimension: D(0, 0, -1), offset: 0 }, 'Reliability']
];

/** The table by normalized symbol (`m*s^-2` for the library's `m⋅s⁻²`), with the library's other spellings. */
const BY_SYMBOL = (() => {
	const out = new Map<string, { info: UnitInfo; symbol: string; pkg: string }>();
	for (const [symbol, [factor, dims, pkg, offset]] of Object.entries(UNITS))
		out.set(normalizeUnit(symbol), {
			info: { factor, dimension: D(...dims), offset: offset ?? 0 },
			symbol,
			pkg
		});
	for (const [alias, symbol] of Object.entries(ALIASES)) {
		const target = out.get(normalizeUnit(symbol));
		if (target && !out.has(alias)) out.set(alias, target);
	}
	// The failure rate unit of the risk libraries (`libraries/Reliability.sysml`): 1 FIT is one
	// failure in 10⁹ hours.
	for (const [symbol, info, pkg] of EXTRA_UNITS)
		if (!out.has(symbol)) out.set(symbol, { info, symbol, pkg });
	return out;
})();

const cache = new Map<string, UnitInfo | null>();

/**
 * A unit symbol as SysML writes it — a library unit, or products, quotients
 * and powers of them, optionally qualified (`SI::kg`) — or null when it
 * isn't known. Only a unit on its own keeps a zero shift (`°C`); in a
 * product it is a difference (`J/(kg*°C)`).
 */
export function parseUnit(unit: string): UnitInfo | null {
	const key = normalizeUnit(unit);
	if (cache.has(key)) return cache.get(key)!;
	let result: UnitInfo | null;
	try {
		result = BY_SYMBOL.get(key)?.info ?? new UnitParser(key).parse();
	} catch {
		result = null;
	}
	cache.set(key, result);
	return result;
}

/**
 * The unit as the library qualifies it in text (`SI::kg`,
 * `USCustomaryUnits::lb`, `SI::km/SI::h`), or null when a part of it isn't
 * a library unit.
 */
export function qualifiedUnit(unit: string): string | null {
	const key = normalizeUnit(unit);
	const whole = BY_SYMBOL.get(key);
	const quote = (s: string) => (/^[A-Za-z_]\w*$/.test(s) ? s : `'${s}'`);
	if (whole) return `${whole.pkg}::${quote(whole.symbol)}`;
	let ok = true;
	const text = key.replace(/[^*/^()\d-]+/g, (atom) => {
		const hit = BY_SYMBOL.get(atom);
		if (!hit) ok = false;
		return hit ? `${hit.pkg}::${quote(hit.symbol)}` : atom;
	});
	return ok ? text : null;
}

class UnitParser {
	private at = 0;
	constructor(private readonly text: string) {}

	parse(): UnitInfo | null {
		const unit = this.product();
		return unit && this.at === this.text.length ? { ...unit, offset: 0 } : null;
	}

	private product(): UnitInfo | null {
		let unit = this.power();
		for (;;) {
			const op = this.text[this.at];
			if (op !== '*' && op !== '/') return unit;
			this.at++;
			const next = this.power();
			if (!unit || !next) return null;
			unit = combine(unit, next, op === '/' ? -1 : 1);
		}
	}

	private power(): UnitInfo | null {
		const unit = this.atom();
		if (this.text[this.at] !== '^') return unit;
		this.at++;
		const m = /^(?:\((-?\d+)\)|(-?\d+))/.exec(this.text.slice(this.at));
		if (!m || !unit) return null;
		this.at += m[0].length;
		return scale(unit, Number(m[1] ?? m[2]));
	}

	private atom(): UnitInfo | null {
		if (this.text[this.at] === '(') {
			this.at++;
			const inner = this.product();
			if (this.text[this.at] !== ')') return null;
			this.at++;
			return inner;
		}
		const m = /^[^*/^()]+/.exec(this.text.slice(this.at));
		if (!m) return null;
		this.at += m[0].length;
		if (m[0] === '1') return { factor: 1, dimension: NONE, offset: 0 };
		return BY_SYMBOL.get(m[0])?.info ?? null;
	}
}

function combine(a: UnitInfo, b: UnitInfo, sign: 1 | -1): UnitInfo {
	return {
		factor: a.factor * b.factor ** sign,
		dimension: a.dimension.map((x, i) => x + sign * b.dimension[i]!),
		offset: 0
	};
}

function scale(a: UnitInfo, power: number): UnitInfo {
	return {
		factor: a.factor ** power,
		dimension: a.dimension.map((x) => x * power),
		offset: 0
	};
}

const same = (a: Dimension, b: Dimension) => a.every((x, i) => x === b[i]);

/** Whether two units measure the same kind of quantity (so one converts to the other). */
export function sameDimension(a: string, b: string): boolean {
	const x = parseUnit(a);
	const y = parseUnit(b);
	return !!x && !!y && same(x.dimension, y.dimension);
}

/** Whether the unit is a temperature scale with a zero shift (`°C`, `°F`), whose values never add up. */
export function isAffine(unit: string | null): boolean {
	return !!unit && !!parseUnit(unit)?.offset;
}

/**
 * `value` in `from` expressed in `to`, or null when they don't convert. A
 * temperature converts with its scale's zero shift (20 °C → 293.15 K).
 */
export function convert(value: number, from: string, to: string): number | null {
	if (from === to) return value;
	const x = parseUnit(from);
	const y = parseUnit(to);
	if (!x || !y || !same(x.dimension, y.dimension)) return null;
	if (!x.offset && !y.offset) return (value * x.factor) / y.factor;
	return (value * x.factor + x.offset - y.offset) / y.factor;
}

export interface Quantity {
	value: number;
	/** The unit symbol; null for a plain number. */
	unit: string | null;
}

/**
 * The unit a person would read a value in: grams up to a kilogram, then
 * kilograms (the library has no symbol for the tonne); seconds up to two minutes, then minutes up to two hours, then
 * hours; watts up to a kilowatt; watt-hours or joules as the value was
 * given; millimetres below a metre, kilometres from a thousand metres.
 */
export function readableUnit(q: Quantity): string | null {
	if (q.unit === null) return null;
	const info = parseUnit(q.unit);
	if (!info) return q.unit;
	const si = Math.abs(q.value * info.factor);
	const d = info.dimension;
	if (same(d, MASS)) return si < 1 ? 'g' : 'kg';
	if (same(d, TIME)) return si < 120 ? 's' : si < 7200 ? 'min' : 'h';
	if (same(d, POWER)) return si < 1e3 ? 'W' : 'kW';
	if (same(d, ENERGY)) {
		if (/h\b/.test(q.unit)) return si < 3.6e6 ? 'W*h' : 'kW*h';
		return si < 1e3 ? 'J' : si < 1e6 ? 'kJ' : 'MJ';
	}
	if (same(d, LENGTH)) return si < 1 ? 'mm' : si < 1e3 ? 'm' : 'km';
	return q.unit;
}

/** `q` in the unit a person would read it in (see `readableUnit`). */
export function readable(q: Quantity): Quantity {
	const unit = readableUnit(q);
	if (unit === null || unit === q.unit) return q;
	const value = convert(q.value, q.unit!, unit);
	return value === null ? q : { value, unit };
}

/**
 * A number with up to four significant digits and no trailing zeros
 * (`27.54`, `2.77`, `397`, `1100`), never in exponent form for the sizes
 * budgets have.
 */
export function formatMagnitude(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	if (value === 0) return '0';
	const abs = Math.abs(value);
	const digits = abs >= 1000 ? 0 : Math.max(0, 3 - Math.floor(Math.log10(abs)));
	const fixed = value.toFixed(Math.min(digits, 6));
	const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
	return trimmed === '-0' ? '0' : trimmed;
}

/** A unit symbol for display: `W*h` → `W·h`, `h**-1` → `h^-1`. */
export function displayUnit(unit: string): string {
	return unit.replace(/\*\*/g, '^').replace(/\s*\*\s*/g, '·');
}

/** `0.42 kg`; a plain number without a unit. */
export function formatQuantity(q: Quantity): string {
	const magnitude = formatMagnitude(q.value);
	return q.unit ? `${magnitude} ${displayUnit(q.unit)}` : magnitude;
}

/**
 * Sum quantities of one dimension, in the unit of the first; null when they
 * don't add up (`whyNoSum` says why). Temperatures on a scale with a zero
 * shift (`°C`) never add up, in one unit or across.
 */
export function sumQuantities(items: Quantity[]): Quantity | null {
	if (!items.length || items.some((q) => isAffine(q.unit))) return null;
	const unit = items[0]!.unit;
	let total = 0;
	for (const q of items) {
		if (q.unit === unit || (q.unit === null && unit === null)) {
			total += q.value;
			continue;
		}
		if (q.unit === null || unit === null) return null;
		const v = convert(q.value, q.unit, unit);
		if (v === null) return null;
		total += v;
	}
	return { value: total, unit };
}

/**
 * Why quantities don't add up, as the rest of a sentence about them ("are
 * in g and m, which don't convert to one another"); null when they do.
 */
export function whyNoSum(items: Quantity[]): string | null {
	if (!items.length || sumQuantities(items)) return null;
	const and = (xs: string[]) =>
		xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? '');
	const affine = [
		...new Set(items.flatMap((q) => (isAffine(q.unit) ? [displayUnit(q.unit!)] : [])))
	];
	if (affine.length) return `are temperatures (${and(affine)}), which don't add up`;
	const units = [...new Set(items.flatMap((q) => (q.unit ? [displayUnit(q.unit)] : [])))];
	if (items.some((q) => q.unit === null))
		return `are in ${and(units)} and plain numbers (no unit), which don't add up`;
	return `are in ${and(units)}, which don't convert to one another`;
}

/**
 * A number for a data export: every digit a double carries that a
 * conversion didn't make up (15 significant digits, so 0.7 kg in grams is
 * 700, not 700.0000000000001).
 */
export function exactMagnitude(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const n = Number(value.toPrecision(15));
	return n === 0 ? '0' : String(n);
}

/** A literal as SysML writes it: `25 [min]`, `4 [SI::kg]`, `0.85`. */
export function parseLiteral(text: string): Quantity | null {
	const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:\[\s*([^\]]+?)\s*\])?\s*$/.exec(
		text
	);
	if (!m) return null;
	const unit = m[2] ? m[2].replace(/\b[A-Za-z_]\w*::/g, '') : null;
	return { value: Number(m[1]), unit };
}
