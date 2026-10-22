/**
 * The model's calculations, for table columns and checks: a column
 * `rpn = Rpn(severity, likelihood, detection)` invokes the calc def `Rpn`
 * of the model. Its `in` parameters are bound to the arguments in order,
 * its attributes with a value are its local values, and its result
 * expression is evaluated with the expression language (`sim/expr.ts`),
 * which reads SysML's own expression syntax (`if c ? a else b`, enum
 * literals). A calc it invokes is evaluated the same way. An argument its
 * parameter's type rejects (a rating of 14 where 1 to 10 is asserted)
 * leaves the result undecided.
 *
 * Calcs are found by name among the project's elements and the libraries
 * in its session (`Rpn`, or qualified: `RiskAnalysis::Rpn`); those of the
 * standard library are not.
 */
import {
	EvalError,
	ParseError,
	evaluate,
	parseExpr,
	type Expr,
	type Scope
} from '#lib/sim/expr.ts';
import type { Value } from '#lib/sim/expr.ts';
import type { Levels } from '../../types';
import type { ElementRecord } from '../model';
import type { ViewContext } from './context';
import { holds, typeDomain, typeInvariants, type Invariant } from './domains';
import { splitPath } from './text';

interface Calc {
	params: string[];
	/** Per parameter, the asserted constraints of its type (an FmeaRating is 1 to 10). */
	checks: Invariant[][];
	locals: Map<string, Expr>;
	result: Expr;
}

/** Deeper than this, a calc invoking calcs is taken for a loop. */
const MAX_DEPTH = 16;

export class ModelCalcs {
	private readonly ctx: ViewContext;
	private readonly cache = new Map<string, Calc | null>();

	constructor(ctx: ViewContext) {
		this.ctx = ctx;
	}

	/** Whether the model has a calc def by this name. */
	has(name: string): boolean {
		return !!this.calc(name);
	}

	/** The value of `name(args)`, or `undefined` when the model has no such calc. Throws `EvalError`. */
	call(name: string, args: Value[], depth = 0): Value | undefined {
		const calc = this.calc(name);
		if (!calc) return undefined;
		if (depth > MAX_DEPTH) throw new EvalError(`\`${name}\` invokes itself`);
		if (args.length !== calc.params.length)
			throw new EvalError(`${name} expects ${calc.params.length} argument(s), got ${args.length}`);
		calc.params.forEach((p, i) => {
			const broken = calc.checks[i]!.find((c) => holds(c.expr, args[i]!) === false);
			if (broken) throw new EvalError(`${p} is not a ${broken.owner}`);
		});
		const values = new Map<string, Value>(calc.params.map((p, i) => [p, args[i]!]));
		const evaluating = new Set<string>();
		const scope: Scope = {
			get: (n) => {
				if (values.has(n)) return values.get(n);
				const local = calc.locals.get(n);
				if (!local || evaluating.has(n)) return undefined;
				evaluating.add(n);
				const v = evaluate(local, scope);
				values.set(n, v);
				return v;
			},
			isVariable: (n) => values.has(n) || calc.locals.has(n),
			call: (n, a) => this.call(n, a, depth + 1)
		};
		return evaluate(calc.result, scope);
	}

	/** The calc def named `name`, if the model has one. */
	record(name: string): ElementRecord | undefined {
		return this.find(name);
	}

	/** The enum a calc returns and its literals, in order (`ActionPriority`: low, medium, high), or null. */
	returnLevels(name: string): Levels | null {
		const record = this.find(name);
		const result = record
			? this.ctx.ownedBy(record.id).find((m) => m.kind === 'return')
			: undefined;
		const type = result?.typeIds[0];
		const domain = type ? typeDomain(this.ctx, type) : null;
		return domain && !domain.numeric
			? { enum: this.ctx.byId.get(type!)?.name ?? '', values: domain.values }
			: null;
	}

	/** A scope's `call`: the model's calcs. */
	get hook(): (name: string, args: Value[]) => Value | undefined {
		return (name, args) => this.call(name, args);
	}

	private calc(name: string): Calc | null {
		const cached = this.cache.get(name);
		if (cached !== undefined) return cached;
		const record = this.find(name);
		const calc = record ? this.read(record) : null;
		this.cache.set(name, calc);
		return calc;
	}

	private find(name: string): ElementRecord | undefined {
		const path = splitPath(name);
		const simple = path[path.length - 1];
		if (!simple) return undefined;
		const candidates = this.ctx.records.filter(
			(r) => r.metaclass === 'CalculationDefinition' && r.name === simple
		);
		if (path.length === 1) return candidates[0];
		return candidates.find((r) => {
			const q = splitPath(r.qualifiedName ?? '');
			return path.every((s, i) => q[q.length - path.length + i] === s);
		});
	}

	private read(record: ElementRecord): Calc | null {
		const params: string[] = [];
		const checks: Invariant[][] = [];
		const locals = new Map<string, Expr>();
		let result: Expr | null = null;
		for (const member of this.ctx.ownedBy(record.id)) {
			if (member.kind === 'return') {
				result = member.value ? parse(member.value) : null;
				continue;
			}
			if (!member.name) continue;
			if (member.direction === 'in') {
				params.push(member.name);
				checks.push(member.typeIds[0] ? typeInvariants(this.ctx, member.typeIds[0]) : []);
			} else if (member.value !== null) {
				const expr = parse(member.value);
				if (expr) locals.set(member.name, expr);
			}
		}
		return result ? { params, checks, locals, result } : null;
	}
}

function parse(source: string): Expr | null {
	try {
		return parseExpr(source);
	} catch (error) {
		if (error instanceof ParseError) return null;
		throw error;
	}
}
