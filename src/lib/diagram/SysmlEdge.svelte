<script lang="ts">
	import { untrack } from 'svelte';
	import {
		BaseEdge,
		EdgeLabel,
		getSmoothStepPath,
		useInternalNode,
		type EdgeProps
	} from '@xyflow/svelte';
	import { roundedPath } from '#lib/sim/layout.ts';
	import { useEditing } from './editing.svelte.ts';
	import { useLabels } from './labels.svelte.ts';
	import { edgeText } from './layout.ts';
	import type { XY } from './layout.ts';
	import type { SysmlEdgeData } from './types.ts';

	interface EdgeStyle {
		start?: string;
		end?: string;
		dashed?: boolean;
	}

	let {
		id,
		source,
		target,
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		data
	}: EdgeProps & { data?: SysmlEdgeData } = $props();

	// Edges are keyed by their ends, so these stay the same for the component's life.
	const from = untrack(() => useInternalNode(source));
	const to = untrack(() => useInternalNode(target));
	const labels = useLabels();
	const editing = useEditing();
	/** One of the selected node's connections: drawn in the accent; the others step back. */
	const lit = $derived(!!editing?.focus && (source === editing.focus || target === editing.focus));
	const dim = $derived(!!editing?.focus && !lit);
	const marker = (url: string | undefined) => (url && lit ? url.replace(/\)$/, '-lit)') : url);

	const near = (a: { x: number; y: number } | undefined, b: { x: number; y: number }) =>
		!!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
	/** ELK's route, while both ends are still where the layout put them. */
	const route = $derived.by(() => {
		const r = data?.route;
		if (!r) return null;
		const ok =
			near(from.current?.internals.positionAbsolute, r.from) &&
			near(to.current?.internals.positionAbsolute, r.to);
		return ok ? r : null;
	});
	const smooth = $derived(
		getSmoothStepPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition,
			targetPosition,
			borderRadius: 6
		})
	);
	/**
	 * ELK's route, its ends moved onto the port squares they run to: the box
	 * draws a square a few pixels off where the layout reckoned it. The next
	 * point moves with an end, so the segment stays straight.
	 */
	const points = $derived.by(() => {
		if (!route) return null;
		if (!data?.sourcePort && !data?.targetPort) return route.points;
		let p = route.points.map((q) => ({ ...q }));
		// A straight line gets a jog in its middle, so each end can move on its own.
		if (p.length === 2) {
			const [a, b] = p as [XY, XY];
			const flat = Math.abs(a.y - b.y) < 0.5;
			const mid = flat ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
			p = flat
				? [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]
				: [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b];
		}
		const snap = (end: number, next: number, x: number, y: number) => {
			const [a, b] = [p[end]!, p[next]!];
			if (Math.abs(b.y - a.y) < 0.5) b.y = y;
			else if (Math.abs(b.x - a.x) < 0.5) b.x = x;
			p[end] = { x, y };
		};
		if (data.sourcePort) snap(0, 1, sourceX, sourceY);
		if (data.targetPort) snap(p.length - 1, p.length - 2, targetX, targetY);
		// Without points that repeat or lie on a straight run (a jog that came out straight).
		const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
		return p.filter((q, i) => {
			const [before, after] = [p[i - 1], p[i + 1]];
			if (!before || !after) return true;
			if (same(q.x, before.x) && same(q.y, before.y)) return false;
			return (
				!(same(before.x, q.x) && same(q.x, after.x)) && !(same(before.y, q.y) && same(q.y, after.y))
			);
		});
	});
	const path = $derived(points ? roundedPath(points, 6) : smooth[0]);
	const kind = $derived(data?.kind ?? 'dependency');
	/**
	 * SysML v2 notation per relationship kind: specialization ends in a hollow
	 * triangle at the general end, typing ("defined by") in a hollow triangle
	 * after two dots; composition has a filled diamond at the
	 * owner; membership a circled plus at the owner; satisfy, verify, allocate
	 * and dependencies are dashed with an open arrow; flows and transitions
	 * end in a filled arrow; connections are plain lines, bindings plain
	 * lines marked `=`.
	 */
	const style = $derived.by((): EdgeStyle => {
		switch (kind) {
			case 'specialization':
				return { end: 'url(#sysml-specialization)' };
			case 'composition':
				return { start: 'url(#sysml-composition)' };
			case 'containment':
				return { start: 'url(#sysml-membership)' };
			case 'satisfy':
			case 'verify':
			case 'allocate':
				return { end: 'url(#sysml-open-arrow)', dashed: true };
			case 'dependency':
				return { end: 'url(#sysml-open-arrow)', dashed: true };
			case 'flow':
			case 'transition':
			case 'message':
				return { end: 'url(#sysml-arrow)' };
			case 'typing':
				return { end: 'url(#sysml-typing)' };
			default:
				return {};
		}
	});
	const text = $derived(edgeText(kind, data?.label ?? null));

	// Labels on routes ELK drew stay where it put them; the others slide along
	// their edge until they cover no other label and no node.
	$effect(() => {
		if (!labels) return;
		if (text) labels.set(id, path, text, route?.label ?? null);
		else labels.delete(id);
	});
	$effect(() => () => labels?.delete(id));
	const at = $derived(route?.label ?? labels?.positions[id] ?? { x: smooth[1], y: smooth[2] });
