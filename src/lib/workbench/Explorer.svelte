<script lang="ts">
	import {
		BookLock,
		ChevronRight,
		FilePlus,
		FileText,
		LayoutDashboard,
		ListChecks,
		Network,
		Play,
		Plus,
		Scale,
		Search,
		Table2
	} from '@lucide/svelte';
	import type { TreeNode } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import type { LibraryEntry, LibraryHit } from '#lib/engine/types.ts';
	import { libraryIndex, librarySearch } from '#lib/library/library.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { elementItems, modelViewItems, rank, type PaletteItem } from './palette.ts';
	import { groupViews, presentationOf, viewTitle } from './views.ts';
	import { reportEntries, reportKindOf } from '#lib/reports/kinds.ts';
	import FilesPanel from './files/FilesPanel.svelte';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	/** The OMG standard library, listed once it is opened (read in the library worker). */
	let standardOpen = $state(false);
	let standardIndex = $state.raw<LibraryEntry[]>([]);
	$effect(() => {
		if (standardOpen && !standardIndex.length) {
			void libraryIndex().then((index) => (standardIndex = index));
		}
	});
	const standardGroups = $derived.by(() => {
		const groups: Record<string, LibraryEntry[]> = {};
		for (const entry of standardIndex) {
			const folder = entry.path.includes('/')
				? entry.path.slice(0, entry.path.lastIndexOf('/'))
				: '';
			(groups[folder] ??= []).push(entry);
		}
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
	});

	/** While filtering, matching definitions from the standard library too. */
	let libraryHits = $state.raw<LibraryHit[]>([]);
	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			libraryHits = [];
			return;
		}
		const timer = setTimeout(() => {
			void librarySearch(q, 12).then((hits) => {
				if (query.trim() === q) libraryHits = hits;
			});
		}, 150);
		return () => clearTimeout(timer);
	});

	let mode = $state<'model' | 'files'>('model');
	let query = $state('');
	let expanded = $state<Record<string, boolean>>({});
	let librariesOpen = $state(false);
	const ready = $derived(workspace.state.phase === 'ready');

	const userRoots = $derived(workspace.tree.filter((n) => !isLibraryFile(n.element.file)));
	const libraryRoots = $derived(workspace.tree.filter((n) => isLibraryFile(n.element.file)));
	const packages = $derived(userRoots.filter((n) => n.element.kind === 'package'));
	/** Views saved in the project's model (diagrams, tables and documents), by family. */
	const savedViews = $derived(
		workspace.views
			.filter((v) => v.isUsage && !v.builtin && !isLibraryFile(v.file))
			.map((v) => ({ info: v, presentation: presentationOf(v), report: !!reportKindOf(v) }))
			.filter((v) => v.presentation.kind !== 'none' || v.report)
	);
	const viewGroups = $derived(groupViews(savedViews, (v) => v.info));
	/** The "New" menu (a view, a trade study). */
	let newOpen = $state(false);
	function create(request: NonNullable<WorkbenchUi['create']>) {
		newOpen = false;
		ui.create = request;
	}
	function newFile() {
		newOpen = false;
		ui.fileRequest = { kind: 'new' };
	}
	/** The standard reports the project hasn't saved (saved ones are under Documents). */
	const reports = $derived(reportEntries(workspace.views, isLibraryFile).filter((r) => !r.saved));
	let packagesOpen = $state(false);

	const needle = $derived(query.trim().toLowerCase());

	/** While filtering: matching elements and views, best first, at the top. */
	const RESULT_LIMIT = 60;
	const searchResults = $derived.by(() => {
		if (!needle) return [];
		const own = workspace.elements.filter((e) => !isLibraryFile(e.file));
		let hits = rank(elementItems(own, isLibraryFile), needle);
		if (!hits.length) {
			const library = workspace.elements.filter((e) => isLibraryFile(e.file));
			hits = rank(elementItems(library, isLibraryFile), needle);
		}
		return [...rank(modelViewItems(workspace.views), needle), ...hits]
			.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
			.slice(0, RESULT_LIMIT);
	});

	function openResult(item: PaletteItem) {
		const action = item.action;
		if (action.type === 'element') {
			// Phones show the element's details over the tree rather than leaving it.
			if (!ui.phone) ui.open({ kind: 'file', path: action.file });
			ui.select(action.key, 'explorer');
		} else if (action.type === 'open') {
			ui.open(action.tab);
		}
	}
	function matches(node: TreeNode): boolean {
		if (!needle) return true;
		const e = node.element;
		return (
			e.label.toLowerCase().includes(needle) ||
			(e.shortName?.toLowerCase().includes(needle) ?? false) ||
			node.children.some(matches)
		);
	}

	function isOpen(node: TreeNode, depth: number): boolean {
		return needle ? true : (expanded[node.element.key] ?? (depth < 1 && openRoots));
	}

	/**
	 * Large models: top-level packages start closed when there are many, and a
	 * long list shows its first entries with a button for the rest, so the
	 * tree never puts tens of thousands of rows on the page at once.
	 */
	const OPEN_ROOTS = 30;
	const PAGE = 200;
	const openRoots = $derived(userRoots.length <= OPEN_ROOTS);
	/** How many entries each list shows, by its owner's key ('' for the top level). */
	let shownCount = $state<Record<string, number>>({});
