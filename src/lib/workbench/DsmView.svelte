<script lang="ts">
	import { untrack } from 'svelte';
	import {
		Cable,
		FileCode,
		Grid3x3,
		List,
		Plus,
		SlidersHorizontal,
		TriangleAlert,
		X,
		Zap
	} from '@lucide/svelte';
	import ExportMenu from '#lib/dataio/ExportMenu.svelte';
	import RelationPopover from '#lib/diagram/RelationPopover.svelte';
	import { modelContext, syntaxCheck } from '#lib/diagram/modelContext.ts';
	import { connectOption, type Plan, type RelationOption } from '#lib/diagram/relationships.ts';
	import type { Engine } from '#lib/engine/client.ts';
	import type {
		DependencyKind,
		DependencyMatrix,
		MatrixLink,
		ViewInfo
	} from '#lib/engine/types.ts';
	import { byteToUtf16, type ModelElement } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { applySteps, setViewSetting } from './actions.ts';
	import DsmGrid from './DsmGrid.svelte';
	import DsmList from './DsmList.svelte';
	import {
		KIND_WORDS,
		cellsOf,
		cluster,
		impactOf,
		itemLabel,
		itemPathLabel,
		linkSentence,
		matrixExport,
		modelOrder,
		neighbours,
		passes,
		reviewFlags
	} from './dsm.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { viewTitle } from './views.ts';

	/**
	 * A view as a dependency matrix (DSM or N² chart, `@MatrixRendering`):
	 * the elements it exposes down the side and across the top, and in each
	 * cell how the row's element leads to the column's. The kinds of link
	 * counted and the order (as declared, or suggested modules) are the
	 * view's settings, saved in its text. A cell shows its links; an empty
	 * one between two parts offers to connect them. Any element can show
	 * what a change to it reaches. On a phone, a list of the elements, each
	 * opening to its links; the grid scrolls sideways when asked for.
	 */
	let {
		name,
		workspace,
		ui,
		engine
	}: { name: string; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	let matrix = $state.raw<DependencyMatrix | null>(null);
	let error = $state<string | null>(null);
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const info: ViewInfo | undefined = $derived(
		workspace.views.find((v) => v.name === name || v.qualifiedName === name)
	);
	const title = $derived(viewTitle(info?.name ?? name));
	/** The view's own element, which its settings are saved on. */
	const viewElement = $derived(
		info
			? workspace.elements.find(
					(e) => e.file === info.file && e.kind === 'view' && e.name === info.name
				)
			: undefined
	);
	/** A view of the project (not a library's definition): its settings can be saved. */
	const editable = $derived(
		!!info && info.isUsage && !info.builtin && !isLibraryFile(info.file) && !!viewElement
	);

	async function refresh() {
		const current = ++generation;
		try {
			const result = await engine.dependencyMatrix(workspace.sourceFiles(), name);
			if (current !== generation) return;
			matrix = result;
			error = null;
			if (current >= settledFrom) {
				chosenKinds = null;
				chosenOrder = null;
				settledFrom = Infinity;
			}
		} catch (e) {
			if (current !== generation) return;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void workspace.files;
		void name;
		const delay = untrack(() => matrix) ? 300 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
		return () => clearTimeout(timer);
	});

	// --- The settings: what the view says, or what was just chosen while the text catches up ---

	let chosenKinds = $state<DependencyKind[] | null>(null);
	let chosenOrder = $state<'model' | 'clustered' | null>(null);
	/** The first reading of the matrix that comes after the last setting was saved. */
	let settledFrom = Infinity;
	const kinds = $derived(chosenKinds ?? matrix?.kinds ?? []);
	const order = $derived(chosenOrder ?? matrix?.order ?? 'model');
	const noun = $derived(
		matrix?.elements === 'actions'
			? ['step', 'steps']
			: matrix?.elements === 'requirements'
				? ['requirement', 'requirements']
				: ['part', 'parts']
	);
	const listWords = (words: string[]) =>
		words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

	async function save(field: string, value: string, label: string) {
		if (!editable || !info) return;
		const error = await setViewSetting(
			workspace,
			{ file: info.file, name: info.name, id: viewElement?.id },
			'MatrixRendering',
			field,
			value,
			label
		);
		// The text says it now (or the change was refused): the next matrix read from it decides.
		settledFrom = generation + 1;
		void refresh();
		if (error) toastError(error);
	}

	function toastError(message: string) {
		toasts.show(message, { tone: 'error' });
	}

	function toggleKind(kind: DependencyKind) {
		if (!matrix) return;
		const on = kinds.includes(kind);
		if (on && kinds.length === 1) return;
		const next = matrix.available.filter((k) => (k === kind ? !on : kinds.includes(k)));
		chosenKinds = next;
		void save(
			'dependencies',
			next.join('; '),
			`${title} now counts ${listWords(next.map((k) => KIND_WORDS[k].label.toLowerCase()))}`
		);
	}

	function setOrder(next: 'model' | 'clustered') {
		if (next === order) return;
		chosenOrder = next;
		void save(
			'order',
			next,
			next === 'clustered'
				? `${title} is ordered by suggested modules`
				: `${title} is in model order`
		);
	}

	// --- What the matrix shows ---------------------------------------------------------

	const cells = $derived(matrix ? cellsOf(matrix, kinds) : new Map<string, MatrixLink[]>());
	const arrangement = $derived(
		matrix ? (order === 'clustered' ? cluster(matrix, kinds) : modelOrder(matrix)) : null
	);
	const flags = $derived(matrix ? reviewFlags(matrix, kinds) : { untyped: [], unlinked: [] });
	const counted = $derived(matrix ? matrix.links.filter((l) => kinds.includes(l.kind)) : []);
	const links = $derived(matrix ? neighbours(matrix, kinds) : null);

	/** Change impact: from which element, and what it reaches (with the distance). */
	let impactFrom = $state<number | null>(null);
	const impact = $derived(
		matrix && impactFrom !== null && impactFrom < matrix.items.length
			? impactOf(matrix, kinds, impactFrom)
			: null
	);
	const direct = $derived(impact ? [...impact.values()].filter((d) => d === 1).length : 0);

	function toggleImpact(index: number) {
		impactFrom = impactFrom === index ? null : index;
	}

	// --- The model elements behind items and links ---------------------------------------

	const byId = $derived(
		new Map(workspace.elements.flatMap((e) => (e.id ? [[e.id, e] as const] : [])))
	);
	const elementOf = (index: number): ModelElement | undefined =>
		matrix ? byId.get(matrix.items[index]?.id ?? '') : undefined;
	const selectedIndex = $derived.by(() => {
		const key = ui.selection?.key;
		if (!key || !matrix) return null;
		const at = matrix.items.findIndex((i) => byId.get(i.id)?.key === key);
		return at < 0 ? null : at;
	});

	function select(index: number) {
		const element = elementOf(index);
		if (element) ui.select(element.key, 'table');
	}

	/** Show where a link is written; a named one is selected for the inspector too. */
	function showLink(link: MatrixLink) {
		const text = workspace.text(link.file);
		if (text === undefined) return;
		const element = link.element ? byId.get(link.element) : undefined;
		if (element) ui.select(element.key, 'table');
		ui.revealText(link.file, byteToUtf16(text, link.start), byteToUtf16(text, link.end));
	}

	function showSource() {
		if (!info || info.builtin) return;
		if (viewElement) ui.showInText(viewElement, 'table');
		else ui.open({ kind: 'file', path: info.file });
	}

	// --- Cells: under the pointer or focus, and chosen ------------------------------------

	let hot = $state<{ row: number; column: number } | null>(null);
	let picked = $state<{ row: number; column: number } | null>(null);
	const shown = $derived(hot ?? picked);

	function pick(row: number, column: number) {
		picked = { row, column };
		const here = cells.get(`${row}:${column}`) ?? [];
		const named = here.map((l) => (l.element ? byId.get(l.element) : undefined)).find(Boolean);
		if (row === column) select(row);
		else if (named) ui.select(named.key, 'table');
	}

	// --- Connecting two parts from an empty cell -----------------------------------------

	let root = $state<HTMLElement | null>(null);
	let relation = $state<{
		option: RelationOption;
		x: number;
		y: number;
	} | null>(null);
	const ctx = $derived(modelContext(workspace));
	const checkSyntax = $derived(syntaxCheck(engine));

	/** Why two items can't be connected from here, or null when they can. */
	function cannotConnect(row: number, column: number): string | null {
		if (!matrix || matrix.elements !== 'parts') return 'Write this kind of link in the text.';
		const [a, b] = [matrix.items[row]!, matrix.items[column]!];
		if (a.inherited || b.inherited)
			return `${itemLabel(a.inherited ? a : b)} comes from its definition: connect it there, in the text.`;
		const [ea, eb] = [elementOf(row), elementOf(column)];
		if (!ea || !eb || !connectOption(ea, eb, ctx))
			return `${itemLabel(a)} and ${itemLabel(b)} are not parts of the same thing: connect them in the text.`;
		return null;
	}

	function connect(row: number, column: number, anchor?: HTMLElement | null) {
		const [a, b] = [elementOf(row), elementOf(column)];
		const option = a && b ? connectOption(a, b, ctx) : null;
		if (!option) return;
		const box = root?.getBoundingClientRect();
		const at = anchor?.getBoundingClientRect();
		relation = {
			option,
			x: at && box ? at.left - box.left : 24,
			y: at && box ? at.bottom - box.top + 6 : 120
		};
	}

	async function applyPlan(plan: Plan): Promise<string | null> {
		const error = await applySteps(workspace, plan.label, plan.steps, checkSyntax);
		if (!error) relation = null;
		return error;
	}

	/** On a phone: which part to connect to, before the details. */
	let connectFrom = $state<number | null>(null);
	let pickerOpen = $state(false);
	function chooseTarget(from: number) {
		connectFrom = from;
		pickerOpen = true;
	}

	// --- Phone: a list, or the grid sideways ----------------------------------------------

	let gridOnPhone = $state(false);
	let settingsOpen = $state(false);

	function exportData() {
		return matrixExport(matrix!, kinds, arrangement?.order ?? [], {
			title,
			project: workspace.info?.name ?? 'Project',
			doc: info?.doc
		});
	}
</script>

{#snippet mark(kind: DependencyKind, count = 1)}
	<span class="mark k-{kind}" aria-hidden="true"
		>{KIND_WORDS[kind].mark}{#if count > 1}<small>{count}</small>{/if}</span
	>
{/snippet}

{#snippet cellDetail(row: number, column: number)}
	{@const m = matrix!}
	{@const here = cells.get(`${row}:${column}`) ?? []}
	{#if row === column}
		{@const item = m.items[row]!}
		{@const outside = m.outside.filter((o) => o.item === row && kinds.includes(o.kind))}
		<p class="detail-head">
			<strong>{itemPathLabel(m, row)}</strong>
			{#if item.type}<span class="muted">a {item.type}</span>{/if}
			<span class="muted"
				>· leads to {links?.out[row]?.size ?? 0} · comes from {links?.in[row]?.size ?? 0}</span
			>
		</p>
		{#if outside.length}
			<p class="muted outside">
				Also, outside this matrix: {outside
					.map((o) =>
						o.direction === 'out'
							? `${KIND_WORDS[o.kind].legend} ${o.name}`
							: `${o.name} ${KIND_WORDS[o.kind].legend} it`
					)
					.join('; ')}.
			</p>
		{/if}
		<div class="detail-actions">
			{#if elementOf(row)}
				<button type="button" class="small" onclick={() => select(row)}>Select</button>
			{/if}
			<button
				type="button"
				class="small"
				aria-pressed={impactFrom === row}
				onclick={() => toggleImpact(row)}
				><Zap size={13} aria-hidden="true" /> What a change affects</button
			>
		</div>
	{:else if here.length}
		<p class="detail-head">
			From <strong>{itemPathLabel(m, row)}</strong> to <strong>{itemPathLabel(m, column)}</strong>
		</p>
		<ul class="detail-links">
			{#each here as link (link)}
				{@const items = passes(link, row)}
				<li>
					{@render mark(link.kind)}
					<span
						>{linkSentence(m, link, row)}{#if link.kind === 'connection' && items.length}; carries {items
								.join(', ')
								.toLowerCase()}{/if}.</span
					>
					{#if link.kind === 'connection' && !link.definition}
						<span class="flag"
							><TriangleAlert size={12} aria-hidden="true" /> No interface definition</span
						>
					{/if}
					<button type="button" class="small" onclick={() => showLink(link)}
						><FileCode size={13} aria-hidden="true" /> Show in SysML</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		{@const why = cannotConnect(row, column)}
		<p class="detail-head">
			No link from <strong>{itemPathLabel(m, row)}</strong> to
			<strong>{itemPathLabel(m, column)}</strong>{kinds.length < m.available.length
				? ', among the kinds counted'
				: ''}.
		</p>
		{#if !why}
			{#if picked?.row === row && picked.column === column}
				<div class="detail-actions">
					<button
						type="button"
						class="small primary"
						onclick={(e) => connect(row, column, e.currentTarget as HTMLElement)}
						><Cable size={13} aria-hidden="true" /> Connect them…</button
					>
				</div>
			{:else}
				<p class="muted">Select the cell to connect them.</p>
			{/if}
		{:else}
			<p class="muted">{why}</p>
		{/if}
	{/if}
{/snippet}

{#snippet settings()}
	{#if matrix}
		<div class="kinds" role="group" aria-label="What counts as a link">
			<span class="tools-label" aria-hidden="true">Counts</span>
			{#each matrix.available as kind (kind)}
				{@const on = kinds.includes(kind)}
				<button
					type="button"
					class="chip"
					aria-pressed={on}
					disabled={on && kinds.length === 1}
					title={on && kinds.length === 1 ? 'At least one kind of link counts' : undefined}
					onclick={() => toggleKind(kind)}>{@render mark(kind)} {KIND_WORDS[kind].label}</button
				>
			{/each}
		</div>
		<div class="segmented" role="group" aria-label="Order">
			<button type="button" aria-pressed={order === 'model'} onclick={() => setOrder('model')}
				>Model order</button
			>
			<button
				type="button"
				aria-pressed={order === 'clustered'}
				onclick={() => setOrder('clustered')}>Suggested modules</button
			>
		</div>
	{/if}
{/snippet}

<section class="dsm" class:phone={ui.phone} aria-label="{title} view" bind:this={root}>
	<!-- The page scrolls; the grid scrolls inside it when it is taller than the screen. -->
	<div class="page">
		<header class="head">
			<div class="title">
				<KindGlyph kind="view" isDefinition={!info?.isUsage} size={28} />
				<div>
					<h2>{title}</h2>
					<p class="keyword">
						<code
							>{info?.isUsage
								? `view ${info.name} : ${info.definition ?? ''}`
								: `view def ${info?.name ?? name}`}</code
						>
						<span class="badge">{matrix?.cells === 'names' ? 'N² chart' : 'Dependency matrix'}</span
						>
					</p>
				</div>
				{#if info && !info.builtin}
					<button type="button" class="source" onclick={showSource}>
						<FileCode size={14} /> <span class="button-label">Show SysML</span>
					</button>
				{/if}
			</div>
			{#if info?.doc}<p class="doc">{info.doc}</p>{/if}
			{#if matrix}
				<div class="tools">
					{#if ui.phone}
						<!-- On a phone the settings are a sheet: a line says what they are now. -->
						<button
							type="button"
							class="settings"
							aria-haspopup="dialog"
							onclick={() => (settingsOpen = true)}
						>
							<SlidersHorizontal size={16} aria-hidden="true" />
							<span
								>Counts {listWords(kinds.map((k) => KIND_WORDS[k].label.toLowerCase()))} · {order ===
								'clustered'
									? 'suggested modules'
									: 'model order'}</span
							>
						</button>
						<div class="segmented" role="group" aria-label="Show as">
							<button
								type="button"
								aria-pressed={!gridOnPhone}
								onclick={() => (gridOnPhone = false)}
								><List size={14} aria-hidden="true" /> List</button
							>
							<button type="button" aria-pressed={gridOnPhone} onclick={() => (gridOnPhone = true)}
								><Grid3x3 size={14} aria-hidden="true" /> Grid</button
							>
						</div>
					{:else}
						{@render settings()}
					{/if}
					<div class="io">
						<ExportMenu table={exportData} share={ui.phone} />
					</div>
				</div>
				<p class="summary" aria-live="polite">
					<strong>{matrix.items.length}</strong>
					{matrix.items.length === 1 ? noun[0] : noun[1]}{matrix.scope
						? ` of ${matrix.scope}`
						: ''},
					<strong>{counted.length}</strong>
					{counted.length === 1 ? 'link' : 'links'}{#if flags.unlinked.length}<span
							class="pill warn"
							><TriangleAlert size={12} aria-hidden="true" />{flags.unlinked.length} with no links</span
						>{/if}{#if flags.untyped.length}<span class="pill warn"
							><TriangleAlert size={12} aria-hidden="true" />{flags.untyped.length}
							{flags.untyped.length === 1 ? 'connection' : 'connections'} with no interface definition</span
						>{/if}
				</p>
				{#if info && !editable}
					<p class="muted">
						This is the library’s definition: what you choose here is shown, not saved. Make a view
						of it with New DSM to keep the choices.
					</p>
				{/if}
				{#if order === 'clustered'}
					<p class="note">
						<strong>Suggested modules</strong> put {noun[1]} that are linked to each other next to each
						other, and outline the groups with more links inside than between them. It is a suggestion
						from the links alone: check it against what you know.
					</p>
				{/if}
				{#if impact && impactFrom !== null}
					<div class="impact-banner" role="status">
						<Zap size={15} aria-hidden="true" />
						<p>
							A change to <strong>{itemLabel(matrix.items[impactFrom]!)}</strong>
							may affect <strong>{impact.size} of {matrix.items.length - 1}</strong>
							{noun[1]}: {direct} directly, {impact.size - direct} through others.
						</p>
						<button type="button" class="small" onclick={() => (impactFrom = null)}
							><X size={14} aria-hidden="true" /> Clear<span class="visually-hidden">
								what a change affects</span
							></button
						>
					</div>
				{/if}
				{#if matrix.warnings.length}
					<p class="warnings">
						<TriangleAlert size={14} aria-hidden="true" />
						{matrix.warnings.join(' · ')}
					</p>
				{/if}
			{/if}
		</header>

		{#if error}
			<p class="state" role="alert">This view could not be shown: {error}</p>
		{:else if !matrix || !arrangement}
			<div class="skeleton" aria-hidden="true">
				{#each [0, 1, 2, 3, 4, 5] as i (i)}<div></div>{/each}
			</div>
		{:else if matrix.items.length === 0}
			<EmptyState
				icon={Grid3x3}
				title="Nothing to compare yet"
				actions={[
					...(info && !info.builtin ? [{ label: 'Show what it covers', run: showSource }] : []),
					{ label: 'About views', run: () => ui.showHelp('concept-view') }
				]}
			>
				The view lists the {noun[1]} it exposes. Change its <code>expose</code> lines to name the
				element whose
				{noun[1]} to compare.
			</EmptyState>
		{:else if ui.phone && !gridOnPhone}
			<DsmList
				{matrix}
				order={arrangement.order}
				modules={arrangement.modules}
				{kinds}
				{impact}
				{impactFrom}
				unlinked={flags.unlinked}
				{selectedIndex}
				{name}
				canConnect={(i) => matrix?.elements === 'parts' && !matrix.items[i]?.inherited}
				onimpact={toggleImpact}
				onselect={select}
				onshowlink={showLink}
				onconnect={chooseTarget}
			/>
		{:else}
			<div class="detail" aria-live="polite">
				{#if shown}
					{@render cellDetail(shown.row, shown.column)}
				{:else}
					<p class="muted hint">
						Read across a row for what it leads to, down a column for what leads to it. {ui.phone
							? 'Tap a cell for its links'
							: 'Point at or select a cell for its links'}{matrix.elements === 'parts'
							? '; choose an empty one to connect two parts'
							: ''}.
					</p>
				{/if}
			</div>
			<DsmGrid
				{matrix}
				order={arrangement.order}
				modules={arrangement.modules}
				{cells}
				{impact}
				{impactFrom}
				untyped={flags.untyped}
				unlinked={flags.unlinked}
				{selectedIndex}
				{picked}
				{name}
				touch={ui.phone}
				onhot={(cell) => (hot = cell)}
				onpick={pick}
				onimpact={toggleImpact}
				onselect={select}
			/>
			<ul class="legend" aria-label="What the marks mean">
				{#if matrix.cells === 'names'}
					<li>
						Each cell: the interfaces between the two parts, and the items that pass from the row's
						part to the column's.
					</li>
				{:else}
					{#each matrix.available.filter((k) => kinds.includes(k)) as kind (kind)}
						<li>{@render mark(kind)} {KIND_WORDS[kind].legend}</li>
					{/each}
				{/if}
				<li><span class="mark diag" aria-hidden="true"></span> the element itself</li>
				{#if kinds.includes('connection')}
					<li>
						<span class="mark untyped" aria-hidden="true"><TriangleAlert size={11} /></span> no interface
						definition
					</li>
				{/if}
			</ul>
		{/if}
	</div>

	{#if relation}
		<RelationPopover
			source={relation.option.from.label}
			target={relation.option.to.label}
			options={[relation.option]}
			{ctx}
			x={relation.x}
			y={relation.y}
			sheet={ui.phone}
			onapply={applyPlan}
			onclose={() => (relation = null)}
		/>
	{/if}
</section>

{#if ui.phone && matrix}
	<SheetDialog
		bind:open={settingsOpen}
		title="What counts, and the order"
		description={editable ? 'Saved in the view, so the matrix stays part of the model.' : undefined}
	>
		<div class="sheet-settings">{@render settings()}</div>
		{#snippet footer()}
			<button type="button" class="done" onclick={() => (settingsOpen = false)}>Done</button>
		{/snippet}
	</SheetDialog>
	<SheetDialog
		bind:open={pickerOpen}
		title="Connect {connectFrom !== null ? itemLabel(matrix.items[connectFrom]!) : ''} to…"
		description="Choose the part to connect it to."
	>
		<ul class="targets">
			{#each arrangement?.order ?? [] as i (i)}
				{#if i !== connectFrom && connectFrom !== null}
					{@const why = cannotConnect(connectFrom, i)}
					<li>
						<button
							type="button"
							class="target"
							disabled={!!why}
							onclick={() => {
								const from = connectFrom!;
								pickerOpen = false;
								connect(from, i);
							}}
						>
							<Plus size={15} aria-hidden="true" />
							<span>{itemPathLabel(matrix, i)}</span>
							{#if cells.get(`${connectFrom}:${i}`)?.length}<span class="muted">linked already</span
								>{/if}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	</SheetDialog>
{/if}

<style>
	.dsm {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg);
	}
	.page {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
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
		flex-wrap: wrap;
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
		white-space: nowrap;
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
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
	}
	.kinds {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.tools-label {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		padding: 0 var(--space-3) 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text-2);
		font: inherit;
		font-size: var(--text-sm);
		white-space: nowrap;
		cursor: pointer;
	}
	.chip:hover:not(:disabled) {
		border-color: var(--border-strong);
	}
	.chip[aria-pressed='true'] {
		border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
		background: var(--accent-weak);
		color: var(--text);
		font-weight: 600;
	}
	.chip[aria-pressed='false'] .mark {
		opacity: 0.55;
	}
	.chip:disabled {
		cursor: default;
	}
	.segmented {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		overflow: hidden;
	}
	.segmented button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: var(--text-sm);
		white-space: nowrap;
		cursor: pointer;
	}
	.segmented button + button {
		border-left: 1px solid var(--border);
	}
	.segmented button[aria-pressed='true'] {
		background: var(--accent-weak);
		color: var(--text);
		font-weight: 600;
	}
	.io {
		margin-left: auto;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) 0.35em;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.summary strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: var(--space-2);
		padding: 1px 8px;
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.pill.warn {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.note {
		max-width: 75ch;
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--accent-weak);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.impact-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid color-mix(in oklab, var(--warn) 40%, var(--border));
		border-radius: var(--radius-md);
		background: var(--warn-weak);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.impact-banner p {
		flex: 1;
		min-width: 12rem;
	}
	.warnings {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--warn);
		font-size: var(--text-sm);
	}
	.state {
		padding: var(--space-4) var(--space-5);
		color: var(--text-2);
	}
	.skeleton {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
	}
	.skeleton div {
		height: 2.25rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}

	/* The cell under the pointer or focus, or the one chosen: a fixed height, so the grid stays put,
	   and in view while the page scrolls to the grid. */
	.detail {
		position: sticky;
		top: 0;
		z-index: 5;
		height: 5.25rem;
		margin: 0 var(--space-5) var(--space-2);
		box-shadow: 0 6px 10px -8px rgb(0 0 0 / 0.25);
		padding: var(--space-2) var(--space-3);
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		font-size: var(--text-sm);
	}
	.detail-head .muted {
		margin-left: 0.3em;
	}
	.muted {
		color: var(--text-2);
	}
	.hint {
		padding-top: var(--space-1);
	}
	.outside {
		margin-top: 2px;
	}
	.detail-links {
		display: grid;
		gap: 4px;
		margin: var(--space-1) 0 0;
		padding: 0;
		list-style: none;
	}
	.detail-links li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--space-2);
	}
	.detail-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.small {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.small:hover {
		border-color: var(--border-strong);
	}
	.small[aria-pressed='true'] {
		border-color: var(--warn);
		background: var(--warn-weak);
	}
	.small.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.flag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 7px;
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1.6;
	}

	/* A mark per kind of link: its letter, on the kind's colour. */
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
	.mark.diag {
		--k: var(--text-3);
		background: var(--surface-2);
	}
	.mark.untyped {
		--k: var(--warn);
		background: var(--warn-weak);
		color: var(--warn);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: var(--space-2) var(--space-5) var(--space-5);
		color: var(--text-2);
		font-size: var(--text-xs);
		list-style: none;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
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

	.settings {
		display: inline-flex;
		flex: 1 1 14rem;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.sheet-settings {
		display: grid;
		gap: var(--space-4);
	}
	.sheet-settings .chip,
	.sheet-settings .segmented button {
		min-height: 2.75rem;
	}
	.done {
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.targets {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.target {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.target:disabled {
		color: var(--text-3);
		cursor: default;
	}
	.target .muted {
		margin-left: auto;
		font-size: var(--text-xs);
	}

	/* --- Phones: the tools within thumb reach, 44px targets ------------------------------ */
	.phone .head {
		padding: var(--space-3) var(--space-3) var(--space-2);
	}
	.phone .chip,
	.phone .segmented button,
	.phone .source,
	.phone .small {
		min-height: 2.75rem;
	}
	.phone .io {
		margin-left: 0;
	}
	.phone .detail {
		margin: 0 var(--space-3) var(--space-2);
	}
	.phone .legend {
		padding: var(--space-2) var(--space-3) calc(6rem + var(--sheet-cover, 0px));
	}
	@media (max-width: 520px) {
		.button-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
	}
</style>
