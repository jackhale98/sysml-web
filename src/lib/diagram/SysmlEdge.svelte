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
	import { useLabels } from './labels.svelte.ts';
	import { edgeText } from './layout.ts';
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
	const path = $derived(route ? roundedPath(route.points, 6) : smooth[0]);
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
	markerStart={data?.reversed ? style.end : style.start}
	markerEnd={data?.reversed ? style.start : style.end}
	class={style.dashed ? 'sysml-edge dashed' : 'sysml-edge'}
/>
{#if text}
	<EdgeLabel x={at.x} y={at.y} class="sysml-edge-label">{text}</EdgeLabel>
{/if}

<style>
	:global(.sysml-edge) {
		stroke: color-mix(in oklab, var(--text-2) 85%, transparent) !important;
		stroke-width: 1.5 !important;
	}
	:global(.sysml-edge.dashed) {
		stroke-dasharray: 5 4;
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
</style>
