/**
 * The model adapter: reads the toolkit's resolved model and builds the app's
 * per-file `Model` (definitions, usages, satisfy/verify links, metadata
 * annotations) and `ElementDetails` from it.
 *
 * What it takes from the toolkit rather than re-deriving:
 * - the element tree, owners and qualified names (no name matching);
 * - types, specializations and redefinitions as resolved targets, written
 *   the shortest way that resolves from the element (`minimalSpelling`);
 * - satisfy and verify targets (`satisfiedRequirement`, `satisfyingFeature`,
 *   `verifiedRequirement`), metadata types and annotated elements;
 * - names as the language spells them (`canonicalName`), docs, values.
 *
 * Fields it can't fill (see docs/engine.md): `Definition.super_type` lists
 * only the first specialization; `Usage.multiplicity` is the text between
 * `[` and `]` in the declaration as written (the toolkit gives bounds as
 * expressions, not as text); `valueKind: 'initial'` (`:=`) is read from the
 * declaration text, since the toolkit only says whether a value is a default.
 */
import type {
	Definition,
	ElementDetails,
	MetadataAnnotation,
	Model,
	Span,
	TraceLink,
	Usage
} from '../types';
import type { TkElement, TkRef, TkSession, TkSite, Toolkit } from './api';
import type { TextIndex } from './offsets';
import type { RepairMap } from './repair';

/** One user unit of the session, with what is needed to map positions back. */
export interface UnitInfo {
	path: string;
	/** The text the person edits. */
	original: TextIndex;
	/** The text the session parsed (differs from `original` when repaired). */
	repaired: TextIndex;
	repair?: RepairMap;
}

/** One element of the user's model, as the adapter read it. */
export interface ElementRecord {
	id: string;
	metaclass: string;
	/** The name (a redefinition is named by what it redefines), or null when anonymous. */
	name: string | null;
	/** The name as SysML writes it (quoted when needed). */
	written: string | null;
	qualifiedName: string | null;
	shortName: string | null;
	ownerId: string | null;
	/** Nearest named ancestor (the app's `parent_def`). */
	parentId: string | null;
	kind: string;
	isDefinition: boolean;
	path: string;
	span: Span;
	/** The declaration text up to its body or `;`, in the repaired text. */
	header: string;
	docs: string[];
	value: string | null;
	valueIsDefault: boolean | null;
	type: string | null;
	conjugated: boolean;
	specializes: string[];
	redefines: string | null;
	/** Qualified name of the redefined feature. */
	redefinesQualified: string | null;
	abstract: boolean;
	direction: 'in' | 'out' | 'inout' | null;
	readonly: boolean;
	derived: boolean;
	end: boolean;
	membership: string | null;
	/** Ids of the explicit types (`: T`), resolved; for `~T`, the port def T (with `conjugated`). */
	typeIds: string[];
	/** Ids of the specializations (`:>`) the tree graph resolves (definitions and part-like usages). */
	generalIds: string[];
	/** The feature this one redefines, through its redefinitions (`redefinitionRoot`). */
	rootId: string | null;
}

/** A satisfy or verify link with its resolved ends, by element id. */
export interface TraceRecord {
	kind: 'satisfy' | 'verify';
	/** The `satisfy` usage, or the verification case's objective member. */
	at: ElementRecord;
	requirementId: string | null;
	/** The satisfying feature, or the verification case. */
	byId: string | null;
}

export interface ExtractedModel {
	models: Map<string, Model>;
	elements: ElementRecord[];
	byId: Map<string, ElementRecord>;
	/** Satisfy and verify links by id (the diagrams draw them). */
	traces: TraceRecord[];
}

const ELEMENT_FIELDS = [
	'metaclass',
	'isLibraryElement',
	'name',
	'shortName',
	'qualifiedName',
	'memberExtent',
	'declarationSite',
	'valueSource',
	'valueIsDefault',
	'docs',
	'property:owningRelationship',
	'property:isAbstract',
	'property:direction',
	'property:isEnd',
	'property:isReadOnly',
	'property:isDerived'
];

