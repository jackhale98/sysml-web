/**
 * A small evaluator for the expressions state machines carry: guards,
 * change conditions, assigned values and attribute defaults.
 *
 * It reads the SysML v2 expression syntax a guard needs — numbers with
 * units (`5 [km]`), strings, `true`/`false`/`null`, comparisons,
 * arithmetic, `and`/`or`/`xor`/`implies`/`not` (and `&`, `|`, `!`),
 * `if c ? a else b`, `??`, variable references (`soc`, `self.soc`), enum
 * literals (`Mode::cruise`) and the functions below — with KerML's
 * operator precedence. Anything else is a parse error, which callers treat
 * as "not supported by the evaluator".
 */
import { convert, normalizeUnit, parseUnit, sameDimension } from './units.ts';

/** A number with a unit, as written in brackets after it. */
export class Quantity {
	constructor(
		readonly value: number,
		readonly unit: string
	) {}
}

/** An enumeration literal (`Mode::cruise`): equal to another with the same name, or to its name as text. */
export class EnumLiteral {
	constructor(readonly qualified: string) {}
	/** The literal's name, unquoted (`Kind::'use'` is `use`). */
	get name(): string {
		const last = this.qualified.split('::').pop()!;
		return /^'.*'$/.test(last) ? last.slice(1, -1).replace(/\\(.)/g, '$1') : last;
	}
}

export type Value = number | boolean | string | null | Quantity | EnumLiteral;

export type BinaryOp =
	| '+'
	| '-'
	| '*'
	| '/'
	| '%'
	| '**'
	| '=='
	| '!='
	| '<'
	| '>'
	| '<='
	| '>='
	| 'and'
	| 'or'
	| 'xor'
	| 'implies'
	| '??';

export type Expr =
	| { kind: 'literal'; value: Value }
	| { kind: 'name'; name: string }
	| { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
	| { kind: 'unary'; op: 'not' | '-' | '+'; operand: Expr }
	| { kind: 'call'; name: string; args: Expr[] }
	| { kind: 'unit'; operand: Expr; unit: string }
	| { kind: 'if'; condition: Expr; then: Expr; else: Expr };

export class EvalError extends Error {}
export class ParseError extends Error {}

// ---------------------------------------------------------------- tokens

type Token =
	| { type: 'number'; value: number }
	| { type: 'string'; value: string }
	| { type: 'name'; value: string }
	| { type: 'op'; value: string }
	| { type: 'unit'; value: string }
	| { type: 'end'; value: '' };

const OPERATORS = [
	'===',
	'!==',
	'**',
	'==',
	'!=',
	'<=',
	'>=',
	'??',
	'::',
	'<',
	'>',
	'+',
	'-',
	'*',
	'/',
	'%',
	'^',
	'&',
	'|',
	'!',
	'?',
	'(',
	')',
	',',
	'.'
];

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < source.length) {
		const rest = source.slice(i);
		const space = /^\s+/.exec(rest);
		if (space) {
			i += space[0].length;
			continue;
		}
		const number = /^(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?/.exec(rest);
		if (number) {
			tokens.push({ type: 'number', value: Number(number[0].replace(/_/g, '')) });
			i += number[0].length;
			continue;
		}
		if (rest[0] === '"') {
			let j = 1;
			let text = '';
			while (j < rest.length && rest[j] !== '"') {
				if (rest[j] === '\\' && j + 1 < rest.length) j++;
				text += rest[j];
				j++;
			}
			if (j >= rest.length) throw new ParseError('unterminated string');
			tokens.push({ type: 'string', value: text });
			i += j + 1;
			continue;
		}
		const name = /^(?:[A-Za-z_]\w*|'(?:[^'\\]|\\.)*')/.exec(rest);
		if (name) {
			tokens.push({ type: 'name', value: name[0] });
			i += name[0].length;
			continue;
		}
		if (rest[0] === '[') {
			// A unit: everything up to the matching `]`, read as one token.
			const close = rest.indexOf(']');
			if (close < 0) throw new ParseError('unclosed `[`');
			tokens.push({ type: 'unit', value: rest.slice(1, close).trim() });
			i += close + 1;
			continue;
		}
		const op = OPERATORS.find((o) => rest.startsWith(o));
		if (!op) throw new ParseError(`unexpected \`${rest[0]}\``);
		tokens.push({ type: 'op', value: op });
		i += op.length;
	}
	tokens.push({ type: 'end', value: '' });
	return tokens;
}

// ---------------------------------------------------------------- parser

