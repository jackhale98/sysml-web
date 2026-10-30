<script lang="ts">
	import { Boxes } from '@lucide/svelte';
	import type { Variability } from '#lib/engine/types.ts';
	import { chosenConfiguration, describeChoices } from './configurations.ts';

	/**
	 * Choose a product configuration to show (`docs/variants.md`), or the
	 * model as written. The choice is shared by every table and diagram that
	 * can show one, so they agree; the model's text is never changed.
	 */
	let {
		variability,
		value = $bindable(),
		compact = false
	}: {
		variability: Variability;
		value: string | null;
		/** In a diagram's toolbar, or on a phone: the label is only read out. */
		compact?: boolean;
	} = $props();

	const chosen = $derived(chosenConfiguration(variability, value));
</script>

{#if variability.configurations.length}
	<label
		class="configuration"
		class:compact
		class:on={!!chosen}
		title={chosen
			? `Showing ${chosen.name} (${describeChoices(chosen)}). The model as written is unchanged.`
			: 'Show one configuration of the product: its chosen variants instead of the model as written'}
	>
		<Boxes size={14} aria-hidden="true" />
		<span class:visually-hidden={compact}>Configuration</span>
		<select
			value={chosen?.qualifiedName ?? ''}
			onchange={(e) => (value = e.currentTarget.value || null)}
		>
			<option value="">As written</option>
			{#each variability.configurations as c (c.qualifiedName)}
				<option value={c.qualifiedName}>{c.name}</option>
			{/each}
		</select>
	</label>
{/if}

<style>
	.configuration {
		display: inline-flex;
		flex: 0 1 auto;
		min-width: 0;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 0 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.configuration.compact {
		border-color: transparent;
	}
	.compact select {
		max-width: 8rem;
	}
	.configuration.on {
		border-color: var(--accent);
	}
	select {
		height: 100%;
		min-width: 0;
		max-width: 12rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
