/**
 * Turning spreadsheet rows into requirements: what the model offers (its
 * requirement definitions, their attributes and enumerations, its packages
 * and the requirements already there), which column means what, and the
 * plan of what an import will create, update or skip.
 */
import type { Analysis } from '#lib/engine/types.ts';
import { collectElements, type ModelElement } from '#lib/project/elements.ts';
import type { RequirementRow } from '#lib/project/requirements.ts';
import { lastSegment, stringValue, unescapeName } from '#lib/project/names.ts';
import { sysmlName, type RequirementSpec } from './sysml-text';

// ---------------------------------------------------------------------------
// What the model offers

export interface AttributeInfo {
	name: string;
	/** The attribute's type as written, e.g. `Priority`. */
	type: string | null;
	valueKind: 'enum' | 'string' | 'number' | 'boolean';
	/** For enums: the enumeration's name and its literals. */
	enumName?: string;
	literals?: string[];
	/** The package that owns the enumeration (qualified), to import it. */
	enumPackage?: string;
	/** `[0..*]` and the like: several values. */
	many: boolean;
}

export interface RequirementDefInfo {
	/** Name as written (may be quoted). */
	name: string;
	label: string;
	/** Qualified name of the package that owns it. */
	package: string | null;
	file: string;
	attributes: AttributeInfo[];
	/** How many requirements in the model are typed by it. */
	used: number;
}

export interface PackageInfo {
	/** Name as written. */
	name: string;
	/** `Outer::Inner`, as written. */
	qualifiedName: string;
	file: string;
	/** 1-based line of its declaration. */
	line: number;
	/** Names of members it owns directly, unescaped. */
	members: string[];
	/** The ReqIF IDENTIFIER of the specification or heading it was imported from (`@ReqIF`). */
	reqif?: string;
}

export interface ExistingRequirement {
	row: RequirementRow;
	/** Qualified name as written, as the engine's `setField` expects. */
	qualifiedName: string;
	/** Name as written (for `rename`). */
	name: string;
	/** Current values by `setField` field (`feature:priority`, `metadata:StatusInfo.owner`). */
	values: Record<string, string>;
}

export interface ImportContext {
	defs: RequirementDefInfo[];
	packages: PackageInfo[];
	/** Existing requirements by ID. */
	byId: Map<string, ExistingRequirement>;
	/** Every requirement in the model, IDs or not, in the order of the files. */
	requirements: ExistingRequirement[];
	/** Requirements imported from ReqIF, by the IDENTIFIER they had there (`@ReqIF`). */
	byReqif: Map<string, ExistingRequirement>;
	/** Paths of the project's files. */
	paths: string[];
	/** Top-level package names (to pick a fresh one). */
	topLevel: string[];
}

/** The metadata that keeps a ReqIF IDENTIFIER in the model (`ReqIFInterchange::ReqIF`). */
export const REQIF_METADATA = 'ReqIF';

/** `ModelingMetadata::StatusKind` from the standard library. */
export const STATUS_KINDS = ['open', 'tbd', 'tbr', 'tbc', 'done', 'closed'];

const NUMBER_TYPES = /^(ScalarValues::)?(Real|Integer|Natural|Rational|Number|Positive)$/;
const STRING_TYPES = /^(ScalarValues::)?String$/;
const BOOLEAN_TYPES = /^(ScalarValues::)?Boolean$/;

/** Elements that contain `element` in the same file, outermost first. */
function containers(element: ModelElement, inFile: ModelElement[]): ModelElement[] {
	const { start_byte: start, end_byte: end } = element.span;
	return inFile
		.filter(
			(e) =>
				e !== element &&
				e.span.start_byte <= start &&
				e.span.end_byte >= end &&
				(e.span.start_byte < start || e.span.end_byte > end)
		)
		.sort((a, b) => a.span.start_byte - b.span.start_byte || b.span.end_byte - a.span.end_byte);
}

