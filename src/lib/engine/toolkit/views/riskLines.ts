/**
 * FMEA lines and the risk policy, read from the model by the conventions
 * of the `RiskAnalysis` library:
 *
 * - A line's `riskControls` name `HazardAnalysis::RiskControl`
 *   requirements; whether each is satisfied and verified is ordinary
 *   `satisfy` and `verify` traceability. Its `mitigations` name
 *   `Mitigation` actions; the mitigations that satisfy its controls count
 *   too, with their `status`.
 * - The library's calcs judge a line: `Acceptability(severity,
 *   likelihood)` (the organisation's risk policy) and
 *   `ActionPriority(severity, likelihood, detection)`. A line in the
 *   unacceptable zone, and a line of high priority or unacceptable risk
 *   without a verified control, are problems: flagged in their cells and
 *   listed as checks.
 * - The policy itself (`riskPolicy`): the zone of every severity and
 *   likelihood, the thresholds of `RpnBand`, and which figure the
 *   worksheets sort by first.
 */
import { EnumLiteral, EvalError } from '#lib/sim/expr.ts';
import type { Value } from '#lib/sim/expr.ts';
import type { FmeaLineInfo, Levels, LineControl, LineMitigation, RiskPolicy } from '../../types';
import type { ElementRecord } from '../model';
import type { ValueProblem } from './assertions';
import { tableSpec } from './catalog';
import type { Annotation, ViewContext } from './context';
import { declaredFeature, metadataDefinition, typeDomain } from './domains';
import { isA, valueIn } from './hazards';
import { displayValue, formatNumber, parseNumber, simpleName, unquoteName } from './text';

const CONTROL = 'HazardAnalysis::RiskControl';
const MITIGATION = 'RiskAnalysis::Mitigation';

/** The levels of the fields this module adds to a line, lowest (or least done) first. */
export const CONTROL_STATUS = ['none', 'open', 'implemented', 'verified'];

/** Whether an annotation is an FMEA line (`@Fmea`, the library's metadata def). */
export function isFmeaLine(a: Annotation): boolean {
	return unquoteName(simpleName(a.metadata_type)) === 'Fmea';
}

/** `'RC-001'` → [`'RC-001'`]; `(a, 'b, c')` → [`a`, `'b, c'`]: the names a reference list is written with. */
export function writtenNames(value: string): string[] {
	const v = value.trim();
	const inner = v.startsWith('(') && v.endsWith(')') ? v.slice(1, -1) : v;
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i]!;
		if (c === '\\' && quoted) {
			current += c + (inner[i + 1] ?? '');
			i++;
			continue;
		}
		if (c === "'") quoted = !quoted;
		if (c === ',' && !quoted) {
			out.push(current.trim());
			current = '';
			continue;
		}
		current += c;
	}
	out.push(current.trim());
	return out.filter(Boolean);
}

/** The elements a line's reference field names, resolved from where the line is written. */
function named(ctx: ViewContext, a: Annotation, field: string): ElementRecord[] {
	const written = a.values.find(([k]) => k === field)?.[1];
	if (!written || !a.record) return [];
	const out: ElementRecord[] = [];
	for (const name of writtenNames(written)) {
		const id =
			ctx.resolveIn(a.record.id, name) ??
			(a.record.ownerId ? ctx.resolveIn(a.record.ownerId, name) : null);
		const record = id ? ctx.byId.get(id) : undefined;
		if (record && !out.includes(record)) out.push(record);
	}
	return out;
}