type Row = Record<string, unknown> & { errors?: Record<string, string> };

/**
 * Deepest nesting walked, and most elements read: guards against pathological
 * input. A project of 100k lines has about 110k elements (it lost its last
 * files' elements to a limit of 100k).
 */
const MAX_DEPTH = 64;
const MAX_ELEMENTS = 2_000_000;

export function extractModel(
	tk: Toolkit,
	session: TkSession,
	units: Map<number, UnitInfo>
): ExtractedModel {
	const rows = (ids: string[], fields: string[]): (Row | null)[] =>
		ids.length
			? (JSON.parse(session.rows(JSON.stringify(ids), JSON.stringify(fields))) as (Row | null)[])
			: [];

	// 1. The user's element tree (a handle walk is far cheaper than `ownedMember`
	// reads), with each element's explicit types and what it redefines.
	const order: string[] = [];
	const ownerOf = new Map<string, string | null>();
	const typingsOf = new Map<string, string[]>();
	const rootOf = new Map<string, string>();
	const walk = (element: TkElement, owner: string | null, depth: number) => {
		// Expressions (values, bounds, conditions) are read as source text, not walked.
		if (EXPRESSION.test(session.metaclass(element))) {
			element.free();
			return;
		}
		const id = session.elementId(element);
		order.push(id);
		ownerOf.set(id, owner);
		const types = session.typings(element);
		if (types.length)
			typingsOf.set(
				id,
				types.map((t) => session.elementId(t))
			);
		for (const t of types) t.free();
		const root = session.redefinitionRoot(element);
		const rootId = session.elementId(root);
		root.free();
		if (rootId !== id) rootOf.set(id, rootId);
		const members =
			depth < MAX_DEPTH && order.length < MAX_ELEMENTS ? session.members(element) : [];
		element.free();
		for (const member of members) walk(member, id, depth + 1);
	};
	for (const root of session.roots()) walk(root, null, 0);

	// 2. What each element says about itself. No relationship properties: the
	// first such read costs a derivation pass over the whole model per session.
	const read = rows(order, ELEMENT_FIELDS);
	const raw = new Map<string, Row>();
	const metaclassOf = new Map<string, string>();
	order.forEach((id, i) => {
		const row = read[i];
		if (!row || row.isLibraryElement) return;
		raw.set(id, row);
		metaclassOf.set(id, String(row.metaclass));
	});

	// 3. The memberships that make a feature a subject, actor, … or a `verify`.
	const membershipList = [
		...new Set([...raw.values()].map((row) => ref(row['property:owningRelationship'])))
	].filter((id): id is string => !!id);
	const membershipKind = new Map<string, string>();
	rows(membershipList, ['metaclass']).forEach((row, i) => {
		if (row) membershipKind.set(membershipList[i]!, String(row.metaclass));
	});
	const verifyList = membershipList.filter(
		(id) => membershipKind.get(id) === 'RequirementVerificationMembership'
	);
	const verifyRows = new Map<string, Row>();
	rows(verifyList, ['derived:verifiedRequirement']).forEach((row, i) => {
		if (row) verifyRows.set(verifyList[i]!, row);
	});

	// Specializations (`:>`) the tree diagram resolves: definitions and part-like usages.
	const generalsOf = new Map<string, string[]>();
	try {
		const graph = JSON.parse(session.toGraph(JSON.stringify({ view: 'tree' }))) as {
			edges: { kind: string; source: string; target: string }[];
		};
		for (const edge of graph.edges) {
			if (edge.kind !== 'specialization') continue;
			const list = generalsOf.get(edge.source) ?? [];
			list.push(edge.target);
			generalsOf.set(edge.source, list);
		}
	} catch {
		// No graph: specializations come from the declarations as written.
	}

	const targetIds = new Set<string>([...rootOf.values()]);
	for (const list of [...typingsOf.values(), ...generalsOf.values()])
		for (const id of list) targetIds.add(id);
	const targetRows = new Map<string, Row>();
	const targetList = [...targetIds];
	rows(targetList, ['metaclass', 'name', 'qualifiedName']).forEach((row, i) => {
		if (row) targetRows.set(targetList[i]!, row);
	});

	// Derived reads, in this order: reading `name` of unnamed redefinitions
	// before the satisfy/verify ends makes those cost a whole-model pass.
	const satisfyIds = [...raw.keys()].filter(
		(id) => metaclassOf.get(id) === 'SatisfyRequirementUsage'
	);
	const satisfyRows = new Map<string, Row>();
	rows(satisfyIds, ['derived:satisfiedRequirement', 'derived:satisfyingFeature']).forEach(
		(row, i) => {
			if (row) satisfyRows.set(satisfyIds[i]!, row);
		}
	);
	// An unnamed redefinition (`:>> mass`) is named by the feature it redefines.
	const unnamedIds = [...raw.keys()].filter((id) => !raw.get(id)!.name && rootOf.has(id));
	const effectiveName = new Map<string, string>();
	rows(unnamedIds, ['derived:name']).forEach((row, i) => {
		const name = row?.['derived:name'];
		if (typeof name === 'string' && name) effectiveName.set(unnamedIds[i]!, name);
	});

	// 4. Spellings of the targets as they'd be written at each element.
	const spell = new Spelling(tk, session);

	const records: ElementRecord[] = [];
	const byId = new Map<string, ElementRecord>();
	const unitByIndex = units;
	for (const id of order) {
		const row = raw.get(id);
		if (!row) continue;
		const extent = row.memberExtent as TkSite | null;
		const unit = extent ? unitByIndex.get(extent.unit) : undefined;
		if (!extent || !unit) continue;
		const metaclass = metaclassOf.get(id) ?? '';
		if (SKIPPED_METACLASSES.has(metaclass)) continue;

		const declared = typeof row.name === 'string' && row.name ? row.name : effectiveName.get(id);
		const name = declared || null;
		const qualifiedName = typeof row.qualifiedName === 'string' ? row.qualifiedName : null;
		const membershipId = ref(row['property:owningRelationship']);
		const membership = membershipId ? (membershipKind.get(membershipId) ?? null) : null;

		const header = declarationHeader(unit.repaired.sliceBytes(extent.start, extent.end));
		const typing = typingsOf.get(id)?.[0];
		const typingMetaclass = typing ? String(targetRows.get(typing)?.metaclass ?? '') : '';
		const conjugated = typingMetaclass === 'ConjugatedPortDefinition';
		// `~PowerPort` types by the conjugate the toolkit makes inside `PowerPort`.
		const typeTarget = conjugated ? (ownerOf.get(typing!) ?? typing) : typing;
		const type = typeTarget ? (spell.of(id, typeTarget) ?? null) : null;
		const generals = generalsOf.get(id);
		const specializes = generals
			? generals.map((g) => spell.of(id, g)).filter((g): g is string => !!g)
			: writtenSpecializations(header);
		// A redefinition the declaration writes (`:>> mass`, `redefines mass`).
		const rootId = /:>>|\bredefines\b/.test(header) ? rootOf.get(id) : undefined;
		const root = rootId ? targetRows.get(rootId) : undefined;
		const redefines = rootId
			? (effectiveName.get(id) ?? (typeof root?.name === 'string' ? root.name : null))
			: null;
		const redefinesQualified = typeof root?.qualifiedName === 'string' ? root.qualifiedName : null;
		const redefinedMetaclass = root ? String(root.metaclass) : null;

		const site = mapSite(unit, extent);
		const isDefinition = isDefinitionMetaclass(metaclass);
		const record: ElementRecord = {
			id,
			metaclass,
			name,
			written: name ? writtenName(unit, row.declarationSite as TkSite | null, name, spell) : null,
			qualifiedName,
			shortName: typeof row.shortName === 'string' ? row.shortName : null,
			ownerId: ownerOf.get(id) ?? null,
			parentId: null,
			kind: kindOf(metaclass, membership, redefinedMetaclass),
			isDefinition,
			path: unit.path,
			span: unit.original.spanOfBytes(site.start, site.end),
			header,
			docs: Array.isArray(row.docs) ? (row.docs as string[]) : [],
			value: typeof row.valueSource === 'string' ? row.valueSource : null,
			valueIsDefault: typeof row.valueIsDefault === 'boolean' ? row.valueIsDefault : null,
			type,
			conjugated,
			specializes,
			redefines,
			redefinesQualified,
			abstract: row['property:isAbstract'] === true,
			direction: directionOf(row['property:direction']),
			readonly: row['property:isReadOnly'] === true,
			derived: row['property:isDerived'] === true,
			end: row['property:isEnd'] === true,
			membership,
			// For `~T`, the port def T (the toolkit types it by the conjugate it makes in T).
			typeIds: (typingsOf.get(id) ?? []).map((t, i) => (i === 0 && typeTarget ? typeTarget : t)),
			generalIds: generals ?? [],
			rootId: rootOf.get(id) ?? null
		};
		records.push(record);
		byId.set(id, record);
	}

	// The nearest named ancestor of each element (anonymous ones are see-through).
	const named = (id: string | null): ElementRecord | null => {
		for (let at = id; at; at = ownerOf.get(at) ?? null) {
			const record = byId.get(at);
			if (record?.name && record.qualifiedName) return record;
		}
		return null;
	};
	for (const record of records) record.parentId = named(record.ownerId)?.id ?? null;

	const models = new Map<string, Model>();
	const modelOf = (path: string): Model => {
		let model = models.get(path);
		if (!model) {
			model = {
				file: path,
				definitions: [],
				usages: [],
				satisfactions: [],
				verifications: [],
				connections: [],
				views: [],
				annotations: [],
				syntax_errors: []
			};
			models.set(path, model);
		}
		return model;
	};
	for (const unit of units.values()) modelOf(unit.path);

	for (const record of records) {
		const model = modelOf(record.path);
		if (!record.name || !record.qualifiedName) continue;
		const parent = record.parentId ? byId.get(record.parentId) : undefined;
		const common = {
			id: record.id,
			kind: record.kind,
			name: record.written ?? record.name,
			span: record.span,
			qualified_name: record.qualifiedName,
			...(parent?.written ? { parent_def: parent.written } : {}),
			...(record.shortName ? { short_name: spell.name(record.shortName) } : {}),
			...(record.docs.length ? { doc: record.docs.join('\n\n') } : {})
		};
		if (record.isDefinition) {
			const definition: Definition = {
				...common,
				super_type: record.specializes[0] ?? null,
				...(record.abstract ? { is_abstract: true } : {})
			};
			model.definitions.push(definition);
		} else {
			const multiplicity = multiplicityOf(record.header);
			const usage: Usage = {
				...common,
				type_ref: record.type ?? record.specializes[0] ?? null,
				...(record.value !== null ? { value_expr: record.value } : {}),
				...(record.redefines ? { redefinition: record.redefines } : {}),
				...(multiplicity ? { multiplicity } : {}),
				...(record.direction && record.kind !== 'subject' ? { direction: record.direction } : {}),
				...(record.conjugated ? { is_conjugated: true } : {})
			};
			model.usages.push(usage);
		}
	}

	// Satisfy and verify links, with the toolkit's resolved ends.
	const traces: TraceRecord[] = [];
	const traceName = (id: string | null): string | null => {
		if (!id) return null;
		const record = byId.get(id);
		if (record?.written) return record.written;
		return spell.reference(id);
	};
	/** A feature as people write it in `satisfy … by x.y`: from its outermost usage owner. */
	const featurePath = (id: string | null): string | null => {
		if (!id) return null;
		const record = byId.get(id);
		if (!record) return spell.reference(id);
		const names: string[] = [];
		for (
			let at: ElementRecord | undefined = record;
			at;
			at = at.ownerId ? byId.get(at.ownerId) : undefined
		) {
			if (at.isDefinition || at.kind === 'package' || !at.written) break;
			names.unshift(at.written);
		}
		return names.length ? names.join('.') : record.written;
	};
	for (const record of records) {
		if (record.metaclass !== 'SatisfyRequirementUsage') continue;
		const row = satisfyRows.get(record.id);
		const requirementId = ref(row?.['derived:satisfiedRequirement']);
		const requirement = traceName(requirementId);
		const by = featurePath(ref(row?.['derived:satisfyingFeature']));
		traces.push({
			kind: 'satisfy',
			at: record,
			requirementId,
			byId: ref(row?.['derived:satisfyingFeature'])
		});
		if (!requirement || !by) continue;
		const link: TraceLink = {
			requirement,
			by,
			span: record.span,
			...(requirementId ? { requirement_id: requirementId } : {})
		};
		modelOf(record.path).satisfactions.push(link);
	}
	for (const record of records) {
		if (record.membership !== 'RequirementVerificationMembership') continue;
		const membershipId = ref(raw.get(record.id)?.['property:owningRelationship']);
		const requirementId = ref(
			membershipId ? verifyRows.get(membershipId)?.['derived:verifiedRequirement'] : null
		);
		const requirement = traceName(requirementId);
		// The verification case (or definition) the objective belongs to.
		let owner = record.ownerId ? byId.get(record.ownerId) : undefined;
		while (owner && !/^VerificationCase/.test(owner.metaclass))
			owner = owner.ownerId ? byId.get(owner.ownerId) : undefined;
		traces.push({ kind: 'verify', at: record, requirementId, byId: owner?.id ?? null });
		if (!requirement || !owner?.written) continue;
		modelOf(record.path).verifications.push({
			requirement,
			by: owner.written,
			span: record.span,
			...(requirementId ? { requirement_id: requirementId } : {})
		});
	}

	// Views with their `filter` conditions (until views move to the toolkit, phase 3).
	for (const record of records) {
		if (record.metaclass !== 'ViewUsage' && record.metaclass !== 'ViewDefinition') continue;
		if (!record.name) continue;
		const unit = [...units.values()].find((u) => u.path === record.path);
		const text = unit?.original.text.slice(record.span.from, record.span.to) ?? '';
		modelOf(record.path).views!.push({
			name: record.written ?? record.name,
			filters: viewFilters(text),
			span: record.span
		});
	}

	// `connect a to b`, with its ends as written (the ICD report resolves them).
	for (const record of records) {
		if (record.metaclass !== 'ConnectionUsage' && record.metaclass !== 'InterfaceUsage') continue;
		const ends = connectionEnds(record.header);
		if (!ends) continue;
		modelOf(record.path).connections!.push({
			name: record.name && record.qualifiedName ? (record.written ?? record.name) : null,
			type_ref: record.type,
			source: ends[0],
			target: ends[1],
			span: record.span
		});
	}

	// Metadata: `@StatusInfo { status = …; }` and `metadata X about y { … }`.
	for (const record of records) {
		if (record.metaclass !== 'MetadataUsage') continue;
		const annotation = metadataOf(session, spell, record, byId);
		if (annotation) modelOf(record.path).annotations!.push(annotation);
	}

	return { models, elements: records, byId, traces };
}

