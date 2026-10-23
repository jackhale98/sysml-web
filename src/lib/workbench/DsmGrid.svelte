<script lang="ts">
	import { tick } from 'svelte';
	import { Plus, TriangleAlert, Zap } from '@lucide/svelte';
	import type { DependencyMatrix, MatrixLink } from '#lib/engine/types.ts';
	import { KIND_WORDS, cellMarks, itemLabel, itemPathLabel, kindCount, passes } from './dsm.ts';
	import { humanize } from './traceGrid.ts';

	/**
	 * The square grid of a dependency matrix: the elements down the side,
	 * numbered, and across the top in the same order; the element itself on
	 * the diagonal; in each other cell a mark per kind of link from the row
	 * to the column (or, for an N² chart, what passes). Suggested modules are
	 * outlined on the diagonal with their name beside them; what a change
	 * reaches is shaded. One cell takes the Tab key; the arrow keys move
	 * between cells.
	 */
	let {
		matrix,
		order,
		modules,
		cells,
		impact,
		impactFrom,
		untyped,
		unlinked,
		selectedIndex,
		picked,
		name,
		touch = false,
		onhot,
		onpick,
		onimpact,
		onselect
	}: {
		matrix: DependencyMatrix;
		/** The items in the order shown. */
		order: number[];
		modules: number[][];
		cells: Map<string, MatrixLink[]>;
		impact: Map<number, number> | null;
		impactFrom: number | null;
		untyped: MatrixLink[];
		unlinked: number[];
		/** The item the inspector shows. */
		selectedIndex: number | null;
		picked: { row: number; column: number } | null;
		/** The view, for `data-table`. */
		name: string;
		/** Larger cells for fingers. */
		touch?: boolean;
		onhot: (cell: { row: number; column: number } | null) => void;
		onpick: (row: number, column: number) => void;
		onimpact: (item: number) => void;
		onselect: (item: number) => void;
	} = $props();

	const names = $derived(matrix.cells === 'names');
	/** Each item's number, as shown (1 for the first row). */
	const numberOf = $derived(new Map(order.map((item, i) => [item, i + 1])));
	/** Each item's module (its index), or -1. */
	const moduleOf = $derived.by(() => {
		const out = matrix.items.map(() => -1);
		modules.forEach((m, k) => m.forEach((i) => (out[i] = k)));
		return out;
	});
	const clustered = $derived(modules.length > 0);
	/** Where each row's module starts (a cell spanning its rows names it). */
	const moduleStart = $derived(
		order.map((item, k) => moduleOf[item]! >= 0 && moduleOf[order[k - 1] ?? -1] !== moduleOf[item])
	);
	const unlinkedSet = $derived(new Set(unlinked));
	const untypedSet = $derived(new Set(untyped));

	/** The edges of a module's block, for a cell in it: which sides to outline. */
	function blockEdges(r: number, c: number, k: number, j: number) {
		const mod = moduleOf[r]!;
		if (mod < 0 || moduleOf[c] !== mod) return '';
		const edges: string[] = ['in-module'];
		if (moduleOf[order[k - 1] ?? -1] !== mod) edges.push('top');
		if (moduleOf[order[k + 1] ?? -1] !== mod) edges.push('bottom');
		if (moduleOf[order[j - 1] ?? -1] !== mod) edges.push('left');
		if (moduleOf[order[j + 1] ?? -1] !== mod) edges.push('right');
		return edges.join(' ');
	}

	/** How a change reaches an item: the start, directly, through others. */
	function reach(item: number): 'start' | 'direct' | 'indirect' | null {
		if (impactFrom === item) return 'start';
		const d = impact?.get(item);
		return d === undefined ? null : d === 1 ? 'direct' : 'indirect';
	}

	/** A cell's accessible name, which starts with what it shows (the number on the diagonal, an N² cell's names). */
	function cellLabel(r: number, c: number, links: MatrixLink[], k: number): string {
		const from = itemLabel(matrix.items[r]!);
		const to = itemLabel(matrix.items[c]!);
		if (r === c)
			return names ? `${from}, itself: its details` : `${k + 1} ${from}, itself: its details`;
		if (links.length && names) return `From ${from} to ${to}: ${namesIn(r, links).join(', ')}`;
		if (!links.length) return `No link from ${from} to ${to}`;
		const what = cellMarks(links)
			.map((m) => kindCount(m.kind, m.count))
			.join(', ');
		return `From ${from} to ${to}: ${what}`;
	}

	/** An N² cell's text: the interfaces, then the items that pass. */
	function namesIn(r: number, links: MatrixLink[]): string[] {
		const out = links.flatMap((l) => [
			...(l.kind === 'connection' && l.definition ? [humanize(l.definition)] : []),
			...passes(l, r),
			...(l.kind !== 'connection' && l.kind !== 'flow' ? [KIND_WORDS[l.kind].label] : [])
		]);
		return [...new Set(out)];
	}

	// --- The crosshair, and moving between cells with the keyboard ----------------------

	let hot = $state<{ row: number | null; column: number | null }>({ row: null, column: null });
	/** The cell that takes the Tab key, by position in the order. */
	let focusAt = $state({ k: 0, j: 1 });
	let table = $state<HTMLTableElement | null>(null);

	function track(event: Event) {
		const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-r], [data-c]');
		const r = cell?.dataset.r;
		const c = cell?.dataset.c;
		hot = {
			row: r === undefined ? null : Number(r),
			column: c === undefined ? null : Number(c)
		};
		onhot(hot.row !== null && hot.column !== null ? { row: hot.row, column: hot.column } : null);
	}
	function cool() {
		hot = { row: null, column: null };
		onhot(null);
	}

	async function move(event: KeyboardEvent) {
		const n = order.length;
		let { k, j } = focusAt;
		switch (event.key) {
			case 'ArrowUp':
				k = Math.max(0, k - 1);
				break;
			case 'ArrowDown':
				k = Math.min(n - 1, k + 1);
				break;
			case 'ArrowLeft':
				j = Math.max(0, j - 1);
				break;
			case 'ArrowRight':
				j = Math.min(n - 1, j + 1);
				break;
			case 'Home':
				j = 0;
				break;
			case 'End':
				j = n - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		focusAt = { k, j };
		await tick();
		table?.querySelector<HTMLButtonElement>(`button[data-k="${k}"][data-j="${j}"]`)?.focus();
	}

	// A new order (or fewer items): keep the Tab cell inside the grid.
	$effect(() => {
		const n = order.length;
		if (focusAt.k >= n || focusAt.j >= n) focusAt = { k: 0, j: Math.min(1, n - 1) };
	});
</script>

<div class="frame" class:touch class:names>
	<div class="scroll" data-table={name}>
		<table
			bind:this={table}
			class:clustered
			onpointerover={track}
			onpointerleave={cool}
			onfocusin={track}
			onfocusout={cool}
		>
			<caption class="visually-hidden">
				{matrix.elements === 'parts'
					? 'Parts'
					: matrix.elements === 'actions'
						? 'Steps'
						: 'Requirements'} down the side and across the top in the same order; each cell shows how
				the row's element leads to the column's.
			</caption>
			<thead>
				<tr>
					{#if clustered}<td class="band-head"></td>{/if}
					<th scope="col" class="corner">
						<span class="axis">To →</span>
						<span class="axis down">From ↓</span>
					</th>
					{#each order as c, j (c)}
						{@const item = matrix.items[c]!}
						<th
							scope="col"
							class="col"
							class:hot={hot.column === c}
							class:selected={selectedIndex === c}
							class:reach-start={reach(c) === 'start'}
							class:reach-direct={reach(c) === 'direct'}
							class:reach-indirect={reach(c) === 'indirect'}
							data-c={c}
							title={itemPathLabel(matrix, c)}
						>
							<button
								type="button"
								class="head"
								tabindex="-1"
								aria-label="{numberOf.get(c)} {itemPathLabel(matrix, c)}, select"
								onclick={() => onselect(c)}
							>
								<span class="num">{j + 1}</span>
								<span class="upright">{itemLabel(item)}</span>
							</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each order as r, k (r)}
					{@const item = matrix.items[r]!}
					{@const mod = moduleOf[r]!}
					<tr
						data-row={r}
						class:hot={hot.row === r}
						class:selected={selectedIndex === r}
						class:module-start={moduleStart[k]}
						class:reach-start={reach(r) === 'start'}
						class:reach-direct={reach(r) === 'direct'}
						class:reach-indirect={reach(r) === 'indirect'}
					>
						{#if clustered && moduleStart[k]}
							{@const size = modules[mod]!.length}
							<th scope="rowgroup" class="band" rowspan={size}>
								<span class="band-label">Suggested module {mod + 1}</span>
							</th>
						{:else if clustered && mod < 0}
							<td class="band none"></td>
						{/if}
						<th scope="row" class="name" data-r={r} title={itemPathLabel(matrix, r)}>
							<span class="name-line" style:--depth={item.depth}>
								<span class="num">{k + 1}</span>
								<button type="button" class="name-button" onclick={() => onselect(r)}
									>{itemLabel(item)}</button
								>
								{#if unlinkedSet.has(r)}<span class="flag">No links</span>{/if}
								{#if reach(r) === 'direct'}<span class="reach">directly</span
									>{:else if reach(r) === 'indirect'}<span class="reach"
										>{impact?.get(r)} steps</span
									>{/if}
								<button
									type="button"
									class="impact"
									aria-pressed={impactFrom === r}
									aria-label="What a change to {itemLabel(item)} affects"
									title="What a change to it affects"
									onclick={() => onimpact(r)}><Zap size={13} aria-hidden="true" /></button
								>
							</span>
						</th>
						{#each order as c, j (c)}
							{@const links = r === c ? [] : (cells.get(`${r}:${c}`) ?? [])}
							{@const chosen = picked?.row === r && picked.column === c}
							<td
								class="cell {blockEdges(r, c, k, j)}"
								class:diag={r === c}
								class:filled={links.length > 0}
								class:hot={hot.column === c}
								class:untyped={links.some((l) => untypedSet.has(l))}
								data-r={r}
								data-c={c}
							>
								<button
									type="button"
									class="cell-button"
									class:chosen
									data-k={k}
									data-j={j}
									tabindex={focusAt.k === k && focusAt.j === j ? 0 : -1}
									aria-label={cellLabel(r, c, links, k)}
									aria-pressed={chosen}
									onkeydown={move}
									onclick={() => {
										focusAt = { k, j };
										onpick(r, c);
									}}
								>
									{#if r === c && names}
										<span class="self named">{itemLabel(item)}</span>
									{:else if r === c}
										<span class="self">{k + 1}</span>
									{:else if links.length && names}
										<span class="n2">{namesIn(r, links).join(', ')}</span>
									{:else if links.length}
										<span class="marks">
											{#each cellMarks(links) as m (m.kind)}
												<span class="mark k-{m.kind}"
													>{KIND_WORDS[m.kind].mark}{#if m.count > 1}<small>{m.count}</small
														>{/if}</span
												>
											{/each}
										</span>
									{:else if matrix.elements === 'parts'}
										<Plus size={13} class="add" aria-hidden="true" />
									{/if}
									{#if links.some((l) => untypedSet.has(l))}
										<TriangleAlert size={11} class="warn-icon" aria-hidden="true" />
									{/if}
								</button>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.frame {
		--cell: 2.5rem;
		--cell-h: var(--cell);
		--name-width: clamp(12rem, 30cqw, 18rem);
		display: flex;
		padding: 0 var(--space-5);
		container-type: inline-size;
	}
	.frame.names {
		--cell: 5.5rem;
		--cell-h: 3.25rem;
	}
	.frame.touch {
		--cell: 2.75rem;
		--name-width: 9.5rem;
		padding: 0 var(--space-3);
	}
	.frame.touch.names {
		--cell: 5.5rem;
		--cell-h: 3.25rem;
	}
	.scroll {
		flex: 0 1 auto;
		min-width: 0;
		max-height: max(20rem, calc(100dvh - 14rem));
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	table {
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}
	th,
	td {
		padding: 0;
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	thead th,
	thead td {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--surface-2);
		vertical-align: bottom;
		font-weight: 400;
	}
	/* The names stay put on the left. */
	.band,
	.band-head {
		position: sticky;
		left: 0;
		z-index: 1;
		width: 1.75rem;
		min-width: 1.75rem;
	}
	.name,
	.corner {
		position: sticky;
		left: 0;
		z-index: 1;
		box-shadow: inset -1px 0 0 var(--border-strong);
	}
	.clustered .corner,
	.clustered .name {
		left: 1.75rem;
	}
	thead .corner,
	thead .band-head {
		z-index: 3;
	}
	.corner {
		width: var(--name-width);
		padding: var(--space-2) var(--space-3);
		text-align: left;
	}
	.axis {
		display: block;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		text-align: right;
	}
	.axis.down {
		text-align: left;
	}

	/* Column heads: the number, then the name reading upwards. */
	th.col {
		width: var(--cell);
		min-width: var(--cell);
		max-width: var(--cell);
	}
	.head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 100%;
		padding: var(--space-2) 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.head:hover .upright {
		color: var(--accent);
		text-decoration: underline;
	}
	.upright {
		max-height: 8.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-weight: 600;
	}
	/* An N² chart's wide columns: names across, on up to three lines. */
	.names .upright {
		display: -webkit-box;
		max-height: none;
		overflow: hidden;
		white-space: normal;
		writing-mode: horizontal-tb;
		transform: none;
		padding: 0 4px;
		text-align: center;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}
	.num {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
	}

	/* Row heads: the number and the name, nested parts indented. */
	th.name {
		padding: 0 var(--space-2) 0 var(--space-3);
		font-weight: 400;
		text-align: left;
	}
	.name-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: var(--name-width);
		min-height: var(--cell-h);
		padding-left: calc(var(--depth, 0) * 1rem);
	}
	.name-line .num {
		flex: none;
		min-width: 1.4em;
		text-align: right;
	}
	.name-button {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}
	.name-button:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.flag,
	.reach {
		flex: none;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1.6;
		white-space: nowrap;
	}
	.flag {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.reach {
		background: var(--warn-weak);
		color: var(--text);
	}
	.impact {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}
	.impact:hover,
	tr:hover .impact,
	.impact:focus-visible {
		border-color: var(--border);
		color: var(--text);
	}
	.impact[aria-pressed='true'] {
		border-color: var(--warn);
		background: var(--warn);
		color: var(--surface);
	}
	.touch .impact {
		width: 2.75rem;
		height: 2.75rem;
	}
	/* A narrow name column: a flag goes under the name rather than cutting it short. */
	.touch .name-line {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		column-gap: var(--space-2);
		align-items: center;
	}
	.touch .name-line > .num {
		grid-row: 1 / span 2;
	}
	.touch .name-line > .flag,
	.touch .name-line > .reach {
		grid-row: 2;
		grid-column: 2;
		justify-self: start;
	}
	.touch .name-line:not(:has(.flag, .reach)) > .name-button {
		grid-row: 1 / span 2;
	}
	.touch .name-line > .impact {
		grid-row: 1 / span 2;
		grid-column: 3;
	}

	/* Modules: a band naming each, and its block outlined on the diagonal. */
	.band {
		background: color-mix(in oklab, var(--accent-weak) 70%, var(--surface));
		vertical-align: top;
	}
	.band.none {
		background: var(--surface);
	}
	.band-label {
		display: block;
		padding: var(--space-2) 0;
		color: var(--text);
		font-size: 0.6875rem;
		font-weight: 650;
		white-space: nowrap;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		margin: 0 auto;
	}
	td.in-module {
		background: color-mix(in oklab, var(--accent-weak) 45%, var(--surface));
	}
	td.in-module.top {
		box-shadow: inset 0 2px 0 var(--accent);
	}
	td.in-module.bottom {
		box-shadow: inset 0 -2px 0 var(--accent);
	}
	td.in-module.left {
		box-shadow: inset 2px 0 0 var(--accent);
	}
	td.in-module.right {
		box-shadow: inset -2px 0 0 var(--accent);
	}
	td.in-module.top.left {
		box-shadow:
			inset 0 2px 0 var(--accent),
			inset 2px 0 0 var(--accent);
	}
	td.in-module.top.right {
		box-shadow:
			inset 0 2px 0 var(--accent),
			inset -2px 0 0 var(--accent);
	}
	td.in-module.bottom.left {
		box-shadow:
			inset 0 -2px 0 var(--accent),
			inset 2px 0 0 var(--accent);
	}
	td.in-module.bottom.right {
		box-shadow:
			inset 0 -2px 0 var(--accent),
			inset -2px 0 0 var(--accent);
	}
	td.in-module.top.left.bottom.right {
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	/* Cells. */
	td.cell {
		width: var(--cell);
		min-width: var(--cell);
		max-width: var(--cell);
		height: var(--cell-h);
	}
	.cell-button {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-height: var(--cell-h);
		padding: 2px;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.cell-button:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.cell-button.chosen {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.cell-button :global(.add) {
		color: var(--text-3);
		opacity: 0;
	}
	.cell-button:hover :global(.add),
	.cell-button:focus-visible :global(.add),
	.cell-button.chosen :global(.add) {
		opacity: 1;
	}
	.cell-button :global(.warn-icon) {
		position: absolute;
		top: 2px;
		right: 2px;
		color: var(--warn);
	}
	td.diag {
		background: var(--surface-2);
	}
	td.diag .self {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 4px;
		background: color-mix(in oklab, var(--text-3) 30%, var(--surface-2));
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 700;
	}
	td.diag .self.named {
		display: -webkit-box;
		width: auto;
		height: auto;
		padding: 2px 4px;
		overflow: hidden;
		font-family: inherit;
		line-height: 1.2;
		text-align: center;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	td.untyped {
		background: color-mix(in oklab, var(--warn-weak) 60%, var(--surface));
	}
	.marks {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 2px;
	}
	.mark {
		display: inline-grid;
		grid-auto-flow: column;
		place-items: center;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 3px;
		border: 1px solid var(--k);
		border-radius: 4px;
		background: color-mix(in oklab, var(--k) 16%, var(--surface));
		color: var(--text);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1;
	}
	.mark small {
		margin-left: 1px;
		font-size: 0.625rem;
	}
	.n2 {
		display: -webkit-box;
		overflow: hidden;
		font-size: 0.6875rem;
		line-height: 1.25;
		text-align: center;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}
	.k-connection {
		--k: var(--kind-interface);
	}
	.k-flow {
		--k: var(--info);
	}
	.k-binding {
		--k: var(--kind-structure);
	}
	.k-allocation {
		--k: var(--kind-behavior);
	}
	.k-typing {
		--k: var(--kind-package);
	}
	.k-satisfy {
		--k: var(--kind-requirement);
	}
	.k-succession {
		--k: var(--kind-behavior);
	}
	.k-derivation {
		--k: var(--kind-requirement);
	}
	.k-refinement {
		--k: var(--kind-analysis);
	}

	/* The crosshair: the row and column of the cell under the pointer or focus. */
	tbody tr.hot > th.name,
	tbody tr.hot > td.cell,
	td.cell.hot,
	thead th.col.hot {
		background: color-mix(in oklab, var(--accent-weak) 50%, var(--surface));
	}
	tbody tr.hot > td.cell.hot {
		background: color-mix(in oklab, var(--accent-weak) 90%, var(--surface));
	}
	/* What the inspector shows. */
	tbody tr.selected > th.name {
		box-shadow:
			inset 3px 0 0 var(--accent),
			inset -1px 0 0 var(--border-strong);
	}
	thead th.col.selected {
		box-shadow: inset 0 -3px 0 var(--accent);
	}

	/* What a change reaches: its row heads and column heads shaded, the start strongest. */
	tbody tr.reach-start > th.name,
	thead th.col.reach-start {
		background: color-mix(in oklab, var(--warn) 30%, var(--surface));
	}
	tbody tr.reach-direct > th.name,
	thead th.col.reach-direct,
	tbody tr.reach-direct > td.diag {
		background: color-mix(in oklab, var(--warn) 20%, var(--surface));
	}
	tbody tr.reach-indirect > th.name,
	thead th.col.reach-indirect,
	tbody tr.reach-indirect > td.diag {
		background: var(--warn-weak);
	}
	tbody tr.reach-start > td.diag {
		background: color-mix(in oklab, var(--warn) 30%, var(--surface));
	}
</style>
