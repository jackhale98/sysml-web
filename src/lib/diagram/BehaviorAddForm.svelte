<script lang="ts" module>
	/** What the Add form puts in a state machine or an action flow. */
	export type BehaviorAddKind = 'state' | 'value' | 'action' | 'decide' | 'merge' | 'fork' | 'join';

	export interface BehaviorAddChoice {
		kind: BehaviorAddKind;
		name: string;
		/** "Starts here": the machine (or flow) begins with it. */
		start: boolean;
		/** A value's type and starting value. */
		type: string;
		value: string;
	}
</script>

<script lang="ts">
	/**
	 * Add to a state machine (a state, a value it keeps) or an action flow (an
	 * action, a decision, a merge, a fork, a join), in plain words, with the
	 * SysML it will write.
	 */
	import { untrack } from 'svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Plan } from './relationships.ts';

	let {
		view,
		owners,
		initialOwner = null,
		plan,
		suggest,
		starts,
		onapply,
		oncancel
	}: {
		view: 'states' | 'actions';
		/** Where it can go: the machine or flow, and the selected state it can go inside. */
		owners: ModelElement[];
		/** The owner to start with (`owners[0]` when not given). */
		initialOwner?: string | null;
		plan: (owner: ModelElement, choice: BehaviorAddChoice) => Plan | string;
		/** A name for a new control node (`decision1`). */
		suggest: (owner: ModelElement, kind: BehaviorAddKind) => string;
		/** Whether `owner` already says where it starts. */
		starts: (owner: ModelElement) => boolean;
		onapply: (plan: Plan, choice: BehaviorAddChoice, owner: ModelElement) => Promise<string | null>;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	const KINDS: { kind: BehaviorAddKind; label: string; placeholder: string }[] = $derived(
		view === 'states'
			? [
					{ kind: 'state', label: 'State', placeholder: 'e.g. off' },
					{ kind: 'value', label: 'Value', placeholder: 'e.g. presses' }
				]
			: [
					{ kind: 'action', label: 'Action', placeholder: 'e.g. boilWater' },
					{ kind: 'decide', label: 'Decision', placeholder: 'e.g. isHot' },
					{ kind: 'merge', label: 'Merge', placeholder: 'e.g. ready' },
					{ kind: 'fork', label: 'Fork', placeholder: 'e.g. split' },
					{ kind: 'join', label: 'Join', placeholder: 'e.g. together' },
					{ kind: 'value', label: 'Value', placeholder: 'e.g. isHot' }
				]
	);
	const HINTS: Record<BehaviorAddKind, string> = {
		state: 'A situation the machine can be in, like "off" or "flying".',
		value: 'Something the machine keeps track of, which conditions can test.',
		action: 'A step of the flow.',
		decide: 'Where the flow takes one of several ways, each "only if" something holds.',
		merge: 'Where the ways a decision split come back together.',
		fork: 'Where the flow splits into steps that run at the same time.',
		join: 'Where steps that ran at the same time all finish before going on.'
	};
	const TYPES = [
		{ type: 'Integer', label: 'Whole number', value: '0' },
		{ type: 'Real', label: 'Number', value: '0.0' },
		{ type: 'Boolean', label: 'Yes or no', value: 'false' },
		{ type: 'String', label: 'Text', value: '""' }
	];

	// svelte-ignore state_referenced_locally
	let kind = $state<BehaviorAddKind>(view === 'states' ? 'state' : 'action');
	// svelte-ignore state_referenced_locally
	let ownerKey = $state(
		initialOwner && owners.some((o) => o.key === initialOwner)
			? initialOwner
			: (owners[0]?.key ?? '')
	);
	let name = $state('');
	let type = $state('Integer');
	let value = $state('0');
	let start = $state(false);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const owner = $derived(owners.find((o) => o.key === ownerKey) ?? owners[0]);
	const option = $derived(KINDS.find((k) => k.kind === kind) ?? KINDS[0]!);
	const canStart = $derived(kind === 'state' || kind === 'action');
	// "Starts here" begins checked while the machine doesn't say where it starts.
	$effect.pre(() => {
		if (owner) start = canStart && !starts(owner);
	});
	// Control nodes get a name to start from; people rarely care what a fork is called.
	let suggested = '';
	$effect.pre(() => {
		if (!owner) return;
		if (['decide', 'merge', 'fork', 'join'].includes(kind)) name = suggested = suggest(owner, kind);
		else if (untrack(() => name) === suggested) name = suggested = '';
	});
	const choice = $derived<BehaviorAddChoice>({ kind, name, start: canStart && start, type, value });
	const result = $derived(owner && name.trim() ? plan(owner, choice) : null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!owner) return;
		const p = plan(owner, choice);
		if (typeof p === 'string') {
			error = p;
			return;
		}
		busy = true;
		error = await onapply(p, choice, owner);
		busy = false;
		if (!error) name = '';
	}
</script>

<form class="add-form" onsubmit={submit} aria-label="Add to {owner?.label ?? 'the diagram'}">
	<fieldset>
		<legend>Add</legend>
		<div class="choices">
			{#each KINDS as k (k.kind)}
				<label class="choice">
					<input type="radio" name="{uid}-kind" value={k.kind} bind:group={kind} />
					{k.label}
				</label>
			{/each}
		</div>
	</fieldset>
	<p class="hint">{HINTS[kind]}</p>
	{#if owners.length > 1}
		<label class="field">
			<span>Put it in</span>
			<select bind:value={ownerKey}>
				{#each owners as o, i (o.key)}
					<option value={o.key}>{i === 0 ? o.label : `Inside ${o.label}`}</option>
				{/each}
			</select>
		</label>
	{/if}
	<label class="field">
		<span>Name</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={name}
			placeholder={option.placeholder}
			autocomplete="off"
			spellcheck="false"
			autofocus
			required
		/>
	</label>
	{#if kind === 'value'}
		<div class="row">
			<label class="field">
				<span>Kind of value</span>
				<select
					bind:value={type}
					onchange={() => (value = TYPES.find((t) => t.type === type)?.value ?? '')}
				>
					{#each TYPES as t (t.type)}<option value={t.type}>{t.label}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span>Starts as</span>
				<input class="code" bind:value autocomplete="off" spellcheck="false" />
			</label>
		</div>
	{/if}
	{#if canStart}
		<label class="check">
			<input type="checkbox" bind:checked={start} />
			Starts here
		</label>
	{/if}
	{#if result && typeof result !== 'string'}
		<pre class="preview" aria-label="SysML that will be added">{result.statement}</pre>
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
		width: min(21rem, calc(100vw - 32px));
		max-height: min(34rem, calc(100cqh - 64px));
		overflow-y: auto;
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}
	fieldset {
		display: grid;
		gap: 4px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend,
	.field > span {
		margin-bottom: 2px;
		padding: 0;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.choice {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: 2rem;
		padding: 2px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.choice:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent-weak);
		color: var(--accent);
		font-weight: 600;
	}
	.choice:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	.choice input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.hint {
		margin: 0;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.field {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.field input,
	.field select {
		width: 100%;
		min-width: 0;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.field input.code {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.field input:focus,
	.field select:focus {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 2rem;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.check input {
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		accent-color: var(--accent);
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
		margin: 0;
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button {
		min-height: 2.25rem;
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
	@media (pointer: coarse) {
		.choice,
		button,
		.field input,
		.field select {
			min-height: 2.75rem;
		}
	}
</style>
