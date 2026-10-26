/**
 * Values in metadata that their type rejects. A metadata field is declared
 * with a type (`attribute severity : FmeaRating;`); when that type asserts
 * constraints (`assert constraint inRange { that >= 1 and that <= 10 }`),
 * every value an annotation gives the field must meet them. The toolkit
 * doesn't evaluate metadata values, so the constraints are evaluated here
 * with `that` bound to the value: `severity = 14` is flagged, from the
 * library's own constraint rather than a range the app knows. A type that
 * is an `Integer` (or specializes it) takes whole numbers only: a rating of
 * 5.5 is flagged too.
 */
import { EvalError, ParseError, evaluate, mapScope, parseExpr, type Value } from '#lib/sim/expr.ts';
import type { ElementRecord } from '../model';
import type { Annotation, ViewContext } from './context';
import {
	declaredFeature,
	holds,
	isWholeType,
	metadataDefinition,
	typeDomain,
	typeInvariants
} from './domains';
import { displayValue } from './text';

/** What is wrong with one value of an annotation. */
export interface ValueProblem {
	field: string;
	/** The value as written. */
	value: string;
	/** In plain words, for the cell and the problems list. */
	message: string;
	/** The rule it breaks, as written (`that >= 1 and that <= 10`). */
	rule: string;
	/** Its name, when it has one (`inRange`). */
	ruleName: string | null;
	/** Where the value is written: the field's member of the annotation. */
	at: ElementRecord | undefined;
	/** The value evaluated, when it is a number. */
	number: number | null;
}

/** The values of an annotation that their declared types reject. */
export function valueProblems(ctx: ViewContext, a: Annotation): ValueProblem[] {
	const def = metadataDefinition(ctx, a.metadata_qualified_type ?? a.metadata_type);
	if (!def) return [];
	const out: ValueProblem[] = [];
	for (const [field, written] of a.values) {
		const type = declaredFeature(ctx, def, field)?.typeIds[0];
		if (!type) continue;
		const invariants = typeInvariants(ctx, type);
		// A rating of 5.5 where the type is an Integer: not a value of the type.
		const whole = isWholeType(ctx, type);
		if (!invariants.length && !whole) continue;
		const value = valueOf(written);
		if (value === null) continue;
		const fraction = whole && typeof value === 'number' && !Number.isInteger(value);
		const broken = fraction ? null : invariants.find((i) => holds(i.expr, value) === false);
		if (!fraction && !broken) continue;
		const domain = typeDomain(ctx, type);
		const shown = displayValue(written);
		const words = fieldWords(field);
		const scale =
			domain?.numeric && isRun(domain.values)
				? `the scale of ${domain.values[0]} to ${domain.values[domain.values.length - 1]}`
				: null;
		const range = fraction
			? `not a whole number${scale ? ` on ${scale}` : ''}`
			: scale
				? `outside ${scale}`
				: `against the rule \`${broken!.text}\` of ${broken!.owner}`;
		out.push({
			field,
			value: written,
			message: `${sentence(words)} is ${shown}, ${range}.`,
			rule: fraction ? 'a whole number' : broken!.text,
			ruleName: fraction ? null : broken!.name,
			at: a.record ? ctx.ownedBy(a.record.id).find((r) => r.name === field) : undefined,
			number: typeof value === 'number' ? value : null
		});
	}
	return out;
}

/** A value as written, evaluated on its own (`14`, `-2`, `"text"`), or null. */
export function valueOf(written: string): Value | null {
	try {
		return evaluate(parseExpr(written), mapScope(new Map()));
	} catch (error) {
		if (error instanceof EvalError || error instanceof ParseError) return null;
		throw error;
	}
}

/** `initialSeverity` → `initial severity`. */
export function fieldWords(field: string): string {
	return field
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/_/g, ' ')
		.toLowerCase();
}

const sentence = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** Whether whole numbers follow one another without a gap. */
function isRun(values: string[]): boolean {
	return values.every((v, i) => i === 0 || Number(v) === Number(values[i - 1]) + 1);
}
