/**
 * The units of the bundled standard library (`SI`, `USCustomaryUnits`), read
 * from its text: each unit's symbol, its factor to the coherent SI unit of
 * its dimension and that dimension, worked out from the library's own
 * definitions (`attribute <N> newton : ForceUnit = kg*m/s^2;`, a
 * `ConversionByConvention` or a `ConversionByPrefix`). The app's unit table
 * (`unitTable.ts`) is generated from it, and its test checks the two agree,
 * so the tables, the inspector and the app's evaluator convert exactly as
 * the library the model uses defines.
 *
 * Not shipped: only the test and the table's generation read it.
 */

/** Exponents of length, mass, time, current, temperature, amount, luminous intensity, angle, solid angle. */
export type Dims = number[];

export interface LibraryUnit {
	/** As written in brackets: `kg`, `lb`, `'km/h'` unquoted, `°C`. */
	symbol: string;
	/** The package that declares it (`SI`, `USCustomaryUnits`), to qualify it in text. */
	pkg: string;
	factor: number;
	dims: Dims;
	/** For a scale with a zero shift (`°C`, `°F`): kelvin at its zero. */
	offset?: number;
}

const DIMS = 9;
const zero = (): Dims => Array<number>(DIMS).fill(0);
const unit = (i: number): Dims => zero().map((_, j) => (j === i ? 1 : 0));

/** The library's base units and the quantity kinds it counts apart although they have no dimension. */
const BASE: Record<string, { factor: number; dims: Dims }> = {
	m: { factor: 1, dims: unit(0) },
	g: { factor: 1e-3, dims: unit(1) },
	s: { factor: 1, dims: unit(2) },
	A: { factor: 1, dims: unit(3) },
	K: { factor: 1, dims: unit(4) },
	mol: { factor: 1, dims: unit(5) },
	cd: { factor: 1, dims: unit(6) }
};
const KINDS: Record<string, Dims> = {
	AngularMeasureUnit: unit(7),
	SolidAngularMeasureUnit: unit(8)
};

interface Declaration {
	symbol: string;
	name: string;
	pkg: string;
	types: string[];
	expression: string | null;
	referenceUnit: string | null;
	conversionFactor: string | null;
	prefix: string | null;
	/** For an interval scale (`°C_abs`): the unit it shifts and the shift, in kelvin. */
	scaleOf?: string;
	shift?: string;
}

const unquote = (s: string) => s.trim().replace(/^'(.*)'$/s, '$1');

