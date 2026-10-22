<script lang="ts">
	import { untrack } from 'svelte';
	import { ADD_OPTIONS, elementText, type AddKind } from './templates.ts';

	let {
		ownerLabel,
		kinds = ADD_OPTIONS.map((o) => o.kind),
		initialKind,
		onadd,
		oncancel
	}: {
		ownerLabel: string;
		kinds?: AddKind[];
		/** The kind chosen to start with (a part when not given). */
		initialKind?: AddKind;
		onadd: (kind: AddKind, name: string, type: string) => Promise<string | null>;
		oncancel: () => void;
	} = $props();

	const options = $derived(ADD_OPTIONS.filter((o) => kinds.includes(o.kind)));
	let kind = $state<AddKind>(untrack(() => initialKind) ?? 'part');
	// Keep the chosen kind valid for this owner.
	$effect.pre(() => {
		if (!kinds.includes(kind)) kind = kinds[0] ?? 'part';
	});
	let name = $state('');
	let type = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);
	const option = $derived(options.find((o) => o.kind === kind));
	const preview = $derived(name.trim() ? elementText(kind, name, type) : '');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = await onadd(kind, name, type);
		busy = false;
		if (!error) {
			name = '';
			type = '';
		}
	}
</script>

<form class="add-form" onsubmit={submit} aria-label="Add to {ownerLabel}">
	<p class="where">Add to <strong>{ownerLabel}</strong></p>
	<label>
		<span>Kind</span>
		<select bind:value={kind}>
			{#each options as o (o.kind)}
				<option value={o.kind}>{o.label}</option>
			{/each}
		</select>
	</label>
	<label>
		<span>Name</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={name} placeholder={option?.placeholder} autofocus required />
	</label>
	{#if option?.typed}
		<label>
			<span>Type <small>(optional)</small></span>
			<input bind:value={type} placeholder="e.g. Battery" />
		</label>
	{/if}
	{#if preview}
		<pre class="preview" aria-label="SysML that will be added">{preview}</pre>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="buttons">
		<button type="button" class="ghost" onclick={oncancel}>Cancel</button>
		<button type="submit" class="primary" disabled={busy}>Add</button>
	</div>
</form>

<style>
	.add-form {
		display: grid;
		gap: var(--space-3);
		width: min(20rem, 100%);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}
	.where {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	label {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	small {
		color: var(--text-3);
	}
	input,
	select {
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
	}
	input:focus,
	select:focus {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.preview {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-xs);
		white-space: pre-wrap;
	}
	.error {
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button {
		height: 2.25rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		font-weight: 560;
		cursor: pointer;
	}
	.primary {
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:disabled {
		opacity: 0.6;
	}
	.ghost {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}
</style>
