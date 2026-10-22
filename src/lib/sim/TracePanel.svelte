<script lang="ts">
	import { Check, CircleDot, TriangleAlert, X } from '@lucide/svelte';
	import type { SimStep } from '#lib/engine/types.ts';
	import { explain, isChangeTrigger, timeText } from './model.ts';

	interface Props {
		/** The trace of the latest session (steps after the cursor are "future"). */
		trace: SimStep[];
		/** The step the shown session is at. */
		current: number;
		labelOf: (state: string) => string;
		/** History positions, for the scrubber. */
		positions: number;
		cursor: number;
		onstep: (step: number) => void;
		onscrub: (position: number) => void;
	}

	let { trace, current, labelOf, positions, cursor, onstep, onscrub }: Props = $props();

	const uid = $props.id();
	let list = $state<HTMLOListElement>();

	// Keep the current step in view as the machine runs.
	$effect(() => {
		void current;
		void trace.length;
		const el = list?.querySelector<HTMLElement>('[aria-current="step"]');
		el?.scrollIntoView({ block: 'nearest' });
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('button.step') ?? [])];
		const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
		if (next) {
			e.preventDefault();
			next.focus();
		}
	}
</script>

{#if positions > 1}
	<div class="scrub">
		<label for="{uid}-scrub">History</label>
		<input
			id="{uid}-scrub"
			type="range"
			min="0"
			max={positions - 1}
			step="1"
			value={cursor}
			style:--fill="{(cursor / Math.max(1, positions - 1)) * 100}%"
			aria-valuetext="Position {cursor + 1} of {positions}"
			oninput={(e) => onscrub(Number(e.currentTarget.value))}
		/>
		<span class="pos">{cursor + 1}/{positions}</span>
	</div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ol class="trace" bind:this={list} {onkeydown}>
	{#each trace as s (s.step)}
		{@const future = s.step > current}
		{@const here = s.step === current}
		<li class:future class:here>
			<button
				type="button"
				class="step"
				aria-current={here ? 'step' : undefined}
				onclick={() => onstep(s.step)}
			>
				<span class="num" aria-hidden="true">
					{#if s.step === 0}<CircleDot size={12} />{:else}{s.step}{/if}
				</span>
				<span class="body">
					<span class="head">
						<span class="move">
							{#if s.step === 0}
								<span class="from">start</span>
							{:else}
								<span class="from">{labelOf(s.from_state)}</span>
							{/if}
							<span class="arrow" aria-hidden="true">→</span><span class="visually-hidden">to</span>
							<span class="to">{labelOf(s.to_state)}</span>
							{#if s.transition_name}<span class="tname">{s.transition_name}</span>{/if}
						</span>
						{#if s.time !== undefined}<span class="when"
								><span class="visually-hidden">at </span>{timeText(s.time)}</span
							>{/if}
					</span>
					<span class="details">
						{#if s.trigger}
							<span class="chip" class:change={isChangeTrigger(s.trigger)}>{s.trigger}</span>
						{:else if s.step > 0}
							<span class="chip muted">completion</span>
						{/if}
						{#if s.guard_result !== null}
							<span class="guard" class:false={!s.guard_result}>
								{#if s.guard_result}<Check size={11} aria-hidden="true" />{:else}<X
										size={11}
										aria-hidden="true"
									/>{/if}
								guard {s.guard_result ? 'true' : 'false'}
							</span>
						{/if}
						{#if s.do_stopped}<span class="act"><i>stopped</i> {s.do_stopped}</span>{/if}
						{#if s.exit_action}<span class="act"><i>exit</i> {s.exit_action}</span>{/if}
						{#if s.effect}<span class="act"><i>do</i> / {s.effect}</span>{/if}
						{#if s.entry_action}<span class="act"><i>entry</i> {s.entry_action}</span>{/if}
						{#if s.do_action}<span class="act"><i>started</i> {s.do_action}</span>{/if}
					</span>
					{#each s.notes ?? [] as note, n (n)}
						<span class="note">
							<TriangleAlert size={12} aria-hidden="true" />
							<span
								>{#each explain(note) as part, p (p)}{#if part.code}<code>{part.text}</code
										>{:else}{part.text}{/if}{/each}</span
							>
						</span>
					{/each}
				</span>
			</button>
		</li>
	{/each}
</ol>

<style>
	.scrub {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.scrub input {
		flex: 1;
		min-width: 0;
		height: 28px;
		margin: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}
	.scrub input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			var(--kind-behavior) var(--fill),
			var(--border-strong) var(--fill)
		);
	}
	.scrub input::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: var(--border-strong);
	}
	.scrub input::-moz-range-progress {
		height: 4px;
		background: var(--kind-behavior);
	}
	.scrub input::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		margin-top: -7px;
		background: var(--surface);
		border: 2px solid var(--kind-behavior);
		border-radius: 50%;
	}
	.scrub input::-moz-range-thumb {
		width: 14px;
		height: 14px;
		background: var(--surface);
		border: 2px solid var(--kind-behavior);
		border-radius: 50%;
	}
	.pos {
		min-width: 3.5em;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.trace {
		position: relative;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		position: relative;
	}
	/* The rail joining the steps. */
	li:not(:last-child)::before {
		content: '';
		position: absolute;
		top: 30px;
		bottom: -6px;
		left: 21px;
		width: 2px;
		background: var(--border);
	}
	.step {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		min-height: 44px;
		margin: 0;
		padding: 8px 8px 8px 10px;
		text-align: left;
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.step:hover {
		background: var(--surface-hover);
	}
	.num {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		flex: none;
		width: 24px;
		height: 24px;
		color: var(--text-2);
		background: var(--surface);
		border: 1.5px solid var(--border-strong);
		border-radius: 50%;
		font-size: 11px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.here .step {
		background: color-mix(in oklab, var(--kind-behavior) 9%, var(--surface));
		border-color: color-mix(in oklab, var(--kind-behavior) 45%, var(--border));
	}
	.here .num {
		color: var(--surface);
		background: var(--ok);
		border-color: var(--ok);
	}
	.future .step {
		opacity: 0.62;
	}
	.future .num {
		border-style: dashed;
	}
	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		padding-top: 2px;
	}
	.move {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 5px;
		font-size: var(--text-sm);
	}
	.from {
		color: var(--text-2);
	}
	.to {
		font-weight: 650;
	}
	.arrow {
		color: var(--text-3);
	}
	.tname {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.tname::before {
		content: '· ';
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
	}
	.when {
		flex: none;
		color: var(--text-2);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		color: var(--text-2);
		font-size: var(--text-xs);
		line-height: 1.4;
	}
	.note :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--warn);
	}
	.note code {
		padding: 0 3px;
		color: var(--text);
		background: var(--surface-2);
		border-radius: 4px;
		font-size: 11px;
	}
	.details {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip,
	.guard,
	.act {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: 100%;
		padding: 0 6px;
		overflow: hidden;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 18px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip {
		color: var(--text);
		background: color-mix(in oklab, var(--kind-behavior) 12%, var(--surface));
	}
	.chip.change {
		background: var(--info-weak);
	}
	.chip.muted {
		color: var(--text-2);
		background: var(--surface-2);
	}
	.guard {
		color: var(--ok);
		background: var(--ok-weak);
	}
	.guard.false {
		color: var(--danger);
		background: var(--danger-weak);
	}
	.act {
		color: var(--text-2);
		background: var(--surface-2);
	}
	.act i {
		color: var(--syntax-keyword);
	}
</style>
