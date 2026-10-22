<script lang="ts">
	/**
	 * What this diagram hides, at its foot: "2 hidden · Show all", and the
	 * list of them, each to show again. Hidden elements stay in the model;
	 * only this diagram leaves them out.
	 */
	import { ChevronUp, Eye } from '@lucide/svelte';

	let {
		hidden,
		onshow
	}: {
		hidden: { id: string; label: string }[];
		/** Show these again, or everything with 'all'. */
		onshow: (ids: string[] | 'all') => void;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
</script>

<div class="hidden-panel" role="group" aria-label="Hidden on this diagram">
	{#if open}
		<ul id="{uid}-list" class="list">
			{#each hidden as item (item.id)}
				<li>
					<span class="name" title={item.id}>{item.label}</span>
					<button
						type="button"
						class="show"
						aria-label="Show {item.label} again"
						onclick={() => onshow([item.id])}
					>
						<Eye size={14} aria-hidden="true" /> Show
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="bar">
		<button
			type="button"
			class="count"
			aria-expanded={open}
			aria-controls="{uid}-list"
			title="Elements left off this diagram; they are still in the model"
			onclick={() => (open = !open)}
		>
			{hidden.length} hidden
			<ChevronUp size={14} aria-hidden="true" class={open ? '' : 'down'} />
		</button>
		<span class="dot" aria-hidden="true">·</span>
		<button type="button" class="all" onclick={() => onshow('all')}>Show all</button>
	</div>
</div>

<style>
	.hidden-panel {
		display: grid;
		gap: 4px;
		width: max-content;
		max-width: min(20rem, calc(100vw - 7rem));
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.dot {
		color: var(--text-3);
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.75rem;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	button:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.all {
		color: var(--accent);
	}
	.count :global(.down) {
		rotate: 180deg;
	}
	.list {
		display: grid;
		max-height: 14rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.show {
		flex: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-left: 8px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		button {
			min-height: 2.75rem;
		}
	}
</style>
