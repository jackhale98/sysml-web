<script lang="ts">
	/**
	 * "Connect to a SysML v2 API server": a Systems Modeling API server (the
	 * OMG pilot implementation, SysON's /api/rest) by its address and an
	 * optional token. Lists its projects, their branches and commits; opens a
	 * commit as a new project here ("Open from server"), or saves this project
	 * to a branch as one commit holding only what differs ("Save to server").
	 * Connections stay on this device (`servers.svelte.ts`).
	 */
	import {
		ArrowLeft,
		CloudDownload,
		CloudUpload,
		FolderPlus,
		LoaderCircle,
		Plug,
		Server,
		Trash2,
		TriangleAlert
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { Engine } from '#lib/engine/client.ts';
	import { leaving } from '#lib/project/leaving.svelte.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import { newProjectId, saveProject, timestamp } from '#lib/project/store.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { connectTo, type ApiBranch, type ApiCommit, type ApiProject, type SysmlApi } from './api';
	import { readElements } from './elements';
	import ImportSummary from './ImportSummary.svelte';
	import { apiServers, type ServerLink } from './servers.svelte';
	import { changeCount, planPush, push, type PushPlan } from './sync';
	import type { InterchangeImport } from './types';
	import './exchange.css';

	let {
		open = $bindable(false),
		workspace,
		session,
		engine,
		onhelp
	}: {
		open?: boolean;
		workspace: Workspace;
		session?: ProjectSession;
		engine: Engine;
		onhelp?: () => void;
	} = $props();

	const uid = $props.id();
	let view = $state<'connect' | 'browse' | 'save' | 'pulled'>('connect');
	let api = $state.raw<SysmlApi | null>(null);
	let address = $state('');
	let token = $state('');
	let projects = $state.raw<ApiProject[]>([]);
	let projectId = $state<string | null>(null);
	let branches = $state.raw<ApiBranch[]>([]);
	let branchId = $state<string | null>(null);
	let commits = $state.raw<ApiCommit[]>([]);
	/** The commit to open; '' is the branch's latest. */
	let commitId = $state('');
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);
	let plan = $state.raw<PushPlan | null>(null);
	let description = $state('');
	let pulled = $state<{ result: InterchangeImport; name: string; link: ServerLink } | null>(null);

	const project = $derived(projects.find((p) => p.id === projectId) ?? null);
	const branch = $derived(branches.find((b) => b.id === branchId) ?? null);
	const localId = $derived(session?.record?.id ?? null);
	const projectName = $derived(workspace.info?.name ?? 'Project');

	const message = (e: unknown) =>
		(e instanceof Error ? e.message : String(e)).replace(/^\w*Error: /, '');

	async function attempt(label: string, run: () => Promise<void>) {
		busy = label;
		error = null;
		try {
			await run();
		} catch (e) {
			error = message(e);
		} finally {
			busy = null;
		}
	}

	// Opening: back to the server and project this one was opened from or saved to.
	let started = false;
	$effect(() => {
		if (!open) {
			started = false;
			return;
		}
		if (started) return;
		started = true;
		apiServers.init();
		error = null;
		const link = localId ? apiServers.linkOf(localId) : null;
		const saved = link ? apiServers.get(link.url) : apiServers.list[0];
		if (api && view !== 'connect') return;
		view = 'connect';
		if (saved) {
			address = saved.url;
			if (link) void connect(saved.url, saved.token, link);
		}
	});

	async function connect(url: string, key: string | null, link: ServerLink | null = null) {
		await attempt('Connecting…', async () => {
			const connected = await connectTo(url, key || null);
			api = connected.api;
			projects = connected.projects;
			apiServers.remember(connected.api.base, key || null);
			address = connected.api.base;
			token = '';
			view = 'browse';
			projectId = null;
			branches = [];
			commits = [];
			const linked = link && projects.find((p) => p.id === link.project.id);
			if (linked) await choose(linked.id, link.branch?.id ?? null);
		});
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (address.trim()) void connect(address, token);
	}

	async function choose(id: string, preferBranch: string | null = null) {
		projectId = id;
		commitId = '';
		await attempt('Reading branches…', async () => {
			const p = projects.find((x) => x.id === id);
			branches = await api!.branches(id);
			branchId =
				branches.find((b) => b.id === preferBranch)?.id ??
				branches.find((b) => b.id === p?.defaultBranch)?.id ??
				branches[0]?.id ??
				null;
			// Some servers keep commits to themselves: the branch heads are enough.
			commits = await api!.commits(id).catch(() => []);
		});
	}

	function linkFor(commit: string | null): ServerLink {
		return {
			url: api!.base,
			project: { id: project!.id, name: project!.name },
			branch: branch ? { id: branch.id, name: branch.name } : null,
			commit,
			at: timestamp()
		};
	}

	async function openFromServer() {
		const commit = commitId || branch?.head || null;
		if (!api || !project) return;
		if (!commit) {
			error = 'This branch has no commits yet: there is nothing to open.';
			return;
		}
		await attempt('Reading the model…', async () => {
			const elements = await api!.elements(project!.id, commit, (n) => {
				busy = `Reading the model… ${n.toLocaleString('en')} elements`;
			});
			if (!elements.length) throw new Error('This version of the project has no elements.');
			busy = 'Writing it as SysML…';
			const result = await engine.importInterchange(JSON.stringify(elements));
			pulled = { result, name: project!.name, link: linkFor(commit) };
			view = 'pulled';
		});
	}

	async function openPulled() {
		if (!pulled) return;
		const { result, name, link } = pulled;
		if (!(await leaving.confirm('switch'))) return;
		await attempt('Opening…', async () => {
			const id = await newProjectId(name.trim() || 'Imported');
			const now = new Date().toISOString();
			await saveProject({
				id,
				info: { name: name.trim() || 'Imported' },
				files: result.files,
				origin: 'archive',
				created: now,
				updated: now
			});
			apiServers.setLink(id, link);
			location.assign(resolve('/p/[project]', { project: id }));
		});
	}

	async function startSave() {
		if (!api || !project) return;
		view = 'save';
		plan = null;
		description = `Saved from Fairtide: ${projectName}`;
		await attempt('Comparing with the server…', async () => {
			const exported = await engine.exportInterchange(workspace.sourceFiles(), {});
			const ours = readElements(exported.json);
			plan = await planPush(api!, project!.id, branch, ours, (n) => {
				busy = `Reading the server’s version… ${n.toLocaleString('en')} elements`;
			});
		});
	}

	async function confirmSave() {
		if (!api || !project || !plan) return;
		const changes = changeCount(plan.changes);
		await attempt('Saving…', async () => {
			const commit = await push(api!, project!.id, branch, plan!, description.trim() || 'Saved');
			if (localId) apiServers.setLink(localId, linkFor(commit.id));
			toasts.show(
				`Saved to ${project!.name} on ${api!.host}: ${changes} ${changes === 1 ? 'change' : 'changes'}.`,
				{ tone: 'success' }
			);
			view = 'browse';
			await choose(project!.id, branchId);
		});
	}

	async function newServerProject() {
		if (!api) return;
		await attempt('Making the project on the server…', async () => {
			const made = await api!.createProject(projectName, workspace.info?.description ?? '');
			projects = [...projects, made];
			await choose(made.id);
		});
		if (!error && project) await startSave();
	}

	function forget(url: string) {
		apiServers.forget(url);
		if (address === url) address = '';
	}

	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
	const shortId = (id: string) => id.slice(0, 8);
	const count = (n: number, noun: string) =>
		`${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;
</script>

<SheetDialog
	bind:open
	title="SysML v2 API server"
	description={view === 'connect' || !api
		? 'Open and save models on a Systems Modeling API server.'
		: `Connected to ${api.host}`}
	testid="api-server"
>
	{#snippet icon()}<Server size={20} aria-hidden="true" />{/snippet}

	<div class="xc-stack">
		{#if view === 'connect' || !api}
			<form class="xc-stack" onsubmit={submit} id="{uid}-connect">
				<label class="xc-field" for="{uid}-url">
					Server address
					<input
						id="{uid}-url"
						type="url"
						inputmode="url"
						placeholder="https://sysml.example.org/api/rest"
						autocomplete="url"
						required
						bind:value={address}
					/>
					<small
						>The API's base address: the OMG pilot server's, or SysON's ending in
						<code>/api/rest</code>.</small
					>
				</label>
				<label class="xc-field" for="{uid}-token">
					Token <span class="optional">(if the server asks for one)</span>
					<input id="{uid}-token" type="password" autocomplete="off" bind:value={token} />
					<small>Kept on this device and sent only to this server.</small>
				</label>
			</form>
			{#if apiServers.list.length}
				<section class="xc-stack" aria-labelledby="{uid}-saved">
					<h3 id="{uid}-saved" class="heading">Servers on this device</h3>
					<ul class="xc-list">
						{#each apiServers.list as s (s.url)}
							<li class="saved">
								<button
									type="button"
									class="pick"
									disabled={!!busy}
									onclick={() => void connect(s.url, s.token)}
								>
									<Plug size={15} aria-hidden="true" />
									<span class="url">{s.url}</span>
									{#if s.token}<span class="tag">with a token</span>{/if}
								</button>
								<button
									type="button"
									class="icon"
									aria-label="Forget {s.url}"
									title="Forget this server"
									onclick={() => forget(s.url)}><Trash2 size={15} aria-hidden="true" /></button
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			<p class="xc-muted">
				The browser talks to the server directly, so the server must allow requests from this page
				(CORS).{#if onhelp}
					<button type="button" class="link" onclick={onhelp}>What the server needs</button>{/if}
			</p>
		{:else if view === 'pulled' && pulled}
			<label class="xc-field" for="{uid}-name">
				Project name
				<input id="{uid}-name" bind:value={pulled.name} autocomplete="off" />
				<small>Opens as a new project on this device, linked to {pulled.link.project.name}.</small>
			</label>
			<ImportSummary result={pulled.result} source="{pulled.link.project.name} ({api.host})" />
		{:else if view === 'save'}
			<p>
				Save <strong>{projectName}</strong> to <strong>{project?.name}</strong>{#if branch}, branch
					<strong>{branch.name}</strong>{/if}, as one commit.
			</p>
			{#if plan}
				{@const c = plan.changes}
				{#if changeCount(c) === 0}
					<p class="xc-note ok" role="status">
						The server already has this version: there is nothing to save.
					</p>
				{:else}
					<ul class="xc-list changes" data-testid="push-plan">
						<li><strong>{count(c.created.length, 'element')}</strong> new</li>
						<li><strong>{count(c.updated.length, 'element')}</strong> changed</li>
						<li><strong>{count(c.deleted.length, 'element')}</strong> removed</li>
					</ul>
					{#if c.deleted.length}
						<p class="xc-note warn">
							<TriangleAlert size={16} aria-hidden="true" />
							<span
								>The server's version becomes this project's: what it has and this project doesn't
								is removed in the new commit (earlier commits keep it).</span
							>
						</p>
					{/if}
					<label class="xc-field" for="{uid}-message">
						Describe the change
						<input id="{uid}-message" bind:value={description} autocomplete="off" />
					</label>
				{/if}
			{/if}
		{:else}
			{#if projects.length}
				<fieldset class="xc-options">
					<legend>Projects on the server</legend>
					{#each projects as p (p.id)}
						<label class="xc-option compact">
							<input
								type="radio"
								name="{uid}-project"
								value={p.id}
								checked={projectId === p.id}
								disabled={!!busy}
								onchange={() => void choose(p.id)}
							/>
							<strong>{p.name}</strong>
							{#if p.description}<span>{p.description}</span>{/if}
						</label>
					{/each}
				</fieldset>
			{:else}
				<p class="xc-muted">The server has no projects yet.</p>
			{/if}
			<button
				type="button"
				class="xc-button xc-small new"
				disabled={!!busy}
				onclick={newServerProject}
			>
				<FolderPlus size={15} aria-hidden="true" /> Save {projectName} as a new project there
			</button>
			{#if project}
				<div class="pickers">
					<label class="xc-field" for="{uid}-branch">
						Branch
						<select id="{uid}-branch" bind:value={branchId} disabled={!!busy || !branches.length}>
							{#each branches as b (b.id)}
								<option value={b.id}>{b.name}</option>
							{/each}
						</select>
					</label>
					<label class="xc-field" for="{uid}-commit">
						Version to open
						<select id="{uid}-commit" bind:value={commitId} disabled={!!busy}>
							<option value="">Latest on {branch?.name ?? 'the branch'}</option>
							{#each commits as c (c.id)}
								<option value={c.id}
									>{c.description || 'Commit'} · {when(c.created)} · {shortId(c.id)}</option
								>
							{/each}
						</select>
					</label>
				</div>
			{/if}
		{/if}

		{#if busy}
			<p class="xc-note" role="status">
				<LoaderCircle size={16} class="xc-spin" aria-hidden="true" /><span>{busy}</span>
			</p>
		{/if}
		{#if error}
			<p class="xc-note danger" role="alert">
				<TriangleAlert size={16} aria-hidden="true" /><span>{error}</span>
			</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if view === 'connect' || !api}
			<button type="button" class="xc-button" onclick={() => (open = false)}>Cancel</button>
			<button type="submit" class="xc-primary" form="{uid}-connect" disabled={!!busy}>
				<Plug size={16} aria-hidden="true" /> Connect
			</button>
		{:else if view === 'pulled'}
			<button type="button" class="xc-button" onclick={() => (view = 'browse')}>
				<ArrowLeft size={16} aria-hidden="true" /> Back
			</button>
			<button type="button" class="xc-primary" disabled={!!busy} onclick={openPulled}>
				Open project
			</button>
		{:else if view === 'save'}
			<button type="button" class="xc-button" onclick={() => (view = 'browse')}>
				<ArrowLeft size={16} aria-hidden="true" /> Back
			</button>
			<button
				type="button"
				class="xc-primary"
				disabled={!!busy || !plan || changeCount(plan.changes) === 0}
				onclick={confirmSave}
			>
				<CloudUpload size={16} aria-hidden="true" /> Save
			</button>
		{:else}
			<button type="button" class="xc-button" onclick={() => (view = 'connect')}>
				Change server
			</button>
			<button
				type="button"
				class="xc-button"
				disabled={!!busy || !project}
				onclick={openFromServer}
			>
				<CloudDownload size={16} aria-hidden="true" /> Open from server
			</button>
			<button type="button" class="xc-primary" disabled={!!busy || !project} onclick={startSave}>
				<CloudUpload size={16} aria-hidden="true" /> Save to server
			</button>
		{/if}
	{/snippet}
</SheetDialog>

<style>
	.optional {
		color: var(--text-2);
		font-weight: 400;
	}
	.heading {
		font-size: var(--text-sm);
	}
	.saved {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.pick {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.pick:hover {
		background: var(--surface-hover);
	}
	.url {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex: none;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface-hover);
	}
	.compact {
		padding: var(--space-2) var(--space-3);
	}
	.new {
		justify-self: start;
	}
	.pickers {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: var(--space-3);
	}
	.pickers select {
		min-width: 0;
	}
	.changes li {
		font-size: var(--text-md);
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
	@media (max-width: 760px) {
		.pickers {
			grid-template-columns: 1fr;
		}
	}
</style>
