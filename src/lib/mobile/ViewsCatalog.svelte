<script lang="ts">
	import {
		BookLock,
		ChevronRight,
		FileCode,
		FileText,
		Grid3x3,
		LayoutDashboard,
		ListChecks,
		Network,
		Play,
		Plus,
		Scale,
		ShieldAlert,
		Table2,
		TriangleAlert
	} from '@lucide/svelte';
	import type { LibraryEntry } from '#lib/engine/types.ts';
	import { libraryIndex } from '#lib/library/library.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import type { Tab, WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { groupViews, presentationOf, viewTitle } from '#lib/workbench/views.ts';
	import { reportEntries, reportKindOf } from '#lib/reports/kinds.ts';

	/**
	 * Everything that can be looked at, as large touch targets: the overview
	 * and requirements, the views saved in the model, simulations, package
	 * diagrams, the bundled tables, files and the standard library.
	 */
	let {
		workspace,
		ui,
		headingLevel = 2
	}: { workspace: Workspace; ui: WorkbenchUi; headingLevel?: 2 | 3 } = $props();

	const savedViews = $derived(
		workspace.views
			.filter((v) => v.isUsage && !v.builtin && !isLibraryFile(v.file))
			.map((v) => ({ info: v, presentation: presentationOf(v), report: !!reportKindOf(v) }))
			.filter((v) => v.presentation.kind !== 'none' || v.report)
	);
	const viewGroups = $derived(groupViews(savedViews, (v) => v.info));
	// Saved reports are under Documents; the standard ones the project hasn't saved here.
	const reports = $derived(reportEntries(workspace.views, isLibraryFile).filter((r) => !r.saved));
	const packages = $derived(
		workspace.tree.filter((n) => n.element.kind === 'package' && !isLibraryFile(n.element.file))
	);
	const files = $derived(workspace.paths.filter((p) => !isLibraryFile(p)));

	let libraryOpen = $state(false);
	let library = $state.raw<LibraryEntry[]>([]);
	$effect(() => {
		if (libraryOpen && !library.length) {
			void libraryIndex().then((index) => (library = index));
		}
	});

	function go(tab: Tab) {
		ui.open(tab);
	}
</script>