/** Metaclasses of expressions and multiplicities: values, not model elements to list. */
const EXPRESSION = /(Expression|^Literal\w*|^MultiplicityRange|^Multiplicity)$/;

/** Elements the toolkit synthesizes or that are part of another element's notation. */
const SKIPPED_METACLASSES = new Set(['ConjugatedPortDefinition', 'Documentation', 'Comment']);

function metadataOf(
	session: TkSession,
	spell: Spelling,
	record: ElementRecord,
	byId: Map<string, ElementRecord>
): MetadataAnnotation | null {
	const handle = session.elementById(record.id);
	if (!handle) return null;
	try {
		const types = session.typings(handle);
		const type = types[0] ? (session.qualifiedName(types[0]) ?? '') : '';
		for (const t of types) t.free();
		const about = session.annotatedElements(handle);
		const targets = about.map((t) => session.elementId(t));
		for (const t of about) t.free();
		const targetId = targets[0] ?? record.parentId ?? record.ownerId;
		const target = targetId ? byId.get(targetId) : undefined;
		// Its fields: `status = …` redefines the metadata definition's `status`.
		const values: [string, string][] = [];
		for (const member of session.members(handle)) {
			const root = session.redefinitionRoot(member);
			const name = session.name(member) ?? session.name(root);
			root.free();
			const id = session.elementId(member);
			member.free();
			const value = byId.get(id)?.value;
			if (name && typeof value === 'string') values.push([name, value]);
		}
		return {
			metadata_type: type.split('::').pop() ?? type,
			metadata_qualified_type: type,
			values,
			// `about drone::battery` as written there; else the element it sits in.
			target:
				(targets[0] ? spell.of(record.id, targets[0]) : target?.written) ??
				(targetId ? (spell.reference(targetId) ?? '') : ''),
			...(targetId ? { target_id: targetId } : {}),
			span: record.span
		};
	} finally {
		handle.free();
	}
}

