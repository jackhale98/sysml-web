<script lang="ts" module>
	export interface EmptyAction {
		label: string;
		run: () => void;
		primary?: boolean;
	}
</script>

<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	/**
	 * What an empty place is for and what to do about it: a title, a line of
	 * explanation and a button or two. The same everywhere a new project is
	 * empty (a table with no rows, a diagram with nothing in it, no views).
	 */
	let {
		icon,
		title,
		children,
		actions = [],
		compact = false
	}: {
		icon?: Component<{ size?: number }>;
		title: string;
		/** The explanation: what goes here, and how. */
		children?: Snippet;
		actions?: EmptyAction[];
		/** For a narrow place, such as the explorer. */
		compact?: boolean;
	} = $props();
</script>

<div class="empty-state" class:compact>
	{#if icon}
		{@const Icon = icon}
		<span class="icon" aria-hidden="true"><Icon size={compact ? 18 : 22} /></span>
	{/if}
	<p class="title">{title}</p>
	{#if children}<p class="text">{@render children()}</p>{/if}
	{#if actions.length}
		<div class="actions">
			{#each actions as a (a.label)}
				<button type="button" class:primary={a.primary} onclick={a.run}>{a.label}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.empty-state {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		max-width: 26rem;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		color: var(--text-2);
		text-align: center;
	}
	.compact {
		justify-items: start;
		max-width: none;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		text-align: left;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--text-2);
	}
	.compact .icon {
		display: none;
	}
	.title {
		margin: 0;
		color: var(--text);
		font-weight: 600;
	}
	.compact .title {
		font-size: var(--text-sm);
	}
	.text {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.5;
	}
	.text :global(code) {
		padding: 0 3px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.compact .actions {
		justify-content: flex-start;
	}
	button {
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.compact button {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
	}
	button:hover {
		background: var(--surface-hover);
	}
	button.primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--accent-text);
	}
	button.primary:hover {
		filter: brightness(1.05);
	}
</style>
