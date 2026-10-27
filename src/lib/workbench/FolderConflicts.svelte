<script lang="ts">
	/**
	 * "Save to folder" found files changed in the folder too (another editor,
	 * a git pull, a synced drive): for each, keep mine, take the folder's, or
	 * combine both, as "Get latest" asks for GitHub. Nothing is written until
	 * the person finishes; "Not now" leaves both sides as they are.
	 */
	import { FolderUp, LoaderCircle } from '@lucide/svelte';
	import ConflictChoices from '#lib/git/ConflictChoices.svelte';
	import type { Resolution } from '#lib/git/sync.ts';
	import { savedToFolder, type ProjectSession } from '#lib/project/session.svelte.ts';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';

	let { session }: { session: ProjectSession } = $props();

	const pending = $derived(session.folderPending);
	// A new question resets the choices: the combined version where there is one. (Not a
	// writable $derived: the person's choices are set inside it, so it must be deep state.)
	// eslint-disable-next-line svelte/prefer-writable-derived
	let choices = $state<Record<string, Resolution>>({});
	$effect.pre(() => {
		choices = Object.fromEntries(
			(pending?.conflicts ?? [])
				.filter((c) => c.merged !== null)
				.map((c) => [c.path, 'merged' as const])
		);
	});

	const count = $derived(pending?.conflicts.length ?? 0);
	const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
	const unresolved = $derived(
		pending ? pending.conflicts.filter((c) => !choices[c.path]).length : 0
	);
	const broughtIn = $derived(pending ? Object.keys(pending.updates).length : 0);

	async function finish() {
		const error = await session.resolveFolder($state.snapshot(choices));
		toasts.show(error ?? savedToFolder(session.broughtIn), {
			tone: error ? 'error' : 'success'
		});
	}
</script>

<SheetDialog
	open={!!pending}
	title="{files(count)} changed in the folder too"
	closeLabel="Not now"
	testid="folder-conflicts"
	oncancel={() => session.cancelFolderSave()}
>
	{#snippet icon()}<FolderUp size={20} aria-hidden="true" />{/snippet}
	{#if pending}
		<div class="message">
			<p class="muted">
				{count === 1 ? 'It was' : 'They were'} changed outside Tessera since you opened or last saved
				{count === 1 ? 'it' : 'them'}. Choose which version to keep for each. Nothing is saved until
				you finish.
				{#if broughtIn}{files(broughtIn)} changed only in the folder will simply be brought in.{/if}
			</p>
			<ConflictChoices
				conflicts={pending.conflicts}
				bind:choices
				where={{
					take: 'Take the folder’s',
					deleted: 'deleted in the folder',
					theirs: 'The folder’s',
					only: 'only in the folder'
				}}
			/>
			{#if unresolved}<p class="muted small">{unresolved} still to choose.</p>{/if}
		</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="button" onclick={() => session.cancelFolderSave()}>Not now</button>
		<button
			type="button"
			class="primary"
			onclick={finish}
			disabled={!!unresolved || session.savingToFolder}
		>
			{#if session.savingToFolder}<LoaderCircle size={16} class="spin" aria-hidden="true" />{/if}
			Finish saving
		</button>
	{/snippet}
</SheetDialog>

<style>
	.message {
		display: grid;
		gap: var(--space-3);
	}
	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.small {
		font-size: var(--text-xs);
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
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.primary :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
