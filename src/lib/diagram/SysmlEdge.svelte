<script lang="ts">
	import { BaseEdge, EdgeLabel, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
	import { edgeLabelText } from './notation.ts';
	import type { SysmlEdgeData } from './types.ts';

	interface EdgeStyle {
		start?: string;
		end?: string;
		dashed?: boolean;
		keyword?: string;
	}

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
				return { end: 'url(#sysml-open-arrow)', dashed: true, keyword: `«${kind}»` };
			case 'dependency':
				return { end: 'url(#sysml-open-arrow)', dashed: true };
			case 'flow':
			case 'transition':
			case 'message':
				return { end: 'url(#sysml-arrow)' };
			case 'typing':
				return { end: 'url(#sysml-typing)' };
			case 'constraint_binding':
			case 'binding':
				return { keyword: '=' };
			default:
				return {};
		}
	});
	const text = $derived(
		[style.keyword, edgeLabelText(kind, data?.label ?? null)].filter(Boolean).join(' ')
	);
</script>

<BaseEdge
	path={geometry[0]}
	markerStart={data?.reversed ? style.end : style.start}
	markerEnd={data?.reversed ? style.start : style.end}
	class={style.dashed ? 'sysml-edge dashed' : 'sysml-edge'}
/>
{#if text}
	<EdgeLabel x={geometry[1]} y={geometry[2]} class="sysml-edge-label">{text}</EdgeLabel>
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
