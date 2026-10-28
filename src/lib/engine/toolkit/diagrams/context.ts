/**
 * What every diagram builder reads: the session, the model adapter's
 * records (`model.ts`) indexed by owner, and a graph under construction
 * with stable, readable node ids.
 *
 * Node ids are what the layout sidecar (`layout/diagrams.json`) keys
 * positions by, so they are names as written, never element ids: a
 * definition is its name (`Battery`), a usage its feature path from the
 * outermost usage drawn (`drone.battery`), a state or action its path
 * inside the machine or action (`flying`), a pseudo state `__initial__` /
 * `__final__`. When two drawn elements would get the same id, the later
 * one takes its qualified name.
 */
import type { DiagramEdge, DiagramGraph, DiagramNode, EdgeKind, NodeKind } from '../../types';
import type { TkSession, Toolkit } from '../api';
import { isReference, type ElementRecord, type ExtractedModel, type UnitInfo } from '../model';

export interface DiagramInput {
	tk: Toolkit;
	session: TkSession;
	model: ExtractedModel;
	/** The units by path, for text the model doesn't carry (view exposes, guards). */
	units: Map<string, UnitInfo>;
}

/** Records the diagrams never draw: notation, not model content. */
const INVISIBLE = /^(Documentation|Comment|MetadataUsage|TextualRepresentation)$/;
/** Connector-like usages: drawn as edges, never as boxes. */
export const CONNECTORS =
	/^(Connection|Interface|Flow|SuccessionFlow|BindingConnectorAs|SuccessionAs|Allocation|Transition|Succession)Usage$|^(BindingConnector|Succession|Connector)$/;

export class DiagramContext {
	readonly input: DiagramInput;
	readonly records: ElementRecord[];
	readonly byId: Map<string, ElementRecord>;
	/** Owned records by owner id, in declaration order. */
	readonly children = new Map<string, ElementRecord[]>();

	constructor(input: DiagramInput) {
		this.input = input;
		this.records = input.model.elements;
		this.byId = input.model.byId;
		for (const r of this.records) {
			if (!r.ownerId) continue;
			const list = this.children.get(r.ownerId) ?? [];
			list.push(r);
			this.children.set(r.ownerId, list);
		}
	}

	/** Visible owned members: named, or a connector (edges are drawn from those). */
	members(owner: ElementRecord | string): ElementRecord[] {
		const id = typeof owner === 'string' ? owner : owner.id;
		return (this.children.get(id) ?? []).filter((r) => !INVISIBLE.test(r.metaclass));
	}

	/** Named owned features (usages), for compartments and trees. */
	features(owner: ElementRecord): ElementRecord[] {
		return this.members(owner).filter(
			(r) => !r.isDefinition && !!r.name && !CONNECTORS.test(r.metaclass)
		);
	}

	/**
	 * The element a scope names: a qualified name, or a simple name as
	 * written or plain, preferring `prefer`'s answer among several.
	 */
	resolve(
		scope: string,
		prefer: (r: ElementRecord) => number = () => 0
	): ElementRecord | undefined {
		const plain = scope.replace(/^'|'$/g, '');
		const unquoted = (q: string | null) => q?.replace(/'/g, '') ?? '';
		const candidates = this.records.filter(
			(r) =>
				!!r.name &&
				(r.qualifiedName === scope ||
					unquoted(r.qualifiedName) === unquoted(scope) ||
					r.written === scope ||
					r.name === plain)
		);
		const exact = (r: ElementRecord) =>
			r.qualifiedName === scope || unquoted(r.qualifiedName) === unquoted(scope) ? 8 : 0;
		const library = (r: ElementRecord) => (r.path.startsWith('libraries/') ? 0 : 1);
		return candidates.sort(
			(a, b) =>
				exact(b) + prefer(b) * 2 + library(b) - (exact(a) + prefer(a) * 2 + library(a)) ||
				depth(this, a) - depth(this, b)
		)[0];
	}

	/** Text of an element's whole declaration (body included), as the person wrote it. */
	textOf(r: ElementRecord): string {
		const unit = this.input.units.get(r.path);
		return unit ? unit.original.text.slice(r.span.from, r.span.to) : '';
	}

	/** The element's own ancestors, nearest first. */
	*ancestors(r: ElementRecord): Generator<ElementRecord> {
		for (let at = r.ownerId ? this.byId.get(r.ownerId) : undefined; at;) {
			yield at;
			at = at.ownerId ? this.byId.get(at.ownerId) : undefined;
		}
	}
}

function depth(ctx: DiagramContext, r: ElementRecord): number {
	return [...ctx.ancestors(r)].length;
}

/** A diagram under construction. */
export class GraphBuilder {
	readonly nodes: DiagramNode[] = [];
	readonly edges: DiagramEdge[] = [];
	readonly subgraphs: DiagramGraph['subgraphs'] = [];
	/** Node id by element id. */
	readonly drawn = new Map<string, string>();
	private readonly taken = new Set<string>();
	private readonly edgeKeys = new Set<string>();
	title: string;

	constructor(title: string) {
		this.title = title;
	}

	has(id: string): boolean {
		return this.taken.has(id);
	}

	/** A free id: `preferred`, else `fallback`, else `preferred#2`, …. */
	freeId(preferred: string, fallback?: string | null): string {
		if (!this.taken.has(preferred)) return preferred;
		if (fallback && !this.taken.has(fallback)) return fallback;
		for (let i = 2; ; i++) if (!this.taken.has(`${preferred}#${i}`)) return `${preferred}#${i}`;
	}

