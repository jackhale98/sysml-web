<script lang="ts">
	import { CircleCheck, CircleQuestionMark, CircleX } from '@lucide/svelte';
	import type { CheckStatus } from '#lib/engine/types.ts';

	/**
	 * A check's verdict: colour, icon and word together, so it reads without
	 * colour too. `compact` drops the word where a column header already says
	 * what the chip is (the word stays for screen readers).
	 */
	let { status, compact = false }: { status: CheckStatus; compact?: boolean } = $props();

	const LABEL: Record<CheckStatus, string> = {
		satisfied: 'Satisfied',
		violated: 'Violated',
		undecided: 'Undecided'
	};
</script>

<span class="check {status}" class:compact title={compact ? LABEL[status] : undefined}>
	{#if status === 'satisfied'}<CircleCheck
			size={14}
			aria-hidden="true"
		/>{:else if status === 'violated'}<CircleX
			size={14}
			aria-hidden="true"
		/>{:else}<CircleQuestionMark size={14} aria-hidden="true" />{/if}
	<span class:visually-hidden={compact}>{LABEL[status]}</span>
</span>

<style>
	.check {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		padding: 0.1rem 0.55rem 0.1rem 0.4rem;
		border-radius: var(--radius-pill);
		background: var(--tone-weak);
		color: var(--tone);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.4;
		white-space: nowrap;
	}
	.check.compact {
		padding: 0.15rem;
	}
	.satisfied {
		--tone: var(--ok);
		--tone-weak: var(--ok-weak);
	}
	.violated {
		--tone: var(--danger);
		--tone-weak: var(--danger-weak);
	}
	.undecided {
		--tone: var(--muted);
		--tone-weak: var(--muted-weak);
	}
</style>
