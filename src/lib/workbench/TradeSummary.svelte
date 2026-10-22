<script lang="ts">
	import { Award, Table2 } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { TradeStudy } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { viewTitle } from './views.ts';

	/**
	 * The inspector's summary of a trade study: what its objective selects,
	 * each alternative's score (best first), and a way to the table that
	 * compares them. Nothing shows for an analysis that isn't a trade study.
	 */
	let {
		element,
		workspace,
		ui,
		engine
	}: { element: ModelElement; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	let study = $state.raw<TradeStudy | null>(null);
	let generation = 0;
	$effect(() => {
		const current = ++generation;
		const id = element.id;
		void workspace.files;
		void engine
			.tradeStudies(workspace.sourceFiles())
			.then((studies) => {
				if (current === generation) study = studies.find((s) => s.elementId === id) ?? null;
			})
			.catch(() => {
				if (current === generation) study = null;
			});
	});

	const ranked = $derived(
		study
			? study.alternatives
					.map((a, i) => ({ a, i }))
					.toSorted((x, y) => (x.a.rank ?? Infinity) - (y.a.rank ?? Infinity))
			: []
	);
	const top = $derived(
		Math.max(
			0,
			...(study?.alternatives ?? []).map((a) => (a.score.kind === 'number' ? a.score.value : 0))
		)
	);
	/** A table view that shows this study, if the model has one. */
	const view = $derived(
		study
			? workspace.views.find(
					(v) =>
						v.isUsage &&
						v.definition === 'TradeStudyTable' &&
						(v.exposes ?? []).some(
							(e) => e === study!.qualifiedName || study!.qualifiedName.endsWith(`::${e}`)
						)
				)
			: undefined
	);
	const score = (s: TradeStudy['alternatives'][number]['score']) =>
		s.kind === 'number' ? s.value.toFixed(2) : '—';
</script>

{#if study}
	<section class="trade" aria-label="Trade study result">
		<h3>Trade study</h3>
		{#if study.selected !== null}
			<p class="pick">
				<Award size={14} aria-hidden="true" />
				<span
					><strong class="mono">{study.alternatives[study.selected]!.name}</strong> is selected ({study.objective ===
					'minimize'
						? 'lowest'
						: 'highest'} score){#if study.current === study.selected}; the design uses it{/if}.</span
				>
			</p>
		{:else if study.note}
			<p class="note">{study.note}</p>
		{/if}
		<ol class="scores">
			{#each ranked as { a, i } (i)}
				<li class:selected={i === study.selected}>
					<span class="name"
						><span class="mono">{a.name}</span>
						{#if i === study.current}<span class="tag">in the design</span>{/if}</span
					>
					<span class="bar" aria-hidden="true"
						><span
							style:width="{a.score.kind === 'number' && top > 0
								? Math.round(Math.max(0, a.score.value / top) * 100)
								: 0}%"
						></span></span
					>
					<span class="value">{score(a.score)}</span>
				</li>
			{/each}
		</ol>
		{#if view}
			<button
				type="button"
				class="link"
				onclick={() => ui.open({ kind: 'view', name: view.name, title: viewTitle(view.name) })}
			>
				<Table2 size={13} /> Compare in {viewTitle(view.name)}
			</button>
		{/if}
	</section>
{/if}

<style>
	.trade {
		display: grid;
		gap: var(--space-2);
	}
	/* As the inspector's other headings. */
	h3 {
		margin: 0;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	.pick {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin: 0;
	}
	.pick :global(svg) {
		flex: none;
		margin-top: 0.2rem;
		color: var(--accent);
	}
	.note {
		margin: 0;
		color: var(--text-2);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}
	.scores {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	.scores li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 3.5rem 2.25rem;
		align-items: center;
		gap: var(--space-2);
		padding: 2px 0;
	}
	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px var(--space-2);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.selected .name {
		font-weight: 650;
	}
	.tag {
		padding: 0 6px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		color: var(--text-2);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.bar {
		display: block;
		height: 0.4rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: color-mix(in oklab, var(--text-3) 55%, var(--surface));
	}
	.selected .bar span {
		background: var(--accent);
	}
	.value {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		justify-self: start;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
