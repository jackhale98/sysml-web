/**
 * Assessment (§2, exports): diagrams of the demo and of a generated
 * project of about 10k lines, laid out as the canvas lays them out (ELK,
 * `layout.ts`) and exported (`buildSvg`): every node's name and every
 * routed edge's label is in the SVG (whole, or cut with an ellipsis to its
 * box as on the canvas), every routed edge is drawn, and the PNG scale
 * keeps large diagrams within what browsers draw. Small (one node) to
 * large (hundreds of nodes) diagrams. Decision, merge, fork and join
 * symbols carry no name in the notation (on the canvas the name is a
 * tooltip), so they are not looked for.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { DiagramGraph, DiagramView } from '#lib/engine/types.ts';
import { escapeXml } from '#lib/dataio/xml.ts';
import { generateLines } from '../../../../tests/perf/generate';
import { edgeText, layout, MAX_NODES } from '../layout.ts';
import { notationOf } from '../notation.ts';
import { buildSvg, pngScale, type ExportDiagram } from './svg.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const VIEW_OF: Record<string, string> = {
	general: 'general',
	interconnection: 'interconnection',
	states: 'states',
	actions: 'actions',
	requirements: 'general',
	packages: 'general',
	trace: 'general'
};

/** Lay a graph out and export it, as the canvas would draw it before anything is moved. */
async function exported(graph: DiagramGraph, view: DiagramView) {
	const v = VIEW_OF[view] ?? 'general';
	const placed = await layout(graph, view === 'states' ? 'RIGHT' : 'DOWN', v);
	const routed = graph.edges.flatMap((e, i) => {
		const route = placed.routes.get(i);
		return route ? [{ e, route }] : [];
	});
	const diagram: ExportDiagram = {
		title: `${view} [${graph.title}]`,
		view: v,
		nodes: placed.nodes.map((p) => ({ id: p.node.id, ...p })),
		edges: routed.map(({ e, route }) => ({
			kind: e.kind,
			path: route.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '),
			text: edgeText(e.kind, e.label),
			labelAt: route.label
		}))
	};
	return { diagram, built: buildSvg(diagram), routed: routed.length };
}

/** Text drawn whole, or its start cut with an ellipsis. */
function drawn(svg: string, text: string): boolean {
	if (svg.includes(`>${escapeXml(text)}</text>`)) return true;
	const cut = [...svg.matchAll(/>([^<]*)…<\/text>/g)].map((m) => m[1]!);
	return cut.some((c) => c.length >= 3 && escapeXml(text).startsWith(c));
}

/** What an export leaves out: node names and edge labels. */
function missing(svg: string, diagram: ExportDiagram): string[] {
	const out: string[] = [];
	for (const n of diagram.nodes) {
		const label = n.node.label.trim();
		if (!label) continue;
		// Decisions, merges, forks and joins are unnamed symbols, as on the canvas (the name is
		// its tooltip there); start and done are pseudo states.
		if (['decision', 'bar', 'initial', 'final'].includes(notationOf(n.node, diagram.view).shape))
			continue;
		if (!drawn(svg, label)) out.push(`node ${n.node.kind} ${label}`);
	}
	for (const e of diagram.edges) if (e.text && !drawn(svg, e.text)) out.push(`edge ${e.text}`);
	return out;
}

const DEMO: [DiagramView, string | null][] = [
	['general', 'DroneComponents'],
	['general', 'DroneArchitecture'],
	['general', 'drone'],
	['general', 'Rotor'],
	['interconnection', 'drone'],
	['interconnection', 'deliveryService'],
	['interconnection', 'Rotor'],
	['requirements', null],
	['states', 'FlightModes'],
	['actions', 'DeliveryFlight'],
	['packages', null],
	['trace', null]
];

describe('exported demo diagrams hold every name and label', () => {
	it.each(DEMO)('%s of %s', async (view, scope) => {
		const graph = host.diagram(view, demoFiles(), scope);
		expect(graph.nodes.length).toBeGreaterThan(0);
		const { diagram, built, routed } = await exported(graph, view);
		expect(missing(built.svg, diagram)).toEqual([]);
		// Every routed edge is drawn: one path per edge at least.
		expect((built.svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(routed);
		// The frame holds every node.
		for (const n of diagram.nodes) {
			expect(n.x + n.width).toBeLessThanOrEqual(built.width);
			expect(n.y + n.height).toBeLessThanOrEqual(built.height);
		}
	});

	it('a one-node diagram exports at a readable size', async () => {
		const graph = host.diagram('general', demoFiles(), 'DroneArchitecture::DeliveryDrone');
		const { built, diagram } = await exported(graph, 'general');
		expect(diagram.nodes.length).toBeGreaterThanOrEqual(1);
		expect(missing(built.svg, diagram)).toEqual([]);
		expect(pngScale(built.width, built.height)).toBe(2);
	});
});

describe('a large diagram', { timeout: 120_000 }, () => {
	it('of a generated project exports every node and label, and its PNG fits', async () => {
		const files = generateLines(10_000);
		host.analyzeProject(files);
		const graph = host.diagram('general', files, null);
		const nodes = Math.min(graph.nodes.length, MAX_NODES);
		const shown: DiagramGraph = {
			...graph,
			nodes: graph.nodes.slice(0, nodes),
			edges: graph.edges
		};
		const { diagram, built, routed } = await exported(shown, 'general');
		expect(diagram.nodes.length).toBeGreaterThan(100);
		expect(missing(built.svg, diagram)).toEqual([]);
		expect((built.svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(routed);
		const scale = pngScale(built.width, built.height);
		const pixels = built.width * scale * built.height * scale;
		expect(pixels).toBeLessThanOrEqual(16_000_001);
		if (process.env.ASSESS_OUT)
			console.info(
				JSON.stringify({
					nodes: diagram.nodes.length,
					edges: routed,
					...built,
					svg: undefined,
					scale
				})
			);
	});
});
