<script lang="ts">
	import type { RenderedTable } from '#lib/engine/types.ts';
	import { viewTitle } from './views.ts';

	/**
	 * A grid of counts over two rating scales (the risk matrix: severity down,
	 * likelihood across): every value of each scale, so the empty cells show,
	 * and each cell shaded by how severe and how likely it is.
	 */
	let { table, title }: { table: RenderedTable; title: string } = $props();

	const down = $derived(viewTitle(table.counts?.rows ?? ''));
	const across = $derived(viewTitle(table.counts?.columns ?? ''));
	const columns = $derived(table.columns.slice(1));
	const numeric = (s: string) => (Number.isFinite(Number(s)) && s !== '' ? Number(s) : 0);
	const maxRow = $derived(Math.max(1, ...table.rows.map((r) => numeric(r[0] ?? ''))));
	const maxColumn = $derived(Math.max(1, ...columns.map(numeric)));
	const total = $derived(
		table.rows.reduce((n, r) => n + r.slice(1).reduce((m, c) => m + numeric(c), 0), 0)
	);
	/** 0 (least severe and likely) to 1 (most), for the cell's shade. */
	function heat(row: string, column: string): number {
		return Math.min(1, (numeric(row) * numeric(column)) / (maxRow * maxColumn));
	}
</script>

<div class="grid-view">
	<p class="legend">
		{down} down, {across.toLowerCase()} across: each number is how many lines are in that cell ({total}
		in all). Darker cells are more severe and more likely.
	</p>
	<div class="grid-scroll">
		<table class="grid" aria-label="{title}: {down.toLowerCase()} by {across.toLowerCase()}">
			<thead>
				<tr>
					<th scope="col" class="corner"
						><span aria-hidden="true">{down} ↓<br />{across} →</span><span class="visually-hidden"
							>{down}</span
						></th
					>
					{#each columns as c (c)}<th scope="col">{c}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each table.rows as row (row[0])}
					<tr>
						<th scope="row">{row[0]}</th>
						{#each row.slice(1) as count, i (i)}
							<td
								class:filled={count !== ''}
								style:--heat={heat(row[0] ?? '', columns[i] ?? '')}
								title="{down} {row[0]}, {across.toLowerCase()} {columns[i]}: {count ||
									'no'} line{count === '1' ? '' : 's'}">{count}</td
							>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.grid-view {
		display: grid;
		align-content: start;
		gap: var(--space-3);
		min-height: 0;
		padding: 0 var(--space-5) var(--space-5);
		overflow: auto;
	}
	.legend {
		max-width: 70ch;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.grid-scroll {
		max-width: 100%;
		overflow-x: auto;
	}
	.grid {
		border-collapse: separate;
		border-spacing: 3px;
		font-variant-numeric: tabular-nums;
	}
	th {
		padding: var(--space-1) var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		text-align: center;
	}
	th[scope='row'] {
		text-align: right;
	}
	.corner {
		text-align: left;
		white-space: nowrap;
	}
	td {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--radius-sm);
		background: color-mix(
			in oklab,
			var(--danger) calc(var(--heat, 0) * 38%),
			color-mix(in oklab, var(--ok) calc((1 - var(--heat, 0)) * 14%), var(--surface))
		);
		color: var(--text);
		font-weight: 700;
		text-align: center;
	}
	td.filled {
		outline: 2px solid color-mix(in oklab, var(--text) 55%, transparent);
		outline-offset: -2px;
	}
	@media (max-width: 760px) {
		.grid-view {
			padding: 0 var(--space-3) var(--space-3);
			overflow: visible;
		}
		.grid {
			border-spacing: 2px;
		}
		td {
			width: 1.875rem;
			height: 2.25rem;
		}
		th {
			padding: var(--space-1) 2px;
		}
	}
</style>
