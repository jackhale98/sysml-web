<script lang="ts">
	import { Check, X } from '@lucide/svelte';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { tabId, tabTitle, type WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import Sheet from './Sheet.svelte';
	import TabIcon from './TabIcon.svelte';
	import ViewsCatalog from './ViewsCatalog.svelte';

	/** The phone's tab strip: open views to switch between or close, then everything else. */
	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	function choose(index: number) {
		const tab = ui.tabs[index];
		if (tab) ui.open(tab);
	}
</script>

<Sheet bind:open={ui.viewsDrawer} label="Views">
	<section class="open-views" aria-labelledby="open-views-heading">
		<h3 id="open-views-heading">Open · {ui.tabs.length}</h3>
		<ul>
			{#each ui.tabs as t, i (tabId(t))}
				{@const current = i === ui.active}
				<li class:current>
					<button
						type="button"
						class="switch"
						aria-current={current ? 'true' : undefined}
						onclick={() => choose(i)}
					>
						<span class="icon"><TabIcon tab={t} size={18} /></span>
						<span class="title">{tabTitle(t)}</span>
						{#if t.kind === 'file' && workspace.dirty.has(t.path)}
							<span class="dot" aria-label="edited"></span>
						{/if}
						{#if current}<Check size={16} class="check" aria-hidden="true" />{/if}
					</button>
					{#if t.kind !== 'home' || ui.tabs.length > 1}
						<button
							type="button"
							class="close"
							aria-label="Close {tabTitle(t)}"
							onclick={() => ui.close(i)}
						>
							<X size={16} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
	<div class="go">
		<ViewsCatalog {workspace} {ui} headingLevel={3} />
	</div>
</Sheet>

<style>
	h3 {
		margin: var(--space-1) var(--space-1) var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	ul {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		transition: background var(--duration) var(--ease);
	}
	li.current {
		background: var(--accent-weak);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
	}
	.switch {
		display: flex;
		align-items: center;
		flex: 1;
		gap: var(--space-3);
		min-width: 0;
		min-height: 3rem;
		padding: 0 var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
	}
	.current .switch {
		font-weight: 600;
	}
	.icon {
		display: grid;
		place-items: center;
		color: var(--text-2);
	}
	.current .icon,
	.switch :global(.check) {
		color: var(--accent);
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--warn);
	}
	.close {
		display: grid;
		place-items: center;
		flex: none;
		width: 3rem;
		height: 3rem;
		border: 0;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.go {
		margin-top: var(--space-5);
	}
</style>
