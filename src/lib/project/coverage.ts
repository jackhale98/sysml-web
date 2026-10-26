/**
 * The coverage rule, one for everywhere coverage is shown: the home view's
 * rings and gaps, the requirement tables (`satisfied`, `verified`, the
 * Requirement gaps view) and the specification report.
 *
 * A requirement is **satisfied** when something in the design satisfies it
 * (`satisfy R by x`), or when it has been derived into other requirements
 * and every one of them is satisfied, by this same rule. **Verified** is the
 * same with `verify`. **Passed** is the same with verification results: every
 * verification case that verifies it has a recorded passing result that
 * still holds for the model as it is (`verification.ts`). A circle of
 * derivations covers nothing by itself.
 */
import { outcomeOf, type RecordedResult, type RevisionInfo } from './verification';

/** How a requirement is covered: by its own links, through all it is derived into, or not. */
export type Covered = 'direct' | 'derived' | null;

/**
 * The rule, for each of `items`: covered directly, or through every item it
 * is derived into. A derivation whose end doesn't resolve (`null`) is never
 * covered, so a need whose derived requirement went missing isn't covered
 * by the ones left.
 */
export function coverageRule<T>(
	items: readonly T[],
	direct: (item: T) => boolean,
	derivedInto: (item: T) => readonly (T | null)[]
): Map<T, Covered> {
	const memo = new Map<T, boolean>();
	const through = (item: T, path: Set<T>): boolean => {
		const known = memo.get(item);
		if (known !== undefined) return known;
		if (direct(item)) return true;
		const children = derivedInto(item).filter((c) => !path.has(c as T));
		const result =
			children.length > 0 && children.every((c) => c !== null && through(c, new Set([...path, c])));
		// Only an answer reached without cutting a circle short holds for every path.
		if (children.length === derivedInto(item).length) memo.set(item, result);
		return result;
	};
	return new Map(
		items.map((item) => [
			item,
			direct(item) ? 'direct' : through(item, new Set([item])) ? 'derived' : null
		])
	);
}

/** The rule in words, for help and reports. */
export const COVERAGE_RULE =
	'A requirement counts as satisfied when something in the design satisfies it, or when every requirement derived from it is satisfied; verified and passed count the same way.';

/** The figures of the rule over a set of requirements. */
export interface CoverageFigures {
	total: number;
	satisfied: number;
	verified: number;
	/** Verified, and every verifying case's result is a pass that still holds. */
	passed: number;
}

interface Covering {
	key: string;
	satisfied: Covered;
	verified: Covered;
	/** By `key`; a key no row has is a derivation whose end doesn't resolve. */
	derivedInto: string[];
	results: readonly (RecordedResult | null)[];
}

/**
 * Whether each requirement passed, by the rule: every case that verifies it
 * passed and the result still holds (`outcomeOf`), or every requirement
 * derived from it passed.
 */
export function passedRule<T extends Covering>(
	rows: readonly T[],
	revision: RevisionInfo | null
): Map<T, Covered> {
	const byKey = new Map(rows.map((r) => [r.key, r]));
	return coverageRule(
		rows,
		(r) => outcomeOf(r.results, revision) === 'passed',
		(r) => r.derivedInto.map((k) => byKey.get(k) ?? null)
	);
}

/** Total, satisfied, verified and passed, each by the rule. */
export function coverageFigures<T extends Covering>(
	rows: readonly T[],
	revision: RevisionInfo | null
): CoverageFigures {
	const passed = passedRule(rows, revision);
	return {
		total: rows.length,
		satisfied: rows.filter((r) => r.satisfied).length,
		verified: rows.filter((r) => r.verified).length,
		passed: rows.filter((r) => passed.get(r)).length
	};
}
