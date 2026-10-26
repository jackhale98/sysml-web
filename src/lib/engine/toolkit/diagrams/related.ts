/**
 * How the project's elements are related, both ways (`EngineApi.related`):
 * what an element specializes or is defined by, what it satisfies or
 * verifies, and what it is connected, bound, allocated or flows to. The
 * inspector lists them; a general view adds an element's neighbours from
 * them.
 *
 * Types, specializations and trace links are the toolkit's resolved ids.
 * A connector's ends are read from its declaration (`connect a.p to b.q`,
 * `allocate x to y`, `flow … from a to b`, `bind a = b`) and resolved by
 * name from where it is written, as the language resolves a feature chain
 * (the toolkit's own resolved ends cost a pass over the whole model). An end
 * on a port stands for the part the port is on, as a general view draws it.
 * FMEA lines come from the caller (`views/impact.ts`): an `@Fmea about x`
 * line relates x to the risk controls, mitigations and hazard it names.
 * Indexed once per analysis, in a few milliseconds on the demo.
 */
import type { RelatedElement, RelationKind } from '../../types';
import type { ElementRecord } from '../model';
import type { DiagramContext } from './context';

export interface Relation {
	from: string;
	to: string;
	kind: RelationKind;
	via?: string;
}

export class Relations {
	private readonly ctx: DiagramContext;
	private readonly byElement = new Map<string, Relation[]>();

	constructor(ctx: DiagramContext, more: readonly Relation[] = []) {
		this.ctx = ctx;
		for (const r of ctx.records) this.collect(r);
		for (const r of more) this.add(r);
		for (const t of ctx.input.model.traces) {
			if (t.byId && t.requirementId)
				this.add({
					from: t.byId,
					to: t.requirementId,
					kind: t.kind === 'satisfy' ? 'satisfies' : 'verifies'
				});
		}
	}

	/** What `id` is related to, its own statements first, each once per kind and direction. */
	of(id: string): RelatedElement[] {
		const out: RelatedElement[] = [];
		const seen = new Set<string>();
		for (const r of this.byElement.get(id) ?? []) {
			const direction = r.from === id ? 'out' : 'in';
			const other = this.ctx.byId.get(direction === 'out' ? r.to : r.from);
			if (!other?.name || other.id === id) continue;
			const key = `${direction} ${r.kind} ${other.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				kind: r.kind,
				direction,
				element: {
					id: other.id,
					name: other.name,
					qualifiedName: other.qualifiedName,
					kind: other.kind,
					isDefinition: other.isDefinition,
					file: other.path,
					start_byte: other.span.start_byte
				},
				...(r.via ? { via: r.via } : {})
			});
		}
		return out.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1));
	}

	private add(r: Relation) {
		if (r.from === r.to) return;
		for (const id of [r.from, r.to]) {
			const list = this.byElement.get(id) ?? [];
			list.push(r);
			this.byElement.set(id, list);
		}
	}

	private collect(r: ElementRecord) {
		for (const g of r.generalIds) this.add({ from: r.id, to: g, kind: 'specializes' });
		if (!r.isDefinition) for (const t of r.typeIds) this.add({ from: r.id, to: t, kind: 'typed' });
		const kind = CONNECTOR_KINDS[r.metaclass];
		if (!kind) return;
		const via = r.name ?? undefined;
		const owner = r.ownerId ? this.ctx.byId.get(r.ownerId) : undefined;
		const ends = (this.ctx.children.get(r.id) ?? []).filter((e) => e.end);
		if (ends.length) {
			// Ends declared as features: `end #derive ::> 'Flight endurance';`.
			const named = ends.map((e) => ({
				at: e.specializes[0] ? this.endAt(owner, e.specializes[0]) : undefined,
				derived: /#\s*derive\b/.test(e.header)
			}));
			if (/#\s*derivation\b/.test(r.header)) {
				const original = named.find((e) => !e.derived)?.at;
				for (const e of named)
					if (e.derived && e.at && original)
						this.add({ from: e.at.id, to: original.id, kind: 'derives' });
				return;
			}
			const [first, ...rest] = named;
			for (const e of rest)
				if (first?.at && e.at) this.add({ from: first.at.id, to: e.at.id, kind, via });
			return;
		}
		const written = WRITTEN_ENDS[kind]?.exec(r.header.replace(/\s+/g, ' '));
		if (!written) return;
		const from = this.endAt(owner, written[1]!);
		const to = this.endAt(owner, written[2]!);
		if (from && to) this.add({ from: from.id, to: to.id, kind, via });
	}

