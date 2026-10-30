/**
 * The app's expressions (`sim/expr.ts`'s `Expr`, as the tables and checks
 * evaluate them) compiled into plain number functions of the uncertain
 * values, so a Monte Carlo run evaluates thousands of samples in
 * milliseconds.
 *
 * Every number is carried in the coherent SI unit of its dimension (a mass
 * in kg, a duration in s), so a tolerance in g on a value in kg, or watt
 * hours over watts, need no conversion while sampling: units are worked out
 * once, here. The rules are the evaluator's: `+`, `-` and comparisons need
 * the same dimension, and a bare number beside a quantity takes its unit
 * (`x + 5` with x in g is 5 g); `*` and `/` combine dimensions; `**` takes a
 * plain number as its exponent; `sum`, `min`, `max`, `mean`, `rss`, `abs`,
 * `clamp`, `floor`, `ceil`, `round` and `sqrt` read as there. A result's
 * `unit` is the one the evaluator would give it (`W*h/W`), to show it in.
 *
 * What it doesn't compile (a temperature in °C or °F, whose zero shift
 * makes sums ambiguous; an unknown unit; text and enum values; `%`) throws
 * `CompileError`: the caller then shows no spread rather than a wrong one.
 * Non-finite results (a division by zero in one sample) are the sample's
 * result; the statistics count them as failed.
 */
import { parseUnit } from '#lib/engine/quantity.ts';
import { Quantity, type Expr } from '#lib/sim/expr.ts';

export class CompileError extends Error {}

/** One input vector: the uncertain values of one sample, each in its own unit. */
export type Sample = Float64Array;

export interface Compiled {
	/** The value for one sample, in the coherent SI unit of `dims` (1 or 0 for a Boolean). */
	at: (x: Sample) => number;
	boolean: boolean;
	/** Exponents of length, mass, time, current, temperature, amount, luminous intensity, angle, solid angle. */
	dims: readonly number[];
	/** The unit the evaluator would give the result, or null for a plain number. */
	unit: string | null;
	/** Whether it reads no input (its `at` ignores the sample). */
	constant: boolean;
}

/** Where names and the calls the evaluator doesn't know get their meaning. */
export interface Binder {
	name(name: string): Compiled | null;
	/** A calc of the model, given its arguments compiled; null when there is none by that name. */
	call?(name: string, args: Compiled[]): Compiled | null;
}

const NONE: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** The SI factor and dimension of a unit, or a `CompileError`. */
function unitInfo(unit: string): { factor: number; dims: readonly number[] } {
	const info = parseUnit(unit);
	if (!info) throw new CompileError(`the unit \`${unit}\` is not known`);
	if (info.offset)
		throw new CompileError(`a temperature in \`${unit}\` has a zero shift, so it is not sampled`);
	return { factor: info.factor, dims: info.dimension };
}

/** The factor of a node's unit (1 for a plain number). */
const factorOf = (unit: string | null) => (unit ? unitInfo(unit).factor : 1);

/** A constant, given in `unit`. */
export function constant(value: number | boolean, unit: string | null = null): Compiled {
	if (typeof value === 'boolean') return fixed(value ? 1 : 0, NONE, null, true);
	if (!unit) return fixed(value, NONE, null, false);
	const { factor, dims } = unitInfo(unit);
	return fixed(value * factor, dims, unit, false);
}

/** Input `index` of the sample, whose numbers are in `unit`. */
export function input(index: number, unit: string | null): Compiled {
	const { factor, dims } = unit ? unitInfo(unit) : { factor: 1, dims: NONE };
	return { at: (x) => x[index]! * factor, boolean: false, dims, unit, constant: false };
}

function fixed(
	value: number,
	dims: readonly number[],
	unit: string | null,
	boolean: boolean
): Compiled {
	return { at: () => value, boolean, dims, unit, constant: true };
}

/** A node's value as a number in its own unit (what the evaluator's functions read). */
export function inUnit(c: Compiled, x: Sample): number {
	return c.at(x) / factorOf(c.unit);
}

/** `make` applied to the nodes, folded to a constant when they all are. */
function node(
	parts: Compiled[],
	at: (x: Sample) => number,
	dims: readonly number[],
	unit: string | null,
	boolean = false
): Compiled {
	if (parts.every((p) => p.constant)) {
		const value = at(new Float64Array(0));
		return fixed(value, dims, unit, boolean);
	}
	return { at, boolean, dims, unit, constant: false };
}

const sameDims = (a: readonly number[], b: readonly number[]) => a.every((d, i) => d === b[i]);

function numeric(c: Compiled, what: string): Compiled {
	if (c.boolean) throw new CompileError(`${what} needs a number, not a Boolean`);
	return c;
}

/**
 * Two numbers made comparable: a bare number takes the other's unit (its
 * value is then scaled by that unit's factor), else the dimensions must
 * agree. The result's unit is the first's, as the evaluator gives it.
 */
