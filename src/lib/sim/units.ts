/**
 * Units of measure for the emulator's expressions: `5 [km]`, `30 [km/h]`,
 * `9.81 [SI::'m/s²']`. A unit is a product of powers of known symbols, each
 * a scale of the SI base dimensions, so `km/h` and `m/s` convert to each
 * other without a table entry for the pair. Temperatures in °C and °F
 * convert with their offset when they stand alone.
 */

/** Exponents of length, mass, time, current, temperature, amount, luminosity, angle. */
type Dims = readonly [number, number, number, number, number, number, number, number];

interface Symbol {
	factor: number;
	dims: Dims;
	/** Added after scaling, for °C and °F (to kelvin). */
	offset?: number;
}

export interface Unit {
	factor: number;
	dims: Dims;
	offset: number;
}

const D = (m = 0, kg = 0, s = 0, A = 0, K = 0, mol = 0, cd = 0, rad = 0): Dims => [
	m,
	kg,
	s,
	A,
	K,
	mol,
	cd,
	rad
];

const LENGTH = D(1);
const MASS = D(0, 1);
const TIME = D(0, 0, 1);
const CURRENT = D(0, 0, 0, 1);
const TEMPERATURE = D(0, 0, 0, 0, 1);
const ANGLE = D(0, 0, 0, 0, 0, 0, 0, 1);
const FORCE = D(1, 1, -2);
const ENERGY = D(2, 1, -2);
const POWER = D(2, 1, -3);
const PRESSURE = D(-1, 1, -2);
const SPEED = D(1, 0, -1);
const FREQUENCY = D(0, 0, -1);
const VOLTAGE = D(2, 1, -3, -1);
const CHARGE = D(0, 0, 1, 1);
const VOLUME = D(3);
const NONE = D();

const SYMBOLS: Record<string, Symbol> = {
	m: { factor: 1, dims: LENGTH },
	mm: { factor: 1e-3, dims: LENGTH },
	cm: { factor: 1e-2, dims: LENGTH },
	km: { factor: 1e3, dims: LENGTH },
	um: { factor: 1e-6, dims: LENGTH },
	μm: { factor: 1e-6, dims: LENGTH },
	in: { factor: 0.0254, dims: LENGTH },
	ft: { factor: 0.3048, dims: LENGTH },
	yd: { factor: 0.9144, dims: LENGTH },
	mi: { factor: 1609.344, dims: LENGTH },
	nmi: { factor: 1852, dims: LENGTH },
	kg: { factor: 1, dims: MASS },
	g: { factor: 1e-3, dims: MASS },
	mg: { factor: 1e-6, dims: MASS },
	t: { factor: 1e3, dims: MASS },
	lb: { factor: 0.45359237, dims: MASS },
	oz: { factor: 0.028349523125, dims: MASS },
	s: { factor: 1, dims: TIME },
	ms: { factor: 1e-3, dims: TIME },
	us: { factor: 1e-6, dims: TIME },
	μs: { factor: 1e-6, dims: TIME },
	min: { factor: 60, dims: TIME },
	h: { factor: 3600, dims: TIME },
	hr: { factor: 3600, dims: TIME },
	d: { factor: 86400, dims: TIME },
	A: { factor: 1, dims: CURRENT },
	mA: { factor: 1e-3, dims: CURRENT },
	K: { factor: 1, dims: TEMPERATURE },
	'°C': { factor: 1, dims: TEMPERATURE, offset: 273.15 },
	degC: { factor: 1, dims: TEMPERATURE, offset: 273.15 },
	'°F': { factor: 5 / 9, dims: TEMPERATURE, offset: 273.15 - (32 * 5) / 9 },
	degF: { factor: 5 / 9, dims: TEMPERATURE, offset: 273.15 - (32 * 5) / 9 },
	rad: { factor: 1, dims: ANGLE },
	deg: { factor: Math.PI / 180, dims: ANGLE },
	'°': { factor: Math.PI / 180, dims: ANGLE },
	N: { factor: 1, dims: FORCE },
	kN: { factor: 1e3, dims: FORCE },
	lbf: { factor: 4.4482216152605, dims: FORCE },
	J: { factor: 1, dims: ENERGY },
	kJ: { factor: 1e3, dims: ENERGY },
	MJ: { factor: 1e6, dims: ENERGY },
	cal: { factor: 4.184, dims: ENERGY },
	kcal: { factor: 4184, dims: ENERGY },
	Wh: { factor: 3600, dims: ENERGY },
	kWh: { factor: 3.6e6, dims: ENERGY },
	W: { factor: 1, dims: POWER },
	mW: { factor: 1e-3, dims: POWER },
	kW: { factor: 1e3, dims: POWER },
	MW: { factor: 1e6, dims: POWER },
	hp: { factor: 745.7, dims: POWER },
	Pa: { factor: 1, dims: PRESSURE },
	kPa: { factor: 1e3, dims: PRESSURE },
	MPa: { factor: 1e6, dims: PRESSURE },
	bar: { factor: 1e5, dims: PRESSURE },
	psi: { factor: 6894.757293168, dims: PRESSURE },
	atm: { factor: 101325, dims: PRESSURE },
	mph: { factor: 0.44704, dims: SPEED },
	kn: { factor: 1852 / 3600, dims: SPEED },
	Hz: { factor: 1, dims: FREQUENCY },
	kHz: { factor: 1e3, dims: FREQUENCY },
	MHz: { factor: 1e6, dims: FREQUENCY },
	rpm: { factor: 1 / 60, dims: FREQUENCY },
	V: { factor: 1, dims: VOLTAGE },
	mV: { factor: 1e-3, dims: VOLTAGE },
	kV: { factor: 1e3, dims: VOLTAGE },
	C: { factor: 1, dims: CHARGE },
	Ah: { factor: 3600, dims: CHARGE },
	mAh: { factor: 3.6, dims: CHARGE },
	L: { factor: 1e-3, dims: VOLUME },
	mL: { factor: 1e-6, dims: VOLUME },
	'%': { factor: 0.01, dims: NONE },
	one: { factor: 1, dims: NONE }
};