/** What satisfies and what verifies each requirement, as written in the links. */
function traceOf(ctx: ViewContext): {
	satisfiedBy: Map<string, string[]>;
	verifiedBy: Map<string, string[]>;
	implementers: Map<string, string[]>;
} {
	let cached = traces.get(ctx);
	if (cached) return cached;
	const by = (links: typeof ctx.satisfactions) => {
		const map = new Map<string, string[]>();
		for (const l of links) {
			if (!l.requirement_id || !l.by) continue;
			const list = map.get(l.requirement_id) ?? [];
			if (!list.includes(l.by)) list.push(l.by);
			map.set(l.requirement_id, list);
		}
		return map;
	};
	const implementers = new Map<string, string[]>();
	for (const l of ctx.satisfactions) {
		if (!l.requirement_id || !l.by_id) continue;
		const list = implementers.get(l.requirement_id) ?? [];
		if (!list.includes(l.by_id)) list.push(l.by_id);
		implementers.set(l.requirement_id, list);
	}
	cached = {
		satisfiedBy: by(ctx.satisfactions),
		verifiedBy: by(ctx.verifications),
		implementers
	};
	traces.set(ctx, cached);
	return cached;
}
const traces = new WeakMap<ViewContext, ReturnType<typeof traceOf>>();

/** A mitigation's `status` literal, as it or its type gives it. */
function statusOf(ctx: ViewContext, action: ElementRecord): string {
	const own = valueIn(ctx, action, 'status')?.value;
	if (own) return displayValue(own);
	const type = action.typeIds[0];
	const declared = type ? declaredFeature(ctx, type, 'status') : undefined;
	return declared?.value ? displayValue(declared.value) : '';
}

/** The literals of `Mitigation::status`, least done first. */
function mitigationLevels(ctx: ViewContext): string[] | null {
	const def = ctx.records.find(
		(r) => r.isDefinition && r.qualifiedName === MITIGATION && r.kind === 'action'
	);
	const id = def?.id ?? ctx.definitionNamed('Mitigation');
	const status = id ? declaredFeature(ctx, id, 'status') : undefined;
	const domain = status?.typeIds[0] ? typeDomain(ctx, status.typeIds[0]) : null;
	return domain && !domain.numeric ? domain.values : null;
}

export interface LineRisk {
	controls: LineControl[];
	mitigations: LineMitigation[];
	/** `none`, `open` (a control nothing implements yet), `implemented` (all, not all verified), `verified`. */
	controlStatus: string;
	/** The least done of its mitigations' statuses, or ''. */
	mitigationStatus: string;
}

/** A line's risk controls and mitigations, with their traceability and status. */
export function lineRisk(ctx: ViewContext, a: Annotation): LineRisk {
	const { satisfiedBy, verifiedBy, implementers } = traceOf(ctx);
	const controls = named(ctx, a, 'riskControls').filter((r) => isA(ctx, r.id, CONTROL));
	const lineControls: LineControl[] = controls.map((c) => ({
		label: c.shortName ? `${c.shortName} ${c.name ?? ''}`.trim() : (c.name ?? ''),
		element: c.qualifiedName ?? '',
		satisfiedBy: satisfiedBy.get(c.id) ?? [],
		verifiedBy: verifiedBy.get(c.id) ?? []
	}));
	const mitigations: LineMitigation[] = [];
	const add = (record: ElementRecord, isNamed: boolean) => {
		if (mitigations.some((m) => m.element === record.qualifiedName)) return;
		mitigations.push({
			name: record.name ?? '',
			element: record.qualifiedName ?? '',
			status: statusOf(ctx, record),
			named: isNamed
		});
	};
	for (const m of named(ctx, a, 'mitigations')) if (isA(ctx, m.id, MITIGATION)) add(m, true);
	for (const c of controls)
		for (const id of implementers.get(c.id) ?? []) {
			const record = ctx.byId.get(id);
			if (record && isA(ctx, record.id, MITIGATION)) add(record, false);
		}
	const controlStatus = !lineControls.length
		? 'none'
		: lineControls.some((c) => !c.satisfiedBy.length)
			? 'open'
			: lineControls.every((c) => c.verifiedBy.length)
				? 'verified'
				: 'implemented';
	const levels = mitigationLevels(ctx) ?? [];
	const statuses = mitigations.map((m) => m.status).filter(Boolean);
	const least = statuses.sort((x, y) => levels.indexOf(x) - levels.indexOf(y))[0] ?? '';
	return { controls: lineControls, mitigations, controlStatus, mitigationStatus: least };
}

