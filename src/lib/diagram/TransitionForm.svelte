<script lang="ts">
	/**
	 * A transition in plain words: "When…" (what triggers it), "Only if…" (a
	 * condition) and "Then do…" (what it does on the way), with the SysML it
	 * will write. Used to draw a new transition and to change one.
	 */
	import { ArrowRight } from '@lucide/svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Plan } from './relationships.ts';
	import FormPanel from './FormPanel.svelte';
	import { signalName, type Trigger, type TransitionSpec } from './behaviorEdits.ts';

	let {
		from,
		to,
		initial,
		signals,
		values,
		plan,
		submitLabel = 'Add transition',
		mode = 'popover',
		x = 0,
		y = 0,
		onapply,
		onclose
	}: {
		from: string;
		to: string;
		initial: TransitionSpec;
		/** Definitions a signal can name (item defs first). */
		signals: ModelElement[];
		/** Names of the values the machine keeps, for conditions and "Then do…". */
		values: string[];
		plan: (spec: TransitionSpec) => Plan | string;
		submitLabel?: string;
		mode?: 'popover' | 'sheet' | 'inline';
		x?: number;
		y?: number;
		onapply: (plan: Plan) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	// The form starts from `initial` and is the person's from then on.
	// svelte-ignore state_referenced_locally
	let kind = $state<Trigger['kind']>(initial.trigger.kind);
	// svelte-ignore state_referenced_locally
	let signal = $state(initial.trigger.kind === 'signal' ? initial.trigger.signal : '');
	// svelte-ignore state_referenced_locally
	let condition = $state(initial.trigger.kind === 'change' ? initial.trigger.condition : '');
	// svelte-ignore state_referenced_locally
	let seconds = $state(initial.trigger.kind === 'after' ? initial.trigger.seconds : '5');
	// svelte-ignore state_referenced_locally
	let guard = $state(initial.guard);
	// svelte-ignore state_referenced_locally
	let effect = $state(initial.effect);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const trigger = $derived<Trigger>(
		kind === 'signal'
			? { kind, signal }
			: kind === 'change'
				? { kind, condition }
				: kind === 'after'
					? { kind, seconds }
					: { kind: 'none' }
	);
	const spec = $derived<TransitionSpec>({ trigger, guard, effect });
	const result = $derived(plan(spec));
	/** A signal that isn't in the model yet: it will be declared. */
	const newSignal = $derived.by(() => {
		if (kind !== 'signal' || !signal.trim()) return null;
		if (initial.trigger.kind === 'signal' && signal.trim() === initial.trigger.signal) return null;
		const name = signalName(signal);
		return signals.some((s) => s.label === name.split('::').pop()) ? null : name;
	});
	/** Names a condition or action uses that the machine has no value for. */
	const unknown = $derived.by(() => {
		const known = new Set([
			...values,
			'true',
			'false',
			'not',
			'and',
			'or',
			'xor',
			'implies',
			'null'
		]);
		const texts = [kind === 'change' ? condition : '', guard, effect.includes(':=') ? effect : ''];
		const names = texts.flatMap((t) =>
			[...t.replace(/"[^"]*"/g, '').matchAll(/(?<![\w.:])([A-Za-z_]\w*)(?![\w(:])/g)].map(
				(m) => m[1]!
			)
		);
		return [...new Set(names.filter((n) => !known.has(n)))];
	});

	const CHOICES: { kind: Trigger['kind']; label: string }[] = [
		{ kind: 'signal', label: 'A signal arrives' },
		{ kind: 'change', label: 'Something becomes true' },
		{ kind: 'after', label: 'After a while' },
		{ kind: 'none', label: 'Right away' }
	];

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (typeof result === 'string') {
			error = result;
			return;
		}
		busy = true;
		error = await onapply(result);
		busy = false;
	}
</script>

<FormPanel label="Transition from {from} to {to}" {mode} {x} {y} {onclose}>
	<form onsubmit={submit}>
		<p class="ends">
			<strong>{from}</strong>
			<ArrowRight size={14} aria-hidden="true" />
			<strong>{to}</strong>
		</p>

		<fieldset>
			<legend>When…</legend>
			<div class="choices">
				{#each CHOICES as c (c.kind)}
					<label class="choice">
						<input type="radio" name="{uid}-when" value={c.kind} bind:group={kind} />
						{c.label}
					</label>
				{/each}
			</div>
		</fieldset>
		{#if kind === 'signal'}
			<label class="field">
				<span>Signal</span>
				<input
					bind:value={signal}
					list="{uid}-signals"
					placeholder="e.g. SwitchOn"
					autocomplete="off"
					spellcheck="false"
				/>
				<datalist id="{uid}-signals">
					{#each signals as s (s.key)}<option value={s.label}></option>{/each}
				</datalist>
			</label>
			{#if newSignal}
				<p class="note">{newSignal} is new: it will be added as an item definition.</p>
			{/if}
		{:else if kind === 'change'}
			<label class="field">
				<span>Condition</span>
				<input
					class="code"
					bind:value={condition}
					placeholder={values[0] ? `e.g. ${values[0]} > 3` : 'e.g. temperature > 30'}
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
		{:else if kind === 'after'}
			<label class="field">
				<span>Seconds</span>
				<input bind:value={seconds} inputmode="decimal" autocomplete="off" />
			</label>
		{:else}
			<p class="hint">As soon as {from} has finished what it does.</p>
		{/if}

		<label class="field">
			<span>Only if… <small>(optional)</small></span>
			<input
				class="code"
				bind:value={guard}
				placeholder={values[0] ? `e.g. ${values[0]} < 3` : 'a condition'}
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<label class="field">
			<span>Then do… <small>(optional)</small></span>
			<input
				class="code"
				bind:value={effect}
				placeholder={values[0] ? `e.g. beep, or ${values[0]} := ${values[0]} + 1` : 'e.g. beep'}
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		{#if values.length}
			<p class="hint">Values you can use: {values.join(', ')}</p>
		{/if}
		{#if unknown.length}
			<p class="note" role="status">
				{unknown.join(', ')}
				{unknown.length === 1 ? 'is' : 'are'} not a value of this machine yet: add {unknown.length ===
				1
					? 'it'
					: 'them'} with Add › Value.
			</p>
		{/if}

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

<style>
	small {
		color: var(--text-3);
		font-weight: 400;
	}
</style>
