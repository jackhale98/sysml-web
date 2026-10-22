/**
 * Hazard analysis read from the model, by the conventions of the
 * `HazardAnalysis` library: occurrences typed by `Hazard`,
 * `HazardousSituation` and `Harm`, linked from cause to effect by
 * connections typed by `Causation`; a harm's `severity` is a `SeverityScale`
 * literal whose value is its place on the FMEA severity scale; a
 * `RiskControl` requirement names the hazard it controls in its `hazard`.
 *
 * - The `hazards` row provider (the `HazardLog` view): one row per hazard
 *   with the situations and harms it leads to, the worst harm's severity,
 *   its controls and what satisfies and verifies them.
 * - The FMEA cross-check: an `@Fmea` line whose `hazard` leads to harms
 *   should have the worst harm's value as its `severity`.
 */
import { connectionEnds, isReference, type ElementRecord } from '../model';
import type { Annotation, ViewContext } from './context';
import type { Row } from './rows';
import { collapseWhitespace, displayValue, parseNumber, unquote } from './text';
import type { ValueProblem } from './assertions';

const HAZARD = 'HazardAnalysis::Hazard';
const SITUATION = 'HazardAnalysis::HazardousSituation';
const HARM = 'HazardAnalysis::Harm';
const CAUSATION = 'HazardAnalysis::Causation';
const CONTROL = 'HazardAnalysis::RiskControl';

interface HazardModel {
	/** The effects of each risk event, through Causation connections. */
	effects: Map<string, string[]>;
	is: (id: string, definition: string) => boolean;
}

const models = new WeakMap<ViewContext, HazardModel>();

/** The library's definition, by qualified name, else by simple name. */
function definition(ctx: ViewContext, qualified: string): string | null {
	const found = ctx.records.find((r) => r.isDefinition && r.qualifiedName === qualified);
	return found?.id ?? ctx.definitionNamed(qualified);
}

function model(ctx: ViewContext): HazardModel {
	let m = models.get(ctx);
	if (m) return m;
	const defs = new Map<string, string | null>();
	const defOf = (q: string) => {
		if (!defs.has(q)) defs.set(q, definition(ctx, q));
		return defs.get(q)!;
	};
	const is = (id: string, q: string) => {
		const target = defOf(q);
		const record = ctx.byId.get(id);
		const type = record?.isDefinition ? record.id : record?.typeIds[0];
		return !!target && !!type && ctx.conforms(type, target);
	};
	const effects = new Map<string, string[]>();
	for (const c of ctx.records) {
		if (c.metaclass !== 'ConnectionUsage' || !c.typeIds[0] || !is(c.id, CAUSATION)) continue;
		const ends = connectionEnds(c.header);
		if (!ends) continue;
		const [cause, effect] = ends.map((e) => ctx.resolveIn(c.id, e));
		if (!cause || !effect) continue;
		const list = effects.get(cause) ?? [];
		if (!list.includes(effect)) list.push(effect);
		effects.set(cause, list);
	}
	m = { effects, is };
	models.set(ctx, m);
	return m;
}

/** Everything a risk event leads to, through Causation, nearest first. */
function downstream(ctx: ViewContext, id: string): string[] {
	const { effects } = model(ctx);
	const out: string[] = [];
	const queue = [...(effects.get(id) ?? [])];
	while (queue.length && out.length < 256) {
		const next = queue.shift()!;
		if (next === id || out.includes(next)) continue;
		out.push(next);
		queue.push(...(effects.get(next) ?? []));
	}
	return out;
}

/** A harm's severity: its `SeverityScale` literal and that literal's value. */
export function harmSeverity(
	ctx: ViewContext,
	harm: ElementRecord
): { literal: string; value: number } | null {
	const own = valueIn(ctx, harm, 'severity');
	if (!own) return null;
	const n = parseNumber(own.value);
	if (n !== null) return { literal: own.value, value: n };
	const id = ctx.resolveIn(own.at.id, own.value);
	const literal = id ? ctx.byId.get(id) : undefined;
	const value = literal?.value ? parseNumber(literal.value) : null;
	return value === null ? null : { literal: literal?.name ?? displayValue(own.value), value };
}

/** Whether an element is (typed by) a definition of the libraries, by qualified name: `HazardAnalysis::RiskControl`. */
export function isA(ctx: ViewContext, id: string, qualified: string): boolean {
	return model(ctx).is(id, qualified);
}

/** A feature's value as an element gives it, or its type does: `:>> severity = …`. */
export function valueIn(
	ctx: ViewContext,
	element: ElementRecord,
	name: string
): { value: string; at: ElementRecord } | null {
	const sources = [element.id, ...ctx.supers(element.id)];
	for (const s of sources) {
		const found = ctx.ownedBy(s).find((r) => r.name === name && r.value !== null);
		if (found) return { value: found.value!, at: found };
	}
	return null;
}

/** The harms a hazard leads to, worst first, with their severity. */
export function harmsOf(
	ctx: ViewContext,
	hazardId: string
): { harm: ElementRecord; severity: { literal: string; value: number } | null }[] {
	const { is } = model(ctx);
	return downstream(ctx, hazardId)
		.filter((id) => is(id, HARM))
		.map((id) => ctx.byId.get(id)!)
		.filter(Boolean)
		.map((harm) => ({ harm, severity: harmSeverity(ctx, harm) }))
		.sort((a, b) => (b.severity?.value ?? -1) - (a.severity?.value ?? -1));
}

