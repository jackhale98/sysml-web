/**
 * The State Transition View (`StateTransitionView`) and the Action Flow
 * View (`ActionFlowView`), from the toolkit's state and action graphs:
 * states with their entry/do/exit actions, transitions labelled
 * `trigger [guard] / effect`; actions, forks, joins, decisions and merges
 * joined by successions and flows, with the parameters of each action.
 *
 * Ids are paths inside the machine or action (`flying`, `flying.cruise`),
 * `__initial__` / `__final__` for its start and end, and `fork#1`,
 * `decide#1`, … for unnamed control nodes, numbered in declaration order.
 */
import type { DiagramGraph, NodeKind } from '../../types';
import { actionText, transitionParts, triggerText } from '../machines';
import type { ElementRecord } from '../model';
import { type DiagramContext, GraphBuilder, squash } from './context';
import { labelName, toGraph, TkTree, type TkGraphNode } from './tkgraph';

const STATE_SUBJECT = /^(State|ExhibitState)(Definition|Usage)$/;
const ACTION_SUBJECT = /(Action|UseCase|Calculation|Case)(Definition|Usage)$/;

export function stateView(ctx: DiagramContext, scope: string | null): DiagramGraph {
	const subject = scope
		? ctx.resolve(scope, (r) => (STATE_SUBJECT.test(r.metaclass) ? 2 : 0))
		: ctx.records.find((r) => r.metaclass === 'StateDefinition' && r.name);
	const g = new GraphBuilder(`stv [${subject?.written ?? scope ?? ''}]`);
	if (!subject?.qualifiedName) return g.graph();
	const graph = toGraph(ctx.input.session, 'state', subject.qualifiedName);
	if (graph) new Behavior(ctx, g, new TkTree(graph), subject, 'state').build();
	return g.graph();
}

export function actionView(ctx: DiagramContext, scope: string | null): DiagramGraph {
	const subject = scope
		? ctx.resolve(scope, (r) => (ACTION_SUBJECT.test(r.metaclass) ? 2 : 0))
		: ctx.records.find((r) => r.metaclass === 'ActionDefinition' && r.name);
	const g = new GraphBuilder(`afv [${subject?.written ?? scope ?? ''}]`);
	if (!subject?.qualifiedName) return g.graph();
	const graph = toGraph(ctx.input.session, 'action', subject.qualifiedName);
	if (graph) new Behavior(ctx, g, new TkTree(graph), subject, 'action').build();
	return g.graph();
}

const CONTROL: Record<string, { kind: NodeKind; word: string }> = {
	ForkNode: { kind: 'fork', word: 'fork' },
	JoinNode: { kind: 'join', word: 'join' },
	DecisionNode: { kind: 'decision', word: 'decide' },
	MergeNode: { kind: 'decision', word: 'merge' }
};

class Behavior {
	private readonly ctx: DiagramContext;
	private readonly g: GraphBuilder;
	private readonly tree: TkTree;
	private readonly subject: ElementRecord;
	private readonly view: 'state' | 'action';
	/** Toolkit node id → the app's node id. */
	private readonly ids = new Map<string, string>();
	private readonly counters = new Map<string, number>();

	constructor(
		ctx: DiagramContext,
		g: GraphBuilder,
		tree: TkTree,
		subject: ElementRecord,
		view: 'state' | 'action'
	) {
		this.ctx = ctx;
		this.g = g;
		this.tree = tree;
		this.subject = subject;
		this.view = view;
	}

