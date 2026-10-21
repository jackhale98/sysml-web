/**
 * What the tables read from one analysis: the model adapter's element
 * records indexed by owner, type and file, the metadata annotations and
 * trace links with the elements they belong to, and the declaration texts.
 * Built once per toolkit session, on the first table or view list asked of
 * it.
 */
import type { MetadataAnnotation, TraceLink } from '../../types';
import type { TkSession } from '../api';
import type { ElementRecord, ExtractedModel } from '../model';
import { unquoteName } from './text';

export interface Annotation extends MetadataAnnotation {
	/** The metadata usage's own record (absent if the adapter skipped it). */
	record: ElementRecord | undefined;
	path: string;
}

export interface Link extends TraceLink {
	/** The satisfy usage, or the requirement usage of a `verify`. */
	record: ElementRecord | undefined;
	path: string;
}

export interface ViewSource {
	session: TkSession | null;
	extracted: ExtractedModel | null;
	/** The project's own files: rows come only from these. */
	content: ReadonlySet<string>;
	/** The text of every unit (project files and bundled libraries), by path. */
	texts: ReadonlyMap<string, string>;
}

const NO_RECORDS: ElementRecord[] = [];

export class ViewContext {
	readonly session: TkSession | null;
	readonly records: readonly ElementRecord[];
	readonly byId: ReadonlyMap<string, ElementRecord>;
	readonly content: ReadonlySet<string>;
	readonly texts: ReadonlyMap<string, string>;
	readonly annotations: Annotation[] = [];
	readonly satisfactions: Link[] = [];
	readonly verifications: Link[] = [];
	private readonly owned = new Map<string, ElementRecord[]>();
	private readonly named = new Map<string, ElementRecord[]>();
	private readonly annotationsOf = new Map<string, Annotation[]>();
	private readonly supersCache = new Map<string, string[]>();
	private interconnect: InterconnectEdge[] | undefined;
	private readonly metaclasses = new Map<string, string | null>();
	private readonly conformance = new Map<string, boolean>();

	constructor(source: ViewSource) {
		this.session = source.session;
		this.records = source.extracted?.elements ?? [];
		this.byId = source.extracted?.byId ?? new Map();
		this.content = source.content;
		this.texts = source.texts;
		const at = new Map<string, ElementRecord>();
		for (const record of this.records) {
			if (record.ownerId) push(this.owned, record.ownerId, record);
			if (record.parentId) push(this.named, record.parentId, record);
			at.set(`${record.path}@${record.span.start_byte}`, record);
		}
		for (const [path, model] of source.extracted?.models ?? []) {
			for (const a of model.annotations ?? []) {
				const annotation: Annotation = {
					...a,
					record: at.get(`${path}@${a.span.start_byte}`),
					path
				};
				this.annotations.push(annotation);
				if (a.target_id) push(this.annotationsOf, a.target_id, annotation);
			}
			for (const s of model.satisfactions)
				this.satisfactions.push({ ...s, record: at.get(`${path}@${s.span.start_byte}`), path });
			for (const v of model.verifications)
				this.verifications.push({ ...v, record: at.get(`${path}@${v.span.start_byte}`), path });
		}
	}

	isContent(record: ElementRecord): boolean {
		return this.content.has(record.path);
	}

	/** Elements the given one owns directly, in declaration order. */
	ownedBy(id: string): ElementRecord[] {
		return this.owned.get(id) ?? NO_RECORDS;
	}

	/** Elements whose nearest named owner is the given one (anonymous owners are see-through). */
	membersOf(id: string): ElementRecord[] {
		return this.named.get(id) ?? NO_RECORDS;
	}

	/** Metadata annotating the element. */
	metadataOf(id: string): Annotation[] {
		return this.annotationsOf.get(id) ?? [];
	}

	/** The element's owners, outermost first (not the element itself). */
	ownerChain(record: ElementRecord): string[] {
		const chain: string[] = [];
		for (let at = record.ownerId; at && chain.length < 128;) {
			chain.unshift(at);
			at = this.byId.get(at)?.ownerId ?? null;
		}
		return chain;
	}

	/** The declaration's text as the person wrote it. */
	textOf(record: ElementRecord): string {
		const text = this.texts.get(record.path) ?? '';
		return record.span.from !== undefined && record.span.to !== undefined
			? text.slice(record.span.from, record.span.to)
			: '';
	}

	/**
	 * What the element's features come from: its type, its specializations
	 * and, through a usage it subsets, that usage's — transitively, nearest
	 * first. Ids of library elements end a chain (they have no records).
	 */
	supers(id: string): string[] {
		const cached = this.supersCache.get(id);
		if (cached) return cached;
		const out: string[] = [];
		const seen = new Set([id]);
		const queue = [id];
		while (queue.length && out.length < 256) {
			const record = this.byId.get(queue.shift()!);
			if (!record) continue;
			for (const next of [...record.typeIds, ...this.generalsOf(record)]) {
				if (seen.has(next)) continue;
				seen.add(next);
				out.push(next);
				queue.push(next);
			}
		}
		this.supersCache.set(id, out);
		return out;
	}

	/**
	 * What a definition or usage specializes: as the toolkit resolved it, else
	 * (the tree graph doesn't draw attribute defs, for one) the definitions of the
	 * project its written specializations name.
	 */
	generalsOf(record: ElementRecord): string[] {
		if (record.generalIds.length || !record.specializes.length) return record.generalIds;
		return record.specializes
			.map((written) => this.definitionNamed(written))
			.filter((id): id is string => !!id && id !== record.id);
	}

