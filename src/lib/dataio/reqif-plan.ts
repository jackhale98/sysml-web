/**
 * Turning a ReqIF file into requirements: which attribute means what (the
 * way spreadsheet columns are matched), what each spec object type becomes
 * (a requirement, a heading, or nothing), what each relation type becomes
 * (a derivation, a refinement, or nothing), and the plan of what an import
 * will create, update and leave out.
 *
 * Specifications and headings become packages, nested as the file nests
 * them; requirements go into the package of the heading they are under (a
 * requirement under another requirement goes next to it, in the same
 * package). Each keeps the IDENTIFIER it has in the file as `@ReqIF`
 * metadata, so the next import of the same file finds it and updates it in
 * place, and puts what is new into the package it belongs in.
 */
import { packageName } from '#lib/project/sources.ts';
import { unescapeName } from '#lib/project/names.ts';
import {
	detectTargets,
	Notes,
	planImport,
	REQIF_METADATA,
	targetOptions,
	type ExistingRequirement,
	type ImportContext,
	type ImportOptions,
	type ImportPlan,
	type PackageInfo,
	type PlannedRequirement,
	type RequirementDefInfo,
	type Target,
	type TargetOption
} from './import-plan';
import type { ReqifDocument, ReqifKind, ReqifNode, ReqifObject, ReqifType } from './reqif';
import { derivationText, reqifAnnotation, requirementText, sysmlName } from './sysml-text';

/** Where the ReqIF metadata definition lives, and the file a project gets it in. */
export const REQIF_PACKAGE = 'ReqIFInterchange';
export const REQIF_LIBRARY_PATH = 'libraries/ReqIFInterchange.sysml';

// ---------------------------------------------------------------------------
// Attributes, object types and relation types

export interface ReqifColumn {
	/** The attribute's LONG-NAME; attributes of the same name in several types are one column. */
	name: string;
	kind: ReqifKind;
	/** The attribute definitions it stands for. */
	ids: string[];
}

/** The spec object types' attributes, one column per name, in the order the types give them. */
export function reqifColumns(doc: ReqifDocument): ReqifColumn[] {
	const columns: ReqifColumn[] = [];
	for (const type of doc.types.values()) {
		if (type.kind !== 'object') continue;
		for (const a of type.attributes) {
			const column = columns.find((c) => c.name === a.name);
			if (column) column.ids.push(a.id);
			else columns.push({ name: a.name, kind: a.kind, ids: [a.id] });
		}
	}
	return columns;
}

export type ObjectRole = 'requirement' | 'heading' | 'skip';

export const OBJECT_ROLES: { value: ObjectRole; label: string }[] = [
	{ value: 'requirement', label: 'Requirements' },
	{ value: 'heading', label: 'Headings (packages)' },
	{ value: 'skip', label: 'Leave out' }
];

/** What a spec object type most likely is, by its name. */
export function defaultObjectRole(type: ReqifType): ObjectRole {
	const name = type.name.toLowerCase();
	if (/\b(heading|chapter|section|folder|title)s?\b/.test(name)) return 'heading';
	if (/^(information|info|note|comment|figure|table|image|picture|text|caption|ole)s?\b/.test(name))
		return 'skip';
	return 'requirement';
}

export type RelationRole = 'derived-from' | 'derives' | 'refines' | 'refined-by' | 'skip';

export const RELATION_ROLES: { value: RelationRole; label: string }[] = [
	{ value: 'derived-from', label: 'Derivation: the source is derived from the target' },
	{ value: 'derives', label: 'Derivation: the target is derived from the source' },
	{ value: 'refines', label: 'Refinement: the source refines the target' },
	{ value: 'refined-by', label: 'Refinement: the target refines the source' },
	{ value: 'skip', label: 'Leave out' }
];

/** What a relation type most likely means, by its name (`Derived From`, `refines`, `Refined by`). */
export function defaultRelationRole(type: ReqifType): RelationRole {
	const name = type.name.toLowerCase().replace(/[_-]+/g, ' ');
	if (/deriv/.test(name))
		return /\b(by|into|to)\b|^derives$/.test(name) ? 'derives' : 'derived-from';
	if (/refine/.test(name))
		return /\bby\b|refinement of|refined$/.test(name) ? 'refined-by' : 'refines';
	return 'skip';
}