	build() {
		const root = this.tree.byId.get(this.subject.id);
		for (const n of this.tree.graph.nodes) {
			if (n === root || n.kind === 'note') continue;
			if (n.kind === 'param') continue;
			this.node(n, root);
		}
		// Parameters, as rows of their action.
		for (const n of this.tree.graph.nodes) {
			if (n.kind !== 'param' || !n.parent) continue;
			const owner = this.g.nodes.find((x) => x.id === this.ids.get(n.parent!));
			const kind = this.ctx.byId.get(n.id)?.kind ?? 'parameter';
			owner?.attributes.push([`${n.direction ? `${n.direction} ` : ''}${kind}`, n.label]);
		}
		const placed = new Set<string>();
		for (const e of this.tree.graph.edges) {
			if (e.id) placed.add(e.id);
			const source = this.ids.get(e.source);
			const target = this.ids.get(e.target);
			if (!source || !target) continue;
			const record = e.id ? this.ctx.byId.get(e.id) : undefined;
			if (this.view === 'state') {
				const label = this.transitionLabel(record) ?? (e.label?.trim() || this.triggerOf(e.id));
				this.g.edge(source, target, 'transition', label, record);
			} else {
				const payload = e.kind === 'flow' ? (e.label ?? '').replace(/^.*?:\s*/, '') : '';
				this.g.edge(
					source,
					target,
					'flow',
					e.kind === 'flow' ? payload || null : e.label || null,
					record
				);
			}
		}
		if (this.view === 'action') this.decisionBranches(placed);
		else this.targetTransitions(placed);
		// Where it starts first, so a layout in model order reads from the start down.
		const first = (kind: string) => (kind === 'initial_state' ? 0 : 1);
		this.g.nodes.sort((a, b) => first(a.kind) - first(b.kind));
		const starts = new Set(this.g.nodes.filter((n) => n.kind === 'initial_state').map((n) => n.id));
		this.g.edges.sort((a, b) => +!starts.has(a.source) - +!starts.has(b.source));
	}