/** Spellings of names and references, cached per analysis. */
class Spelling {
	private readonly names = new Map<string, string>();
	private readonly tk: Toolkit;
	private readonly session: TkSession;

	constructor(tk: Toolkit, session: TkSession) {
		this.tk = tk;
		this.session = session;
	}

	/** A name as SysML writes it: `'Flight endurance'`, `Battery`. */
	name(name: string): string {
		let spelled = this.names.get(name);
		if (spelled === undefined) {
			try {
				spelled = (JSON.parse(this.tk.canonicalName(name)) as { spelling: string }).spelling;
			} catch {
				spelled = name;
			}
			this.names.set(name, spelled);
		}
		return spelled;
	}

	/** The shortest spelling of `target` that resolves to it from inside `context`. */
	of(contextId: string, targetId: string): string | null {
		const context = this.session.elementById(contextId);
		const target = this.session.elementById(targetId);
		try {
			if (!context || !target) return null;
			return (
				this.session.minimalSpelling(context, target) ??
				this.session.referenceSpelling(target) ??
				null
			);
		} finally {
			context?.free();
			target?.free();
		}
	}

	/** A qualified reference to an element, quoted as needed. */
	reference(id: string): string | null {
		const element = this.session.elementById(id);
		if (!element) return null;
		try {
			return this.session.referenceSpelling(element) ?? null;
		} finally {
			element.free();
		}
	}
}

