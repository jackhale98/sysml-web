/**
 * Quantities as the engine evaluates them — a number and a unit symbol as
 * SysML writes it (`kg`, `W*h`, `m/s^2`) — converted between units of the
 * same dimension and written for people to read. Shared by the engine's
 * tables and checks (in the worker) and the inspector (on the page).
 *
 * Only the SI units and the common non-SI ones the ISQ library defines are
 * known; a unit outside them is shown as written and never converted.
 */

/** Exponents of length, mass, time, current, temperature, amount, luminous intensity. */
type Dimension = readonly [number, number, number, number, number, number, number];

interface UnitInfo {
	/** Factor to the coherent SI unit of the dimension (g → 0.001 kg). */
	factor: number;
	dimension: Dimension;
}

const D = (l = 0, m = 0, t = 0, i = 0, th = 0, n = 0, j = 0): Dimension => [l, m, t, i, th, n, j];
const LENGTH = D(1);
const MASS = D(0, 1);
const TIME = D(0, 0, 1);
const CURRENT = D(0, 0, 0, 1);
const POWER = D(2, 1, -3);
const ENERGY = D(2, 1, -2);
const VOLTAGE = D(2, 1, -3, -1);

const BASE: Record<string, UnitInfo> = {
	m: { factor: 1, dimension: LENGTH },
	g: { factor: 1e-3, dimension: MASS },
	t: { factor: 1e3, dimension: MASS },
	s: { factor: 1, dimension: TIME },
	min: { factor: 60, dimension: TIME },
	h: { factor: 3600, dimension: TIME },
	d: { factor: 86400, dimension: TIME },
	A: { factor: 1, dimension: CURRENT },
	K: { factor: 1, dimension: D(0, 0, 0, 0, 1) },
	mol: { factor: 1, dimension: D(0, 0, 0, 0, 0, 1) },
	cd: { factor: 1, dimension: D(0, 0, 0, 0, 0, 0, 1) },
	N: { factor: 1, dimension: D(1, 1, -2) },
	J: { factor: 1, dimension: ENERGY },
	W: { factor: 1, dimension: POWER },
	V: { factor: 1, dimension: VOLTAGE },
	Pa: { factor: 1, dimension: D(-1, 1, -2) },
	bar: { factor: 1e5, dimension: D(-1, 1, -2) },
	Hz: { factor: 1, dimension: D(0, 0, -1) },
	C: { factor: 1, dimension: D(0, 0, 1, 1) },
	F: { factor: 1, dimension: D(-2, -1, 4, 2) },
	ohm: { factor: 1, dimension: D(2, 1, -3, -2) },
	Ω: { factor: 1, dimension: D(2, 1, -3, -2) },
	L: { factor: 1e-3, dimension: D(3) }
};

const PREFIXES: Record<string, number> = {
	G: 1e9,
	M: 1e6,
	k: 1e3,
	c: 1e-2,
	m: 1e-3,
	u: 1e-6,
	μ: 1e-6,
	n: 1e-9
};

/** Units that take prefixes (`kg` is `k` + `g`; `min` and `h` don't). */
const PREFIXABLE = new Set([
	'm',
	'g',
	's',
	'A',
	'N',
	'J',
	'W',
	'V',
	'Pa',
	'Hz',
	'C',
	'F',
	'ohm',
	'Ω',
	'L'
]);

function symbol(name: string): UnitInfo | null {
	const base = BASE[name];
	if (base) return base;
	for (const [prefix, factor] of Object.entries(PREFIXES)) {
		if (!name.startsWith(prefix)) continue;
		const rest = name.slice(prefix.length);
		const unit = BASE[rest];
		if (unit && PREFIXABLE.has(rest))
			return { factor: unit.factor * factor, dimension: unit.dimension };
	}
	return null;
}

const cache = new Map<string, UnitInfo | null>();

/**
 * A unit symbol as SysML writes it — products, quotients and powers of named
 * units, optionally qualified (`SI::kg`) — or null when it isn't known.
 */
export function parseUnit(unit: string): UnitInfo | null {
	const key = unit.trim();
	if (cache.has(key)) return cache.get(key)!;
	let result: UnitInfo | null;
	try {
		result = new UnitParser(key.replace(/\b[A-Za-z_]\w*::/g, '')).parse();
	} catch {
		result = null;
	}
	cache.set(key, result);
	return result;
}

class UnitParser {
	private at = 0;
	constructor(private readonly text: string) {}