/** A rating of the line, as a number, or null. */
function rating(a: Annotation, field: string): number | null {
	const written = a.values.find(([k]) => k === field)?.[1];
	return written === undefined ? null : parseNumber(written);
}

/** A library calc's result for the line, by the literal's name (or the number), or ''. */
function judged(ctx: ViewContext, calc: string, args: (number | null)[]): string {
	if (args.some((x) => x === null) || !ctx.calcs.has(calc)) return '';
	try {
		const value: Value | undefined = ctx.calcs.call(calc, args as number[]);
		if (value instanceof EnumLiteral) return value.name;
		if (typeof value === 'number') return formatNumber(value);
		return typeof value === 'string' ? value : '';
	} catch (error) {
		if (error instanceof EvalError) return '';
		throw error;
	}
}

/**
 * What a line breaks of the risk rules: its risk is in the policy's
 * unacceptable zone, or it is of high priority or unacceptable risk and no
 * control of it is verified.
 */
export function riskProblems(ctx: ViewContext, a: Annotation): ValueProblem[] {
	if (!isFmeaLine(a)) return [];
	const [s, l, d] = ['severity', 'likelihood', 'detection'].map((f) => rating(a, f));
	const acceptability = judged(ctx, 'Acceptability', [s ?? null, l ?? null]);
	const priority = judged(ctx, 'ActionPriority', [s ?? null, l ?? null, d ?? null]);
	const out: ValueProblem[] = [];
	const member = (field: string) =>
		a.record ? ctx.ownedBy(a.record.id).find((r) => r.name === field) : undefined;
	if (acceptability === 'unacceptable')
		out.push({
			field: 'acceptability',
			value: acceptability,
			message: `The risk is unacceptable by the risk policy (severity ${s}, likelihood ${l}): reduce it before release.`,
			rule: 'Acceptability(severity, likelihood) != RiskAcceptability::unacceptable',
			ruleName: null,
			at: member('likelihood'),
			number: null
		});
	if (acceptability === 'unacceptable' || priority === 'high') {
		const { controls } = lineRisk(ctx, a);
		if (!controls.some((c) => c.verifiedBy.length)) {
			const why = priority === 'high' ? 'Its action priority is high' : 'Its risk is unacceptable';
			const what = controls.length
				? 'none of its risk controls is verified yet'
				: 'no risk control addresses it';
			out.push({
				field: 'riskControls',
				value: '',
				message: `${why} and ${what}: link a risk control and verify it.`,
				rule: 'a verified risk control',
				ruleName: null,
				at: member('riskControls'),
				number: null
			});
		}
	}
	return out;
}

/** The fields a line's row gets from its controls and mitigations. */
export function riskFields(ctx: ViewContext, a: Annotation): [string, string][] {
	const risk = lineRisk(ctx, a);
	return [
		['riskControls', risk.controls.map((c) => c.label).join(', ')],
		['controlStatus', risk.controlStatus],
		['mitigations', risk.mitigations.map((m) => m.name).join(', ')],
		['mitigationStatus', risk.mitigationStatus]
	];
}

/** The levels of a field this module adds, for sorting and filtering. */
export function riskFieldLevels(ctx: ViewContext, field: string): Levels | null {
	if (field === 'controlStatus') return { enum: '', values: CONTROL_STATUS };
	const statuses = field === 'mitigationStatus' ? mitigationLevels(ctx) : null;
	return statuses ? { enum: 'MitigationStatus', values: statuses } : null;
}