</script>

<BaseEdge
	{path}
	markerStart={marker(data?.reversed ? style.end : style.start)}
	markerEnd={marker(data?.reversed ? style.start : style.end)}
	class={['sysml-edge', style.dashed && 'dashed', lit && 'lit', dim && 'dim']
		.filter(Boolean)
		.join(' ')}
/>
{#if text && data?.editable && editing?.actions.editEdge}
	<EdgeLabel
		x={at.x}
		y={at.y}
		class={lit ? 'sysml-edge-label editable lit' : 'sysml-edge-label editable'}
	>
		<button
			type="button"
			class="nodrag nopan"
			aria-label="Change {data.kind === 'transition' ? 'transition' : 'branch'}: {text}"
			title="Change it"
			onclick={(event) => editing.actions.editEdge?.(id, { x: event.clientX, y: event.clientY })}
			>{text}</button
		>
	</EdgeLabel>
{:else if text}
	<EdgeLabel x={at.x} y={at.y} class={lit ? 'sysml-edge-label lit' : 'sysml-edge-label'}
		>{text}</EdgeLabel
	>
{/if}

<style>
	:global(.sysml-edge) {
		stroke: color-mix(in oklab, var(--text-2) 85%, transparent) !important;
		stroke-width: 1.5 !important;
	}
	:global(.sysml-edge.dashed) {
		stroke-dasharray: 5 4;
	}
	:global(.sysml-edge.lit) {
		stroke: var(--accent) !important;
		stroke-width: 2.25 !important;
	}
	:global(.sysml-edge.dim) {
		opacity: 0.3;
	}
	:global(.sysml-edge),
	:global(.sysml-edge-label) {
		transition:
			opacity 0.15s,
			stroke 0.15s;
	}
	:global(.sysml-edge-label.lit) {
		z-index: 1;
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	/* A label that opens the form to change its transition: the same pill, pressable. */
	:global(.sysml-edge-label.editable) {
		padding: 0;
	}
	:global(.sysml-edge-label.editable button) {
		padding: 1px 7px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	:global(.sysml-edge-label.editable:hover) {
		border-color: var(--accent);
		color: var(--accent);
	}
	:global(.sysml-edge-label.editable button:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		/* A bigger target without moving the pill: the press area reaches past it. */
		:global(.sysml-edge-label.editable button) {
			position: relative;
		}
		:global(.sysml-edge-label.editable button::after) {
			content: '';
			position: absolute;
			inset: -12px -4px;
		}
	}
	:global(.sysml-edge-label) {
		padding: 1px 7px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 11px;
		line-height: 16px;
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.sysml-edge),
		:global(.sysml-edge-label) {
			transition: none;
		}
	}
</style>
