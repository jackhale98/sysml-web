<script lang="ts">
	import {
		ArrowRight,
		Clock,
		Hourglass,
		Pause,
		Play,
		Redo2,
		RotateCcw,
		StepForward,
		Undo2,
		Zap
	} from '@lucide/svelte';
	import { WAITS, explain, timeText, type EventOption, type StepOption } from './model.ts';

	interface Props {
		events: EventOption[];
		step: StepOption;
		/** Labels for state paths. */
		labelOf: (state: string) => string;
		busy: boolean;
		running: boolean;
		canBack: boolean;
		canForward: boolean;
		auto: boolean;
		speed: number;
		/** Variables changed since the last step. */
		pendingCount: number;
		/** Simulated time, in seconds since the start. */
		time: number;
		onfire: (event: string | null) => void;
		/** Let time pass: so many seconds, or to the next timer. */
		onwait: (amount: number | 'next') => void;
		onback: () => void;
		onforward: () => void;
		onrestart: () => void;
		onauto: () => void;
		onspeed: () => void;
		onvariable: (name: string) => void;
	}

	let {
		events,
		step,
		labelOf,
		busy,
		running,
		canBack,
		canForward,
		auto,
		speed,
		pendingCount,
		time,
		onfire,
		onwait,
		onback,
		onforward,
		onrestart,
		onauto,
		onspeed,
		onvariable
	}: Props = $props();

	const uid = $props.id();
	let nudged = $state<string | null>(null);
	let waitFor = $state('next');

	/** Shake a blocked event so its reason gets noticed. */
	export function nudge(trigger: string) {
		nudged = null;
		requestAnimationFrame(() => (nudged = trigger));
		setTimeout(() => {
			if (nudged === trigger) nudged = null;
		}, 500);
	}

	function press(o: EventOption) {
		if (o.ready) onfire(o.trigger);
		else nudge(o.trigger);
	}

	const targets = (o: EventOption) => [
		...new Set(o.transitions.filter((t) => t.ready || !o.ready).map((t) => labelOf(t.to)))
	];
	const stepTargets = $derived(step.transitions.filter((t) => t.ready));
	const moves = (list: StepOption['transitions']) =>
		list.map((t) => `${t.transition} → ${labelOf(t.to)}`).join(', ');
	/** The next timer still to come, if one is running. */
	const nextDue = $derived.by(() => {
		const dues = step.transitions.flatMap((t) =>
			t.due !== undefined && t.due > time ? [t.due] : []
		);
		return dues.length ? Math.min(...dues) : null;
	});

	/** Wait for the amount chosen (the W key). */
	export function wait() {
		onwait(waitFor === 'next' ? 'next' : Number(waitFor));
	}
</script>

