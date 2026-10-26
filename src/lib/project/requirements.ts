/**
 * Requirements as rows: the plain-language view of `requirement` usages
 * (PLAN.md §7.3). Satisfy/verify links and metadata are matched to their
 * requirement by the toolkit's resolved element ids; by name for models
 * without ids. Given the files' texts, each row also says how it is covered
 * by the one coverage rule (`coverage.ts`), through the derivations between
 * requirements; and each verification case that verifies it brings its
 * recorded result (`verification.ts`).
 */
import type { Analysis, MetadataAnnotation, Span, TraceLink, Usage } from '#lib/engine/types.ts';
import { coverageRule, type Covered } from './coverage';
import { derivationEnds, projectDerivations } from './derivations';
import { displayReference, lastSegment, stringValue, unescapeName } from './names';
import { collectResults, type RecordedResult } from './verification';

export interface RequirementRow {
	/** Stable key within one analysis: file and source offset. */
	key: string;
	/** The short name, e.g. `SYS-001`. */
	id: string | null;
	title: string;
	text: string;
	kind: string | null;
	priority: string | null;
	verificationMethods: string[];
	status: string | null;
	owner: string | null;
	rationale: string | null;
	issues: string[];
	satisfiedBy: string[];
	verifiedBy: string[];
	/** The element ids of what satisfies or verifies it, by the name shown (when resolved). */
	linkIds: Record<string, string>;
	/** Each verifying case's recorded result (null: not run yet), parallel to `verifiedBy`. */
	results: (RecordedResult | null)[];
	/** Satisfied and verified by the coverage rule: directly, through what it is derived into, or not. */
	satisfied: Covered;
	verified: Covered;
	/**
	 * The requirements it is derived from, and those derived from it (by
	 * `key`; a key no row has is a derived end that doesn't resolve).
	 */
	derivedFrom: string[];
	derivedInto: string[];
	file: string;
	span: Span;
}

/**
 * Collect every requirement usage across the analysed files. With the
 * files' texts (`texts`, the model files to read derivations from), the
 * coverage rule follows derivations; without, only direct links count.
 */
export function collectRequirements(
	analyses: Iterable<Analysis>,
	texts?: Record<string, string>
): RequirementRow[] {
	const all = [...analyses];
	const satisfactions = new LinkIndex(all.flatMap((a) => a.model.satisfactions));
	const verifications = new LinkIndex(all.flatMap((a) => a.model.verifications));
	const results = collectResults(all);
	const rows: RequirementRow[] = [];

	for (const { model } of all) {
		for (const usage of model.usages) {
			if (usage.kind !== 'requirement' || !usage.name) continue;
			const attributes = model.usages.filter(
				(u) => u.kind === 'attribute' && u.parent_def === usage.name && u.value_expr
			);
			const annotations = (model.annotations ?? []).filter((a) =>
				a.target_id && usage.id ? a.target_id === usage.id : a.target === usage.name
			);
			const status = metadata(annotations, 'StatusInfo');
			const verifying = verifications.of(usage);
			const verifiedBy = linksTo(verifying);
			const satisfiedBy = linksTo(satisfactions.of(usage));
			rows.push({
				key: `${model.file}@${usage.span.start_byte}`,
				id: usage.short_name ? unescapeName(usage.short_name) : null,
				title: unescapeName(usage.name),
				text: usage.doc ?? '',
				kind: enumValue(attributes, 'kind'),
				priority: enumValue(attributes, 'priority'),
				verificationMethods: attributes
					.filter((a) => a.redefinition === 'verificationMethod')
					.flatMap((a) => listValues(a.value_expr ?? '')),
				status: field(status, 'status', lastSegment),
				owner: field(status, 'owner', stringValue),
				rationale: field(metadata(annotations, 'Rationale'), 'text', stringValue),
				issues: annotations
					.filter((a) => typeName(a) === 'Issue')
					.map((a) => field(a, 'text', stringValue) ?? ''),
				satisfiedBy,
				verifiedBy,
				linkIds: linkIds([...satisfactions.of(usage), ...verifying]),
				results: verifiedBy.map((by) => {
					const link = verifying.find((l) => displayReference(l.by) === by);
					if (link?.by_id) return results.get(link.by_id) ?? null;
					return results.get(lastSegment(by.split('.').pop() ?? by)) ?? null;
				}),
				satisfied: satisfiedBy.length ? 'direct' : null,
				verified: verifiedBy.length ? 'direct' : null,
				derivedFrom: [],
				derivedInto: [],
				file: model.file,
				span: usage.span
			});
		}
	}
	if (texts) applyCoverageRule(rows, texts);
	return rows;
}

