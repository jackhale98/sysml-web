<script lang="ts">
	/**
	 * The inspector's view of a transition, in plain words ("When…", "Only
	 * if…", "Then do…"), with the form to change them.
	 */
	import { ArrowRight, Pencil } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { applySteps } from '#lib/workbench/actions.ts';
	import {
		planEditTransition,
		readTransition,
		signalChoices,
		statesOf,
		valuesAround,
		type TransitionSpec
	} from './behaviorEdits.ts';
	import { modelContext, syntaxCheck } from './modelContext.ts';
	import type { Plan } from './relationships.ts';
	import TransitionForm from './TransitionForm.svelte';

	let {
		element,
		workspace,
		engine
	}: { element: ModelElement; workspace: Workspace; engine: Engine } = $props();

	const ctx = $derived(modelContext(workspace));
	const source = $derived({
		file: element.file,
		start_byte: element.span.start_byte,
		end_byte: element.span.end_byte
	});
	const read = $derived(readTransition(source, ctx));
	const region = $derived(ctx.owners.get(element.key));
	/** The state it leaves: `first` as written, found in its region (or one around it). */
	const from = $derived.by(() => {
		const written = read?.parts.first?.split('.').pop()?.trim();
		if (!written || !region) return undefined;
		for (let at: ModelElement | undefined = region; at; at = ctx.owners.get(at.key)) {
			const found = statesOf(at, ctx).find((s) => s.name === written);
			if (found) return found;
		}
		return undefined;
	});
	let editing = $state(false);
	$effect(() => {
		void element.key;
		editing = false;
	});

	const when = (spec: TransitionSpec) => {
		const t = spec.trigger;
		if (t.kind === 'signal') return `${t.signal} arrives`;
		if (t.kind === 'change') return `${t.condition} becomes true`;
		if (t.kind === 'after') return `${t.seconds} s have passed`;
		return 'Right away';
	};

	/** Until the model describes the text as it is (a moment after an edit). */
	async function settled() {
		for (let i = 0; i < 200 && !workspace.settled; i++) {
			await new Promise((done) => setTimeout(done, 40));
		}
	}

	async function apply(plan: Plan) {
		const error = await applySteps(workspace, plan.label, plan.steps, syntaxCheck(engine));
		if (!error) editing = false;
		return error;
	}
</script>

{#if read && from}
	<section aria-labelledby="transition-heading" class="transition">
		<h3 id="transition-heading">Transition</h3>
		<p class="ends">
			{from.label}
			<ArrowRight size={13} aria-hidden="true" />
			{read.parts.target}
		</p>
		{#if editing}
			<TransitionForm
				from={from.label}
				to={read.parts.target ?? ''}
				initial={read.spec}
				signals={signalChoices(ctx)}
				values={valuesAround(from, ctx)}
				plan={(spec) => planEditTransition(source, from, spec, element.name, ctx)}
				submitLabel="Save"
				mode="inline"
				prepare={settled}
				onapply={apply}
				onclose={() => (editing = false)}
			/>
		{:else}
			<dl>
				<dt>When</dt>
				<dd>{when(read.spec)}</dd>
				<dt>Only if</dt>
				<dd>{read.spec.guard || '—'}</dd>
				<dt>Then do</dt>
				<dd>{read.spec.effect || '—'}</dd>
			</dl>
			<button type="button" class="change" onclick={() => (editing = true)}>
				<Pencil size={13} aria-hidden="true" /> Change when, only if, then do
			</button>
		{/if}
	</section>
{/if}

<style>
	.transition {
		display: grid;
		gap: var(--space-2);
	}
	h3 {
		margin: 0;
		color: var(--text-3);
		font-size: var(--text-xs);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.ends {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-weight: 600;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}
	dt {
		color: var(--text-2);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.change {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: 6px;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.change:hover {
		background: var(--surface-hover);
	}
</style>
