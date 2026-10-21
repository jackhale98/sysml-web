<script lang="ts">
	import { familyColor, iconOf } from './kinds.ts';

	/**
	 * An element's kind at a glance: its family colour and icon, in a chip
	 * with square corners for definitions and round ones for usages — the
	 * same distinction SysML diagrams draw.
	 */
	let {
		kind,
		isDefinition,
		size = 18
	}: { kind: string; isDefinition: boolean; size?: number } = $props();

	const Icon = $derived(iconOf(kind));
</script>

<span
	class="glyph"
	class:definition={isDefinition}
	style:--fam={familyColor(kind)}
	style:--size="{size}px"
	aria-hidden="true"
>
	<Icon size={Math.round(size * 0.66)} strokeWidth={2.1} />
</span>

<style>
	.glyph {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: var(--size);
		height: var(--size);
		border: 1px solid color-mix(in oklab, var(--fam) 35%, transparent);
		border-radius: 999px;
		background: color-mix(in oklab, var(--fam) 13%, var(--surface));
		color: var(--fam);
	}
	.definition {
		border-radius: 3px;
	}
</style>
