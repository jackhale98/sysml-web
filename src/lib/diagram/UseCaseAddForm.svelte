<script lang="ts" module>
	export type UseCaseAddKind = 'use case' | 'actor';
</script>

<script lang="ts">
	/**
	 * Add on a use case diagram: a use case (beside the others, in the same
	 * boundary) or an actor taking part in one of the use cases drawn.
	 */
	import { untrack } from 'svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Plan } from './relationships.ts';

	let {
		hostLabel,
		useCases,
		initialUseCase,
		plan,
		onapply,
		oncancel
	}: {
		/** Where a new use case is written. */
		hostLabel: string;
		/** The use cases drawn, which an actor can take part in. */
		useCases: ModelElement[];
		/** The use case selected, which a new actor takes part in to start with. */
		initialUseCase?: string;
		plan: (kind: UseCaseAddKind, name: string, useCase: ModelElement | undefined) => Plan | string;
		onapply: (plan: Plan, kind: UseCaseAddKind, name: string) => Promise<string | null>;
		oncancel: () => void;
	} = $props();

	let kind = $state<UseCaseAddKind>('use case');
	let name = $state('');
	let useCaseKey = $state(untrack(() => initialUseCase ?? useCases[0]?.key ?? ''));
	let error = $state<string | null>(null);
	let busy = $state(false);
	const useCase = $derived(useCases.find((u) => u.key === useCaseKey));
	const planned = $derived(name.trim() ? plan(kind, name, useCase) : null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!planned) {
			error = kind === 'actor' ? 'Give the actor a name.' : 'Give the use case a name.';
			return;
		}
		if (typeof planned === 'string') {
			error = planned;
			return;
		}
		busy = true;
		error = await onapply(planned, kind, name);
		busy = false;
		if (!error) name = '';
	}
</script>

<form class="add-form" onsubmit={submit} aria-label="Add to this use case diagram">
	<fieldset class="kinds">
		<legend>Add</legend>
		<label class="kind">
			<input type="radio" name="use-case-add" value="use case" bind:group={kind} />
			<span>A use case <small>in {hostLabel}</small></span>
		</label>
		<label class="kind">
			<input
				type="radio"
				name="use-case-add"
				value="actor"
				bind:group={kind}
				disabled={!useCases.length}
			/>
			<span>An actor <small>who takes part in a use case</small></span>
		</label>
	</fieldset>
	<label>
		<span>Name</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={name}
			placeholder={kind === 'actor' ? 'e.g. Customer' : 'e.g. ReturnParcel'}
			autocomplete="off"
			spellcheck="false"
			autofocus
			required
		/>
	</label>
	{#if kind === 'actor'}
		<label>
			<span>Takes part in</span>
			<select bind:value={useCaseKey}>
				{#each useCases as u (u.key)}<option value={u.key}>{u.label}</option>{/each}
			</select>
		</label>
	{/if}
	{#if planned && typeof planned !== 'string'}
		<pre class="preview" aria-label="SysML that will be added">{planned.statement}</pre>
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
	.kinds {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: var(--space-1);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	label {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.kind {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text);
	}
	.kind input {
		height: auto;
		accent-color: var(--accent);
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
