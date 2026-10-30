/**
 * The reliability budget (`reliability:<attribute>`, the `Reliability`
 * library's `ReliabilityBudget`): a budget of failure rates over the parts
 * tree (`budget.ts`), each row with its mean time between failures, MTBF =
 * 1 / its total failure rate (its parts in series), and, for a part that
 * satisfies a `ReliabilityRequirement`, the requirement's limit, the
 * margin and the verdict.
 *
 * A reliability requirement states its limits as values
 * (`maximumFailureRate`, `minimumMtbf`), not as a constraint, because the
 * system's failure rate is the budget's sum, which no attribute of the
 * model holds. So the app decides the claim (`satisfy R by drone`) itself,
 * from the budget, and the verdict is the claim's check: in Problems when
 * violated, and in the requirements and checks tables.
 */
import { convert, formatQuantity, readable, type Quantity } from '../../quantity';
import type { Check, CheckStatus, ColumnKind } from '../../types';
import type { ElementRecord } from '../model';
import { budgetRows, fieldKinds, percent, symbolOf } from './budget';
import type { Link, ViewContext } from './context';
import { isA } from './hazards';
import type { Row } from './rows';

const REQUIREMENT = 'Reliability::ReliabilityRequirement';

/** The attribute a reliability requirement is about. */
const FAILURE_RATE = 'failureRate';

interface Verdict {
	link: Link;
	requirement: ElementRecord;
	byId: string;
	status: CheckStatus;
	/** The system's failure rate, the budget's total for it. */
	total: Quantity | null;
	mtbfHours: number | null;
	/** The limit shown (the tighter of the two when both are given). */
	limit: {
		feature: 'failureRate' | 'mtbf';
		operator: '<=' | '>=';
		value: number;
		unit: string;
	} | null;
	margin: { value: number; unit: string; ratio: number } | null;
	explanation: string;
}

const verdicts = new WeakMap<ViewContext, Verdict[]>();

/** How the fields of a reliability budget read: a budget's, and the MTBF. */
export function reliabilityFieldKinds(spec: string): Record<string, ColumnKind> {
	if (!spec.startsWith('reliability:')) return {};
	return { ...fieldKinds(`budget:${spec.slice(12)}`), mtbf: 'quantity' };
}

/** A budget of failure rates, with each row's MTBF and the reliability requirements it meets. */
export function reliabilityRows(ctx: ViewContext, attribute: string): Row[] {
	const rows = budgetRows(ctx, attribute, false);
	const decided = reliabilityVerdicts(ctx);
	for (const row of rows) {
		const perHour = row.total ? perHourOf(row.total) : null;
		row.fields.set(
			'mtbf',
			perHour ? formatQuantity(readable({ value: 1 / perHour, unit: 'h' })) : ''
		);
		const id = row.chain?.[row.chain.length - 1];
		const v = decided.find((d) => d.byId === id && row.info?.role !== 'attribute');
		row.fields.set(
			'limit',
			v?.limit ? `${symbolOf(v.limit.operator)} ${formatQuantity(v.limit)}` : ''
		);
		row.fields.set(
			'margin',
			v?.margin ? `${formatQuantity(v.margin)} (${percent(v.margin.ratio)})` : ''
		);
		row.fields.set('check', v?.status ?? '');
		row.fields.set('requirement', v ? (v.requirement.shortName ?? v.requirement.name ?? '') : '');
		if (v && !v.margin) {
			row.info ??= {};
			row.info.notes = { ...row.info.notes, margin: v.explanation };
		}
	}
	return rows;
}

/** A failure rate per hour, or null when it isn't an inverse time. */
function perHourOf(q: Quantity): number | null {
	return q.unit ? convert(q.value, q.unit, 'h^-1') : null;
}

/** Each `satisfy` of a ReliabilityRequirement, decided from the failure rate budget. */
function reliabilityVerdicts(ctx: ViewContext): Verdict[] {
	const known = verdicts.get(ctx);
	if (known) return known;
	const out: Verdict[] = [];
	const links = ctx.satisfactions.filter(
		(l) =>
			ctx.content.has(l.path) &&
			l.requirement_id &&
			l.by_id &&
			isA(ctx, l.requirement_id, REQUIREMENT)
	);
	const rows = links.length ? budgetRows(ctx, FAILURE_RATE, false) : [];
	for (const link of links) {
		const requirement = ctx.byId.get(link.requirement_id!);
		if (!requirement) continue;
		out.push(decide(ctx, link, requirement, rows));
	}
	verdicts.set(ctx, out);
	return out;
}

