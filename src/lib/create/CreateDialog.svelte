<script module lang="ts">
	export interface Step {
		id: string;
		/** Short, for the step list. */
		label: string;
		/** The step's question, as its heading. */
		question: string;
	}
</script>

<script lang="ts">
	/**
	 * The frame every guided form shares: a modal dialog (full screen on
	 * phones) with the steps, the current step's question, what is wrong in
	 * plain words, the SysML it will write ("See the SysML", folded away) and
	 * Back / Next / Create. Enter goes to the next step; Escape closes.
	 */
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { Check, ChevronLeft, LoaderCircle, X } from '@lucide/svelte';

	let {
		open = $bindable(false),
		title,
		steps,
		step = $bindable(0),
		preview = '',
		check,
		finishLabel = 'Create',
		onfinish,
		children,
		footer
	}: {
		open?: boolean;
		title: string;
		steps: Step[];
		step?: number;
		/** The SysML that will be written. */
		preview?: string;
		/** What is wrong with a step's choices, in plain words (null: nothing). */
		check?: (step: number) => string | null;
		finishLabel?: string;
		/** Write it; an error message keeps the dialog open. */
		onfinish: () => Promise<string | null>;
		children: Snippet;
		/** Extra content above the buttons (a note about the step). */
		footer?: Snippet<[number]>;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let heading = $state<HTMLElement>();
	let problem = $state<string | null>(null);
	let busy = $state(false);
	const current = $derived(steps[Math.min(step, steps.length - 1)]);
	const last = $derived(step >= steps.length - 1);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// Start at the question, so Tab goes on to its choices.
			void tick().then(() => heading?.focus());
		} else if (!open && dialog.open) dialog.close();
	});

	async function go(to: number) {
		problem = null;
		step = Math.max(0, Math.min(to, steps.length - 1));
		await tick();
		heading?.focus();
	}

	async function next(event?: SubmitEvent) {
		event?.preventDefault();
		if (busy) return;
		const wrong = check?.(step) ?? null;
		if (wrong) {
			problem = wrong;
			return;
		}
		if (!last) return go(step + 1);
		// Every step must be right before anything is written.
		for (let i = 0; i < steps.length; i++) {
			const earlier = check?.(i) ?? null;
			if (earlier) {
				await go(i);
				problem = earlier;
				return;
			}
		}
		busy = true;
		problem = await onfinish();
		busy = false;
	}

	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog) open = false;
	}
</script>

<!-- A backdrop click closes it; so do Escape and the close button. -->
<dialog
	bind:this={dialog}
	class="create"
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-question"
	onclose={() => (open = false)}
	onclick={onbackdrop}