/** The name as the source writes it (`'Geofencing'` stays quoted), else as SysML would. */
function writtenName(unit: UnitInfo, site: TkSite | null, name: string, spell: Spelling): string {
	if (site) {
		const text = unit.repaired.sliceBytes(site.start, site.end);
		if (text === name || (text.startsWith("'") && unquote(text) === name)) return text;
	}
	return spell.name(name);
}

/** `'a\\'b'` → `a'b`. */
function unquote(text: string): string {
	return text.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** A site in the session's (maybe repaired) text → a byte range in the person's text. */
function mapSite(unit: UnitInfo, site: TkSite): { start: number; end: number } {
	if (!unit.repair) return { start: site.start, end: site.end };
	return { start: unit.repair.toOriginal(site.start), end: unit.repair.toOriginal(site.end) };
}

const ref = (value: unknown): string | null =>
	value && typeof value === 'object' && '@id' in value ? (value as TkRef)['@id'] : null;

function directionOf(value: unknown): 'in' | 'out' | 'inout' | null {
	return value === 'in' || value === 'out' || value === 'inout' ? value : null;
}

export function isDefinitionMetaclass(metaclass: string): boolean {
	return (
		metaclass.endsWith('Definition') || /Package$/.test(metaclass) || metaclass === 'Namespace'
	);
}

/** Membership kinds that make a feature a subject, actor, …. */
const MEMBERSHIP_KINDS: Record<string, string> = {
	SubjectMembership: 'subject',
	ActorMembership: 'actor',
	StakeholderMembership: 'stakeholder',
	ObjectiveMembership: 'objective',
	ReturnParameterMembership: 'return',
	FramedConcernMembership: 'concern'
};

/** The app's kind words, per metaclass (without `Definition` / `Usage`). */
const KINDS: Record<string, string> = {
	Package: 'package',
	LibraryPackage: 'package',
	Namespace: 'package',
	Part: 'part',
	Item: 'item',
	Port: 'port',
	Attribute: 'attribute',
	Enumeration: 'enum',
	Occurrence: 'occurrence',
	EventOccurrence: 'event',
	Action: 'action',
	PerformAction: 'perform',
	AcceptAction: 'accept',
	SendAction: 'send',
	AssignmentAction: 'assign',
	IfAction: 'action',
	WhileLoopAction: 'action',
	ForLoopAction: 'action',
	TerminateAction: 'action',
	JoinNode: 'join_node',
	MergeNode: 'merge_node',
	ForkNode: 'fork_node',
	DecisionNode: 'decision_node',
	State: 'state',
	ExhibitState: 'exhibit',
	Transition: 'transition',
	Constraint: 'constraint',
	AssertConstraint: 'constraint',
	Requirement: 'requirement',
	SatisfyRequirement: 'satisfy',
	Concern: 'concern',
	Calculation: 'calc',
	Case: 'case',
	AnalysisCase: 'analysis',
	VerificationCase: 'verification',
	UseCase: 'use case',
	IncludeUseCase: 'use case',
	View: 'view',
	Viewpoint: 'viewpoint',
	Rendering: 'rendering',
	Metadata: 'metadata',
	Connection: 'connection',
	Interface: 'interface',
	Allocation: 'allocation',
	Flow: 'flow',
	SuccessionFlow: 'flow',
	BindingConnectorAs: 'binding',
	SuccessionAs: 'succession',
	Reference: 'ref'
};

/** The app's kind for an element: `part`, `requirement`, `subject`, …. */
export function kindOf(
	metaclass: string,
	membership: string | null = null,
	redefinedMetaclass: string | null = null
): string {
	if (membership && MEMBERSHIP_KINDS[membership] && !metaclass.endsWith('Definition'))
		return MEMBERSHIP_KINDS[membership]!;
	// `:>> priority = …` is a reference usage; it is what it redefines.
	if (metaclass === 'ReferenceUsage' && redefinedMetaclass && redefinedMetaclass !== metaclass)
		return kindOf(redefinedMetaclass);
	if (metaclass === 'UseCaseDefinition') return 'use_case';
	const base = metaclass.replace(/(Definition|Usage)$/, '');
	return KINDS[base] ?? (base.charAt(0).toLowerCase() + base.slice(1) || 'element');
}

/** A declaration up to its body or its end: `part rotors : Rotor[4]`. */
export function declarationHeader(text: string): string {
	let depth = 0;
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (quote) {
			if (c === quote) quote = null;
			continue;
		}
		if (c === "'" || c === '"') quote = c;
		else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		} else if (c === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end;
		} else if (c === '(' || c === '[') depth++;
		else if (c === ')' || c === ']') depth--;
		else if (depth === 0 && (c === '{' || c === ';')) return text.slice(0, i).trim();
	}
	return text.trim();
}