const KEYWORDS = new Set([
	'and',
	'or',
	'xor',
	'not',
	'implies',
	'if',
	'else',
	'true',
	'false',
	'null'
]);

/** Parse an expression; throws `ParseError` on anything outside the supported syntax. */
export function parseExpr(source: string): Expr {
	const tokens = tokenize(source);
	let pos = 0;
	const peek = () => tokens[pos]!;
	const isOp = (...ops: string[]) => {
		const t = peek();
		return (t.type === 'op' || t.type === 'name') && ops.includes(t.value);
	};
	const take = () => tokens[pos++]!;
	const expect = (op: string) => {
		if (!isOp(op)) throw new ParseError(`expected \`${op}\``);
		pos++;
	};

	const binaryLevel = (ops: Record<string, BinaryOp>, next: () => Expr) => (): Expr => {
		let left = next();
		while (isOp(...Object.keys(ops))) {
			const op = ops[take().value as keyof typeof ops]!;
			left = { kind: 'binary', op, left, right: next() };
		}
		return left;
	};

	const conditional = (): Expr => {
		if (isOp('if')) {
			pos++;
			const condition = conditional();
			expect('?');
			const then = conditional();
			expect('else');
			return { kind: 'if', condition, then, else: conditional() };
		}
		return coalesce();
	};
	const primary = (): Expr => {
		const t = take();
		switch (t.type) {
			case 'number':
				return { kind: 'literal', value: t.value };
			case 'string':
				return { kind: 'literal', value: t.value };
			case 'op':
				if (t.value === '(') {
					const inner = conditional();
					expect(')');
					return inner;
				}
				throw new ParseError(`unexpected \`${t.value}\``);
			case 'name': {
				if (t.value === 'true' || t.value === 'false')
					return { kind: 'literal', value: t.value === 'true' };
				if (t.value === 'null') return { kind: 'literal', value: null };
				if (KEYWORDS.has(t.value)) throw new ParseError(`unexpected \`${t.value}\``);
				let name = t.value;
				while (isOp('::', '.')) {
					const sep = take().value;
					const part = take();
					if (part.type !== 'name' || KEYWORDS.has(part.value))
						throw new ParseError(`expected a name after \`${sep}\``);
					name += sep + part.value;
				}
				if (isOp('(')) {
					pos++;
					const args: Expr[] = [];
					if (!isOp(')')) {
						do args.push(conditional());
						while (isOp(',') && take());
					}
					expect(')');
					return { kind: 'call', name, args };
				}
				return { kind: 'name', name };
			}
			default:
				throw new ParseError(t.type === 'end' ? 'unexpected end' : `unexpected \`[\``);
		}
	};
	const postfix = (): Expr => {
		let operand = primary();
		while (peek().type === 'unit') {
			const unit = normalizeUnit(take().value as string);
			if (!unit) throw new ParseError('empty unit');
			operand = { kind: 'unit', operand, unit };
		}
		return operand;
	};
	const unary = (): Expr => {
		if (isOp('not', '!', '-', '+')) {
			const op = take().value;
			return {
				kind: 'unary',
				op: op === '!' ? 'not' : (op as 'not' | '-' | '+'),
				operand: unary()
			};
		}
		return postfix();
	};
	// Exponentiation is right-associative and binds looser than a sign: `-2 ** 2` is 4.
	const power = (): Expr => {
		const base = unary();
		if (isOp('**', '^')) {
			pos++;
			return { kind: 'binary', op: '**', left: base, right: power() };
		}
		return base;
	};
	const multiplicative = binaryLevel({ '*': '*', '/': '/', '%': '%' }, power);
	const additive = binaryLevel({ '+': '+', '-': '-' }, multiplicative);
	const relational = binaryLevel({ '<': '<', '>': '>', '<=': '<=', '>=': '>=' }, additive);
	const equality = binaryLevel({ '==': '==', '!=': '!=', '===': '==', '!==': '!=' }, relational);
	const and = binaryLevel({ and: 'and', '&': 'and' }, equality);
	const xor = binaryLevel({ xor: 'xor' }, and);
	const or = binaryLevel({ or: 'or', '|': 'or' }, xor);
	const implies = binaryLevel({ implies: 'implies' }, or);
	const coalesce = binaryLevel({ '??': '??' }, implies);

	const expr = conditional();
	if (peek().type !== 'end') throw new ParseError(`unexpected text after the expression`);
	return expr;
}

// ---------------------------------------------------------------- values

