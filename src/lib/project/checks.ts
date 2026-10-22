/**
 * The engine's constraint checks as the app shows them: a violated claim is
 * a problem (a warning at the claim, so Problems and the editor list it with
 * a jump to its line); satisfied and undecided ones are not problems — the
 * checks view lists them. Also the words and values the check views use.
 */
import { formatQuantity, parseLiteral, readable } from '#lib/engine/quantity.ts';
import type { Check, CheckStatus, Diagnostic, Evaluated } from '#lib/engine/types.ts';

/** How a check is named in a sentence: `SYS-001 Flight endurance`, or an assertion's name. */
export function checkTitle(check: Check): string {
	if (check.requirement)
		return [check.requirement.id, check.requirement.name].filter(Boolean).join(' ');
	return check.name ? `${check.name}` : `the assertion \`${check.constraint}\``;
}

export const STATUS_LABEL: Record<CheckStatus, string> = {
	satisfied: 'Satisfied',
	violated: 'Violated',
	undecided: 'Undecided'
};

/** Violated checks as warnings at the claim (the `satisfy`, or the assertion). */
export function checkProblems(checks: readonly Check[]): Diagnostic[] {
	return checks
		.filter((c) => c.status === 'violated')
		.map((c) => {
			if (c.problem)
				return {
					file: c.file,
					span: c.span,
					severity: 'warning',
					code: 'check',
					message: c.problem
				} satisfies Diagnostic;
			const by = c.kind === 'satisfy' && c.by ? ` by ${c.by}` : '';
			const values = c.values
				.filter((v) => v.value.kind === 'number' || v.value.kind === 'text')
				.map((v) => `${v.feature} = ${valueText(v.value)}`)
				.join(', ');
			const limit = c.limit
				? ` (needs ${OPERATOR[c.limit.operator] ?? c.limit.operator} ${formatQuantity(c.limit)})`
				: '';
			const what =
				c.kind === 'assert' ? `${checkTitle(c)} does not hold` : `${checkTitle(c)} is not met${by}`;
			return {
				file: c.file,
				span: c.span,
				severity: 'warning',
				code: 'check',
				message: `${what}${values ? `: ${values}` : ''}${limit}`
			} satisfies Diagnostic;
		});
}

const OPERATOR: Record<string, string> = { '<=': '≤', '>=': '≥', '<': '<', '>': '>', '==': '=' };

/** A value as people read it: `27.54 min`, `1 kg`, `performance`. */
export function valueText(value: Evaluated): string {
	switch (value.kind) {
		case 'number':
			return formatQuantity(readable({ value: value.value, unit: value.unit }));
		case 'text':
			return value.text;
		case 'none':
			return 'no value';
		case 'undecided':
			return 'unknown';
	}
}

/**
 * What an evaluated value adds to its expression as written, or null when it
 * adds nothing: `= 27.54 min` for `HoverEndurance(…)`, nothing for `650 [g]`
 * (unless it reads better in another unit) or `RequirementKind::performance`.
 */
export function computedText(value: Evaluated, expression: string | null): string | null {
	const written = expression?.trim() ?? '';
	switch (value.kind) {
		case 'number': {
			const shown = valueText(value);
			const literal = parseLiteral(written);
			if (literal && literal.value === value.value && (literal.unit ?? null) === value.unit) {
				// `2770 [g]` reads `2.77 kg`: say so; `650 [g]` is already as it reads.
				return shown === formatQuantity(literal) ? null : shown;
			}
			return shown;
		}
		case 'text': {
			const last = written.split('::').pop()?.replace(/^'|'$/g, '');
			return value.text === written || value.text === last ? null : value.text;
		}
		case 'none':
			return null;
		case 'undecided':
			return written ? '?' : null;
	}
}