>
	{#if open && current}
		<form class="frame" onsubmit={next} oninput={() => (problem = null)} novalidate>
			<header class="head">
				<h2 id="{uid}-title">{title}</h2>
				<button type="button" class="icon" aria-label="Close" onclick={() => (open = false)}>
					<X size={18} />
				</button>
			</header>
			{#if steps.length > 1}
				<ol class="steps" aria-label="Steps">
					{#each steps as s, i (s.id)}
						<li aria-current={i === step ? 'step' : undefined}>
							{#if i < step}
								<button type="button" class="step done" onclick={() => go(i)}>
									<span class="dot"><Check size={12} aria-hidden="true" /></span>
									<span class="label">{s.label}</span>
									<span class="visually-hidden">(done, go back)</span>
								</button>
							{:else}
								<span class="step" class:now={i === step}>
									<span class="dot">{i + 1}</span>
									<span class="label">{s.label}</span>
								</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
			<div class="body">
				<h3 id="{uid}-question" tabindex="-1" bind:this={heading}>
					{#if steps.length > 1}<span class="visually-hidden"
							>Step {step + 1} of {steps.length}:</span
						>{/if}
					{current.question}
				</h3>
				{@render children()}
			</div>
			<div class="end">
				{#if preview}
					<details class="sysml">
						<summary>See the SysML</summary>
						<!-- Focusable, so the keyboard can scroll a long preview. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<pre aria-label="SysML that will be written" tabindex="0">{preview}</pre>
					</details>
				{/if}
				{@render footer?.(step)}
				{#if problem}
					<p class="problem" role="alert">{problem}</p>
				{/if}
				<div class="buttons">
					{#if step > 0}
						<button type="button" class="ghost" onclick={() => go(step - 1)}>
							<ChevronLeft size={16} aria-hidden="true" /> Back
						</button>
					{:else}
						<button type="button" class="ghost" onclick={() => (open = false)}>Cancel</button>
					{/if}
					<button type="submit" class="primary" disabled={busy}>
						{#if busy}<LoaderCircle size={16} class="spin" aria-hidden="true" />{/if}
						{last ? finishLabel : 'Next'}
					</button>
				</div>
			</div>
		</form>
	{/if}
</dialog>

<style>
	.create {
		width: min(40rem, calc(100vw - 2rem));
		max-width: none;
		height: min(44rem, calc(100dvh - 4rem));
		max-height: none;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 4px);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.create[open] {
		display: flex;
		animation: pop 180ms var(--ease);
	}
	.create::backdrop {
		background: rgb(14 16 20 / 0.45);
		backdrop-filter: blur(6px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	.frame {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	.head h2 {
		font-size: var(--text-xl);
	}
	.icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface-hover);
	}
	.steps {
		display: flex;
		gap: var(--space-1);
		margin: 0;
		padding: var(--space-2) var(--space-4);
		overflow-x: auto;
		list-style: none;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}
	.steps li {
		flex: none;
	}
	.step {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-3);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 560;
	}
	button.step {
		color: var(--text-2);
		cursor: pointer;
	}
	button.step:hover {
		background: var(--surface-hover);
	}
	.step.now {
		color: var(--text);
	}
	.dot {
		display: grid;
		place-items: center;
		width: 1.375rem;
		height: 1.375rem;
		border: 1px solid var(--border-strong);
		border-radius: 50%;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.now .dot {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.done .dot {
		border-color: var(--accent);
		color: var(--accent);
	}
	.body {
		display: grid;
		flex: 1;
		align-content: start;
		gap: var(--space-4);
		min-height: 0;
		padding: var(--space-4) var(--space-5) var(--space-5);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.body h3 {
		font-size: var(--text-lg);
		outline: 0;
	}
	.end {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-5) var(--space-4);
		border-top: 1px solid var(--border);
		background: var(--surface);
	}
	.sysml summary {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: 560;
		cursor: pointer;
	}
	.sysml pre {
		max-height: 12rem;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: pre;
	}
	.problem {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.buttons {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.buttons button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-width: 6.5rem;
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.primary {
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:hover {
		background: var(--accent-hover);
	}
	.primary:disabled {
		opacity: 0.7;
	}
	.ghost {
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text);
	}
	.ghost:hover {
		background: var(--surface-hover);
	}
	button:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	/* Shared by the forms inside (fields, choice cards, segmented choices, notes). */
	.body :global(.field) {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}
	.body :global(.field > .name),
	.body :global(legend) {
		padding: 0;
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.body :global(.hint),
	.body :global(.note) {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.body :global(fieldset) {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.body :global(input:not([type='checkbox']):not([type='radio']):not([type='range'])),
	.body :global(select),
	.body :global(textarea) {
		width: 100%;
		min-width: 0;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.body :global(textarea) {
		min-height: 4.5rem;
		padding: var(--space-2) var(--space-3);
		resize: vertical;
	}
	.body :global(input:focus-visible),
	.body :global(select:focus-visible),
	.body :global(textarea:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.body :global(input[type='checkbox']),
	.body :global(input[type='radio']),
	.body :global(input[type='range']) {
		accent-color: var(--accent);
	}
	.body :global(input[type='checkbox']),
	.body :global(.check input[type='radio']) {
		width: 1.125rem;
		height: 1.125rem;
		flex: none;
	}
	.body :global(.row) {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-2);
	}
	.body :global(.row > .field) {
		flex: 1 1 7rem;
	}
	.body :global(.check) {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 2.75rem;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.body :global(.segmented) {
		display: inline-flex;
		flex-wrap: wrap;
		justify-self: start;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	.body :global(.segmented label) {
		position: relative;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.body :global(.segmented input),
	.body :global(.card input) {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.body :global(.segmented span) {
		display: flex;
		align-items: center;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.body :global(.segmented label:has(input:checked)) {
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.body :global(.segmented label:has(input:checked) span) {
		color: var(--text);
		font-weight: 600;
	}
	.body :global(.segmented label:has(input:focus-visible)),
	.body :global(.card:has(input:focus-visible)) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.body :global(.cards) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: var(--space-2);
	}
	.body :global(.card) {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: start;
		gap: 2px var(--space-3);
		min-height: 2.75rem;
		padding: var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.body :global(.card:hover) {
		background: var(--surface-hover);
	}
	.body :global(.card:has(input:checked)) {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent-weak);
	}
	.body :global(.card .glyph) {
		display: grid;
		grid-row: span 2;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		background: var(--accent-weak);
		color: var(--accent);
	}
	.body :global(.card strong) {
		font-size: var(--text-sm);
	}
	.body :global(.card small) {
		color: var(--text-2);
		font-size: var(--text-xs);
		line-height: 1.4;
	}
	.body :global(h4) {
		margin: var(--space-2) 0 0;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.body :global(.plain) {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	.body :global(.mono) {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	@media (max-width: 760px) {
		.body :global(input:not([type='checkbox']):not([type='radio']):not([type='range'])),
		.body :global(select) {
			min-height: 2.75rem;
			font-size: max(16px, 1em);
		}
		.body :global(.segmented span) {
			min-height: 2.75rem;
		}
		.body :global(.cards) {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 760px) {
		.create {
			width: 100vw;
			height: var(--app-height, 100dvh);
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		.create[open] {
			animation-name: rise;
		}
		@keyframes rise {
			from {
				opacity: 0.4;
				transform: translateY(24px);
			}
		}
		.head {
			padding-top: max(var(--space-3), env(safe-area-inset-top));
			padding-left: var(--space-4);
		}
		.body {
			padding: var(--space-4);
		}
		.end {
			padding: var(--space-3) var(--space-4) max(var(--space-3), env(safe-area-inset-bottom));
		}
		.buttons button {
			flex: 1;
		}
		.step .label {
			display: none;
		}
		.step.now .label {
			display: inline;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.create[open] {
			animation: none;
		}
	}
</style>
