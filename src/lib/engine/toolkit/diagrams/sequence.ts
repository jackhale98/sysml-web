/**
 * The Sequence View (`SequenceView`): the lifelines of an interaction and
 * the messages between them, top to bottom in time order.
 *
 * Built from the model adapter's records, as the toolkit's own sequence
 * emitter (`toPlantuml({view: 'sequence'})`, which `toGraph` doesn't offer)
 * reads the model, so both agree:
 *
 * - **Messages** are the flow-family usages under the scope (`message`,
 *   `flow`, `succession flow`), each drawn from the lifeline its `from` end
 *   names to the one its `to` end names. An end written through an event
 *   occurrence (`from producer.publishSent`) lands on the part before the
 *   event; any other end on the deepest part, item or occurrence it names.
 *   A message declared without ends (`message m of T;`) takes them from
 *   events that say they are its ends (`event m.sourceEvent;`).
 * - **Ends** are resolved by name from where the message is written (the
 *   enclosing namespaces, their members and what their types define), as
 *   the language resolves a feature chain. The toolkit's own resolved ends
 *   (`sourceFeature`) cost a whole-model derivation pass on first read, and
 *   it gives none for an end written as a plain part.
 * - **Order**: events on a lifeline are ordered by `then` and
 *   `first a then b`, messages by `then message` and by their events; a
 *   message comes before another when any of its events precedes any of
 *   the other's. Declaration order breaks ties.
 * - **Lifelines**: the parts, items and occurrences the interaction owns,
 *   and every other part a message reaches, in declaration order.
 *
 * Node ids are a lifeline's path as written (`operator`,
 * `vehicle.cruiseController`). Edges are the messages, in time order, with
 * their element and `SequenceMessage` details.
 */
import type { DiagramGraph, SequenceMessage } from '../../types';
import { isReference, type ElementRecord } from '../model';
import { type DiagramContext, GraphBuilder, docText, usageLabel } from './context';

const FLOW = /^(Flow|SuccessionFlow)Usage$/;
const EVENT = /^EventOccurrenceUsage$/;
const OCCURRENCE = /^(EventOccurrence|Occurrence)Usage$/;
/** What a lifeline can be. */
const PARTICIPANT = /^(Part|Item|Occurrence|Reference|Port|Connection|Interface)Usage$|^Usage$/;
/** Owned features drawn as lifelines even without messages. */
const LIFELINE = /^(Part|Item|Occurrence|Reference)Usage$/;
const SUBJECT = /^Occurrence(Definition|Usage)$|^(Part|Item)(Definition|Usage)$/;

interface End {
	/** The lifeline's element, when the end resolves. */
	participant: ElementRecord | null;
	/** The lifeline's path as written (`vehicle.cruiseController`). */
	path: string;
	event: ElementRecord | null;
}

interface Message {
	record: ElementRecord;
	from: End;
	to: End;
	payload: string | null;
	index: number;
}

export function sequenceView(ctx: DiagramContext, scope: string | null): DiagramGraph {
	const subject = scope
		? ctx.resolve(scope, (r) => (SUBJECT.test(r.metaclass) ? 2 : 0))
		: ctx.records.find(
				(r) => r.metaclass === 'OccurrenceDefinition' && r.name && hasMessages(ctx, r)
			);
	const g = new GraphBuilder(`sv [${subject?.written ?? scope ?? ''}]`);
	if (!subject) return g.graph();
	new Sequence(ctx, g, subject).build();
	return g.graph();
}

function hasMessages(ctx: DiagramContext, r: ElementRecord): boolean {
	return (ctx.children.get(r.id) ?? []).some((c) => FLOW.test(c.metaclass));
}

/** Split a path as written at its dots, keeping quoted names whole: `a.'b.c'` → [a, 'b.c']. */
export function splitPath(path: string): string[] {
	return (path.match(/'(?:[^'\\]|\\.)*'|[^.\s]+/g) ?? []).map((s) => s.replace(/^'|'$/g, ''));
}

/** Words of a declaration header, quoted names kept whole. */
function tokens(header: string): string[] {
	return header.match(/'(?:[^'\\]|\\.)*'|[^\s]+/g) ?? [];
}

/**
 * `then message m of p : T [1] from a.x to b.y` → its payload and written ends.
 * The payload is its type when it has one (`p : T` → `T`), else as written.
 */
