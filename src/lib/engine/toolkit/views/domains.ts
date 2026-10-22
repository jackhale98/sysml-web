/**
 * What the model says a field's values may be, from the type it is
 * declared with: an enum's literals, or the whole numbers an attribute
 * def's asserted constraints allow (`attribute def FmeaRating :> Integer {
 * assert constraint { that >= 1 and that <= 10 } }` allows 1 to 10). A
 * pivot shows every value of such a field, and a value its type's
 * constraints reject is a problem (`assertions.ts`).
 */
import {
	EvalError,
	ParseError,
	evaluateCondition,
	mapScope,
	parseExpr,
	type Expr,
	type Value
} from '#lib/sim/expr.ts';
import type { ElementRecord } from '../model';
import type { ViewContext } from './context';
import { simpleName, unquoteName } from './text';

export interface Domain {
	/** Every value, in order: numbers ascending, an enum's literals as declared. */
	values: string[];
	numeric: boolean;
}

/** An asserted constraint of a type, with its expression read. */
export interface Invariant {
	/** Its name (`inRange`), or null. */
	name: string | null;
	/** The expression as written (`that >= 1 and that <= 10`). */
	text: string;
	expr: Expr;
	/** The type that asserts it (`FmeaRating`). */
	owner: string;
}

const INTEGER = new Set(['Integer', 'Natural', 'Positive']);
/** Whole numbers tried to find what a type's constraints allow. */
const WINDOW = 1000;
/** A scale with more values than this is not shown value by value. */
const MAX_VALUES = 100;

const domains = new WeakMap<ViewContext, Map<string, Domain | null>>();
const invariantsOf = new WeakMap<ViewContext, Map<string, Invariant[]>>();

/** The values a field of the rows may take, when its type bounds them. */
export function fieldDomain(ctx: ViewContext, rowsSpec: string, field: string): Domain | null {
	const type = fieldType(ctx, rowsSpec, field);
	return type ? typeDomain(ctx, type) : null;
}

/** The type a field of the rows is declared with: a metadata def's attribute, or a definition's. */
export function fieldType(ctx: ViewContext, rowsSpec: string, field: string): string | null {
	const owner = rowsSpec.startsWith('@')
		? metadataDefinition(ctx, rowsSpec.slice(1).trim())
		: rowsSpec.startsWith('type:')
			? ctx.definitionNamed(rowsSpec.slice(5).trim())
			: null;
	return owner ? (declaredFeature(ctx, owner, field)?.typeIds[0] ?? null) : null;
}

/** The metadata def an annotation type names (`Fmea`, `RiskAnalysis::Fmea`). */
export function metadataDefinition(ctx: ViewContext, meta: string): string | null {
	const simple = unquoteName(simpleName(meta));
	const used = ctx.annotations.find(
		(a) => unquoteName(simpleName(a.metadata_type)) === simple && a.metadata_qualified_type
	)?.metadata_qualified_type;
	const found = ctx.records.find(
		(r) =>
			r.metaclass === 'MetadataDefinition' &&
			r.name === simple &&
			(!used || r.qualifiedName === used)
	);
	return found?.id ?? ctx.definitionNamed(used ?? meta);
}

/** The feature `name` a definition declares, or inherits from what it specializes. */
export function declaredFeature(
	ctx: ViewContext,
	typeId: string,
	name: string
): ElementRecord | undefined {
	for (const t of [typeId, ...ctx.supers(typeId)]) {
		const found = ctx.ownedBy(t).find((r) => r.name === name && !r.isDefinition);
		if (found) return found;
	}
	return undefined;
}

/** The values a type allows, when it bounds them: an enum's literals, or a small range of whole numbers. */
export function typeDomain(ctx: ViewContext, typeId: string): Domain | null {
	let cache = domains.get(ctx);
	if (!cache) domains.set(ctx, (cache = new Map()));
	if (cache.has(typeId)) return cache.get(typeId)!;
	let domain: Domain | null = null;
	const record = ctx.byId.get(typeId);
	if (record?.metaclass === 'EnumerationDefinition') {
		const values = ctx
			.ownedBy(typeId)
			.filter((r) => r.metaclass === 'EnumerationUsage' && r.name)
			.map((r) => r.name!);
		domain = values.length ? { values, numeric: false } : null;
	} else if (record && isWhole(ctx, record)) {
		const invariants = typeInvariants(ctx, typeId);
		if (invariants.length) {
			const allowed: number[] = [];
			for (let v = -WINDOW; v <= WINDOW && allowed.length <= MAX_VALUES; v++)
				if (invariants.every((i) => holds(i.expr, v) === true)) allowed.push(v);
			const bounded =
				allowed.length > 0 &&
				allowed.length <= MAX_VALUES &&
				allowed[0] !== -WINDOW &&
				allowed[allowed.length - 1] !== WINDOW;
			domain = bounded ? { values: allowed.map(String), numeric: true } : null;
		}
	}
	cache.set(typeId, domain);
	return domain;
}

/** The asserted constraints of a type and of what it specializes. */
export function typeInvariants(ctx: ViewContext, typeId: string): Invariant[] {
	let cache = invariantsOf.get(ctx);
	if (!cache) invariantsOf.set(ctx, (cache = new Map()));
	const cached = cache.get(typeId);
	if (cached) return cached;
	const out: Invariant[] = [];
	for (const t of [typeId, ...ctx.supers(typeId)]) {
		const owner = ctx.byId.get(t);
		for (const c of ctx.ownedBy(t)) {
			if (c.metaclass !== 'AssertConstraintUsage') continue;
			const text = constraintBody(ctx.textOf(c));
			const expr = text ? parse(text) : null;
			if (text && expr) out.push({ name: c.name, text, expr, owner: owner?.name ?? '' });
		}
	}
	cache.set(typeId, out);
	return out;
}

/** Whether a value meets an invariant: true, false, or null when it can't be told. */
export function holds(expr: Expr, value: Value): boolean | null {
	try {
		return evaluateCondition(expr, mapScope(new Map([['that', value]])));
	} catch (error) {
		if (error instanceof EvalError) return null;
		throw error;
	}
}

/** Whether a definition's values are whole numbers (it specializes `Integer`). */
function isWhole(ctx: ViewContext, record: ElementRecord): boolean {
	const seen = new Set<string>();
	const queue: ElementRecord[] = [record];
	while (queue.length) {
		const at = queue.shift()!;
		if (seen.has(at.id)) continue;
		seen.add(at.id);
		if (at.specializes.some((w) => INTEGER.has(unquoteName(simpleName(w))))) return true;
		for (const g of ctx.generalsOf(at)) {
			const next = ctx.byId.get(g);
			if (next) queue.push(next);
		}
	}
	return false;
}

/** `assert constraint inRange { that >= 1 }` → `that >= 1` (its doc and comments left out). */
function constraintBody(text: string): string | null {
	const open = text.indexOf('{');
	const close = text.lastIndexOf('}');
	if (open < 0 || close <= open) return null;
	const body = text
		.slice(open + 1, close)
		.replace(/\bdoc\s*\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, ' ')
		.trim();
	return body || null;
}

function parse(source: string): Expr | null {
	try {
		return parseExpr(source);
	} catch (error) {
		if (error instanceof ParseError) return null;
		throw error;
	}
}
