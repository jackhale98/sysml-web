/**
 * "New trade study": alternatives compared on criteria, written in the
 * form of the demo's battery study (`analysis/BatteryTrade.sysml`), which
 * the engine's trade-study evaluation reads (`engine/toolkit/trade.ts`):
 *
 * - the study is an `analysis` typed by `TradeStudies::TradeStudy`, its
 *   `subject` lists the alternatives and its objective is a
 *   `MaximizeObjective` (the highest score wins);
 * - its evaluation function's `in` parameter is the alternative and its
 *   attributes are the criteria (`attribute mass : MassValue = motor.mass`);
 * - the score is a calculation of the criteria, a weighted sum of each
 *   criterion scored from 0 (worst) to 1 (best) over the range the
 *   alternatives span (`(2 [kg] - mass) / 0.8 [kg]`), the weights adding up
 *   to 1, so the engine shows each criterion's weight, its direction and
 *   its score before weighting;
 * - a cut-off ("must be at most …") scores an alternative that breaks it 0
 *   (`if mass > 1.4 [kg] ? 0.0 else …`, as the demo's mass margin does).
 *
 * Alternatives that are definitions (`part def SmallMotor :> Motor`) become
 * the variants of a variation (`variation part motorOptions : Motor {
 * variant part smallMotor : SmallMotor; }`), so each is a part the study
 * can evaluate.
 */
import {
	docComment,
	name as sysmlName,
	numberText,
	quantityText,
	readableNumber,
	readableUnit,
	words
} from './sysml';

export type Better = 'higher' | 'lower';

export interface CriterionSpec {
	/** The alternatives' attribute (unquoted). */
	attribute: string;
	/** Its value type's simple name (`MassValue`, `Real`), when known. */
	valueType: string | null;
	better: Better;
	/** Relative weight (a percentage, normalised over the criteria). */
	weight: number;
	/** The value that scores 0, and the one that scores 1, in `unit`. */
	worst: number;
	best: number;
	unit: string | null;
	cutoff: { kind: 'atMost' | 'atLeast'; value: number; unit: string | null } | null;
}

export interface TradeSpec {
	/** The new package (and file) the study is written in. */
	packageName: string;
	/** The analysis's name. */
	study: string;
	/** The question the study answers (its doc). */
	question: string;
	/** What the alternatives are, spelled in the package (`Battery`). */
	kind: string;
	/** The alternatives, spelled in the package (`drone.battery`, `motorOptions::small`). */
	alternatives: string[];
	/** Definitions compared, as the variants of a variation written in the package. */
	variation: { name: string; variants: { name: string; type: string }[] } | null;
	/** The evaluation function's parameter (the alternative). */
	parameter: string;
	criteria: CriterionSpec[];
	/** Elements and libraries to import (qualified), besides what the criteria need. */
	imports: string[];
}

/** Weights as fractions with two decimals that add up to exactly 1 (equal when all are 0). */
export function normaliseWeights(weights: readonly number[]): number[] {
	if (!weights.length) return [];
	const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
	const total = clean.reduce((a, b) => a + b, 0);
	const raw = total > 0 ? clean.map((w) => w / total) : clean.map(() => 1 / clean.length);
	const cents = raw.map((r) => Math.round(r * 100));
	const diff = 100 - cents.reduce((a, b) => a + b, 0);
	if (diff) {
		// Put the rounding on the largest weight.
		const i = cents.indexOf(Math.max(...cents));
		cents[i]! += diff;
	}
	return cents.map((c) => c / 100);
}

/** The type spelled for a criterion (`MassValue`, `Real`), or null to leave it untyped. */
function typeOf(valueType: string | null): string | null {
	if (!valueType) return null;
	return valueType;
}

const real = (v: number, unit: string | null) =>
	unit ? quantityText(v, unit) : numberText(v, true);