export function readMessageHeader(header: string): {
	payload: string | null;
	from: string | null;
	to: string | null;
} {
	const words = tokens(header);
	const at = (word: string) => words.indexOf(word);
	const of = at('of');
	const from = at('from');
	const to = from >= 0 ? words.indexOf('to', from + 1) : -1;
	let payload: string | null = null;
	if (of >= 0) {
		const end = from > of ? from : words.length;
		let text = words.slice(of + 1, end).join(' ');
		text = text.split(/\s(?:=|:=|default)\s/)[0]!;
		const typed = /(?:^|\s):\s*(.+)$/.exec(text);
		payload = (typed ? typed[1]! : text).replace(/\s*\[[^\]]*\]\s*$/, '').trim() || null;
	}
	return {
		payload,
		from: from >= 0 ? words.slice(from + 1, to >= 0 ? to : undefined).join('') || null : null,
		to: to >= 0 ? words.slice(to + 1).join('') || null : null
	};
}

class Sequence {
	private readonly ctx: DiagramContext;
	private readonly g: GraphBuilder;
	private readonly subject: ElementRecord;
	private readonly order: Map<string, number>;
	/** Event (or message send/receive point) → what comes after it. */
	private readonly after = new Map<string, Set<string>>();

	constructor(ctx: DiagramContext, g: GraphBuilder, subject: ElementRecord) {
		this.ctx = ctx;
		this.g = g;
		this.subject = subject;
		this.order = new Map(ctx.records.map((r, i) => [r.id, i]));
	}

	build() {
		const inside = this.descendants(this.subject);
		const flows = inside.filter((r) => FLOW.test(r.metaclass));
		const declaredEnds = this.declaredEnds(inside);
		const messages: Message[] = [];
		for (const [index, record] of flows.entries()) {
			const head = readMessageHeader(record.header);
			const owner = record.ownerId ? this.ctx.byId.get(record.ownerId) : undefined;
			const declared = declaredEnds.get(record.id);
			const from = head.from
				? this.end(owner, head.from)
				: declared?.source
					? this.eventEnd(declared.source)
					: null;
			const to = head.to
				? this.end(owner, head.to)
				: declared?.target
					? this.eventEnd(declared.target)
					: null;
			if (!from || !to) continue;
			messages.push({ record, from, to, payload: head.payload, index });
		}

		// Time order: events by their successions, messages by theirs and by their events
		// (also on lifelines declared outside the interaction).
		const owners = new Set([this.subject, ...inside]);
		for (const m of messages)
			for (const e of [m.from.event, m.to.event]) {
				const owner = e?.ownerId ? this.ctx.byId.get(e.ownerId) : undefined;
				if (owner) owners.add(owner);
			}
		for (const owner of owners) this.successions(owner);
		for (const m of messages) {
			this.link(this.send(m), this.receive(m));
		}
		const sorted = this.sort(messages);

		// Lifelines: the interaction's own, then every one a message reaches, in declaration order.
		const lifelines = new Map<string, { record: ElementRecord | null; path: string; at: number }>();
		const addLifeline = (record: ElementRecord | null, path: string, at: number) => {
			const key = record?.id ?? `path:${path}`;
			if (!lifelines.has(key)) lifelines.set(key, { record, path, at });
		};
		for (const r of this.ctx.members(this.subject)) {
			if (LIFELINE.test(r.metaclass) && r.name && !r.isDefinition)
				addLifeline(r, r.written ?? r.name, this.order.get(r.id) ?? 0);
		}
		for (const [i, m] of sorted.entries()) {
			for (const end of [m.from, m.to]) {
				const at = end.participant
					? (this.order.get(end.participant.id) ?? 0)
					: this.ctx.records.length + i;
				addLifeline(end.participant, end.path, at);
			}
		}
		const nodeOf = new Map<string, string>();
		for (const [key, l] of [...lifelines].sort((a, b) => a[1].at - b[1].at)) {
			const r = l.record;
			const prefix = l.path.includes('.') ? l.path.slice(0, l.path.lastIndexOf('.') + 1) : '';
			const node = this.g.add(
				{
					id: this.g.freeId(l.path),
					label: r ? prefix + usageLabel(r) : l.path,
					kind: 'lifeline',
					stereotype: r ? `<<${isReference(r) ? 'ref ' : ''}${r.kind.replace(/_/g, ' ')}>>` : null,
					attributes: r && this.docOf(r) ? [['doc', this.docOf(r)!]] : []
				},
				r ?? undefined
			);
			nodeOf.set(key, node.id);
		}

		const keyOf = (end: End) => end.participant?.id ?? `path:${end.path}`;
		for (const m of sorted) {
			const r = m.record;
			const message: SequenceMessage = {
				name: r.written ?? r.name,
				payload: m.payload,
				doc: docText(r),
				...(m.from.event?.name ? { sourceEvent: m.from.event.name } : {}),
				...(m.to.event?.name ? { targetEvent: m.to.event.name } : {})
			};
			const name = r.written ?? r.name;
			const label =
				name && m.payload
					? `${name} of ${m.payload}`
					: (name ?? (m.payload ? `of ${m.payload}` : null));
			this.g.edges.push({
				source: nodeOf.get(keyOf(m.from))!,
				target: nodeOf.get(keyOf(m.to))!,
				label,
				kind: 'message',
				element: { file: r.path, start_byte: r.span.start_byte },
				message
			});
		}
	}

