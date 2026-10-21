<script lang="ts">
	import { untrack } from 'svelte';
	import {
		ArrowDown,
		ArrowUp,
		Check,
		ChevronsUpDown,
		Columns3,
		FileCode,
		FilePlus,
		Minus,
		Search,
		TriangleAlert
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { RenderedTable, ViewInfo } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { renameElement, setField, setTableColumns } from './actions.ts';
	import CellEditor from './CellEditor.svelte';
	import { viewTitle } from './views.ts';

	/**
	 * A SysML view rendered as a table by the engine: the view's
	 * `@TableRendering` decides the rows and columns, so the table is part of
	 * the model and any SysML tool can reproduce it.
	 */
	let {
		name,
		workspace,
		ui,
		engine
	}: { name: string; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	let table = $state.raw<RenderedTable | null>(null);
	let error = $state<string | null>(null);
	let query = $state('');
	let sortColumn = $state<number | null>(null);
	let descending = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;

	const info: ViewInfo | undefined = $derived(
		workspace.views.find((v) => v.name === name || v.qualifiedName === name)
	);
	const title = $derived(viewTitle(info?.name ?? name));
	const isPivot = $derived(!!table && table.sources.length === 0 && table.rows.length > 0);

	async function refresh() {
		const current = ++generation;
		try {
			const result = await engine.renderView(workspace.sourceFiles(), name);
			if (current !== generation) return;
			table = result;
			error = null;
		} catch (e) {
			if (current !== generation) return;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void workspace.files;
		void name;
		const delay = untrack(() => table) ? 300 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
		return () => clearTimeout(timer);
	});

	/** Rows with their original index (for sources), filtered and sorted. */
	const rows = $derived.by(() => {
		if (!table) return [];
		const needle = query.trim().toLowerCase();
		const indexed = table.rows
			.map((cells, index) => ({ cells, index }))
			.filter(({ cells }) => !needle || cells.some((c) => c.toLowerCase().includes(needle)));
		if (sortColumn === null) return indexed;
		const column = sortColumn;
		const sign = descending ? -1 : 1;
		return indexed.toSorted((a, b) => {
			const x = a.cells[column] ?? '';
			const y = b.cells[column] ?? '';
			const nx = Number(x);
			const ny = Number(y);
			const numeric = x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny);
			return sign * (numeric ? nx - ny : x.localeCompare(y, undefined, { numeric: true }));
		});
	});

	function sortBy(column: number) {
		if (sortColumn === column) {
			if (descending) sortColumn = null;
			descending = !descending;
		} else {
			sortColumn = column;
			descending = false;
		}
	}

	/** The model element behind a row, matched by file and name or line. */
	function elementFor(index: number): ModelElement | undefined {
		const source = table?.sources[index];
		if (!source) return undefined;
		const simple = source.element.split('::').pop()?.replace(/^'|'$/g, '') ?? '';
		const inFile = workspace.elements.filter((e) => e.file === source.file);
		return (
			inFile.find((e) => e.label === simple) ??
			inFile.find((e) => e.span.start_row === source.line || e.span.start_row + 1 === source.line)
		);
	}

	function openRow(index: number) {
		const element = elementFor(index);
		if (element) ui.select(element.key, 'table');
	}

	/** Copy the bundled view libraries into the project so they can be edited. */
	async function addToModel() {
		const libraries = await engine.viewLibraries();
		const added = libraries.filter((f) => workspace.text(f.path) === undefined);
		for (const file of added) workspace.setText(file.path, file.text);
		const path = added.find((f) => f.path.endsWith('ModelViews.sysml'))?.path;
		toasts.show(
			added.length
				? `Added ${added.map((f) => f.path).join(' and ')} to the project; edit them like any SysML.`
				: 'The standard views are already in the project.',
			{ tone: 'success' }
		);
		if (path) ui.open({ kind: 'file', path });
	}

	function showSource() {
		if (!info || info.builtin) return;
		ui.open({ kind: 'file', path: info.file });
		const element = workspace.elements.find((e) => e.file === info.file && e.label === info.name);
		if (element) ui.select(element.key, 'table');
	}

	let columnsOpen = $state(false);
	let columnChoice = $state<{ field: string; shown: boolean }[]>([]);

	function openColumns() {
		if (!table) return;
		const current = table.columns;
		const rest = (table.availableFields ?? []).filter((f) => !current.includes(f));
		columnChoice = [
			...current.map((field) => ({ field, shown: true })),
			...rest.map((field) => ({ field, shown: false }))
		];
		columnsOpen = true;
	}

	function moveColumn(index: number, by: number) {
		const next = [...columnChoice];
		const [item] = next.splice(index, 1);
		next.splice(index + by, 0, item!);
		columnChoice = next;
	}

	async function applyColumns() {
		if (!info) return;
		const columns = columnChoice.filter((c) => c.shown).map((c) => c.field);
		columnsOpen = false;
		const error = await setTableColumns(workspace, info.file, info.name, columns);
		if (error) toasts.show(error, { tone: 'error' });
	}

	/** The cell being edited, if any. */
	let editing = $state<{ row: number; column: number } | null>(null);

	function rowLabel(cells: string[]): string {
		return cells[1] ? `${cells[0]} ${cells[1]}` : (cells[0] ?? 'row');
	}

	async function saveCell(index: number, column: number, value: string, cells: string[]) {
		editing = null;
		const edit = table?.editable?.[column];
		const source = table?.sources[index];
		if (!edit || !source) return;
		const what = `${heading(table?.columns[column] ?? '')} of ${rowLabel(cells)}`;
		let error: string | null;
		if (edit.field === 'name') {
			const element = elementFor(index);
			error = element ? await renameElement(workspace, element, value) : 'Element not found.';
		} else {
			error = await setField(
				workspace,
				source,
				edit.field,
				value,
				value ? `Set ${what} to ${value}` : `Cleared ${what}`
			);
		}
		if (error) toasts.show(error, { tone: 'error' });
	}

	type CellKind = 'id' | 'flag' | 'status' | 'list' | 'number' | 'mark' | 'text' | 'long';
	function cellKind(column: string, value: string): CellKind {
		const c = column.toLowerCase();
		if (isPivot) return 'mark';
		if (c === 'id' || c === 'shortname') return 'id';
		if ((c === 'satisfied' || c === 'verified') && (value === '0' || value === '1')) return 'flag';
		if (c === 'status' || c === 'state') return 'status';
		if (/by$|^connectedto$|^via$/.test(c)) return 'list';
		if (value !== '' && !Number.isNaN(Number(value))) return 'number';
		if (c === 'text' || c === 'description' || c === 'doc' || value.length > 80) return 'long';
		return 'text';
	}

	const STATUS_TONE: Record<string, string> = {
		closed: 'ok',
		approved: 'ok',
		verified: 'ok',
		done: 'ok',
		open: 'info',
		draft: 'info',
		tbc: 'warn',
		tbd: 'warn',
		rejected: 'bad'
	};

	function heading(column: string): string {
		return viewTitle(column);
	}
</script>

{#snippet display(kind: CellKind, value: string)}
	{#if kind === 'flag'}
		{#if value === '1'}<Check size={15} class="yes" /><span class="visually-hidden">yes</span
			>{:else}<Minus size={15} class="no" /><span class="visually-hidden">no</span>{/if}
	{:else if kind === 'mark'}
		{#if value === '' || value === '0'}<span class="visually-hidden">none</span
			>{:else if value === '1' || value.toLowerCase() === 'x'}<span class="dot" title={value}
			></span>{:else}{value}{/if}
	{:else if kind === 'status' && value}
		<span class="chip {STATUS_TONE[value.toLowerCase()] ?? 'plain'}">{value}</span>
	{:else if kind === 'list' && value}
		{#each value.split(/,\s*/) as item, i (i)}<span class="ref">{item}</span>{/each}
	{:else}
		{value}
	{/if}
{/snippet}

<section class="view-table" aria-label="{title} view">
	<header class="head">
		<div class="title">
			<KindGlyph kind="view" isDefinition={!info?.isUsage} size={28} />
			<div>
				<h2>{title}</h2>
				<p class="keyword">
					<code
						>{info?.isUsage
							? `view ${info.name} : ${info.definition ?? ''}`
							: `view def ${name}`}</code
					>
					{#if info?.builtin}<span class="badge">Standard view</span>{/if}
				</p>
			</div>
			{#if info && !info.builtin}
				<button type="button" class="source" onclick={showSource}>
					<FileCode size={14} /> Show SysML
				</button>
			{:else if info?.builtin}
				<button
					type="button"
					class="source"
					title="Copy the standard views into this project as SysML you can change"
					onclick={addToModel}
				>
					<FilePlus size={14} /> Add to my model
				</button>
			{/if}
		</div>
		{#if info?.doc}<p class="doc">{info.doc}</p>{/if}
		<div class="tools">
			<label class="search">
				<Search size={14} />
				<span class="visually-hidden">Search {title}</span>
				<input type="search" placeholder="Search" bind:value={query} />
			</label>
			{#if table}
				<span class="count" aria-live="polite">
					{rows.length === table.rows.length
						? `${table.rows.length} rows`
						: `${rows.length} of ${table.rows.length} rows`}
				</span>
			{/if}
			{#if table?.availableFields?.length && info && !info.builtin && !isPivot}
				<div class="columns-menu">
					<button
						type="button"
						class="source"
						aria-expanded={columnsOpen}
						onclick={() => (columnsOpen ? (columnsOpen = false) : openColumns())}
					>
						<Columns3 size={14} /> Columns
					</button>
					{#if columnsOpen}
						<div class="columns-panel" role="dialog" aria-label="Choose columns">
							<p class="panel-hint">
								Saved in the view's <code>@TableRendering</code>, so the table stays part of the
								model.
							</p>
							<ul>
								{#each columnChoice as choice, i (choice.field)}
									<li>
										<label>
											<input type="checkbox" bind:checked={choice.shown} />
											{heading(choice.field)}
										</label>
										<button
											type="button"
											class="move"
											aria-label="Move {heading(choice.field)} up"
											disabled={i === 0}
											onclick={() => moveColumn(i, -1)}><ArrowUp size={13} /></button
										>
										<button
											type="button"
											class="move"
											aria-label="Move {heading(choice.field)} down"
											disabled={i === columnChoice.length - 1}
											onclick={() => moveColumn(i, 1)}><ArrowDown size={13} /></button
										>
									</li>
								{/each}
							</ul>
							<div class="panel-buttons">
								<button type="button" class="source" onclick={() => (columnsOpen = false)}
									>Cancel</button
								>
								<button type="button" class="apply" onclick={applyColumns}>Apply</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
		{#if table?.warnings.length}
			<p class="warnings"><TriangleAlert size={14} /> {table.warnings.join(' · ')}</p>
		{/if}
	</header>

	{#if error}
		<p class="state" role="alert">This view could not be rendered: {error}</p>
	{:else if !table}
		<div class="skeleton" aria-hidden="true">
			{#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}<div></div>{/each}
		</div>
	{:else if table.rows.length === 0}
		<p class="state">No rows. Nothing in the model matches this view yet.</p>
	{:else}
		<div class="scroll">
			<table class:pivot={isPivot}>
				<thead>
					<tr>
						{#each table.columns as column, c (c)}
							<th
								scope="col"
								aria-sort={sortColumn === c ? (descending ? 'descending' : 'ascending') : undefined}
							>
								<button type="button" onclick={() => sortBy(c)}>
									{isPivot && c > 0 ? column : heading(column)}
									{#if sortColumn === c}
										{#if descending}<ArrowDown size={12} />{:else}<ArrowUp size={12} />{/if}
									{:else}
										<ChevronsUpDown size={12} class="idle" />
									{/if}
								</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.index)}
						{@const selectable = !isPivot && !!table.sources[row.index]}
						<!-- The first cell's button is the keyboard way to open a row. -->
						<tr
							class:selected={selectable &&
								elementFor(row.index)?.key === ui.selection?.key &&
								!!ui.selection}
							onclick={() => selectable && openRow(row.index)}
						>
							{#each row.cells as value, c (c)}
								{@const kind = cellKind(table.columns[c] ?? '', value)}
								{@const edit = table.editable?.[c] ?? null}
								{@const canEdit = selectable && !!edit}
								<td class={kind}>
									{#if c === 0 && selectable}
										<button
											type="button"
											class="open"
											onclick={(e) => {
												e.stopPropagation();
												openRow(row.index);
											}}>{value || '—'}</button
										>
									{:else if editing?.row === row.index && editing.column === c && edit}
										<CellEditor
											{edit}
											{value}
											label="{heading(table.columns[c] ?? '')} of {rowLabel(row.cells)}"
											onsave={(next) => saveCell(row.index, c, next, row.cells)}
											oncancel={() => (editing = null)}
										/>
									{:else if canEdit}
										<button
											type="button"
											class="cell"
											onclick={(e) => {
												e.stopPropagation();
												openRow(row.index);
												editing = { row: row.index, column: c };
											}}
											><span class="visually-hidden">Edit {heading(table.columns[c] ?? '')}:</span
											>{@render display(kind, value)}{#if !value}<span class="empty">Add</span
												>{/if}</button
										>
									{:else}
										{@render display(kind, value)}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.view-table {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg);
	}
	.head {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-5) var(--space-3);
	}
	.title {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.title > div {
		flex: 1;
		min-width: 0;
	}
	h2 {
		font-size: var(--text-xl);
		letter-spacing: -0.01em;
	}
	.keyword {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: 2px;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.keyword code {
		color: var(--syntax-keyword);
		font-family: var(--font-mono);
	}
	.badge {
		padding: 0 6px;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-2);
	}
	.source {
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
		cursor: pointer;
	}
	.source:hover {
		border-color: var(--border-strong);
	}
	.doc {
		max-width: 70ch;
		color: var(--text-2);
	}
	.tools {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.search {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: min(20rem, 100%);
		height: 2.125rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-3);
	}
	.search:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		outline: none;
	}
	.count {
		color: var(--text-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.columns-menu {
		position: relative;
		margin-left: auto;
	}
	.columns-panel {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 5;
		display: grid;
		gap: var(--space-2);
		width: min(18rem, 80vw);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.panel-hint {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.columns-panel ul {
		display: grid;
		gap: 2px;
		max-height: 18rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.columns-panel li {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.columns-panel label {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.move {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.move:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	.move:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.panel-buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.apply {
		height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}
	.warnings {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--warn);
		font-size: var(--text-sm);
	}
	.state {
		padding: var(--space-5);
		color: var(--text-2);
	}
	.skeleton {
		display: grid;
		gap: 6px;
		padding: 0 var(--space-5);
	}
	.skeleton div {
		height: 2.25rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
		margin: 0 var(--space-5) var(--space-5);
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
	th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		text-align: left;
		white-space: nowrap;
	}
	th button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		cursor: pointer;
	}
	th button:hover {
		color: var(--text);
	}
	th :global(.idle) {
		opacity: 0;
	}
	th button:hover :global(.idle) {
		opacity: 0.6;
	}
	td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}
	tbody tr {
		cursor: default;
		transition: background var(--duration) var(--ease);
	}
	tbody tr:hover {
		background: var(--surface-hover);
	}
	tbody tr.selected {
		background: var(--accent-weak);
	}
	/* The first column (usually the ID) stays put while the table scrolls sideways. */
	th:first-child,
	td:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--surface);
		box-shadow: inset -1px 0 0 var(--border);
	}
	th:first-child {
		z-index: 2;
		background: var(--surface-2);
	}
	tbody tr:hover td:first-child {
		background: var(--surface-hover);
	}
	tbody tr.selected td:first-child {
		background: var(--accent-weak);
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	.open {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.cell {
		display: block;
		width: 100%;
		min-height: 1.5rem;
		margin: -2px -6px;
		padding: 2px 6px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: inherit;
		cursor: text;
	}
	.cell:hover,
	.cell:focus-visible {
		border-color: var(--border-strong);
		background: var(--surface);
	}
	.cell .empty {
		color: var(--text-3);
		opacity: 0;
	}
	.cell:hover .empty,
	.cell:focus-visible .empty {
		opacity: 1;
	}
	.open:hover {
		text-decoration: underline;
	}
	td.id,
	td.id .open {
		font-family: var(--font-mono);
		white-space: nowrap;
	}
	td.text {
		min-width: 9rem;
	}
	td.list {
		min-width: 10rem;
	}
	td.number {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	td.long {
		min-width: 18rem;
		max-width: 36rem;
		color: var(--text-2);
	}
	td.flag {
		text-align: center;
	}
	td :global(.yes) {
		color: var(--ok);
	}
	td :global(.no) {
		color: var(--text-3);
	}
	.chip {
		display: inline-block;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: capitalize;
	}
	.chip.ok {
		background: color-mix(in oklab, var(--ok) 16%, var(--surface));
		color: var(--text);
	}
	.chip.warn {
		background: color-mix(in oklab, var(--warn) 20%, var(--surface));
		color: var(--text);
	}
	.chip.info {
		background: var(--accent-weak);
		color: var(--text);
	}
	.chip.bad {
		background: color-mix(in oklab, var(--danger) 16%, var(--surface));
		color: var(--text);
	}
	.ref {
		display: inline-block;
		margin: 1px 4px 1px 0;
		padding: 0 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.pivot td.mark {
		text-align: center;
	}
	.pivot td:first-child {
		white-space: nowrap;
	}
	.dot {
		display: inline-block;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--kind-requirement);
	}

	@media (max-width: 760px) {
		.head {
			padding: var(--space-4) var(--space-3) var(--space-3);
		}
		.scroll {
			margin: 0 var(--space-3) var(--space-3);
		}
		.skeleton {
			padding: 0 var(--space-3);
		}
	}
</style>
