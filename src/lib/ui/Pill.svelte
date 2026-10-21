<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Tone } from '#lib/project/status.ts';

	let { tone = 'muted', children }: { tone?: Tone; children: Snippet } = $props();
</script>

<span class="pill {tone}"><span class="dot" aria-hidden="true"></span>{@render children()}</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.1rem 0.55rem 0.1rem 0.45rem;
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 550;
		white-space: nowrap;
		background: var(--tone-weak);
		color: var(--tone);
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: currentColor;
	}
	.ok {
		--tone: var(--ok);
		--tone-weak: var(--ok-weak);
	}
	.warn {
		--tone: var(--warn);
		--tone-weak: var(--warn-weak);
	}
	.danger {
		--tone: var(--danger);
		--tone-weak: var(--danger-weak);
	}
	.info {
		--tone: var(--info);
		--tone-weak: var(--info-weak);
	}
	.muted {
		--tone: var(--muted);
		--tone-weak: var(--muted-weak);
	}
	.muted .dot {
		background: transparent;
		border: 1.5px solid currentColor;
	}
</style>
