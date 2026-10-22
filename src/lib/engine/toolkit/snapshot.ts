/**
 * One version of the model as the semantic diff compares it
 * (`#lib/review/semantic.ts`): the model adapter's records of the project's
 * own files, with what each says about itself as people read it, the
 * relationships written without names, the requirement checks, the budget
 * totals and the evaluated attribute values. Made in the worker, over a
 * session the host built (the analysed one, or one for another version).
 */
import { viewTitle } from '#lib/workbench/views.ts';
import { formatQuantity, readable } from '../quantity';
import type { Check, Evaluated, MetadataAnnotation } from '../types';
import type {
	Category,
	ModelSnapshot,
	RelationKind,
	SnapCheck,
	SnapElement,
	SnapRelation
} from '#lib/review/types.ts';
import type { Evaluation } from './evaluation';
import { multiplicityOf, type ElementRecord, type ExtractedModel, type UnitInfo } from './model';
import { listViews, renderView, type ViewContext } from './views';
import { findView, tableSpec } from './views/catalog';
import { collapseWhitespace, displayValue, splitPath, unquoteName } from './views/text';

export interface SnapshotSource {
	extracted: ExtractedModel;
	units: Map<string, UnitInfo>;
	/** The project's own files (not the bundled view libraries). */
	content: ReadonlySet<string>;
	evaluation: Evaluation | null;
	views: ViewContext | null;
	/** Files with syntax errors. */
	broken: string[];
}

/** Types whose elements are about risk (the risk and hazard libraries). */
const RISK_TYPE = /\b(Hazard|Harm|Causation|RiskControl|Mitigation|Fmea|FailureMode|Risk\w*)\b/;
const MAX_BODY = 4000;

const RELATION_KINDS: Record<string, RelationKind> = {
	SatisfyRequirementUsage: 'satisfy',
	AllocationUsage: 'allocate',
	ConnectionUsage: 'connect',
	InterfaceUsage: 'interface',
	FlowUsage: 'flow',
	SuccessionFlowUsage: 'flow',
	FlowConnectionUsage: 'flow',
	BindingConnectorAsUsage: 'bind',
	SuccessionAsUsage: 'succession',
	TransitionUsage: 'transition'
};