/** A value as the Rust engine printed it in messages: `3`, `0.5`, `true`, `"a"`, `5 [kg]`. */
export function display(value: Value): string {
	if (value === null) return 'null';
	if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
	if (typeof value === 'string') return `"${value}"`;
	if (value instanceof Quantity) return `${display(value.value)} [${value.unit}]`;
	if (value instanceof EnumLiteral) return value.qualified;
	return String(value);
}

function magnitude(value: Value): number | null {
	if (typeof value === 'number') return value;
	if (value instanceof Quantity) return value.value;
	return null;
}

function asBool(value: Value): boolean | null {
	if (typeof value === 'boolean') return value;
	const n = magnitude(value);
	return n === null ? null : n !== 0;
}

/**
 * Bring two numbers to a common unit. A bare number takes the other side's
 * unit; units that measure different things are an error; unknown units
 * compare by magnitude, but don't add up (`1 [furlong] + 1 [m]` is no 2 furlongs).
 * A temperature in `°C` or `°F` compares with one in another unit (with its
 * zero shift), but doesn't add to it: `20 [°C] + 1 [K]` is 21 °C if the
 * kelvin is a difference and -252.15 °C if it is a temperature.
 */
function align(op: string, a: Value, b: Value): { x: number; y: number; unit: string | null } {
	const x = magnitude(a)!;
	const y = magnitude(b)!;
	const ua = a instanceof Quantity ? a.unit : null;
	const ub = b instanceof Quantity ? b.unit : null;
	if (!ua || !ub || ua === ub) return { x, y, unit: ua ?? ub };
	const pa = parseUnit(ua);
	const pb = parseUnit(ub);
	if (!pa || !pb) {
		if (!COMPARISONS.has(op)) throw cannot(op, a, b);
		return { x, y, unit: ua };
	}
	if (!sameDimension(pa, pb)) throw cannot(op, a, b);
	if ((pa.offset || pb.offset) && !ORDERS.has(op))
		throw new EvalError(
			`${cannot(op, a, b).message}: a temperature in \`${pa.offset ? ua : ub}\` doesn't add to a value in another unit`
		);
	return { x, y: convert(y, ub, ua), unit: ua };
}

const COMPARISONS = new Set(['<', '>', '<=', '>=', '==']);
/** What only orders values, so a temperature converts with its zero shift. */
const ORDERS = new Set([...COMPARISONS, 'min', 'max', 'clamp']);

function withUnit(n: number, unit: string | null): Value {
	return unit ? new Quantity(n, unit) : n;
}

function cannot(op: string, a: Value, b: Value): EvalError {
	return new EvalError(`cannot apply \`${op}\` to ${display(a)} and ${display(b)}`);
}

function equal(a: Value, b: Value): boolean {
	if (magnitude(a) !== null && magnitude(b) !== null) {
		try {
			const { x, y } = align('==', a, b);
			return x === y;
		} catch {
			return false;
		}
	}
	const text = (v: Value) => (v instanceof EnumLiteral ? v : typeof v === 'string' ? v : undefined);
	const ta = text(a);
	const tb = text(b);
	if (ta !== undefined && tb !== undefined) {
		if (ta instanceof EnumLiteral && tb instanceof EnumLiteral) return ta.name === tb.name;
		if (ta instanceof EnumLiteral) return tb === ta.name || tb === ta.qualified;
		if (tb instanceof EnumLiteral) return ta === tb.name || ta === tb.qualified;
		return ta === tb;
	}
	return a === b;
}

function binary(op: BinaryOp, a: Value, b: Value): Value {
	const na = magnitude(a);
	const nb = magnitude(b);
	const numbers = na !== null && nb !== null;
	switch (op) {
		case '+':
		case '-':
			if (numbers) {
				const { x, y, unit } = align(op, a, b);
				return withUnit(op === '+' ? x + y : x - y, unit);
			}
			if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
			break;
		case '*':
		case '/':
		case '%': {
			if (!numbers) break;
			if (op !== '*' && nb === 0)
				throw new EvalError(op === '/' ? 'division by zero' : 'modulo by zero');
			const ua = a instanceof Quantity ? a.unit : null;
			const ub = b instanceof Quantity ? b.unit : null;
			if (op === '%') {
				const { x, y, unit } = align(op, a, b);
				return withUnit(x % y, unit);
			}
			const n = op === '*' ? na * nb : na / nb;
			if (!ua || !ub) return withUnit(n, ua ?? (op === '*' ? ub : ub ? `1/${wrap(ub)}` : null));
			return withUnit(n, op === '*' ? `${ua}*${ub}` : `${ua}/${wrap(ub)}`);
		}
		case '**':
			if (!numbers) break;
			if (b instanceof Quantity) break;
			return withUnit(na ** nb, a instanceof Quantity ? `${wrap(a.unit)}^${nb}` : null);
		case '<':
		case '>':
		case '<=':
		case '>=': {
			if (!numbers) break;
			const { x, y } = align(op, a, b);
			return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
		}
		case '==':
			return equal(a, b);
		case '!=':
			return !equal(a, b);
		case 'and':
		case 'or':
		case 'xor':
		case 'implies': {
			const la = asBool(a);
			if (la === null) throw new EvalError(`cannot apply \`${op}\` to ${display(a)}`);
			const lb = asBool(b);
			if (lb === null) throw new EvalError(`cannot apply \`${op}\` to ${display(b)}`);
			return op === 'and'
				? la && lb
				: op === 'or'
					? la || lb
					: op === 'xor'
						? la !== lb
						: !la || lb;
		}
		case '??':
			return a ?? b;
	}
	throw cannot(op, a, b);
}

