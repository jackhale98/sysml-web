/**
 * Relationships drawn on a diagram: which ones make sense between two
 * elements, and the SysML statement each one writes (or removes).
 *
 * Pure: the model is passed in as a `ModelContext`, edits come back as
 * `EditStep`s that `applySteps` (workbench/actions.ts) runs as one undoable
 * change.
 */
import type { Analysis, EdgeKind, Span } from '#lib/engine/types.ts';
import { byteToUtf16, type ModelElement } from '#lib/project/elements.ts';
import type { EditStep } from '#lib/workbench/actions.ts';
import { formatName } from '#lib/workbench/templates.ts';
import { readHeader } from '#lib/engine/toolkit/header.ts';
import {
	findDefinition,
	interfaceEnds,
	pathFrom,
	portsOf,
	qualifiedName,
	referenceFrom,
	topOf,
	usagePath,
	type Owners,
	type PortInfo
} from './model.ts';
import {
	findStatement,
	insertIntoBody,
	insertLineAfter,
	matchBrace,
	referencePattern,
	removeStatement,
	simpleName
} from './textpatch.ts';

export interface ModelContext {
	elements: ModelElement[];
	owners: Owners;
	textOf(path: string): string | undefined;
	analyses: Analysis[];
}

export type RelationKind = 'compose' | 'satisfy' | 'verify' | 'allocate' | 'connect' | 'specialize';

export interface RelationOption {
	kind: RelationKind;
	/** How it reads from the dragged node to the drop target: "is made of". */
	label: string;
	/** The two ends as the statement orders them (`from` owns, satisfies, verifies…). */
	from: ModelElement;
	to: ModelElement;
}

/** Choices made in the popover. */
export interface RelationChoice {
	/** Name of the new part (compose). */
	name?: string;
	/** Ports to connect, on `from` and `to` (connect). */
	fromPort?: string;
	toPort?: string;
	/** Interface definition to type the connection with, or '' for a plain `connect`. */
	interfaceDef?: string;
}

export interface Plan {
	/** The toast: "Battery is now part of DeliveryDrone". */
	label: string;
	/** The SysML it writes, for the preview. */
	statement: string;
	steps: EditStep[];
}

const kindOf = (e: ModelElement) => e.kind.replace(/_/g, ' ');
const STRUCTURE = new Set(['part', 'item', 'occurrence']);
const BEHAVIOUR = new Set(['action', 'state', 'use case', 'calc', 'analysis']);
const isStructure = (e: ModelElement) => STRUCTURE.has(kindOf(e));
const isRequirement = (e: ModelElement) =>
	!e.isDefinition && (kindOf(e) === 'requirement' || kindOf(e) === 'concern');
const isLibrary = (e: ModelElement) => e.file.startsWith('libraries/');

/** The relationships that fit a drag from `source` onto `target`, best first. */
export function relationsFor(
	source: ModelElement,
	target: ModelElement,
	ctx: ModelContext
): RelationOption[] {
	if (source.key === target.key) return [];
	const options: RelationOption[] = [];
	const add = (kind: RelationKind, label: string, from: ModelElement, to: ModelElement) =>
		options.push({ kind, label, from, to });

	if (canSpecialize(source, target)) add('specialize', 'specializes', source, target);
	// Between sibling parts with ports, wiring them up is the likely intent.
	if (canConnect(source, target, ctx)) add('connect', 'connect', source, target);
	if (canCompose(source, target)) add('compose', 'is made of', source, target);
	if (canCompose(target, source)) add('compose', 'is part of', target, source);
	if (canSatisfy(source, target)) add('satisfy', 'satisfies', source, target);
	if (canSatisfy(target, source)) add('satisfy', 'is satisfied by', target, source);
	if (kindOf(source) === 'verification' && isRequirement(target)) {
		add('verify', 'verifies', source, target);
	}
	if (kindOf(target) === 'verification' && isRequirement(source)) {
		add('verify', 'is verified by', target, source);
	}
	if (canAllocate(source, target)) add('allocate', 'is allocated to', source, target);
	return options;
}

