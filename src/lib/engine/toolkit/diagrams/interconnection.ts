/**
 * The Interconnection View (`InterconnectionView`) of a part or part
 * definition: its parts as boxes with their ports on the border (their
 * own, and those they inherit from their definition and its supertypes),
 * the scope's own ports as port nodes, and every connection, interface,
 * binding and flow between them as an edge from part to part.
 *
 * Built from the toolkit's interconnection graph, which resolves the ends
 * of `connect battery.powerOut to …` through the feature chain. Parts
 * nested deeper than one level are folded into their top part: their
 * ports are listed as `esc.powerIn`, and their connections attach to it.
 */
import type { DiagramGraph, EdgeKind } from '../../types';
import { connectionEnds, isReference, type ElementRecord } from '../model';
import { CONNECTORS, type DiagramContext, GraphBuilder, squash, usageLabel } from './context';
import { labelName, toGraph, TkTree, type TkGraphNode } from './tkgraph';

/** Where a toolkit node lands on the app's diagram: a node, and a port path on it. */
interface End {
	node: string;
	port: string | null;
}

export function interconnectionView(ctx: DiagramContext, scope: string): DiagramGraph {
	const subject = ctx.resolve(scope, (r) =>
		ctx.features(r).some((f) => f.kind === 'part') ? 3 : r.kind === 'part' ? 2 : 0
	);
	const g = new GraphBuilder(`iv [${subject?.written ?? scope}]`);
	if (!subject?.qualifiedName) return g.graph();
	const graph = toGraph(ctx.input.session, 'interconnection', subject.qualifiedName);
	if (!graph) return g.graph();
	const tree = new TkTree(graph);
	const root = tree.byId.get(subject.id) ?? graph.nodes.find((n) => !n.parent);
	if (!root) return g.graph();

	// Toolkit node id → where it lands.
	const ends = new Map<string, End>();
	// Per node: its undirected ports' rows by port path, and how often each starts or ends a connection.
	const undirected = new Map<string, Map<string, string>>();
	const uses = new Map<string, { from: number; to: number }>();
	// An inherited port's node is `usage~port`: its name is the port's.
	const recordOf = (n: TkGraphNode) => ctx.byId.get(n.id.split('~').pop()!);
	const nameOf = (n: TkGraphNode) => recordOf(n)?.written ?? labelName(n.label);
	/** `name : ~Type` with the name spelled as SysML writes it. */
	const labelOf = (n: TkGraphNode) => {
		const record = ctx.byId.get(n.id);
		if (record) return usageLabel(record);
		const typed = n.label.indexOf(' : ');
		return typed < 0 ? nameOf(n) : nameOf(n) + n.label.slice(typed);
	};

	// What connectors touch, and the parts they are in.
	const touched = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
	const connected = (n: TkGraphNode): boolean =>
		touched.has(n.id) || tree.children(n.id).some(connected);

	for (const top of tree.children(root.id)) {
		// A `ref part` shows only when something connects to it: the parts it refers to are drawn.
		const record = ctx.byId.get(top.id);
		if (record && isReference(record) && !connected(top)) continue;
		if (top.kind === 'port') {
			const id = g.freeId(nameOf(top));
			g.add(
				{
					id,
					label: `${top.direction ? `${top.direction} ` : ''}${labelOf(top)}`,
					kind: 'port'
				},
				ctx.byId.get(top.id)
			);
			ends.set(top.id, { node: id, port: null });
			continue;
		}
		if (top.kind !== 'block') continue;
		const id = g.freeId(nameOf(top), ctx.byId.get(top.id)?.qualifiedName);
		const rows: [string, string][] = [];
		ends.set(top.id, { node: id, port: null });
		// Ports on the border, the top part's own first; nested parts listed as parts.
		const walk = (n: TkGraphNode, path: string[]) => {
			const children = tree.children(n.id);
			for (const c of children) {
				if (c.kind !== 'port') continue;
				const portPath = [...path, nameOf(c)].join('.');
				const text = [...path, labelOf(c)].join('.');
				rows.push([`${c.direction ? `${c.direction} ` : ''}port`, text]);
				ends.set(c.id, { node: id, port: portPath });
				if (!c.direction) {
					const rowsByPort = undirected.get(id) ?? new Map<string, string>();
					rowsByPort.set(portPath, text);
					undirected.set(id, rowsByPort);
				}
			}
			for (const c of children) {
				if (c.kind !== 'block') continue;
				if (!path.length) rows.push(['part', labelOf(c)]);
				ends.set(c.id, { node: id, port: [...path, nameOf(c)].join('.') });
				walk(c, [...path, nameOf(c)]);
			}
		};
		walk(top, []);
		g.add({ id, label: labelOf(top), kind: 'block', attributes: rows }, ctx.byId.get(top.id));
	}

	const drawnConnectors = new Set<string>();
	for (const e of graph.edges) {
		const kind = EDGE_KINDS[e.kind];
		if (!kind) continue;
		if (e.id) drawnConnectors.add(e.id);
		const source = ends.get(e.source);
		const target = ends.get(e.target);
		if (!source || !target || source.node === target.node) continue;
		g.edge(source.node, target.node, kind, edgeLabel(e.kind, e.label, source, target));
		if (kind === 'binding') continue;
		for (const [end, key] of [
			[source, 'from'],
			[target, 'to']
		] as const) {
			if (!end.port) continue;
			const use = uses.get(`${end.node}\u0000${end.port}`) ?? { from: 0, to: 0 };
			use[key]++;
			uses.set(`${end.node}\u0000${end.port}`, use);
		}
	}

	// A port without a direction sits where its connections run: on the right
	// when it only starts them, on the left when it only ends them; otherwise a
	// conjugated port (`~P`, which receives P's outputs) on the left.
	for (const node of g.graph().nodes) {
		const rowsByPort = undirected.get(node.id);
		if (!rowsByPort) continue;
		const sides: Record<string, 'left' | 'right'> = {};
		for (const [port, text] of rowsByPort) {
			const use = uses.get(`${node.id}\u0000${port}`);
			sides[text] =
				use && use.from && !use.to
					? 'right'
					: use && use.to && !use.from
						? 'left'
						: text.includes(': ~')
							? 'left'
							: 'right';
		}
		node.port_sides = sides;
	}

	// Connectors the toolkit could not place (a binding to the scope's own
	// inherited port), from their ends as written.
	for (const c of ctx.members(subject)) {
		if (!CONNECTORS.test(c.metaclass) || drawnConnectors.has(c.id)) continue;
		const kind = kindOfConnector(c);
		const written = kind ? writtenEnds(c) : null;
		if (!kind || !written) continue;
		const [a, b] = written.map((path) => endByPath(g, path));
		if (!a || !b || a.node === b.node) continue;
		g.edge(a.node, b.node, kind, edgeLabel(kind, c.written, a, b));
	}
	return g.graph();
}