function aligned(
	op: string,
	a: Compiled,
	b: Compiled
): { a: Compiled; b: Compiled; unit: string | null; dims: readonly number[] } {
	numeric(a, `\`${op}\``);
	numeric(b, `\`${op}\``);
	if (!a.unit && b.unit) a = scaled(a, b.unit);
	else if (a.unit && !b.unit) b = scaled(b, a.unit);
	else if (!sameDims(a.dims, b.dims))
		throw new CompileError(`cannot apply \`${op}\` to values in \`${a.unit}\` and \`${b.unit}\``);
	return { a, b, unit: a.unit ?? b.unit, dims: a.unit ? a.dims : b.dims };
}

/** A bare number read in `unit`. */
function scaled(c: Compiled, unit: string): Compiled {
	const { factor, dims } = unitInfo(unit);
	const f = c.at;
	return node([c], (x) => f(x) * factor, dims, unit);
}

const wrap = (unit: string) => (/[*/]/.test(unit) ? `(${unit})` : unit);

export function compile(expr: Expr, binder: Binder): Compiled {
	const go = (e: Expr): Compiled => compile(e, binder);
	switch (expr.kind) {
		case 'literal': {
			const v = expr.value;
			if (typeof v === 'number' || typeof v === 'boolean') return constant(v);
			if (v instanceof Quantity) return constant(v.value, v.unit);
			throw new CompileError('only numbers and Booleans are sampled');
		}
		case 'name': {
			const bound = binder.name(expr.name);
			if (!bound) throw new CompileError(`\`${expr.name}\` has no value to sample`);
			return bound;
		}
		case 'unary': {
			const v = go(expr.operand);
			const f = v.at;
			if (expr.op === 'not') {
				if (!v.boolean) throw new CompileError('`not` needs a Boolean');
				return node([v], (x) => (f(x) ? 0 : 1), NONE, null, true);
			}
			numeric(v, `\`${expr.op}\``);
			return expr.op === '-' ? node([v], (x) => -f(x), v.dims, v.unit) : v;
		}
		case 'unit': {
			const v = go(expr.operand);
			numeric(v, 'a unit');
			const { factor, dims } = unitInfo(expr.unit);
			if (!v.unit) {
				const f = v.at;
				return node([v], (x) => f(x) * factor, dims, expr.unit);
			}
			if (!sameDims(v.dims, dims))
				throw new CompileError(`no conversion from \`${v.unit}\` to \`${expr.unit}\``);
			return { ...v, unit: expr.unit };
		}
		case 'if': {
			const c = go(expr.condition);
			if (!c.boolean) throw new CompileError('the condition of `if` is not a Boolean');
			const t = go(expr.then);
			const e = go(expr.else);
			if (t.boolean !== e.boolean || (!t.boolean && !sameDims(t.dims, e.dims)))
				throw new CompileError('the two branches of `if` give different kinds of value');
			const [fc, ft, fe] = [c.at, t.at, e.at];
			return node([c, t, e], (x) => (fc(x) ? ft(x) : fe(x)), t.dims, t.unit, t.boolean);
		}
		case 'binary':
			return binary(expr.op, go(expr.left), go(expr.right));
		case 'call': {
			const args = expr.args.map(go);
			const own = binder.call?.(expr.name, args);
			if (own) return own;
			return call(expr.name.split('::').pop()!, args);
		}
	}
}

