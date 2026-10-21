/**
 * The chapters of an interface control document: the interconnection of
 * the parts in scope, their connections, the interface and port
 * definitions they connect through, the items that flow, and each part's
 * ports.
 */
import type { Span, Usage } from '#lib/engine/types.ts';
import { elementAt, type ModelElement } from '#lib/project/elements.ts';
import type { Chapter, ReportContext } from './context.ts';
import { cleanDoc, joined, t, type Block, type Run, type Section, type Text } from './document.ts';
import {
	definitionOf,
	inScope,
	membersOf,
	pathInScope,
	resolveReference,
	splitName,
	typeName
} from './model.ts';
import { readInterfaceBody, sliceBytes, type InterfaceEnd, type InterfaceFlow } from './text.ts';

/** A connection as the engine reports it (`Model.connections`). */
interface RawConnection {
	name?: string | null;
	type_ref?: string | null;
	source: string;
	target: string;
	span: Span;
}

export type Direction = 'in' | 'out' | 'inout';

export interface IcdConnection {
	id: string;
	element: ModelElement | undefined;
	owner: ModelElement | undefined;
	name: string | null;
	type: string | null;
	interfaceDef: ModelElement | undefined;
	source: string;
	target: string;
	sourceElement: ModelElement | undefined;
	targetElement: ModelElement | undefined;
}

export interface IcdPort {
	element: ModelElement;
	type: string | null;
	definition: ModelElement | undefined;
	conjugated: boolean;
	direction: Direction | null;
	connections: { other: string; via: IcdConnection }[];
}

export interface IcdPart {
	element: ModelElement;
	definition: ModelElement | undefined;
	ports: IcdPort[];
}

export interface IcdInterface {
	element: ModelElement;
	ends: (InterfaceEnd & { definition: ModelElement | undefined })[];
	flows: (InterfaceFlow & { itemDefinition: ModelElement | undefined })[];
	usedBy: IcdConnection[];
}

export interface IcdPortDefinition {
	element: ModelElement;
	features: {
		element: ModelElement;
		direction: Direction | null;
		type: ModelElement | undefined;
	}[];
	usedBy: { part: ModelElement; port: IcdPort }[];
}

export interface IcdModel {
	parts: IcdPart[];
	connections: IcdConnection[];
	interfaces: IcdInterface[];
	portDefinitions: IcdPortDefinition[];
	items: ModelElement[];
}

const cache = new WeakMap<ReportContext, IcdModel>();

export function icdModel(ctx: ReportContext): IcdModel {
	let model = cache.get(ctx);
	if (!model) cache.set(ctx, (model = buildModel(ctx)));
	return model;
}

/** Directions written on usages (`in item x`) and conjugated port types (`~P`), by element key. */
function features(ctx: ReportContext): {
	direction: Map<string, Direction>;
	conjugated: Set<string>;
} {
	const direction = new Map<string, Direction>();
	const conjugated = new Set<string>();
	for (const { model } of ctx.analyses) {
		const usages = model.usages as (Usage & { direction?: string; is_conjugated?: boolean })[];
		for (const u of usages) {
			const key = `${model.file}@${u.span.start_byte}`;
			if (u.direction === 'in' || u.direction === 'out' || u.direction === 'inout')
				direction.set(key, u.direction);
			if (u.is_conjugated) conjugated.add(key);
		}
	}
	return { direction, conjugated };
}

const CONNECTABLE = new Set(['part', 'item', 'port', 'interface', 'connection', 'occurrence']);

