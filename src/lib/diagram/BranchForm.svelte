<script lang="ts">
	/**
	 * A branch of a decision: where the flow goes "Only if…" a condition
	 * holds, or otherwise (no condition).
	 */
	import { ArrowRight } from '@lucide/svelte';
	import type { Plan } from './relationships.ts';
	import FormPanel from './FormPanel.svelte';

	let {
		from,
		to,
		initial = '',
		values,
		plan,
		submitLabel = 'Add branch',
		mode = 'popover',
		x = 0,
		y = 0,
		prepare,
		onapply,
		onclose
	}: {
		from: string;
		to: string;
		initial?: string;
		values: string[];
		plan: (guard: string) => Plan | string;
		submitLabel?: string;
		mode?: 'popover' | 'sheet' | 'inline';
		x?: number;
		y?: number;
		/** Waits until the model is up to date with the text, before the plan is made. */
		prepare?: () => Promise<void>;
		onapply: (plan: Plan) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let guard = $state(initial);
	let error = $state<string | null>(null);
	let busy = $state(false);
	const result = $derived(plan(guard));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		await prepare?.();
		// Made again now: the model may have moved on since the preview.
		const made = plan(guard);
		error = typeof made === 'string' ? made : await onapply(made);
		busy = false;
	}
</script>

<FormPanel label="Branch from {from} to {to}" {mode} {x} {y} {onclose}>
	<form onsubmit={submit}>
		<p class="ends">
			<strong>{from}</strong>
			<ArrowRight size={14} aria-hidden="true" />
			<strong>{to}</strong>
		</p>
		<label class="field">
			<span>Only if…</span>
			<input
				class="code"
				bind:value={guard}
				placeholder="a condition, e.g. temperature > 90"
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<p class="hint">
			Leave it empty for the way to go otherwise.{values.length
				? ` Values you can use: ${values.join(', ')}`
				: ''}
		</p>
		<div class="preview">
			<span>Writes</span>
			<code aria-label="SysML that will be written"
				>{typeof result === 'string' ? '…' : result.statement}</code
			>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="actions">
			<button type="button" class="quiet" onclick={onclose}>Cancel</button>
			<button type="submit" class="primary" disabled={busy}>{submitLabel}</button>
		</div>
	</form>
</FormPanel>
