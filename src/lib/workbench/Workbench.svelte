<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		CircleAlert,
		Code,
		Eye,
		Columns2,
		FileCode,
		Info,
		LayoutDashboard,
		ListChecks,
		LoaderCircle,
		Network,
		PanelRight,
		Search,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { elementAt } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
	import Toaster from '#lib/ui/Toaster.svelte';
	import Explorer from './Explorer.svelte';
	import HomeView from './HomeView.svelte';
	import Inspector from './Inspector.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import ViewTable from './ViewTable.svelte';
	import { presentationOf } from './views.ts';
	import {
		tabId,
		tabTitle,
		type FileLayout,
		type MobilePane,
		type WorkbenchUi
	} from './ui.svelte.ts';

	let { workspace, ui, engine }: { workspace: Workspace; ui: WorkbenchUi; engine: Engine } =
		$props();

	// The editor and diagram bring CodeMirror, Svelte Flow and ELK; load them
	// only when a file or diagram is first opened.
	const loadTextEditor = () => import('./TextEditor.svelte').then((m) => m.default);
	const loadDiagram = () => import('#lib/diagram/DiagramCanvas.svelte').then((m) => m.default);

	const tab = $derived(ui.activeTab);
	/** The package a file is about, for the diagram beside its text. */
	const filePackage = $derived.by(() => {
		if (tab?.kind !== 'file') return null;
		const root = workspace.tree.find(
			(n) => n.element.file === tab.path && n.element.kind === 'package'
		);
		return root?.element ?? null;
	});

	const errors = $derived(workspace.problems.filter((p) => p.severity === 'error').length);
	const warnings = $derived(workspace.problems.filter((p) => p.severity === 'warning').length);

	function openProblem(file: string, byte: number) {
		ui.open({ kind: 'file', path: file });
		const element = elementAt(workspace.elements, file, byte);
		if (element) ui.select(element.key, 'inspector');
	}

	const layouts: { id: FileLayout; label: string; icon: typeof Code }[] = [
		{ id: 'text', label: 'Text', icon: Code },
		{ id: 'split', label: 'Split', icon: Columns2 },
		{ id: 'diagram', label: 'Diagram', icon: Network }
	];
	const showText = $derived(ui.layout !== 'diagram' || !filePackage);
	const showDiagram = $derived(ui.layout !== 'text' && !!filePackage);

	const userElements = $derived(
		workspace.elements.filter((e) => !e.file.startsWith('libraries/')).length
	);
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

	function onkeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			ui.paletteOpen = !ui.paletteOpen;
		}
	}

	const panes: { id: MobilePane; label: string }[] = [
		{ id: 'explorer', label: 'Model' },
		{ id: 'editor', label: 'Editor' },
		{ id: 'inspector', label: 'Inspector' },
		{ id: 'problems', label: 'Problems' }
	];
</script>

<svelte:window {onkeydown} />

<div
	class="workbench"
	class:no-inspector={!ui.inspectorOpen}
	class:problems-open={ui.problemsOpen}
	data-pane={ui.mobilePane}