	parse(): UnitInfo | null {
		const unit = this.product();
		this.space();
		return unit && this.at === this.text.length ? unit : null;
	}

	private space() {
		while (this.text[this.at] === ' ') this.at++;
	}

	private product(): UnitInfo | null {
		let unit = this.power();
		for (;;) {
			this.space();
			const op = this.text[this.at];
			if (op !== '*' && op !== '/' && op !== '·') return unit;
			this.at++;
			const next = this.power();
			if (!unit || !next) return null;
			unit = combine(unit, next, op === '/' ? -1 : 1);
		}
	}

	private power(): UnitInfo | null {
		const unit = this.atom();
		this.space();
		if (this.text[this.at] !== '^') return unit;
		this.at++;
		const m = /^\(?\s*(-?\d+)\s*\)?/.exec(this.text.slice(this.at));
		if (!m || !unit) return null;
		this.at += m[0].length;
		return scale(unit, Number(m[1]));
	}

	private atom(): UnitInfo | null {
		this.space();
		if (this.text[this.at] === '(') {
			this.at++;
			const inner = this.product();
			this.space();
			if (this.text[this.at] !== ')') return null;
			this.at++;
			return inner;
		}
		const m = /^(?:[A-Za-zΩμ]+|1)/.exec(this.text.slice(this.at));
		if (!m) return null;
		this.at += m[0].length;
		return m[0] === '1' ? { factor: 1, dimension: D() } : symbol(m[0]);
	}
}

function combine(a: UnitInfo, b: UnitInfo, sign: 1 | -1): UnitInfo {
	return {
		factor: a.factor * b.factor ** sign,
		dimension: a.dimension.map((x, i) => x + sign * b.dimension[i]!) as unknown as Dimension
	};
}

function scale(a: UnitInfo, power: number): UnitInfo {
	return {
		factor: a.factor ** power,
		dimension: a.dimension.map((x) => x * power) as unknown as Dimension
	};
}

const same = (a: Dimension, b: Dimension) => a.every((x, i) => x === b[i]);

/** Whether two units measure the same kind of quantity (so one converts to the other). */
export function sameDimension(a: string, b: string): boolean {
	const x = parseUnit(a);
	const y = parseUnit(b);
	return !!x && !!y && same(x.dimension, y.dimension);
}

/** `value` in `from` expressed in `to`, or null when they don't convert. */
export function convert(value: number, from: string, to: string): number | null {
	if (from === to) return value;
	const x = parseUnit(from);
	const y = parseUnit(to);
	if (!x || !y || !same(x.dimension, y.dimension)) return null;
	return (value * x.factor) / y.factor;
}

export interface Quantity {
	value: number;
	/** The unit symbol; null for a plain number. */
	unit: string | null;
}

/**
 * The unit a person would read a value in: grams up to a kilogram, then
 * kilograms; seconds up to two minutes, then minutes up to two hours, then
 * hours; watts up to a kilowatt; watt-hours or joules as the value was
 * given; millimetres below a metre, kilometres from a thousand metres.
 */
export function readableUnit(q: Quantity): string | null {
	if (q.unit === null) return null;
	const info = parseUnit(q.unit);
	if (!info) return q.unit;
	const si = Math.abs(q.value * info.factor);
	const d = info.dimension;
	if (same(d, MASS)) return si < 1 ? 'g' : si >= 1e4 ? 't' : 'kg';
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

/** A unit symbol for display: `W*h` → `W·h`. */
export function displayUnit(unit: string): string {
	return unit.replace(/\s*\*\s*/g, '·');
}

/** `0.42 kg`; a plain number without a unit. */
export function formatQuantity(q: Quantity): string {
	const magnitude = formatMagnitude(q.value);
	return q.unit ? `${magnitude} ${displayUnit(q.unit)}` : magnitude;
}

/** Sum quantities of one dimension, in the unit of the first; null when they don't add up. */
export function sumQuantities(items: Quantity[]): Quantity | null {
	if (!items.length) return null;
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

/** A literal as SysML writes it: `25 [min]`, `4 [SI::kg]`, `0.85`. */
export function parseLiteral(text: string): Quantity | null {
	const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:\[\s*([^\]]+?)\s*\])?\s*$/.exec(
		text
	);
	if (!m) return null;
	const unit = m[2] ? m[2].replace(/\b[A-Za-z_]\w*::/g, '') : null;
	return { value: Number(m[1]), unit };
}
