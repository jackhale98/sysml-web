/**
 * The interconnection of the report's scope as a static SVG, for the page
 * and for exports: the parts as rounded boxes (usages), their ports on the
 * border, and the connections between ports, laid out by ELK. Loaded only
 * when a report has an interconnection chapter.
 */
import type { DiagramGraph } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import type { ReportContext } from './context.ts';
import { icdModel } from './icd.ts';
import { splitName } from './model.ts';

interface ElkLabel {
	text: string;
	x?: number;
	y?: number;
	width: number;
	height: number;
}
interface ElkPort {
	id: string;
	x?: number;
	y?: number;
	width: number;
	height: number;
	labels: ElkLabel[];
}
interface ElkNode {
	id: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	labels: ElkLabel[];
	ports: ElkPort[];
}
interface ElkPoint {
	x: number;
	y: number;
}
interface ElkEdge {
	id: string;
	sections?: { startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[] }[];
	labels?: ElkLabel[];
}
interface ElkGraph {
	width?: number;
	height?: number;
	children?: ElkNode[];
	edges?: ElkEdge[];
}

export function escapeXml(text: string): string {
	return text.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
	);
}

const width = (text: string, px: number) => Math.ceil(text.length * px);

/** The diagram as SVG markup (all names escaped), or null when there is nothing to draw. */
export async function diagramSvg(
	graph: DiagramGraph,
	ctx: ReportContext,
	scope: ModelElement
): Promise<string | null> {
	const nodes = graph.nodes.filter((n) => n.kind === 'block');
	if (!nodes.length) return null;
	const ids = new Set(nodes.map((n) => n.id));
	const portIds = new Set<string>();
	const children = nodes.map((n) => {
		const [name = n.label, type = ''] = n.label.split(' : ');
		const ports = n.attributes
			.filter(([keyword]) => /(^|\s)port$/.test(keyword))
			.map(([, text]) => text.split(' : ')[0]!.trim());
		return {
			id: n.id,
			layoutOptions: {
				'elk.portConstraints': 'FREE',
				'elk.portLabels.placement': '[INSIDE]',
				'elk.nodeSize.constraints': '[PORTS, PORT_LABELS, NODE_LABELS, MINIMUM_SIZE]',
				'elk.nodeSize.minimum': '(150, 64)',
				'elk.nodeLabels.placement': '[H_CENTER, V_CENTER, INSIDE]',
				'elk.nodeLabels.padding': '[top=14,left=14,bottom=14,right=14]',
				'elk.spacing.portPort': '16',
				'elk.port.borderOffset': '-6'
			},
			labels: [
				{
					text: n.label,
					width: Math.max(width(name, 7.4), width(type ? `: ${type}` : '', 6.6)),
					height: type ? 34 : 18
				}
			],
			ports: ports.map((p) => {
				const id = `${n.id}.${p}`;
				portIds.add(id);
				return {
					id,
					width: 11,
					height: 11,
					labels: [{ text: p, width: width(p, 6.4), height: 12 }]
				};
			})
		};
	});
	// Connections of the scope, port to port where the ends name ports.
	const end = (chain: string) => {
		const segments = splitName(chain, true);
		const port = segments.slice(-2).join('.');
		if (portIds.has(port)) return port;
		const part = segments.find((s) => ids.has(s));
		return part ?? null;
	};
	const edges = icdModel(ctx)
		.connections.filter((c) => c.owner === scope)
		.flatMap((c, i) => {
			const source = end(c.source);
			const target = end(c.target);
			if (!source || !target || source === target) return [];
			const label = c.name ?? '';
			return [
				{
					id: `e${i}`,
					sources: [source],
					targets: [target],
					labels: label ? [{ text: label, width: width(label, 6.4), height: 14 }] : []
				}
			];
		});

	const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
	const elk = new ELK();
	const result = (await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'DOWN',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.aspectRatio': '1.4',
			'elk.layered.spacing.nodeNodeBetweenLayers': '56',
			'elk.spacing.nodeNode': '36',
			'elk.spacing.edgeLabel': '4',
			'elk.padding': '[top=44,left=20,bottom=20,right=20]'
		},
		children,
		edges
	})) as unknown as ElkGraph;
	return render(result, scope);
}

function render(graph: ElkGraph, scope: ModelElement): string {
	const w = Math.ceil(graph.width ?? 400);
	const h = Math.ceil(graph.height ?? 300);
	const out: string[] = [];
	const title = escapeXml(`${scope.label}${scope.typeRef ? ` : ${scope.typeRef}` : ''}`);
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" class="rd-diagram-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif">`
	);
	// The diagram frame, named after the part whose inside it shows.
	out.push(
		`<rect class="dg-frame" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="none" stroke="#9aa0a8"/>`,
		`<path class="dg-frame" d="M1 26 H${Math.min(w - 2, title.length * 7 + 60)} l10 -12 V1" fill="none" stroke="#9aa0a8"/>`,
		`<text class="dg-frame-title" x="10" y="18" font-size="12" fill="#50535a"><tspan font-weight="600">iv</tspan> ${title}</text>`
	);
	for (const edge of graph.edges ?? []) {
		for (const s of edge.sections ?? []) {
			const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
			const d = points.map((p, i) => `${i ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`).join(' ');
			out.push(`<path class="dg-edge" d="${d}" fill="none" stroke="#5c6370" stroke-width="1.5"/>`);
		}
		for (const label of edge.labels ?? []) {
			out.push(
				`<text class="dg-edge-label" x="${round((label.x ?? 0) + 2)}" y="${round((label.y ?? 0) + 11)}" font-size="11" font-style="italic" fill="#50535a">${escapeXml(label.text)}</text>`
			);
		}
	}
	for (const node of graph.children ?? []) {
		const x = node.x ?? 0;
		const y = node.y ?? 0;
		const nw = node.width ?? 150;
		const nh = node.height ?? 64;
		out.push(`<g class="dg-node" transform="translate(${round(x)} ${round(y)})">`);
		out.push(
			`<rect class="dg-box" width="${round(nw)}" height="${round(nh)}" rx="10" fill="#ffffff" stroke="#3b5bdb" stroke-width="1.5"/>`
		);
		const label = node.labels[0];
		if (label) {
			const [name = label.text, type] = label.text.split(' : ');
			const cy = (label.y ?? 14) + (type ? 13 : 13);
			out.push(
				`<text class="dg-name" x="${round(nw / 2)}" y="${round(cy)}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1a1b1e">${escapeXml(name)}</text>`
			);
			if (type)
				out.push(
					`<text class="dg-type" x="${round(nw / 2)}" y="${round(cy + 16)}" text-anchor="middle" font-size="11.5" fill="#50535a">: ${escapeXml(type)}</text>`
				);
		}
		for (const port of node.ports) {
			const px = port.x ?? 0;
			const py = port.y ?? 0;
			out.push(
				`<rect class="dg-port" x="${round(px)}" y="${round(py)}" width="${port.width}" height="${port.height}" fill="#ffffff" stroke="#0b7285" stroke-width="1.5"/>`
			);
			const pl = port.labels[0];
			if (pl)
				out.push(
					`<text class="dg-port-label" x="${round(px + (pl.x ?? 0))}" y="${round(py + (pl.y ?? 0) + 10)}" font-size="10.5" fill="#50535a">${escapeXml(pl.text)}</text>`
				);
		}
		out.push('</g>');
	}
	out.push('</svg>');
	return out.join('');
}

function round(n: number): number {
	return Math.round(n * 10) / 10;
}
