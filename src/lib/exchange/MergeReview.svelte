<script lang="ts">
	/**
	 * The review of a save that merges (`merge.ts`): what others saved since
	 * this project was opened from the server (it comes into the project),
	 * what this project changed (it goes to the server), and where both
	 * changed the same element: "Keep mine" or "Keep theirs", one by one or
	 * all at once. Says what the merge can't carry (notes and layout inside a
	 * declaration that is written again) before anything is written.
	 */
	import { ArrowDownToLine, ArrowUpFromLine, GitMerge, TriangleAlert } from '@lucide/svelte';
	import { changeLine, choiceHint, type Side } from './merge';
	import type { MergeSave } from './sync';
	import type { WeaveResult } from './types';

	let {
		save,
		choices = $bindable(),
		woven = null,
		branch
	}: {
		save: MergeSave;
		choices: Record<string, Side>;
		/** The text the chosen merge writes, when it needs a second look. */
		woven?: WeaveResult | null;
		branch: string;
	} = $props();

	const uid = $props.id();
	const plan = $derived(save.plan);
	const undecided = $derived(plan.conflicts.filter((c) => !choices[c.id]).length);
	/** The text the merge writes: as chosen (after a first try), else with every conflict kept as mine. */
	const written = $derived(woven ?? save.preview);
	const rewritten = $derived(written?.rewritten ?? []);
	const differences = $derived(written?.differences ?? []);

	function all(side: Side) {
		choices = Object.fromEntries(plan.conflicts.map((c) => [c.id, side]));
	}

	const count = (n: number, noun: string) =>
		`${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;
	const lost = (r: { element: string | null; path: string; notes: number }) =>
		`${r.element ?? `all of ${r.path}`}${r.element ? ` in ${r.path}` : ''}${
			r.notes
				? ` (${count(r.notes, 'note')} written with // in it ${r.notes === 1 ? 'goes' : 'go'})`
				: ''
		}`;
</script>

<div class="xc-stack review" data-testid="merge-review">
	<p class="xc-note" role="status">
		<GitMerge size={16} aria-hidden="true" />
		<span
			>Someone saved to <strong>{branch}</strong> since this project was opened from the server (or last
			saved to it). Their changes come into this project; yours go to the server on top of theirs.</span
		>
	</p>

	{#if plan.conflicts.length}
		<section class="xc-stack" aria-labelledby="{uid}-conflicts" data-testid="merge-conflicts">
			<div class="heading-row">
				<h3 id="{uid}-conflicts" class="heading">
					Changed on both sides ({plan.conflicts.length})
				</h3>
				<div class="all">
					<button type="button" class="xc-button xc-small" onclick={() => all('mine')}
						>Keep all mine</button
					>
					<button type="button" class="xc-button xc-small" onclick={() => all('theirs')}
						>Keep all theirs</button
					>
				</div>
			</div>
			<p class="xc-muted">
				You and they changed these differently. Choose which version each keeps; nothing is written
				until you save.
			</p>
			<ul class="conflicts">
				{#each plan.conflicts as c (c.id)}
					<li class="conflict" data-testid="merge-conflict">
						<fieldset>
							<legend>
								<strong>{c.what}</strong>{#if c.where && c.where !== c.what}<span class="where"
										>{c.where}</span
									>{/if}
							</legend>
							<dl class="sides">
								<dt>Yours</dt>
								<dd>{c.mine.join('; ')}</dd>
								<dt>Theirs</dt>
								<dd>{c.theirs.join('; ')}</dd>
							</dl>
							<div class="choices">
								{#each ['mine', 'theirs'] as const as side (side)}
									<label class="xc-option compact">
										<input
											type="radio"
											name="{uid}-{c.id}"
											value={side}
											checked={choices[c.id] === side}
											onchange={() => (choices = { ...choices, [c.id]: side })}
										/>
										<strong>{side === 'mine' ? 'Keep mine' : 'Keep theirs'}</strong>
										<span>{choiceHint(c, side)}</span>
									</label>
								{/each}
							</div>
						</fieldset>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="xc-stack" aria-labelledby="{uid}-in">
		<h3 id="{uid}-in" class="heading">
			<ArrowDownToLine size={15} aria-hidden="true" /> From the server ({plan.incoming.length})
		</h3>
		{#if plan.incoming.length}
			<ul class="xc-list" data-testid="merge-incoming">
				{#each plan.incoming as change, i (i)}<li>{changeLine(change)}</li>{/each}
			</ul>
		{:else}
			<p class="xc-muted">
				{plan.conflicts.length
					? 'Nothing besides the elements above.'
					: 'Nothing new: what they changed, you changed the same way.'}
			</p>
		{/if}
	</section>

	<section class="xc-stack" aria-labelledby="{uid}-out">
		<h3 id="{uid}-out" class="heading">
			<ArrowUpFromLine size={15} aria-hidden="true" /> From this project ({plan.outgoing.length})
		</h3>
		{#if plan.outgoing.length}
			<ul class="xc-list" data-testid="merge-outgoing">
				{#each plan.outgoing as change, i (i)}<li>{changeLine(change)}</li>{/each}
			</ul>
		{:else}
			<p class="xc-muted">
				{plan.conflicts.length
					? 'Nothing besides the elements above.'
					: 'Nothing: the server has every change this project made.'}
			</p>
		{/if}
	</section>

	{#if differences.length}
		<div class="xc-note warn" role="alert" data-testid="merge-differences">
			<TriangleAlert size={16} aria-hidden="true" />
			<div>
				<p>
					Some of what the server has can’t be written into your text exactly. Saving sends your
					text as it then is, so the server’s version of these is replaced:
				</p>
				<ul>
					{#each differences.slice(0, 8) as d, i (i)}<li>{d}</li>{/each}
					{#if differences.length > 8}<li>and {differences.length - 8} more</li>{/if}
				</ul>
			</div>
		</div>
	{/if}

	{#if plan.incoming.length || plan.conflicts.length}
		<div class="xc-note" data-testid="merge-limits">
			<TriangleAlert size={16} aria-hidden="true" />
			<div>
				<p>
					The server holds the model, not your text, so the merge is made element by element. Your
					files stay as you wrote them, except where their changes go in: a new element is added
					where it belongs, and an element they changed is written again as the formatter writes it.
					Notes written with <code>//</code>, blank lines and layout inside it don’t come through.
				</p>
				{#if rewritten.length}
					<p>
						{woven
							? 'Written again:'
							: 'Their changes write these again (keeping theirs above may add more):'}
					</p>
					<ul data-testid="merge-rewritten">
						{#each rewritten as r, i (i)}<li>{lost(r)}</li>{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}

	{#if undecided}
		<p class="xc-muted" role="status">
			{undecided === 1 ? 'One element waits' : `${undecided} elements wait`} for your choice.
		</p>
	{/if}
</div>

<style>
	.heading {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		font-size: var(--text-sm);
	}
	.heading-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		justify-content: space-between;
	}
	.all {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.conflicts {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.conflict fieldset {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
	}
	.conflict legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
		align-items: baseline;
		padding: 0 var(--space-1);
		overflow-wrap: anywhere;
	}
	.where {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.sides {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}
	.sides dt {
		color: var(--text-2);
		font-weight: 600;
	}
	.sides dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.choices {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.compact {
		padding: var(--space-2) var(--space-3);
	}
	.review :global(.xc-note p) {
		margin: 0 0 var(--space-1);
	}
	.review :global(.xc-note ul) {
		margin: 0;
		padding-left: 1.2em;
	}
	@media (max-width: 520px) {
		.choices {
			grid-template-columns: 1fr;
		}
	}
</style>