<section class="pad" aria-labelledby="{uid}-title">
	<div class="pad-head">
		<h3 id="{uid}-title"><Zap size={14} aria-hidden="true" /> Events</h3>
		{#if pendingCount}
			<span class="pending"
				>{pendingCount} variable{pendingCount > 1 ? 's' : ''} change{pendingCount > 1 ? '' : 's'} on the
				next step</span
			>
		{:else if events.length}
			<span class="hint"
				>Press <kbd>1</kbd>{events.length > 1 ? '–' : ''}{#if events.length > 1}<kbd
						>{Math.min(9, events.length)}</kbd
					>{/if}</span
			>
		{/if}
	</div>

	{#if events.length}
		<ul class="events">
			{#each events as o, i (o.trigger)}
				<li>
					<button
						type="button"
						class="event"
						class:blocked={!o.ready}
						class:nudged={nudged === o.trigger}
						aria-disabled={!o.ready || busy || !running}
						aria-describedby={o.ready ? undefined : `${uid}-why-${i}`}
						aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
						onclick={() => press(o)}
					>
						{#if i < 9}<kbd aria-hidden="true">{i + 1}</kbd>{/if}
						<span class="trigger">{o.trigger}</span>
						<span class="target">
							<ArrowRight size={13} aria-hidden="true" />
							<span class="visually-hidden">to</span>
							{targets(o).join(', ')}
						</span>
					</button>
					{#if !o.ready}
						<p class="why" id="{uid}-why-{i}">
							{#each o.reasons.slice(0, 2) as reason, r (r)}
								<span class="reason">
									{#each explain(reason) as part, p (p)}
										{#if part.variable}
											<button
												type="button"
												class="setvar"
												onclick={() => onvariable(part.variable!)}
												title="Set {part.variable}"><code>{part.text}</code></button
											>
										{:else if part.code}<code>{part.text}</code>{:else}{part.text}{/if}
									{/each}
								</span>
							{:else}
								<span class="reason">Cannot fire from here</span>
							{/each}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="none">
			{#if !running}
				The machine has stopped. Restart to run it again.
			{:else if step.transitions.length}
				No events from here; this state moves on by itself. Use Step.
			{:else}
				No transition leaves the current state.
			{/if}
		</p>
	{/if}

	<div class="clock" role="group" aria-labelledby="{uid}-time">
		<span class="now" id="{uid}-time" title="Simulated time since the start">
			<Clock size={15} aria-hidden="true" />
			<span><span class="visually-hidden">Time </span>{timeText(time)}</span>
		</span>
		<label class="visually-hidden" for="{uid}-wait">How long to wait</label>
		<select id="{uid}-wait" bind:value={waitFor}>
			<option value="next"
				>Next timer{nextDue !== null ? ` (${timeText(nextDue - time)})` : ''}</option
			>
			{#each WAITS as w (w)}<option value={String(w)}>{timeText(w)}</option>{/each}
		</select>
		<button
			type="button"
			class="wait"
			onclick={wait}
			aria-disabled={busy || !running}
			aria-keyshortcuts="W"
			title="Let time pass, taking what comes due on the way (W)"
		>
			<Hourglass size={16} aria-hidden="true" />
			<span>Wait</span>
		</button>
	</div>

	<div class="transport" role="toolbar" aria-label="Emulation">
		<button
			type="button"
			class="icon"
			onclick={onrestart}
			aria-label="Restart"
			title="Restart from the initial state"
		>
			<RotateCcw size={17} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="icon"
			onclick={onback}
			aria-disabled={!canBack}
			aria-label="Back"
			aria-keyshortcuts="B"
			title="Back one step (B)"
		>
			<Undo2 size={17} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="icon"
			onclick={onforward}
			aria-disabled={!canForward}
			aria-label="Forward"
			title="Forward again"
		>
			<Redo2 size={17} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="step"
			class:ready={step.ready}
			onclick={() => onfire(null)}
			aria-disabled={busy || !running}
			aria-keyshortcuts="S"
			title="Take what is ready now (completion, guard-only, when … and due after … transitions); if nothing is, let time pass to the next timer (S)"
		>
			<StepForward size={17} aria-hidden="true" />
			<span class="step-text">
				<span>Step</span>
				<small>
					{#if stepTargets.length}
						{moves(stepTargets)}
					{:else if step.next}
						in {timeText(step.next.due - time)}: {moves(step.next.transitions)}
					{:else if step.transitions.length}
						waiting: {step.transitions.map((t) => t.transition).join(', ')}
					{:else}
						nothing to take
					{/if}
				</small>
			</span>
		</button>
		<div class="auto">
			<button
				type="button"
				class="play"
				class:on={auto}
				onclick={onauto}
				aria-pressed={auto}
				aria-keyshortcuts="P"
				title={auto
					? 'Pause auto-run (P)'
					: 'Auto-run: Step, letting time pass, and send ready events by themselves (P)'}
			>
				{#if auto}<Pause size={16} aria-hidden="true" />{:else}<Play
						size={16}
						aria-hidden="true"
					/>{/if}
				<span class="play-text">{auto ? 'Pause' : 'Auto'}</span>
			</button>
			<button
				type="button"
				class="speed"
				onclick={onspeed}
				aria-label="Auto-run speed {speed}×"
				title="Auto-run speed">{speed}×</button
			>
		</div>
	</div>
</section>

<style>
	.pad {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-4);
		background: var(--surface);
		border-top: 1px solid var(--border);
	}
	.pad-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 22px;
	}
	h3 {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.hint,
	.pending {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.pending {
		color: var(--warn);
		font-weight: 550;
	}
	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		color: var(--text-2);
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		font-family: var(--font-ui);
		font-size: 10.5px;
		font-weight: 650;
		line-height: 1;
	}
	.events {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr));
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.events li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.event {
		--fam: var(--kind-behavior);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 46px;
		padding: 6px 12px 6px 9px;
		text-align: left;
		background: color-mix(in oklab, var(--fam) 9%, var(--surface));
		border: 1.5px solid color-mix(in oklab, var(--fam) 60%, var(--border));
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		transition:
			transform 120ms var(--ease),
			box-shadow 160ms var(--ease),
			background-color 160ms var(--ease);
	}
	.event:hover:not([aria-disabled='true']) {
		background: color-mix(in oklab, var(--fam) 16%, var(--surface));
		box-shadow: var(--shadow-md);
	}
	.event:active:not([aria-disabled='true']) {
		transform: scale(0.98);
	}
	.event kbd {
		color: var(--surface);
		background: var(--ok);
		border-color: color-mix(in oklab, var(--ok) 70%, black);
	}
	.trigger {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: 12.5px;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex: none;
		max-width: 45%;
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.event.blocked {
		background: var(--surface-2);
		border-style: dashed;
		border-color: var(--border-strong);
		box-shadow: none;
		cursor: not-allowed;
	}
	.event.blocked kbd {
		color: var(--text-2);
		background: var(--surface);
		border-color: var(--border-strong);
	}
	.event.blocked .trigger {
		color: var(--text-2);
	}
	.event[aria-disabled='true']:not(.blocked) {
		opacity: 0.7;
		cursor: progress;
	}
	.nudged {
		animation: nudge 360ms var(--ease);
	}
	@keyframes nudge {
		20%,
		60% {
			transform: translateX(-4px);
		}
		40%,
		80% {
			transform: translateX(4px);
		}
	}
	.why {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0 4px;
		color: var(--text-2);
		font-size: var(--text-xs);
		line-height: 1.45;
	}
	.why code {
		padding: 0 3px;
		color: var(--text);
		background: var(--surface-2);
		border-radius: 4px;
		font-size: 11.5px;
	}
	.setvar {
		margin: 0;
		padding: 0;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.setvar code {
		color: var(--accent);
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	.none {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.clock {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.now {
		display: inline-flex;
		flex: 1 0 auto;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.now :global(svg) {
		flex: none;
		color: var(--kind-behavior);
	}
	.clock select {
		flex: 0 1 auto;
		min-width: 0;
		min-height: 44px;
		padding: 0 8px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font: inherit;
		font-size: var(--text-sm);
	}
	.wait {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 14px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font-weight: 600;
		cursor: pointer;
	}
	.wait:hover:not([aria-disabled='true']) {
		background: var(--surface-hover);
	}
	.wait[aria-disabled='true'] {
		color: var(--text-3);
		cursor: default;
	}

	.transport {
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
	}
	.transport button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 44px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background-color 160ms var(--ease);
	}
	.transport button:hover:not([aria-disabled='true']) {
		background: var(--surface-hover);
	}
	.transport button[aria-disabled='true'] {
		color: var(--text-3);
		cursor: default;
	}
	.icon {
		flex: none;
		width: 44px;
	}
	.step {
		flex: 1;
		min-width: 0;
		padding: 4px 12px;
		justify-content: flex-start !important;
	}
	.step-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		text-align: left;
		line-height: 1.2;
	}
	.step-text span {
		font-weight: 600;
	}
	.step-text small {
		overflow: hidden;
		color: var(--text-2);
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.step.ready {
		background: color-mix(in oklab, var(--kind-behavior) 10%, var(--surface)) !important;
		border-color: color-mix(in oklab, var(--kind-behavior) 60%, var(--border));
	}
	.auto {
		display: flex;
		flex: none;
	}
	.play {
		padding: 0 12px;
		border-radius: var(--radius-md) 0 0 var(--radius-md) !important;
		font-weight: 600;
	}
	.play.on {
		color: var(--accent-text) !important;
		background: var(--accent) !important;
		border-color: var(--accent) !important;
	}
	.speed {
		width: 44px;
		margin-left: -1px;
		border-radius: 0 var(--radius-md) var(--radius-md) 0 !important;
		color: var(--text-2) !important;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		font-weight: 650;
	}

	@container emulator (max-width: 430px) {
		.play-text {
			display: none;
		}
		.events {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nudged {
			animation: none;
			outline: 2px solid var(--warn);
		}
	}
</style>