/** The hazard an annotation's `hazard` names, if it resolves to one. */
export function hazardOfLine(ctx: ViewContext, a: Annotation): ElementRecord | undefined {
	const written = a.values.find(([k]) => k === 'hazard')?.[1];
	if (!written || !a.record) return undefined;
	const id = ctx.resolveIn(a.record.ownerId ?? a.record.id, written.trim());
	const record = id ? ctx.byId.get(id) : undefined;
	return record && model(ctx).is(record.id, HAZARD) ? record : undefined;
}

/**
 * An FMEA line's severity against its hazard: when the hazard leads to
 * harms with a severity, the line's severity should be the worst of them.
 */
export function severityProblem(ctx: ViewContext, a: Annotation): ValueProblem | null {
	const written = a.values.find(([k]) => k === 'severity')?.[1];
	const severity = written !== undefined ? parseNumber(written) : null;
	if (severity === null) return null;
	const hazard = hazardOfLine(ctx, a);
	if (!hazard) return null;
	const worst = harmsOf(ctx, hazard.id).find((h) => h.severity);
	if (!worst?.severity || worst.severity.value === severity) return null;
	const harmName = worst.harm.name ?? 'a harm';
	return {
		field: 'severity',
		value: written!,
		message: `Severity is ${severity}, but its hazard ${hazard.name} can lead to ${harmName}, which is ${worst.severity.literal} (${worst.severity.value}).`,
		rule: `severity = ${worst.severity.value}`,
		ruleName: null,
		at: a.record ? ctx.ownedBy(a.record.id).find((r) => r.name === 'severity') : undefined,
		number: severity
	};
}

// --- The hazard log --------------------------------------------------------------

/** One row per hazard of the project, with its causal chain and its controls. */
export function hazardRows(ctx: ViewContext): Row[] {
	const { is } = model(ctx);
	const controls = ctx.records.filter(
		(r) => !r.isDefinition && r.kind === 'requirement' && !!r.name && is(r.id, CONTROL)
	);
	const controlsOf = new Map<string, ElementRecord[]>();
	for (const control of controls) {
		const written = ctx.ownedBy(control.id).find((r) => r.name === 'hazard')?.value;
		const id = written ? ctx.resolveIn(control.id, written.trim()) : null;
		if (!id) continue;
		const list = controlsOf.get(id) ?? [];
		list.push(control);
		controlsOf.set(id, list);
	}
	const linesOf = new Map<string, string[]>();
	for (const a of ctx.annotations) {
		if (!ctx.content.has(a.path)) continue;
		const hazard = hazardOfLine(ctx, a);
		const mode = a.values.find(([k]) => k === 'failureMode')?.[1];
		if (!hazard || !mode) continue;
		const list = linesOf.get(hazard.id) ?? [];
		list.push(displayValue(mode));
		linesOf.set(hazard.id, list);
	}
	const linksOf = (links: typeof ctx.satisfactions, ids: Set<string>) => {
		const out: string[] = [];
		for (const l of links)
			if (l.requirement_id && ids.has(l.requirement_id) && l.by && !out.includes(l.by))
				out.push(l.by);
		return out;
	};
	const label = (r: ElementRecord) => r.name ?? r.written ?? '';
	const rows: Row[] = [];
	for (const h of ctx.records) {
		if (!ctx.isContent(h) || h.isDefinition || !h.name || isReference(h) || !is(h.id, HAZARD))
			continue;
		const after = downstream(ctx, h.id)
			.map((id) => ctx.byId.get(id)!)
			.filter(Boolean);
		const harms = harmsOf(ctx, h.id);
		const worst = harms.find((x) => x.severity)?.severity ?? null;
		const own = controlsOf.get(h.id) ?? [];
		const ids = new Set(own.map((c) => c.id));
		const description = valueIn(ctx, h, 'description')?.value;
		const fields: [string, string][] = [
			['element', label(h)],
			['description', description ? unquote(description) : collapseWhitespace(h.docs.join(' '))],
			['type', h.typeIds[0] ? (ctx.nameOf(h.typeIds[0]) ?? '') : ''],
			[
				'situations',
				after
					.filter((r) => is(r.id, SITUATION))
					.map(label)
					.join(', ')
			],
			['harms', harms.map((x) => label(x.harm)).join(', ')],
			['severity', worst?.literal ?? ''],
			['severityValue', worst ? String(worst.value) : ''],
			[
				'controls',
				own.map((c) => (c.shortName ? `${c.shortName} ${c.name}` : (c.name ?? ''))).join(', ')
			],
			['satisfiedBy', linksOf(ctx.satisfactions, ids).join(', ')],
			['verifiedBy', linksOf(ctx.verifications, ids).join(', ')],
			['failureModes', (linesOf.get(h.id) ?? []).join(', ')],
			['parent', h.parentId ? label(ctx.byId.get(h.parentId) ?? h) : ''],
			['file', h.path],
			['line', String(h.span.start_row)]
		];
		rows.push({
			fields: new Map(fields),
			anchors: [h.id],
			element: h.qualifiedName ?? '',
			typeId: h.typeIds[0] ?? null
		});
	}
	return rows;
}