function buildModel(ctx: ReportContext): IcdModel {
	const { index, scope } = ctx;
	const own = (e: ModelElement) => !index.isLibrary(e.file);
	const isIn = (e: ModelElement) => inScope(index, e, scope);
	const { direction: directionOf, conjugated: conjugatedPorts } = features(ctx);

	// Connections, from the engine's per-file lists, kept when their owner is in scope.
	const connections: IcdConnection[] = [];
	for (const { model } of ctx.analyses) {
		const raw = (model as typeof model & { connections?: RawConnection[] }).connections ?? [];
		for (const c of raw) {
			if (index.isLibrary(model.file)) continue;
			const at = elementAt(index.elements, model.file, c.span.start_byte);
			// A named connection is an element itself; an unnamed one belongs to the element around it.
			const isSelf = !!at && !!c.name && at.name === c.name;
			const element = isSelf ? at : undefined;
			const owner = isSelf ? index.owner.get(at.key) : at;
			const ownerPath = owner ? (index.path.get(owner.key) ?? []) : [];
			const visible = element
				? isIn(element)
				: scope.length
					? pathInScope([...ownerPath, '(connection)'], scope)
					: true;
			if (!visible) continue;
			const interfaceDef = definitionOf(index, c.type_ref ?? null, owner);
			if (!(owner && CONNECTABLE.has(owner.kind)) && interfaceDef?.kind !== 'interface') continue;
			connections.push({
				id: `${model.file}@${c.span.start_byte}`,
				element,
				owner,
				name: c.name ?? null,
				type: c.type_ref ?? null,
				interfaceDef,
				source: c.source,
				target: c.target,
				sourceElement: resolveReference(index, c.source, owner),
				targetElement: resolveReference(index, c.target, owner)
			});
		}
	}

	// Parts in scope, each with its ports (its own and its definition's).
	const featureDirection = (port: ModelElement, conjugated: boolean): Direction | null => {
		const def = definitionOf(index, port.typeRef, port);
		const written = directionOf.get(port.key);
		const dirs = new Set<Direction>();
		if (written) dirs.add(written);
		else if (def) {
			for (const f of membersOf(index, def)) {
				const d = directionOf.get(f.key);
				if (d) dirs.add(d);
			}
		}
		if (!dirs.size) return null;
		const d: Direction = dirs.size > 1 || dirs.has('inout') ? 'inout' : [...dirs][0]!;
		if (!conjugated || d === 'inout') return d;
		return d === 'in' ? 'out' : 'in';
	};
	const endKey = (chain: string) => splitName(chain, true).slice(-2).join('.');
	const parts: IcdPart[] = index.elements
		.filter((e) => e.kind === 'part' && !e.isDefinition && own(e) && isIn(e))
		.map((part) => {
			const ports = membersOf(index, part)
				.filter((m) => m.kind === 'port')
				.map((port): IcdPort => {
					const conjugated =
						conjugatedPorts.has(port.key) || (port.typeRef ?? '').trim().startsWith('~');
					const id = `${part.label}.${port.label}`;
					const linked = connections.flatMap((c) =>
						endKey(c.source) === id
							? [{ other: c.target, via: c }]
							: endKey(c.target) === id
								? [{ other: c.source, via: c }]
								: []
					);
					return {
						element: port,
						type:
							port.typeRef && conjugated && !port.typeRef.startsWith('~')
								? `~${port.typeRef}`
								: port.typeRef,
						definition: definitionOf(index, port.typeRef, port),
						conjugated,
						direction: featureDirection(port, conjugated),
						connections: linked
					};
				});
			return { element: part, definition: definitionOf(index, part.typeRef, part), ports };
		});

	// Interface definitions: in scope, or typing a connection in scope.
	const interfaceSet = new Set<ModelElement>();
	for (const e of index.elements)
		if (e.kind === 'interface' && e.isDefinition && own(e) && isIn(e)) interfaceSet.add(e);
	for (const c of connections)
		if (c.interfaceDef?.kind === 'interface') interfaceSet.add(c.interfaceDef);
	const interfaces: IcdInterface[] = ordered(index.elements, interfaceSet).map((element) => {
		const text = ctx.texts[element.file] ?? '';
		const body = sliceBytes(text, element.span.start_byte, element.span.end_byte);
		const { ends, flows } = readInterfaceBody(body);
		return {
			element,
			ends: ends.map((end) => ({ ...end, definition: definitionOf(index, end.type, element) })),
			flows: flows.map((flow) => ({
				...flow,
				itemDefinition: flow.item ? definitionOf(index, flow.item, element) : undefined
			})),
			usedBy: connections.filter((c) => c.interfaceDef === element)
		};
	});

	// Port definitions: in scope, typing a part's port, or an interface end.
	const portSet = new Set<ModelElement>();
	for (const e of index.elements)
		if (e.kind === 'port' && e.isDefinition && own(e) && isIn(e)) portSet.add(e);
	for (const part of parts) for (const p of part.ports) if (p.definition) portSet.add(p.definition);
	for (const i of interfaces)
		for (const end of i.ends) if (end.definition) portSet.add(end.definition);
	const portDefinitions: IcdPortDefinition[] = ordered(index.elements, portSet).map((element) => ({
		element,
		features: membersOf(index, element)
			.filter((m) => !m.isDefinition && m.kind !== 'doc')
			.map((m) => ({
				element: m,
				direction: directionOf.get(m.key) ?? null,
				type: definitionOf(index, m.typeRef, m)
			})),
		usedBy: parts.flatMap((part) =>
			part.ports
				.filter((p) => p.definition === element)
				.map((port) => ({ part: part.element, port }))
		)
	}));

	// Items: in scope, or carried by a port or an interface's flows.
	const itemSet = new Set<ModelElement>();
	for (const e of index.elements)
		if (e.kind === 'item' && e.isDefinition && own(e) && isIn(e)) itemSet.add(e);
	for (const p of portDefinitions)
		for (const f of p.features) if (f.type?.kind === 'item') itemSet.add(f.type);
	for (const i of interfaces)
		for (const f of i.flows) if (f.itemDefinition?.kind === 'item') itemSet.add(f.itemDefinition);
	const items = ordered(index.elements, itemSet);

	return { parts, connections, interfaces, portDefinitions, items };
}