/** `part def A :> B, C` → `[B, C]`: specializations as written, when the model has none to give. */
export function writtenSpecializations(header: string): string[] {
	const masked = header.replace(/'(?:[^'\\]|\\.)*'/g, (q) => q.replace(/[^']/g, 'x'));
	const match = /(?::>(?!>)|\b(?:subsets|specializes)\b)\s*/.exec(masked);
	if (!match) return [];
	const from = match.index + match[0].length;
	const rest = masked.slice(from);
	const stop = /\s*(?:=|:=|:>>|:>|(?<!:):(?!:)|\[|\bredefines\b|\bsubsets\b|\bdefault\b|$)/.exec(
		rest
	);
	const list = header.slice(from, from + (stop ? stop.index : rest.length));
	return list
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** The `filter …;` conditions directly in a view's body (not its nested views'). */
export function viewFilters(text: string): string[] {
	const filters: string[] = [];
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === "'" || c === '"') {
			const end = text.indexOf(c, i + 1);
			i = end < 0 ? text.length : end;
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		} else if (c === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end;
		} else if (c === '{') depth++;
		else if (c === '}') depth--;
		else if (
			depth === 1 &&
			/\bfilter\s/y.test(text.slice(i, i + 7)) &&
			/[\s{;]/.test(text[i - 1] ?? ' ')
		) {
			const end = text.indexOf(';', i);
			if (end < 0) break;
			filters.push(text.slice(i + 6, end).trim());
			i = end;
		}
	}
	return filters;
}