/** The library imports the study's text needs. */
export function tradeImports(spec: TradeSpec): string[] {
	const out = ['ScalarValues::Real', 'TradeStudies::*'];
	const types = spec.criteria.map((c) => typeOf(c.valueType));
	if (types.some((t) => t && t.endsWith('Value'))) out.push('ISQ::*');
	for (const t of ['Integer', 'Natural', 'Rational', 'Positive'])
		if (types.includes(t)) out.push(`ScalarValues::${t}`);
	if (spec.criteria.some((c) => c.unit || c.cutoff?.unit)) out.push('SI::*');
	return [...new Set([...out, ...spec.imports])];
}

/** The scoring calculation's name: `MotorChoiceScore`. */
export const scoreName = (spec: TradeSpec) => `${spec.packageName.replace(/^'|'$/g, '')}Score`;

/** The study's package, file text and all. */
export function tradeStudyText(spec: TradeSpec): string {
	const weights = normaliseWeights(spec.criteria.map((c) => c.weight));
	const names = spec.criteria.map((c) => sysmlName(c.attribute));
	const lines: string[] = [];
	const push = (indent: number, text = '') =>
		lines.push(text ? `${'    '.repeat(indent)}${text}` : '');

	push(0, `package ${sysmlName(spec.packageName)} {`);
	push(1, docComment(spec.question || `Which ${words(spec.kind)} is best?`));
	push(0);
	for (const i of tradeImports(spec)) push(1, `private import ${i};`);
	push(0);

	if (spec.variation) {
		push(1, '// The candidates: each a part of its own kind, so the study can compare them.');
		push(1, `variation part ${sysmlName(spec.variation.name)} : ${spec.kind} {`);
		for (const v of spec.variation.variants)
			push(2, `variant part ${sysmlName(v.name)} : ${v.type};`);
		push(1, '}');
		push(0);
	}

	// The score.
	const share = spec.criteria
		.map((c, i) => `${words(c.attribute)} ${Math.round(weights[i]! * 100)} %`)
		.join(', ');
	const cutoffs = spec.criteria.filter((c) => c.cutoff);
	const cutoffWords = cutoffs
		.map(
			(c) =>
				`${words(c.attribute)} ${c.cutoff!.kind === 'atMost' ? 'over' : 'under'} ${readableNumber(c.cutoff!.value)}${c.cutoff!.unit ? ` ${readableUnit(c.cutoff!.unit)}` : ''}`
		)
		.join(' or ');
	push(1, `calc def ${sysmlName(scoreName(spec))} {`);
	push(
		2,
		docComment(
			`Each criterion is scored from 0 (worst) to 1 (best) and weighted: ${share}.` +
				(cutoffs.length ? ` An alternative with a ${cutoffWords} scores 0.` : '')
		)
	);
	spec.criteria.forEach((c, i) => {
		const type = typeOf(c.valueType);
		push(2, `in ${names[i]}${type ? ` : ${type}` : ''};`);
	});
	const scores = spec.criteria.map((c) => sysmlName(`${c.attribute}Score`));
	spec.criteria.forEach((c, i) => {
		const x = names[i]!;
		const worst = real(c.worst, c.unit);
		const range = real(Math.abs(c.best - c.worst), c.unit);
		const expr =
			c.better === 'higher' ? `(${x} - ${worst}) / ${range}` : `(${worst} - ${x}) / ${range}`;
		const unit = c.unit ? ` ${readableUnit(c.unit)}` : '';
		push(
			2,
			`attribute ${scores[i]} : Real = ${expr};  // ${readableNumber(c.worst)}${unit}: 0, ${readableNumber(c.best)}${unit}: 1`
		);
	});
	const sum = spec.criteria.map((_, i) => `${numberText(weights[i]!)} * ${scores[i]}`).join(' + ');
	const conditions = spec.criteria
		.map((c, i) =>
			c.cutoff
				? `${names[i]} ${c.cutoff.kind === 'atMost' ? '>' : '<'} ${real(c.cutoff.value, c.cutoff.unit)}`
				: null
		)
		.filter((x): x is string => !!x);
	push(
		2,
		`return score : Real = ${conditions.length ? `if ${conditions.join(' or ')} ? 0.0 else ` : ''}${sum};`
	);
	push(1, '}');
	push(0);

	// The study.
	push(1, `analysis ${sysmlName(spec.study)} : TradeStudy {`);
	push(2, docComment(spec.question || `Which ${words(spec.kind)} is best?`));
	push(
		2,
		`subject : ${spec.kind}[${spec.alternatives.length}] = (${spec.alternatives.join(', ')});`
	);
	push(2, 'objective : MaximizeObjective;');
	push(0);
	push(2, 'calc :>> evaluationFunction {');
	push(3, `in part ${sysmlName(spec.parameter)} :>> alternative : ${spec.kind};`);
	spec.criteria.forEach((c, i) => {
		const type = typeOf(c.valueType);
		push(
			3,
			`attribute ${names[i]}${type ? ` : ${type}` : ''} = ${sysmlName(spec.parameter)}.${names[i]};`
		);
	});
	push(3, `return :>> result : Real = ${sysmlName(scoreName(spec))}(${names.join(', ')});`);
	push(2, '}');
	push(0);
	push(2, `return part :>> selectedAlternative : ${spec.kind};`);
	push(1, '}');
	push(0, '}');
	return lines.join('\n') + '\n';
}

