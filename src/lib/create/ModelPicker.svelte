<script lang="ts">
	/**
	 * Choose elements of the model from its tree: the ones a form can use
	 * are check boxes (radio buttons for one), shown under the packages and
	 * parts they are in. A filter narrows a long tree.
	 */
	import { Search } from '@lucide/svelte';
	import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
	import { isLibraryFile } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { keywordOf } from '#lib/ui/kinds.ts';
	import { flatten } from './model';

	let {
		tree,
		selected = $bindable([]),
		selectable,
		single = false,
		label,
		empty = 'Nothing in the model can be chosen here yet.',
		note
	}: {
		tree: readonly TreeNode[];
		/** Qualified names of the chosen elements. */
		selected?: string[];
		selectable: (element: ModelElement, qualifiedName: string) => boolean;
		single?: boolean;
		/** The group's accessible name. */
		label: string;
		empty?: string;
		/** A short note per choosable element (its type, a value). */
		note?: (element: ModelElement) => string | null;
	} = $props();

	const uid = $props.id();
	let query = $state('');

	/** Choosable rows and the rows they are in, in tree order. */
	const rows = $derived.by(() => {
		const own = tree.filter((n) => !isLibraryFile(n.element.file));
		const all = flatten(own);
		const can = new Set(
			all.filter((r) => selectable(r.node.element, r.qualifiedName)).map((r) => r.qualifiedName)
		);
		const needle = query.trim().toLowerCase();
		const matches = (q: string, e: ModelElement) =>
			!needle ||
			e.label.toLowerCase().includes(needle) ||
			(e.shortName?.toLowerCase().includes(needle) ?? false) ||
			q.toLowerCase().includes(needle);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, not state
		const shown = new Set<string>();
		for (const r of all)
			if (can.has(r.qualifiedName) && matches(r.qualifiedName, r.node.element)) {
				const parts = r.qualifiedName.split('::');
				for (let i = 1; i <= parts.length; i++) shown.add(parts.slice(0, i).join('::'));
			}
		return {
			total: can.size,
			list: all
				.filter((r) => shown.has(r.qualifiedName))
				.map((r) => ({ ...r, choosable: can.has(r.qualifiedName) }))
		};
	});

	function toggle(q: string, on: boolean) {
		if (single) selected = on ? [q] : [];
		else selected = on ? [...selected.filter((s) => s !== q), q] : selected.filter((s) => s !== q);
	}
</script>

<div class="picker">
	{#if rows.total > 8}
		<label class="filter">
			<Search size={14} aria-hidden="true" />
			<span class="visually-hidden">Filter</span>
			<input type="search" placeholder="Filter" bind:value={query} />
		</label>
	{/if}
	{#if !rows.total}
		<p class="note">{empty}</p>
	{:else}
		<fieldset class="tree">
			<legend class="visually-hidden">{label}</legend>
			{#each rows.list as r (r.qualifiedName)}
				{@const e = r.node.element}
				{@const extra = r.choosable ? note?.(e) : null}
				{#if r.choosable}
					<label class="item check" style:padding-left="{0.5 + r.depth}rem">
						<input
							type={single ? 'radio' : 'checkbox'}
							name="{uid}-pick"
							value={r.qualifiedName}
							checked={selected.includes(r.qualifiedName)}
							onchange={(ev) => toggle(r.qualifiedName, ev.currentTarget.checked)}
						/>
						<KindGlyph kind={e.kind} isDefinition={e.isDefinition} />
						<span class="text">
							{#if e.shortName}<span class="id">{e.shortName}</span>{/if}
							{e.label}
							<span class="kind"
								>{keywordOf(e.kind, e.isDefinition)}{extra ? ` · ${extra}` : ''}</span
							>
						</span>
					</label>
				{:else}
					<div class="item context" style:padding-left="{0.5 + r.depth}rem">
						<KindGlyph kind={e.kind} isDefinition={e.isDefinition} />
						<span class="text">{e.label}</span>
					</div>
				{/if}
			{:else}
				<p class="note">Nothing matches “{query}”.</p>
			{/each}
		</fieldset>
	{/if}
</div>

<style>
	.picker {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}
	.filter {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text-3);
	}
	.filter:focus-within {
		outline: 2px solid var(--focus);
	}
	.filter input {
		flex: 1;
		min-height: 2.5rem;
		padding: 0 !important;
		border: 0 !important;
		outline: 0 !important;
	}
	.tree {
		display: grid;
		gap: 0;
		max-height: min(22rem, 45dvh);
		padding: var(--space-1) 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding-right: var(--space-3);
		font-size: var(--text-sm);
	}
	.item.check:hover {
		background: var(--surface-hover);
	}
	.item.check:has(input:checked) {
		background: var(--accent-weak);
	}
	.context {
		min-height: 2rem;
		color: var(--text-3);
	}
	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.id {
		margin-right: 4px;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.kind {
		margin-left: 6px;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