	add(
		node: Omit<DiagramNode, 'attributes' | 'stereotype' | 'is_definition'> &
			Partial<Pick<DiagramNode, 'attributes' | 'stereotype' | 'is_definition'>>,
		record?: ElementRecord
	): DiagramNode {
		const full: DiagramNode = {
			stereotype: null,
			attributes: [],
			is_definition: false,
			...node,
			...(record ? { element: { file: record.path, start_byte: record.span.start_byte } } : {})
		};
		this.taken.add(full.id);
		this.nodes.push(full);
		if (record) this.drawn.set(record.id, full.id);
		return full;
	}

	/**
	 * An edge between two drawn nodes; the same edge twice is kept once.
	 * `record` is the element it draws (a transition, a succession), which
	 * diagrams edit it through.
	 */
	edge(
		source: string,
		target: string,
		kind: EdgeKind,
		label: string | null = null,
		record?: ElementRecord,
		ports: { source?: string | null; target?: string | null } = {}
	): void {
		if (!this.taken.has(source) || !this.taken.has(target)) return;
		const key = [kind, source, target, label ?? '', ports.source ?? '', ports.target ?? ''].join(
			'\u0000'
		);
		if (this.edgeKeys.has(key)) return;
		this.edgeKeys.add(key);
		this.edges.push({
			source,
			target,
			label,
			kind,
			...(ports.source ? { source_port: ports.source } : {}),
			...(ports.target ? { target_port: ports.target } : {}),
			...(record
				? {
						element: {
							file: record.path,
							start_byte: record.span.start_byte,
							end_byte: record.span.end_byte
						}
					}
				: {})
		});
	}

	graph(direction = 'top_bottom'): DiagramGraph {
		return {
			title: this.title,
			nodes: this.nodes,
			edges: this.edges,
			subgraphs: this.subgraphs,
			direction
		};
	}
}

/** The keyword of an element as SysML writes it: `part def`, `perform action`, `state`. */
export function keywordOf(r: ElementRecord): string {
	const base = r.kind.replace(/_/g, ' ');
	if (r.kind === 'package') return 'package';
	return r.isDefinition ? `${base} def` : base;
}

/** `name : ~Type [mult]` (or `name :> General` when untyped), as written. */
export function usageLabel(r: ElementRecord): string {
	const name = r.written ?? r.name ?? '';
	const multiplicity = multiplicityText(r);
	if (r.type) return `${name} : ${r.conjugated ? '~' : ''}${r.type}${multiplicity}`;
	if (r.specializes[0] && !r.redefines) return `${name} :> ${r.specializes[0]}${multiplicity}`;
	return name + multiplicity;
}

function multiplicityText(r: ElementRecord): string {
	const m = /\[([^\]]*)\]/.exec(r.header.split(/\s(?:=|:=|default)\s/)[0] ?? '');
	return m && m[1]!.trim() ? ` [${m[1]!.trim()}]` : '';
}

/** `<SYS-001> 'Flight endurance'`: the name, after its short name when it has one. */
export function nameLabel(r: ElementRecord): string {
	const name = r.written ?? r.name ?? '';
	return r.shortName ? `<${r.shortName}> ${name}` : name;
}

/** The node kind a record draws as. */
export function nodeKindOf(r: ElementRecord): NodeKind {
	if (r.kind === 'package') return 'package';
	if (/^Requirement|^Concern/.test(r.metaclass)) return 'requirement';
	if (/^Constraint|^AssertConstraint/.test(r.metaclass)) return 'constraint';
	if (/^UseCase|^IncludeUseCase/.test(r.metaclass)) return 'use_case';
	if (r.kind === 'actor') return 'actor';
	if (/^State|^ExhibitState/.test(r.metaclass)) return 'state';
	if (/Action(Usage|Definition)$/.test(r.metaclass)) return 'action';
	if (/^Port/.test(r.metaclass) && !r.isDefinition) return 'port';
	return 'block';
}

/** Parameters whose direction goes without saying. */
const UNDIRECTED = new Set(['subject', 'actor', 'stakeholder', 'objective', 'return']);

/** A compartment row for a feature: `[keyword, text]` with its direction (`in port`). */
export function featureRow(r: ElementRecord): [string, string] {
	const keyword = `${r.kind !== 'attribute' && isReference(r) ? 'ref ' : ''}${r.kind.replace(/_/g, ' ')}`;
	const directed = r.direction && !UNDIRECTED.has(r.kind) ? `${r.direction} ${keyword}` : keyword;
	let text = usageLabel(r);
	if (r.value && r.value.length <= 32 && !/\n/.test(r.value)) text += ` = ${r.value}`;
	return [directed, text];
}

/** Docs as one paragraph, for a requirement's text. */
export function docText(r: ElementRecord): string | null {
	const doc = r.docs.join(' ').replace(/\s+/g, ' ').trim();
	return doc || null;
}

/** A view's `expose`, `filter` and `render` members as compartment rows. */
export function viewRows(text: string): [string, string][] {
	const rows: [string, string][] = [];
	const body = text.slice(text.indexOf('{') + 1);
	for (const m of body.matchAll(/(?:^|[;{}\s])(expose|filter|render)\s+([^;{]+?)\s*;/g)) {
		rows.push([m[1]!, m[2]!.replace(/\s+/g, ' ')]);
	}
	return rows;
}

/** A path as written, without the whitespace outside quoted names: `a . 'b c'` → `a.'b c'`. */
export function squash(path: string): string {
	return path.replace(/'(?:[^'\\]|\\.)*'|\s+/g, (m) => (m.startsWith("'") ? m : ''));
}