{#snippet row(
	icon: typeof Network,
	label: string,
	tab: Tab,
	detail?: string | number,
	tone = 'var(--kind-view)'
)}
	{@const Icon = icon}
	<li>
		<button type="button" class="row" onclick={() => go(tab)}>
			<span class="tile" style:--tone={tone}><Icon size={18} /></span>
			<span class="label">{label}</span>
			{#if detail !== undefined}<span class="detail">{detail}</span>{/if}
			<ChevronRight size={16} class="chev" />
		</button>
	</li>
{/snippet}

{#snippet heading(text: string)}
	{#if headingLevel === 2}<h2>{text}</h2>{:else}<h3>{text}</h3>{/if}
{/snippet}

<div class="catalog">
	<section>
		{@render heading('Start here')}
		<ul>
			{@render row(LayoutDashboard, 'Overview', { kind: 'home' }, undefined, 'var(--accent)')}
			{@render row(
				ListChecks,
				'Requirements',
				{ kind: 'requirements' },
				workspace.requirements.length,
				'var(--kind-requirement)'
			)}
		</ul>
	</section>

	<section>
		{@render heading('Make something new')}
		<ul>
			<li>
				<button type="button" class="row" onclick={() => (ui.create = { kind: 'view' })}>
					<span class="tile" style:--tone="var(--accent)"><Plus size={18} /></span>
					<span class="label">New view</span>
					<span class="detail">Table, diagram, budget</span>
				</button>
			</li>
			<li>
				<button type="button" class="row" onclick={() => (ui.create = { kind: 'trade' })}>
					<span class="tile" style:--tone="var(--kind-analysis)"><Scale size={18} /></span>
					<span class="label">New trade study</span>
				</button>
			</li>
			<li>
				<button type="button" class="row" onclick={() => (ui.create = { kind: 'fmea' })}>
					<span class="tile" style:--tone="var(--danger)"><ShieldAlert size={18} /></span>
					<span class="label">New FMEA</span>
					<span class="detail">Design, process, use</span>
				</button>
			</li>
			<li>
				<button type="button" class="row" onclick={() => (ui.create = { kind: 'hazard' })}>
					<span class="tile" style:--tone="var(--danger)"><TriangleAlert size={18} /></span>
					<span class="label">New hazard</span>
				</button>
			</li>
			<li>
				<button type="button" class="row" onclick={() => (ui.create = { kind: 'dsm' })}>
					<span class="tile" style:--tone="var(--kind-interface)"><Grid3x3 size={18} /></span>
					<span class="label">New DSM</span>
					<span class="detail">Dependency matrix, N² chart</span>
				</button>
			</li>
		</ul>
	</section>

	{#each viewGroups as g (g.id)}
		<section>
			{@render heading(g.title)}
			<ul>
				{#each g.views as v (v.info.name)}
					{@render row(
						v.report
							? FileText
							: v.presentation.kind === 'table'
								? Table2
								: v.presentation.kind === 'matrix'
									? Grid3x3
									: Network,
						viewTitle(v.info.name),
						{ kind: 'view', name: v.info.name, title: viewTitle(v.info.name) },
						v.report
							? 'Document'
							: v.presentation.kind === 'table'
								? 'Table'
								: v.presentation.kind === 'matrix'
									? 'Matrix'
									: 'Diagram'
					)}
				{/each}
			</ul>
		</section>
	{/each}

	{#if workspace.machines.length}
		<section>
			{@render heading('Simulations')}
			<ul>
				{#each workspace.machines as m (m.qualifiedName ?? m.name)}
					{@render row(
						Play,
						`Run ${viewTitle(m.name)}`,
						{ kind: 'emulator', machine: m.qualifiedName ?? m.name, title: m.name },
						undefined,
						'var(--kind-behavior)'
					)}
				{/each}
			</ul>
		</section>
	{/if}

	{#if packages.length}
		<section>
			{@render heading('Package diagrams')}
			<ul>
				{#each packages as p (p.element.key)}
					{@render row(
						Network,
						p.element.label,
						{ kind: 'diagram', view: 'general', scope: p.element.name, title: p.element.label },
						undefined,
						'var(--kind-package)'
					)}
				{/each}
			</ul>
		</section>
	{/if}

	{#if reports.length}
		<section>
			{@render heading('Reports')}
			<ul>
				{#each reports as r (r.name)}
					{@render row(
						FileText,
						r.title,
						{ kind: 'view', name: r.name, title: r.title },
						r.saved ? 'Saved' : 'Standard',
						'var(--kind-view)'
					)}
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		{@render heading('Files')}
		<ul>
			{#each files as path (path)}
				{@render row(
					path.endsWith('.md') ? FileText : FileCode,
					path.split('/').pop() ?? path,
					{ kind: 'file', path },
					path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined,
					'var(--text-3)'
				)}
			{/each}
		</ul>
	</section>

	<section>
		<details bind:open={libraryOpen}>
			<summary>SysML standard library</summary>
			{#if libraryOpen && !library.length}
				<p class="empty">Reading the library…</p>
			{/if}
			<ul>
				{#each library as entry (entry.path)}
					{@render row(
						BookLock,
						entry.package,
						{ kind: 'library', path: entry.path },
						entry.path.includes('/') ? entry.path.slice(0, entry.path.indexOf('/')) : undefined,
						'var(--text-3)'
					)}
				{/each}
			</ul>
		</details>
	</section>
</div>

<style>
	.catalog {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
	}
	h2,
	h3,
	summary {
		margin: 0 var(--space-1) var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	summary {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		cursor: pointer;
	}
	ul {
		display: grid;
		margin: 0;
		padding: 0;
		overflow: hidden;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	li + li {
		border-top: 1px solid var(--border);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 3.25rem;
		padding: var(--space-2) var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
		transition: background var(--duration) var(--ease);
	}
	.row:active {
		background: var(--surface-hover);
	}
	.tile {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.125rem;
		height: 2.125rem;
		border-radius: 10px;
		background: color-mix(in oklab, var(--tone) 14%, var(--surface));
		color: var(--tone);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 550;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detail {
		flex: none;
		max-width: 40%;
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row :global(.chev) {
		flex: none;
		color: var(--text-3);
	}
	.empty {
		padding: var(--space-3);
		color: var(--text-2);
	}
</style>
