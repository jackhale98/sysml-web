<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		Check,
		ChevronDown,
		CloudOff,
		Download,
		FolderOpen,
		FolderUp,
		LoaderCircle,
		Plus,
		RotateCcw
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import { deleteProject } from '#lib/project/store.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';

	/** The project's name, where it is saved, and what can be done with it. */
	let {
		workspace,
		session,
		engine
	}: { workspace: Workspace; session: ProjectSession; engine: Engine } = $props();

	let open = $state(false);
	let menu: HTMLDivElement | undefined = $state();

	const record = $derived(session.record);
	const unsaved = $derived(session.unsavedToFolder.length);

	async function saveToFolder() {
		open = false;
		const error = await session.saveToFolder();
		toasts.show(error ?? 'Saved to the folder.', { tone: error ? 'error' : 'success' });
	}

	async function exportKpar() {
		open = false;
		try {
			await session.exportKpar(engine);
		} catch (error) {
			toasts.show(error instanceof Error ? error.message : String(error), { tone: 'error' });
		}
	}

	async function resetDemo() {
		open = false;
		await deleteProject('demo');
		location.reload();
	}

	function onfocusout(event: FocusEvent) {
		if (!menu?.contains(event.relatedTarget as Node | null)) open = false;
	}

	/** Ctrl/⌘+S saves to the folder when there is one; otherwise it's already saved. */
	function onkeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
			event.preventDefault();
			if (session.canSaveToFolder) void saveToFolder();
			else toasts.show('Every change is saved in this browser as you work.', { tone: 'success' });
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="project-menu" bind:this={menu} {onfocusout}>
	<button
		type="button"
		class="name"
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		<strong>{workspace.info?.name ?? 'Project'}</strong>
		<ChevronDown size={14} aria-hidden="true" />
	</button>
	<span class="save" role="status" title={session.saveError ?? undefined}>
		{#if session.canSaveToFolder && unsaved}
			<button type="button" class="unsaved" onclick={saveToFolder}>
				<FolderUp size={13} aria-hidden="true" />
				{unsaved} unsaved · Save to folder
			</button>
		{:else if session.saveState === 'saving'}
			<LoaderCircle size={13} class="spin" aria-hidden="true" /> Saving…
		{:else if session.saveState === 'saved'}
			<Check size={13} aria-hidden="true" /> Saved
		{:else if session.saveState === 'error'}
			<CloudOff size={13} aria-hidden="true" /> Not saved
		{/if}
	</span>

	{#if open}
		<div class="menu" role="menu" aria-label="Project">
			<p class="where">
				{#if record?.origin === 'folder'}Opened from a folder; changes are kept in this browser and
					saved to the folder when you choose.
				{:else if record?.origin === 'demo'}The demo. Your changes are kept in this browser.
				{:else}Kept in this browser. Export it to share or back it up.{/if}
			</p>
			{#if session.canSaveToFolder}
				<button type="button" role="menuitem" onclick={saveToFolder}>
					<FolderUp size={15} /> Save to folder <kbd>Ctrl S</kbd>
				</button>
			{/if}
			<button type="button" role="menuitem" onclick={exportKpar}>
				<Download size={15} /> Download as .kpar
			</button>
			<a role="menuitem" href={resolve('/projects')}>
				<FolderOpen size={15} /> All projects…
			</a>
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					open = false;
					void goto(resolve('/projects#new'));
				}}
			>
				<Plus size={15} /> New project…
			</button>
			{#if record?.origin === 'demo'}
				<button type="button" role="menuitem" onclick={resetDemo}>
					<RotateCcw size={15} /> Reset the demo
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.project-menu {
		position: relative;
		display: flex;
		flex: 1 1 0;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}
	.name:hover,
	.name[aria-expanded='true'] {
		background: var(--surface-hover);
	}
	.name strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-2);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.save :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.unsaved {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 1.75rem;
		padding: 0 var(--space-2);
		border: 1px solid color-mix(in oklab, var(--warn) 50%, var(--border));
		border-radius: 999px;
		background: color-mix(in oklab, var(--warn) 12%, var(--surface));
		color: var(--text);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 30;
		display: grid;
		width: min(20rem, 90vw);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.where {
		padding: var(--space-1) var(--space-2) var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.menu button,
	.menu a {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.menu button:hover,
	.menu a:hover {
		background: var(--surface-hover);
	}
	kbd {
		margin-left: auto;
		color: var(--text-3);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
	}
	@media (max-width: 760px) {
		.save {
			display: none;
		}
	}
</style>
