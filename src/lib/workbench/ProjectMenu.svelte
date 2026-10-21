<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowDownToLine,
		Check,
		ChevronDown,
		CloudOff,
		CloudUpload,
		Download,
		ExternalLink,
		FolderOpen,
		FolderUp,
		GitBranch,
		GitPullRequest,
		LoaderCircle,
		MonitorDown,
		Plus,
		RotateCcw,
		Settings as SettingsIcon,
		Upload,
		WifiOff
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { accounts } from '#lib/git/account.svelte.ts';
	import { messageOf } from '#lib/git/errors.ts';
	import GitHubMark from '#lib/git/GitHubMark.svelte';
	import { keepRepository } from '#lib/git/project.ts';
	import OfflineBadge from '#lib/offline/OfflineBadge.svelte';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import type { Progress, RepoChoice } from '#lib/git/types.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import { deleteProject } from '#lib/project/store.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { settings } from '#lib/settings/settings.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';

	/**
	 * The project's name, where it is saved (this browser, a folder, GitHub),
	 * and what can be done with it. Settings and the GitHub sheet open from
	 * here: through `onopensettings` / `onopensourcecontrol` when the host
	 * mounts those panels, otherwise from this component itself.
	 */
	let {
		workspace,
		session,
		engine,
		onopensettings,
		onopensourcecontrol,
		onimportrequirements
	}: {
		workspace: Workspace;
		session: ProjectSession;
		engine: Engine;
		onopensettings?: () => void;
		onopensourcecontrol?: () => void;
		/** Shows "Import requirements…" when the host can open the import dialog. */
		onimportrequirements?: () => void;
	} = $props();

	let open = $state(false);
	let menu: HTMLDivElement | undefined = $state();
	let ownSettings = $state(false);
	let ownSourceControl = $state(false);
	let openRepo = $state(false);

	const record = $derived(session.record);
	const git = $derived(record?.git ?? null);
	const changeCount = $derived(session.git.changes.length);
	const behind = $derived(session.git.behind);
	const unsaved = $derived(session.unsavedToFolder.length);
	const offline = $derived(!pwa.online);

	$effect(() => {
		settings.init();
		accounts.init();
	});

	// Check GitHub for newer versions when the project opens.
	let checked = false;
	$effect(() => {
		if (git && !checked && workspace.state.phase === 'ready') {
			checked = true;
			void session.git.check();
		}
	});

	function showSettings() {
		open = false;
		if (onopensettings) onopensettings();
		else ownSettings = true;
	}

	function showSourceControl() {
		open = false;
		if (onopensourcecontrol) onopensourcecontrol();
		else ownSourceControl = true;
	}

	async function getLatest() {
		open = false;
		try {
			const outcome = await session.git.pull(engine);
			if (outcome === 'conflicts') {
				toasts.show('You and GitHub both changed some files. Choose what to keep.');
				showSourceControl();
			} else
				toasts.show(
					outcome === 'up-to-date'
						? 'You already have the latest version.'
						: 'Got the latest version from GitHub.',
					{ tone: 'success' }
				);
		} catch (error) {
			toasts.show(messageOf(error), {
				tone: 'error',
				action: { label: 'Details', run: showSourceControl }
			});
		}
	}

	async function openFromGitHub(choice: RepoChoice, progress: Progress) {
		const { id } = await keepRepository(choice, progress);
		// A full load: the workbench is built for one project.
		location.assign(resolve('/p/[project]', { project: id }));
	}

	async function saveToFolder() {
		open = false;
		const error = await session.saveToFolder();
		toasts.show(error ?? 'Saved to the folder.', { tone: error ? 'error' : 'success' });
	}

	async function exportKpar() {
		open = false;
		try {
			await session.exportKpar();
		} catch (error) {
			toasts.show(error instanceof Error ? error.message : String(error), { tone: 'error' });
		}
	}

	async function resetDemo() {
		open = false;
		await deleteProject('demo');
		location.reload();
	}

	function onfocusout(event: FocusEvent) {
		if (!menu?.contains(event.relatedTarget as Node | null)) open = false;
	}

	/**
	 * Ctrl/⌘+S saves to the folder when there is one; otherwise it's already
	 * saved (and a GitHub project offers the GitHub sheet). Ctrl/⌘+, opens settings.
	 */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			open = false;
			return;
		}
		if (!(event.metaKey || event.ctrlKey)) return;
		if (event.key.toLowerCase() === 's') {
			event.preventDefault();
			if (session.canSaveToFolder) void saveToFolder();
			else if (git && changeCount) showSourceControl();
			else toasts.show('Every change is saved in this browser as you work.', { tone: 'success' });
		} else if (event.key === ',') {
			event.preventDefault();
			showSettings();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="project-menu" bind:this={menu} {onfocusout}>
	<button
		type="button"
		class="name"
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		<strong>{workspace.info?.name ?? 'Project'}</strong>
		<ChevronDown size={14} aria-hidden="true" />
	</button>
	<span class="phone-offline"><OfflineBadge compact /></span>
	<span class="save" role="status" title={session.saveError ?? undefined}>
		{#if git}
			<button
				type="button"
				class="git-chip"
				class:dirty={changeCount > 0}
				onclick={showSourceControl}
				aria-label="GitHub: branch {git.branch}, {changeCount} unsaved {changeCount === 1
					? 'change'
					: 'changes'}{behind ? `, ${behind} newer on GitHub` : ''}"
			>
				<GitBranch size={13} aria-hidden="true" />
				<span class="branch-name">{git.branch}</span>
				{#if changeCount}<span class="sep" aria-hidden="true">·</span
					>{changeCount}&nbsp;unsaved{:else if !behind}<Check size={12} aria-hidden="true" />{/if}
				{#if behind}<span class="behind"
						><ArrowDownToLine size={12} aria-hidden="true" />{behind}</span
					>{/if}
			</button>
		{/if}
		{#if session.canSaveToFolder && unsaved}
			<button type="button" class="unsaved" onclick={saveToFolder}>
				<FolderUp size={13} aria-hidden="true" />
				{unsaved} unsaved · Save to folder
			</button>
		{:else if session.saveState === 'saving'}
			<LoaderCircle size={13} class="spin" aria-hidden="true" /> Saving…
		{:else if session.saveState === 'saved' && !git}
			<Check size={13} aria-hidden="true" /> Saved
		{:else if session.saveState === 'error'}
			<CloudOff size={13} aria-hidden="true" /> Not saved
		{/if}
	</span>

	{#if open}
		<div class="popover">
			{#if offline}
				<p class="offline">
					<WifiOff size={14} aria-hidden="true" />
					<span>You're offline. Your work is saved in this browser; GitHub needs a connection.</span
					>
				</p>
			{/if}
			{#if git}
				<div class="status">
					<span class="repo"><GitHubMark size={14} /> {git.owner}/{git.repo}</span>
					<span class="facts">
						<span class="pill"><GitBranch size={12} aria-hidden="true" /> {git.branch}</span>
						<span
							>{changeCount
								? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}`
								: 'All saved to GitHub'}</span
						>
						{#if behind}<span class="warn">· {behind} newer on GitHub</span>{/if}
					</span>
				</div>
			{:else}
				<p class="where">
					{#if record?.origin === 'folder'}Opened from a folder; changes are kept in this browser
						and saved to the folder when you choose.
					{:else if record?.origin === 'demo'}The demo. Your changes are kept in this browser.
					{:else}Kept in this browser. Save it to GitHub or export it to share or back it up.{/if}
				</p>
			{/if}
			<div class="menu" role="menu" aria-label="Project">
				{#if git}
					<button type="button" role="menuitem" onclick={showSourceControl}>
						<CloudUpload size={15} /> Save to GitHub… <small>commit & push</small>
					</button>
					<button
						type="button"
						role="menuitem"
						onclick={getLatest}
						disabled={!!session.git.busy || offline}
					>
						<ArrowDownToLine size={15} /> Get latest <small>{offline ? 'offline' : 'pull'}</small>
					</button>
					<button type="button" role="menuitem" onclick={showSourceControl}>
						<GitPullRequest size={15} /> Propose changes… <small>pull request</small>
					</button>
					<a
						role="menuitem"
						href="https://github.com/{git.owner}/{git.repo}/tree/{git.branch}"
						target="_blank"
						rel="noopener noreferrer"
						onclick={() => (open = false)}
					>
						<ExternalLink size={15} /> Open on GitHub
					</a>
				{:else}
					<button type="button" role="menuitem" onclick={showSourceControl}>
						<GitHubMark size={15} /> Save to GitHub…
					</button>
				{/if}
				{#if session.canSaveToFolder}
					<button type="button" role="menuitem" onclick={saveToFolder}>
						<FolderUp size={15} /> Save to folder <kbd>Ctrl S</kbd>
					</button>
				{/if}
				<button type="button" role="menuitem" onclick={exportKpar}>
					<Download size={15} /> Download as .kpar
				</button>
				{#if onimportrequirements}
					<button
						type="button"
						role="menuitem"
						onclick={() => {
							open = false;
							onimportrequirements();
						}}
					>
						<Upload size={15} /> Import requirements… <small>xlsx, csv</small>
					</button>
				{/if}
				<div role="separator"></div>
				<a role="menuitem" href={resolve('/projects')}>
					<FolderOpen size={15} /> All projects…
				</a>
				<button
					type="button"
					role="menuitem"
					onclick={() => {
						open = false;
						void goto(resolve('/projects?new'));
					}}
				>
					<Plus size={15} /> New project…
				</button>
				<button
					type="button"
					role="menuitem"
					disabled={offline}
					onclick={() => {
						open = false;
						openRepo = true;
					}}
				>
					<GitHubMark size={15} /> Open from GitHub…
					{#if offline}<small>offline</small>{/if}
				</button>
				{#if record?.origin === 'demo'}
					<button type="button" role="menuitem" onclick={resetDemo}>
						<RotateCcw size={15} /> Reset the demo
					</button>
				{/if}
				<div role="separator"></div>
				{#if pwa.canInstall}
					<button
						type="button"
						role="menuitem"
						onclick={() => {
							open = false;
							void pwa.install();
						}}
					>
						<MonitorDown size={15} /> Install app <small>works offline</small>
					</button>
				{/if}
				<button type="button" role="menuitem" onclick={showSettings}>
					<SettingsIcon size={15} /> Settings… <kbd>Ctrl ,</kbd>
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Loaded when first opened, to keep the first load small. -->
{#if !onopensourcecontrol && ownSourceControl}
	{#await import('#lib/git/SourceControl.svelte') then { default: SourceControl }}
		<SourceControl {session} {engine} bind:open={ownSourceControl} />
	{/await}
{/if}
{#if !onopensettings && ownSettings}
	{#await import('#lib/settings/Settings.svelte') then { default: Settings }}
		<Settings bind:open={ownSettings} {engine} />
	{/await}
{/if}
{#if openRepo}
	{#await import('#lib/git/OpenRepository.svelte') then { default: OpenRepository }}
		<OpenRepository bind:open={openRepo} run={openFromGitHub} />
	{/await}
{/if}

<style>
	.project-menu {
		position: relative;
		display: flex;
		flex: 1 1 0;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}
	.name:hover,
	.name[aria-expanded='true'] {
		background: var(--surface-hover);
	}
	.name strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		color: var(--text-2);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.save :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.unsaved,
	.git-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 1.75rem;
		padding: 0 var(--space-2);
		border: 1px solid color-mix(in oklab, var(--warn) 50%, var(--border));
		border-radius: 999px;
		background: color-mix(in oklab, var(--warn) 12%, var(--surface));
		color: var(--text);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.git-chip {
		min-width: 0;
		margin-right: var(--space-1);
		border-color: var(--border-strong);
		background: var(--surface);
	}
	.git-chip:hover {
		border-color: var(--accent);
	}
	.git-chip.dirty {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
		background: var(--accent-weak);
	}
	.branch-name {
		overflow: hidden;
		max-width: 10rem;
		font-family: var(--font-mono);
		text-overflow: ellipsis;
	}
	.sep {
		color: var(--text-3);
	}
	.behind {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		margin-left: 2px;
		color: var(--warn);
		font-weight: 600;
	}
	.popover {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 30;
		display: grid;
		width: min(21rem, 90vw);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.menu {
		display: grid;
	}
	.offline {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		color: var(--text);
		font-size: var(--text-xs);
	}
	.offline :global(svg) {
		flex: none;
		margin-top: 1px;
	}
	.phone-offline {
		display: none;
	}
	.where {
		padding: var(--space-1) var(--space-2) var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.status {
		display: grid;
		gap: 4px;
		margin-bottom: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-xs);
	}
	.repo {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		color: var(--text-2);
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 0 6px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-family: var(--font-mono);
	}
	.warn {
		color: var(--warn);
		font-weight: 600;
	}
	.menu button,
	.menu a {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.menu button:hover,
	.menu a:hover {
		background: var(--surface-hover);
	}
	.menu button:disabled {
		opacity: 0.5;
	}
	.menu small {
		margin-left: auto;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	[role='separator'] {
		height: 1px;
		margin: var(--space-1) var(--space-2);
		background: var(--border);
	}
	kbd {
		margin-left: auto;
		color: var(--text-3);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
	}
	@media (max-width: 760px) {
		.save {
			display: none;
		}
		.phone-offline {
			display: contents;
		}
	}
</style>