/** Fill each row's derivations and its coverage by the rule, from the derivations in `texts`. */
function applyCoverageRule(rows: RequirementRow[], texts: Record<string, string>) {
	const byKey = new Map(rows.map((r) => [r.key, r]));
	for (const { original, derived, at } of derivationEnds(rows, projectDerivations(texts))) {
		// An end that doesn't resolve stays, by where it is written: it covers nothing.
		const key = derived?.key ?? `?${at.file}@${at.from ?? 0}`;
		if (!original.derivedInto.includes(key)) original.derivedInto.push(key);
		if (derived && !derived.derivedFrom.includes(original.key))
			derived.derivedFrom.push(original.key);
	}
	const into = (r: RequirementRow) => r.derivedInto.map((k) => byKey.get(k) ?? null);
	const satisfied = coverageRule(rows, (r) => r.satisfiedBy.length > 0, into);
	const verified = coverageRule(rows, (r) => r.verifiedBy.length > 0, into);
	for (const r of rows) {
		r.satisfied = satisfied.get(r) ?? null;
		r.verified = verified.get(r) ?? null;
	}
}

function typeName(annotation: MetadataAnnotation): string {
	return lastSegment(annotation.metadata_type);
}

function metadata(annotations: MetadataAnnotation[], type: string) {
	return annotations.find((a) => typeName(a) === type);
}

function field(
	annotation: MetadataAnnotation | undefined,
	name: string,
	read: (expression: string) => string
): string | null {
	const value = annotation?.values.find(([key]) => key === name)?.[1];
	return value === undefined ? null : read(value);
}

function enumValue(attributes: Usage[], name: string): string | null {
	const value = attributes.find((a) => a.redefinition === name)?.value_expr;
	return value ? lastSegment(value) : null;
}

/** `(VerificationMethod::test, VerificationMethod::analysis)` → `[test, analysis]`. */
function listValues(expression: string): string[] {
	return expression
		.replace(/^\(|\)$/g, '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean)
		.map(lastSegment);
}

/** Names a trace link may use for this requirement. */
function referencesTo(usage: Usage): Set<string> {
	const names = new Set([usage.name, unescapeName(usage.name)]);
	if (usage.short_name) {
		names.add(usage.short_name);
		names.add(unescapeName(usage.short_name));
	}
	return names;
}

function linksTo(links: TraceLink[]): string[] {
	return [...new Set(links.map((link) => displayReference(link.by)))];
}

/**
 * Trace links by the requirement they name, so each requirement finds its
 * own without a pass over every link of the project (that was quadratic).
 */
class LinkIndex {
	private readonly byId = new Map<string, number[]>();
	private readonly byName = new Map<string, number[]>();

	constructor(private readonly links: TraceLink[]) {
		const add = (map: Map<string, number[]>, key: string, index: number) => {
			const list = map.get(key);
			if (list) list.push(index);
			else map.set(key, [index]);
		};
		links.forEach((link, index) => {
			if (link.requirement_id) add(this.byId, link.requirement_id, index);
			const segments = link.requirement.split('::');
			const last = segments[segments.length - 1] ?? '';
			add(this.byName, link.requirement, index);
			if (last !== link.requirement) add(this.byName, last, index);
		});
	}

	/** The links to a requirement, in link order: by its resolved id, else (unresolved) by name. */
	of(usage: Usage): TraceLink[] {
		const found = new Set<number>();
		if (usage.id) for (const index of this.byId.get(usage.id) ?? []) found.add(index);
		for (const name of referencesTo(usage))
			for (const index of this.byName.get(name) ?? [])
				if (!(this.links[index]!.requirement_id && usage.id)) found.add(index);
		return [...found].sort((a, b) => a - b).map((index) => this.links[index]!);
	}
}

function linkIds(links: TraceLink[]): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const link of links) if (link.by_id) ids[displayReference(link.by)] ??= link.by_id;
	return ids;
}
