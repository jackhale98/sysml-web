<script lang="ts">
	import { untrack } from 'svelte';
	import {
		BookLock,
		ChevronsUpDown,
		CircleAlert,
		Code,
		Eye,
		Columns2,
		Ellipsis,
		FileCode,
		GitBranch,
		GitCompareArrows,
		Info,
		LayoutDashboard,
		ListChecks,
		LoaderCircle,
		Network,
		PanelRight,
		Play,
		Plus,
		Search,
		Settings,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { Diagnostic, DiagramView } from '#lib/engine/types.ts';
	import { elementAt } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import OfflineBadge from '#lib/offline/OfflineBadge.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
	import Toaster from '#lib/ui/Toaster.svelte';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import Explorer from './Explorer.svelte';
	import ProjectMenu from './ProjectMenu.svelte';
	import { settings } from '#lib/settings/settings.svelte.ts';
	import HomeView from './HomeView.svelte';
	import Inspector from './Inspector.svelte';
	import { duplicateAndSelect } from './actions.ts';
	import DocumentView from '#lib/markdown/DocumentView.svelte';
	import ViewTable from './ViewTable.svelte';
	import { presentationOf } from './views.ts';
	import { reportKindOf, standardReport } from '#lib/reports/kinds.ts';
	import { tabId, tabTitle, type FileLayout, type WorkbenchUi } from './ui.svelte.ts';
	import AddSheet from '#lib/mobile/AddSheet.svelte';
	import DetailsSheet from '#lib/mobile/DetailsSheet.svelte';
	import { trackViewport } from '#lib/mobile/media.svelte.ts';
	import MobileNav, { type Section } from '#lib/mobile/MobileNav.svelte';
	import MoreMenu from '#lib/mobile/MoreMenu.svelte';
	import ProblemsSheet from '#lib/mobile/ProblemsSheet.svelte';
	import TabIcon from '#lib/mobile/TabIcon.svelte';
	import ViewsCatalog from '#lib/mobile/ViewsCatalog.svelte';
	import ViewsDrawer from '#lib/mobile/ViewsDrawer.svelte';
	import { reviewMarks } from '#lib/review/marks.svelte.ts';

	let {
		workspace,
		ui,
		engine,
		session
	}: { workspace: Workspace; ui: WorkbenchUi; engine: Engine; session?: ProjectSession } = $props();

	// The editor and diagram bring CodeMirror, Svelte Flow and ELK; load them
	// only when a file or diagram is first opened.
	const loadTextEditor = () => import('./TextEditor.svelte').then((m) => m.default);
	const loadCanvas = () => import('#lib/diagram/DiagramCanvas.svelte').then((m) => m.default);
	// A sequence diagram is drawn by its own canvas, without Svelte Flow and ELK.
	const loadSequence = () => import('#lib/diagram/SequenceCanvas.svelte').then((m) => m.default);
	const loadDiagram = (view?: DiagramView) => (view === 'sequence' ? loadSequence() : loadCanvas());
	// Dialogs mount on first use and then stay, so they keep their state.
	let palettePrimed = $state(false);
	let sourceControlPrimed = $state(false);
	let settingsPrimed = $state(false);
	let importPrimed = $state(false);
	let exportJsonPrimed = $state(false);
	let apiServerPrimed = $state(false);
	let createPrimed = $state(false);
	let filesPrimed = $state(false);
	let elementsPrimed = $state(false);
	let helpPrimed = $state(false);
	let addPrimed = $state(false);
	$effect(() => {
		if (ui.create) createPrimed = true;
		if (ui.fileRequest) filesPrimed = true;
		if (ui.elementRequest) elementsPrimed = true;
		if (ui.helpOpen) helpPrimed = true;
		if (ui.addSheet) addPrimed = true;
		if (ui.paletteOpen) palettePrimed = true;
		if (ui.sourceControlOpen) sourceControlPrimed = true;
		if (ui.settingsOpen) settingsPrimed = true;
		if (ui.importOpen) importPrimed = true;
		if (ui.exportJsonOpen) exportJsonPrimed = true;
		if (ui.apiServerOpen) apiServerPrimed = true;
	});
	const loadEmulator = () => import('#lib/sim/StateEmulator.svelte').then((m) => m.default);
	const loadLibraryFile = () => import('./LibraryFile.svelte').then((m) => m.default);
	const loadReport = () => import('#lib/reports/ReportView.svelte').then((m) => m.default);
	const loadMatrix = () => import('./DsmView.svelte').then((m) => m.default);
	const loadReview = () => import('#lib/review/ReviewView.svelte').then((m) => m.default);

	// Tabs follow a file that is renamed or moved, and close when it goes.
	$effect(() => workspace.onFileMoved((from, to) => ui.followFile(from, to)));

	// Review mode lasts while its tab is open, and ends with the page.
	$effect(() => {
		if (reviewMarks.active && !ui.tabs.some((t) => t.kind === 'review'))
			untrack(() => reviewMarks.end());
	});
	$effect(() => () => reviewMarks.end());

	// Deep link: `#emulate=Package::Machine` opens the emulator once the model is read.
	$effect(() => {
		if (workspace.state.phase !== 'ready') return;
		const match = /^#emulate=(.+)$/.exec(location.hash);
		if (!match) return;
		const machine = decodeURIComponent(match[1]!);
		history.replaceState(null, '', location.pathname + location.search);
		ui.open({ kind: 'emulator', machine, title: machine.split('::').pop() ?? machine });
	});

	const tab = $derived(ui.activeTab);
	/** The package a file is about, for the diagram beside its text. */
	const filePackage = $derived.by(() => {
		if (tab?.kind !== 'file') return null;
		const root = workspace.tree.find(
			(n) => n.element.file === tab.path && n.element.kind === 'package'
		);
		return root?.element ?? null;
	});

	/** The problems listed (a broken large model can have thousands: the first 500, errors first). */
	const PROBLEMS_LISTED = 500;
	const listedProblems = $derived(workspace.problems.filter((p) => p.severity !== 'note'));
	const errors = $derived(workspace.problems.filter((p) => p.severity === 'error').length);
	const warnings = $derived(workspace.problems.filter((p) => p.severity === 'warning').length);

	/** The package of the view on show, for adding elements to it. */
	const viewPackage = $derived.by(() => {
		if (filePackage) return filePackage;
		const scope = tab?.kind === 'diagram' ? tab.scope : null;
		return scope
			? (workspace.elements.find((e) => e.kind === 'package' && e.name === scope) ?? null)
			: null;
	});

	function openProblem(problem: Diagnostic) {
		const { file, span } = problem;
		if (!file) return; // about the engine, not a file
		const element = elementAt(workspace.elements, file, span.start_byte);
		// A requirement the design doesn't meet is about a statement (the `satisfy`): show it.
		if (problem.code === 'check' && span.from !== undefined && span.to !== undefined) {
			if (element) ui.select(element.key, 'text');
			ui.revealText(file, span.from, span.to);
			return;
		}
		ui.open({ kind: 'file', path: file });
		if (element) ui.select(element.key, 'inspector');
	}

	const layouts: { id: FileLayout; label: string; icon: typeof Code }[] = [
		{ id: 'text', label: 'Text', icon: Code },
		{ id: 'split', label: 'Split', icon: Columns2 },
		{ id: 'diagram', label: 'Diagram', icon: Network }
	];
	/**
	 * Phones show one thing at a time. A file opens as its diagram (viewing
	 * and editing by touch); its text is the second choice.
	 */
	const phone = $derived(ui.phone);
	const layout: FileLayout = $derived(
		phone
			? tab?.kind === 'file'
				? (ui.fileLayouts[tab.path] ?? settings.phoneStart)
				: 'diagram'
			: ui.layout
	);
	const layoutChoices = $derived(phone ? [layouts[2]!, layouts[0]!] : layouts);
	function chooseLayout(id: FileLayout) {
		if (phone && tab?.kind === 'file')
			ui.fileLayouts[tab.path] = id === 'text' ? 'text' : 'diagram';
		else ui.layout = id;
	}
	const showText = $derived(layout !== 'diagram' || !filePackage);
	const showDiagram = $derived(layout !== 'text' && !!filePackage);

	// ── The text and diagram side by side: a divider sets how much each gets ──
	const SPLIT_KEY = 'fairtide:split';
	/** The text's share of the split, in percent (the diagram has the rest). */
	let splitShare = $state(readSplit());
	/** Side by side on wide screens; text above the diagram below 1100 px. */
	let splitStacked = $state(false);
	let splitBox = $state<HTMLDivElement>();
	let splitDragging = $state(false);

	function readSplit(): number {
		try {
			const stored = Number(localStorage.getItem(SPLIT_KEY));
			return stored >= 20 && stored <= 80 ? stored : 50;
		} catch {
			return 50;
		}
	}
	function setSplit(share: number) {
		splitShare = Math.round(Math.min(80, Math.max(20, share)));
		try {
			localStorage.setItem(SPLIT_KEY, String(splitShare));
		} catch {
			// Private mode: the position lasts for this visit.
		}
	}
	$effect(() => {
		const query = matchMedia('(max-width: 1100px)');
		splitStacked = query.matches;
		const change = () => (splitStacked = query.matches);
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	});
	function dragSplit(event: PointerEvent) {
		if (event.button !== 0 || !splitBox) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		splitDragging = true;
		const box = splitBox.getBoundingClientRect();
		const move = (e: PointerEvent) =>
			setSplit(
				splitStacked
					? ((e.clientY - box.top) / box.height) * 100
					: ((e.clientX - box.left) / box.width) * 100
			);
		const end = () => {
			splitDragging = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', end);
			handle.removeEventListener('pointercancel', end);
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', end);
		handle.addEventListener('pointercancel', end);
	}
	function splitKey(event: KeyboardEvent) {
		const back = splitStacked ? 'ArrowUp' : 'ArrowLeft';
		const forward = splitStacked ? 'ArrowDown' : 'ArrowRight';
		const step = event.shiftKey ? 10 : 5;
		if (event.key === back) setSplit(splitShare - step);
		else if (event.key === forward) setSplit(splitShare + step);
		else if (event.key === 'Home') setSplit(20);
		else if (event.key === 'End') setSplit(80);
		else if (event.key === 'Enter') setSplit(50);
		else return;
		event.preventDefault();
	}

	// ── The phone's app shell ─────────────────────────────────────────────────
	// The page itself never scrolls or pans: only the panes inside it do.
	$effect(() => {
		const root = document.documentElement;
		root.classList.add('app-shell');
		return () => root.classList.remove('app-shell');
	});
	// Fit the shell to what the on-screen keyboard leaves visible.
	$effect(() => {
		if (phone) return trackViewport();
	});

	/** Where the phone is: the overview, the model tree, or a view (or the list of them). */
	const section: Section = $derived(
		ui.mobilePane === 'model' ? 'model' : tab && tab.kind !== 'home' ? 'views' : ui.mobilePane
	);
	/**
	 * Phones show the model tree only in its section, so it is built the first
	 * time that section opens (and kept after), not while the page loads.
	 */
	let explorerVisited = $state(false);
	$effect(() => {
		if (section === 'model') explorerVisited = true;
	});
	const explorerMounted = $derived(!phone || explorerVisited);
	const showCatalog = $derived(phone && section === 'views' && (!tab || tab.kind === 'home'));
	const detailsOpen = $derived(ui.details === 'half' || ui.details === 'full');
	let moreOpen = $state(false);

	function navigate(to: Section) {
		ui.viewsDrawer = false;
		if (to === 'home') {
			ui.open({ kind: 'home' });
			return;
		}
		if (to === 'views') {
			if (section === 'views' && !detailsOpen && tab && tab.kind !== 'home') {
				// Tapping Views again lists the open views and everything else.
				ui.viewsDrawer = true;
				return;
			}
			if (!tab || tab.kind === 'home') {
				const last = ui.tabs.findLastIndex((t) => t.kind !== 'home');
				if (last >= 0) ui.active = last;
			}
		}
		ui.mobilePane = to;
		ui.lowerDetails();
	}

	function toggleDetails() {
		if (detailsOpen) ui.lowerDetails();
		else ui.showDetails('full');
	}

	// A peek with nothing selected shows nothing: put the sheet away.
	$effect(() => {
		if (!ui.selection && ui.details === 'peek') ui.details = 'closed';
	});

	// Typing stops when the text is no longer on show.
	$effect(() => {
		void tab;
		void layout;
		void section;
		void phone;
		untrack(() => {
			if (ui.editingText) ui.editingText = false;
		});
	});

	/** Whether the open view is a report (a document to read, nothing to add to). */
	const reportTab = $derived.by(() => {
		if (tab?.kind !== 'view') return false;
		const info = workspace.views.find((v) => v.name === tab.name);
		return info ? !!reportKindOf(info) : !!standardReport(tab.name);
	});

	/** The add button floats over the model and views, but not over text (that has "Edit text"). */
	const showAdd = $derived(
		phone &&
			(section === 'model' ||
				(section === 'views' &&
					tab?.kind !== 'emulator' &&
					tab?.kind !== 'library' &&
					!reportTab &&
					!(tab?.kind === 'file' && showText))) &&
			!ui.editingText &&
			!detailsOpen
	);

	const userElements = $derived(
		workspace.elements.filter((e) => !e.file.startsWith('libraries/')).length
	);
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

	/** Whether a key press is typing (in a field, the text editor or a dialog's input). */
	function typing(event: KeyboardEvent): boolean {
		const target = event.target as HTMLElement | null;
		return !!target?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');
	}

	function onkeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			ui.paletteOpen = !ui.paletteOpen;
		} else if (
			(isMac ? event.metaKey : event.ctrlKey) &&
			event.key.toLowerCase() === 'd' &&
			!event.altKey &&
			!event.shiftKey &&
			!event.defaultPrevented &&
			!typing(event) &&
			!document.querySelector('dialog[open]')
		) {
			// Duplicate the selection (a diagram does it itself, placing the copy).
			const selected = workspace.elements.find((e) => e.key === ui.selection?.key);
			if (!selected) return;
			event.preventDefault();
			void duplicateAndSelect(workspace, ui, selected, ui.selection?.source ?? 'inspector');
		} else if (
			event.key === '?' &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.defaultPrevented &&
			!typing(event) &&
			!document.querySelector('dialog[open]')
		) {
			event.preventDefault();
			ui.showHelp();
		}
	}
