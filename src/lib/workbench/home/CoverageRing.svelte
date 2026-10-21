<script lang="ts">
	/**
	 * A proportion as a ring, e.g. requirements covered by a test. The ring is
	 * a `meter`; its caption repeats the label and count for sighted readers.
	 */
	let {
		value,
		total,
		label,
		hint,
		color,
		ready
	}: {
		value: number;
		total: number;
		label: string;
		/** One plain-language line under the label. */
		hint: string;
		/** A CSS colour, e.g. `var(--ok)`. */
		color: string;
		ready: boolean;
	} = $props();

	const RADIUS = 42;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	const fraction = $derived(ready && total > 0 ? value / total : 0);
	const percent = $derived(Math.round(fraction * 100));
</script>

<div class="ring-meter" style:--tone={color}>
	<div
		class="ring"
		role="meter"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={Math.max(total, 1)}
		aria-valuenow={ready ? value : 0}
		aria-valuetext={ready ? `${value} of ${total} (${percent}%)` : 'Analysing'}
	>
		<svg viewBox="0 0 100 100" aria-hidden="true">
			<circle class="track" cx="50" cy="50" r={RADIUS} />
			<circle
				class="arc"
				class:empty={fraction === 0}
				cx="50"
				cy="50"
				r={RADIUS}
				stroke-dasharray={CIRCUMFERENCE}
				stroke-dashoffset={CIRCUMFERENCE * (1 - fraction)}
			/>
		</svg>
		<span class="figure" aria-hidden="true">
			{#if ready}
				<strong>{percent}</strong><span class="unit">%</span>
			{:else}
				<span class="skeleton"></span>
			{/if}
		</span>
	</div>
	<div class="caption">
		<span class="label">{label}</span>
		<span class="count">
			{#if ready}{value} of {total}{:else}<span class="skeleton line"></span>{/if}
		</span>
		<span class="hint">{hint}</span>
	</div>
</div>

<style>
	/* Narrow: ring beside its caption. Wide (container ≥ 26rem): ring above it. */
	.ring-meter {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}
	.ring {
		position: relative;
		width: 5.25rem;
		height: 5.25rem;
		flex: none;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			color-mix(in oklab, var(--tone) 10%, transparent) 0 52%,
			transparent 53%
		);
	}
	svg {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
		overflow: visible;
	}
	circle {
		fill: none;
		stroke-width: 9;
	}
	.track {
		stroke: color-mix(in oklab, var(--tone) 14%, var(--surface-2));
	}
	.arc {
		stroke: var(--tone);
		stroke-linecap: round;
		filter: drop-shadow(0 0 4px color-mix(in oklab, var(--tone) 35%, transparent));
		transition: stroke-dashoffset 900ms var(--ease);
	}
	.arc.empty {
		stroke-opacity: 0;
	}
	.figure {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		grid-auto-flow: column;
		align-content: center;
		justify-content: center;
		color: var(--text);
	}
	.figure strong {
		font-size: 1.5rem;
		font-weight: 680;
		letter-spacing: -0.04em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.unit {
		align-self: start;
		margin-top: 0.15rem;
		margin-left: 1px;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-2);
	}
	.caption {
		display: grid;
		gap: 2px;
		justify-items: start;
		min-width: 0;
	}
	@container (min-width: 26rem) {
		.ring-meter {
			flex-direction: column;
			gap: var(--space-3);
			text-align: center;
		}
		.ring {
			width: 6.75rem;
			height: 6.75rem;
		}
		.caption {
			justify-items: center;
		}
	}
	.label {
		font-weight: 600;
		color: var(--text);
		line-height: 1.3;
	}
	.count {
		display: inline-flex;
		align-items: center;
		min-height: 1.25rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.hint {
		max-width: 14rem;
		margin-top: var(--space-1);
		color: var(--text-3);
		font-size: var(--text-xs);
		line-height: 1.45;
	}
	.skeleton {
		display: block;
		width: 2.75rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.skeleton.line {
		width: 3.5rem;
		height: 0.75rem;
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.arc {
			transition: none;
		}
		.skeleton {
			animation: none;
		}
	}
</style>
