<script lang="ts">
	import { Monitor, Moon, Sun } from '@lucide/svelte';
	import { theme } from './theme.svelte';

	const label = $derived(
		theme.choice === 'system'
			? 'Theme: match system'
			: theme.choice === 'light'
				? 'Theme: light'
				: 'Theme: dark'
	);
</script>

<button
	class="icon-button"
	type="button"
	onclick={() => theme.next()}
	title={label}
	aria-label={label}
>
	{#if theme.choice === 'light'}
		<Sun size={17} />
	{:else if theme.choice === 'dark'}
		<Moon size={17} />
	{:else}
		<Monitor size={17} />
	{/if}
</button>

<style>
	.icon-button {
		display: inline-grid;
		place-items: center;
		width: 2.125rem;
		height: 2.125rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon-button:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
</style>
