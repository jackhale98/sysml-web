<script lang="ts">
	import { ArrowDown, ArrowUp, Award, Info } from '@lucide/svelte';
	import type { Evaluated, TradeStudy } from '#lib/engine/types.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { viewTitle } from './views.ts';

	/**
	 * A trade study compared: on a wide screen a column per alternative and
	 * a row per criterion, with the score as a bar; on a phone a card per
	 * alternative, best first. The alternative the objective selects and the
	 * one the design uses are labelled, the best value of each criterion the
	 * score weighs is marked. Names open their element.
	 */
	let {
		trade,
		workspace,
		ui,
		name
	}: { trade: TradeStudy; workspace: Workspace; ui: WorkbenchUi; name: string } = $props();

	const alternatives = $derived(trade.alternatives);
	const n = $derived(alternatives.length);
	const selected = $derived(trade.selected);
	const current = $derived(trade.current);
	/** Phones list the alternatives best first (unscored last, in the study's order). */
	const ranked = $derived(
		alternatives
			.map((a, i) => ({ a, i }))
			.toSorted((x, y) => (x.a.rank ?? Infinity) - (y.a.rank ?? Infinity))
			.map((x) => x.i)
	);
	const scores = $derived(
		alternatives.map((a) => (a.score.kind === 'number' ? a.score.value : null))
	);
	const top = $derived(Math.max(0, ...scores.map((s) => s ?? 0)));
	const weighted = $derived(trade.criteria.some((c) => c.weight !== null));
	const totalWeight = $derived(trade.criteria.reduce((sum, c) => sum + (c.weight ?? 0), 0));

	/** The element under the selection, to highlight its row or column. */
	const selectedId = $derived(
		workspace.elements.find((e) => e.key === ui.selection?.key)?.id ?? null
	);

	function open(id: string | null) {
		const element = id ? workspace.elements.find((e) => e.id === id) : undefined;
		if (element) ui.select(element.key, 'table');
	}

	const percent = (w: number) => `${Math.round(w * 100)} %`;
	const scoreText = (i: number) => {
		const s = scores[i] ?? null;
		return s === null ? '—' : s.toFixed(2);
	};
	/** A bar's share of the best score (0 for none or a negative score). */
	const share = (s: number | null) => (s === null || top <= 0 ? 0 : Math.max(0, s / top));
	const clamp = (x: number | null) => (x === null ? 0 : Math.max(0, Math.min(1, x)));
	const reason = (v: Evaluated | undefined) => (v?.kind === 'undecided' ? v.reason : undefined);
	const ordinal = (k: number) => `${k} of ${n}`;

	const goalText = $derived(
		trade.objective === 'minimize' ? 'the lowest score' : 'the highest score'
	);
</script>

