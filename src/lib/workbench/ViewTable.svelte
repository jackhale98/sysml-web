<script lang="ts">
	import { MARK_WORDS, reviewMarks } from '#lib/review/marks.svelte.ts';
	import { tick, untrack } from 'svelte';
	import {
		ArrowDown,
		ArrowUp,
		Check,
		ChevronsUpDown,
		Columns3,
		FileCode,
		FilePlus,
		Info,
		Minus,
		Search,
		TriangleAlert,
		Upload
	} from '@lucide/svelte';
	import ExportMenu from '#lib/dataio/ExportMenu.svelte';
	import type { ExportTable } from '#lib/dataio/export.ts';
	import type { Engine } from '#lib/engine/client.ts';
	import type { CheckStatus, RenderedTable, RowInfo, ViewInfo } from '#lib/engine/types.ts';
	import { byteToUtf16, elementAt, type ModelElement } from '#lib/project/elements.ts';
	import CheckChip from '#lib/ui/CheckChip.svelte';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { renameElement, setField, setTableColumns } from './actions.ts';
	import CellEditor from './CellEditor.svelte';
	import TradeMatrix from './TradeMatrix.svelte';
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
	/** Rows are a tree (a budget): indented by depth, in the tree's order (not sortable). */
	const isTree = $derived(!!table?.columnKinds?.includes('tree'));
	/** Rows are requirements (the requirements table and views like it): offer importing more. */
	const listsRequirements = $derived(
		!!table &&
			!isPivot &&
			['text', 'satisfiedBy', 'verifiedBy'].every((f) => table?.availableFields?.includes(f))
	);

	/** The table as shown (searched and sorted), for exporting. */
	function exportData(): ExportTable {
		return {
			title,
			project: workspace.info?.name ?? 'Project',
			doc: info?.doc,
			header: (table?.columns ?? []).map((c, i) =>
				(isPivot && i > 0) || table?.trade?.alternatives.some((a) => a.name === c) ? c : heading(c)
			),
			rows: rows.map((r) => r.cells)
		};
	}

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

	/**
	 * Rows on the page: a large table (thousands of requirements) shows a page
	 * at a time, with a button for more; search, sort and export see them all.
	 */
	const ROW_PAGE = 300;
	let rowLimit = $state(ROW_PAGE);
	const shown = $derived(rows.length > rowLimit ? rows.slice(0, rowLimit) : rows);

	function sortBy(column: number) {
		if (sortColumn === column) {
			if (descending) sortColumn = null;
			descending = !descending;
		} else {
			sortColumn = column;
			descending = false;
		}
	}

	/** The model's elements by file (rows look theirs up; a scan per row was quadratic). */
	const elementsByFile = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole, never mutated
		const byFile = new Map<string, ModelElement[]>();
		for (const e of workspace.elements) {
			const list = byFile.get(e.file);
			if (list) list.push(e);
			else byFile.set(e.file, [e]);
		}
		return byFile;
	});

	/** The model element behind a row, matched by file and name or line. */
	function elementFor(index: number): ModelElement | undefined {
		const source = table?.sources[index];
		if (!source) return undefined;
		const simple = source.element.split('::').pop()?.replace(/^'|'$/g, '') ?? '';
		const inFile = elementsByFile.get(source.file) ?? [];
		return (
			inFile.find((e) => e.label === simple) ??
			inFile.find((e) => e.span.start_row === source.line || e.span.start_row + 1 === source.line)
		);
	}

	/** In review mode: whether the row's element is new or changed. */
	function markOf(index: number) {
		return reviewMarks.shown ? reviewMarks.markOf(elementFor(index)?.id) : null;
	}
	const marked = $derived(
		reviewMarks.shown && !!table && table.sources.some((_, i) => !!markOf(i))
	);

	// While it is on screen, search can find this table's rows and take you to one.
	$effect(() => {
		const t = table;
		if (!t) return;
		ui.table = { view: name, title, columns: t.columns, rows: t.rows };
		return () => {
			if (untrack(() => ui.table)?.view === name) ui.table = null;
		};
	});

	/** The row just jumped to, briefly highlighted. */
	let flash = $state<number | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	/** The nearest ancestor that scrolls vertically. */
	function scrollParent(node: HTMLElement): HTMLElement | null {
		for (let el = node.parentElement; el; el = el.parentElement) {
			const { overflowY } = getComputedStyle(el);
			if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight)
				return el;
		}
		return null;
	}

	/** Scroll a row into view and highlight it, clearing a search that hides it. */
	async function reveal(index: number) {
		if (!rows.some((r) => r.index === index)) query = '';
		const at = rows.findIndex((r) => r.index === index);
		if (at >= rowLimit) rowLimit = at + ROW_PAGE;
		await tick();
		const target = document.querySelector<HTMLElement>(
			`[data-table="${CSS.escape(name)}"] [data-row="${index}"]`
		);
		const scroller = target && scrollParent(target);
		if (target && scroller) {
			// Scroll only the rows' own container: moving the page around it would
			// leave the table short of the screen's bottom.
			const offset =
				target.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop;
			const top = ui.phone
				? offset - 12
				: offset - Math.max(0, (scroller.clientHeight - target.offsetHeight) / 2);
			const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
			scroller.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
		}
		flash = index;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = null), 2600);
	}

	$effect(() => {
		const request = ui.tableRequest;
		if (!request || request.view !== name) return;
		untrack(() => {
			if ('query' in request) {
				query = request.query;
				return;
			}
			void reveal(request.index);
			const element = elementFor(request.index);
			if (element && !ui.phone) ui.select(element.key, 'table');
		});
	});

	// Choosing an element elsewhere (search, explorer, a diagram) finds its row here.
	$effect(() => {
		const selection = ui.selection;
		if (!selection || selection.source === 'table') return;
		untrack(() => {
			const index = table?.sources.findIndex((_, i) => elementFor(i)?.key === selection.key);
			if (index !== undefined && index >= 0) void reveal(index);
		});
	});

	function openRow(index: number) {
		if (table?.opensText) {
			showInText(index);
			return;
		}
		const element = elementFor(index);
		if (element) ui.select(element.key, 'table');
	}

	/** A row about a statement (a check's claim): show that line in the text. */
	function showInText(index: number) {
		const source = table?.sources[index];
		const text = source ? workspace.text(source.file) : undefined;
		if (!source || source.byte === undefined || text === undefined) return;
		const from = byteToUtf16(text, source.byte);
		const end = text.indexOf('\n', from);
		const element = elementAt(workspace.elements, source.file, source.byte);
		// The element around it, for the inspector; the editor shows the line itself.
		if (element) ui.select(element.key, 'text');
		ui.revealText(source.file, from, end < 0 ? text.length : end);
	}

	function infoOf(index: number): RowInfo {
		return table?.rowInfo?.[index] ?? {};
	}

	/** The last segment of a tree path (`drone.rotors.esc` → `esc`) and what comes before it (the button's name has the whole path). */
	function splitTreePath(path: string): [string, string] {
		const at = path.lastIndexOf('.');
		return at < 0 ? ['', path] : [path.slice(0, at + 1), path.slice(at + 1)];
	}

	const isVerdict = (value: string): value is CheckStatus =>
		value === 'satisfied' || value === 'violated' || value === 'undecided';

	/** `23 %` → 0.23, for the share bar. */
	const shareOf = (value: string) => Math.max(0, Math.min(1, (parseFloat(value) || 0) / 100));

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

	type CellKind =
		| 'id'
		| 'flag'
		| 'status'
		| 'list'
		| 'number'
		| 'mark'
		| 'text'
		| 'long'
		| 'quantity'
		| 'percent'
		| 'verdict'
		| 'verdictIcon'
		| 'tree';
	function cellKind(column: string, value: string, index?: number): CellKind {
		const c = column.toLowerCase();
		if (isPivot) return 'mark';
		// What the row provider says the column holds.
		switch (index === undefined ? null : table?.columnKinds?.[index]) {
			case 'quantity':
				return 'quantity';
			case 'percent':
				return 'percent';
			case 'number':
				return 'number';
			case 'tree':
				return 'tree';
			case 'check':
				// A `check` column beside others says it with an icon; a checks list in words
				// (empty cells too, so the column stays as narrow as its icons).
				return c === 'check' ? 'verdictIcon' : 'verdict';
		}
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
	{:else if (kind === 'verdict' || kind === 'verdictIcon') && isVerdict(value)}
		<CheckChip status={value} compact={kind === 'verdictIcon'} />
	{:else if kind === 'percent' && value}
		<span class="share"
			><span class="bar" aria-hidden="true"
				><span style:width="{Math.round(shareOf(value) * 100)}%"></span></span
			>{value}</span
		>
	{:else if kind === 'quantity' && / \(.+\)$/.test(value)}
		<!-- `0.23 kg (5.8 %)`: the part in brackets moves under the value when the table is narrow. -->
		{@const at = value.lastIndexOf(' (')}
		{value.slice(0, at)}<span class="aside">{value.slice(at)}</span>
	{:else if kind === 'list' && value}
		{#each value.split(/,\s*/) as item, i (i)}<span class="ref">{item}</span>{/each}
	{:else if (kind === 'long' || kind === 'text') && value.includes('`')}
		<!-- An explanation names SysML as `code`. -->
		{#each value.split(/`([^`]+)`/) as part, i (i)}{#if i % 2}<code class="inline">{part}</code
				>{:else}{part}{/if}{/each}
	{:else}
		{value}
	{/if}
{/snippet}

<!-- A cell's value with what the provider says about it (why it is empty, that it adds up its parts). -->
{#snippet cell(kind: CellKind, value: string, note: string | undefined, rollup: boolean)}
	{#if value === '' && note}
		<span class="none" title={note}
			>—<Info size={12} aria-hidden="true" /><span class="visually-hidden">{note}</span></span
		>
	{:else if note && rollup && kind === 'quantity'}
		<span class="sum" title={note}
			><span aria-hidden="true">Σ</span>{@render display(kind, value)}<span class="visually-hidden"
				>({note})</span
			></span
		>
	{:else}
		{@render display(kind, value)}
	{/if}
{/snippet}

<!-- The first cell's text: a tree path's last segment (the rest for screen readers), a verdict chip. -->
{#snippet first(kind: CellKind, value: string)}
	{#if kind === 'tree'}
		{splitTreePath(value)[1] || '—'}
	{:else if kind === 'verdict'}
		{@render display(kind, value)}
	{:else}
		{value || '—'}
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
			{#if !table?.trade}
				<label class="search">
					<Search size={14} />
					<span class="visually-hidden">Search {title}</span>
					<input type="search" placeholder="Search" bind:value={query} />
				</label>
			{/if}
			{#if table && !table.trade}
				<span class="count" aria-live="polite">
					{rows.length === table.rows.length
						? `${table.rows.length} rows`
						: `${rows.length} of ${table.rows.length} rows`}
				</span>
			{/if}
			{#if table?.availableFields?.length && info && !info.builtin && !isPivot && !table.trade}
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
			{#if table}
				<div class="io">
					<ExportMenu
						table={exportData}
						filtered={rows.length !== table.rows.length}
						share={ui.phone}
					/>
					{#if listsRequirements}
						<button
							type="button"
							class="source"
							aria-haspopup="dialog"
							title="Add requirements from an Excel or CSV file, or cells pasted from a spreadsheet"
							onclick={() => (ui.importOpen = true)}
						>
							<Upload size={14} /> Import
						</button>
					{/if}
				</div>
			{/if}
		</div>
		{#if table?.warnings.length}
			<p class="warnings"><TriangleAlert size={14} /> {table.warnings.join(' · ')}</p>
		{/if}
		{#if marked}
			<p class="review-legend">
				<span class="review-badge added">{MARK_WORDS.added.badge}</span>
				<span class="review-badge changed">{MARK_WORDS.changed.badge}</span>
				since {reviewMarks.against}.
				<button type="button" onclick={() => (reviewMarks.visible = false)}>Hide marks</button>
			</p>
		{/if}
	</header>

	{#if error}
		<p class="state" role="alert">This view could not be rendered: {error}</p>
	{:else if !table}
		<div class="skeleton" aria-hidden="true">
			{#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}<div></div>{/each}
		</div>
	{:else if table.trade}
		<TradeMatrix trade={table.trade} {workspace} {ui} {name} />
	{:else if table.rows.length === 0}
		<p class="state">No rows. Nothing in the model matches this view yet.</p>
	{:else if ui.phone}
		<!-- Phones: one card per row, full width, scrolling down rather than sideways. -->
		{@const subtitled = !isPivot && table.columns.length > 2 && !table.editable?.[1]}
		<div class="scroll cards-scroll" data-table={name}>
			<ul class="cards" aria-label="{title} rows">
				{#each shown as row (row.index)}
					{@const selectable = !isPivot && !!table.sources[row.index]}
					{@const kind0 = cellKind(table.columns[0] ?? '', row.cells[0] ?? '', 0)}
					{@const mark = selectable ? markOf(row.index) : null}
					<li
						class="card"
						data-row={row.index}
						class:review-added={mark === 'added'}
						class:review-changed={mark === 'changed'}
						class:flash={flash === row.index}
						class:selected={selectable &&
							!!ui.selection &&
							elementFor(row.index)?.key === ui.selection.key}
					>
						<div class="card-title" class:verdict-title={kind0 === 'verdict'}>
							{#if selectable}
								<button
									type="button"
									class="open"
									aria-label={table.opensText
										? `${row.cells[0]}: ${row.cells.slice(1, 3).filter(Boolean).join(' ')}, show in the text`
										: undefined}
									onclick={() => openRow(row.index)}
									>{#if kind0 === 'verdict'}{@render display(kind0, row.cells[0] ?? '')}{:else}{row
											.cells[0] || '—'}{/if}</button
								>
							{:else}
								<strong>{row.cells[0] || '—'}</strong>
							{/if}
							{#if subtitled && row.cells[1]}<span class="subtitle">{row.cells[1]}</span>{/if}
							{#if mark}<span class="review-badge {mark}"
									>{MARK_WORDS[mark].badge}<span class="visually-hidden">
										— {MARK_WORDS[mark].said}</span
									></span
								>{/if}
						</div>
						{#if isTree}
							{@const columns = table.columns}
							{@const at = (field: string) => columns.indexOf(field)}
							{@const [q, each, total, share] = ['quantity', 'each', 'total', 'share'].map((f) =>
								at(f) >= 0 ? (row.cells[at(f)] ?? '') : ''
							)}
							{@const note =
								infoOf(row.index).notes?.[at('each')] ?? infoOf(row.index).notes?.[at('total')]}
							{#if total || each || note}
								<p class="budget-line">
									{#if total}
										{#if q && q !== '1' && each}<span class="times">{q} × {each} =</span>{/if}
										<strong>{total}</strong>
										{#if share}<span class="of">{share}</span>{/if}
									{:else}
										<span class="none">—</span>
									{/if}
									{#if note}<span class="card-note">{note}</span>{/if}
								</p>
							{/if}
						{/if}
						<dl>
							{#each row.cells as value, c (c)}
								{@const column = table.columns[c] ?? ''}
								{@const kind = cellKind(column, value, c)}
								{@const edit = table.editable?.[c] ?? null}
								{@const canEdit = selectable && !!edit}
								{@const note = infoOf(row.index).notes?.[c]}
								{@const inLine =
									isTree && ['quantity', 'each', 'total', 'share', 'extended'].includes(column)}
								{#if c > 0 && !inLine && !(subtitled && c === 1) && (canEdit || note || (value !== '' && !(isPivot && value === '0')))}
									<div class="pair {kind}">
										<dt>{isPivot ? column : heading(column)}</dt>
										<dd>
											{#if editing?.row === row.index && editing.column === c && edit}
												<CellEditor
													{edit}
													{value}
													label="{heading(column)} of {rowLabel(row.cells)}"
													onsave={(next) => saveCell(row.index, c, next, row.cells)}
													oncancel={() => (editing = null)}
												/>
											{:else if canEdit}
												<button
													type="button"
													class="cell"
													onclick={() => (editing = { row: row.index, column: c })}
													><span class="visually-hidden">Edit {heading(column)}:</span
													>{@render display(kind, value)}{#if !value}<span class="empty">Add</span
														>{/if}</button
												>
											{:else if note && (value === '' || infoOf(row.index).role === 'rollup')}
												{value || '—'}<span class="card-note">{note}</span>
											{:else}
												{@render display(kind, value)}
											{/if}
										</dd>
									</div>
								{/if}
							{/each}
						</dl>
					</li>
				{/each}
			</ul>
			{@render more()}
		</div>
	{:else}
		<div class="scroll" data-table={name}>
			<table class:pivot={isPivot}>
				<thead>
					<tr>
						{#each table.columns as column, c (c)}
							{@const declared = table.columnKinds?.[c]}
							<th
								scope="col"
								class:end={declared === 'quantity' ||
									declared === 'percent' ||
									declared === 'number'}
								aria-sort={sortColumn === c ? (descending ? 'descending' : 'ascending') : undefined}
							>
								{#if isTree}
									<span class="th">{heading(column)}</span>
								{:else}
									<button type="button" onclick={() => sortBy(c)}>
										{isPivot && c > 0 ? column : heading(column)}
										{#if sortColumn === c}
											{#if descending}<ArrowDown size={12} />{:else}<ArrowUp size={12} />{/if}
										{:else}
											<ChevronsUpDown size={12} class="idle" />
										{/if}
									</button>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each shown as row, r (row.index)}
						{@const selectable = !isPivot && !!table.sources[row.index]}
						{@const info = infoOf(row.index)}
						{@const mark = selectable ? markOf(row.index) : null}
						<!-- The first cell's button is the keyboard way to open a row. -->
						<tr
							data-row={row.index}
							class:flash={flash === row.index}
							class:rollup={info.role === 'rollup'}
							class:own={info.role === 'attribute'}
							class:first-own={info.role === 'attribute' &&
								infoOf(shown[r - 1]?.index ?? -1).role !== 'attribute'}
							class:checks={table.opensText}
							class:review-added={mark === 'added'}
							class:review-changed={mark === 'changed'}
							class:selected={!!ui.selection &&
								selectable &&
								elementFor(row.index)?.key === ui.selection.key}
							onclick={() => selectable && openRow(row.index)}
						>
							{#each row.cells as value, c (c)}
								{@const kind = cellKind(table.columns[c] ?? '', value, c)}
								{@const edit = table.editable?.[c] ?? null}
								{@const canEdit = selectable && !!edit}
								<td class={kind} style:--depth={kind === 'tree' ? (info.depth ?? 0) : undefined}>
									{#if c === 0 && selectable}
										<button
											type="button"
											class="open"
											aria-label={table.opensText
												? `${value}: ${row.cells.slice(1, 3).filter(Boolean).join(' ')}, show in the text`
												: kind === 'tree'
													? value
													: undefined}
											onclick={(e) => {
												e.stopPropagation();
												openRow(row.index);
											}}>{@render first(kind, value)}</button
										>{#if mark}<span class="review-badge {mark}"
												>{MARK_WORDS[mark].badge}<span class="visually-hidden">
													— {MARK_WORDS[mark].said}</span
												></span
											>{/if}
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
										{@render cell(kind, value, info.notes?.[c], info.role === 'rollup')}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
			{@render more()}
		</div>
	{/if}
</section>

{#snippet more()}
	{#if rows.length > shown.length}
		<p class="more">
			<button type="button" onclick={() => (rowLimit += ROW_PAGE * 10)}>
				Show {Math.min(rows.length - shown.length, ROW_PAGE * 10)} more rows
			</button>
			<span>{shown.length} of {rows.length} shown</span>
		</p>
	{/if}
{/snippet}

<style>
	/* A row search jumped to: a brief glow that fades. */
	.flash,
	.flash > :global(td) {
		animation: found 2.6s var(--ease);
	}
	/* No end frame: the row fades back to its own background. */
	@keyframes found {
		0%,
		55% {
			background: color-mix(in oklab, var(--accent) 22%, var(--surface));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flash,
		.flash > :global(td) {
			animation: none;
			background: color-mix(in oklab, var(--accent) 14%, var(--surface));
		}
	}

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
		white-space: nowrap;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.columns-menu {
		position: relative;
		margin-left: auto;
	}
	/* Export and import sit at the end of the row, after Columns when it shows. */
	.io {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}
	.columns-menu + .io {
		margin-left: 0;
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
	.more {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-5);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.more button {
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
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
		container-type: inline-size;
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
		min-width: 6rem;
	}
	td.number {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	td.long {
		min-width: 16rem;
		max-width: 36rem;
		color: var(--text-2);
	}
	td.flag,
	td.verdictIcon {
		text-align: center;
	}
	/* Quantities and shares: right-aligned, figures of one width, never wrapped. */
	td.quantity,
	td.percent {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}
	th.end button,
	th.end .th {
		justify-content: flex-end;
		text-align: right;
	}
	.th {
		display: flex;
		align-items: center;
		height: 2.25rem;
		padding: 0 var(--space-3);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
	}
	/* A tree's path column: the last segment, indented by depth. */
	td.tree {
		padding-left: calc(var(--space-3) + var(--depth, 0) * 1.25rem);
		white-space: nowrap;
	}
	td.tree .open {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text);
	}
	td.tree .open:hover {
		color: var(--accent);
	}
	tr.rollup td.tree .open,
	tr.rollup td.quantity {
		font-weight: 650;
	}
	/* The root's own values after its parts (empty mass, payload, take-off mass). */
	tr.own td {
		background: color-mix(in oklab, var(--surface-2) 55%, var(--surface));
	}
	tr.own td.tree .open {
		color: var(--text-2);
		font-style: italic;
	}
	tr.first-own td {
		border-top: 1px solid var(--border-strong);
	}
	tr.checks {
		cursor: pointer;
	}
	.none {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-3);
		cursor: help;
	}
	.sum {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3em;
		cursor: help;
	}
	.sum > [aria-hidden='true'] {
		color: var(--text-3);
		font-weight: 500;
	}
	.share {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.share .bar {
		width: 2.5rem;
		height: 0.3rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	/* A narrow pane (the inspector open beside it): tighter cells, the share as a figure only,
	   and a margin's percentage under it, so wide tables fit without scrolling sideways. */
	@container (max-width: 64rem) {
		td,
		th button,
		.th {
			padding-inline: var(--space-2);
		}
		.share .bar {
			display: none;
		}
		.aside {
			display: block;
			color: var(--text-2);
			font-size: var(--text-xs);
		}
	}
	.share .bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: color-mix(in oklab, var(--accent) 70%, var(--surface));
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
	code.inline {
		padding: 0 3px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.92em;
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
			gap: var(--space-2);
			padding: var(--space-3) var(--space-3) var(--space-2);
		}
		h2 {
			font-size: var(--text-lg);
		}
		.title {
			flex-wrap: wrap;
		}
		.keyword {
			flex-wrap: wrap;
			overflow-wrap: anywhere;
		}
		.doc {
			display: -webkit-box;
			overflow: hidden;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}
		.tools {
			flex-wrap: wrap;
			gap: var(--space-2);
		}
		.search {
			flex: 1 1 12rem;
			width: auto;
			height: 2.75rem;
		}
		.source {
			height: 2.75rem;
		}
		.scroll {
			margin: 0 var(--space-3) var(--space-3);
		}
		.skeleton {
			padding: 0 var(--space-3);
		}
		/* Cards: the list scrolls down; nothing scrolls sideways or shrinks to fit. */
		.cards-scroll {
			margin: 0;
			padding: var(--space-1) var(--space-3) calc(6rem + var(--sheet-cover, 0px));
			overflow-x: hidden;
			overflow-y: auto;
			overscroll-behavior: contain;
			border: 0;
			border-radius: 0;
			background: transparent;
			box-shadow: none;
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
			transition:
				border-color var(--duration) var(--ease),
				background var(--duration) var(--ease);
		}
		.card.selected {
			border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
			background: color-mix(in oklab, var(--accent-weak) 60%, var(--surface));
		}
		.card-title {
			display: flex;
			align-items: baseline;
			flex-wrap: wrap;
			gap: 2px var(--space-2);
			margin-bottom: var(--space-2);
		}
		.card-title .open,
		.card-title strong {
			min-height: 2rem;
			font-family: var(--font-mono);
			font-size: var(--text-md);
		}
		.subtitle {
			flex: 1 1 10rem;
			min-width: 0;
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		dl {
			display: grid;
			gap: 2px;
			margin: 0;
		}
		.pair {
			display: grid;
			grid-template-columns: minmax(5.5rem, 34%) minmax(0, 1fr);
			align-items: start;
			gap: var(--space-2);
			min-height: 2.25rem;
			padding: var(--space-1) 0;
			border-top: 1px solid var(--border);
		}
		dt {
			padding-top: 0.3rem;
			color: var(--text-2);
			font-size: var(--text-xs);
			font-weight: 600;
			letter-spacing: 0.02em;
		}
		dd {
			min-width: 0;
			margin: 0;
			padding-top: 0.25rem;
			overflow-wrap: anywhere;
		}
		.pair.long dd {
			color: var(--text-2);
		}
		.pair.number dd,
		.pair.quantity dd,
		.pair.percent dd {
			font-variant-numeric: tabular-nums;
		}
		.budget-line {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 2px var(--space-2);
			margin: 0 0 var(--space-1);
			font-variant-numeric: tabular-nums;
		}
		.budget-line strong {
			font-size: var(--text-lg);
			font-weight: 650;
		}
		.budget-line .times,
		.budget-line .of {
			color: var(--text-2);
		}
		.budget-line .card-note {
			flex-basis: 100%;
		}
		.card-note {
			display: block;
			margin-top: 2px;
			color: var(--text-3);
			font-size: var(--text-xs);
		}
		.verdict-title {
			align-items: center;
		}
		.verdict-title .open {
			font-family: inherit;
		}
		.pair .cell {
			min-height: 2.25rem;
			margin: -0.25rem -6px;
			padding: 0.25rem 6px;
			border-color: var(--border);
			border-style: dashed;
		}
		.pair .cell .empty {
			opacity: 1;
		}
	}
	/* Review mode: new and changed rows, with a badge saying so. */
	.review-added {
		--review: var(--ok);
	}
	.review-changed {
		--review: var(--warn);
	}
	tr.review-added > :global(td:first-child),
	tr.review-changed > :global(td:first-child) {
		box-shadow: inset 3px 0 0 var(--review);
	}
	.card.review-added,
	.card.review-changed {
		box-shadow: inset 3px 0 0 var(--review);
	}
	.review-badge {
		display: inline-block;
		margin-left: 6px;
		padding: 0 6px;
		border: 1.5px solid var(--review);
		border-radius: var(--radius-pill);
		color: var(--review);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 15px;
		text-transform: uppercase;
		vertical-align: 1px;
		white-space: nowrap;
	}
	.review-badge.added {
		--review: var(--ok);
	}
	.review-badge.changed {
		--review: var(--warn);
	}
	.review-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.review-legend .review-badge {
		margin-left: 0;
	}
	.review-legend button {
		padding: 0 4px;
		border: 0;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