	/** A lifeline's doc: its own, else its type's. */
	private docOf(r: ElementRecord): string | null {
		const type = r.typeIds.map((id) => this.ctx.byId.get(id)).find((t) => !!t);
		return docText(r) ?? (type ? docText(type) : null);
	}

	/** Every record under `r`, in declaration order. */
	private descendants(r: ElementRecord): ElementRecord[] {
		const out: ElementRecord[] = [];
		const walk = (id: string, depth: number) => {
			if (depth > 32) return;
			for (const c of this.ctx.children.get(id) ?? []) {
				out.push(c);
				walk(c.id, depth + 1);
			}
		};
		walk(r.id, 0);
		return out;
	}

	/** `event m.sourceEvent;` in a lifeline: the events that say they are a message's ends. */
	private declaredEnds(inside: ElementRecord[]) {
		const ends = new Map<string, { source?: ElementRecord; target?: ElementRecord }>();
		for (const e of inside) {
			if (!OCCURRENCE.test(e.metaclass) && !this.standsIn(e)) continue;
			const m = /^(?:then\s+)?event\s+(?:occurrence\s+)?(.+?)\s*$/.exec(e.header);
			const path = m ? splitPath(m[1]!.split(/\s*[:;=]/)[0]!) : [];
			const which = path.at(-1);
			if (path.length < 2 || (which !== 'sourceEvent' && which !== 'targetEvent')) continue;
			const owner = e.ownerId ? this.ctx.byId.get(e.ownerId) : undefined;
			const chain = this.chain(owner, path.slice(0, -1));
			const message = chain?.at(-1);
			if (!message || !FLOW.test(message.metaclass)) continue;
			const entry = ends.get(message.id) ?? {};
			entry[which === 'sourceEvent' ? 'source' : 'target'] = e;
			ends.set(message.id, entry);
		}
		return ends;
	}

	/** An end declared by an event in a lifeline: the event's owner is the lifeline. */
	private eventEnd(event: ElementRecord): End | null {
		const owner = event.ownerId ? this.ctx.byId.get(event.ownerId) : undefined;
		if (!owner) return null;
		return { participant: owner, path: this.pathOf(owner), event };
	}

	/** A lifeline's path from the interaction: `vehicle.cruiseController`. */
	private pathOf(r: ElementRecord): string {
		const names: string[] = [];
		for (let at: ElementRecord | undefined = r; at && at.id !== this.subject.id;) {
			if (at.isDefinition || at.kind === 'package') break;
			names.unshift(at.written ?? at.name ?? '');
			at = at.ownerId ? this.ctx.byId.get(at.ownerId) : undefined;
		}
		return names.join('.') || (r.written ?? r.name ?? '');
	}

	/** One end as written (`producer.publishSent`), resolved from where the message is. */
	private end(owner: ElementRecord | undefined, written: string): End {
		const segments = splitPath(written);
		const chain = this.chain(owner, segments);
		if (!chain) return { participant: null, path: segments.join('.'), event: null };
		const last = chain.at(-1)!;
		if (EVENT.test(last.metaclass) || (chain.length > 1 && OCCURRENCE.test(last.metaclass))) {
			const participant =
				chain.length > 1
					? chain.at(-2)!
					: last.ownerId
						? this.ctx.byId.get(last.ownerId)
						: undefined;
			return {
				participant: participant ?? null,
				path:
					chain.length > 1
						? segments.slice(0, -1).join('.')
						: participant
							? this.pathOf(participant)
							: written,
				event: last
			};
		}
		let at = chain.length - 1;
		while (at > 0 && !PARTICIPANT.test(chain[at]!.metaclass)) at--;
		return { participant: chain[at]!, path: segments.slice(0, at + 1).join('.'), event: null };
	}