function decide(ctx: ViewContext, link: Link, requirement: ElementRecord, rows: Row[]): Verdict {
	const byId = link.by_id!;
	const by = link.by;
	const row = rows.find(
		(r) => r.chain?.[r.chain.length - 1] === byId && r.info?.role !== 'attribute'
	);
	const undecided = (explanation: string): Verdict => ({
		link,
		requirement,
		byId,
		status: 'undecided',
		total: row?.total ?? null,
		mtbfHours: null,
		limit: null,
		margin: null,
		explanation
	});
	const total = row?.total ?? null;
	if (!total)
		return undecided(
			`\`${by}\` has no failure rate in the reliability budget: none of its parts has one`
		);
	const perHour = perHourOf(total);
	if (perHour === null || perHour <= 0)
		return undecided(
			`\`${by}\`'s failure rates add up to ${formatQuantity(total)}, which is not a rate per unit of time`
		);
	const mtbfHours = 1 / perHour;
	const value = (name: string): Quantity | null => {
		const v = requirement.qualifiedName
			? ctx.evaluation?.valueFor(requirement.qualifiedName, name)
			: null;
		return v?.kind === 'number' && v.unit ? { value: v.value, unit: v.unit } : null;
	};
	const candidates: (NonNullable<Verdict['limit']> & { margin: NonNullable<Verdict['margin']> })[] =
		[];
	const maxRate = value('maximumFailureRate');
	if (maxRate) {
		const rate = convert(perHour, 'h^-1', maxRate.unit!);
		if (rate !== null)
			candidates.push({
				feature: 'failureRate',
				operator: '<=',
				value: maxRate.value,
				unit: maxRate.unit!,
				margin: {
					value: maxRate.value - rate,
					unit: maxRate.unit!,
					ratio: (maxRate.value - rate) / maxRate.value
				}
			});
	}
	const minMtbf = value('minimumMtbf');
	if (minMtbf) {
		const mtbf = convert(mtbfHours, 'h', minMtbf.unit!);
		if (mtbf !== null)
			candidates.push({
				feature: 'mtbf',
				operator: '>=',
				value: minMtbf.value,
				unit: minMtbf.unit!,
				margin: {
					value: mtbf - minMtbf.value,
					unit: minMtbf.unit!,
					ratio: (mtbf - minMtbf.value) / minMtbf.value
				}
			});
	}
	if (!candidates.length)
		return undecided(
			`${requirement.name ?? 'the requirement'} gives neither a maximumFailureRate nor a minimumMtbf (as a rate per unit of time and a time)`
		);
	const tightest = candidates.reduce((a, b) => (b.margin.ratio < a.margin.ratio ? b : a));
	const { margin, ...limit } = tightest;
	const status: CheckStatus = candidates.every((c) => c.margin.value >= 0)
		? 'satisfied'
		: 'violated';
	const mtbf = formatQuantity(readable({ value: mtbfHours, unit: 'h' }));
	const asked = candidates
		.map(
			(c) =>
				`${c.feature === 'mtbf' ? 'an MTBF' : 'a failure rate'} ${symbolOf(c.operator)} ${formatQuantity(c)}`
		)
		.join(' and ');
	const explanation = `\`${by}\`'s parts' failure rates add up to ${formatQuantity(total)} in series, an MTBF of ${mtbf}; it asks for ${asked}.`;
	return { link, requirement, byId, status, total, mtbfHours, limit, margin, explanation };
}

/**
 * The claims of reliability requirements, decided from the budget. Each
 * stands for the toolkit's check of the same `satisfy` (a requirement
 * without a constraint, which it can't decide): see `Evaluation.checks`.
 */
export function reliabilityChecks(ctx: ViewContext): Check[] {
	return reliabilityVerdicts(ctx).map((v) => {
		const requirement = {
			name: v.requirement.name ?? '',
			qualifiedName: v.requirement.qualifiedName ?? '',
			id: v.requirement.shortName,
			elementId: v.requirement.id
		};
		const title = [requirement.id, requirement.name].filter(Boolean).join(' ');
		const check: Check = {
			kind: 'satisfy',
			status: v.status,
			checkable: true,
			detail: v.explanation,
			explanation: v.explanation,
			requirement,
			by: v.link.by,
			constraint: v.limit
				? `${v.link.by}.${v.limit.feature} ${v.limit.operator} ${formatQuantity(v.limit)}`
				: '',
			name: null,
			values: v.mtbfHours
				? [
						{
							feature: `${v.link.by}.mtbf`,
							value: { kind: 'number', value: v.mtbfHours, unit: 'h' }
						}
					]
				: [],
			file: v.link.path,
			span: v.link.span
		};
		if (v.limit)
			check.limit = {
				feature: `${v.link.by}.${v.limit.feature}`,
				operator: v.limit.operator,
				value: v.limit.value,
				unit: v.limit.unit
			};
		if (v.margin) check.margin = v.margin;
		if (v.status === 'undecided') check.undecided = 'open';
		if (v.status === 'violated')
			check.problem = `${title} is not met by ${v.link.by}: ${v.explanation.replace(/\.$/, '')}.`;
		return check;
	});
}
