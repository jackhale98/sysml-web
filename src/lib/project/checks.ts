/**
 * The engine's constraint checks as the app shows them: a violated claim is
 * a problem (a warning at the claim, so Problems and the editor list it with
 * a jump to its line). An undecided check is one too when the person can do
 * something about it: a warning when the model's values make it impossible
 * (a division by zero), a note when a value or a claim isn't given yet.
 * Satisfied ones are not problems — the checks view lists them. Also the
 * words and values the check views use, and what a check's values come from.
 */
import { formatQuantity, parseLiteral, readable } from '#lib/engine/quantity.ts';
import type { Check, CheckStatus, CheckValue, Diagnostic, Evaluated } from '#lib/engine/types.ts';

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

/**
 * Violated checks as warnings at the claim (the `satisfy`, or the assertion),
 * and undecided ones the person can act on: a warning when the model's values
 * make the check impossible, a note when something is not given yet.
 */
export function checkProblems(checks: readonly Check[]): Diagnostic[] {
	return [...violatedProblems(checks), ...undecidedProblems(checks)];
}

function violatedProblems(checks: readonly Check[]): Diagnostic[] {
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
				c.kind === 'assert'
					? `${checkTitle(c)}${assertedFor(c)} does not hold${c.assertedIn && c.by ? ` for ${c.by}` : ''}`
					: `${checkTitle(c)} is not met${by}`;
			return {
				file: c.file,
				span: c.span,
				severity: 'warning',
				code: 'check',
				message: `${what}${values ? `: ${values}` : ''}${limit}`
			} satisfies Diagnostic;
		});
}

/** Undecided checks as problems, with why: warnings for faults of the model's values, else notes. */
function undecidedProblems(checks: readonly Check[]): Diagnostic[] {
	return checks
		.filter((c) => c.status === 'undecided' && c.checkable && c.undecided)
		.map((c) => {
			const fault = c.undecided === 'fault';
			const by = c.by ? ` for ${c.by}` : '';
			const why =
				c.kind === 'require'
					? 'nothing in the design claims to satisfy it'
					: lowerFirst(c.explanation.replace(/\.$/, ''));
			return {
				file: c.file,
				span: c.span,
				severity: fault ? 'warning' : 'note',
				code: 'check',
				message: `${checkTitle(c)}${assertedFor(c)} can't be decided${fault ? '' : ' yet'}${by}: ${why}`
			} satisfies Diagnostic;
		});
}

/** ` (asserted in Arm)` for a definition's assertion checked for one of its parts. */
const assertedFor = (c: Check) => (c.assertedIn ? ` (asserted in ${c.assertedIn})` : '');

const lowerFirst = (text: string) =>
	/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;

const OPERATOR: Record<string, string> = { '<=': '≤', '>=': '≥', '<': '<', '>': '>', '==': '=' };

/**
 * What a check's values come from, in a sentence each: `drone.endurance =
 * HoverEndurance(battery.usableEnergy, hoverPower), with
 * battery.usableEnergy = 183.6 W·h (capacity * usableFraction in Battery,
 * with …) and hoverPower = 400 W`. Values given as they are say where
 * they are written when that is elsewhere (`default in HeavyArm`); empty
 * when no value is worked out or given anywhere the check can show.
 */
export function inputsText(check: Check): string {
	return check.values
		.filter((v) => v.from)
		.map((v) => `${v.feature} = ${sourceText(v)}`)
		.join('. ');
}

function sourceText(v: CheckValue): string {
	const from = v.from!;
	const where = from.writtenIn
		? `${from.isDefault ? 'default ' : ''}in ${from.writtenIn}`
		: from.isDefault
			? 'default'
			: '';
	if (!from.inputs.length) {
		// A value given as it is: what it reads as, and where it is written when that matters.
		const shown = valueText(v.value);
		const given = shown === from.expression || v.value.kind !== 'number' ? from.expression : shown;
		return where ? `${given} (${where})` : given;
	}
	const inputs = from.inputs.map((i) => `${i.feature} = ${inputText(i)}`);
	const list =
		inputs.length > 1
			? `${inputs.slice(0, -1).join(', ')} and ${inputs[inputs.length - 1]}`
			: inputs[0];
	return `${from.expression}${from.writtenIn ? ` in ${from.writtenIn}` : ''}, with ${list}`;
}

/** An input: its value, and in brackets what it comes from when it is worked out. */
function inputText(v: CheckValue): string {
	const value = valueText(v.value);
	if (!v.from) return value;
	const from = v.from;
	if (!from.inputs.length)
		return from.writtenIn
			? `${value} (${from.isDefault ? 'default ' : ''}in ${from.writtenIn})`
			: value;
	return `${value} (${sourceText(v)})`;
}

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