/** `connect a.b to c.d` or `connect (a, b)` → its two ends, as written. */
export function connectionEnds(header: string): [string, string] | null {
	const squash = (s: string) => s.replace(/\s+/g, '');
	const pair = /\bconnect\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/.exec(header);
	if (pair) return [squash(pair[1]!), squash(pair[2]!)];
	const to = /\bconnect\s+([\s\S]+?)\s+to\s+([\s\S]+)$/.exec(header);
	return to ? [squash(to[1]!), squash(to[2]!)] : null;
}

/** The multiplicity as written (`4`, `0..*`), from a declaration header. */
/** `ref part rotors = (…)`: a usage that refers to parts owned elsewhere, not a part of its own. */
export function isReference(r: ElementRecord): boolean {
	return /^\s*(?:(?:in|out|inout|abstract|variation|readonly|derived|constant|end)\s+)*ref\b/.test(
		r.header
	);
}

export function multiplicityOf(header: string): string | null {
	// Only before the value: `= 650 [g]` has a unit in brackets, not a multiplicity.
	const declaration = header.split(/\s(?:=|:=|default)\s/)[0] ?? header;
	const masked = declaration.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, (s) =>
		' '.repeat(s.length)
	);
	const match = /\[([^\]]*)\]/.exec(masked);
	if (!match) return null;
	return declaration.slice(match.index + 1, match.index + 1 + match[1]!.length).trim() || null;
}

