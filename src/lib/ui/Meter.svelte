<script lang="ts">
	/** A labelled proportion bar, e.g. requirements verified. */
	let {
		value,
		total,
		label,
		tone = 'ok'
	}: { value: number; total: number; label: string; tone?: 'ok' | 'info' | 'warn' } = $props();

	const percent = $derived(total === 0 ? 0 : Math.round((value / total) * 100));
</script>

<div class="meter">
	<div class="head">
		<span class="label">{label}</span>
		<span class="figure"><strong>{percent}%</strong> <span>{value} of {total}</span></span>
	</div>
	<div
		class="track"
		role="meter"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={total}
		aria-valuenow={value}
	>
		<div class="fill {tone}" style:width="{percent}%"></div>
	</div>
</div>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}
	.label {
		color: var(--text-2);
		min-width: 0;
	}
	.figure {
		white-space: nowrap;
	}
	.figure span {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.track {
		height: 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: inherit;
		transition: width 400ms var(--ease);
	}
	.ok {
		background: var(--ok);
	}
	.info {
		background: var(--info);
	}
	.warn {
		background: var(--warn);
	}
</style>