</script>

<svelte:window {onkeydown} />

<div
	class="workbench"
	class:no-inspector={!ui.inspectorOpen}
	class:problems-open={ui.problemsOpen}
	class:phone
	class:editing={phone && ui.editingText}
	data-section={section}
	data-details={phone ? ui.details : undefined}
>
	<header class="topbar">
		<button
			type="button"
			class="brand"
			aria-label="Project overview"
			title="Project overview"
			onclick={() => navigate('home')}><Logo size={24} /></button
		>
		{#if session}
			<ProjectMenu
				{workspace}
				{session}
				{engine}
				onopensettings={() => (ui.settingsOpen = true)}
				onopensourcecontrol={() => (ui.sourceControlOpen = true)}
				onimportrequirements={() => (ui.importOpen = true)}
				onexportjson={() => (ui.exportJsonOpen = true)}
				onapiserver={() => (ui.apiServerOpen = true)}
				onreview={() => ui.open({ kind: 'review' })}
				onhelp={() => ui.showHelp()}
			/>
		{:else}
			<div class="project"><strong>{workspace.info?.name ?? 'Project'}</strong></div>
		{/if}
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
		{#if phone}
			<button
				type="button"
				class="icon more"
				aria-haspopup="dialog"
				aria-expanded={moreOpen}
				aria-label="More{errors ? `, ${errors} errors` : ''}"
				onclick={() => (moreOpen = true)}
			>
				<Ellipsis size={20} />
				{#if errors}<span class="alert" aria-hidden="true"></span>{/if}
			</button>
		{:else}
			<button
				type="button"
				class="icon"
				aria-pressed={ui.sourceControlOpen}
				aria-label="Source control"
				title="Source control"
				onclick={() => (ui.sourceControlOpen = !ui.sourceControlOpen)}
			>
				<GitBranch size={17} />
			</button>
			<button
				type="button"
				class="icon"
				aria-pressed={ui.inspectorOpen}
				aria-label="Inspector"
				title="Inspector"
				onclick={() => (ui.inspectorOpen = !ui.inspectorOpen)}
			>
				<PanelRight size={17} />
			</button>
			<button
				type="button"
				class="icon"
				aria-haspopup="dialog"
				aria-label="Settings"
				title="Settings"
				onclick={() => (ui.settingsOpen = true)}
			>
				<Settings size={17} />
			</button>
			<ThemeToggle />
		{/if}
		{#if phone && workspace.state.phase === 'loading'}
			<span
				class="progress"
				aria-hidden="true"
				style:--done={workspace.state.total ? workspace.state.done / workspace.state.total : 0}
			></span>
		{/if}
	</header>

	<main class="panes">
		<h1 class="visually-hidden">{workspace.info?.name ?? 'Project'}</h1>
		<div class="pane explorer-pane">
			{#if explorerMounted}<Explorer {workspace} {ui} />{/if}
		</div>

		<section class="pane editor-pane" aria-label="Editor">
			{#if phone}
				<div class="phone-bar">
					<button
						type="button"
						class="views-pill"
						aria-haspopup="dialog"
						aria-expanded={ui.viewsDrawer}
						aria-label="{showCatalog ? 'All views' : tab ? tabTitle(tab) : 'Views'}, {ui.tabs
							.length} open. Switch view"
						onclick={() => (ui.viewsDrawer = true)}
					>
						<span class="pill-icon"><TabIcon tab={showCatalog ? undefined : tab} /></span>
						<span class="pill-title"
							>{showCatalog ? 'All views' : tab ? tabTitle(tab) : 'Views'}</span
						>
						<span class="pill-count">{ui.tabs.length}</span>
						<ChevronsUpDown size={15} aria-hidden="true" />
					</button>
					{#if tab?.kind === 'file' && filePackage}
						<div class="segmented" role="group" aria-label="Show the model as">
							{#each layoutChoices as l (l.id)}
								<button
									type="button"
									aria-pressed={layout === l.id}
									onclick={() => chooseLayout(l.id)}
								>
									<l.icon size={15} />
									<span>{l.label}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
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
									{:else if t.kind === 'emulator'}<Play size={14} />
									{:else if t.kind === 'library'}<BookLock size={14} />
									{:else if t.kind === 'review'}<GitCompareArrows size={14} />
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
							{#each layoutChoices as l (l.id)}
								<button
									type="button"
									aria-pressed={layout === l.id}
									title="{l.label} view"
									onclick={() => chooseLayout(l.id)}
								>
									<l.icon size={14} />
									<span>{l.label}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			<div class="tab-body">
				{#if !tab}
					<p class="empty">Open a file or view from the explorer.</p>
				{:else if tab.kind === 'home'}
					{#if showCatalog}
						<div class="catalog-page">
							<ViewsCatalog {workspace} {ui} />
						</div>
					{:else}
						<HomeView {workspace} {ui} {engine} {session} />
					{/if}
				{:else if tab.kind === 'requirements'}
					<ViewTable name="RequirementsTable" {workspace} {ui} {engine} />
				{:else if tab.kind === 'view'}
					{@const info = workspace.views.find((v) => v.name === tab.name)}
					{@const presentation = info ? presentationOf(info) : { kind: 'table' as const }}
					{#if reportTab}
						{#key tab.name}
							{#await loadReport()}
								<p class="empty">Loading the report…</p>
							{:then ReportView}
								<ReportView name={tab.name} {workspace} {ui} {engine} />
							{/await}
						{/key}
					{:else if presentation.kind === 'table'}
						{#key tab.name}
							<ViewTable name={tab.name} {workspace} {ui} {engine} />
						{/key}
					{:else if presentation.kind === 'matrix'}
						{#key tab.name}
							{#await loadMatrix()}
								<p class="empty">Loading the matrix…</p>
							{:then DsmView}
								<DsmView name={tab.name} {workspace} {ui} {engine} />
							{/await}
						{/key}
					{:else if presentation.kind === 'diagram'}
						<!-- Shown as another kind of view ("View as"), it is drawn afresh. -->
						{#key `${tabId(tab)}|${presentation.view}|${presentation.scope}`}
							{#await loadDiagram(presentation.view)}
								<p class="empty">Loading the diagram…</p>
							{:then DiagramCanvas}
								<DiagramCanvas
									view={presentation.view}
									scope={presentation.scope}
									{...presentation.view === 'sequence' ? {} : { viewName: tab.name }}
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
						{#await loadDiagram(tab.view)}
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
				{:else if tab.kind === 'emulator'}
					{#key tab.machine}
						{#await loadEmulator()}
							<p class="empty">Loading the emulator…</p>
						{:then StateEmulator}
							<StateEmulator machine={tab.machine} {workspace} {ui} {engine} />
						{/await}
					{/key}
				{:else if tab.kind === 'review'}
					{#await loadReview()}
						<p class="empty">Loading the review…</p>
					{:then ReviewView}
						<ReviewView {workspace} {ui} {engine} {session} />
					{/await}
				{:else if tab.kind === 'library'}
					{#key tab.path}
						{#await loadLibraryFile()}
							<p class="empty">Opening the library file…</p>
						{:then LibraryFile}
							<LibraryFile path={tab.path} line={tab.line} {engine} />
						{/await}
					{/key}
				{:else if tab.path.endsWith('.md') && !tab.raw}
					{#key tab.path}
						<DocumentView path={tab.path} {workspace} {ui} />
					{/key}
				{:else}
					<div
						class="split"
						class:single={!showText || !showDiagram}
						class:dragging={splitDragging}
						style:--split="{splitShare}%"
						bind:this={splitBox}
					>
						{#key tab.path}
							<div class="text" class:hidden={!showText}>
								{#await loadTextEditor()}
									<p class="empty">Loading the editor…</p>
								{:then TextEditor}
									<TextEditor path={tab.path} {workspace} {ui} {engine} />
								{/await}
							</div>
						{/key}
						{#if showText && showDiagram && !phone}
							<!-- Drag, or use the arrow keys, to share the space; Enter halves it again. -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
							<div
								class="divider"
								role="separator"
								tabindex="0"
								aria-label="Resize the text and the diagram"
								aria-orientation={splitStacked ? 'horizontal' : 'vertical'}
								aria-valuenow={splitShare}
								aria-valuemin={20}
								aria-valuemax={80}
								title="Drag to resize; double-click to share it evenly"
								onpointerdown={dragSplit}
								onkeydown={splitKey}
								ondblclick={() => setSplit(50)}
							></div>
						{/if}
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
			{#if !phone}<Inspector {workspace} {ui} {engine} />{/if}
		</div>

		<section class="pane problems-pane" aria-label="Problems">
			<header>
				<h2>Problems</h2>
				<span>{errors} errors · {warnings} warnings</span>
			</header>
			<ul>
				{#each listedProblems.slice(0, PROBLEMS_LISTED) as p, i (i)}
					<li>
						<button type="button" class={p.severity} onclick={() => openProblem(p)}>
							{#if p.severity === 'error'}<CircleAlert
									size={14}
								/>{:else if p.severity === 'warning'}<TriangleAlert size={14} />{:else}<Info
									size={14}
								/>{/if}
							<span class="msg">{p.message}</span>
							{#if p.file}<span class="loc">{p.file}:{p.span.start_row}</span>{/if}
						</button>
					</li>
				{:else}
					<li class="none">
						No problems. The model is consistent. Mistakes in the text, such as a name that refers
						to nothing, show here as you type.
					</li>
				{/each}
				{#if listedProblems.length > PROBLEMS_LISTED}
					<li class="none">{listedProblems.length - PROBLEMS_LISTED} more not listed.</li>
				{/if}
			</ul>
		</section>

		{#if phone}
			<div class="sheet-host">
				<DetailsSheet bind:snap={ui.details} label="Element details">
					<Inspector {workspace} {ui} {engine} />
				</DetailsSheet>
			</div>
			{#if showAdd}
				<button
					type="button"
					class="fab"
					aria-label="Add an element"
					aria-haspopup="dialog"
					onclick={() => (ui.addSheet = true)}
				>
					<Plus size={24} strokeWidth={2.4} />
				</button>
			{/if}
		{/if}
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
			<span class="meta">{userElements} element{userElements === 1 ? '' : 's'}</span>
			<span class="meta"
				>{workspace.requirements.length} requirement{workspace.requirements.length === 1
					? ''
					: 's'}</span
			>
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
		<OfflineBadge />
		<span class="grow"></span>
		<span class="meta"
			>SysML v2{workspace.engineVersion ? ` · engine ${workspace.engineVersion}` : ''}</span
		>
	</footer>

	<Toaster />
	<!-- Loaded the first time they are opened, to keep the first load small. -->
	{#if palettePrimed}
		{#await import('./CommandPalette.svelte') then { default: CommandPalette }}
			<CommandPalette {workspace} {ui} />
		{/await}
	{/if}
	{#if session && sourceControlPrimed}
		{#await import('#lib/git/SourceControl.svelte') then { default: SourceControl }}
			<SourceControl
				{session}
				{engine}
				bind:open={ui.sourceControlOpen}
				onreview={() => ui.open({ kind: 'review' })}
			/>
		{/await}
	{/if}
	{#if settingsPrimed}
		{#await import('#lib/settings/Settings.svelte') then { default: SettingsDialog }}
			<SettingsDialog {engine} bind:open={ui.settingsOpen} onhelp={() => ui.showHelp()} />
		{/await}
	{/if}
	{#if importPrimed}
		{#await import('#lib/dataio/ImportRequirements.svelte') then { default: ImportRequirements }}
			<ImportRequirements {workspace} {ui} bind:open={ui.importOpen} />
		{/await}
	{/if}
	{#if exportJsonPrimed}
		{#await import('#lib/exchange/ExportJson.svelte') then { default: ExportJson }}
			<ExportJson
				{workspace}
				{engine}
				bind:open={ui.exportJsonOpen}
				onhelp={() => ui.showHelp('exchange-models')}
			/>
		{/await}
	{/if}
	{#if apiServerPrimed}
		{#await import('#lib/exchange/ApiServer.svelte') then { default: ApiServer }}
			<ApiServer
				{workspace}
				{session}
				{engine}
				bind:open={ui.apiServerOpen}
				onhelp={() => ui.showHelp('exchange-models')}
			/>
		{/await}
	{/if}

	{#if createPrimed}
		{#await import('#lib/create/CreateHost.svelte') then { default: CreateHost }}
			<CreateHost {workspace} {ui} {engine} />
		{/await}
	{/if}
	{#if filesPrimed}
		{#await import('./files/FileHost.svelte') then { default: FileHost }}
			<FileHost {workspace} {ui} />
		{/await}
	{/if}
	{#if elementsPrimed}
		{#await import('./ElementHost.svelte') then { default: ElementHost }}
			<ElementHost {workspace} {ui} />
		{/await}
	{/if}
	{#if phone}
		<div class="bar">
			<MobileNav
				current={section}
				{detailsOpen}
				hasSelection={!!ui.selection}
				viewCount={ui.tabs.filter((t) => t.kind !== 'home').length}
				onnavigate={navigate}
				ondetails={toggleDetails}
			/>
		</div>
		<ViewsDrawer {workspace} {ui} />
		<MoreMenu bind:open={moreOpen} {ui} {errors} {warnings} />
		<ProblemsSheet {workspace} {ui} />
		<AddSheet {workspace} {ui} context={viewPackage} />
	{:else if addPrimed}
		<!-- On a wide screen, the guides open it to add a requirement or a part. -->
		<AddSheet {workspace} {ui} context={viewPackage} />
	{/if}
	{#if helpPrimed}
		{#await import('#lib/help/HelpDialog.svelte') then { default: HelpDialog }}
			<HelpDialog {workspace} {ui} {engine} {session} />
		{/await}
	{/if}
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
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		cursor: pointer;
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
		grid-template-columns: minmax(0, var(--split, 50%)) 0 minmax(0, 1fr);
		height: 100%;
	}
	.split.single {
		grid-template-columns: minmax(0, 1fr);
	}
	/* A zero-width column with a wider grip over the border between the two. */
	.divider {
		position: relative;
		z-index: 6;
		width: 0;
		cursor: col-resize;
		touch-action: none;
	}
	.divider::before {
		content: '';
		position: absolute;
		inset: 0 -5px;
	}
	.divider::after {
		content: '';
		position: absolute;
		inset: 0 -1px;
		background: transparent;
		transition: background var(--duration) var(--ease);
	}
	.divider:hover::after,
	.divider:focus-visible::after,
	.dragging .divider::after {
		background: var(--accent);
	}
	.divider:focus-visible {
		outline: none;
	}
	/* While dragging, the editor and the canvas don't take the pointer or select text. */
	.dragging {
		cursor: col-resize;
		user-select: none;
	}
	.dragging .text,
	.dragging .diagram {
		pointer-events: none;
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
	.bar,
	.sheet-host,
	.fab,
	.phone-bar,
	.more {
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
			grid-template-rows: minmax(0, var(--split, 50%)) 0 minmax(0, 1fr);
		}
		.divider {
			width: auto;
			height: 0;
			cursor: row-resize;
		}
		.divider::before {
			inset: -5px 0;
		}
		.divider::after {
			inset: -1px 0;
		}
		.dragging {
			cursor: row-resize;
		}
		/* One thing on show fills the height, rather than half of it. */
		.split.single {
			grid-template-rows: minmax(0, 1fr);
		}
		.split .text {
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}
		.split.single .text {
			border-bottom: 0;
		}
	}

	/* ── Phones: a fixed app shell with a bottom navigation ─────────────── */
	@media (max-width: 760px) {
		.workbench,
		.workbench.no-inspector {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr) auto;
			grid-template-areas: 'top' 'main' 'bar';
			height: var(--app-height, 100dvh);
			position: relative;
			top: var(--app-top, 0px);
			overflow: hidden;
		}
		.topbar {
			position: relative;
			z-index: 5;
			gap: var(--space-1);
			height: calc(var(--topbar-height) + env(safe-area-inset-top));
			padding: env(safe-area-inset-top) max(var(--space-2), env(safe-area-inset-right)) 0
				max(var(--space-1), env(safe-area-inset-left));
		}
		.brand {
			flex: none;
		}
		.search {
			flex: 0 0 auto;
			width: 2.75rem;
			height: 2.75rem;
			margin: 0;
			padding: 0;
			justify-content: center;
			border: 0;
			background: transparent;
			color: var(--text-2);
		}
		.search:hover {
			box-shadow: none;
		}
		.search-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.search kbd {
			display: none;
		}
		.icon {
			min-width: 2.75rem;
			height: 2.75rem;
			border-radius: 999px;
		}
		.more {
			position: relative;
			display: inline-flex;
		}
		.alert {
			position: absolute;
			top: 0.6rem;
			right: 0.55rem;
			width: 0.5rem;
			height: 0.5rem;
			border: 2px solid var(--surface);
			border-radius: 50%;
			background: var(--danger);
			box-sizing: content-box;
		}
		.progress {
			position: absolute;
			left: 0;
			bottom: -1px;
			height: 2px;
			width: 100%;
			background: var(--accent);
			transform: scaleX(var(--done));
			transform-origin: left;
			transition: transform 200ms var(--ease);
		}
		/* The status line still announces progress, without taking a row. */
		.statusbar {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
			border: 0;
		}
		.pane,
		.inspector-pane,
		.problems-pane,
		.problems-open .problems-pane {
			display: none;
			grid-area: main;
			border: 0;
		}
		.workbench[data-section='model'] .explorer-pane {
			display: block;
		}
		.workbench[data-section='home'] .editor-pane,
		.workbench[data-section='views'] .editor-pane {
			display: flex;
		}
		.phone-bar {
			display: flex;
			align-items: center;
			flex: none;
			gap: var(--space-2);
			padding: var(--space-2) max(var(--space-3), env(safe-area-inset-right)) var(--space-2)
				max(var(--space-3), env(safe-area-inset-left));
			border-bottom: 1px solid var(--border);
			background: var(--surface);
		}
		.views-pill {
			display: flex;
			align-items: center;
			flex: 1;
			gap: var(--space-2);
			min-width: 0;
			height: 2.75rem;
			padding: 0 var(--space-3) 0 0.3125rem;
			border: 1px solid var(--border);
			border-radius: 999px;
			background: var(--surface-2);
			color: var(--text-2);
			cursor: pointer;
			transition:
				transform 160ms var(--ease),
				background 160ms var(--ease);
		}
		.views-pill:active {
			transform: scale(0.98);
			background: var(--surface-hover);
		}
		.pill-icon {
			display: grid;
			place-items: center;
			flex: none;
			width: 2.125rem;
			height: 2.125rem;
			border-radius: 50%;
			background: var(--surface);
			box-shadow: var(--shadow-sm);
			color: var(--accent);
		}
		.pill-title {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			color: var(--text);
			font-weight: 600;
			text-align: left;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.pill-count {
			flex: none;
			min-width: 1.375rem;
			height: 1.375rem;
			padding: 0 5px;
			border-radius: 999px;
			background: var(--text-2);
			color: var(--surface);
			font-size: var(--text-xs);
			font-weight: 700;
			line-height: 1.375rem;
			text-align: center;
		}
		.phone-bar .segmented {
			margin: 0;
			padding: 3px;
			border-radius: 999px;
		}
		.phone-bar .segmented button {
			height: 2.375rem;
			padding: 0 var(--space-3);
			border-radius: 999px;
			font-size: var(--text-sm);
		}
		.tab-body {
			overflow: hidden;
		}
		.catalog-page {
			height: 100%;
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: var(--space-4) max(var(--space-3), env(safe-area-inset-right))
				calc(var(--space-7) + 3rem + var(--sheet-cover, 0px))
				max(var(--space-3), env(safe-area-inset-left));
		}
		.sheet-host {
			display: block;
			grid-area: main;
			z-index: 20;
			min-height: 0;
			pointer-events: none;
		}
		.fab {
			display: grid;
			place-items: center;
			grid-area: main;
			align-self: end;
			justify-self: end;
			z-index: 15;
			width: 3.5rem;
			height: 3.5rem;
			margin: 0 max(var(--space-4), env(safe-area-inset-right))
				calc(var(--space-4) + var(--sheet-cover, 0px)) 0;
			border: 0;
			border-radius: 18px;
			background: var(--accent);
			color: var(--accent-text);
			box-shadow:
				0 2px 6px rgb(0 0 0 / 0.16),
				0 10px 24px color-mix(in oklab, var(--accent) 35%, transparent);
			cursor: pointer;
			animation: fab-in 260ms cubic-bezier(0.2, 0.9, 0.25, 1.2);
			transition:
				margin 300ms cubic-bezier(0.2, 0.9, 0.25, 1),
				transform 120ms var(--ease);
		}
		.fab:active {
			transform: scale(0.94);
		}
		@keyframes fab-in {
			from {
				opacity: 0;
				transform: scale(0.6);
			}
		}
		.bar {
			display: block;
			grid-area: bar;
			z-index: 25;
		}
		.editing .bar,
		.editing .phone-bar,
		.editing .sheet-host,
		.editing .fab {
			display: none;
		}
		/* The project menu stays on screen on the narrowest phones. */
		.workbench :global(.project-menu > :is(.menu, .popover)) {
			width: min(20rem, calc(100vw - 4rem));
		}
		/* Toasts float above the bottom navigation. */
		.workbench :global(.toaster) {
			right: max(var(--space-3), env(safe-area-inset-right));
			left: max(var(--space-3), env(safe-area-inset-left));
			bottom: calc(4.5rem + env(safe-area-inset-bottom));
			width: auto;
		}
	}

	/* While a phone's keyboard is up, the navigation steps aside for it. */
	@media (max-width: 760px) and (pointer: coarse) {
		.workbench:has(
				:global(
					:is(
						input:not([type='checkbox'], [type='radio'], [type='file']),
						textarea,
						[contenteditable='true']
					):focus
				)
			)
			.bar {
			display: none;
		}
		/* So does it while a diagram's form is a bottom sheet: its buttons stay where they are tapped. */
		.workbench:has(:global([data-form-sheet])) .bar {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.fab {
			animation: none;
		}
	}
</style>
