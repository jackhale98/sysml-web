<script lang="ts">
	/**
	 * The element form `ui.elementRequest` asks for, from the explorer's menu:
	 * renaming an element (its references follow), or deleting it from the
	 * model after saying what else uses it. A card on larger screens, a
	 * bottom sheet on phones (`SheetDialog`). Each is one undoable step.
	 */
	import { PenLine, Trash2 } from '@lucide/svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import { deleteElement, deleteImpact, renameElement } from './actions.ts';
	import type { ElementRequest, WorkbenchUi } from './ui.svelte.ts';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	const uid = $props.id();
	let open = $state(false);
	let kind = $state<ElementRequest['kind']>('rename');
	/** The element as it was asked about (its key changes when the text before it does). */
	let element = $state.raw<ModelElement | null>(null);
	let name = $state('');
	let busy = $state(false);
	let failed = $state<string | null>(null);
	/** Delete: what else uses it, once checked. */
	let impact = $state<string | null>(null);

	$effect(() => {
		const asked = ui.elementRequest;
		if (!asked) return;
		ui.elementRequest = null;
		const found = workspace.elements.find((e) => e.key === asked.key);
		if (!found) return;
		kind = asked.kind;
		element = found;
		name = found.label;
		busy = false;
		failed = null;
		impact = null;
		open = true;
		if (asked.kind === 'delete')
			void deleteImpact(workspace, found).then((line) => {
				if (element === found) impact = line;
			});
	});

	/** The name field, with the name selected to type over (once the dialog is up). */
	const ready = (input: HTMLInputElement) => {
		requestAnimationFrame(() => {
			input.focus();
			input.select();
		});
	};

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!element || busy) return;
		busy = true;
		failed =
			kind === 'rename'
				? await renameElement(workspace, element, name)
				: await deleteElement(workspace, element);
		busy = false;
		if (!failed) open = false;
	}
</script>

<SheetDialog
	bind:open
	title={kind === 'rename'
		? `Rename ${element?.label ?? ''}`
		: `Delete ${element?.label ?? ''} from the model?`}
	description={kind === 'rename'
		? 'References to it are renamed too, in every file.'
		: `Its text is removed from ${element?.file ?? 'its file'}, so it leaves every diagram and table. You can undo this.`}
	size="sm"
	closeLabel="Cancel"
	testid="element-dialog"
	oncancel={() => (open = false)}
>
	{#snippet icon()}
		{#if kind === 'rename'}<PenLine size={20} aria-hidden="true" />{:else}<Trash2
				size={20}
				aria-hidden="true"
			/>{/if}
	{/snippet}
	<form id="{uid}-form" class="form" onsubmit={submit} novalidate>
		{#if kind === 'rename'}
			<div class="field">
				<label for="{uid}-name">Name</label>
				<input
					id="{uid}-name"
					bind:value={name}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					disabled={busy}
					{@attach ready}
				/>
			</div>
		{:else}
			<p class="impact" role="status">{impact ?? 'Checking what uses it…'}</p>
		{/if}
		{#if failed}<p class="error" role="alert">{failed}</p>{/if}
	</form>
	{#snippet footer()}
		<button type="button" class="button" onclick={() => (open = false)}>
			{kind === 'rename' ? 'Cancel' : 'Keep'}
		</button>
		{#if kind === 'rename'}
			<button type="submit" form="{uid}-form" class="primary" disabled={busy}>Rename</button>
		{:else}
			<button type="submit" form="{uid}-form" class="danger" disabled={busy}>
				<Trash2 size={16} aria-hidden="true" /> Delete
			</button>
		{/if}
	{/snippet}
</SheetDialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}
	.field {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}
	label {
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	input {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
	}
	input:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.impact {
		color: var(--text-2);
		font-size: var(--text-md);
	}
	.error {
		color: var(--danger);
		font-weight: 550;
	}
	.button,
	.primary,
	.danger {
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
	.danger {
		border-color: var(--danger);
		background: var(--danger);
		color: var(--surface);
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