	private node(n: TkGraphNode, root: TkGraphNode | undefined) {
		const chain = this.tree.chain(n).filter((x) => x !== root && x.id !== root?.id);
		const parent = chain.length > 1 ? this.ids.get(chain.at(-2)!.id) : undefined;
		const record = this.ctx.byId.get(n.id);
		if (n.kind === 'pseudo') {
			const word = n.stereo === 'final' ? '__final__' : '__initial__';
			const id = this.g.freeId(parent ? `${parent}.${word}` : word);
			this.g.add({ id, label: '', kind: n.stereo === 'final' ? 'final_state' : 'initial_state' });
			this.ids.set(n.id, id);
			return;
		}
		const control = CONTROL[n.metaclass];
		const named = record?.written ?? (control && /^\(/.test(n.label) ? null : labelName(n.label));
		let local: string;
		if (named) local = named;
		else {
			const word = control?.word ?? 'action';
			const count = (this.counters.get(word) ?? 0) + 1;
			this.counters.set(word, count);
			local = `${word}#${count}`;
		}
		const id = this.g.freeId(parent ? `${parent}.${local}` : local, record?.qualifiedName);
		if (control) {
			this.g.add({ id, label: named ?? '', kind: control.kind }, record);
		} else if (this.view === 'state') {
			const rows = (n.rows ?? []).map((r): [string, string] => {
				const [keyword, ...rest] = r.label.split(' / ');
				return rest.length ? [keyword!.trim(), rest.join(' / ').trim()] : ['do', r.label];
			});
			this.g.add({ id, label: named ?? n.label, kind: 'state', attributes: rows }, record);
		} else {
			const plain = n.stereo === 'action' || n.stereo === 'action def';
			this.g.add(
				{
					id,
					label: n.label,
					kind: 'action',
					stereotype: plain ? null : `<<${n.stereo}>>`
				},
				record
			);
		}
		this.ids.set(n.id, id);
		if (parent) this.g.edge(parent, id, 'containment');
	}

	/**
	 * `trigger [guard] / effect` from the transition's text, as the emulator
	 * reads it: the toolkit labels an assigning effect "assignment action".
	 * Null when the text has none of them (the initial `entry; then x;`).
	 */
	private transitionLabel(record: ElementRecord | undefined): string | null {
		if (!record || record.metaclass !== 'TransitionUsage') return null;
		const parts = transitionParts(this.ctx.textOf(record));
		const effect = parts.effect ? actionText(parts.effect) : undefined;
		const label = [
			parts.trigger && triggerText(parts.trigger),
			parts.guard && `[${parts.guard}]`,
			effect && `/ ${effect}`
		]
			.filter(Boolean)
			.join(' ');
		return label || null;
	}

	/** A transition's trigger as written, when the toolkit gives no label (`accept when …`). */
	private triggerOf(id: string | undefined): string | null {
		const record = id ? this.ctx.byId.get(id) : undefined;
		const accept = record
			? /\baccept\s+(.+?)(?:\s+if\s+(.+?))?(?:\s+do\s+(.+?))?\s+then\s/.exec(record.header)
			: null;
		if (!accept) return null;
		return [accept[1], accept[2] && `[${accept[2]}]`, accept[3] && `/ ${accept[3]}`]
			.filter(Boolean)
			.join(' ');
	}

	/**
	 * `state b; accept Go then a;`: a transition without `first` leaves the
	 * state declared before it, and the toolkit's state graph leaves it out.
	 */
	private targetTransitions(placed: Set<string>) {
		for (const t of this.ctx.records) {
			if (t.metaclass !== 'TransitionUsage' || placed.has(t.id) || !t.ownerId) continue;
			const owner = t.ownerId === this.subject.id ? null : this.ids.get(t.ownerId);
			if (t.ownerId !== this.subject.id && !owner) continue;
			const parts = transitionParts(this.ctx.textOf(t));
			if (parts.first || parts.head || !parts.target) continue;
			let source: string | undefined;
			for (const r of this.ctx.members(t.ownerId)) {
				if (r.id === t.id) break;
				if (r.metaclass === 'StateUsage' || r.metaclass === 'ExhibitStateUsage')
					source = this.ids.get(r.id) ?? source;
			}
			if (!source) continue;
			const name = squash(parts.target).replace(/::/g, '.');
			const target = owner && this.g.has(`${owner}.${name}`) ? `${owner}.${name}` : name;
			this.g.edge(source, target, 'transition', this.transitionLabel(t), t);
		}
	}

	/**
	 * `then decide; if c then a; else b;`: the branches of a decision are
	 * transitions whose source is the node declared before them, which the
	 * toolkit's action graph leaves out. Guards come from the text.
	 */
	private decisionBranches(placed: Set<string>) {
		const { session } = this.ctx.input;
		const order = new Map<string, string[]>();
		const membersOf = (owner: string): string[] => {
			let ids = order.get(owner);
			if (!ids) {
				const handle = session.elementById(owner);
				const members = handle ? session.members(handle) : [];
				ids = members.map((m) => session.elementId(m));
				for (const m of members) m.free();
				handle?.free();
				order.set(owner, ids);
			}
			return ids;
		};
		for (const t of this.ctx.records) {
			if (t.metaclass !== 'TransitionUsage' || placed.has(t.id) || !t.ownerId) continue;
			const owner = t.ownerId === this.subject.id ? null : this.ids.get(t.ownerId);
			if (t.ownerId !== this.subject.id && !owner) continue;
			const branch = /^(?:if\s+(.+?)\s+then|else)\s+(.+?)\s*$/.exec(t.header);
			if (!branch) continue;
			// The source is the node declared last before the transition (the `decide`).
			const siblings = membersOf(t.ownerId);
			let source: string | undefined;
			for (const id of siblings.slice(0, Math.max(0, siblings.indexOf(t.id)))) {
				source = this.ids.get(id) ?? source;
			}
			if (!source) continue;
			const name = squash(branch[2]!);
			const target = owner && this.g.has(`${owner}.${name}`) ? `${owner}.${name}` : name;
			this.g.edge(source, target, 'flow', `[${branch[1] ?? 'else'}]`, t);
		}
	}
}