	/** The records a feature chain names, the first link found from `owner` outwards. */
	private chain(owner: ElementRecord | undefined, segments: string[]): ElementRecord[] | null {
		if (!segments.length) return null;
		let first: ElementRecord | undefined;
		for (let at = owner; at && !first; at = at.ownerId ? this.ctx.byId.get(at.ownerId) : undefined)
			first = this.member(at, segments[0]!);
		if (!first) return null;
		const chain = [first];
		for (const name of segments.slice(1)) {
			const next = this.member(chain.at(-1)!, name);
			if (!next) return null;
			chain.push(next);
		}
		return chain;
	}

	/** A member named `name`: owned, or defined by the element's types and supertypes. */
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

	// ---- Order ----

	private send(m: Message): string {
		return m.from.event?.id ?? `${m.record.id}#send`;
	}

	private receive(m: Message): string {
		return m.to.event?.id ?? `${m.record.id}#receive`;
	}

	private link(from: string, to: string) {
		if (from === to) return;
		const set = this.after.get(from) ?? new Set<string>();
		set.add(to);
		this.after.set(from, set);
	}

	/**
	 * The successions among `owner`'s members: `then x` after the feature
	 * before it, `first a then b` by name. Between events and messages; a
	 * message stands for its send.
	 */
	private successions(owner: ElementRecord) {
		const point = (r: ElementRecord | undefined): string | null =>
			!r
				? null
				: FLOW.test(r.metaclass)
					? `${r.id}#send`
					: OCCURRENCE.test(r.metaclass) || this.standsIn(r)
						? r.id
						: null;
		let previous: ElementRecord | undefined;
		let pendingThen = false;
		for (const r of this.ctx.children.get(owner.id) ?? []) {
			if (this.standsIn(r)) {
				const [pa, pb] = [point(previous), point(r)];
				if (pa && pb) this.link(pa, pb);
				previous = r;
				pendingThen = false;
				continue;
			}
			if (/^Succession(AsUsage)?$/.test(r.metaclass)) {
				const firstThen = /^(?:succession\s+(?:\S+\s+)?)?first\s+(.+?)\s+then\s+(.+?)\s*$/.exec(
					r.header
				);
				if (firstThen) {
					const a = this.chain(owner, splitPath(firstThen[1]!))?.at(-1);
					const b = this.chain(owner, splitPath(firstThen[2]!))?.at(-1);
					const [pa, pb] = [point(a), point(b)];
					if (pa && pb) this.link(pa, pb);
				} else if (/^then\b/.test(r.header)) pendingThen = true;
				continue;
			}
			if (/^(Documentation|Comment|MetadataUsage)$/.test(r.metaclass)) continue;
			if (pendingThen) {
				const [pa, pb] = [point(previous), point(r)];
				if (pa && pb) this.link(pa, pb);
			}
			pendingThen = false;
			previous = r;
		}
	}

	/**
	 * The event `then event m.sourceEvent;` declares has no source extent in
	 * the toolkit, so the adapter has no record of it: its succession stands
	 * in for it. (`then event occurrence e;` has both, with the same header.)
	 */
	private standsIn(r: ElementRecord): boolean {
		if (!/^Succession(AsUsage)?$/.test(r.metaclass) || !/^then\s+event\b/.test(r.header))
			return false;
		const siblings = this.ctx.children.get(r.ownerId ?? '') ?? [];
		return siblings[siblings.indexOf(r) + 1]?.header !== r.header;
	}

	/** Can `to` be reached from `from` in the order? */
	private reaches(from: string, to: string): boolean {
		const seen = new Set<string>();
		const stack = [from];
		while (stack.length) {
			const at = stack.pop()!;
			if (at === to) return true;
			if (seen.has(at)) continue;
			seen.add(at);
			for (const next of this.after.get(at) ?? []) stack.push(next);
		}
		return false;
	}

	/**
	 * Messages in time order: `a` before `b` when any of a's events comes
	 * before any of b's; otherwise in declaration order. A cycle (an order
	 * that contradicts itself) is broken in declaration order.
	 */
	private sort(messages: Message[]): Message[] {
		const points = (m: Message) => [this.send(m), this.receive(m)];
		const before = messages.map((a) =>
			messages.map(
				(b) => a !== b && points(a).some((p) => points(b).some((q) => this.reaches(p, q)))
			)
		);
		const left = new Set(messages.map((_, i) => i));
		const out: Message[] = [];
		while (left.size) {
			const free = [...left].filter((i) => ![...left].some((j) => j !== i && before[j]![i]));
			const next = free.length ? Math.min(...free) : Math.min(...left);
			left.delete(next);
			out.push(messages[next]!);
		}
		return out;
	}
}