const wrap = (unit: string) => (/[*/]/.test(unit) ? `(${unit})` : unit);

// ---------------------------------------------------------------- functions

function numberArg(name: string, value: Value): number {
	const n = magnitude(value);
	if (n === null) throw new EvalError(`${name} expects numeric argument, got ${display(value)}`);
	return n;
}

function requireArgs(name: string, args: Value[], expected: number) {
	if (args.length !== expected)
		throw new EvalError(`${name} expects ${expected} argument(s), got ${args.length}`);
}

function requireSome(name: string, args: Value[]) {
	if (!args.length) throw new EvalError(`${name} requires at least 1 argument`);
}

/** The arguments' magnitudes in the first argument's unit, and that unit. */
function numbers(name: string, args: Value[]): { ns: number[]; unit: string | null } {
	const first = args[0];
	const unit = first instanceof Quantity ? first.unit : null;
	const ns = args.map((a, i) => {
		if (i === 0 || !unit || !(a instanceof Quantity)) return numberArg(name, a);
		return align(name, first!, a).y;
	});
	return { ns, unit };
}

function call(name: string, args: Value[]): Value {
	switch (name) {
		case 'abs':
		case 'floor':
		case 'ceil':
		case 'round': {
			requireArgs(name, args, 1);
			const { ns, unit } = numbers(name, args);
			const n = ns[0]!;
			const f = { abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: roundHalfAway }[name];
			return withUnit(f(n), unit);
		}
		case 'sqrt': {
			requireArgs(name, args, 1);
			const n = numberArg(name, args[0]!);
			if (n < 0) throw new EvalError('sqrt of negative number');
			return Math.sqrt(n);
		}
		case 'min':
		case 'max': {
			requireSome(name, args);
			const { ns, unit } = numbers(name, args);
			return withUnit(name === 'min' ? Math.min(...ns) : Math.max(...ns), unit);
		}
		case 'sum': {
			if (!args.length) return 0;
			const { ns, unit } = numbers(name, args);
			return withUnit(
				ns.reduce((a, b) => a + b, 0),
				unit
			);
		}
		case 'product': {
			requireSome(name, args);
			return args.reduce<number>((p, a) => p * numberArg(name, a), 1);
		}
		case 'mean':
		case 'avg': {
			if (!args.length) throw new EvalError('mean requires at least 1 argument');
			const { ns, unit } = numbers(name, args);
			return withUnit(ns.reduce((a, b) => a + b, 0) / ns.length, unit);
		}
		case 'rss': {
			requireSome(name, args);
			const { ns, unit } = numbers(name, args);
			return withUnit(Math.sqrt(ns.reduce((s, n) => s + n * n, 0)), unit);
		}
		case 'count':
			return args.length;
		case 'clamp': {
			requireArgs(name, args, 3);
			const { ns, unit } = numbers(name, args);
			return withUnit(Math.min(Math.max(ns[0]!, ns[1]!), ns[2]!), unit);
		}
		case 'convert': {
			requireArgs(name, args, 3);
			const value = numberArg(name, args[0]!);
			const [from, to] = [args[1], args[2]];
			if (typeof from !== 'string')
				throw new EvalError('convert: second argument must be a unit string');
			if (typeof to !== 'string')
				throw new EvalError('convert: third argument must be a unit string');
			try {
				return convert(value, from, to);
			} catch (error) {
				throw new EvalError((error as Error).message);
			}
		}
	}
	throw new EvalError(`unknown function \`${name}\``);
}