/** Names as the ISQ/SI libraries spell them. */
const ALIASES: Record<string, string> = {
	metre: 'm',
	meter: 'm',
	kilometre: 'km',
	kilometer: 'km',
	millimetre: 'mm',
	millimeter: 'mm',
	kilogram: 'kg',
	gram: 'g',
	second: 's',
	sec: 's',
	minute: 'min',
	hour: 'h',
	day: 'd',
	ampere: 'A',
	kelvin: 'K',
	radian: 'rad',
	degree: 'deg',
	newton: 'N',
	joule: 'J',
	watt: 'W',
	pascal: 'Pa',
	hertz: 'Hz',
	volt: 'V',
	coulomb: 'C',
	litre: 'L',
	liter: 'L'
};

/** A unit as written in brackets, tidied: `SI::'km/h'` → `km/h`, `m·s⁻¹` stays readable. */
export function normalizeUnit(text: string): string {
	return text
		.replace(/\s+/g, '')
		.replace(/(?:[A-Za-z_]\w*::)+/g, '')
		.replace(/'/g, '')
		.replace(/·/g, '*')
		.replace(/\*\*/g, '^')
		.replace(/²/g, '^2')
		.replace(/³/g, '^3');
}

const cache = new Map<string, Unit | null>();

/** The scale and dimensions of a unit, or null when a symbol is unknown. */
export function parseUnit(text: string): Unit | null {
	const key = normalizeUnit(text);
	if (cache.has(key)) return cache.get(key)!;
	const unit = parse(key);
	cache.set(key, unit);
	return unit;
}

function parse(text: string): Unit | null {
	if (!text) return null;
	const single = SYMBOLS[ALIASES[text] ?? text];
	if (single) return { factor: single.factor, dims: single.dims, offset: single.offset ?? 0 };
	// A product of powers: `kg*m/s^2`, `km/h`, `m/(s*s)`.
	let pos = 0;
	const term = (): Unit | null => {
		let unit: Unit | null;
		if (text[pos] === '(') {
			pos++;
			unit = product();
			if (text[pos] !== ')') return null;
			pos++;
		} else {
			const match = /^[^*/^()]+/.exec(text.slice(pos));
			if (!match) return null;
			pos += match[0].length;
			if (match[0] === '1') unit = { factor: 1, dims: NONE, offset: 0 };
			else {
				const s = SYMBOLS[ALIASES[match[0]] ?? match[0]];
				if (!s) return null;
				unit = { factor: s.factor, dims: s.dims, offset: 0 };
			}
		}
		const power = /^\^(-?\d+)/.exec(text.slice(pos));
		if (power && unit) {
			pos += power[0].length;
			const n = Number(power[1]);
			unit = {
				factor: unit.factor ** n,
				dims: unit.dims.map((d) => d * n) as unknown as Dims,
				offset: 0
			};
		}
		return unit;
	};
	const product = (): Unit | null => {
		let unit = term();
		while (unit && (text[pos] === '*' || text[pos] === '/')) {
			const divide = text[pos++] === '/';
			const next = term();
			if (!next) return null;
			unit = {
				factor: divide ? unit.factor / next.factor : unit.factor * next.factor,
				dims: unit.dims.map((d, i) =>
					divide ? d - next.dims[i]! : d + next.dims[i]!
				) as unknown as Dims,
				offset: 0
			};
		}
		return unit;
	};
	const unit = product();
	return unit && pos === text.length ? unit : null;
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
	const a = parseUnit(from);
	const b = parseUnit(to);
	if (!a || !b || !sameDimension(a, b))
		throw new Error(`no conversion from \`${from}\` to \`${to}\``);
	return (value * a.factor + a.offset - b.offset) / b.factor;
}