/** The FMEA lines about an element (by its id), with their figures and controls. */
export function fmeaLines(ctx: ViewContext, id: string): FmeaLineInfo[] {
	const out: FmeaLineInfo[] = [];
	for (const a of ctx.annotations) {
		if (!ctx.content.has(a.path) || !isFmeaLine(a) || a.target_id !== id) continue;
		const text = (field: string) => {
			const v = a.values.find(([k]) => k === field)?.[1];
			return v === undefined ? '' : displayValue(v);
		};
		const [s, l, d] = ['severity', 'likelihood', 'detection'].map((f) => rating(a, f));
		const [s0, l0, d0] = ['initialSeverity', 'initialLikelihood', 'initialDetection'].map((f) =>
			rating(a, f)
		);
		const risk = lineRisk(ctx, a);
		const rpn = judged(ctx, 'Rpn', [s ?? null, l ?? null, d ?? null]);
		const problems = riskProblems(ctx, a);
		out.push({
			file: a.path,
			line: a.span.start_row,
			failureMode: text('failureMode'),
			category: text('category') || defaultCategory(ctx, a),
			severity: text('severity'),
			likelihood: text('likelihood'),
			detection: text('detection'),
			before:
				s0 !== null && l0 !== null && d0 !== null
					? {
							severity: text('initialSeverity'),
							likelihood: text('initialLikelihood'),
							detection: text('initialDetection')
						}
					: null,
			rpn,
			rpnBand: rpn ? judged(ctx, 'RpnBand', [Number(rpn)]) : '',
			actionPriority: judged(ctx, 'ActionPriority', [s ?? null, l ?? null, d ?? null]),
			acceptability: judged(ctx, 'Acceptability', [s ?? null, l ?? null]),
			acceptabilityBefore: judged(ctx, 'Acceptability', [s0 ?? null, l0 ?? null]),
			hazard: text('hazard'),
			controls: risk.controls,
			mitigations: risk.mitigations,
			review: problems.find((p) => p.field === 'riskControls')?.message ?? null
		});
	}
	return out;
}

/** The category a line leaves out: the metadata def's default. */
function defaultCategory(ctx: ViewContext, a: Annotation): string {
	const def = metadataDefinition(ctx, a.metadata_qualified_type ?? a.metadata_type);
	const declared = def ? declaredFeature(ctx, def, 'category') : undefined;
	return declared?.value ? displayValue(declared.value) : '';
}

/** The risk policy the project's risk library states. */
export function riskPolicy(ctx: ViewContext): RiskPolicy {
	const zones = ctx.calcs.has('Acceptability')
		? Array.from({ length: 10 }, (_, s) =>
				Array.from({ length: 10 }, (_, l) => judged(ctx, 'Acceptability', [s + 1, l + 1]))
			)
		: null;
	const band = ctx.calcs.record('RpnBand');
	const bands = band
		? ctx
				.ownedBy(band.id)
				.filter((m) => m.name && /From$/.test(m.name) && m.direction !== 'in' && m.value !== null)
				.flatMap((m) => {
					const value = parseNumber(m.value!);
					return value === null
						? []
						: [{ name: m.name!, level: m.name!.replace(/From$/, ''), value }];
				})
		: [];
	const worksheet =
		ctx.records.find(
			(r) => r.metaclass === 'ViewDefinition' && r.name === 'FmeaWorksheet' && ctx.isContent(r)
		) ?? ctx.records.find((r) => r.metaclass === 'ViewDefinition' && r.name === 'FmeaWorksheet');
	const sortBy = worksheet ? tableSpec(ctx, worksheet)?.get('sortBy') : undefined;
	const first = sortBy?.split(';')[0]?.trim().replace(/^-/, '');
	return {
		zones,
		zoneLevels: ctx.calcs.returnLevels('Acceptability')?.values ?? [],
		bands,
		bandLevels: ctx.calcs.returnLevels('RpnBand')?.values ?? [],
		lead: !worksheet ? null : first === 'actionPriority' ? 'actionPriority' : 'rpn'
	};
}