/** Rust's `f64::round`: halves round away from zero. */
function roundHalfAway(n: number): number {
	return Math.sign(n) * Math.round(Math.abs(n));
}

// ---------------------------------------------------------------- evaluation

/** Where names get their values. `undefined` means unbound. */
export interface Scope {
	get(name: string): Value | undefined;
	/** Whether the name is a variable (bound or not), so `X::name` reads it. */
	isVariable?(name: string): boolean;
	/**
	 * A function the evaluator doesn't have (a calculation of the model,
	 * `Rpn(s, o, d)`), by its name as written: its value, or `undefined`
	 * when the scope doesn't know it either.
	 */
	call?(name: string, args: Value[]): Value | undefined;
}

/** The value of a name: a variable, `self.x`, else an enum literal (`Mode::cruise`). */
function lookup(name: string, scope: Scope): Value {
	const direct = scope.get(name);
	if (direct !== undefined) return direct;
	if (name.startsWith('self.')) {
		const inner = scope.get(name.slice(5));
		if (inner !== undefined) return inner;
	}
	if (name.includes('::')) {
		const last = name.split('::').pop()!;
		if (scope.isVariable?.(last)) {
			const value = scope.get(last);
			if (value !== undefined) return value;
			throw new EvalError(`undefined variable \`${last}\``);
		}
		return new EnumLiteral(name);
	}
	throw new EvalError(`undefined variable \`${name}\``);
}

function unbound(name: string, scope: Scope): boolean {
	try {
		lookup(name, scope);
		return false;
	} catch {
		return true;
	}
}

/** Evaluate an expression. Throws `EvalError` with a message for people. */
export function evaluate(expr: Expr, scope: Scope): Value {
	switch (expr.kind) {
		case 'literal':
			return expr.value;
		case 'name':
			return lookup(expr.name, scope);
		case 'unary': {
			const v = evaluate(expr.operand, scope);
			if (expr.op === 'not') {
				const b = asBool(v);
				if (b === null) throw new EvalError(`cannot apply \`not\` to ${display(v)}`);
				return !b;
			}
			const n = magnitude(v);
			if (n === null) throw new EvalError(`cannot apply \`${expr.op}\` to ${display(v)}`);
			return v instanceof Quantity
				? new Quantity(expr.op === '-' ? -n : n, v.unit)
				: expr.op === '-'
					? -n
					: n;
		}
		case 'binary': {
			// `x ?? y` also stands in for a variable that has no value.
			const left =
				expr.op === '??' && expr.left.kind === 'name' && unbound(expr.left.name, scope)
					? null
					: evaluate(expr.left, scope);
			// `and`, `or` and `implies` only evaluate their second operand when needed (KerML).
			if (expr.op === 'and' || expr.op === 'or' || expr.op === 'implies') {
				const b = asBool(left);
				if (b === null) throw new EvalError(`cannot apply \`${expr.op}\` to ${display(left)}`);
				if (expr.op === 'and' && !b) return false;
				if (expr.op === 'or' && b) return true;
				if (expr.op === 'implies' && !b) return true;
			}
			if (expr.op === '??' && left !== null) return left;
			return binary(expr.op, left, evaluate(expr.right, scope));
		}
		case 'call': {
			const args = expr.args.map((a) => evaluate(a, scope));
			const own = scope.call?.(expr.name, args);
			return own !== undefined ? own : call(expr.name.split('::').pop()!, args);
		}
		case 'unit': {
			const v = evaluate(expr.operand, scope);
			if (v instanceof Quantity) {
				try {
					return new Quantity(convert(v.value, v.unit, expr.unit), expr.unit);
				} catch (error) {
					throw new EvalError((error as Error).message);
				}
			}
			const n = magnitude(v);
			if (n === null) throw new EvalError(`cannot give ${display(v)} a unit`);
			return new Quantity(n, expr.unit);
		}
		case 'if': {
			const c = asBool(evaluate(expr.condition, scope));
			if (c === null) throw new EvalError('the condition of `if` is not a Boolean');
			return evaluate(c ? expr.then : expr.else, scope);
		}
	}
}

/** Evaluate a guard or condition, which must give a Boolean (or a number: 0 is false). */
export function evaluateCondition(expr: Expr, scope: Scope): boolean {
	const v = evaluate(expr, scope);
	const b = asBool(v);
	if (b === null) throw new EvalError(`constraint did not evaluate to bool, got ${display(v)}`);
	return b;
}

/** A plain scope over a map. */
export function mapScope(values: Map<string, Value>): Scope {
	return { get: (name) => values.get(name), isVariable: (name) => values.has(name) };
}