function canSpecialize(from: ModelElement, to: ModelElement): boolean {
	return (
		from.isDefinition &&
		to.isDefinition &&
		!isLibrary(from) &&
		kindOf(from) === kindOf(to) &&
		kindOf(from) !== 'package' &&
		simpleName(from.typeRef ?? '') !== simpleName(to.name)
	);
}

function canCompose(owner: ModelElement, part: ModelElement): boolean {
	if (isLibrary(owner) || !isStructure(owner) || !isStructure(part)) return false;
	if (!part.isDefinition && !part.typeRef) return false;
	// A definition holding a part of its own type would never end.
	const type = part.isDefinition ? part.name : simpleName(part.typeRef ?? '');
	return simpleName(type) !== simpleName(owner.isDefinition ? owner.name : (owner.typeRef ?? ''));
}

function canSatisfy(by: ModelElement, requirement: ModelElement): boolean {
	return (
		isRequirement(requirement) &&
		!by.isDefinition &&
		!isRequirement(by) &&
		(isStructure(by) || BEHAVIOUR.has(kindOf(by)) || kindOf(by) === 'port')
	);
}

function canAllocate(from: ModelElement, to: ModelElement): boolean {
	return (
		!from.isDefinition &&
		!to.isDefinition &&
		(BEHAVIOUR.has(kindOf(from)) || isStructure(from)) &&
		isStructure(to)
	);
}

/**
 * A connection between two parts of the same thing, with ports or without
 * (`connect a to b` joins the parts themselves): what a dependency matrix
 * offers for an empty cell. Null when they are not parts of one thing.
 */
export function connectOption(
	a: ModelElement,
	b: ModelElement,
	ctx: ModelContext
): RelationOption | null {
	if (a.key === b.key || a.isDefinition || b.isDefinition || !isStructure(a) || !isStructure(b))
		return null;
	return connectionOwner(a, b, ctx.owners)
		? { kind: 'connect', label: 'connect', from: a, to: b }
		: null;
}

function canConnect(a: ModelElement, b: ModelElement, ctx: ModelContext): boolean {
	if (a.isDefinition || b.isDefinition || !isStructure(a) || !isStructure(b)) return false;
	if (!connectionOwner(a, b, ctx.owners)) return false;
	return (
		portsOf(a, ctx.elements, ctx.owners, ctx.textOf).length > 0 &&
		portsOf(b, ctx.elements, ctx.owners, ctx.textOf).length > 0
	);
}

/** The innermost part or definition that holds both, where a connection between them belongs. */
export function connectionOwner(
	a: ModelElement,
	b: ModelElement,
	owners: Owners
): ModelElement | undefined {
	const chain = (e: ModelElement) => {
		const list: ModelElement[] = [];
		for (let o = owners.get(e.key); o; o = owners.get(o.key)) list.push(o);
		return list;
	};
	const bChain = new Set(chain(b).map((e) => e.key));
	const common = chain(a).find((o) => bChain.has(o.key));
	return common && kindOf(common) !== 'package' ? common : undefined;
}