/** The library's units, by symbol; also by plain-identifier name and alias (`metre`, `psi`). */
export function unitsFromLibrary(files: { name: string; text: string }[]): {
	units: LibraryUnit[];
	/** Symbols the library declares that the table leaves out, and why. */
	left: Record<string, string>;
	/** Other spellings: a unit's name when it is a plain identifier, and the library's aliases. */
	aliases: Record<string, string>;
} {
	const decls = new Map<string, Declaration>();
	const names = new Map<string, string>();
	const aliases: Record<string, string> = {};
	const prefixes = new Map<string, number>();
	for (const file of files) {
		const pkg =
			/^\s*(?:standard\s+)?library\s+package\s+(?:<[^>]*>\s*)?(\w+)/m.exec(file.text)?.[1] ?? '';
		if (pkg === 'SIPrefixes')
			for (const m of file.text.matchAll(
				/attribute\s+(\w+)\s*:\s*UnitPrefix\s*\{[^}]*conversionFactor\s*=\s*([^;]+);/g
			))
				prefixes.set(m[1]!, number(m[2]!));
		if (pkg !== 'SI' && pkg !== 'USCustomaryUnits') continue;
		for (const d of declarations(file.text, pkg)) {
			decls.set(d.symbol, d);
			names.set(d.name, d.symbol);
		}
		for (const m of file.text.matchAll(/^\s*alias\s+('[^']*'|\w+)\s+for\s+('[^']*'|\w+)\s*;/gm))
			aliases[unquote(m[1]!)] = unquote(m[2]!);
	}
	const left: Record<string, string> = {};
	const done = new Map<string, { factor: number; dims: Dims; offset?: number } | null>();
	const resolving = new Set<string>();
	const lookup = (name: string): { factor: number; dims: Dims } | null => {
		const symbol = decls.has(name) ? name : (names.get(name) ?? aliases[name] ?? name);
		return resolve(symbol);
	};
	const resolve = (symbol: string): { factor: number; dims: Dims } | null => {
		if (done.has(symbol)) return done.get(symbol)!;
		const d = decls.get(symbol);
		if (!d || resolving.has(symbol)) return null;
		resolving.add(symbol);
		let out: { factor: number; dims: Dims } | null = null;
		const kind = d.types.map((t) => KINDS[t]).find(Boolean);
		if (BASE[symbol]) out = BASE[symbol]!;
		else if (d.prefix && d.referenceUnit) {
			const ref = evaluateUnit(d.referenceUnit, lookup);
			const p = prefixes.get(d.prefix);
			if (ref && p !== undefined) out = { factor: p * ref.factor, dims: ref.dims };
		} else if (d.referenceUnit && d.conversionFactor) {
			const ref = evaluateUnit(d.referenceUnit, lookup);
			if (ref) out = { factor: number(d.conversionFactor) * ref.factor, dims: ref.dims };
		} else if (d.expression) {
			if (/^\s*one\s*$/.test(d.expression)) left[symbol] = 'defined as `one`: no conversion';
			else out = evaluateUnit(d.expression, lookup);
		}
		if (out && kind && out.dims.every((x) => x === 0)) out = { factor: out.factor, dims: kind };
		if (!out && !left[symbol]) left[symbol] = 'no conversion the table can read';
		resolving.delete(symbol);
		done.set(symbol, out);
		return out;
	};
	const units: LibraryUnit[] = [];
	for (const d of decls.values()) {
		if (d.scaleOf) continue;
		const u = resolve(d.symbol);
		if (u)
			units.push({
				symbol: d.symbol,
				pkg: d.pkg,
				factor: u.factor,
				dims: u.dims.map((x) => x || 0)
			});
	}
	// The interval scales (`°C_abs`, `°F_abs`) are temperatures with a zero shift from kelvin. The
	// library declares `°C` and `°F` themselves as units of temperature difference, but people
	// write them for temperatures (`20 [°C]`): they get the scale's shift too, so a lone value
	// converts as a temperature, and the app never adds them to anything (`quantity.ts`).
	for (const d of decls.values()) {
		if (!d.scaleOf || !d.shift) continue;
		const target = units.find((u) => u.symbol === d.scaleOf);
		if (!target) continue;
		target.offset = number(d.shift);
		units.push({ ...target, dims: [...target.dims], symbol: d.symbol, pkg: d.pkg });
	}
	const kept = units.filter((u) => !left[u.symbol]);
	const plain = /^[A-Za-z_]\w*$/;
	const others: Record<string, string> = {};
	for (const [name, symbol] of names)
		if (plain.test(name) && name !== symbol && kept.some((u) => u.symbol === symbol))
			others[name] = symbol;
	for (const [alias, target] of Object.entries(aliases)) {
		const symbol = decls.has(target) ? target : names.get(target);
		if (symbol && kept.some((u) => u.symbol === symbol)) others[alias] = symbol;
	}
	return { units: kept, left, aliases: others };
}

