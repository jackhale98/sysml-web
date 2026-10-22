<script lang="ts">
	/**
	 * What changed in the model, briefly, where changes are saved: the first
	 * few changes in plain language (what they do to the requirement checks
	 * first), a way to the full review, and the summary for a commit message
	 * (`summary`, bound by the host).
	 */
	import { GitCompareArrows, LoaderCircle } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { isModelFile } from '#lib/project/workspace.svelte.ts';
	import { summarize, type ReviewItem, type ReviewSummary } from './summary.ts';

	let {
		engine,
		base,
		current,
		onreview,
		summary = $bindable(null)
	}: {
		engine: Engine;
		/** Path → text of the version compared with, and of the version now. */
		base: Record<string, string>;
		current: Record<string, string>;
		onreview?: () => void;
		summary?: ReviewSummary | null;
	} = $props();

	const uid = $props.id();
	const SHOWN = 5;
	let failed = $state(false);
	let generation = 0;

	const list = (files: Record<string, string>) =>
		Object.keys(files)
			.filter(isModelFile)
			.sort()
			.map((path) => ({ path, text: files[path]! }));

	$effect(() => {
		const before = list(base);
		const now = list(current);
		const run = ++generation;
		const timer = setTimeout(async () => {
			try {
				const comparison = await engine.compareModels(before, now);
				if (run !== generation) return;
				summary = summarize(comparison.diff);
				failed = false;
			} catch {
				if (run === generation) failed = true;
			}
		}, 150);
		return () => clearTimeout(timer);
	});

	const items: ReviewItem[] = $derived(
		summary
			? [
					...summary.impact.filter((i) => i.tone === 'fails' || i.tone === 'meets'),
					...summary.groups.flatMap((g) => g.items)
				]
			: []
	);
	const TONE: Record<ReviewItem['tone'], string> = {
		added: 'added',
		removed: 'removed',
		changed: 'changed',
		renamed: 'changed',
		moved: 'changed',
		fails: 'removed',
		meets: 'added',
		impact: 'impact'
	};
</script>

{#snippet rich(text: string)}{#each text.split('`') as part, i (i)}{#if i % 2}<code>{part}</code
			>{:else}{part}{/if}{/each}{/snippet}

<section class="summary" aria-labelledby="{uid}-title" aria-busy={!summary && !failed}>
	<h4 id="{uid}-title">In the model</h4>
	{#if failed}
		<p class="muted">The model couldn't be compared; the file changes are below.</p>
	{:else if !summary}
		<p class="muted">
			<LoaderCircle size={14} class="spin" aria-hidden="true" /> Reading the changes…
		</p>
	{:else if summary.empty}
		<p class="muted">No change to the model itself: only comments or layout changed.</p>
	{:else}
		<ul>
			{#each items.slice(0, SHOWN) as item (item.key)}
				<li>
					<span class="badge {TONE[item.tone]}">{item.badge}</span>
					<span class="text">{@render rich(item.text)}</span>
				</li>
			{/each}
		</ul>
		{#if items.length > SHOWN}
			<p class="muted small">and {items.length - SHOWN} more</p>
		{/if}
		{#if onreview}
			<button type="button" class="review" onclick={onreview}>
				<GitCompareArrows size={15} aria-hidden="true" /> Review all changes
			</button>
		{/if}
	{/if}
</section>

<style>
	.summary {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	h4 {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		font-size: var(--text-sm);
		line-height: 1.45;
	}
	.text {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	code {
		padding: 0 3px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.badge {
		flex: none;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		font-size: 10.5px;
		font-weight: 700;
		white-space: nowrap;
	}
	.badge.added {
		background: var(--ok-weak);
		color: var(--ok);
	}
	.badge.removed {
		background: var(--danger-weak);
		color: var(--danger);
	}
	.badge.changed {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.badge.impact {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.muted {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.small {
		font-size: var(--text-xs);
	}
	.review {
		display: inline-flex;
		justify-self: start;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.review:hover {
		background: var(--surface-hover);
	}
</style>
