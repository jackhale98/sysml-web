/**
 * What depends on a requirement (or a risk control, which is one): what
 * satisfies it (a part of the design, a mitigation), the verification
 * cases that verify it, the requirements derived from it, and the FMEA
 * lines whose `riskControls` name it. The review names them for a changed
 * requirement; the related panel lists an FMEA line's element both ways.
 */
import type { Dependant } from '#lib/review/types.ts';
import type { ElementRecord } from '../model';
import type { Annotation, ViewContext } from './context';
import { isA } from './hazards';
import { derivedInto } from './rows';
import { isFmeaLine, writtenNames } from './riskLines';
import { displayValue, unquoteName } from './text';

const MITIGATION = 'RiskAnalysis::Mitigation';

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

/** `@Fmea about drone::battery { … }` → `drone.battery`: the element as a feature path. */
function aboutOf(ctx: ViewContext, a: Annotation): string {
	const target = a.target_id ? ctx.byId.get(a.target_id) : undefined;
	if (!target) return a.target;
	const names: string[] = [];
	for (let at: ElementRecord | undefined = target; at;) {
		if (at.isDefinition || at.kind === 'package' || !at.name) break;
		names.unshift(unquoteName(at.name));
		at = at.ownerId ? ctx.byId.get(at.ownerId) : undefined;
	}
	return names.join('.') || unquoteName(target.name ?? a.target);
}

export interface FmeaReference {
	/** The element the line is about. */
	about: string;
	/** A risk control, a mitigation or the hazard the line names. */
	named: string;
	field: 'riskControls' | 'mitigations' | 'hazard';
}

/** Each FMEA line's references: from the element it is about to what it names. */
export function fmeaReferences(ctx: ViewContext): FmeaReference[] {
	const out: FmeaReference[] = [];
	for (const a of ctx.annotations) {
		if (!ctx.content.has(a.path) || !isFmeaLine(a) || !a.target_id) continue;
		for (const field of ['riskControls', 'mitigations', 'hazard'] as const)
			for (const r of named(ctx, a, field))
				if (r.id !== a.target_id) out.push({ about: a.target_id, named: r.id, field });
	}
	return out;
}

/** How a requirement is named: `RC-001` ‘Battery thermal protection’'s parts, for a sentence. */
const requirementLabel = (r: ElementRecord) =>
	r.shortName ? unquoteName(r.shortName) : unquoteName(r.name ?? '');

/** What depends on each of the project's requirements, by its element id. */
export function dependantsOf(ctx: ViewContext): Record<string, Dependant[]> {
	const out: Record<string, Dependant[]> = {};
	const add = (requirement: string | null | undefined, d: Dependant) => {
		if (!requirement) return;
		const list = (out[requirement] ??= []);
		if (!list.some((x) => x.kind === d.kind && x.id === d.id && x.label === d.label)) list.push(d);
	};
	for (const link of ctx.satisfactions) {
		if (!ctx.content.has(link.path)) continue;
		const by = link.by_id ? ctx.byId.get(link.by_id) : undefined;
		const mitigation = !!by && isA(ctx, by.id, MITIGATION);
		add(link.requirement_id, {
			kind: mitigation ? 'mitigation' : 'satisfier',
			id: link.by_id ?? null,
			label: link.by
		});
	}
	for (const link of ctx.verifications) {
		if (!ctx.content.has(link.path)) continue;
		add(link.requirement_id, { kind: 'verification', id: link.by_id ?? null, label: link.by });
	}
	for (const [original, derived] of derivedInto(ctx))
		for (const id of derived) {
			const r = ctx.byId.get(id);
			if (r && ctx.content.has(r.path))
				add(original, { kind: 'derived', id, label: requirementLabel(r) });
		}
	for (const a of ctx.annotations) {
		if (!ctx.content.has(a.path) || !isFmeaLine(a)) continue;
		const mode = a.values.find(([k]) => k === 'failureMode')?.[1];
		const label = `${aboutOf(ctx, a)}${mode ? ` ‘${displayValue(mode)}’` : ''}`;
		for (const control of named(ctx, a, 'riskControls'))
			add(control.id, { kind: 'fmea', id: a.target_id ?? null, label });
	}
	return out;
}