>
	<header class="topbar">
		<a class="brand" href={resolve('/')} aria-label="SysML Web home"><Logo size={24} /></a>
		<div class="project">
			<strong>{workspace.info?.name ?? 'Project'}</strong>
			{#if workspace.dirty.size}
				<span class="edited" title="Edited in this browser tab">{workspace.dirty.size} edited</span>
			{/if}
		</div>
		<button
			type="button"
			class="search"
			aria-haspopup="dialog"
			aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
			onclick={() => (ui.paletteOpen = true)}
		>
			<Search size={15} />
			<span class="search-label">Search the model, views, commands…</span>
			<kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
		</button>
		<button
			type="button"
			class="icon problems-toggle"
			aria-pressed={ui.problemsOpen}
			aria-label="Problems: {errors} errors, {warnings} warnings"
			onclick={() => (ui.problemsOpen = !ui.problemsOpen)}
		>
			<TriangleAlert size={16} />
			<span class="badge" class:bad={errors > 0}>{errors + warnings}</span>
		</button>
		<button
			type="button"
			class="icon"
			aria-pressed={ui.inspectorOpen}
			aria-label="Inspector"
			onclick={() => (ui.inspectorOpen = !ui.inspectorOpen)}
		>
			<PanelRight size={17} />
		</button>
		<ThemeToggle />
	</header>

	<main class="panes">
		<h1 class="visually-hidden">{workspace.info?.name ?? 'Project'}</h1>
		<div class="pane explorer-pane">
			<Explorer {workspace} {ui} />
		</div>

		<section class="pane editor-pane" aria-label="Editor">
			<div class="tabbar">
				<ul class="tabs" aria-label="Open editors">
					{#each ui.tabs as t, i (tabId(t))}
						<li class="tab" class:active={i === ui.active}>
							<button
								type="button"
								class="tab-button"
								aria-current={i === ui.active ? 'true' : undefined}
								onclick={() => (ui.active = i)}
							>
								{#if t.kind === 'home'}<LayoutDashboard size={14} />
								{:else if t.kind === 'requirements'}<ListChecks size={14} />
								{:else if t.kind === 'diagram'}<Network size={14} />
								{:else if t.kind === 'view'}<Eye size={14} />
								{:else}<FileCode size={14} />{/if}
								<span>{tabTitle(t)}</span>
								{#if t.kind === 'file' && workspace.dirty.has(t.path)}<span
										class="dot"
										aria-label="edited"
									></span>{/if}
							</button>
							<button
								type="button"
								class="close"
								aria-label="Close {tabTitle(t)}"
								onclick={() => ui.close(i)}
							>
								<X size={13} />
							</button>
						</li>
					{/each}
				</ul>
				{#if tab?.kind === 'file' && filePackage}
					<div class="segmented" role="group" aria-label="Show the model as">
						{#each layouts as l (l.id)}
							<button
								type="button"
								aria-pressed={ui.layout === l.id}
								title="{l.label} view"
								onclick={() => (ui.layout = l.id)}
							>
								<l.icon size={14} />
								<span>{l.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="tab-body">
				{#if !tab}
					<p class="empty">Open a file or view from the explorer.</p>
				{:else if tab.kind === 'home'}
					<HomeView {workspace} {ui} />
				{:else if tab.kind === 'requirements'}
					<ViewTable name="RequirementsTable" {workspace} {ui} {engine} />
				{:else if tab.kind === 'view'}
					{@const info = workspace.views.find((v) => v.name === tab.name)}
					{@const presentation = info ? presentationOf(info) : { kind: 'table' as const }}
					{#if presentation.kind === 'table'}
						{#key tab.name}
							<ViewTable name={tab.name} {workspace} {ui} {engine} />
						{/key}
					{:else if presentation.kind === 'diagram'}
						{#key tabId(tab)}
							{#await loadDiagram()}
								<p class="empty">Loading the diagram…</p>
							{:then DiagramCanvas}
								<DiagramCanvas
									view={presentation.view}
									scope={presentation.scope}
									label="{tab.title} diagram"
									{workspace}
									{ui}
									{engine}
								/>
							{/await}
						{/key}
					{:else}
						<p class="empty">
							This kind of view ({info?.definition ?? 'unknown'}) cannot be drawn here yet.
						</p>
					{/if}
				{:else if tab.kind === 'diagram'}
					{#key tabId(tab)}
						{#await loadDiagram()}
							<p class="empty">Loading the diagram…</p>
						{:then DiagramCanvas}
							<DiagramCanvas
								view={tab.view}
								scope={tab.scope}
								label="{tab.title} diagram"
								{workspace}
								{ui}
								{engine}
							/>
						{/await}
					{/key}
				{:else}
					<div class="split" class:single={!showText || !showDiagram}>
						{#key tab.path}
							<div class="text" class:hidden={!showText}>
								{#await loadTextEditor()}
									<p class="empty">Loading the editor…</p>
								{:then TextEditor}
									<TextEditor path={tab.path} {workspace} {ui} {engine} />
								{/await}
							</div>
						{/key}
						{#if showDiagram && filePackage}
							<div class="diagram">
								{#key filePackage.key}
									{#await loadDiagram() then DiagramCanvas}
										<DiagramCanvas
											view="general"
											scope={filePackage.name}
											label="{filePackage.label} diagram"
											{workspace}
											{ui}
											{engine}
										/>
									{/await}
								{/key}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<div class="pane inspector-pane">
			<Inspector {workspace} {ui} />
		</div>

		<section class="pane problems-pane" aria-label="Problems">
			<header>
				<h2>Problems</h2>
				<span>{errors} errors · {warnings} warnings</span>
			</header>
			<ul>
				{#each workspace.problems.filter((p) => p.severity !== 'note') as p, i (i)}
					<li>
						<button
							type="button"
							class={p.severity}
							onclick={() => openProblem(p.file, p.span.start_byte)}
						>
							{#if p.severity === 'error'}<CircleAlert
									size={14}
								/>{:else if p.severity === 'warning'}<TriangleAlert size={14} />{:else}<Info
									size={14}
								/>{/if}
							<span class="msg">{p.message}</span>
							<span class="loc">{p.file}:{p.span.start_row}</span>
						</button>
					</li>
				{:else}
					<li class="none">No problems. The model is consistent.</li>
				{/each}
			</ul>
		</section>
	</main>

	<footer class="statusbar">
		<span class="state" role="status" aria-live="polite">
			{#if workspace.state.phase === 'loading'}
				<LoaderCircle size={13} class="spin" /> Reading {workspace.state.done}/{workspace.state
					.total}
			{:else if workspace.state.phase === 'ready'}
				<span class="ok-dot" aria-hidden="true"></span> Model ready
			{:else if workspace.state.phase === 'error'}
				<CircleAlert size={13} /> Engine error
			{/if}
		</span>
		{#if workspace.state.phase === 'ready'}
			<span class="meta">{userElements} elements</span>
			<span class="meta">{workspace.requirements.length} requirements</span>
		{/if}
		<button
			type="button"
			class="problems-chip"
			aria-pressed={ui.problemsOpen}
			onclick={() => (ui.problemsOpen = !ui.problemsOpen)}
		>
			<span class="visually-hidden">Problems:</span>
			<CircleAlert size={13} class={errors ? 'bad' : ''} />
			{errors}<span class="visually-hidden">errors,</span>
			<TriangleAlert size={13} class={warnings ? 'warn' : ''} />
			{warnings}<span class="visually-hidden">warnings</span>
		</button>
		<span class="grow"></span>
		{#if workspace.dirty.size}
			<span class="meta edited-files">{workspace.dirty.size} edited in this tab</span>
		{/if}
		<span class="meta"
			>SysML v2{workspace.engineVersion ? ` · engine ${workspace.engineVersion}` : ''}</span
		>
	</footer>

	<Toaster />
	<CommandPalette {workspace} {ui} />

	<nav class="mobile-bar" aria-label="Panes">
		{#each panes as pane (pane.id)}
			<button
				type="button"
				aria-pressed={ui.mobilePane === pane.id}
				onclick={() => (ui.mobilePane = pane.id)}
			>
				{pane.label}
			</button>
		{/each}
	</nav>
</div>

<style>
	.workbench {
		display: grid;
		grid-template-columns: 16.5rem minmax(0, 1fr) 20rem;
		grid-template-rows: var(--topbar-height) minmax(0, 1fr) auto auto;
		grid-template-areas:
			'top top top'
			'explorer editor inspector'
			'explorer problems inspector'
			'status status status';
		height: 100dvh;
		background: var(--bg);
	}
	.workbench.no-inspector {
		grid-template-columns: 16.5rem minmax(0, 1fr) 0;
	}
	.no-inspector .inspector-pane {
		display: none;
	}
	.panes {
		display: contents;
	}
	.topbar {
		grid-area: top;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-3);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.brand {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-sm);
	}
	.project {
		flex: 1 1 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}
	.project strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.edited {
		color: var(--warn);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.search {
		flex: 0 1 30rem;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.25rem;
		min-width: 0;
		margin-right: auto;
		padding: 0 var(--space-2) 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg);
		color: var(--text-3);
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			border-color var(--duration) var(--ease),
			box-shadow var(--duration) var(--ease);
	}
	.search:hover {
		border-color: var(--border-strong);
		box-shadow: var(--shadow-sm);
		color: var(--text-2);
	}
	.search-label {
		flex: 1;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	kbd {
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		color: var(--text-2);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
	}
	.statusbar {
		grid-area: status;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: 1.75rem;
		padding: 0 var(--space-3);
		border-top: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.statusbar .state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text);
	}
	.statusbar .grow {
		flex: 1;
	}
	.problems-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 1.375rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font-size: inherit;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.problems-chip:hover,
	.problems-chip[aria-pressed='true'] {
		background: var(--surface-hover);
	}
	.problems-chip :global(.bad) {
		color: var(--danger);
	}
	.problems-chip :global(.warn) {
		color: var(--warn);
	}
	.edited-files {
		color: var(--warn);
	}
	.tabbar {
		display: flex;
		flex: none;
		align-items: center;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.segmented {
		display: flex;
		flex: none;
		gap: 2px;
		margin: 0 var(--space-2);
		padding: 2px;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.segmented button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 1.75rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: calc(var(--radius-sm) - 2px);
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 560;
		cursor: pointer;
	}
	.segmented button[aria-pressed='true'] {
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		color: var(--text);
	}
	.hidden {
		display: none;
	}
	:global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.ok-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 2.25rem;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.icon[aria-pressed='true'] {
		color: var(--accent);
	}
	.badge {
		min-width: 1.25rem;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.badge.bad {
		color: var(--danger);
	}
	.pane {
		min-width: 0;
		min-height: 0;
		background: var(--surface);
	}
	.explorer-pane {
		grid-area: explorer;
		border-right: 1px solid var(--border);
	}
	.inspector-pane {
		grid-area: inspector;
		border-left: 1px solid var(--border);
	}
	.editor-pane {
		grid-area: editor;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	.tabs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}
	.tab {
		display: flex;
		align-items: center;
		border-right: 1px solid var(--border);
		color: var(--text-2);
	}
	.tab.active {
		background: var(--bg);
		color: var(--text);
		box-shadow: inset 0 -2px 0 var(--accent);
	}
	.tab button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2.375rem;
		border: 0;
		background: transparent;
		color: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	.tab .tab-button {
		padding: 0 var(--space-1) 0 var(--space-3);
	}
	.tab .close {
		width: 1.75rem;
		justify-content: center;
		color: var(--text-3);
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--warn);
	}
	.tab-body {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		height: 100%;
	}
	.split.single {
		grid-template-columns: minmax(0, 1fr);
	}
	.split .text {
		min-width: 0;
		min-height: 0;
		border-right: 1px solid var(--border);
	}
	.split .diagram {
		min-width: 0;
		min-height: 0;
	}
	.empty {
		padding: var(--space-6);
		color: var(--text-3);
	}
	.problems-pane {
		grid-area: problems;
		display: none;
		max-height: 13rem;
		overflow-y: auto;
		border-top: 1px solid var(--border);
	}
	.problems-open .problems-pane {
		display: block;
	}
	.problems-pane header {
		position: sticky;
		top: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.problems-pane h2 {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	.problems-pane header span {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.problems-pane ul {
		list-style: none;
		margin: 0;
		padding: var(--space-1) 0;
	}
	.problems-pane button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.problems-pane button:hover {
		background: var(--surface-hover);
	}
	.problems-pane .error :global(svg) {
		color: var(--danger);
	}
	.problems-pane .warning :global(svg) {
		color: var(--warn);
	}
	.msg {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.loc {
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.none {
		padding: var(--space-3);
		color: var(--text-3);
	}
	.mobile-bar {
		display: none;
	}
	.problems-toggle {
		display: none;
	}

	@media (max-width: 1100px) {
		.workbench,
		.workbench.no-inspector {
			grid-template-columns: 14rem minmax(0, 1fr);
			grid-template-areas:
				'top top'
				'explorer editor'
				'explorer problems'
				'status status';
		}
		.inspector-pane {
			display: none;
		}
		.split {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		}
		.split .text {
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}
	}

	@media (max-width: 760px) {
		.workbench,
		.workbench.no-inspector {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: var(--topbar-height) minmax(0, 1fr) auto auto;
			grid-template-areas: 'top' 'main' 'status' 'bar';
		}
		.search {
			flex: 0 0 auto;
			margin-left: auto;
			padding: 0 var(--space-2);
			border: 0;
			background: transparent;
		}
		.search-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.search kbd,
		.statusbar .meta,
		.statusbar .problems-chip {
			display: none;
		}
		.problems-toggle {
			display: inline-flex;
		}
		.segmented span {
			display: none;
		}
		.pane,
		.problems-open .problems-pane {
			display: none;
			grid-area: main;
			border: 0;
		}
		.workbench[data-pane='explorer'] .explorer-pane,
		.workbench[data-pane='inspector'] .inspector-pane,
		.workbench[data-pane='problems'] .problems-pane {
			display: block;
			max-height: none;
		}
		.workbench[data-pane='editor'] .editor-pane {
			display: flex;
		}
		.mobile-bar {
			grid-area: bar;
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			border-top: 1px solid var(--border);
			background: var(--surface);
			padding-bottom: env(safe-area-inset-bottom);
		}
		.mobile-bar button {
			height: 3rem;
			border: 0;
			background: transparent;
			color: var(--text-2);
			font-weight: 560;
			cursor: pointer;
		}
		.mobile-bar button[aria-pressed='true'] {
			color: var(--accent);
			box-shadow: inset 0 2px 0 var(--accent);
		}
	}
</style>