function ordered(all: ModelElement[], set: Set<ModelElement>): ModelElement[] {
	return all.filter((e) => set.has(e));
}

// ── Chapters ─────────────────────────────────────────────────────────────────

function ref(element: ModelElement | undefined, text?: string): Run {
	return t(text ?? element?.label ?? '—', element?.key);
}

function docText(element: ModelElement | undefined): Text {
	const doc = cleanDoc(element?.doc)[0];
	return [t(doc ?? '')];
}

function docBlocks(element: ModelElement): Block[] {
	return cleanDoc(element.doc).map((p) => ({ type: 'paragraph' as const, text: [t(p)] }));
}

function intro(chapter: Chapter | undefined, fallback: string): Block[] {
	const paragraphs = cleanDoc(chapter?.doc);
	return (paragraphs.length ? paragraphs : [fallback]).map((p) => ({
		type: 'paragraph' as const,
		text: [t(p)],
		muted: true
	}));
}

function empty(text: string): Block {
	return { type: 'paragraph', text: [t(text)] };
}

/** `battery.powerOut` with each name linked where it resolves. */
function endText(chain: string, element: ModelElement | undefined): Text {
	return [t(chain.replace(/\s+/g, ''), element?.key)];
}

const DIRECTION_TEXT: Record<Direction, string> = { in: 'In', out: 'Out', inout: 'In and out' };

function directionText(d: Direction | null): string {
	return d ? DIRECTION_TEXT[d] : '—';
}