function binary(op: string, l: Compiled, r: Compiled): Compiled {
	switch (op) {
		case '+':
		case '-': {
			const { a, b, unit, dims } = aligned(op, l, r);
			const [fa, fb] = [a.at, b.at];
			return node([a, b], op === '+' ? (x) => fa(x) + fb(x) : (x) => fa(x) - fb(x), dims, unit);
		}
		case '*':
		case '/': {
			numeric(l, `\`${op}\``);
			numeric(r, `\`${op}\``);
			const [fa, fb] = [l.at, r.at];
			const dims = l.dims.map((d, i) => (op === '*' ? d + r.dims[i]! : d - r.dims[i]!));
			const unit =
				l.unit && r.unit
					? op === '*'
						? `${l.unit}*${r.unit}`
						: `${l.unit}/${wrap(r.unit)}`
					: (l.unit ?? (r.unit ? (op === '*' ? r.unit : `1/${wrap(r.unit)}`) : null));
			return node([l, r], op === '*' ? (x) => fa(x) * fb(x) : (x) => fa(x) / fb(x), dims, unit);
		}
		case '**': {
			numeric(l, '`**`');
			if (!r.constant || r.unit || r.boolean)
				throw new CompileError('`**` needs a plain number as its exponent');
			const k = r.at(new Float64Array(0));
			const fa = l.at;
			return node(
				[l],
				(x) => fa(x) ** k,
				l.dims.map((d) => d * k),
				l.unit ? `${wrap(l.unit)}^${k}` : null
			);
		}
		case '<':
		case '>':
		case '<=':
		case '>=':
		case '==':
		case '!=': {
			if (l.boolean && r.boolean && (op === '==' || op === '!=')) {
				const [fa, fb] = [l.at, r.at];
				return node(
					[l, r],
					op === '==' ? (x) => +(fa(x) === fb(x)) : (x) => +(fa(x) !== fb(x)),
					NONE,
					null,
					true
				);
			}
			const { a, b } = aligned(op, l, r);
			const [fa, fb] = [a.at, b.at];
			const test = {
				'<': (x: Sample) => +(fa(x) < fb(x)),
				'>': (x: Sample) => +(fa(x) > fb(x)),
				'<=': (x: Sample) => +(fa(x) <= fb(x)),
				'>=': (x: Sample) => +(fa(x) >= fb(x)),
				'==': (x: Sample) => +(fa(x) === fb(x)),
				'!=': (x: Sample) => +(fa(x) !== fb(x))
			}[op];
			return node([a, b], test, NONE, null, true);
		}
		case 'and':
		case 'or':
		case 'xor':
		case 'implies': {
			if (!l.boolean || !r.boolean) throw new CompileError(`\`${op}\` needs Booleans`);
			const [fa, fb] = [l.at, r.at];
			const test = {
				and: (x: Sample) => +(!!fa(x) && !!fb(x)),
				or: (x: Sample) => +(!!fa(x) || !!fb(x)),
				xor: (x: Sample) => +(!!fa(x) !== !!fb(x)),
				implies: (x: Sample) => +(!fa(x) || !!fb(x))
			}[op];
			return node([l, r], test, NONE, null, true);
		}
	}
	throw new CompileError(`\`${op}\` is not sampled`);
}

/** The arguments aligned to the first's unit, as the evaluator's `numbers` does. */
function alignedAll(
	name: string,
	args: Compiled[]
): { args: Compiled[]; unit: string | null; dims: readonly number[] } {
	if (!args.length) throw new CompileError(`${name} needs at least one argument`);
	const first = numeric(args[0]!, name);
	const out = [first];
	for (const a of args.slice(1)) out.push(aligned(name, first, a).b);
	return { args: out, unit: first.unit, dims: first.dims };
}

function call(name: string, raw: Compiled[]): Compiled {
	switch (name) {
		case 'sum':
		case 'mean':
		case 'avg':
		case 'rss': {
			if (!raw.length && name === 'sum') return constant(0);
			const { args, unit, dims } = alignedAll(name, raw);
			const fs = args.map((a) => a.at);
			const n = fs.length;
			const at =
				name === 'sum'
					? (x: Sample) => {
							let s = 0;
							for (let i = 0; i < n; i++) s += fs[i]!(x);
							return s;
						}
					: name === 'rss'
						? (x: Sample) => {
								let s = 0;
								for (let i = 0; i < n; i++) s += fs[i]!(x) ** 2;
								return Math.sqrt(s);
							}
						: (x: Sample) => {
								let s = 0;
								for (let i = 0; i < n; i++) s += fs[i]!(x);
								return s / n;
							};
			return node(args, at, dims, unit);
		}
		case 'min':
		case 'max': {
			const { args, unit, dims } = alignedAll(name, raw);
			const fs = args.map((a) => a.at);
			const pick = name === 'min' ? Math.min : Math.max;
			return node(args, (x) => pick(...fs.map((f) => f(x))), dims, unit);
		}
		case 'clamp': {
			if (raw.length !== 3) throw new CompileError('clamp expects 3 arguments');
			const { args, unit, dims } = alignedAll(name, raw);
			const [fv, flo, fhi] = args.map((a) => a.at) as [
				Compiled['at'],
				Compiled['at'],
				Compiled['at']
			];
			return node(args, (x) => Math.min(Math.max(fv(x), flo(x)), fhi(x)), dims, unit);
		}
		case 'abs':
		case 'floor':
		case 'ceil':
		case 'round': {
			if (raw.length !== 1) throw new CompileError(`${name} expects 1 argument`);
			const v = numeric(raw[0]!, name);
			const factor = factorOf(v.unit);
			const fv = v.at;
			const f = {
				abs: Math.abs,
				floor: Math.floor,
				ceil: Math.ceil,
				round: (n: number) => Math.sign(n) * Math.round(Math.abs(n))
			}[name];
			// Rounded in the value's own unit, as the evaluator rounds it.
			return node([v], (x) => f(fv(x) / factor) * factor, v.dims, v.unit);
		}
		case 'sqrt': {
			if (raw.length !== 1) throw new CompileError('sqrt expects 1 argument');
			const v = numeric(raw[0]!, name);
			const factor = factorOf(v.unit);
			const fv = v.at;
			// The evaluator takes the root of the magnitude and drops the unit.
			return node([v], (x) => Math.sqrt(fv(x) / factor), NONE, null);
		}
	}
	throw new CompileError(`\`${name}\` is not sampled`);
}
