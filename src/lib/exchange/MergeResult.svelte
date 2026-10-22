<script lang="ts">
	/**
	 * What a save that merged did: what came into the project from the server
	 * (and which files changed, and what was written again), and what went
	 * to the server in the new commit.
	 */
	import { ArrowDownToLine, ArrowUpFromLine, CircleCheck } from '@lucide/svelte';
	import type { MergeOutcome } from './sync';

	let { outcome }: { outcome: MergeOutcome } = $props();

	const uid = $props.id();
	const files = $derived(outcome.woven?.files ?? []);
	const count = (n: number, noun: string) =>
		`${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;
	const status = { changed: 'changed', added: 'new', removed: 'removed' } as const;
</script>

<div class="xc-stack" data-testid="merge-result">
	<p class="xc-note ok" role="status">
		<CircleCheck size={16} aria-hidden="true" />
		<span>
			{#if outcome.commit}
				Saved to {outcome.server}, branch {outcome.branch}: their changes are in this project, and
				yours are on the server on top of theirs.
			{:else}
				Their changes are in this project. Yours were on the server already: nothing more to send.
			{/if}
		</span>
	</p>

	<section class="xc-stack" aria-labelledby="{uid}-in">
		<h3 id="{uid}-in" class="heading">
			<ArrowDownToLine size={15} aria-hidden="true" /> Came in from the server
		</h3>
		{#if outcome.incoming.length}
			<ul class="xc-list" data-testid="merge-came-in">
				{#each outcome.incoming as line, i (i)}<li>{line}</li>{/each}
			</ul>
		{:else}
			<p class="xc-muted">Nothing new for this project.</p>
		{/if}
		{#if files.length}
			<p class="xc-muted">
				Files: {files.map((f) => `${f.path} (${status[f.status]})`).join(', ')}.
				{#if outcome.woven?.rewritten.length}
					Written again from the server’s version: {outcome.woven.rewritten
						.map(
							(r) =>
								`${r.element ?? `all of ${r.path}`}${r.notes ? ` (${count(r.notes, 'note')} with // not kept)` : ''}`
						)
						.join(', ')}.
				{/if}
			</p>
		{/if}
	</section>

	<section class="xc-stack" aria-labelledby="{uid}-out">
		<h3 id="{uid}-out" class="heading">
			<ArrowUpFromLine size={15} aria-hidden="true" /> Sent to the server
		</h3>
		{#if outcome.commit}
			<ul class="xc-list" data-testid="merge-sent">
				{#each outcome.outgoing as line, i (i)}<li>{line}</li>{/each}
			</ul>
			<p class="xc-muted">
				One commit, “{outcome.commit.description}”, with {count(
					outcome.commit.changes,
					'element change'
				)}.
			</p>
		{:else}
			<p class="xc-muted">Nothing: the server has everything this project has.</p>
		{/if}
	</section>
</div>

<style>
	.heading {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		font-size: var(--text-sm);
	}
</style>
