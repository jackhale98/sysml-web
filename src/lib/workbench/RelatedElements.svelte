<script lang="ts">
	/**
	 * The inspector's related elements: what the selected element refers to
	 * (its type, what it specializes, satisfies, is connected to…), what
	 * refers to it, and where it is. Each row selects that element. A
	 * requirement's own "Satisfied by" and "Verified by" are above, so they
	 * are not repeated here.
	 */
	import { ChevronRight } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { RelatedElement } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { ownersOf } from '#lib/diagram/model.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { groupRelated } from './related.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let {
		element,
		workspace,
		ui,
		engine,
		requirement = false
	}: {
		element: ModelElement;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		/** Its satisfy and verify links are listed in the requirement's own section. */
		requirement?: boolean;
	} = $props();

	/** Rows a group shows before "Show all". */
	const FEW = 5;
	const uid = $props.id();

	let related = $state.raw<RelatedElement[]>([]);
	let generation = 0;
	$effect(() => {
		const current = ++generation;
		const id = element.id;
		void workspace.files;
		if (!id) {
			related = [];
			return;
		}
		void engine
			.related(workspace.sourceFiles(), id)
			.then((list) => {
				if (current === generation) related = list;
			})
			.catch(() => {
				if (current === generation) related = [];
			});
	});

	const groups = $derived(
		groupRelated(
			related,
			workspace.elements,
			(kind, direction) =>
				requirement && direction === 'in' && (kind === 'satisfies' || kind === 'verifies')
		)
	);
	const outgoing = $derived(groups.filter((g) => g.direction === 'out'));
	const incoming = $derived(groups.filter((g) => g.direction === 'in'));
	/** Its owners, outermost first. */
	const owners = $derived.by(() => {
		const map = ownersOf(workspace.tree);
		const chain: ModelElement[] = [];
		for (let at = map.get(element.key); at; at = map.get(at.key)) chain.unshift(at);
		return chain;
	});

	let expanded = $state<Record<string, boolean>>({});
	$effect(() => {
		void element.key;
		expanded = {};
	});
</script>

{#snippet list(title: string, part: typeof groups, id: string)}
	{#if part.length}
		<h4 {id}>{title}</h4>
		{#each part as group (group.kind)}
			{@const key = `${group.direction}:${group.kind}`}
			{@const shown = expanded[key] ? group.rows : group.rows.slice(0, FEW)}
			<div class="group" role="group" aria-label="{group.title} ({group.rows.length})">
				<p class="kind">{group.title} <span class="count">{group.rows.length}</span></p>
				<ul class="rows">
					{#each shown as row, i (`${row.element?.key ?? row.name}-${i}`)}
						<li>
							{#if row.element}
								{@const target = row.element}
								<button
									type="button"
									class="row"
									onclick={() => ui.select(target.key, 'inspector')}
								>
									<KindGlyph kind={row.kind} isDefinition={row.isDefinition} size={16} />
									<span class="name">{row.name}</span>
									{#if row.via}<span class="via">by {row.via}</span>{/if}
									<ChevronRight size={14} aria-hidden="true" class="go" />
								</button>
							{:else}
								<span class="row plain">
									<KindGlyph kind={row.kind} isDefinition={row.isDefinition} size={16} />
									<span class="name">{row.name}</span>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
				{#if group.rows.length > FEW}
					<button
						type="button"
						class="more"
						aria-expanded={!!expanded[key]}
						onclick={() => (expanded = { ...expanded, [key]: !expanded[key] })}
					>
						{expanded[key] ? 'Show fewer' : `Show all ${group.rows.length}`}
					</button>
				{/if}
			</div>
		{/each}
	{/if}
{/snippet}

{#if outgoing.length || incoming.length || owners.length}
	<section class="related" class:phone={ui.phone} aria-labelledby="{uid}-heading">
		<h3 id="{uid}-heading">Related elements</h3>
		{@render list('What it refers to', outgoing, `${uid}-out`)}
		{@render list('What refers to it', incoming, `${uid}-in`)}
		{#if owners.length}
			<h4>Where it is</h4>
			<p class="path">
				{#each owners as owner, i (owner.key)}
					{#if i}<ChevronRight size={12} aria-hidden="true" />{/if}
					<button type="button" class="crumb" onclick={() => ui.select(owner.key, 'inspector')}
						>{owner.label}</button
					>
				{/each}
			</p>
		{/if}
	</section>
{/if}

<style>
	h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	h4 {
		margin: var(--space-3) 0 var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.group {
		margin-bottom: var(--space-2);
	}
	.kind {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0 0 2px;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.count {
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.rows {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 1.875rem;
		padding: 0 var(--space-1);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--accent);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	button.row:hover {
		background: var(--surface-hover);
	}
	.row.plain {
		color: var(--text-2);
		cursor: default;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.via {
		overflow: hidden;
		color: var(--text-3);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row :global(.go) {
		flex: none;
		margin-left: auto;
		color: var(--text-3);
	}
	.more,
	.crumb {
		padding: 0 var(--space-1);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.more {
		min-height: 1.75rem;
	}
	.crumb {
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.path {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		margin: 0;
		color: var(--text-3);
	}
	.phone .row,
	.phone .more,
	.phone .crumb {
		min-height: 2.75rem;
	}
</style>
