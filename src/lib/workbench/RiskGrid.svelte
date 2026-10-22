<script lang="ts">
	import { SlidersHorizontal } from '@lucide/svelte';
	import type { RenderedTable } from '#lib/engine/types.ts';
	import { ZONE_WORDS, zoneTone } from './risk.ts';
	import { viewTitle } from './views.ts';

	/**
	 * A grid of counts over two rating scales (the risk matrix: severity down,
	 * likelihood across): every value of each scale, so the empty cells show.
	 * With the risk policy's zones (the view's `cellLevel`), each cell is
	 * coloured and patterned by its zone, with a legend; without, shaded by
	 * how severe and how likely it is.
	 */
	let {
		table,
		title,
		onpolicy
	}: {
		table: RenderedTable;
		title: string;
		/** Open the risk policy, when the project's library has one to change. */
		onpolicy?: () => void;
	} = $props();

	const down = $derived(viewTitle(table.counts?.rows ?? ''));
	const across = $derived(viewTitle(table.counts?.columns ?? ''));
	const columns = $derived(table.columns.slice(1));
	const levels = $derived(table.counts?.levels);
	const zones = $derived(table.counts?.levelValues ?? []);
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
	const zoneLabel = (zone: string) => ZONE_WORDS[zone]?.label ?? viewTitle(zone);
	/** How many lines are in each zone. */
	const inZone = $derived(
		zones.map((z) =>
			table.rows.reduce(
				(n, r, i) =>
					n + r.slice(1).reduce((m, c, j) => m + (levels?.[i]?.[j] === z ? numeric(c) : 0), 0),
				0
			)
		)
	);
</script>

<div class="grid-view">
	{#if levels && zones.length}
		<div class="legend-row">
			<p class="legend">
				{down} down, {across.toLowerCase()} across: each number is how many lines are in that cell ({total}
				in all). Each cell's colour and pattern is its zone in the risk policy.
			</p>
			{#if onpolicy}
				<button type="button" class="policy" onclick={onpolicy}>
					<SlidersHorizontal size={15} aria-hidden="true" /> Risk policy
				</button>
			{/if}
		</div>
		<ul class="zones" aria-label="Zones of the risk policy">
			{#each zones as zone, i (zone)}
				<li>
					<span class="swatch zone-{zoneTone(zone, zones)}" aria-hidden="true"></span>
					<span
						><strong>{zoneLabel(zone)}</strong>
						<span class="zone-count">{inZone[i]} line{inZone[i] === 1 ? '' : 's'}</span>
						{#if ZONE_WORDS[zone]}<span class="meaning">{ZONE_WORDS[zone].meaning}</span>{/if}</span
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="legend">
			{down} down, {across.toLowerCase()} across: each number is how many lines are in that cell ({total}
			in all). Darker cells are more severe and more likely.
		</p>
	{/if}
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
				{#each table.rows as row, r (row[0])}
					<tr>
						<th scope="row">{row[0]}</th>
						{#each row.slice(1) as count, i (i)}
							{@const zone = levels?.[r]?.[i] ?? ''}
							<td
								class:filled={count !== ''}
								class="zone-{zone ? zoneTone(zone, zones) : 'none'}"
								class:zoned={!!levels}
								data-zone={zone || undefined}
								style:--heat={levels ? undefined : heat(row[0] ?? '', columns[i] ?? '')}
								title="{down} {row[0]}, {across.toLowerCase()} {columns[i]}: {count ||
									'no'} line{count === '1' ? '' : 's'}{zone
									? ` (${zoneLabel(zone).toLowerCase()})`
									: ''}"
								>{count}{#if zone}<span class="visually-hidden">
										{count ? '' : 'none'}, {zoneLabel(zone).toLowerCase()}</span
									>{/if}</td
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
	.legend-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.legend {
		max-width: 70ch;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.policy {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		white-space: nowrap;
		cursor: pointer;
	}
	.policy:hover {
		border-color: var(--border-strong);
	}
	.zones {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	.zones li {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		max-width: 22rem;
	}
	.zone-count {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.meaning {
		display: block;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.swatch {
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 1px;
		border: 1px solid color-mix(in oklab, var(--text) 25%, transparent);
		border-radius: 4px;
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
	/*
	 * The policy's zones: a colour, and a pattern so the zone doesn't rest on
	 * colour alone (plain, dotted, hatched), as in the legend.
	 */
	.zone-ok {
		--zone: color-mix(in oklab, var(--ok) 22%, var(--surface));
		background: var(--zone);
	}
	.zone-warn {
		--zone: color-mix(in oklab, var(--warn) 30%, var(--surface));
		background:
			radial-gradient(
					circle at 2px 2px,
					color-mix(in oklab, var(--text) 30%, transparent) 1px,
					transparent 1.5px
				)
				0 0 / 6px 6px,
			var(--zone);
	}
	.zone-bad {
		--zone: color-mix(in oklab, var(--danger) 30%, var(--surface));
		background:
			repeating-linear-gradient(
				135deg,
				color-mix(in oklab, var(--text) 22%, transparent) 0 1.5px,
				transparent 1.5px 6px
			),
			var(--zone);
	}
	.zone-plain,
	td.zone-none.zoned {
		background: var(--surface-2);
	}
	td.filled {
		outline: 2px solid color-mix(in oklab, var(--text) 55%, transparent);
		outline-offset: -2px;
	}
	td.zoned.filled {
		/* The count stays legible over the pattern. */
		text-shadow:
			0 0 3px var(--surface),
			0 0 3px var(--surface);
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
		.policy {
			min-height: 2.75rem;
		}
	}
</style>