function qualified(element: ModelElement, inFile: ModelElement[]): string {
	return [...containers(element, inFile).map((c) => c.name), element.name].join('::');
}

function owningPackage(element: ModelElement, inFile: ModelElement[]): string | null {
	const chain = containers(element, inFile);
	const index = chain.findLastIndex((c) => c.kind === 'package');
	return index < 0
		? null
		: chain
				.slice(0, index + 1)
				.map((c) => c.name)
				.join('::');
}

/** Whether a multiplicity (`[0..*]`, or the engine's `{ lower, upper }`) allows several values. */
function isMany(multiplicity: unknown): boolean {
	if (!multiplicity) return false;
	if (typeof multiplicity === 'object') {
		const upper = (multiplicity as { upper?: string | null }).upper;
		return upper === null || upper === undefined || upper === '*' || Number(upper) > 1;
	}
	return /\*|\.\.\s*([2-9]|\d{2,})/.test(String(multiplicity));
}

/** A value expression as people read it: `(V::test, V::analysis)` → `test, analysis`. */
export function displayValue(expression: string): string {
	const e = expression.trim();
	if (e.startsWith('(') && e.endsWith(')')) {
		return e
			.slice(1, -1)
			.split(',')
			.map((v) => displayValue(v))
			.join(', ');
	}
	if (e.startsWith('"')) return stringValue(e);
	return e.includes('::') ? lastSegment(e) : e;
}

/** Literal names of an `enum def`, read from its text (`enum high;` or `high;`). */
export function enumLiterals(text: string): string[] {
	const open = text.indexOf('{');
	const close = text.lastIndexOf('}');
	if (open < 0 || close < open) return [];
	const body = text
		.slice(open + 1, close)
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, ' ')
		.replace(/\bdoc\b/g, ' ');
	const literals: string[] = [];
	let depth = 0;
	let statement = '';
	for (const c of body) {
		if (c === '{') {
			if (depth === 0) pushLiteral(statement, literals);
			depth++;
			statement = '';
		} else if (c === '}') {
			depth--;
			statement = '';
		} else if (c === ';' && depth === 0) {
			pushLiteral(statement, literals);
			statement = '';
		} else if (depth === 0) statement += c;
	}
	return literals;
}

function pushLiteral(statement: string, literals: string[]) {
	const m = /^\s*(?:enum\s+)?([A-Za-z_]\w*|'(?:[^'\\]|\\.)*')\s*(?::>>?[^;]*|=[^;]*)?\s*$/.exec(
		statement
	);
	if (m && !/^(private|public|import|attribute|alias)$/.test(m[1]!)) {
		literals.push(unescapeName(m[1]!));
	}
}

/** Text of an element's span (spans are in UTF-8 bytes). */
function spanText(source: string, element: ModelElement, encoded: Map<string, Uint8Array>) {
	let bytes = encoded.get(element.file);
	if (!bytes) {
		bytes = new TextEncoder().encode(source);
		encoded.set(element.file, bytes);
	}
	return new TextDecoder().decode(bytes.subarray(element.span.start_byte, element.span.end_byte));
}

