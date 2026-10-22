/**
 * Requirements as rows: the plain-language view of `requirement` usages
 * (PLAN.md §7.3). Satisfy/verify links and metadata are matched to their
 * requirement by the toolkit's resolved element ids; by name for models
 * without ids.
 */
import type { Analysis, MetadataAnnotation, Span, TraceLink, Usage } from '#lib/engine/types.ts';
import { displayReference, lastSegment, stringValue, unescapeName } from './names';

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
	file: string;
	span: Span;
}

/** Collect every requirement usage across the analysed files. */
export function collectRequirements(analyses: Iterable<Analysis>): RequirementRow[] {
	const all = [...analyses];
	const satisfactions = all.flatMap((a) => a.model.satisfactions);
	const verifications = all.flatMap((a) => a.model.verifications);
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
				satisfiedBy: linksTo(usage, satisfactions),
				verifiedBy: linksTo(usage, verifications),
				linkIds: linkIds(usage, [...satisfactions, ...verifications]),
				file: model.file,
				span: usage.span
			});
		}
	}
	return rows;
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

function linksTo(usage: Usage, links: TraceLink[]): string[] {
	return [...new Set(linksOf(usage, links).map((link) => displayReference(link.by)))];
}

/** The links to a requirement: by its resolved id, else (unresolved) by name. */
function linksOf(usage: Usage, links: TraceLink[]): TraceLink[] {
	const names = referencesTo(usage);
	return links.filter((link) => {
		if (link.requirement_id && usage.id) return link.requirement_id === usage.id;
		const segments = link.requirement.split('::');
		return names.has(link.requirement) || names.has(segments[segments.length - 1] ?? '');
	});
}

function linkIds(usage: Usage, links: TraceLink[]): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const link of linksOf(usage, links))
		if (link.by_id) ids[displayReference(link.by)] ??= link.by_id;
	return ids;
}