const EDGE_KINDS: Record<string, EdgeKind> = {
	interface: 'connection',
	connect: 'connection',
	binding: 'binding',
	flow: 'flow',
	allocation: 'allocate'
};

/**
 * A connection's name, or the ports it joins (`powerOut to powerIn`); a
 * flow's name or what flows (`MotorCommand`); nothing on a binding (its
 * `=` says it).
 */
function edgeLabel(kind: string, label: string | null | undefined, a: End, b: End): string | null {
	if (kind === 'binding') return null;
	if (kind === 'flow') {
		const [name, payload] = (label ?? '').split(/\s*:\s*/);
		return name?.trim() || payload?.trim() || null;
	}
	if (label?.trim()) return label.trim();
	if (a.port || b.port) return `${a.port ?? ''} to ${b.port ?? ''}`.trim();
	return null;
}

function kindOfConnector(c: ElementRecord): EdgeKind | null {
	if (/^BindingConnector/.test(c.metaclass)) return 'binding';
	if (/^(Flow|SuccessionFlow)Usage$/.test(c.metaclass)) return 'flow';
	if (/^(Connection|Interface)Usage$/.test(c.metaclass)) return 'connection';
	return null;
}

/** `bind a = b.c`, `connect a to b`, `flow … from a to b`: the two ends as written. */
function writtenEnds(c: ElementRecord): [string, string] | null {
	const header = c.header;
	const bind = /\bbind\s+([^=]+?)\s*=\s*(.+)$/.exec(header);
	if (bind) return [squash(bind[1]!), squash(bind[2]!)];
	const flow = /\bfrom\s+(\S+)\s+to\s+(\S+)\s*$/.exec(header);
	if (flow) return [flow[1]!, flow[2]!];
	return connectionEnds(header);
}

/** `radio.airLink` → the node `radio`, port `airLink`; `commandLink` → that port node. */
function endByPath(g: GraphBuilder, path: string): End | null {
	const [first, ...rest] = path.split('.');
	if (!first || !g.has(first)) return null;
	return { node: first, port: rest.length ? rest.join('.') : null };
}