/** The element's editable declaration parts, for the inspector. */
export function detailsOf(
	record: ElementRecord,
	spellShortName: (s: string) => string
): ElementDetails {
	void spellShortName;
	const multiplicity = record.isDefinition ? null : multiplicityOf(record.header);
	const valueKind: ElementDetails['valueKind'] | undefined =
		record.value === null
			? undefined
			: record.valueIsDefault
				? 'default'
				: /:=/.test(record.header)
					? 'initial'
					: 'bind';
	const details: ElementDetails = {
		name: record.written ?? record.name ?? '',
		kind: record.kind,
		isDefinition: record.isDefinition,
		specializes: record.specializes,
		qualifiedName: record.qualifiedName ?? ''
	};
	if (record.shortName) details.shortName = record.shortName;
	if (record.type) details.type = record.type;
	if (record.conjugated) details.conjugated = true;
	if (record.redefines) details.redefines = record.redefines;
	if (multiplicity) details.multiplicity = multiplicity;
	if (record.value !== null) {
		details.value = record.value;
		details.valueKind = valueKind;
	}
	if (record.direction && !record.isDefinition && record.kind !== 'subject')
		details.direction = record.direction;
	if (record.abstract) details.abstract = true;
	if (record.readonly) details.readonly = true;
	if (record.derived) details.derived = true;
	if (record.end) details.end = true;
	if (record.docs.length) details.doc = record.docs.join('\n\n');
	return details;
}

/** Find the element the inspector means: by file, 1-based line and name as written. */
export function findElement(
	elements: ElementRecord[],
	path: string,
	line: number,
	name: string | null
): ElementRecord | undefined {
	const inFile = elements.filter((e) => e.path === path && e.name);
	const nameMatches = (e: ElementRecord) => !name || e.written === name || e.name === name;
	return (
		inFile.find((e) => e.span.start_row === line && nameMatches(e)) ??
		inFile
			.filter((e) => e.span.start_row <= line && e.span.end_row >= line && nameMatches(e))
			.sort((a, b) => b.span.start_byte - a.span.start_byte)[0] ??
		inFile.find((e) => nameMatches(e) && !!name)
	);
}

export type { TkElement };
