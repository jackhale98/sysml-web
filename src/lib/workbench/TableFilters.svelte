<script lang="ts">
	/**
	 * The filters of a table's columns, each with the editor its column calls
	 * for: at least / at most for numbers, a check box per level (in order)
	 * for an enum or a few values, "contains" for text. Changes apply as they
	 * are made; "Add a filter" picks another column. In the table's Filter
	 * menu (a sheet on phones).
	 */
	import { Plus, X } from '@lucide/svelte';
	import type { RenderedTable } from '#lib/engine/types.ts';
	import { filterShape, levelWord, newFilter, type ColumnFilter } from './tableFilters.ts';

	let {
		table,
		filters = $bindable([]),
		heading
	}: {
		table: RenderedTable;
		filters?: ColumnFilter[];
		/** A column as people read it. */
		heading: (column: string) => string;
	} = $props();

	const uid = $props.id();
	let adding = $state('');
	/** Columns without a filter yet, that have something to filter. */
	const free = $derived(
		table.columns.filter(
			(c, i) => !filters.some((f) => f.column === c) && table.rows.some((r) => (r[i] ?? '') !== '')
		)
	);

	function add(column: string) {
		if (!column) return;
		filters = [...filters, newFilter(table, column)];
		adding = '';
	}

	function update(index: number, next: ColumnFilter) {
		filters = filters.map((f, i) => (i === index ? next : f));
	}

	function remove(index: number) {
		filters = filters.filter((_, i) => i !== index);
	}

	const number = (value: string): number | null =>
		value.trim() === '' || Number.isNaN(Number(value)) ? null : Number(value);
</script>

<div class="filters">
	{#if !filters.length}
		<p class="empty">No filters yet. Add one to show only the rows you want to review.</p>
	{/if}
	{#each filters as filter, i (filter.column)}
		{@const shape = filterShape(table, table.columns.indexOf(filter.column))}
		<fieldset class="filter">
			<legend>{heading(filter.column)}</legend>
			<button
				type="button"
				class="remove"
				aria-label="Remove the filter on {heading(filter.column)}"
				onclick={() => remove(i)}><X size={15} aria-hidden="true" /></button
			>
			{#if filter.kind === 'range'}
				<div class="range">
					<label>
						<span>At least</span>
						<input
							type="number"
							inputmode="decimal"
							placeholder={shape.kind === 'range' ? String(shape.min) : ''}
							value={filter.min ?? ''}
							oninput={(e) => update(i, { ...filter, min: number(e.currentTarget.value) })}
						/>
					</label>
					<label>
						<span>At most</span>
						<input
							type="number"
							inputmode="decimal"
							placeholder={shape.kind === 'range' ? String(shape.max) : ''}
							value={filter.max ?? ''}
							oninput={(e) => update(i, { ...filter, max: number(e.currentTarget.value) })}
						/>
					</label>
				</div>
			{:else if filter.kind === 'levels' && shape.kind === 'levels'}
				<div class="levels">
					{#each shape.values as value (value)}
						<label class="level">
							<input
								type="checkbox"
								checked={filter.values.includes(value)}
								onchange={(e) =>
									update(i, {
										...filter,
										values: e.currentTarget.checked
											? shape.values.filter((v) => v === value || filter.values.includes(v))
											: filter.values.filter((v) => v !== value)
									})}
							/>
							<span>{shape.ordered ? levelWord(value) : value}</span>
						</label>
					{/each}
				</div>
			{:else if filter.kind === 'text'}
				<label class="contains">
					<span>Contains</span>
					<input
						type="search"
						value={filter.text}
						oninput={(e) => update(i, { ...filter, text: e.currentTarget.value })}
					/>
				</label>
			{/if}
		</fieldset>
	{/each}
	{#if free.length}
		<div class="add">
			<label for="{uid}-add"><Plus size={14} aria-hidden="true" /> Add a filter</label>
			<select id="{uid}-add" bind:value={adding} onchange={() => add(adding)}>
				<option value="">Choose a column…</option>
				{#each free as column (column)}<option value={column}>{heading(column)}</option>{/each}
			</select>
		</div>
	{/if}
</div>

<style>
	.filters {
		display: grid;
		gap: var(--space-3);
	}
	.empty {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.filter {
		position: relative;
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-2) var(--space-3) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	legend {
		padding: 0 4px;
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 650;
	}
	.remove {
		position: absolute;
		top: -0.25rem;
		right: var(--space-2);
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.remove:hover,
	.remove:focus-visible {
		background: var(--surface-hover);
		color: var(--text);
	}
	.range {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.range label,
	.contains {
		display: grid;
		gap: 2px;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	input[type='number'],
	input[type='search'],
	select {
		min-width: 0;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
	}
	.levels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}
	.level {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		font-size: var(--text-sm);
		text-transform: capitalize;
		cursor: pointer;
	}
	.add {
		display: grid;
		gap: 4px;
	}
	.add label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	@media (max-width: 760px) {
		input[type='number'],
		input[type='search'],
		select,
		.remove,
		.level {
			min-height: 2.75rem;
		}
		.remove {
			width: 2.75rem;
			height: 2.75rem;
			top: -0.6rem;
		}
	}
</style>