/** The unit declarations of a package: `attribute <sym> name : Types (= expr)? ({ … } | ;)`. */
function declarations(text: string, pkg: string): Declaration[] {
	const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
	const out: Declaration[] = [];
	const start = /attribute\s*<\s*('[^']*'|[^>\s]+)\s*>\s*('[^']*'|\w+)\s*:\s*/g;
	for (let m = start.exec(clean); m; m = start.exec(clean)) {
		let i = start.lastIndex;
		let depth = 0;
		let head = '';
		let body = '';
		for (; i < clean.length; i++) {
			const ch = clean[i]!;
			if (ch === "'") {
				const end = clean.indexOf("'", i + 1);
				(depth ? (s: string) => (body += s) : (s: string) => (head += s))(clean.slice(i, end + 1));
				i = end;
				continue;
			}
			if (ch === '{') depth++;
			if (ch === '}') {
				depth--;
				if (depth === 0) break;
			}
			if (ch === ';' && depth === 0) break;
			if (depth) body += ch;
			else head += ch;
		}
		start.lastIndex = i + 1;
		const [typesText, expression] = splitOnce(head, '=');
		const field = (key: string) =>
			new RegExp(`${key}\\s*=\\s*([^;}]+)`).exec(body)?.[1]?.trim() ?? null;
		const decl: Declaration = {
			symbol: unquote(m[1]!),
			name: unquote(m[2]!),
			pkg,
			types: typesText.split(',').map((t) => t.trim().split('::').pop()!),
			expression: expression?.trim() || null,
			referenceUnit: field('referenceUnit'),
			conversionFactor: field('conversionFactor'),
			prefix: field('prefix')
		};
		if (decl.types.includes('IntervalScale')) {
			decl.scaleOf = unquote(field('unit') ?? '');
			decl.shift = /=\s*([\d./eE+-]+)\s*\[\s*K\s*\]/.exec(body)?.[1];
		}
		out.push(decl);
	}
	return out;
}

/** `a = b` → [a, b] at the first `=` outside quotes; [text, null] without one. */
function splitOnce(text: string, sep: string): [string, string | null] {
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "'") quoted = !quoted;
		if (!quoted && text[i] === sep) return [text.slice(0, i), text.slice(i + 1)];
	}
	return [text, null];
}

/** A number as the library writes one: `1.0e-3`, `5/9`, `1024^2`, `229835/900`. */
function number(text: string): number {
	const t = text.trim();
	const pow = /^([\d.eE+-]+)\s*\^\s*(\d+)$/.exec(t);
	if (pow) return Number(pow[1]) ** Number(pow[2]);
	const ratio = /^([\d.eE+-]+)\s*\/\s*([\d.eE+-]+)$/.exec(t);
	if (ratio) return Number(ratio[1]) / Number(ratio[2]);
	const n = Number(t);
	if (!Number.isFinite(n)) throw new Error(`not a number: ${text}`);
	return n;
}

/** A unit expression of the library (`kg*m/s^2`, `'Ω'^-1`, `J/(m^2*nm)`), by the units it names. */
function evaluateUnit(
	text: string,
	lookup: (name: string) => { factor: number; dims: Dims } | null
): { factor: number; dims: Dims } | null {
	let at = 0;
	const s = text.trim();
	const space = () => {
		while (s[at] === ' ') at++;
	};
	const atom = (): { factor: number; dims: Dims } | null => {
		space();
		if (s[at] === '(') {
			at++;
			const inner = product();
			space();
			if (s[at] !== ')') return null;
			at++;
			return inner;
		}
		const m = /^(?:'[^']*'|[A-Za-z_]\w*|\d+)/.exec(s.slice(at));
		if (!m) return null;
		at += m[0].length;
		if (/^\d+$/.test(m[0])) return { factor: Number(m[0]), dims: zero() };
		return lookup(unquote(m[0]));
	};
	const power = () => {
		const base = atom();
		space();
		if (s[at] !== '^') return base;
		at++;
		const m = /^(?:\(\s*(-?\d+)\s*\)|(-?\d+))/.exec(s.slice(at));
		if (!m || !base) return null;
		at += m[0].length;
		const n = Number(m[1] ?? m[2]);
		return { factor: base.factor ** n, dims: base.dims.map((x) => x * n) };
	};
	const product = (): { factor: number; dims: Dims } | null => {
		let acc = power();
		for (;;) {
			space();
			const op = s[at];
			if (op !== '*' && op !== '/') return acc;
			at++;
			const next = power();
			if (!acc || !next) return null;
			const sign = op === '/' ? -1 : 1;
			acc = {
				factor: acc.factor * next.factor ** sign,
				dims: acc.dims.map((x, i) => x + sign * next.dims[i]!)
			};
		}
	};
	const result = product();
	space();
	return result && at === s.length ? result : null;
}
