<script lang="ts">
	import { Link2 } from '@lucide/svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { breakable } from './views.ts';

	/**
	 * What satisfies or verifies a requirement, in a table cell: each name a
	 * link that selects its element, as the inspector's "Satisfied by" does;
	 * nothing yet says so, as a gap. Other names of elements (a hazard's
	 * harms and controls) read the same, found by `find`.
	 */
	let {
		value,
		workspace,
		ui,
		gap = 'Not yet',
		find
	}: {
		value: string;
		workspace: Workspace;
		ui: WorkbenchUi;
		gap?: string;
		/** How a name finds its element, when the names aren't trace links (a hazard's controls). */
		find?: (name: string) => ModelElement | undefined;
	} = $props();

	const names = $derived(
		value
			.split(/,\s*/)
			.map((s) => s.trim())
			.filter(Boolean)
	);

	/** The element ids the trace links resolve to, by the name they are written with. */
	const linkIds = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built whole in a derived, never mutated after
		const ids = new Map<string, string>();
		for (const r of workspace.requirements)
			for (const [by, id] of Object.entries(r.linkIds)) if (!ids.has(by)) ids.set(by, id);
		return ids;
	});

	function target(by: string): ModelElement | undefined {
		if (find) return find(by);
		const id = linkIds.get(by);
		const found = id ? workspace.elements.find((e) => e.id === id) : undefined;
		if (found) return found;
		const name = by.split('.').pop() ?? by;
		return workspace.elements.find((e) => e.label === name && !e.isDefinition);
	}
</script>

{#if names.length}
	<span class="refs">
		{#each names as by (by)}
			{@const element = target(by)}
			{#if element}
				<button
					type="button"
					class="ref"
					title="Select {by}"
					onclick={(e) => {
						e.stopPropagation();
						ui.select(element.key, 'table');
					}}
					><Link2 size={12} aria-hidden="true" /><span
						>{#each breakable(by) as part, i (i)}{#if i}<wbr />{/if}{part}{/each}</span
					></button
				>
			{:else}
				<span class="ref plain"
					><Link2 size={12} aria-hidden="true" /><span
						>{#each breakable(by) as part, i (i)}{#if i}<wbr />{/if}{part}{/each}</span
					></span
				>
			{/if}
		{/each}
	</span>
{:else}
	<span class="gap">{gap}</span>
{/if}

<style>
	.refs {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px 4px;
	}
	.ref {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.5rem;
		padding: 0 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-align: left;
		/* Names break between their words (`burn|Injury`), not inside them. */
		overflow-wrap: normal;
		cursor: pointer;
	}
	.ref :global(svg) {
		flex: none;
	}
	button.ref:hover {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.ref.plain {
		color: var(--text);
		cursor: default;
	}
	/* A finger's width on a phone. */
	@media (max-width: 760px) {
		button.ref {
			min-height: 2.75rem;
		}
	}
	.gap {
		display: inline-block;
		padding: 1px 8px;
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
	}
</style>