	/**
	 * The element an end names, from where its connector is written: the
	 * first name found in the owner or the namespaces around it (else a
	 * package, or a package's member it imports), then each next one a member
	 * of the last. An end on a port stands for the element the port is on.
	 */
	private endAt(owner: ElementRecord | undefined, written: string): ElementRecord | undefined {
		const names = segments(written);
		if (!names.length) return undefined;
		let first: ElementRecord | undefined;
		for (let at = owner; at && !first; at = at.ownerId ? this.ctx.byId.get(at.ownerId) : undefined)
			first = this.member(at, names[0]!);
		// Not found around it: a top-level package, or what a package imports by name.
		first ??= this.ctx.records.find((r) => r.name === names[0] && !r.ownerId);
		first ??= this.ctx.records.find((r) => {
			const at = r.ownerId ? this.ctx.byId.get(r.ownerId) : undefined;
			return r.name === names[0] && (!at || at.kind === 'package');
		});
		if (!first) return undefined;
		const chain = [first];
		for (const name of names.slice(1)) {
			const next = this.member(chain.at(-1)!, name);
			if (!next) break;
			chain.push(next);
		}
		const port = chain.findIndex((r) => r.kind === 'port');
		if (port < 0) return chain.at(-1);
		if (port > 0) return chain[port - 1];
		return owner && !owner.isDefinition ? owner : chain[0];
	}

	/** A member named `name`: owned, or given by the element's types and supertypes. */
	private member(r: ElementRecord, name: string, depth = 0): ElementRecord | undefined {
		const own = this.ctx.members(r).find((m) => m.name === name);
		if (own || depth > 8) return own;
		for (const id of [...r.typeIds, ...r.generalIds]) {
			const general = this.ctx.byId.get(id);
			const found = general && this.member(general, name, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
}

const CONNECTOR_KINDS: Record<string, RelationKind> = {
	ConnectionUsage: 'connects',
	InterfaceUsage: 'connects',
	BindingConnectorAsUsage: 'binds',
	FlowUsage: 'flows',
	SuccessionFlowUsage: 'flows',
	AllocationUsage: 'allocates'
};

/** A name as a connector's end writes it: `A::'b c'.d`. */
export const WRITTEN_NAME = String.raw`((?:'(?:[^'\\]|\\.)*'|[\w$]+)(?:\s*(?:::|\.)\s*(?:'(?:[^'\\]|\\.)*'|[\w$]+))*)`;
const NAME = WRITTEN_NAME;
/** A connector's two ends as its declaration writes them. */
export const WRITTEN_ENDS: Partial<Record<RelationKind, RegExp>> = {
	connects: new RegExp(String.raw`\bconnect\s+${NAME}\s+to\s+${NAME}`),
	allocates: new RegExp(String.raw`\ballocate\s+${NAME}\s+to\s+${NAME}`),
	flows: new RegExp(String.raw`\bfrom\s+${NAME}\s+to\s+${NAME}`),
	binds: new RegExp(String.raw`\bbind\s+${NAME}\s*=\s*${NAME}`)
};

/** `A::'b c'.d` → `A`, `b c`, `d`. */
function segments(written: string): string[] {
	return (written.match(/'(?:[^'\\]|\\.)*'|[^.:\s]+/g) ?? []).map((s) =>
		s.replace(/^'|'$/g, '').replace(/\\(.)/g, '$1')
	);
}