export function buildSnapshot(source: SnapshotSource): ModelSnapshot {
	const { extracted, units, content } = source;
	const byId = extracted.byId;
	const textOf = (r: ElementRecord) => {
		const text = units.get(r.path)?.original.text ?? '';
		return text.slice(r.span.from ?? 0, r.span.to ?? 0);
	};
	const owned = (r: ElementRecord) => content.has(r.path);

	// What sits in a metadata annotation (its fields) or in an unnamed
	// relationship (its ends) is part of that, not an element of its own.
	const inside = new Map<string, boolean>();
	const isInside = (r: ElementRecord): boolean => {
		const known = inside.get(r.id);
		if (known !== undefined) return known;
		const owner = r.ownerId ? byId.get(r.ownerId) : undefined;
		const result =
			!!owner &&
			(owner.metaclass === 'MetadataUsage' ||
				(!owner.qualifiedName && owner.metaclass !== 'Package') ||
				isInside(owner));
		inside.set(r.id, result);
		return result;
	};

	const labels = new Map<string, string>();
	const labelOf = (r: ElementRecord): string => {
		const known = labels.get(r.id);
		if (known !== undefined) return known;
		const own = segmentOf(r);
		const parent = r.parentId ? byId.get(r.parentId) : undefined;
		const label =
			r.kind === 'package'
				? (r.qualifiedName ?? own).split('::').map(unquoteName).join('::')
				: parent && parent.kind !== 'package'
					? `${labelOf(parent)}.${own}`
					: own;
		labels.set(r.id, label);
		return label;
	};

	const categories = new Map<string, Category>();
	const categoryOf = (r: ElementRecord): Category => {
		const known = categories.get(r.id);
		if (known) return known;
		let category: Category = 'other';
		if (!r.path.startsWith('libraries/'))
			for (
				let at: ElementRecord | undefined = r;
				at;
				at = at.ownerId ? byId.get(at.ownerId) : undefined
			) {
				if (isRisk(at)) {
					category = 'risk';
					break;
				}
				const decided = decisive(at);
				if (decided) {
					category = decided;
					break;
				}
			}
		categories.set(r.id, category);
		return category;
	};

	// Metadata annotations, by the element they are about.
	const metadata = new Map<string, Record<string, string>>();
	for (const [path, model] of extracted.models) {
		if (!content.has(path)) continue;
		const seen = new Map<string, number>();
		const text = units.get(path)?.original.text ?? '';
		for (const a of model.annotations ?? []) {
			if (!a.target_id || !aboutResolved(a, text, byId)) continue;
			const props = metadata.get(a.target_id) ?? {};
			const type = a.metadata_type;
			const n = (seen.get(`${a.target_id}|${type}`) ?? 0) + 1;
			seen.set(`${a.target_id}|${type}`, n);
			const name = n > 1 ? `${type}#${n}` : type;
			for (const [field, value] of a.values)
				props[`metadata:${name}.${field}`] = readableValue(value);
			if (!a.values.length) props[`metadata:${name}`] = 'applied';
			metadata.set(a.target_id, props);
		}
	}

	const elements: SnapElement[] = [];
	const relations: SnapRelation[] = [];
	const elementById = new Map<string, SnapElement>();
	const traceOf = new Map(extracted.traces.map((t) => [t.at.id, t]));

	for (const r of extracted.elements) {
		if (!owned(r) || r.metaclass === 'MetadataUsage' || isInside(r)) continue;
		const text = textOf(r);
		const at = { path: r.path, line: r.span.start_row, from: r.span.from ?? 0, to: r.span.to ?? 0 };
		if (r.name && r.qualifiedName) {
			const element: SnapElement = {
				...at,
				id: r.id,
				name: r.written ?? r.name,
				qualifiedName: r.qualifiedName,
				title: unquoteName(r.name),
				label: labelOf(r),
				kind: r.kind,
				isDefinition: r.isDefinition,
				ownerId: r.parentId,
				category: categoryOf(r),
				props: { ...propsOf(r), ...metadata.get(r.id) },
				body: bodyOf(text, r.written ?? r.name)
			};
			elements.push(element);
			elementById.set(r.id, element);
			continue;
		}
		// A requirement's `require constraint { … }` is what the requirement says.
		const owner = r.parentId ? byId.get(r.parentId) : undefined;
		if (
			r.metaclass === 'ConstraintUsage' &&
			r.membership === 'RequirementConstraintMembership' &&
			owner
		) {
			const props = elementById.get(owner.id)?.props;
			const constraint = constraintText(text);
			if (props)
				props.constraint = props.constraint ? `${props.constraint}; ${constraint}` : constraint;
			continue;
		}
		const trace = traceOf.get(r.id);
		let kind: RelationKind = RELATION_KINDS[r.metaclass] ?? 'other';
		if (r.membership === 'RequirementVerificationMembership') kind = 'verify';
		if (kind === 'connect' && /#derivation\b/.test(r.header)) kind = 'derive';
		const ownerId = kind === 'verify' && trace?.byId ? trace.byId : r.parentId;
		const ownerRecord = ownerId ? byId.get(ownerId) : undefined;
		const refs = trace?.requirementId ? [trace.requirementId] : [];
		const key = collapseWhitespace(text).replace(/;$/, '');
		relations.push({
			...at,
			kind,
			ownerId,
			refs,
			key,
			text: relationText(
				kind,
				r,
				key,
				trace?.requirementId ? byId.get(trace.requirementId) : undefined,
				labelOf
			),
			category: relationCategory(kind, ownerRecord ? categoryOf(ownerRecord) : 'other')
		});
	}

	return {
		elements,
		relations,
		checks: checksOf(source.evaluation, labelOf, byId),
		budgets: budgetsOf(source.views),
		values: valuesOf(source.evaluation, elements),
		brokenFiles: [...source.broken].sort()
	};
}

/**
 * Whether an annotation's `about X` names the element the adapter gave it:
 * one whose `about` doesn't resolve is given the element it sits in instead.
 */
function aboutResolved(
	a: MetadataAnnotation,
	text: string,
	byId: ReadonlyMap<string, ElementRecord>
): boolean {
	const written = text.slice(a.span.from ?? 0, a.span.to ?? 0);
	const about = /\babout\s+([^{;]+)/.exec(written.split('{')[0] ?? '')?.[1];
	if (!about) return true;
	const last = splitPath(about.split(',')[0]!.trim()).pop();
	const target = byId.get(a.target_id!);
	return !!target?.name && unquoteName(target.name) === last;
}

/** How a record reads in a label: a requirement by its id (`SYS-003`), anything else by name. */
function segmentOf(r: ElementRecord): string {
	if (r.shortName && /requirement|concern/.test(r.kind)) return unquoteName(r.shortName);
	return unquoteName(r.name ?? r.shortName ?? '?');
}

function isRisk(r: ElementRecord): boolean {
	return RISK_TYPE.test(r.type ?? '') || r.specializes.some((s) => RISK_TYPE.test(s));
}

/** The group an element's kind puts it (and what it contains) in, or null to ask its owner. */
function decisive(r: ElementRecord): Category | null {
	switch (r.kind) {
		case 'requirement':
		case 'concern':
		case 'stakeholder':
			return 'requirements';
		case 'verification':
		case 'analysis':
		case 'objective':
			return 'verification';
		case 'action':
		case 'state':
		case 'transition':
		case 'succession':
		case 'use case':
		case 'use_case':
		case 'perform':
		case 'exhibit':
		case 'allocation':
		case 'actor':
			return 'behaviour';
		case 'part':
		case 'port':
		case 'item':
		case 'interface':
		case 'connection':
		case 'binding':
		case 'flow':
		case 'occurrence':
		case 'enum':
			return 'design';
		case 'attribute':
			return r.isDefinition ? 'design' : null;
		case 'package':
		case 'view':
		case 'rendering':
		case 'metadata':
			return 'other';
		default:
			return null;
	}
}

function relationCategory(kind: RelationKind, owner: Category): Category {
	switch (kind) {
		case 'satisfy':
		case 'derive':
			return owner === 'risk' ? 'risk' : 'requirements';
		case 'verify':
			return 'verification';
		case 'allocate':
		case 'succession':
		case 'transition':
			return 'behaviour';
		case 'connect':
		case 'interface':
		case 'bind':
		case 'flow':
			return owner === 'behaviour' || owner === 'risk' ? owner : 'design';
		default:
			return owner;
	}
}

function relationText(
	kind: RelationKind,
	r: ElementRecord,
	written: string,
	requirement: ElementRecord | undefined,
	labelOf: (r: ElementRecord) => string
): string {
	const requirementLabel = requirement
		? `${labelOf(requirement)}${requirement.shortName && requirement.name ? ` ‘${unquoteName(requirement.name)}’` : ''}`
		: null;
	switch (kind) {
		case 'satisfy': {
			const by = /\bby\s+(.+)$/.exec(written)?.[1];
			return requirementLabel && by ? `${requirementLabel} by ${by}` : stripKeyword(written);
		}
		case 'verify':
			return requirementLabel ?? stripKeyword(written);
		case 'derive': {
			// `#derivation connection { end #original ::> A; end #derive ::> B; }`
			const ends = [...written.matchAll(/end\s+#(\w+)\s*::>\s*([^;]+);/g)];
			const original = ends.find((e) => e[1] === 'original')?.[2];
			const derived = ends.filter((e) => e[1] === 'derive').map((e) => e[2]);
			return original && derived.length
				? `${derived.join(', ')} from ${original}`
				: stripKeyword(written);
		}
		default:
			return stripKeyword(r.header ? collapseWhitespace(r.header).replace(/;$/, '') : written);
	}
}

const stripKeyword = (text: string) =>
	text.replace(
		/^(satisfy|allocate|connect|connection|interface|flow|bind|then|first|verify)\s+/,
		''
	);

function propsOf(r: ElementRecord): Record<string, string> {
	const props: Record<string, string> = {};
	if (r.shortName) props.shortName = unquoteName(r.shortName);
	if (r.type) props.type = `${r.conjugated ? '~' : ''}${r.type}`;
	const multiplicity = multiplicityOf(r.header);
	if (multiplicity) props.multiplicity = multiplicity;
	if (r.value !== null) props.value = readableValue(r.value);
	if (r.specializes.length) props.specializes = r.specializes.join(', ');
	if (r.redefines && r.redefines !== r.name) props.redefines = r.redefines;
	if (r.direction && r.kind !== 'subject') props.direction = r.direction;
	if (r.abstract) props.abstract = 'abstract';
	const doc = r.docs.map(collapseWhitespace).join(' ').trim();
	if (doc) props.doc = doc;
	return props;
}

/** A value as people read it: `120 g`, `high`, `Thermal runaway`, `esc.mass + motor.mass`. */
export function readableValue(value: string): string {
	const shown = displayValue(collapseWhitespace(value));
	return shown.replace(/\s*\[\s*([^\]]+?)\s*\]/g, ' $1').trim();
}

/** `require constraint { drone.takeOffMass <= 4 [kg] }` → `drone.takeOffMass <= 4 kg`. */
function constraintText(text: string): string {
	const body = /\{([\s\S]*)\}/.exec(text)?.[1] ?? text;
	return readableValue(body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ' '));
}

/** The element's text with its declared name taken out (so a rename keeps the same body). */
function bodyOf(text: string, name: string): string {
	const at = text.indexOf(name);
	const without = at >= 0 ? text.slice(0, at) + text.slice(at + name.length) : text;
	return collapseWhitespace(without).slice(0, MAX_BODY);
}

const NEGATED: Record<string, string> = { '<=': '>', '>=': '<', '<': '≥', '>': '≤', '==': '≠' };
const SYMBOL: Record<string, string> = { '<=': '≤', '>=': '≥', '<': '<', '>': '>', '==': '=' };

function checksOf(
	evaluation: Evaluation | null,
	labelOf: (r: ElementRecord) => string,
	byId: ReadonlyMap<string, ElementRecord>
): SnapCheck[] {
	if (!evaluation) return [];
	return evaluation.checks().checks.map((check): SnapCheck => {
		const requirement = check.requirement?.elementId
			? byId.get(check.requirement.elementId)
			: undefined;
		const label = check.requirement
			? requirement
				? labelOf(requirement)
				: (check.requirement.id ?? check.requirement.name)
			: (check.name ?? check.constraint);
		return {
			kind: check.kind,
			requirementId: check.requirement?.elementId ?? null,
			label,
			title: check.requirement ? unquoteName(check.requirement.name) : null,
			by: check.by,
			subject: check.limit?.feature ?? null,
			status: check.status,
			reason: reasonOf(check),
			margin: check.margin
				? formatQuantity({ value: check.margin.value, unit: check.margin.unit })
				: null,
			path: check.file,
			line: check.span.start_row,
			from: check.span.from ?? 0,
			to: check.span.to ?? 0
		};
	});
}

/** `4.05 kg > 4 kg`: the value against its limit, for a check with one. */
function reasonOf(check: Check): string | null {
	if (!check.limit || check.status === 'undecided') return null;
	const value = check.values.find((v) => v.feature === check.limit!.feature)?.value;
	if (!value || value.kind !== 'number') return null;
	const op =
		check.status === 'violated'
			? (NEGATED[check.limit.operator] ?? '≠')
			: (SYMBOL[check.limit.operator] ?? check.limit.operator);
	const limit = formatQuantity(readable({ value: check.limit.value, unit: check.limit.unit }));
	return `${evaluatedText(value)} ${op} ${limit}`;
}

function evaluatedText(value: Evaluated): string | null {
	switch (value.kind) {
		case 'number':
			return formatQuantity(readable({ value: value.value, unit: value.unit }));
		case 'text':
			return value.text;
		default:
			return null;
	}
}

/** `2770 g` → `2.77 kg`: a table's quantity as people read it. */
function readableQuantity(text: string): string {
	const match = /^(-?[\d.]+(?:e-?\d+)?)\s*(\S+)?$/.exec(text.trim());
	if (!match) return text;
	return formatQuantity(readable({ value: Number(match[1]), unit: match[2] ?? null }));
}

function valuesOf(evaluation: Evaluation | null, elements: SnapElement[]): Record<string, string> {
	if (!evaluation) return {};
	const ids = elements.filter((e) => e.kind === 'attribute' && !e.isDefinition).map((e) => e.id);
	const out: Record<string, string> = {};
	try {
		for (const [id, value] of Object.entries(evaluation.evaluate(ids))) {
			const text = evaluatedText(value);
			if (text !== null) out[id] = text;
		}
	} catch {
		// Values are extra: the comparison stands without them.
	}
	return out;
}

/** The grand total of every budget table of the project. */
function budgetsOf(ctx: ViewContext | null): ModelSnapshot['budgets'] {
	if (!ctx) return [];
	const out: ModelSnapshot['budgets'] = [];
	for (const info of listViews(ctx)) {
		if (info.builtin || !info.hasTable || !info.isUsage) continue;
		const view = findView(ctx, info.qualifiedName ?? info.name);
		const rows = view ? tableSpec(ctx, view)?.get('rows') : undefined;
		if (!rows?.startsWith('budget:')) continue;
		try {
			const table = renderView(ctx, info.qualifiedName ?? info.name);
			// The root of the parts tree (depth 0) carries the total of everything under it.
			const at = table.rowInfo?.findIndex((r) => (r.depth ?? 0) === 0 && r.role !== 'attribute');
			const column = table.columns.indexOf('total');
			const row = at !== undefined && at >= 0 ? table.rows[at] : undefined;
			const total = row && column >= 0 ? row[column] : undefined;
			if (total)
				out.push({
					view: info.name,
					title: viewTitle(info.name),
					root: row![0] ?? '',
					total: readableQuantity(total)
				});
		} catch {
			// A budget that doesn't render has no total to compare.
		}
	}
	return out;
}