{#snippet value(c: TradeStudy['criteria'][number], i: number)}
	{@const shown = c.shown[i] ?? ''}
	{@const why = reason(c.values[i])}
	{#if shown}
		<span class="figure">{shown}</span>
		{#if c.best.includes(i)}
			<span class="best" title="Best {viewTitle(c.name).toLowerCase()}"
				><span aria-hidden="true">●</span><span class="visually-hidden">(best)</span></span
			>
		{/if}
	{:else}
		<span class="none" title={why ?? 'No value'}
			>—<Info size={12} aria-hidden="true" /><span class="visually-hidden">{why ?? 'no value'}</span
			></span
		>
	{/if}
{/snippet}

{#snippet tags(i: number)}
	{#if i === selected}
		<span class="tag pick"><Award size={12} aria-hidden="true" /> Selected</span>
	{/if}
	{#if i === current}
		<span class="tag design">In the design</span>
	{/if}
{/snippet}

<div class="trade" class:phone={ui.phone} class:cards-scroll={ui.phone} data-table={name}>
	<div class="verdict" aria-live="polite">
		{#if selected !== null}
			<p class="lead">
				<Award size={16} aria-hidden="true" />
				<span
					><strong class="mono">{alternatives[selected]!.name}</strong> is selected: it has {goalText},
					{scoreText(selected)}.</span
				>
			</p>
			{#if current === selected}
				<p class="sub">The design already uses it.</p>
			{:else if current !== null}
				<p class="sub">
					The design uses <strong class="mono">{alternatives[current]!.name}</strong> today: ranked {ordinal(
						alternatives[current]!.rank ?? n
					)}, score {scoreText(current)}.
				</p>
			{/if}
		{:else}
			<p class="lead muted">
				<Info size={16} aria-hidden="true" />
				<span>{trade.note ?? 'Nothing is selected yet.'}</span>
			</p>
		{/if}
	</div>

	{#if ui.phone}
		<ul class="cards" aria-label="Alternatives, best first">
			{#each ranked as i (i)}
				{@const a = alternatives[i]!}
				<li
					class="card"
					data-row={i}
					class:selected={i === selected}
					class:focused={!!selectedId && a.elementId === selectedId}
				>
					<div class="card-head">
						{#if a.rank !== null}<span class="rank" aria-label="Rank {ordinal(a.rank)}"
								>#{a.rank}</span
							>{/if}
						<button type="button" class="alt" onclick={() => open(a.elementId)}>{a.name}</button>
						{@render tags(i)}
					</div>
					<div class="score-line">
						<span class="bar" aria-hidden="true"
							><span style:width="{Math.round(share(scores[i] ?? null) * 100)}%"></span></span
						>
						<strong>{scoreText(i)}</strong><span class="unit">score</span>
					</div>
					<dl>
						{#each trade.criteria as c (c.name)}
							<div class="pair" class:unscored={c.weight === null && c.better === null}>
								<dt>
									{viewTitle(c.name)}{#if c.weight !== null}<span class="w"
											>{percent(c.weight)}</span
										>{/if}
								</dt>
								<dd>{@render value(c, i)}</dd>
							</div>
						{/each}
					</dl>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="scroll">
			<table aria-label="{viewTitle(trade.name)}: criteria by alternative">
				<thead>
					<tr>
						<th scope="col" class="corner"><span class="th">Criterion</span></th>
						{#if weighted}<th scope="col" class="w-col"><span class="th">Weight</span></th>{/if}
						{#each alternatives as a, i (i)}
							<th
								scope="col"
								class="alt-col"
								class:selected={i === selected}
								class:focused={!!selectedId && a.elementId === selectedId}
							>
								<div class="alt-head">
									<button
										type="button"
										class="alt"
										title={a.doc ?? a.label}
										onclick={() => open(a.elementId)}>{a.name}</button
									>
									<span class="meta">
										{#if a.rank !== null}<span class="rank" title="Rank {ordinal(a.rank)}"
												><span class="visually-hidden">Rank </span>#{a.rank}</span
											>{/if}
										{@render tags(i)}
									</span>
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each trade.criteria as c (c.name)}
						<tr
							class:unscored={c.weight === null && c.better === null}
							class:focused={!!selectedId && c.elementId === selectedId}
						>
							<th scope="row">
								<button
									type="button"
									class="crit"
									title={c.doc ?? undefined}
									onclick={() => open(c.elementId)}>{viewTitle(c.name)}</button
								>
								{#if c.better}
									<span class="better">
										{#if c.better === 'higher'}<ArrowUp
												size={11}
												aria-hidden="true"
											/>{:else}<ArrowDown size={11} aria-hidden="true" />{/if}{c.better} is better
									</span>
								{/if}
							</th>
							{#if weighted}<td class="w-col">{c.weight !== null ? percent(c.weight) : ''}</td>{/if}
							{#each alternatives, i (i)}
								<td class="num" class:selected={i === selected}>
									{@render value(c, i)}
									{#if c.scores && c.scores[i] !== null}
										<span
											class="mini"
											title="Scores {c.scores[i]!.toFixed(2)} on this criterion"
											aria-hidden="true"
											><span style:width="{Math.round(clamp(c.scores[i]!) * 100)}%"></span></span
										>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
					<tr class="score-row">
						<th scope="row"><span class="crit-static">Score</span></th>
						{#if weighted}<td class="w-col">{totalWeight ? percent(totalWeight) : ''}</td>{/if}
						{#each alternatives as a, i (i)}
							<td class="num" class:selected={i === selected}>
								{#if a.score.kind === 'number'}
									<span class="score">
										<span class="bar" aria-hidden="true"
											><span style:width="{Math.round(share(scores[i] ?? null) * 100)}%"
											></span></span
										>
										<strong>{scoreText(i)}</strong>
									</span>
								{:else}
									<span class="none" title={reason(a.score) ?? 'No score'}
										>—<Info size={12} aria-hidden="true" /><span class="visually-hidden"
											>{reason(a.score) ?? 'no score'}</span
										></span
									>
								{/if}
							</td>
						{/each}
					</tr>
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.trade {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 0;
		padding: 0 var(--space-5) var(--space-5);
	}
	.verdict {
		display: grid;
		gap: 2px;
	}
	.lead {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		color: var(--text);
	}
	.lead :global(svg) {
		flex: none;
		margin-top: 0.15rem;
		color: var(--accent);
	}
	.lead.muted,
	.lead.muted :global(svg) {
		color: var(--text-2);
	}
	.sub {
		padding-left: calc(16px + var(--space-2));
		color: var(--text-2);
	}
	.mono,
	.alt {
		font-family: var(--font-mono);
	}

	.scroll {
		flex: 0 1 auto;
		min-height: 0;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}
	th,
	td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: middle;
	}
	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--surface-2);
		vertical-align: bottom;
	}
	.th {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
	}
	/* The criteria stay put while the alternatives scroll sideways. */
	th:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--surface);
		box-shadow: inset -1px 0 0 var(--border);
	}
	thead th:first-child {
		z-index: 2;
		background: var(--surface-2);
	}
	tbody tr:last-child > * {
		border-bottom: 0;
	}
	.alt-col {
		min-width: 8.5rem;
		text-align: right;
	}
	.alt-head {
		display: grid;
		justify-items: end;
		gap: 4px;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: 4px;
	}
	.alt,
	.crit {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		text-align: inherit;
		cursor: pointer;
	}
	.alt:hover,
	.crit:hover {
		text-decoration: underline;
	}
	.crit {
		font-family: inherit;
		color: var(--text);
	}
	.crit:hover {
		color: var(--accent);
	}
	.crit-static {
		font-weight: 650;
	}
	.better {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-top: 1px;
		color: var(--text-3);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.rank {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 0 7px;
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.5;
		white-space: nowrap;
	}
	.tag.pick {
		background: var(--accent);
		color: var(--accent-text);
	}
	.tag.design {
		border: 1px solid var(--border-strong);
		color: var(--text-2);
	}
	td.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}
	.w-col {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}
	/* The selected alternative's column, tinted top to bottom. */
	.selected {
		background: color-mix(in oklab, var(--accent-weak) 70%, var(--surface));
	}
	thead th.selected {
		background: color-mix(in oklab, var(--accent-weak) 85%, var(--surface-2));
	}
	tr.focused > *,
	th.focused {
		box-shadow: inset 0 -2px 0 var(--accent);
	}
	/* Values worked out on the way that the score doesn't weigh. */
	tr.unscored .crit,
	tr.unscored td {
		color: var(--text-2);
	}
	.best {
		margin-left: 4px;
		color: var(--ok);
		font-size: 0.6rem;
		vertical-align: 0.15em;
	}
	.mini {
		display: block;
		width: 3.5rem;
		height: 3px;
		margin: 4px 0 0 auto;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	.mini span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: color-mix(in oklab, var(--accent) 45%, var(--surface));
	}
	.score-row > * {
		border-top: 1px solid var(--border-strong);
		background: color-mix(in oklab, var(--surface-2) 55%, var(--surface));
	}
	.score-row td.selected {
		background: color-mix(in oklab, var(--accent-weak) 85%, var(--surface));
	}
	.score {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.score strong {
		min-width: 2.25rem;
		font-weight: 650;
	}
	.bar {
		display: block;
		width: 4rem;
		height: 0.45rem;
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
	.selected .bar span,
	.card.selected .bar span {
		background: var(--accent);
	}
	.none {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-3);
		cursor: help;
	}

	/* Phones: a card per alternative, best first. */
	.phone {
		padding: 0 var(--space-3) calc(6rem + var(--sheet-cover, 0px));
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.cards {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		min-width: 0;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.card.selected {
		border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
		background: color-mix(in oklab, var(--accent-weak) 45%, var(--surface));
	}
	.card.focused {
		box-shadow: 0 0 0 2px var(--accent-weak);
	}
	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
	}
	.card-head .alt {
		min-height: 2.75rem;
		font-size: var(--text-md);
		overflow-wrap: anywhere;
	}
	.score-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
		font-variant-numeric: tabular-nums;
	}
	.score-line .bar {
		flex: 1;
		width: auto;
		max-width: 10rem;
	}
	.score-line strong {
		font-size: var(--text-lg);
		font-weight: 650;
	}
	.score-line .unit {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	dl {
		display: grid;
		gap: 0;
		margin: 0;
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(6rem, 45%) minmax(0, 1fr);
		gap: var(--space-2);
		padding: var(--space-1) 0;
		border-top: 1px solid var(--border);
	}
	dt {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		padding-top: 0.15rem;
	}
	dt .w {
		margin-left: var(--space-1);
		color: var(--text-3);
		font-weight: 500;
	}
	dd {
		min-width: 0;
		margin: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.pair.unscored dd {
		color: var(--text-2);
	}
</style>
