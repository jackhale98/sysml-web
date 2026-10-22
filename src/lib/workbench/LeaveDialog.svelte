<script lang="ts">
	/**
	 * Before leaving a project whose changes aren't on GitHub (or in its
	 * folder) yet: a calm word that they stay on this device, and the choice
	 * to save them first, go anyway, or stay. The question comes from
	 * `leaving.confirm` (#lib/project/leaving.svelte.ts).
	 */
	import { CloudAlert, FolderUp } from '@lucide/svelte';
	import GitHubMark from '#lib/git/GitHubMark.svelte';
	import { leaving } from '#lib/project/leaving.svelte.ts';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';

	const prompt = $derived(leaving.prompt);
	const risk = $derived(prompt?.risk ?? null);
	const anyway = $derived(prompt?.action === 'switch' ? 'Switch anyway' : 'Leave anyway');
	const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

	const title = $derived(
		risk?.kind === 'github'
			? 'Your changes aren’t on GitHub yet'
			: risk?.kind === 'folder'
				? 'Your changes aren’t in the folder yet'
				: 'Your latest changes couldn’t be saved'
	);
</script>

<SheetDialog
	open={!!prompt}
	{title}
	size="sm"
	closeLabel="Cancel"
	testid="leave-dialog"
	oncancel={() => prompt?.answer('cancel')}
>
	{#snippet icon()}
		{#if risk?.kind === 'github'}<GitHubMark size={20} />{:else if risk?.kind === 'folder'}<FolderUp
				size={20}
				aria-hidden="true"
			/>{:else}<CloudAlert size={20} aria-hidden="true" />{/if}
	{/snippet}
	{#if prompt && risk}
		<div class="message">
			{#if risk.kind === 'github'}
				<p>
					<strong>{changes(risk.count)}</strong> in {prompt.name}
					{risk.count === 1 ? 'is' : 'are'} kept on this device, but not saved to GitHub (<span
						class="where">{risk.repo}</span
					>, branch <span class="where">{risk.branch}</span>) yet.
				</p>
				<p class="muted">
					Nothing is lost if you go: {risk.count === 1 ? 'it stays' : 'they stay'} here for when you come
					back to this project on this device. Save to GitHub to have {risk.count === 1
						? 'it'
						: 'them'} everywhere else too.
				</p>
			{:else if risk.kind === 'folder'}
				<p>
					<strong>{changes(risk.count)}</strong> in {prompt.name}
					{risk.count === 1 ? 'is' : 'are'} kept on this device, but not saved to the folder yet.
				</p>
				<p class="muted">
					Nothing is lost if you go: {risk.count === 1 ? 'it stays' : 'they stay'} here for when you come
					back. Save to the folder to have {risk.count === 1 ? 'it' : 'them'} in your files too.
				</p>
			{:else}
				<p>This browser couldn’t save the latest changes to {prompt.name}.</p>
				<p class="muted">
					Try again before you go. If storage is full, free some space or download the project
					first.
				</p>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		{#if prompt && risk}
			<button type="button" class="button" onclick={() => prompt.answer('cancel')}>Cancel</button>
			<button type="button" class="button" onclick={() => prompt.answer('anyway')}>{anyway}</button>
			{#if risk.kind === 'github'}
				<button type="button" class="primary" onclick={() => prompt.answer('save-github')}>
					Save to GitHub first
				</button>
			{:else if risk.kind === 'folder'}
				<button type="button" class="primary" onclick={() => prompt.answer('save-folder')}>
					Save to folder first
				</button>
			{:else}
				<button type="button" class="primary" onclick={() => prompt.answer('retry')}>
					Try again
				</button>
			{/if}
		{/if}
	{/snippet}
</SheetDialog>

<style>
	.message {
		display: grid;
		gap: var(--space-2);
		font-size: var(--text-md);
	}
	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.where {
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.button,
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		cursor: pointer;
	}
	.button:hover {
		border-color: var(--text-3);
	}
	.primary {
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:hover {
		background: var(--accent-hover);
	}
</style>
