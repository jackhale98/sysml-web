<script lang="ts">
	/**
	 * What a state does: when it is entered, while the machine is in it, and
	 * when it is left (`entry`, `do` and `exit` actions). One at a time, each
	 * an action's name or values to set.
	 */
	import type { Plan } from './relationships.ts';
	import FormPanel from './FormPanel.svelte';
	import type { StateActionKind } from './behaviorEdits.ts';

	let {
		stateName,
		current,
		values,
		plan,
		mode = 'popover',
		x = 0,
		y = 0,
		prepare,
		onapply,
		onclose
	}: {
		stateName: string;
		current: Record<StateActionKind, string>;
		values: string[];
		plan: (kind: StateActionKind, action: string) => Plan | string;
		mode?: 'popover' | 'sheet' | 'inline';
		x?: number;
		y?: number;
		/** Waits until the model is up to date with the text, before the plan is made. */
		prepare?: () => Promise<void>;
		onapply: (plan: Plan) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const KINDS: { kind: StateActionKind; label: string }[] = [
		{ kind: 'entry', label: 'When entering' },
		{ kind: 'do', label: 'While in it' },
		{ kind: 'exit', label: 'When leaving' }
	];
	let kind = $state<StateActionKind>(KINDS.find((k) => !current[k.kind])?.kind ?? 'entry');
	// svelte-ignore state_referenced_locally
	let action = $state(current[kind]);
	let error = $state<string | null>(null);
	let busy = $state(false);
	const result = $derived(
		!action.trim() && !current[kind] ? 'Write what it does.' : plan(kind, action)
	);

	function choose(next: StateActionKind) {
		kind = next;
		action = current[next];
		error = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		await prepare?.();
		// Made again now: the model may have moved on since the preview.
		const made = !action.trim() && !current[kind] ? 'Write what it does.' : plan(kind, action);
		error = typeof made === 'string' ? made : await onapply(made);
		busy = false;
	}
</script>

<FormPanel label="What {stateName} does" {mode} {x} {y} {onclose}>
	<form onsubmit={submit}>
		<p class="ends"><strong>What {stateName} does</strong></p>
		<fieldset>
			<legend>When</legend>
			<div class="choices">
				{#each KINDS as k (k.kind)}
					<label class="choice">
						<input
							type="radio"
							name="{uid}-kind"
							value={k.kind}
							checked={kind === k.kind}
							onchange={() => choose(k.kind)}
						/>
						{k.label}{current[k.kind] ? ' ✓' : ''}
					</label>
				{/each}
			</div>
		</fieldset>
		<label class="field">
			<span>Then do…</span>
			<input
				class="code"
				bind:value={action}
				placeholder="e.g. beep, or count := 0"
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<p class="hint">
			{current[kind] ? 'Empty it to remove it. ' : ''}An action's name, or a value to set (count :=
			count + 1).{values.length ? ` Values you can use: ${values.join(', ')}` : ''}
		</p>
		<div class="preview">
			<span>Writes</span>
			<code aria-label="SysML that will be written"
				>{typeof result === 'string' ? '…' : result.statement || '(removed)'}</code
			>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="actions">
			<button type="button" class="quiet" onclick={onclose}>Cancel</button>
			<button type="submit" class="primary" disabled={busy}>Save</button>
		</div>
	</form>
</FormPanel>