/** A lower-camel name for a new part typed by `type`, unique among `taken`. */
export function partName(type: string, taken: Iterable<string> = []): string {
	const words = simpleName(type)
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
	const camel =
		words
			.map((w, i) => {
				// Keep acronyms readable: "GNSSReceiver" → "gnssReceiver".
				const lower = /^[A-Z0-9]+$/.test(w) && w.length > 1 ? w.toLowerCase() : w;
				return i === 0
					? lower.charAt(0).toLowerCase() + lower.slice(1)
					: lower.charAt(0).toUpperCase() + lower.slice(1);
			})
			.join('') || 'part';
	const base = /^[0-9]/.test(camel) ? `p${camel}` : camel;
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** Names already used by members of `owner`. */
export function memberNames(owner: ModelElement, ctx: ModelContext): string[] {
	return ctx.elements.filter((e) => ctx.owners.get(e.key)?.key === owner.key).map((e) => e.name);
}

/** The type a new part gets when composed from `part` (a definition, or a typed usage). */
function partType(part: ModelElement, owner: ModelElement, ctx: ModelContext): string {
	if (part.isDefinition) return referenceFrom(part, owner, ctx.owners, ctx.textOf);
	return part.typeRef ?? part.name;
}

/** Defaults for the popover: the new part's name, the best pair of ports, an interface. */
export function defaultChoice(option: RelationOption, ctx: ModelContext): RelationChoice {
	if (option.kind === 'compose') {
		const type = option.to.isDefinition ? option.to.name : (option.to.typeRef ?? option.to.name);
		return { name: partName(type, memberNames(option.from, ctx)) };
	}
	if (option.kind === 'connect') {
		const pair = bestPorts(option, ctx);
		if (!pair) {
			// One end has no ports: the other end's first port, if it has any.
			const { from, to } = portsFor(option, ctx);
			return { fromPort: from[0]?.name, toPort: to[0]?.name, interfaceDef: '' };
		}
		return {
			fromPort: pair.from.name,
			toPort: pair.to.name,
			interfaceDef: interfacesFor(pair.from, pair.to, ctx)[0]?.def.name ?? ''
		};
	}
	return {};
}

export function portsFor(
	option: RelationOption,
	ctx: ModelContext
): {
	from: PortInfo[];
	to: PortInfo[];
} {
	return {
		from: portsOf(option.from, ctx.elements, ctx.owners, ctx.textOf),
		to: portsOf(option.to, ctx.elements, ctx.owners, ctx.textOf)
	};
}

/** How well two ports fit: same port type with opposite directions is best. */
export function portFit(a: PortInfo, b: PortInfo): number {
	if (!a.type || !b.type || simpleName(a.type) !== simpleName(b.type)) return 0;
	return a.conjugated !== b.conjugated ? 3 : 1;
}

function bestPorts(
	option: RelationOption,
	ctx: ModelContext
): { from: PortInfo; to: PortInfo } | undefined {
	const { from, to } = portsFor(option, ctx);
	let best: { from: PortInfo; to: PortInfo; score: number } | undefined;
	for (const a of from) {
		for (const b of to) {
			const score = portFit(a, b);
			if (!best || score > best.score) best = { from: a, to: b, score };
		}
	}
	return best;
}

/** Interface definitions whose two ends fit the ports; `swap` when `b` is the first end. */
export function interfacesFor(
	a: PortInfo,
	b: PortInfo,
	ctx: ModelContext
): { def: ModelElement; swap: boolean }[] {
	const fits = (p: PortInfo, end: { type: string; conjugated: boolean }) =>
		!!p.type && simpleName(p.type) === end.type && p.conjugated === end.conjugated;
	const result: { def: ModelElement; swap: boolean }[] = [];
	for (const def of ctx.elements) {
		if (!def.isDefinition || kindOf(def) !== 'interface') continue;
		const ends = interfaceEnds(def, ctx.textOf(def.file));
		if (ends.length !== 2) continue;
		const [e0, e1] = ends as [(typeof ends)[0], (typeof ends)[0]];
		if (fits(a, e0) && fits(b, e1)) result.push({ def, swap: false });
		else if (fits(b, e0) && fits(a, e1)) result.push({ def, swap: true });
	}
	return result;
}

/** A statement the engine adds as the last member of `host` (a usage ending in `;` gains a body). */
function memberStep(host: ModelElement, text: string, ctx: ModelContext): EditStep | string {
	if (ctx.textOf(host.file) === undefined) return `${host.file} is not in the project.`;
	return { kind: 'member', path: host.file, parent: host, text };
}

/** The package that already holds statements like these, so new ones join them. */
function hostOf(
	pattern: RegExp,
	ctx: ModelContext,
	fallback: ModelElement
): ModelElement | undefined {
	let best: { file: string; at: number; count: number } | undefined;
	const files = new Set(
		ctx.elements.filter((e) => !isLibrary(e) && e.kind === 'package').map((e) => e.file)
	);
	for (const file of files) {
		const text = ctx.textOf(file) ?? '';
		const count = [...text.matchAll(new RegExp(pattern.source, 'gm'))].length;
		const first = count ? findStatement(text, pattern) : null;
		if (first && (!best || count > best.count)) best = { file, at: first[0], count };
	}
	if (!best) return topOf(fallback, ctx.owners);
	const text = ctx.textOf(best.file) ?? '';
	let host: ModelElement | undefined;
	for (const e of ctx.elements) {
		if (e.file !== best.file || e.kind !== 'package') continue;
		const from = byteToUtf16(text, e.span.start_byte);
		const to = byteToUtf16(text, e.span.end_byte);
		if (from <= best.at && best.at <= to && (!host || e.span.start_byte > host.span.start_byte)) {
			host = e;
		}
	}
	return host ?? topOf(fallback, ctx.owners);
}

/**
 * Write `statement` right after the last statement starting with `keyword`
 * in `host`, so it joins its siblings; otherwise at the end of the body.
 */
function besideStep(
	host: ModelElement,
	keyword: string,
	statement: string,
	ctx: ModelContext
): EditStep | string {
	const text = ctx.textOf(host.file);
	if (text === undefined) return `${host.file} is not in the project.`;
	const end = byteToUtf16(text, host.span.end_byte);
	const pattern = new RegExp(`(^|\\n)[ \\t]*${keyword}\\s[^;{}]*;`);
	let last: [number, number] | null = null;
	for (
		let at = findStatement(text, pattern, byteToUtf16(text, host.span.start_byte), end);
		at;
		at = findStatement(text, pattern, at[1], end)
	) {
		last = at;
	}
	if (!last) return memberStep(host, statement, ctx);
	const patched = insertLineAfter(text, last[1] - 1, statement);
	return { kind: 'patch', path: host.file, before: text, after: patched.text };
}

/**
 * The `objective { … }` of a verification, as UTF-16 offsets: found in its
 * text, since an objective has no name for the model to list it by.
 */
function objectiveRange(
	verification: ModelElement,
	ctx: ModelContext
): [number, number] | undefined {
	const text = ctx.textOf(verification.file);
	if (text === undefined) return undefined;
	const at = findStatement(
		text,
		/\bobjective\b[^;{]*\{/,
		byteToUtf16(text, verification.span.start_byte),
		byteToUtf16(text, verification.span.end_byte)
	);
	if (!at) return undefined;
	const close = matchBrace(text, at[1] - 1);
	return close < 0 ? undefined : [at[0], close + 1];
}

/** A path from `owner` down to `element`: `battery` inside `drone`. */
function relativePath(element: ModelElement, owner: ModelElement, owners: Owners): string {
	const path = usagePath(element, owners).path;
	if (owner.isDefinition) return path;
	const prefix = usagePath(owner, owners).path + '.';
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The statement and edit steps for a relationship. Returns a message when it cannot be written. */
export function planRelation(
	option: RelationOption,
	choice: RelationChoice,
	ctx: ModelContext
): Plan | string {
	const { from, to } = option;
	const step = (
		host: ModelElement,
		statement: string,
		label: string,
		beside?: string
	): Plan | string => {
		const s = beside ? besideStep(host, beside, statement, ctx) : memberStep(host, statement, ctx);
		return typeof s === 'string' ? s : { label, statement, steps: [s] };
	};
	switch (option.kind) {
		case 'compose': {
			const name = (choice.name ?? '').trim();
			if (!name) return 'Give the new part a name.';
			const keyword =
				kindOf(to) === 'item' ? 'item' : kindOf(to) === 'occurrence' ? 'occurrence' : 'part';
			const type = partType(to, from, ctx);
			const label = to.isDefinition ? to.label : simpleName(to.typeRef ?? to.label);
			return step(
				from,
				`${keyword} ${formatName(name)} : ${type};`,
				`${label} is now part of ${from.label}`
			);
		}
		case 'satisfy': {
			const host = hostOf(/^\s*satisfy\s/m, ctx, from);
			if (!host) return 'There is no package to write the satisfy statement in.';
			const req = referenceFrom(to, host, ctx.owners, ctx.textOf);
			const by = pathFrom(from, host, ctx.owners, ctx.textOf, subjectNames(to, ctx.elements));
			return step(
				host,
				`satisfy ${req} by ${by};`,
				`${from.label} now satisfies ${to.label}`,
				'satisfy'
			);
		}
		case 'verify': {
			const req = referenceFrom(to, from, ctx.owners, ctx.textOf);
			const statement = `verify ${req};`;
			const label = `${from.label} now verifies ${to.label}`;
			const objective = objectiveRange(from, ctx);
			if (!objective) return step(from, `objective { ${statement} }`, label);
			const source = ctx.textOf(from.file) ?? '';
			const patched = insertIntoBody(source, objective[0], objective[1], statement);
			if (!patched) return `Could not read the objective of ${from.label}.`;
			return {
				label,
				statement,
				steps: [{ kind: 'patch', path: from.file, before: source, after: patched.text }]
			};
		}
		case 'allocate': {
			const host = hostOf(/^\s*allocate\s/m, ctx, from);
			if (!host) return 'There is no package to write the allocation in.';
			const a = pathFrom(from, host, ctx.owners, ctx.textOf);
			const b = pathFrom(to, host, ctx.owners, ctx.textOf);
			return step(
				host,
				`allocate ${a} to ${b};`,
				`${from.label} is now allocated to ${to.label}`,
				'allocate'
			);
		}
		case 'connect': {
			const owner = connectionOwner(from, to, ctx.owners);
			if (!owner) return `${from.label} and ${to.label} are not parts of the same thing.`;
			// A part with ports connects through one; a part without, itself.
			const ends = portsFor(option, ctx);
			if ((ends.from.length && !choice.fromPort) || (ends.to.length && !choice.toPort))
				return 'Choose a port on each end.';
			const at = (path: string, port: string | undefined) => (port ? `${path}.${port}` : path);
			let a = at(relativePath(from, owner, ctx.owners), choice.fromPort);
			let b = at(relativePath(to, owner, ctx.owners), choice.toPort);
			let statement = `connect ${a} to ${b};`;
			if (choice.interfaceDef && choice.fromPort && choice.toPort) {
				const def = findDefinition(choice.interfaceDef, ctx.elements);
				const ports = portsFor(option, ctx);
				const pa = ports.from.find((p) => p.name === choice.fromPort);
				const pb = ports.to.find((p) => p.name === choice.toPort);
				const fit =
					def && pa && pb
						? interfacesFor(pa, pb, ctx).find((f) => f.def.key === def.key)
						: undefined;
				if (fit?.swap) [a, b] = [b, a];
				const type = def ? referenceFrom(def, owner, ctx.owners, ctx.textOf) : choice.interfaceDef;
				statement = `interface : ${type} connect ${a} to ${b};`;
			}
			return step(owner, statement, `Connected ${a} to ${b}`);
		}
		case 'specialize': {
			const namespace = ctx.owners.get(from.key) ?? from;
			const ref = referenceFrom(to, namespace, ctx.owners, ctx.textOf);
			const source = ctx.textOf(from.file);
			if (source === undefined) return `${from.file} is not in the project.`;
			const generals = specializationsOf(from, source);
			if (generals.some((g) => simpleName(g) === simpleName(ref)))
				return `${from.label} already specializes ${to.label}.`;
			return {
				label: `${from.label} now specializes ${to.label}`,
				statement: `:> ${ref}`,
				steps: [
					{
						kind: 'declaration',
						path: from.file,
						element: from,
						set: { specializes: [...generals, ref] }
					}
				]
			};
		}
	}
}

/** What an element's declaration specializes, as written (`:> A, B`). */
function specializationsOf(element: ModelElement, text: string): string[] {
	const header = readHeader(text, byteToUtf16(text, element.span.start_byte));
	return (header?.parts ?? [])
		.filter((p) => p.slot === 'specialization')
		.flatMap((p) => p.targets ?? [])
		.map((t) => text.slice(t.start, t.end));
}

/** The statement behind a drawn edge, and how to remove it; a message when there is none. */
export function planEdgeRemoval(
	kind: EdgeKind,
	label: string | null,
	source: ModelElement,
	target: ModelElement,
	ctx: ModelContext
): Plan | string {
	const patchSpan = (element: { file: string; span: Span }, what: string): Plan | string => {
		const text = ctx.textOf(element.file);
		if (text === undefined) return `${element.file} is not in the project.`;
		const from = byteToUtf16(text, element.span.start_byte);
		const to = byteToUtf16(text, element.span.end_byte);
		return {
			label: what,
			statement: text.slice(from, to),
			steps: [
				{ kind: 'patch', path: element.file, before: text, after: removeStatement(text, from, to) }
			]
		};
	};
	/** A named element's removal, by the engine. */
	const removeElement = (element: ModelElement, what: string): Plan | string => {
		const text = ctx.textOf(element.file);
		if (text === undefined) return `${element.file} is not in the project.`;
		return {
			label: what,
			statement: text.slice(
				byteToUtf16(text, element.span.start_byte),
				byteToUtf16(text, element.span.end_byte)
			),
			steps: [{ kind: 'remove', path: element.file, element }]
		};
	};
	const plainLabel = label?.replace(/^<<(.*)>>$/, '$1') ?? null;
	switch (kind) {
		case 'satisfy':
		case 'verify': {
			const links = ctx.analyses.flatMap((a) =>
				(kind === 'satisfy' ? a.model.satisfactions : a.model.verifications).map((l) => ({
					...l,
					file: a.model.file
				}))
			);
			const link = links.find(
				(l) =>
					simpleName(l.requirement) === simpleName(target.name) &&
					simpleName(l.by.split('.').pop() ?? '') === simpleName(source.name)
			);
			if (!link) return `The ${kind} statement for ${target.label} was not found.`;
			return patchSpan(
				link,
				kind === 'satisfy'
					? `${source.label} no longer satisfies ${target.label}`
					: `${source.label} no longer verifies ${target.label}`
			);
		}
		case 'composition': {
			const part = target.isDefinition
				? ctx.elements.find(
						(e) =>
							ctx.owners.get(e.key)?.key === source.key &&
							(e.name === plainLabel || simpleName(e.typeRef ?? '') === target.name)
					)
				: target;
			if (!part) return `The part of ${source.label} was not found.`;
			return removeElement(part, `Removed ${part.label} from ${source.label}`);
		}
		case 'specialization': {
			const text = ctx.textOf(source.file);
			if (text === undefined) return `${source.file} is not in the project.`;
			const generals = specializationsOf(source, text);
			const kept = generals.filter((g) => simpleName(g) !== simpleName(target.name));
			if (kept.length === generals.length)
				return `${source.label} does not declare :> ${target.label} itself.`;
			return {
				label: `${source.label} no longer specializes ${target.label}`,
				statement: `:> ${target.name}`,
				steps: [
					{ kind: 'declaration', path: source.file, element: source, set: { specializes: kept } }
				]
			};
		}
		case 'connection': {
			const owner = connectionOwner(source, target, ctx.owners);
			if (plainLabel && owner) {
				const named = ctx.elements.find(
					(e) => e.name === plainLabel && ctx.owners.get(e.key)?.key === owner.key
				);
				if (named) return removeElement(named, `Disconnected ${source.label} from ${target.label}`);
			}
			if (!owner) return 'This connection is not written in a part.';
			const text = ctx.textOf(owner.file) ?? '';
			const a = referencePattern(relativePath(source, owner, ctx.owners));
			const b = referencePattern(relativePath(target, owner, ctx.owners));
			const end = (x: string) => `${x}\\.[\\w']+`;
			const pattern = new RegExp(
				`(?:interface\\b[^;{]*?|connection\\b[^;{]*?)?\\bconnect\\s+(?:${end(a)}\\s+to\\s+${end(b)}|${end(b)}\\s+to\\s+${end(a)})\\s*;`
			);
			const at = findStatement(
				text,
				pattern,
				byteToUtf16(text, owner.span.start_byte),
				byteToUtf16(text, owner.span.end_byte)
			);
			if (!at) return 'This connection is not written as a single statement.';
			return {
				label: `Disconnected ${source.label} from ${target.label}`,
				statement: text.slice(at[0], at[1]),
				steps: [
					{ kind: 'patch', path: owner.file, before: text, after: removeStatement(text, ...at) }
				]
			};
		}
		case 'allocate': {
			const a = referencePattern(source.name);
			const b = referencePattern(target.name);
			const pattern = new RegExp(
				`\\ballocate\\s+(?:[\\w']+\\.)*${a}\\s+to\\s+(?:[\\w']+\\.)*${b}\\s*;`
			);
			for (const e of ctx.elements) {
				if (e.kind !== 'package' || isLibrary(e) || ctx.owners.has(e.key)) continue;
				const text = ctx.textOf(e.file) ?? '';
				const at = findStatement(text, pattern);
				if (!at) continue;
				return {
					label: `${source.label} is no longer allocated to ${target.label}`,
					statement: text.slice(at[0], at[1]),
					steps: [
						{ kind: 'patch', path: e.file, before: text, after: removeStatement(text, ...at) }
					]
				};
			}
			return 'The allocate statement was not found.';
		}
		default:
			return `This ${kind.replace(/_/g, ' ')} line comes from the text; change it there.`;
	}
}

/** For tests and the popover: a short description of where the statement goes. */
export function describeHost(option: RelationOption, ctx: ModelContext): string {
	switch (option.kind) {
		case 'compose':
			return `in ${option.from.label}`;
		case 'verify':
			return `in the objective of ${option.from.label}`;
		case 'specialize':
			return `on ${option.from.label}`;
		case 'connect': {
			const owner = connectionOwner(option.from, option.to, ctx.owners);
			return owner ? `in ${owner.label}` : '';
		}
		case 'satisfy':
		case 'allocate': {
			const host = hostOf(
				option.kind === 'satisfy' ? /^\s*satisfy\s/m : /^\s*allocate\s/m,
				ctx,
				option.from
			);
			return host ? `in ${qualifiedName(host, ctx.owners)}` : '';
		}
	}
}

/**
 * A new verification case that verifies `requirement`, written beside the
 * project's other verification cases (else in the requirement's package):
 * `verification enduranceTest { objective { verify 'Flight endurance'; } }`.
 */
export function planNewVerification(
	requirement: ModelElement,
	name: string,
	ctx: ModelContext
): Plan | string {
	if (!name.trim()) return 'Give the test a name.';
	const host = hostOf(/^\s*verification\s/m, ctx, requirement);
	if (!host) return 'There is no package to write the test in.';
	const req = referenceFrom(requirement, host, ctx.owners, ctx.textOf);
	const statement = `verification ${formatName(name.trim())} {\n    objective { verify ${req}; }\n}`;
	const step = memberStep(host, statement, ctx);
	return typeof step === 'string'
		? step
		: { label: `${name.trim()} now verifies ${requirement.label}`, statement, steps: [step] };
}

/**
 * Take a `satisfy … by …;` or `verify …;` out of the model: the statement
 * that links `requirement` to `by` (as the requirement's trace lists it,
 * `drone.flightController` or `enduranceFlightTest`).
 */
export function planLinkRemoval(
	kind: 'satisfy' | 'verify',
	requirement: ModelElement,
	by: string,
	ctx: ModelContext
): Plan | string {
	const links = ctx.analyses.flatMap((a) =>
		(kind === 'satisfy' ? a.model.satisfactions : a.model.verifications).map((l) => ({
			...l,
			file: a.model.file
		}))
	);
	const leaf = (path: string) => simpleName(path.split('.').pop() ?? path);
	const ofRequirement = links.filter(
		(l) => simpleName(l.requirement) === simpleName(requirement.name)
	);
	const link =
		ofRequirement.find((l) => l.by === by) ?? ofRequirement.find((l) => leaf(l.by) === leaf(by));
	if (!link) return `The ${kind} statement linking ${by} to ${requirement.label} was not found.`;
	const text = ctx.textOf(link.file);
	if (text === undefined) return `${link.file} is not in the project.`;
	const from = byteToUtf16(text, link.span.start_byte);
	const to = byteToUtf16(text, link.span.end_byte);
	return {
		label:
			kind === 'satisfy'
				? `${by} no longer satisfies ${requirement.label}`
				: `${by} no longer verifies ${requirement.label}`,
		statement: text.slice(from, to),
		steps: [
			{ kind: 'patch', path: link.file, before: text, after: removeStatement(text, from, to) }
		]
	};
}

/** What a requirement's subject is called in it: declared there, or by its definitions. */
function subjectNames(requirement: ModelElement, elements: ModelElement[]): Set<string> {
	const names = new Set<string>();
	const seen = new Set<string>();
	for (let r: ModelElement | undefined = requirement; r && !seen.has(r.key);) {
		seen.add(r.key);
		const owner = r.name;
		for (const e of elements) if (e.kind === 'subject' && e.parent === owner) names.add(e.label);
		const type: string | null = r.typeRef ? simpleName(r.typeRef) : null;
		r = type ? elements.find((e) => e.isDefinition && e.label === type) : undefined;
	}
	return names;
}
