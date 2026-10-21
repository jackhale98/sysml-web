<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowRight,
		FileArchive,
		FolderOpen,
		FolderUp,
		GitBranch,
		Plus,
		Rocket,
		Settings as SettingsIcon,
		Trash2
	} from '@lucide/svelte';
	import { accounts } from '#lib/git/account.svelte.ts';
	import GitHubMark from '#lib/git/GitHubMark.svelte';
	import OpenRepository from '#lib/git/OpenRepository.svelte';
	import { keepRepository } from '#lib/git/project.ts';
	import type { Progress, RepoChoice } from '#lib/git/types.ts';
	import Settings from '#lib/settings/Settings.svelte';
	import { settings } from '#lib/settings/settings.svelte.ts';
	import { getEngine } from '#lib/engine/instance.ts';
	import {
		canOpenFolders,
		infoFromFiles,
		isProjectFile,
		pickFolder,
		readUploadedFolder,
		starterProject
	} from '#lib/project/sources.ts';
	import {
		deleteProject,
		listProjects,
		newProjectId,
		persistStorage,
		saveProject,
		type ProjectSummary,
		type StoredProject
	} from '#lib/project/store.ts';
	import type { ProjectFile } from '#lib/project/workspace.svelte.ts';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';

	let projects = $state<ProjectSummary[] | null>(null);
	let name = $state('');
	let description = $state('');
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);
	let folderAccess = $state(false);
	let nameField: HTMLInputElement | undefined = $state();
	let confirmDelete = $state<string | null>(null);
	let githubOpen = $state(false);
	let settingsOpen = $state(false);

	onMount(() => {
		settings.init();
		accounts.init();
		folderAccess = canOpenFolders();
		const params = new URLSearchParams(location.search);
		if (params.has('github') || location.hash === '#github') githubOpen = true;
		if (params.has('settings')) settingsOpen = true;
		void refresh();
		if (params.has('new') || location.hash === '#new') void tick().then(() => nameField?.focus());
	});

	async function refresh() {
		try {
			projects = await listProjects();
		} catch (e) {
			projects = [];
			error = `This browser can't store projects: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	/** Store a project and open it. */
	async function keep(project: Omit<StoredProject, 'id' | 'created' | 'updated'>, label: string) {
		busy = label;
		error = null;
		try {
			const id = await newProjectId(project.info.name);
			const now = new Date().toISOString();
			await saveProject({ ...project, id, created: now, updated: now });
			void persistStorage();
			await goto(resolve('/p/[project]', { project: id }));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			busy = null;
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		busy = 'Creating…';
		const libraries = await getEngine().viewLibraries();
		const starter = starterProject(name.trim(), description, libraries);
		await keep({ ...starter, origin: 'new' }, 'Creating…');
	}

	/** Model files only: `.project.json` is kept as the project's info. */
	const modelFiles = (files: ProjectFile[]) =>
		files.filter((f) => f.path !== '.project.json' && isProjectFile(f.path));

	async function openFolder() {
		try {
			const folder = await pickFolder();
			if (!folder.files.some((f) => /\.(sysml|kerml)$/.test(f.path))) {
				error = `No .sysml or .kerml files in “${folder.name}”.`;
				return;
			}
			await keep(
				{
					info: infoFromFiles(folder.files, folder.name),
					files: modelFiles(folder.files),
					origin: 'folder',
					folder: folder.handle
				},
				'Opening…'
			);
		} catch (e) {
			if ((e as DOMException)?.name !== 'AbortError') error = String(e);
		}
	}

	async function uploadFolder(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (!input.files?.length) return;
		const folder = await readUploadedFolder(input.files);
		input.value = '';
		if (!folder.files.some((f) => /\.(sysml|kerml)$/.test(f.path))) {
			error = `No .sysml or .kerml files in “${folder.name}”.`;
			return;
		}
		await keep(
			{
				info: infoFromFiles(folder.files, folder.name),
				files: modelFiles(folder.files),
				origin: 'archive'
			},
			'Opening…'
		);
	}

	async function importArchive(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busy = 'Reading the archive…';
		try {
			const { readProjectArchive } = await import('#lib/interchange/kpar.ts');
			const archive = await readProjectArchive(
				new Uint8Array(await file.arrayBuffer()),
				file.name.replace(/\.(kpar|zip)$/i, '')
			);
			const files = modelFiles(archive.files);
			if (!files.some((f) => /\.(sysml|kerml)$/.test(f.path))) {
				error = `No .sysml or .kerml files in ${file.name}.`;
				busy = null;
				return;
			}
			await keep({ info: archive.info, files, origin: 'archive' }, 'Opening…');
		} catch (e) {
			error = `${file.name} could not be read: ${e instanceof Error ? e.message : String(e)}`;
			busy = null;
		}
	}

	async function openFromGitHub(choice: RepoChoice, progress: Progress) {
		const { id } = await keepRepository(choice, progress);
		await goto(resolve('/p/[project]', { project: id }));
	}

	async function remove(id: string) {
		await deleteProject(id);
		confirmDelete = null;
		await refresh();
	}

	const ORIGIN: Record<StoredProject['origin'], string> = {
		new: 'Created here',
		folder: 'Folder on this computer',
		archive: 'Imported',
		demo: 'Demo',
		git: 'GitHub'
	};

	function ago(iso: string): string {
		const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours} h ago`;
		return new Date(iso).toLocaleDateString();
	}
</script>

<svelte:head>
	<title>Your projects · SysML Web</title>
	<meta name="description" content="Create, open and import SysML v2 projects." />
</svelte:head>

<div class="page">
	<header class="top">
		<a class="brand" href={resolve('/')}><Logo size={26} /> <span>SysML Web</span></a>
		<span class="tools">
			<button
				type="button"
				class="icon-button"
				aria-label="Settings"
				title="Settings"
				onclick={() => (settingsOpen = true)}
			>
				<SettingsIcon size={17} />
			</button>
			<ThemeToggle />
		</span>
	</header>

	<main>
		<h1>Your projects</h1>
		<p class="lede">
			Projects are standard SysML v2 files. They're kept in this browser as you work. Open one from
			GitHub to share it with your team, open a folder to work on files on your computer, or
			download a <code>.kpar</code> to back it up.
		</p>

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if busy}<p class="busy" role="status">{busy}</p>{/if}

		<section class="start" aria-label="Start">
			<form class="card new" onsubmit={create} id="new">
				<h2><Plus size={18} aria-hidden="true" /> New project</h2>
				<p>A starter model with a first requirement, the system part and saved views.</p>
				<label>
					<span>Name</span>
					<input
						bind:this={nameField}
						bind:value={name}
						placeholder="e.g. Delivery drone"
						required
					/>
				</label>
				<label>
					<span>What is it? <small>(optional)</small></span>
					<input bind:value={description} placeholder="One sentence about the system" />
				</label>
				<button type="submit" class="primary" disabled={!!busy || !name.trim()}>
					Create project <ArrowRight size={16} />
				</button>
			</form>

			<div class="card github">
				<h2><GitHubMark size={18} /> Open from GitHub</h2>
				<p>
					Work on a repository's models, then save back to it, start a branch or propose changes for
					review. No git know-how needed.
				</p>
				<button
					type="button"
					class="dark"
					onclick={() => (githubOpen = true)}
					disabled={!!busy || !pwa.online}
					aria-describedby={pwa.online ? undefined : 'github-offline'}
				>
					{accounts.github ? 'Choose a repository…' : 'Connect GitHub…'}
				</button>
				{#if !pwa.online}
					<p class="offline" id="github-offline">
						You're offline. Opening a repository needs a connection to GitHub.
					</p>
				{/if}
			</div>

			<div class="card">
				<h2><FolderOpen size={18} aria-hidden="true" /> Open a folder</h2>
				{#if folderAccess}
					<p>
						Work on the <code>.sysml</code> files in a folder (e.g. a git checkout) and save back to it.
					</p>
					<button type="button" onclick={openFolder} disabled={!!busy}>Choose a folder…</button>
				{:else}
					<p>
						Load the <code>.sysml</code> files from a folder. This browser can't save back to it;
						download a <code>.kpar</code> instead.
					</p>
					<label class="file-button">
						<FolderUp size={16} aria-hidden="true" /> Choose a folder…
						<input type="file" webkitdirectory multiple onchange={uploadFolder} />
					</label>
				{/if}
			</div>

			<div class="card">
				<h2><FileArchive size={18} aria-hidden="true" /> Import</h2>
				<p>A <code>.kpar</code> from any SysML v2 tool, or a <code>.zip</code> of a repository.</p>
				<label class="file-button">
					<FileArchive size={16} aria-hidden="true" /> Choose a file…
					<input type="file" accept=".kpar,.zip,application/zip" onchange={importArchive} />
				</label>
			</div>

			<a class="card demo" href={resolve('/p/[project]', { project: 'demo' })}>
				<h2><Rocket size={18} aria-hidden="true" /> The demo</h2>
				<p>A delivery drone: requirements, architecture, interfaces, behaviour and analysis.</p>
				<span class="go">Open the demo <ArrowRight size={16} /></span>
			</a>
		</section>

		<section aria-labelledby="recent">
			<h2 id="recent">In this browser</h2>
			{#if projects === null}
				<p class="muted">Looking…</p>
			{:else if projects.length === 0}
				<p class="muted">Nothing yet. Create a project, open a folder or import one above.</p>
			{:else}
				<ul class="list">
					{#each projects as p (p.id)}
						<li>
							<a href={resolve('/p/[project]', { project: p.id })}>
								<strong>{p.info.name}</strong>
								{#if p.info.description}<span class="desc">{p.info.description}</span>{/if}
								<span class="meta">
									{#if p.git}
										<span class="gh"
											><GitHubMark size={12} />
											{p.git.owner}/{p.git.repo}
											<GitBranch size={12} aria-hidden="true" />{p.git.branch}</span
										>
									{:else}{ORIGIN[p.origin]}{/if} · {p.fileCount} files · edited {ago(p.updated)}
								</span>
							</a>
							{#if confirmDelete === p.id}
								<span class="confirm">
									Delete from this browser?
									<button type="button" class="danger" onclick={() => remove(p.id)}>Delete</button>
									<button type="button" onclick={() => (confirmDelete = null)}>Keep</button>
								</span>
							{:else}
								<button
									type="button"
									class="icon"
									aria-label="Delete {p.info.name}"
									onclick={() => (confirmDelete = p.id)}
								>
									<Trash2 size={16} />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</main>
</div>

<OpenRepository bind:open={githubOpen} run={openFromGitHub} />
<Settings bind:open={settingsOpen} />

<style>
	.page {
		min-height: 100dvh;
		background: var(--bg);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-5);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text);
		font-weight: 700;
		text-decoration: none;
	}
	.tools {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.icon-button {
		display: inline-grid;
		place-items: center;
		width: 2.125rem;
		height: 2.125rem;
		min-height: 0;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon-button:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.github {
		border-color: color-mix(in oklab, var(--text) 18%, var(--border));
	}
	.offline {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.dark {
		border: 0;
		background: var(--text);
		color: var(--surface);
	}
	.dark:hover {
		opacity: 0.9;
	}
	.dark:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.gh {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-5) var(--space-8, 4rem);
	}
	h1 {
		font-size: clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem);
		letter-spacing: -0.02em;
	}
	.lede {
		max-width: 62ch;
		margin: var(--space-2) 0 var(--space-5);
		color: var(--text-2);
	}
	code {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
	.error {
		margin-bottom: var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--danger) 12%, var(--surface));
		color: var(--text);
	}
	.busy {
		margin-bottom: var(--space-4);
		color: var(--text-2);
	}
	.start {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-6);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 14px);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		color: var(--text);
		text-decoration: none;
	}
	.card h2 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 1.05rem;
	}
	.card p {
		flex: 1;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.new {
		grid-row: span 2;
		border-color: color-mix(in oklab, var(--accent) 35%, var(--border));
		background: linear-gradient(160deg, var(--accent-weak), var(--surface) 55%);
	}
	.new p {
		flex: 0;
	}
	label {
		display: grid;
		gap: 4px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	small {
		color: var(--text-3);
	}
	input:not([type='file']) {
		height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	button,
	.file-button,
	.go {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.file-button {
		position: relative;
	}
	.file-button input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.file-button:focus-within {
		outline: 2px solid var(--focus);
	}
	.primary {
		margin-top: auto;
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:disabled {
		opacity: 0.6;
	}
	.demo:hover {
		border-color: var(--accent);
	}
	.go {
		align-self: flex-start;
		border: 0;
		padding: 0;
		min-height: 0;
		color: var(--accent);
	}
	section > h2 {
		margin-bottom: var(--space-3);
		font-size: 1.1rem;
	}
	.muted {
		color: var(--text-2);
	}
	.list {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.list a {
		display: grid;
		flex: 1;
		gap: 2px;
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		color: var(--text);
		text-decoration: none;
	}
	.list a:hover strong {
		color: var(--accent);
	}
	.desc,
	.meta {
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.icon {
		width: 2.5rem;
		margin-right: var(--space-2);
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-2);
	}
	.confirm {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-right: var(--space-3);
		color: var(--text-2);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.danger {
		border: 0;
		background: var(--danger);
		color: #fff;
	}
</style>
