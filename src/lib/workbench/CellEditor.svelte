<script lang="ts">
	import { onMount } from 'svelte';
	import type { ColumnEdit } from '#lib/engine/types.ts';

	/**
	 * Inline editor for one table cell. Enter (or Ctrl+Enter for long text)
	 * saves, Escape cancels, leaving the cell saves.
	 */
	let {
		edit,
		value,
		label,
		onsave,
		oncancel
	}: {
		edit: ColumnEdit;
		value: string;
		label: string;
		onsave: (value: string) => void;
		oncancel: () => void;
	} = $props();

	// Editing starts from the cell's value at the moment the editor opens.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);
	// svelte-ignore state_referenced_locally
	let chosen = $state(new Set(value.split(/,\s*/).filter(Boolean)));
	let field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined = $state();
	let done = false;

	onMount(() => {
		field?.focus();
		if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
	});

	function save() {
		if (done) return;
		done = true;
		const next = edit.kind === 'enumList' ? [...chosen].join(', ') : draft.trim();
		if (next === value) oncancel();
		else onsave(next);
	}

	function cancel() {
		done = true;
		oncancel();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
		} else if (
			event.key === 'Enter' &&
			(edit.kind !== 'longText' || event.ctrlKey || event.metaKey)
		) {
			event.preventDefault();
			save();
		}
	}

	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (!next || !(event.currentTarget as HTMLElement).contains(next)) save();
	}
</script>

<!-- Keys and focus bubble up from the field inside; the group only listens. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="editor" {onfocusout} {onkeydown} role="group" aria-label="Edit {label}">
	{#if edit.kind === 'enum' && edit.options?.length}
		<select bind:this={field} bind:value={draft} aria-label={label} onchange={save}>
			<option value="">—</option>
			{#each edit.options as option (option)}
				<option value={option}>{option}</option>
			{/each}
		</select>
	{:else if edit.kind === 'enumList' && edit.options?.length}
		<fieldset>
			<legend class="visually-hidden">{label}</legend>
			{#each edit.options as option, i (option)}
				<label>
					<input
						type="checkbox"
						checked={chosen.has(option)}
						onchange={(e) => {
							const next = new Set(chosen);
							if (e.currentTarget.checked) next.add(option);
							else next.delete(option);
							chosen = next;
						}}
						{@attach (node) => {
							if (i === 0) node.focus();
						}}
					/>
					{option}
				</label>
			{/each}
			<button type="button" class="done" onclick={save}>Done</button>
		</fieldset>
	{:else if edit.kind === 'longText'}
		<textarea bind:this={field} bind:value={draft} aria-label={label} rows="4"></textarea>
		<span class="hint">Ctrl+Enter to save · Esc to cancel</span>
	{:else}
		<input
			bind:this={field}
			bind:value={draft}
			aria-label={label}
			inputmode={edit.kind === 'number' ? 'decimal' : undefined}
		/>
	{/if}
</div>

<style>
	.editor {
		display: grid;
		gap: 4px;
		min-width: 8rem;
	}
	input,
	select,
	textarea {
		width: 100%;
		padding: 4px 8px;
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 0 0 3px var(--accent-weak);
		font: inherit;
		outline: none;
	}
	textarea {
		min-width: 18rem;
		resize: vertical;
	}
	fieldset {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: var(--space-2);
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--surface);
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	fieldset label {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.done {
		justify-self: end;
		margin-top: 4px;
		padding: 2px 10px;
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		cursor: pointer;
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
</style>