export function buildContext(
	analyses: Analysis[],
	files: Record<string, string>,
	requirements: RequirementRow[]
): ImportContext {
	const elements = collectElements(analyses);
	const byFile = new Map<string, ModelElement[]>();
	for (const e of elements) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
	const inFile = (e: ModelElement) => byFile.get(e.file) ?? [];
	const encoded = new Map<string, Uint8Array>();

	const enums = new Map<string, { literals: string[]; package: string | null }>();
	for (const e of elements) {
		if (e.kind === 'enum' && e.isDefinition) {
			const text = spanText(files[e.file] ?? '', e, encoded);
			enums.set(e.label, { literals: enumLiterals(text), package: owningPackage(e, inFile(e)) });
		}
	}

	const defElements = elements.filter((e) => e.kind === 'requirement' && e.isDefinition);
	const attributesOf = (def: ModelElement, seen: Set<string>): AttributeInfo[] => {
		if (seen.has(def.label)) return [];
		seen.add(def.label);
		const own = inFile(def)
			.filter(
				(e) =>
					e.kind === 'attribute' &&
					!e.isDefinition &&
					e.parent === def.name &&
					containers(e, inFile(def)).at(-1) === def
			)
			.map((e): AttributeInfo => {
				const type = e.typeRef?.replace(/\[.*$/, '').trim() ?? null;
				const enumName = type ? (type.split('::').pop() ?? type) : '';
				const en = enums.get(unescapeName(enumName));
				const many = isMany(e.multiplicity);
				if (en) {
					return {
						name: e.label,
						type,
						valueKind: 'enum',
						enumName,
						literals: en.literals,
						enumPackage: en.package ?? undefined,
						many
					};
				}
				const valueKind = NUMBER_TYPES.test(type ?? '')
					? 'number'
					: BOOLEAN_TYPES.test(type ?? '')
						? 'boolean'
						: 'string';
				return { name: e.label, type, valueKind, many };
			})
			.filter(
				(a) => a.valueKind === 'enum' || STRING_TYPES.test(a.type ?? '') || a.valueKind !== 'string'
			);
		const superName = def.typeRef?.split('::').pop();
		const parent = superName
			? defElements.find((d) => d.label === unescapeName(superName))
			: undefined;
		const inherited = parent ? attributesOf(parent, seen) : [];
		const names = new Set(own.map((a) => a.name));
		return [...inherited.filter((a) => !names.has(a.name)), ...own];
	};

	const usage = new Map<string, number>();
	for (const e of elements) {
		if (e.kind === 'requirement' && !e.isDefinition && e.typeRef) {
			const name = unescapeName(e.typeRef.split('::').pop() ?? '');
			usage.set(name, (usage.get(name) ?? 0) + 1);
		}
	}

	const defs: RequirementDefInfo[] = defElements.map((d) => ({
		name: d.name,
		label: d.label,
		package: owningPackage(d, inFile(d)),
		file: d.file,
		attributes: attributesOf(d, new Set()),
		used: usage.get(d.label) ?? 0
	}));

	const models = new Map(analyses.map((a) => [a.model.file, a.model]));
	/** The `@ReqIF { identifier = "…"; }` an element carries itself. */
	const reqifOf = (element: ModelElement): string | undefined => {
		const annotation = (models.get(element.file)?.annotations ?? []).find(
			(a) =>
				lastSegment(a.metadata_type) === REQIF_METADATA &&
				(a.target === element.name || unescapeName(a.target) === element.label) &&
				a.span.start_byte >= element.span.start_byte &&
				a.span.end_byte <= element.span.end_byte
		);
		const value = annotation?.values.find(([field]) => field === 'identifier')?.[1];
		return value ? stringValue(value) : undefined;
	};

	const packages: PackageInfo[] = elements
		.filter((e) => e.kind === 'package' && e.isDefinition && !e.file.startsWith('libraries/'))
		.map((p) => {
			const reqif = reqifOf(p);
			return {
				name: p.name,
				qualifiedName: qualified(p, inFile(p)),
				file: p.file,
				line: p.span.start_row,
				members: inFile(p)
					.filter((e) => containers(e, inFile(p)).at(-1) === p)
					.map((e) => e.label),
				...(reqif ? { reqif } : {})
			};
		});

	const byKey = new Map(elements.map((e) => [e.key, e]));
	const byId = new Map<string, ExistingRequirement>();
	const byReqif = new Map<string, ExistingRequirement>();
	const all: ExistingRequirement[] = [];
	for (const row of requirements) {
		const element = byKey.get(`${row.file}@${row.span.start_byte}`);
		if (!element) continue;
		const model = models.get(row.file);
		const values: Record<string, string> = {};
		for (const u of model?.usages ?? []) {
			if (
				u.kind === 'attribute' &&
				u.parent_def === element.name &&
				u.redefinition &&
				u.value_expr
			) {
				values[`feature:${u.redefinition}`] = displayValue(u.value_expr);
			}
		}
		for (const a of model?.annotations ?? []) {
			if (a.target !== element.name) continue;
			for (const [field, value] of a.values) {
				values[`metadata:${lastSegment(a.metadata_type)}.${field}`] = displayValue(value);
			}
		}
		const existing: ExistingRequirement = {
			row,
			qualifiedName: qualified(element, inFile(element)),
			name: element.name,
			values
		};
		all.push(existing);
		if (row.id && !byId.has(row.id)) byId.set(row.id, existing);
		const reqif = values[`metadata:${REQIF_METADATA}.identifier`];
		if (reqif && !byReqif.has(reqif)) byReqif.set(reqif, existing);
	}

	return {
		defs,
		packages,
		byId,
		requirements: all,
		byReqif,
		paths: Object.keys(files),
		topLevel: elements
			.filter((e) => e.kind === 'package' && !containers(e, inFile(e)).length)
			.map((e) => e.label)
	};
}

/** The definition to suggest: the one most requirements use, else the richest. */
export function defaultDef(context: ImportContext): RequirementDefInfo | null {
	return (
		context.defs.toSorted(
			(a, b) => b.used - a.used || b.attributes.length - a.attributes.length
		)[0] ?? null
	);
}

/** A file and package name for a new import that clash with nothing. */
export function freshTarget(context: ImportContext): { path: string; name: string } {
	for (let n = 1; ; n++) {
		const name = n === 1 ? 'Imported' : `Imported${n}`;
		const path = `requirements/${name}.sysml`;
		if (!context.paths.includes(path) && !context.topLevel.includes(name)) return { path, name };
	}
}

// ---------------------------------------------------------------------------
// Columns

/** What a column becomes: a part of each requirement, or nothing. */
export type Target =
	| ''
	| 'id'
	| 'name'
	| 'doc'
	| 'status'
	| 'owner'
	| 'originator'
	| 'rationale'
	| 'issue'
	| 'parent'
	| 'heading'
	| `attr:${string}`;

export interface TargetOption {
	value: Target;
	label: string;
}

export const FIXED_TARGETS: TargetOption[] = [
	{ value: 'id', label: 'ID (short name)' },
	{ value: 'name', label: 'Title (name)' },
	{ value: 'doc', label: 'Text (doc)' },
	{ value: 'status', label: 'Status' },
	{ value: 'owner', label: 'Owner' },
	{ value: 'originator', label: 'Originator' },
	{ value: 'rationale', label: 'Rationale' },
	{ value: 'issue', label: 'Open issue' },
	{ value: 'parent', label: 'Derived from (parent ID)' }
];

/** Every target for a definition: the fixed ones and its attributes. */
export function targetOptions(def: RequirementDefInfo | null): TargetOption[] {
	const attributes = (def?.attributes ?? []).map((a) => ({
		value: `attr:${a.name}` as Target,
		label: attributeLabel(a.name)
	}));
	return [...FIXED_TARGETS.slice(0, 3), ...attributes, ...FIXED_TARGETS.slice(3)];
}

/** `verificationMethod` → `Verification method`. */
export function attributeLabel(name: string): string {
	const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalize(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADERS: [Target, RegExp][] = [
	[
		'id',
		/^(id|reqid|requirementid|reqno|requirementno|requirementnumber|reqnumber|no|nr|num|number|ref|reference|key|identifier|shortname|tag|uid|req|reqref)$/
	],
	[
		'name',
		/^(title|name|summary|heading|shorttitle|requirementtitle|requirementname|reqtitle|reqname)$/
	],
	[
		'doc',
		/^(text|description|desc|requirement|requirements|requirementtext|requirementdescription|statement|shallstatement|requirementstatement|shall|details|body|content|reqtext|specification)$/
	],
	['attr:priority', /^(priority|prio|importance|moscow|criticality)$/],
	[
		'attr:kind',
		/^(kind|type|category|class|classification|requirementtype|reqtype|requirementkind|requirementcategory)$/
	],
	[
		'attr:verificationMethod',
		/^(verificationmethods?|verification|verifmethods?|vmethods?|methods?|ivv|ivvmethods?|vvmethods?|verifytype|verificationtype)$/
	],
	['status', /^(status|state|lifecycle|lifecyclestate|reqstatus|requirementstatus)$/],
	['owner', /^(owner|responsible|assignee|assignedto|responsibleperson|accountable)$/],
	['originator', /^(originator|source|stakeholder|requestedby|requester|origin|author|raisedby)$/],
	['rationale', /^(rationale|justification|reason|why)$/],
	['issue', /^(issues?|openissues?|openpoints?|openquestions?)$/],
	[
		'parent',
		/^(parent|parents|parentid|parentids|parentrequirement|parentreq|derivedfrom|derivesfrom|tracesto|traceto|upstream|sourcerequirement|refines)$/
	]
];

/** What each heading most likely means; each target is used at most once. */
export function detectTargets(headers: string[], def: RequirementDefInfo | null): Target[] {
	const used = new Set<Target>();
	const attributes = new Map((def?.attributes ?? []).map((a) => [normalize(a.name), a.name]));
	return headers.map((header) => {
		const key = normalize(header);
		if (!key) return '';
		const attribute = attributes.get(key);
		const target: Target = attribute
			? `attr:${attribute}`
			: (HEADERS.find(([, pattern]) => pattern.test(key))?.[0] ?? '');
		if (!target || used.has(target)) return '';
		used.add(target);
		return target;
	});
}

/** The row that holds the headings: the first of the top rows that names two known columns. */
export function detectHeaderRow(rows: string[][]): number {
	for (let r = 0; r < Math.min(rows.length, 10); r++) {
		const known = detectTargets(rows[r] ?? [], null).filter(Boolean).length;
		if (known >= 2) return r;
	}
	return Math.max(
		0,
		rows.findIndex((row) => row.some((c) => c.trim() !== ''))
	);
}

// ---------------------------------------------------------------------------
// Values

const SYNONYMS: Record<string, string> = {
	must: 'high',
	musthave: 'high',
	critical: 'high',
	should: 'medium',
	shouldhave: 'medium',
	could: 'low',
	couldhave: 'low',
	nicetohave: 'low',
	tobedetermined: 'tbd',
	toberesolved: 'tbr',
	tobeconfirmed: 'tbc',
	complete: 'done',
	completed: 'done'
};

/** The literal a cell means: exact, ignoring case and punctuation, a known synonym, or a unique prefix. */
export function matchLiteral(value: string, literals: string[]): string | null {
	const v = value.trim();
	if (!v) return null;
	const exact = literals.find((l) => l.toLowerCase() === v.toLowerCase());
	if (exact) return exact;
	const key = normalize(v);
	if (!key) return null;
	const loose = literals.find((l) => normalize(l) === key);
	if (loose) return loose;
	const synonym = SYNONYMS[key];
	if (synonym && literals.includes(synonym)) return synonym;
	const prefixed = literals.filter((l) => normalize(l).startsWith(key));
	return prefixed.length === 1 ? prefixed[0]! : null;
}

/** Split a list cell: `Test, Analysis`, `T/A`, `test; inspection`, one per line. */
export function splitList(value: string): string[] {
	return value
		.split(/[,;/+&\n]|\band\b/)
		.map((v) => v.trim())
		.filter(Boolean);
}

// ---------------------------------------------------------------------------
// The plan

export interface ImportOptions {
	/** Columns of the sheet's rows. */
	targets: Target[];
	def: RequirementDefInfo | null;
	/** An existing package, or a new file. */
	destination:
		{ kind: 'package'; package: PackageInfo } | { kind: 'new'; path: string; name: string };
	/** What to do with rows whose ID is already in the model. */
	existing: 'skip' | 'update';
	/**
	 * A key per row that finds it in the model before its ID does: the ReqIF
	 * IDENTIFIER of the object it comes from (`context.byReqif`).
	 */
	keys?: (string | undefined)[];
	/** What the notes count: `rows` (the default) or `objects`. */
	unit?: string;
}

export interface PlannedRequirement {
	/** 1-based row number in the sheet. */
	line: number;
	spec: RequirementSpec;
	/** IDs of the requirements it is derived from. */
	parents: string[];
}

export interface FieldChange {
	/** For `setField`: `doc`, `feature:priority`, `metadata:StatusInfo.status`…; `name` renames. */
	field: string;
	label: string;
	from: string;
	to: string;
}

export interface PlannedUpdate {
	line: number;
	existing: ExistingRequirement;
	changes: FieldChange[];
}

export interface ImportPlan {
	create: PlannedRequirement[];
	update: PlannedUpdate[];
	/** Rows whose ID is in the model and nothing differs (or updates are off). */
	unchanged: number;
	skipped: { line: number; reason: string }[];
	/** Notes about values left out, grouped. */
	notes: string[];
	/** Derivations: parent reference → derived names. */
	derivations: { original: string; derived: string[] }[];
	/** Packages to import into the destination (`EngineeringBasics::*`). */
	imports: string[];
}

function cellText(text: string): string {
	return text.replace(/\r\n?/g, '\n').trim();
}

/** The doc text people read: comment stars and line breaks folded into spaces. */
export function plainText(text: string): string {
	return text
		.replace(/\n\s*\*(?!\/) ?/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export class Notes {
	private groups = new Map<string, Map<string, number>>();
	/** What is counted: rows of a sheet, objects of a ReqIF file. */
	constructor(private readonly unit = 'rows') {}
	add(group: string, value: string) {
		const values = this.groups.get(group) ?? new Map<string, number>();
		values.set(value, (values.get(value) ?? 0) + 1);
		this.groups.set(group, values);
	}
	list(): string[] {
		return [...this.groups].map(([group, values]) => {
			const shown = [...values]
				.slice(0, 5)
				.map(([v, n]) => (n > 1 ? `‘${v}’ (${n} ${this.unit})` : `‘${v}’`))
				.join(', ');
			const more = values.size > 5 ? ` and ${values.size - 5} more` : '';
			return `${group}: ${shown}${more}.`;
		});
	}
}

function uniqueName(name: string, taken: Set<string>): string {
	let candidate = name;
	for (let n = 2; taken.has(candidate); n++) candidate = `${name} (${n})`;
	taken.add(candidate);
	return candidate;
}

/** The plan for importing `rows` (the data rows, after the heading row). */
export function planImport(
	rows: string[][],
	firstLine: number,
	options: ImportOptions,
	context: ImportContext
): ImportPlan {
	const { targets, def } = options;
	const attributes = new Map((def?.attributes ?? []).map((a) => [a.name, a]));
	const destination =
		options.destination.kind === 'package' ? options.destination.package.qualifiedName : null;
	const taken = new Set(
		options.destination.kind === 'package' ? options.destination.package.members : []
	);
	const notes = new Notes(options.unit);
	const plan: ImportPlan = {
		create: [],
		update: [],
		unchanged: 0,
		skipped: [],
		notes: [],
		derivations: [],
		imports: []
	};
	const seenIds = new Set<string>();
	const column = (target: Target) => targets.indexOf(target);

	rows.forEach((cells, index) => {
		const line = firstLine + index;
		if (cells.every((c) => !c.trim())) return;
		const get = (target: Target) => {
			const c = column(target);
			return c < 0 ? '' : cellText(cells[c] ?? '');
		};
		// Names cannot hold a plain apostrophe yet (see `sysmlName`): use ’ from the start.
		const id = get('id').replace(/\s+/g, ' ').replace(/'/g, '’');
		const title = get('name').replace(/\s+/g, ' ').replace(/'/g, '’');
		const doc = get('doc');
		if (!id && !title && !doc) {
			plan.skipped.push({ line, reason: 'no ID, title or text' });
			return;
		}
		if (id && seenIds.has(id)) {
			plan.skipped.push({ line, reason: `${id} appears more than once in the sheet` });
			return;
		}
		if (id) seenIds.add(id);

		const spec: RequirementSpec = { id: id || undefined, name: title || id, attributes: [] };
		if (!spec.name) spec.name = `Requirement ${line}`;
		if (doc) spec.doc = doc;

		targets.forEach((target, c) => {
			if (!target.startsWith('attr:')) return;
			const raw = cellText(cells[c] ?? '');
			if (!raw) return;
			const attribute = attributes.get(target.slice(5));
			if (!attribute) return;
			const label = attributeLabel(attribute.name);
			if (attribute.valueKind === 'enum') {
				const values = attribute.many ? splitList(raw) : [raw];
				const literals: string[] = [];
				for (const v of values) {
					const literal = matchLiteral(v, attribute.literals ?? []);
					if (literal) {
						if (!literals.includes(literal)) literals.push(literal);
					} else
						notes.add(
							`${label} values that are not one of ${(attribute.literals ?? []).join(', ')}, left out`,
							v
						);
				}
				if (literals.length) {
					spec.attributes.push({
						name: attribute.name,
						value: {
							kind: 'enum',
							enumName: attribute.enumName!,
							literals,
							many: attribute.many
						}
					});
				}
			} else if (attribute.valueKind === 'number') {
				const n = raw.replace(',', '.');
				if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(n)) {
					spec.attributes.push({ name: attribute.name, value: { kind: 'number', value: n } });
				} else notes.add(`${label} values that are not numbers, left out`, raw);
			} else if (attribute.valueKind === 'boolean') {
				const yes = /^(true|yes|y|x|1)$/i.test(raw);
				const no = /^(false|no|n|0)$/i.test(raw);
				if (yes || no) {
					spec.attributes.push({ name: attribute.name, value: { kind: 'boolean', value: yes } });
				} else notes.add(`${label} values that are not yes or no, left out`, raw);
			} else {
				spec.attributes.push({ name: attribute.name, value: { kind: 'string', value: raw } });
			}
		});
		// Keep the definition's order of attributes, as people read them.
		const order = [...attributes.keys()];
		spec.attributes.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

		const status = get('status');
		if (status) {
			const literal = matchLiteral(status, STATUS_KINDS);
			if (literal) spec.status = literal;
			else notes.add(`Statuses that are not one of ${STATUS_KINDS.join(', ')}, left out`, status);
		}
		if (get('owner')) spec.owner = get('owner');
		if (get('originator')) spec.originator = get('originator');
		if (get('rationale')) spec.rationale = get('rationale');
		if (get('issue')) spec.issues = [get('issue')];
		const parents = splitList(get('parent').replace(/\//g, ','));

		const key = options.keys?.[index];
		const existing =
			(key ? context.byReqif.get(key) : undefined) ?? (id ? context.byId.get(id) : undefined);
		if (existing) {
			if (options.existing === 'skip') {
				plan.skipped.push({ line, reason: `${id || title || 'it'} is already in the model` });
				return;
			}
			const changes = changesFor(existing, spec, targets);
			if (changes.length) plan.update.push({ line, existing, changes });
			else plan.unchanged++;
			return;
		}

		spec.name = uniqueName(spec.name, taken);
		if (def) spec.type = def.name;
		plan.create.push({ line, spec, parents });
	});

	// Derivations: parents found among the new rows or the model's requirements.
	const created = new Map(plan.create.filter((p) => p.spec.id).map((p) => [p.spec.id!, p]));
	const groups = new Map<string, string[]>();
	for (const item of plan.create) {
		for (const parent of item.parents) {
			let reference: string | null = null;
			const sibling = created.get(parent);
			if (sibling) reference = sysmlName(sibling.spec.name);
			else {
				const found = context.byId.get(parent);
				if (found) {
					const within = destination && found.qualifiedName.startsWith(`${destination}::`);
					reference = within
						? found.qualifiedName.slice(destination.length + 2)
						: found.qualifiedName;
				}
			}
			if (!reference) {
				notes.add(
					'Parent IDs that are not in the model or the sheet, so no derivation was made',
					parent
				);
				continue;
			}
			groups.set(reference, [...(groups.get(reference) ?? []), sysmlName(item.spec.name)]);
		}
	}
	plan.derivations = [...groups].map(([original, derived]) => ({ original, derived }));

	// What the destination package must import for the new text to resolve.
	const needs = new Set<string>();
	const usesMetadata = plan.create.some(
		(p) => p.spec.status || p.spec.owner || p.spec.originator || p.spec.rationale || p.spec.issues
	);
	if (usesMetadata) needs.add('ModelingMetadata::*');
	if (plan.derivations.length) needs.add('RequirementDerivation::*');
	const used = new Set(plan.create.flatMap((p) => p.spec.attributes.map((a) => a.name)));
	const enumPackages = new Set(
		(def?.attributes ?? [])
			.filter((a) => used.has(a.name) && a.enumPackage)
			.map((a) => a.enumPackage!)
	);
	for (const pkg of enumPackages) needs.add(`${pkg}::*`);
	if (def?.package && plan.create.length && !enumPackages.has(def.package)) {
		needs.add(`${def.package}::${def.name}`);
	}
	plan.imports = [...needs].filter((imp) => {
		const pkg = imp.replace(/::[^:]+$/, '');
		return !destination || !(destination === pkg || destination.startsWith(`${pkg}::`));
	});

	plan.notes = notes.list();
	return plan;
}

/** The fields an update would change on an existing requirement: only those the sheet fills and that differ. */
function changesFor(
	existing: ExistingRequirement,
	spec: RequirementSpec,
	targets: Target[]
): FieldChange[] {
	const row = existing.row;
	const changes: FieldChange[] = [];
	const add = (field: string, label: string, from: string | null, to: string | undefined) => {
		if (to === undefined || to === '') return;
		if ((from ?? '') === to) return;
		changes.push({ field, label, from: from ?? '', to });
	};
	if (targets.includes('name') && spec.name !== spec.id) add('name', 'Title', row.title, spec.name);
	if (spec.doc !== undefined && plainText(row.text) !== plainText(spec.doc)) {
		changes.push({ field: 'doc', label: 'Text', from: plainText(row.text), to: spec.doc });
	}
	const current = existing.values;
	for (const { name, value } of spec.attributes) {
		const to =
			value.kind === 'enum'
				? value.literals.join(', ')
				: value.kind === 'boolean'
					? String(value.value)
					: value.value;
		add(`feature:${name}`, attributeLabel(name), current[`feature:${name}`] ?? null, to);
	}
	const meta = (field: string) => current[`metadata:${field}`] ?? null;
	add('metadata:StatusInfo.status', 'Status', meta('StatusInfo.status'), spec.status);
	add('metadata:StatusInfo.owner', 'Owner', meta('StatusInfo.owner'), spec.owner);
	add(
		'metadata:StatusInfo.originator',
		'Originator',
		meta('StatusInfo.originator'),
		spec.originator
	);
	add('metadata:Rationale.text', 'Rationale', meta('Rationale.text'), spec.rationale);
	return changes;
}