/** The comparison table: `view motorChoice : TradeStudyTable { expose MotorChoice::motorChoiceStudy; }`. */
export function tradeViewText(
	view: string,
	definition: string,
	study: string,
	doc: string
): string {
	return [
		`view ${sysmlName(view)} : ${definition} {`,
		...(doc.trim() ? [`    ${docComment(doc)}`] : []),
		`    expose ${study};`,
		'}'
	].join('\n');
}

/** A guess of which way is better, from the name: less mass, cost, power, … is better. */
export function guessBetter(attribute: string): Better {
	return /mass|weight|cost|price|power|draw|loss|drag|noise|time|duration|delay|latency|volume|size|temperature|risk|consumption|current/i.test(
		attribute
	) && !/range|endurance|life|capacity|margin|efficiency|speed|thrust|reliability/i.test(attribute)
		? 'lower'
		: 'higher';
}

/**
 * The scoring range from the alternatives' values: the worst and best of
 * them (in their unit), or null when they don't differ.
 */
export function rangeOf(
	values: readonly (number | null)[],
	better: Better
): { worst: number; best: number } | null {
	const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
	if (known.length < 2) return null;
	const lo = Math.min(...known);
	const hi = Math.max(...known);
	if (lo === hi) return null;
	return better === 'higher' ? { worst: lo, best: hi } : { worst: hi, best: lo };
}

/** What is wrong with the study, in plain words, or null. */
export function tradeProblem(spec: {
	alternatives: number;
	criteria: { attribute: string; weight: number; worst: number; best: number }[];
	name: string;
	taken: boolean;
}): string | null {
	if (spec.alternatives < 2) return 'Choose at least two alternatives to compare.';
	if (!spec.criteria.length) return 'Choose at least one criterion to compare them on.';
	for (const c of spec.criteria) {
		if (!Number.isFinite(c.worst) || !Number.isFinite(c.best))
			return `Give the range of ${words(c.attribute)} that scores from 0 to 1.`;
		if (c.worst === c.best)
			return `The alternatives all have the same ${words(c.attribute)}, so it can’t tell them apart: leave it out, or give it a range.`;
	}
	if (spec.criteria.every((c) => !(c.weight > 0)))
		return 'Give at least one criterion some weight.';
	if (!spec.name.trim()) return 'Give the study a name.';
	if (spec.taken)
		return `There is already something called “${spec.name.trim()}”. Choose another name.`;
	return null;
}