/** The part a diagram of the scope should show the inside of. */
export function diagramScope(ctx: ReportContext): ModelElement | undefined {
	const tally = new Map<ModelElement, number>();
	for (const c of icdModel(ctx).connections) {
		if (c.owner?.kind === 'part') tally.set(c.owner, (tally.get(c.owner) ?? 0) + 1);
	}
	return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function interconnectionChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const model = icdModel(ctx);
	const blocks: Block[] = intro(chapter, 'The parts in scope and the connections between them.');
	if (ctx.diagram) {
		const owner = diagramScope(ctx);
		blocks.push({
			type: 'diagram',
			svg: ctx.diagram.svg,
			caption: `Interconnection of ${owner?.label ?? ctx.diagram.scope}`,
			alt: `Diagram of the parts of ${ctx.diagram.scope} and the ${model.connections.length} connections between them; the same connections are listed in the Connections chapter.`
		});
	}
	const description = (e: ModelElement | undefined) => cleanDoc(e?.doc)[0];
	blocks.push(
		model.parts.length
			? {
					type: 'table',
					caption: 'Parts',
					columns: ['Part', 'Definition', 'Description'],
					rows: model.parts.map((p) => [
						[ref(p.element)],
						[ref(p.definition, typeName(p.element.typeRef) ?? '—')],
						[t(description(p.element) ?? description(p.definition) ?? '')]
					])
				}
			: empty('There are no parts in scope.')
	);
	return { id: 'interconnection', number: '', title: 'Interconnection', blocks, sections: [] };
}

export function connectionsChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const { connections } = icdModel(ctx);
	return {
		id: 'connections',
		number: '',
		title: 'Connections',
		blocks: [
			...intro(chapter, 'Every connection: which ports it joins, and through which interface.'),
			connections.length
				? {
						type: 'table',
						columns: ['Connection', 'Interface', 'From', 'To', 'Description'],
						rows: connections.map((c) => [
							[c.element ? ref(c.element) : t(c.name ?? '(unnamed)')],
							[c.type ? ref(c.interfaceDef, typeName(c.type) ?? c.type) : t('—')],
							endText(c.source, c.sourceElement),
							endText(c.target, c.targetElement),
							c.element?.doc ? docText(c.element) : [t('')]
						])
					}
				: empty('There are no connections in scope.')
		],
		sections: []
	};
}

export function interfacesChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const { interfaces } = icdModel(ctx);
	return {
		id: 'interfaces',
		number: '',
		title: 'Interfaces',
		blocks: [
			...intro(chapter, 'The interface definitions: their ends and what flows between them.'),
			...(interfaces.length ? [] : [empty('There are no interface definitions in scope.')])
		],
		sections: interfaces.map((i) => {
			const blocks: Block[] = docBlocks(i.element);
			blocks.push(
				i.ends.length
					? {
							type: 'table',
							caption: 'Ends',
							columns: ['End', 'Port'],
							rows: i.ends.map((end) => [
								[t(end.name)],
								[
									ref(end.definition, end.type),
									...(end.type.startsWith('~') ? [t(' (conjugated: directions reversed)')] : [])
								]
							])
						}
					: empty('No ends are declared.')
			);
			if (i.flows.length)
				blocks.push({
					type: 'table',
					caption: 'Flows',
					columns: ['Item', 'From', 'To'],
					rows: i.flows.map((f) => [
						[f.item ? ref(f.itemDefinition, typeName(f.item) ?? f.item) : t('—')],
						[t(f.from)],
						[t(f.to)]
					])
				});
			blocks.push({
				type: 'facts',
				facts: [
					{
						label: 'Used by',
						value: i.usedBy.length
							? joined(i.usedBy.map((c) => ref(c.element, c.name ?? `${c.source} → ${c.target}`)))
							: [t('No connection in scope')]
					}
				]
			});
			return {
				id: `interface-${i.element.label}`,
				number: '',
				title: i.element.label,
				ref: i.element.key,
				blocks,
				sections: []
			};
		})
	};
}

