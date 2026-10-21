/**
 * The requirement views and the package overview, from the model
 * adapter's records and its resolved satisfy/verify ends:
 * - requirements: every requirement definition and usage with its text,
 *   nested requirements under their parent, «derive» from each derived
 *   requirement to its original, and what satisfies and verifies each;
 * - trace: the V-model chain — requirements in the middle, the design
 *   that satisfies them and the cases that verify them around, each
 *   requirement marked when nothing satisfies or verifies it yet;
 * - packages: every package with the definitions it contains.
 */
import type { DiagramGraph } from '../../types';
import type { ElementRecord } from '../model';
import {
	CONNECTORS,
	type DiagramContext,
	GraphBuilder,
	docText,
	keywordOf,
	nameLabel,
	nodeKindOf
} from './context';
import { connectorEdges } from './connectors';

const REQUIREMENT = /^Requirement(Definition|Usage)$/;

export function requirementsView(ctx: DiagramContext): DiagramGraph {
	const g = new GraphBuilder('grv [requirements]');
	for (const r of ctx.records) {
		if (!REQUIREMENT.test(r.metaclass) || !r.name) continue;
		const text = docText(r);
		const id = requirement(g, r, text ? [['text', text]] : []);
		const parent = [...ctx.ancestors(r)].find((a) => g.drawn.has(a.id));
		if (parent) g.edge(g.drawn.get(parent.id)!, id, 'containment');
	}
	traceLinks(ctx, g);
	connectorEdges(
		ctx,
		g,
		ctx.records.filter((r) => CONNECTORS.test(r.metaclass))
	);
	return g.graph();
}

export function traceView(ctx: DiagramContext): DiagramGraph {
	const g = new GraphBuilder('trace [requirements]');
	const traced = ctx.input.model.traces;
	for (const r of ctx.records) {
		if (!REQUIREMENT.test(r.metaclass) || !r.name) continue;
		// Definitions only when something traces to them directly.
		if (r.isDefinition && !traced.some((t) => t.requirementId === r.id)) continue;
		const rows: [string, string][] = [];
		const text = docText(r);
		if (text) rows.push(['text', text]);
		if (!traced.some((t) => t.kind === 'satisfy' && t.requirementId === r.id))
			rows.push(['status', 'UNSATISFIED']);
		if (!traced.some((t) => t.kind === 'verify' && t.requirementId === r.id))
			rows.push(['status', 'UNVERIFIED']);
		requirement(g, r, rows);
	}
	traceLinks(ctx, g);
	return g.graph();
}

function requirement(g: GraphBuilder, r: ElementRecord, rows: [string, string][]): string {
	return g.add(
		{
			id: g.freeId(r.written ?? r.name!, r.qualifiedName),
			label: nameLabel(r),
			kind: 'requirement',
			stereotype: `<<${keywordOf(r)}>>`,
			attributes: rows,
			is_definition: r.isDefinition
		},
		r
	).id;
}

/** Satisfy and verify edges, adding the design elements and cases they come from. */
function traceLinks(ctx: DiagramContext, g: GraphBuilder) {
	for (const t of ctx.input.model.traces) {
		const requirementNode = t.requirementId ? g.drawn.get(t.requirementId) : undefined;
		const by = t.byId ? ctx.byId.get(t.byId) : undefined;
		if (!requirementNode || !by?.name) continue;
		const byNode = g.drawn.get(by.id) ?? tracer(ctx, g, by);
		g.edge(byNode, requirementNode, t.kind, `<<${t.kind}>>`);
	}
}

/** `drone.payloadRelease`: a usage by its path from its outermost usage, a definition by name. */
function tracer(ctx: DiagramContext, g: GraphBuilder, r: ElementRecord): string {
	const path = [r.written ?? r.name!];
	if (!r.isDefinition) {
		for (const a of ctx.ancestors(r)) {
			if (a.isDefinition || a.kind === 'package' || !a.name) break;
			path.unshift(a.written ?? a.name);
		}
	}
	const label = path.join('.');
	return g.add(
		{
			id: g.freeId(label, r.qualifiedName),
			label,
			kind: nodeKindOf(r) === 'port' ? 'block' : nodeKindOf(r),
			stereotype: `<<${keywordOf(r)}>>`,
			is_definition: r.isDefinition
		},
		r
	).id;
}

export function packagesView(ctx: DiagramContext): DiagramGraph {
	const g = new GraphBuilder('bv [packages]');
	const packages = ctx.records.filter((r) => r.kind === 'package' && r.name);
	for (const p of packages) {
		g.add(
			{
				id: g.freeId(p.written ?? p.name!, p.qualifiedName),
				label: p.written ?? p.name!,
				kind: 'package',
				stereotype: '<<package>>'
			},
			p
		);
	}
	for (const p of packages) {
		const pid = g.drawn.get(p.id)!;
		const members: string[] = [];
		for (const m of ctx.members(p)) {
			if (!m.name || m.kind === 'package' || !m.isDefinition) continue;
			const id = g.add(
				{
					id: g.freeId(m.written ?? m.name, m.qualifiedName),
					label: nameLabel(m),
					kind: nodeKindOf(m) === 'port' ? 'block' : nodeKindOf(m),
					stereotype: `<<${keywordOf(m)}>>`,
					is_definition: m.isDefinition
				},
				m
			).id;
			members.push(id);
			g.edge(pid, id, 'containment');
		}
		for (const m of ctx.members(p)) {
			const nested = m.kind === 'package' ? g.drawn.get(m.id) : undefined;
			if (nested) g.edge(pid, nested, 'containment');
		}
		if (members.length)
			g.subgraphs.push({ id: pid, label: p.written ?? p.name!, node_ids: members });
	}
	return g.graph();
}
