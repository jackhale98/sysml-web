<script lang="ts">
	import { BaseEdge, EdgeLabel, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
	import type { SysmlEdgeData } from './types.ts';

	let {
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		data
	}: EdgeProps & { data?: SysmlEdgeData } = $props();

	const geometry = $derived(
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
	const kind = $derived(data?.kind ?? 'dependency');
	/** SysML v2 notation per relationship kind. */
	const style = $derived(
		kind === 'specialization'
			? { end: 'url(#sysml-specialization)', dashed: false, keyword: null }
			: kind === 'composition'
				? { start: 'url(#sysml-composition)', dashed: false, keyword: null }
				: kind === 'satisfy' || kind === 'verify' || kind === 'allocate'
					? { end: 'url(#sysml-open-arrow)', dashed: true, keyword: `«${kind}»` }
					: kind === 'flow' || kind === 'transition' || kind === 'message'
						? { end: 'url(#sysml-arrow)', dashed: false, keyword: null }
						: kind === 'dependency'
							? { end: 'url(#sysml-open-arrow)', dashed: true, keyword: null }
							: { dashed: false, keyword: null }
	);
	const text = $derived([style.keyword, data?.label].filter(Boolean).join(' '));
</script>

<BaseEdge
	path={geometry[0]}
	markerStart={'start' in style ? style.start : undefined}
	markerEnd={'end' in style ? style.end : undefined}
	class={style.dashed ? 'sysml-edge dashed' : 'sysml-edge'}
/>
{#if text}
	<EdgeLabel x={geometry[1]} y={geometry[2]} class="sysml-edge-label">{text}</EdgeLabel>
{/if}

<style>
	:global(.sysml-edge) {
		stroke: var(--text-2) !important;
		stroke-width: 1.4 !important;
	}
	:global(.sysml-edge.dashed) {
		stroke-dasharray: 5 4;
	}
	:global(.sysml-edge-label) {
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--bg);
		color: var(--text-2);
		font-size: 11px;
	}
</style>