function normalize(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The names DOORS, DOORS Next, Polarion, Jama and Codebeamer give the parts of a requirement. */
const REQIF_NAMES: [Target, string[]][] = [
	[
		'id',
		[
			'reqifforeignid',
			'absolutenumber',
			'id',
			'documentkey',
			'itemid',
			'objectidentifier',
			'objectnumber',
			'identifier'
		]
	],
	['name', ['reqifname', 'name', 'title', 'objectshorttext', 'summary', 'shorttitle']],
	['doc', ['reqiftext', 'objecttext', 'description', 'text', 'primarytext', 'requirementtext']],
	['heading', ['reqifchaptername', 'objectheading', 'chaptername', 'heading', 'chapter']],
	['attr:priority', ['priority', 'severity']]
];

/** Targets ReqIF attributes can have: the spreadsheet's, less the parent column (relations do that), plus headings. */
export function reqifTargetOptions(def: RequirementDefInfo | null): TargetOption[] {
	return [
		...targetOptions(def).filter((o) => o.value !== 'parent'),
		{ value: 'heading', label: 'Heading (chapter name)' }
	];
}

/** What each attribute most likely means; each target is used at most once. */
export function detectReqifTargets(
	columns: ReqifColumn[],
	def: RequirementDefInfo | null
): Target[] {
	const targets: Target[] = columns.map(() => '');
	const used = new Set<Target>();
	const keys = columns.map((c) => normalize(c.name));
	for (const [target, names] of REQIF_NAMES) {
		if (target.startsWith('attr:') && !def?.attributes.some((a) => `attr:${a.name}` === target))
			continue;
		for (const name of names) {
			const at = keys.findIndex((k, i) => k === name && !targets[i]);
			if (at >= 0) {
				targets[at] = target;
				used.add(target);
				break;
			}
		}
	}
	// The rest as spreadsheet headings, without DOORS' `ReqIF.` prefix.
	const rest = detectTargets(
		columns.map((c, i) => (targets[i] ? '' : c.name.replace(/^ReqIF\./i, ''))),
		def
	);
	return targets.map((t, i) => {
		if (t) return t;
		const candidate = rest[i] ?? '';
		if (!candidate || used.has(candidate) || candidate === 'parent') return '';
		used.add(candidate);
		return candidate;
	});
}

// ---------------------------------------------------------------------------
// The plan

export interface ReqifOptions {
	/** Per column of `reqifColumns`. */
	targets: Target[];
	/** By spec object type id; types not given take `defaultObjectRole`. */
	objectRoles: Record<string, ObjectRole>;
	/** By spec relation type id; types not given take `defaultRelationRole`. */
	relationRoles: Record<string, RelationRole>;
	def: RequirementDefInfo | null;
	destination: ImportOptions['destination'];
	existing: 'skip' | 'update';
}

export type PlannedNode =
	| { kind: 'package'; name: string; reqif: string; children: PlannedNode[] }
	| { kind: 'requirement'; item: PlannedRequirement };

/** What goes into one package already in the model (made by an earlier import). */
export interface PlannedAnchor {
	package: PackageInfo;
	nodes: PlannedNode[];
	relations: string[];
	imports: string[];
}

export interface ReqifPlan extends ImportPlan {
	/** New members of the destination (packages for specifications and headings, requirements). */
	root: PlannedNode[];
	/** Derivations and refinements written in the destination. */
	rootRelations: string[];
	/** The IDENTIFIER of the specification a new file stands for (one specification into a new file). */
	rootReqif?: string;
	/** New members of packages already in the model. */
	anchored: PlannedAnchor[];
	/** The project lacks the ReqIF library: add it. */
	library: boolean;
	/** How many of each the import makes. */
	counts: { packages: number; derivations: number; refinements: number };
	/** How an object is named in the preview, by the plan's line (`create`, `update`, `skipped`). */
	labels: Map<number, string>;
}

/** A requirement as people know it: its ID, else its name or the start of its text. */
function objectLabel(object: ReqifObject, columns: ReqifColumn[], targets: Target[]): string {
	const value = (target: Target) => {
		const c = targets.indexOf(target);
		return c < 0 ? '' : valueOf(object, columns[c]!).trim();
	};
	const text = value('id') || value('name') || value('heading') || value('doc') || object.id;
	return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function valueOf(object: ReqifObject, column: ReqifColumn): string {
	for (const id of column.ids) {
		const v = object.values.get(id);
		if (v !== undefined) return v;
	}
	return '';
}

/** A name for a package from a heading: one line, no plain apostrophes, not too long. */
function headingName(text: string): string {
	const line = text.split('\n').find((l) => l.trim()) ?? '';
	const name = line.replace(/\s+/g, ' ').replace(/'/g, '’').trim();
	return name.length > 80 ? `${name.slice(0, 79).trimEnd()}…` : name;
}

/** `A::'B c'::D` → `['A', "'B c'", 'D']`. */
export function splitQualified(name: string): string[] {
	return (name.match(/'(?:[^'\\]|\\.)*'|[^:]+/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** `#refinement dependency a to b` in the files, as `a → b` by last names. */
export function readRefinements(files: Record<string, string>): Set<string> {
	const out = new Set<string>();
	const NAME = String.raw`(?:'(?:[^'\\]|\\.)*'|[\w$]+)(?:\s*::\s*(?:'(?:[^'\\]|\\.)*'|[\w$]+))*`;
	const pattern = new RegExp(
		String.raw`#\s*refinement\s+dependency\s+(?:[\w$']+\s+)?(?:from\s+)?(${NAME})\s+to\s+(${NAME})`,
		'g'
	);
	for (const [path, text] of Object.entries(files)) {
		if (!/\.sysml$/.test(path) || !text.includes('refinement')) continue;
		for (const m of text.matchAll(pattern)) {
			const last = (n: string) => unescapeName(splitQualified(n).at(-1) ?? n);
			out.add(`${last(m[1]!)} → ${last(m[2]!)}`);
		}
	}
	return out;
}

/** A file and package for a new import, named after the file's specification. */
export function reqifTarget(
	doc: ReqifDocument,
	context: ImportContext
): { path: string; name: string } {
	const base =
		(doc.specifications.length === 1 ? doc.specifications[0]!.name : '') ||
		doc.title.split('/').pop() ||
		doc.name.replace(/\.reqifz?$/i, '');
	const ident = packageName(base);
	const stem = ident.startsWith("'") ? 'Imported' : ident;
	for (let n = 1; ; n++) {
		const name = n === 1 ? stem : `${stem}${n}`;
		const path = `requirements/${name}.sysml`;
		if (!context.paths.includes(path) && !context.topLevel.includes(name)) return { path, name };
	}
}

interface Slot {
	reqif: string;
	name: string;
	/** In the model already (an earlier import made it). */
	existing?: PackageInfo;
	parent: Slot | null;
	children: (Slot | number)[];
}

/** The plan for importing `doc` with `options`. */
export function planReqif(
	doc: ReqifDocument,
	options: ReqifOptions,
	context: ImportContext,
	refinements: Set<string> = new Set()
): ReqifPlan {
	const columns = reqifColumns(doc);
	const { targets } = options;
	const notes = new Notes('objects');
	const column = (target: Target) => {
		const c = targets.indexOf(target);
		return c < 0 ? undefined : columns[c];
	};
	const get = (object: ReqifObject, target: Target) => {
		const c = column(target);
		return c ? valueOf(object, c).trim() : '';
	};
	const typeName = (object: ReqifObject) => doc.types.get(object.type ?? '')?.name ?? 'no type';
	const roleOf = (object: ReqifObject): ObjectRole => {
		const type = doc.types.get(object.type ?? '');
		const role = type ? (options.objectRoles[type.id] ?? defaultObjectRole(type)) : 'requirement';
		// DOORS writes headings as objects of the same type, with a heading and no text.
		if (role === 'requirement' && get(object, 'heading') && !get(object, 'doc')) return 'heading';
		return role;
	};
	const slotsByReqif = new Map(
		context.packages.filter((p) => p.reqif).map((p) => [p.reqif!, p] as const)
	);

	// Walk the specifications: packages for specifications and headings, requirements in them.
	const occurrences: { object: ReqifObject; slot: Slot | null }[] = [];
	const seen = new Set<string>();
	const top: Slot[] = [];
	let nestedRequirements = 0;
	const left = new Map<string, number>();
	const walk = (nodes: ReqifNode[], slot: Slot, underRequirement: boolean) => {
		for (const node of nodes) {
			const object = doc.objects.get(node.object)!;
			if (seen.has(object.id)) {
				notes.add(
					'Objects shown more than once in the hierarchy, added once',
					objectLabel(object, columns, targets)
				);
				walk(node.children, slot, underRequirement);
				continue;
			}
			seen.add(object.id);
			const role = roleOf(object);
			if (role === 'heading') {
				const name =
					headingName(get(object, 'heading') || get(object, 'name') || get(object, 'doc')) ||
					headingName(object.longName) ||
					typeName(object);
				const child: Slot = {
					reqif: object.id,
					name,
					parent: slot,
					children: [],
					...(slotsByReqif.get(object.id) ? { existing: slotsByReqif.get(object.id)! } : {})
				};
				slot.children.push(child);
				walk(node.children, child, false);
			} else if (role === 'skip') {
				left.set(typeName(object), (left.get(typeName(object)) ?? 0) + 1);
				walk(node.children, slot, underRequirement);
			} else {
				if (underRequirement) nestedRequirements++;
				slot.children.push(occurrences.length);
				occurrences.push({ object, slot });
				walk(node.children, slot, true);
			}
		}
	};
	for (const spec of doc.specifications) {
		const slot: Slot = {
			reqif: spec.id,
			name: headingName(spec.name) || spec.id,
			parent: null,
			children: [],
			...(slotsByReqif.get(spec.id) ? { existing: slotsByReqif.get(spec.id)! } : {})
		};
		top.push(slot);
		walk(spec.children, slot, false);
	}
	let unplaced = 0;
	for (const object of doc.objects.values()) {
		if (seen.has(object.id)) continue;
		const role = roleOf(object);
		if (role !== 'requirement') continue;
		unplaced++;
		occurrences.push({ object, slot: null });
	}

	// The requirements, as rows: the spreadsheet import makes, matches and checks them.
	const rows = occurrences.map(({ object }) =>
		columns.map((c, i) => (targets[i] === 'heading' ? '' : valueOf(object, c)))
	);
	const base = planImport(
		rows,
		1,
		{
			targets: targets.map((t) => (t === 'heading' ? '' : t)),
			def: options.def,
			destination: options.destination,
			existing: options.existing,
			keys: occurrences.map((o) => o.object.id),
			unit: 'objects'
		},
		context
	);
	const labels = new Map(
		occurrences.map((o, i) => [i + 1, objectLabel(o.object, columns, targets)] as const)
	);
	for (const item of base.create) item.spec.reqif = occurrences[item.line - 1]!.object.id;

	// Where each new requirement goes, and what is already where.
	const created = new Map(base.create.map((item) => [item.line, item]));
	const destination =
		options.destination.kind === 'package'
			? splitQualified(options.destination.package.qualifiedName)
			: [sysmlName(options.destination.name)];
	const newFileSpec =
		options.destination.kind === 'new' && top.length === 1 && !top[0]!.existing ? top[0]! : null;
	/** Absolute name (segments, as written) of each new requirement, by object id. */
	const placed = new Map<string, { path: string[]; anchor: PackageInfo | null }>();
	const anchors = new Map<string, PlannedAnchor>();
	const anchorOf = (pkg: PackageInfo): PlannedAnchor => {
		let anchor = anchors.get(pkg.qualifiedName);
		if (!anchor) {
			anchor = { package: pkg, nodes: [], relations: [], imports: [] };
			anchors.set(pkg.qualifiedName, anchor);
		}
		return anchor;
	};
	let packages = 0;

	/** The new nodes of a slot's children; `path` is where they are written, `taken` their names. */
	const build = (slot: Slot, path: string[], anchor: PackageInfo | null): PlannedNode[] => {
		const taken = new Set<string>([
			...(slot.existing?.members ?? []),
			...slot.children.flatMap((c) =>
				typeof c === 'number' && created.get(c + 1) ? [created.get(c + 1)!.spec.name] : []
			)
		]);
		const nodes: PlannedNode[] = [];
		for (const c of slot.children) {
			if (typeof c === 'number') {
				const item = created.get(c + 1);
				if (!item) continue;
				nodes.push({ kind: 'requirement', item });
				placed.set(occurrences[c]!.object.id, {
					path: [...path, sysmlName(item.spec.name)],
					anchor
				});
			} else if (c.existing) {
				const inner = build(c, splitQualified(c.existing.qualifiedName), c.existing);
				if (inner.length) anchorOf(c.existing).nodes.push(...inner);
			} else {
				let name = c.name;
				for (let n = 2; taken.has(name); n++) name = `${c.name} (${n})`;
				taken.add(name);
				packages++;
				nodes.push({
					kind: 'package',
					name,
					reqif: c.reqif,
					children: build(c, [...path, sysmlName(name)], anchor)
				});
			}
		}
		return nodes;
	};

	const holder: Slot = { reqif: '', name: '', parent: null, children: top };
	if (options.destination.kind === 'package') holder.existing = options.destination.package;
	const root = build(newFileSpec ?? holder, destination, null);
	// Objects in no specification: at the top of the destination.
	for (const [i, o] of occurrences.entries()) {
		if (o.slot) continue;
		const item = created.get(i + 1);
		if (!item) continue;
		root.push({ kind: 'requirement', item });
		placed.set(o.object.id, { path: [...destination, sysmlName(item.spec.name)], anchor: null });
	}
	if (unplaced) notes.add('Objects in no specification, added at the top', `${unplaced}`);
	if (nestedRequirements)
		notes.add(
			'Requirements under another requirement in the file, added next to it in the same package',
			`${nestedRequirements}`
		);
	for (const [type, n] of left) notes.add('Objects left out, by type', `${type} (${n})`);

	// Requirements already in the model that the file puts under another heading: left where they are.
	const byQualified = new Map(context.packages.map((p) => [p.qualifiedName, p]));
	const existingOf = (object: ReqifObject): ExistingRequirement | undefined =>
		context.byReqif.get(object.id) ??
		(get(object, 'id') ? context.byId.get(get(object, 'id')) : undefined);
	for (const { object, slot } of occurrences) {
		const existing = context.byReqif.get(object.id);
		if (!existing || !slot) continue;
		const container = byQualified.get(
			splitQualified(existing.qualifiedName).slice(0, -1).join('::')
		);
		if (container?.reqif && slot.existing && container.reqif !== slot.reqif)
			notes.add(
				'Requirements under another heading in the file than in the model, left where they are',
				objectLabel(object, columns, targets)
			);
	}

	// Requirements an earlier import of this file made that the file no longer has: left in the model.
	for (const slot of top) {
		if (!slot.existing) continue;
		const prefix = `${slot.existing.qualifiedName}::`;
		for (const r of context.requirements) {
			const id = r.values[`metadata:${REQIF_METADATA}.identifier`];
			if (id && r.qualifiedName.startsWith(prefix) && !doc.objects.has(id))
				notes.add('Requirements no longer in the file, left in the model', r.row.id ?? r.row.title);
		}
	}

	// Relations between requirements: derivations and refinements.
	const ends = (object: ReqifObject | undefined) => {
		if (!object || roleOf(object) !== 'requirement') return null;
		const added = placed.get(object.id);
		if (added) return { ...added, existing: null };
		const existing = existingOf(object);
		if (!existing) return null;
		const path = splitQualified(existing.qualifiedName);
		// Renamed by this import (renames go first): the relation names it by its new name.
		const renamed = renames.get(existing.row.key);
		if (renamed) path[path.length - 1] = sysmlName(renamed);
		const pkg = byQualified.get(path.slice(0, -1).join('::')) ?? null;
		return { path, anchor: pkg, existing };
	};
	const renames = new Map(
		base.update.flatMap((u) =>
			u.changes.filter((c) => c.field === 'name').map((c) => [u.existing.row.key, c.to] as const)
		)
	);
	const relative = (path: string[], home: string[]) =>
		path.length > home.length && home.every((s, i) => path[i] === s)
			? path.slice(home.length).join('::')
			: path.join('::');
	const derivations = new Map<
		string,
		{ home: PackageInfo | null; original: string; derived: string[] }
	>();
	const rootRelations: string[] = [];
	let refinementCount = 0;
	let derivationCount = 0;
	for (const relation of doc.relations) {
		const type = doc.types.get(relation.type ?? '');
		const label = type?.name ?? 'Untyped';
		const role = type ? (options.relationRoles[type.id] ?? defaultRelationRole(type)) : 'skip';
		if (role === 'skip') {
			notes.add('Relations left out, by type', label);
			continue;
		}
		const source = ends(doc.objects.get(relation.source ?? ''));
		const target = ends(doc.objects.get(relation.target ?? ''));
		if (!source || !target) {
			notes.add(
				`‘${label}’ relations whose ends are not requirements of this import or the model, left out`,
				relation.id
			);
			continue;
		}
		const [from, to] =
			role === 'derived-from' || role === 'refines' ? [source, target] : [target, source];
		// `from` is derived from, or refines, `to`; the connection is written where `from` is.
		const home = from.anchor;
		const homePath = home ? splitQualified(home.qualifiedName) : destination;
		if (role === 'derived-from' || role === 'derives') {
			if (
				from.existing &&
				to.existing &&
				from.existing.row.derivedFrom.includes(to.existing.row.key)
			)
				continue;
			const original = relative(to.path, homePath);
			const key = `${home?.qualifiedName ?? ''}\n${original}`;
			const group = derivations.get(key) ?? { home, original, derived: [] };
			group.derived.push(relative(from.path, homePath));
			derivations.set(key, group);
			derivationCount++;
		} else {
			const names = `${unescapeName(from.path.at(-1)!)} → ${unescapeName(to.path.at(-1)!)}`;
			if (from.existing && to.existing && refinements.has(names)) continue;
			const text = `#refinement dependency ${relative(from.path, homePath)} to ${relative(to.path, homePath)};`;
			if (home) anchorOf(home).relations.push(text);
			else rootRelations.push(text);
			refinementCount++;
		}
	}
	for (const d of derivations.values()) {
		const text = derivationText(d.original, d.derived);
		if (d.home) anchorOf(d.home).relations.push(text);
		else rootRelations.push(text);
	}

	// What each place written to needs to import.
	const needs = (nodes: PlannedNode[], relations: string[]): string[] => {
		const wanted = new Set<string>();
		// Every new package and requirement carries `@ReqIF`, and requirements what they use.
		if (nodes.length) for (const imp of [...base.imports, `${REQIF_PACKAGE}::*`]) wanted.add(imp);
		if (relations.some((r) => r.startsWith('#derivation'))) wanted.add('RequirementDerivation::*');
		if (relations.some((r) => r.startsWith('#refinement'))) wanted.add('ModelingMetadata::*');
		return [...wanted];
	};
	const rootImports = needs(root, rootRelations);
	if (newFileSpec) rootImports.push(`${REQIF_PACKAGE}::*`);
	for (const anchor of anchors.values()) {
		anchor.imports = needs(anchor.nodes, anchor.relations).filter(
			(imp) => imp.replace(/::[^:]+$/, '') !== anchor.package.qualifiedName
		);
	}
	const writesReqif =
		!!newFileSpec || root.length > 0 || [...anchors.values()].some((a) => a.nodes.length);

	const plan: ReqifPlan = {
		...base,
		derivations: [],
		imports: [...new Set(rootImports)],
		notes: [...base.notes, ...notes.list()],
		root,
		rootRelations,
		...(newFileSpec ? { rootReqif: newFileSpec.reqif } : {}),
		anchored: [...anchors.values()],
		library: writesReqif && !context.topLevel.includes(REQIF_PACKAGE),
		counts: { packages, derivations: derivationCount, refinements: refinementCount },
		labels
	};
	return plan;
}

/** Whether the plan writes anything. */
export function reqifHasWork(plan: ReqifPlan): boolean {
	return (
		plan.create.length > 0 ||
		plan.update.length > 0 ||
		plan.counts.packages > 0 ||
		plan.rootRelations.length > 0 ||
		plan.anchored.some((a) => a.nodes.length || a.relations.length)
	);
}

function indent(text: string): string {
	return text
		.split('\n')
		.map((line) => (line ? `    ${line}` : line))
		.join('\n');
}

/** SysML for planned nodes: packages with their `@ReqIF`, requirements, separated by blank lines. */
export function nodesText(nodes: PlannedNode[]): string {
	return nodes
		.map((node) => {
			if (node.kind === 'requirement') return requirementText(node.item.spec);
			const body = [
				reqifAnnotation(node.reqif),
				...(node.children.length ? ['', nodesText(node.children)] : [])
			];
			return `package ${sysmlName(node.name)} {\n${indent(body.join('\n'))}\n}`;
		})
		.join('\n\n');
}

/** Labels of a ReqIF column for the dialog: its name, and its kind when that helps. */
export function columnKind(column: ReqifColumn): string {
	return column.kind === 'xhtml' ? 'formatted text' : column.kind;
}