</script>

{#snippet tree(nodes: TreeNode[], depth: number, owner: string)}
	{@const listed = nodes.filter(matches)}
	{@const limit = shownCount[owner] ?? PAGE}
	<ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Model' : undefined}>
		{#each listed.length > limit ? listed.slice(0, limit) : listed as node (node.element.key)}
			{@const open = isOpen(node, depth)}
			{@const hasChildren = node.children.length > 0}
			<li
				role="treeitem"
				aria-expanded={hasChildren ? open : undefined}
				aria-selected={ui.selection?.key === node.element.key}
			>
				<div class="row" style:padding-left="{0.375 + depth * 0.875}rem">
					{#if hasChildren}
						<button
							type="button"
							class="twisty"
							class:open
							aria-label="{open ? 'Collapse' : 'Expand'} {node.element.label}"
							onclick={() => (expanded[node.element.key] = !open)}
						>
							<ChevronRight size={14} />
						</button>
					{:else}
						<span class="twisty" aria-hidden="true"></span>
					{/if}
					<button
						type="button"
						class="item"
						class:selected={ui.selection?.key === node.element.key}
						onclick={() => ui.select(node.element.key, 'explorer')}
						ondblclick={() => ui.open({ kind: 'file', path: node.element.file })}
						title="{node.element.isDefinition
							? `${node.element.kind} def`
							: node.element.kind} {node.element.label}"
					>
						<KindGlyph kind={node.element.kind} isDefinition={node.element.isDefinition} />
						{#if node.element.shortName}<span class="id">{node.element.shortName}</span>{/if}
						<span class="label">{node.element.label}</span>
					</button>
				</div>
				{#if hasChildren && open}
					{@render tree(node.children, depth + 1, node.element.key)}
				{/if}
			</li>
		{/each}
		{#if listed.length > limit}
			{@const rest = listed.length - limit}
			<li role="treeitem" aria-selected="false">
				<div class="row" style:padding-left="{0.375 + depth * 0.875}rem">
					<span class="twisty" aria-hidden="true"></span>
					<button
						type="button"
						class="item more"
						onclick={() => (shownCount[owner] = limit + PAGE * 5)}
					>
						{rest <= PAGE * 5 ? `Show ${rest} more` : `Show ${PAGE * 5} more of ${rest}`}
					</button>
				</div>
			</li>
		{/if}
	</ul>
{/snippet}

<nav class="explorer" class:phone={ui.phone} aria-label="Explorer">
	<div class="head">
		<div class="tabs" role="tablist" aria-label="Explorer mode">
			<button role="tab" aria-selected={mode === 'model'} onclick={() => (mode = 'model')}
				>Model</button
			>
			<button role="tab" aria-selected={mode === 'files'} onclick={() => (mode = 'files')}
				>Files</button
			>
		</div>
		{#if mode === 'model'}
			<label class="search">
				<Search size={14} />
				<span class="visually-hidden">Filter the model</span>
				<input
					type="search"
					placeholder="Filter elements"
					enterkeyhint="search"
					bind:value={query}
					onkeydown={(e) => {
						// On a phone, the keyboard's search key puts the keyboard away.
						if (e.key === 'Enter' && ui.phone) e.currentTarget.blur();
					}}
				/>
			</label>
		{/if}
	</div>

	{#if mode === 'model'}
		{#if workspace.state.phase === 'error' && !workspace.elements.length}
			<p class="empty">The model could not be read. See Problems.</p>
		{:else if !ready}
			<p class="empty">Reading the model…</p>
		{:else if needle}
			<section aria-labelledby="results-heading" class="results">
				<h2 id="results-heading">
					{searchResults.length
						? `${searchResults.length}${searchResults.length === RESULT_LIMIT ? '+' : ''} results`
						: 'No matches'}
				</h2>
				<ul class="flat">
					{#each searchResults as { item } (item.id)}
						<li>
							<button
								type="button"
								class="item result"
								class:selected={item.action.type === 'element' &&
									ui.selection?.key === item.action.key}
								onclick={() => openResult(item)}
							>
								<KindGlyph kind={item.kind ?? 'part'} isDefinition={!!item.isDefinition} />
								{#if item.shortId}<span class="id">{item.shortId}</span>{/if}
								<span class="label">{item.label}</span>
								<span class="where">{item.keyword}</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if libraryHits.length}
					<h3>In the standard library</h3>
					<ul class="flat">
						{#each libraryHits as hit (hit.qualifiedName + hit.line)}
							<li>
								<button
									type="button"
									class="item result"
									title={hit.doc}
									onclick={() => ui.open({ kind: 'library', path: hit.path, line: hit.line })}
								>
									<KindGlyph
										kind={hit.kind.replace(/ def$/, '').replace(/ /g, '_')}
										isDefinition={hit.isDefinition}
									/>
									<span class="label">{hit.qualifiedName}</span>
									<span class="where">{hit.kind}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{:else}
			<!-- Phones list views in their own section (Views), so the tree comes first here. -->
			{#if !ui.phone}
				<section aria-labelledby="views-heading">
					<div class="section-head">
						<h2 id="views-heading">Views</h2>
						<button type="button" class="mini" onclick={() => create({ kind: 'view' })}>
							<Plus size={13} aria-hidden="true" /> New view
						</button>
					</div>
					<ul class="flat">
						<li>
							<button type="button" class="item" onclick={() => ui.open({ kind: 'home' })}>
								<LayoutDashboard size={14} /> <span class="label">Overview</span>
							</button>
						</li>
						<li>
							<button type="button" class="item" onclick={() => ui.open({ kind: 'requirements' })}>
								<ListChecks size={14} /> <span class="label">Requirements</span>
								<span class="count">{workspace.requirements.length}</span>
							</button>
						</li>
					</ul>
					{#each viewGroups as g (g.id)}
						<h3>{g.title}</h3>
						<ul class="flat">
							{#each g.views as v (v.info.name)}
								<li>
									<button
										type="button"
										class="item"
										title={v.info.doc}
										onclick={() =>
											ui.open({ kind: 'view', name: v.info.name, title: viewTitle(v.info.name) })}
									>
										{#if v.report}<FileText
												size={14}
											/>{:else if v.presentation.kind === 'table'}<Table2
												size={14}
											/>{:else}<Network size={14} />{/if}
										<span class="label">{viewTitle(v.info.name)}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<EmptyState
							compact
							title="No saved views yet"
							actions={[{ label: 'New view', primary: true, run: () => create({ kind: 'view' }) }]}
						>
							A view is a table, diagram, budget or report, saved in the model so it is always up to
							date.
						</EmptyState>
					{/each}
					{#if workspace.machines.length}
						<h3>Simulations</h3>
						<ul class="flat">
							{#each workspace.machines as m (m.qualifiedName ?? m.name)}
								<li>
									<button
										type="button"
										class="item"
										title={m.doc ?? `Run ${m.name} step by step`}
										onclick={() =>
											ui.open({
												kind: 'emulator',
												machine: m.qualifiedName ?? m.name,
												title: m.name
											})}
									>
										<Play size={14} /> <span class="label">Run {viewTitle(m.name)}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					{#if reports.length}
						<h3>Reports</h3>
						<ul class="flat">
							{#each reports as r (r.name)}
								<li>
									<button
										type="button"
										class="item"
										title={r.doc}
										onclick={() => ui.open({ kind: 'view', name: r.name, title: r.title })}
									>
										<FileText size={14} /> <span class="label">{r.title}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<details class="group" bind:open={packagesOpen}>
						<summary>Package diagrams</summary>
						{#if packagesOpen}
							<ul class="flat">
								{#each packages as p (p.element.key)}
									<li>
										<button
											type="button"
											class="item"
											onclick={() =>
												ui.open({
													kind: 'diagram',
													view: 'general',
													scope: p.element.name,
													title: p.element.label
												})}
										>
											<Network size={14} /> <span class="label">{p.element.label}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</details>
				</section>
			{/if}
			<section aria-labelledby="model-heading">
				<div class="section-head">
					<h2 id="model-heading">Model</h2>
					<!-- Escape or leaving the menu closes it. -->
					<div
						class="new-menu"
						role="presentation"
						onkeydown={(e) => {
							if (e.key === 'Escape' && newOpen) {
								newOpen = false;
								e.currentTarget.querySelector('button')?.focus();
							}
						}}
						onfocusout={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null)) newOpen = false;
						}}
					>
						<button
							type="button"
							class="mini"
							aria-expanded={newOpen}
							aria-controls="explorer-new"
							onclick={() => (newOpen = !newOpen)}
						>
							<Plus size={13} aria-hidden="true" /> New
						</button>
						{#if newOpen}
							<ul id="explorer-new" class="new-list" aria-label="New">
								<li>
									<button type="button" class="item" onclick={() => create({ kind: 'view' })}>
										<Table2 size={14} /> <span class="label">View…</span>
									</button>
								</li>
								<li>
									<button type="button" class="item" onclick={() => create({ kind: 'trade' })}>
										<Scale size={14} /> <span class="label">Trade study…</span>
									</button>
								</li>
								<li>
									<button type="button" class="item" onclick={newFile}>
										<FilePlus size={14} /> <span class="label">File…</span>
									</button>
								</li>
							</ul>
						{/if}
					</div>
				</div>
				{#if userRoots.length}
					{@render tree(userRoots, 0, '')}
				{:else}
					<EmptyState
						compact
						title="Nothing in the model yet"
						actions={[{ label: 'How to start', run: () => ui.showHelp('text-diagrams-tables') }]}
					>
						Write <code>package Name {'{ }'}</code> in a <code>.sysml</code> file under Files, and add
						parts and requirements inside it.
					</EmptyState>
				{/if}
			</section>
			{#if libraryRoots.length}
				<details class="libraries" bind:open={librariesOpen}>
					<summary>Project libraries</summary>
					{#if librariesOpen}{@render tree(libraryRoots, 0, 'libraries/')}{/if}
				</details>
			{/if}
			<details class="libraries" bind:open={standardOpen}>
				<summary>SysML standard library</summary>
				{#if standardOpen}
					{#if !standardIndex.length}
						<p class="empty">Reading the library…</p>
					{/if}
					{#each standardGroups as [folder, entries] (folder)}
						<details class="group">
							<summary>{folder || 'Library'}</summary>
							<ul class="flat">
								{#each entries as entry (entry.path)}
									<li>
										<button
											type="button"
											class="item"
											onclick={() => ui.open({ kind: 'library', path: entry.path })}
										>
											<BookLock size={14} />
											<span class="label">{entry.package}</span>
										</button>
									</li>
								{/each}
							</ul>
						</details>
					{/each}
				{/if}
			</details>
		{/if}
	{:else}
		<FilesPanel {workspace} {ui} />
	{/if}
</nav>

<style>
	.explorer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: 100%;
		overflow-y: auto;
		padding: var(--space-2);
		font-size: var(--text-sm);
	}
	.tabs {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.tabs button {
		flex: 1;
		height: 1.875rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-2);
		font-weight: 550;
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.search {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-3);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
	}
	h2 {
		margin: var(--space-2) var(--space-2) var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
	}
	.twisty {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.5rem;
		height: 1.75rem;
		border: 0;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
		transition: transform var(--duration) var(--ease);
	}
	.twisty.open {
		transform: rotate(90deg);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		min-height: 1.875rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.item.selected {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.count {
		min-width: 1.5rem;
		text-align: right;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		padding: var(--space-2);
		color: var(--text-3);
	}
	.result .where {
		margin-left: auto;
		padding-left: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	h3 {
		margin: var(--space-3) var(--space-2) var(--space-1);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 500;
	}
	.group summary {
		margin: var(--space-3) var(--space-2) var(--space-1);
		color: var(--text-3);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.libraries summary {
		margin: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.mini {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.75rem;
		margin-right: var(--space-1);
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.mini:hover,
	.mini[aria-expanded='true'] {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.new-menu {
		position: relative;
	}
	.new-list {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 5;
		width: 12rem;
		padding: var(--space-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	@media (pointer: coarse) {
		.item,
		.twisty,
		.mini {
			min-height: 2.75rem;
		}
	}
	.head {
		display: contents;
	}
	/* Phones: a full-screen browser of the model, sized for thumbs. */
	.phone .head {
		position: sticky;
		top: 0;
		z-index: 2;
		display: grid;
		gap: var(--space-2);
		margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) 0;
		padding: var(--space-3);
		background: color-mix(in oklab, var(--surface) 94%, transparent);
		backdrop-filter: blur(10px);
	}
	.phone {
		gap: var(--space-3);
		padding: var(--space-3) max(var(--space-3), env(safe-area-inset-right))
			calc(6rem + var(--sheet-cover, 0px)) max(var(--space-3), env(safe-area-inset-left));
		overscroll-behavior: contain;
		font-size: var(--text-md);
	}
	.phone .tabs {
		flex: none;
		padding: 3px;
		border-radius: 999px;
	}
	.phone .tabs button {
		height: 2.375rem;
		border-radius: 999px;
	}
	.phone .search {
		flex: none;
		height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: 999px;
		background: var(--surface-2);
	}
	.phone .search:focus-within {
		border-color: var(--accent);
	}
	.phone .item {
		min-height: 2.75rem;
		border-radius: var(--radius-md);
	}
	.phone .twisty {
		width: 2rem;
		min-height: 2.75rem;
	}
</style>
