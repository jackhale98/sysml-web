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
	file: string;
	span: Span;
}

/** Collect every requirement usage across the analysed files. */
export function collectRequirements(analyses: Iterable<Analysis>): RequirementRow[] {
	const all = [...analyses];
	const satisfactions = new LinkIndex(all.flatMap((a) => a.model.satisfactions));
	const verifications = new LinkIndex(all.flatMap((a) => a.model.verifications));
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
				satisfiedBy: satisfactions.to(usage),
				verifiedBy: verifications.to(usage),
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

	/** What the links to this requirement name as satisfying or verifying it, in link order. */
	to(usage: Usage): string[] {
		const found = new Set<number>();
		// A resolved link names its requirement by id; an unresolved one only by name.
		if (usage.id) for (const index of this.byId.get(usage.id) ?? []) found.add(index);
		for (const name of referencesTo(usage))
			for (const index of this.byName.get(name) ?? [])
				if (!(this.links[index]!.requirement_id && usage.id)) found.add(index);
		const targets = [...found]
			.sort((a, b) => a - b)
			.map((index) => displayReference(this.links[index]!.by));
		return [...new Set(targets)];
	}
}