export function portDefinitionsChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const { portDefinitions } = icdModel(ctx);
	return {
		id: 'port-definitions',
		number: '',
		title: 'Port definitions',
		blocks: [
			...intro(chapter, 'The port definitions: what goes in and what comes out.'),
			{
				type: 'paragraph',
				text: [
					t(
						'Directions are given as seen from the port. A port typed ~Name (conjugated) is the mirror image: what goes out of Name comes in.'
					)
				],
				muted: true
			},
			...(portDefinitions.length ? [] : [empty('There are no port definitions in scope.')])
		],
		sections: portDefinitions.map((p) => {
			const blocks: Block[] = docBlocks(p.element);
			blocks.push(
				p.features.length
					? {
							type: 'table',
							caption: 'Features',
							columns: ['Feature', 'Direction', 'Type', 'Description'],
							rows: p.features.map((f) => [
								[ref(f.element)],
								[t(directionText(f.direction))],
								[ref(f.type, typeName(f.element.typeRef) ?? '—')],
								f.element.doc ? docText(f.element) : docText(f.type)
							])
						}
					: empty('No features are declared.')
			);
			blocks.push({
				type: 'facts',
				facts: [
					{
						label: 'Used on',
						value: p.usedBy.length
							? joined(
									p.usedBy.map(({ part, port }) =>
										t(
											`${part.label}.${port.element.label}${port.conjugated ? ' (~)' : ''}`,
											port.element.key
										)
									)
								)
							: [t('No part in scope')]
					}
				]
			});
			return {
				id: `port-${p.element.label}`,
				number: '',
				title: p.element.label,
				ref: p.element.key,
				blocks,
				sections: []
			};
		})
	};
}

export function itemsChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const { items, portDefinitions } = icdModel(ctx);
	return {
		id: 'items',
		number: '',
		title: 'Items',
		blocks: [
			...intro(chapter, 'The items that flow through the ports.'),
			items.length
				? {
						type: 'table',
						columns: ['Item', 'Kind of', 'Attributes', 'Carried by', 'Description'],
						rows: items.map((item) => {
							const attributes = (ctx.index.children.get(item.key) ?? []).filter(
								(c) => c.kind === 'attribute'
							);
							const carriers = portDefinitions.filter((p) =>
								p.features.some((f) => f.type === item)
							);
							return [
								[ref(item)],
								[t(item.typeRef ? (typeName(item.typeRef) ?? '') : '')],
								joined(attributes.map((a) => ref(a))),
								joined(carriers.map((p) => ref(p.element))),
								docText(item)
							];
						})
					}
				: empty('There are no items in scope.')
		],
		sections: []
	};
}

export function portUsageChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const parts = icdModel(ctx).parts.filter((p) => p.ports.length);
	return {
		id: 'ports-by-part',
		number: '',
		title: 'Ports by part',
		blocks: [
			...intro(chapter, "Each part's ports, and what they are connected to."),
			...(parts.length ? [] : [empty('No part in scope has ports.')])
		],
		sections: parts.map((part) => ({
			id: `part-${part.element.label}`,
			number: '',
			title: part.element.label,
			ref: part.element.key,
			blocks: [
				{
					type: 'table',
					columns: ['Port', 'Port definition', 'Direction', 'Connected to', 'Via'],
					rows: part.ports.map((p) => [
						[ref(p.element)],
						[ref(p.definition, p.type ?? '—')],
						[t(directionText(p.direction))],
						p.connections.length ? joined(p.connections.map((c) => t(c.other))) : [t('—')],
						p.connections.length
							? joined(
									p.connections.map((c) =>
										ref(c.via.element, c.via.name ?? typeName(c.via.type) ?? '—')
									)
								)
							: [t('—')]
					])
				}
			],
			sections: []
		}))
	};
}

/** Title-page figures. */
export function icdSummary(ctx: ReportContext): { label: string; value: string }[] {
	const m = icdModel(ctx);
	return [
		{ label: 'Connections', value: String(m.connections.length) },
		{ label: 'Interfaces', value: String(m.interfaces.length) },
		{ label: 'Port definitions', value: String(m.portDefinitions.length) },
		{ label: 'Items', value: String(m.items.length) }
	];
}
