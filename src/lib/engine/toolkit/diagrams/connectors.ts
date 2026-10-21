/**
 * Two reads the general and requirement views share: what a view usage
 * exposes, and connections whose ends are elements on the diagram (a
 * `#derivation connection` between requirements, a `connection` written
 * with `end` features).
 */
import type { TkElement } from '../api';
import type { ElementRecord } from '../model';
import { squash, type DiagramContext, type GraphBuilder } from './context';

/**
 * The user elements a view usage exposes, after its filters (the
 * toolkit's `viewInfo`), in declaration order. Exposure follows the
 * spec's `isImportAll`, so a namespace's imported and inherited members
 * come too; only those owned under an `expose`d name are kept.
 */
export function viewExposed(ctx: DiagramContext, view: ElementRecord): ElementRecord[] {
	if (!view.qualifiedName) return [];
	let exposed: { id: string }[];
	try {
		exposed = (
			JSON.parse(ctx.input.session.viewInfo(view.qualifiedName)) as { exposed: { id: string }[] }
		).exposed;
	} catch {
		return [];
	}
	const targets = exposeTargets(ctx.textOf(view)).map((t) => `::${unquote(t)}`);
	const order = new Map(ctx.records.map((r, i) => [r.id, i]));
	const within = (r: ElementRecord) => {
		const named = r.qualifiedName ? r : [...ctx.ancestors(r)].find((a) => a.qualifiedName);
		const qualified = `::${unquote(named?.qualifiedName ?? '')}`;
		return (
			!targets.length || targets.some((t) => qualified.endsWith(t) || qualified.includes(`${t}::`))
		);
	};
	return exposed
		.map((x) => ctx.byId.get(x.id))
		.filter((r): r is ElementRecord => !!r && r.id !== view.id && within(r))
		.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** `expose A::B::*;` → `A::B`: the names a view's `expose` members are written with. */
export function exposeTargets(text: string): string[] {
	const targets: string[] = [];
	for (const m of text.matchAll(/\bexpose\s+([^;{[]+?)\s*(?:\[|;|\{)/g)) {
		targets.push(squash(m[1]!).replace(/::\*\*?$/, ''));
	}
	return targets;
}

const unquote = (s: string) => s.replace(/'/g, '');

/**
 * Edges for connections declared with `end` features whose ends are both
 * drawn: «derive» from each derived requirement to the original for a
 * `#derivation` connection, else a connection labelled by its name.
 *
 * Each end names its element (`end #derive ::> 'Flight endurance'`); the
 * name is matched against the drawn elements' qualified names, which the
 * toolkit resolved. Only when that finds nothing does it ask the toolkit for
 * the connector's resolved ends, a read that costs a pass over the whole
 * model the first time (~300 ms in Node on the demo).
 */
export function connectorEdges(ctx: DiagramContext, g: GraphBuilder, connectors: ElementRecord[]) {
	const drawn = [...g.drawn.keys()]
		.map((id) => ctx.byId.get(id))
		.filter((r): r is ElementRecord => !!r?.qualifiedName)
		.map((r) => ({ node: g.drawn.get(r.id)!, qualified: `::${unquote(r.qualifiedName!)}` }));
	const byName = (written: string): string | undefined => {
		const tail = `::${unquote(squash(written))}`;
		return drawn.find((d) => d.qualified.endsWith(tail))?.node;
	};
	for (const c of connectors) {
		if (!/^(Connection|Allocation)Usage$/.test(c.metaclass)) continue;
		const ends = (ctx.children.get(c.id) ?? []).filter((e) => e.end);
		if (!ends.length) continue;
		const derivation = /#\s*derivation\b/.test(c.header);
		let named = ends.map((e) => ({
			node: e.specializes[0] ? byName(e.specializes[0]) : undefined,
			derived: /#\s*derive\b/.test(e.header)
		}));
		if (named.some((e) => !e.node)) named = resolvedEnds(ctx, g, c) ?? named;
		const [first, ...rest] = named;
		if (!first) continue;
		if (derivation) {
			const original = named.find((e) => !e.derived)?.node;
			for (const e of named)
				if (e.derived && e.node && original) g.edge(e.node, original, 'dependency', '<<derive>>');
			continue;
		}
		for (const e of rest) {
			if (first.node && e.node)
				g.edge(first.node, e.node, c.kind === 'allocation' ? 'allocate' : 'connection', c.written);
		}
	}
}

/** The connector's ends as the toolkit resolves them: its source first, then its targets. */
function resolvedEnds(
	ctx: DiagramContext,
	g: GraphBuilder,
	c: ElementRecord
): { node: string | undefined; derived: boolean }[] | null {
	const { session } = ctx.input;
	const handle = session.elementById(c.id);
	if (!handle) return null;
	const read = (name: string): (string | undefined)[] => {
		let found: TkElement[];
		try {
			found = session.derivedElements(handle, name);
		} catch {
			return [];
		}
		const ids = found.map((e) => session.elementId(e));
		for (const e of found) e.free();
		return ids.map((id) => g.drawn.get(id));
	};
	const sources = read('sourceFeature');
	const targets = read('targetFeature');
	handle.free();
	return [
		...sources.map((node) => ({ node, derived: false })),
		...targets.map((node) => ({ node, derived: true }))
	];
}