	/** Whether `id` is `ancestor` or reaches it through types and specializations. */
	conforms(id: string, ancestor: string): boolean {
		return id === ancestor || this.supers(id).includes(ancestor);
	}

	/** The definition a usage's features come from: its type, or a subsetted usage's. */
	effectiveType(record: ElementRecord, depth = 0): string | null {
		if (record.typeIds[0]) return record.typeIds[0];
		if (depth > 16) return null;
		for (const general of this.generalsOf(record)) {
			const target = this.byId.get(general);
			if (!target) return general;
			if (target.isDefinition) return general;
			const type = this.effectiveType(target, depth + 1);
			if (type) return type;
		}
		return null;
	}

	/** The usage a usage subsets (`part drone :> Architecture::drone`), if any. */
	subsettedUsage(record: ElementRecord): ElementRecord | undefined {
		if (record.isDefinition) return undefined;
		for (const general of this.generalsOf(record)) {
			const target = this.byId.get(general);
			if (target && !target.isDefinition) return target;
		}
		return undefined;
	}

	/** The name of an element, record or library, unquoted. */
	nameOf(id: string): string | null {
		const record = this.byId.get(id);
		if (record) return record.name;
		return this.withHandle(id, (h, s) => s.name(h) ?? null) ?? null;
	}

	metaclassOf(id: string): string | null {
		const record = this.byId.get(id);
		if (record) return record.metaclass;
		return this.withHandle(id, (h, s) => s.metaclass(h)) ?? null;
	}

	/** Run a read on an element's handle, freeing it after. */
	withHandle<T>(
		id: string,
		read: (handle: import('../api').TkElement, s: TkSession) => T
	): T | undefined {
		const session = this.session;
		const handle = session?.elementById(id);
		if (!session || !handle) return undefined;
		try {
			return read(handle, session);
		} catch {
			return undefined;
		} finally {
			handle.free();
		}
	}

	/** A definition by name: the project's first with that simple name, else a qualified library one. */
	definitionNamed(name: string): string | null {
		const simple = unquoteName(name.split('::').pop() ?? name);
		const found = this.records.find((r) => r.isDefinition && r.name === simple);
		if (found) return found.id;
		if (!this.session) return null;
		const candidates = name.includes('::') ? [name] : [];
		for (const candidate of candidates) {
			const handle = this.session.resolve(candidate);
			if (handle) {
				try {
					return this.session.elementId(handle);
				} finally {
					handle.free();
				}
			}
		}
		return null;
	}

	/** Whether `name` is a SysML metaclass (`PartUsage`, `Usage`, `Package`). */
	isMetaclass(name: string): boolean {
		return this.metaclassElement(name) !== null;
	}

	/** Whether metaclass `metaclass` is `wanted` or specializes it (`PartUsage` is an `ItemUsage`). */
	metaclassConforms(metaclass: string, wanted: string): boolean {
		if (metaclass === wanted) return true;
		const key = `${metaclass} ${wanted}`;
		let answer = this.conformance.get(key);
		if (answer === undefined) {
			const a = this.metaclassElement(metaclass);
			const b = this.metaclassElement(wanted);
			answer =
				!!a &&
				!!b &&
				!!this.withHandle(a, (ha, s) => {
					const hb = s.elementById(b);
					try {
						return !!hb && s.conforms(ha, hb);
					} finally {
						hb?.free();
					}
				});
			this.conformance.set(key, answer);
		}
		return answer;
	}

	/** The library's definition of a metaclass, `SysML::<name>`. */
	private metaclassElement(name: string): string | null {
		let id = this.metaclasses.get(name);
		if (id === undefined) {
			id = null;
			const handle = /^\w+$/.test(name) ? this.session?.resolve(`SysML::${name}`) : undefined;
			if (handle && this.session) {
				try {
					if (this.session.metaclass(handle) === 'MetadataDefinition')
						id = this.session.elementId(handle);
				} finally {
					handle.free();
				}
			}
			this.metaclasses.set(name, id);
		}
		return id;
	}

	/** The connections between ports the toolkit resolved (`connect`, `interface`), from its interconnection graph. */
	interconnections(): InterconnectEdge[] {
		if (this.interconnect) return this.interconnect;
		const edges: InterconnectEdge[] = [];
		try {
			const graph = JSON.parse(
				this.session?.toGraph(JSON.stringify({ view: 'interconnection' })) ?? '{"edges":[]}'
			) as { edges: { id?: string; kind: string; source: string; target: string }[] };
			for (const edge of graph.edges) {
				if ((edge.kind !== 'interface' && edge.kind !== 'connect') || !edge.id) continue;
				edges.push({ id: edge.id, source: plainId(edge.source), target: plainId(edge.target) });
			}
		} catch {
			// No graph: ports show no connections.
		}
		this.interconnect = edges;
		return edges;
	}
}

export interface InterconnectEdge {
	/** The connection or interface usage. */
	id: string;
	/** The features its ends resolve to. */
	source: string;
	target: string;
}

/** The graph names an inherited feature in context as `context~feature`. */
function plainId(id: string): string {
	const at = id.lastIndexOf('~');
	return at < 0 ? id : id.slice(at + 1);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}
