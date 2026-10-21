<script lang="ts">
	/**
	 * Choose a GitHub repository and branch: from the account's repositories
	 * (searchable) or a pasted URL. Connects the account first if needed.
	 * `run` does the work (open as a project, or connect the current one)
	 * while the dialog shows progress and any error.
	 */
	import { GitBranch, LoaderCircle, Lock, Search, X } from '@lucide/svelte';
	import { accounts } from './account.svelte.ts';
	import ConnectGitHub from './ConnectGitHub.svelte';
	import { messageOf } from './errors.ts';
	import GitHubMark from './GitHubMark.svelte';
	import { parseRepoUrl } from './github.ts';
	import type { BranchSummary, Progress, RepoChoice, RepoSummary } from './types.ts';

	let {
		open = $bindable(false),
		title = 'Open from GitHub',
		action = 'Open',
		intro = 'Pick a repository with SysML files. Its .sysml, .kerml and Markdown files are copied into this browser to work on; save them back with “Save to GitHub”.',
		run
	}: {
		open?: boolean;
		title?: string;
		action?: string;
		intro?: string;
		run: (choice: RepoChoice, progress: Progress) => Promise<void>;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let repos = $state.raw<RepoSummary[] | null>(null);
	let query = $state('');
	let selected = $state.raw<RepoSummary | null>(null);
	let branches = $state.raw<BranchSummary[] | null>(null);
	let branch = $state('');
	let busy = $state<string | null>(null);
	let progress = $state<{ done: number; total: number } | null>(null);
	let error = $state<string | null>(null);

	const connected = $derived(accounts.connected);
	const pasted = $derived(parseRepoUrl(query));
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const all = repos ?? [];
		const hits = q
			? all.filter(
					(r) => r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)
				)
			: all;
		return hits.slice(0, 60);
	});
	const pastedIsListed = $derived(
		!!pasted &&
			results.some(
				(r) => r.fullName.toLowerCase() === `${pasted.owner}/${pasted.repo}`.toLowerCase()
			)
	);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			error = null;
			progress = null;
			busy = null;
			dialog.showModal();
			if (accounts.connected && !repos) void loadRepos();
		} else if (!open && dialog.open) dialog.close();
	});

	async function loadRepos() {
		error = null;
		try {
			repos = await accounts.provider().listRepos();
		} catch (e) {
			repos = [];
			error = messageOf(e);
		}
	}

	async function choose(repo: RepoSummary, wanted?: string) {
		selected = repo;
		branches = null;
		branch = wanted ?? repo.defaultBranch;
		error = null;
		try {
			branches = await accounts.provider().listBranches(repo);
			if (!branches.some((b) => b.name === branch)) branch = branches[0]?.name ?? branch;
		} catch (e) {
			error = messageOf(e);
		}
	}

	async function usePasted() {
		if (!pasted) return;
		busy = 'Looking it up…';
		error = null;
		try {
			const repo = await accounts.provider().getRepo(pasted);
			repos = [repo, ...(repos ?? []).filter((r) => r.fullName !== repo.fullName)];
			query = '';
			await choose(repo, pasted.branch);
		} catch (e) {
			error = messageOf(e);
		} finally {
			busy = null;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!selected || !branch) return;
		busy = 'Reading files…';
		error = null;
		progress = null;
		try {
			await run(
				{
					ref: { owner: selected.owner, repo: selected.repo },
					branch,
					defaultBranch: selected.defaultBranch
				},
				(done, total) => (progress = { done, total })
			);
			open = false;
		} catch (e) {
			error = messageOf(e);
		} finally {
			busy = null;
		}
	}

	function ago(iso: string | null | undefined): string {
		if (!iso) return '';
		const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
		if (days < 1) return 'updated today';
		if (days === 1) return 'updated yesterday';
		if (days < 30) return `updated ${days} days ago`;
		return `updated ${new Date(iso).toLocaleDateString()}`;
	}

	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog && !busy) open = false;
	}
</script>

<!-- A backdrop click closes it; so does Escape. -->
<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	onclose={() => (open = false)}
	onclick={onbackdrop}
	oncancel={(e) => busy && e.preventDefault()}
>
	{#if open}
		<header>
			<span class="mark"><GitHubMark size={20} /></span>
			<h2 id="{uid}-title">{title}</h2>
			<button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
				<X size={18} />
			</button>
		</header>

		<div class="body">
			{#if !connected}
				<ConnectGitHub onconnected={() => void loadRepos()} />
			{:else}
				<p class="intro">{intro}</p>
				<form id="{uid}-form" onsubmit={submit}>
					<div class="search">
						<Search size={16} aria-hidden="true" />
						<input
							type="search"
							bind:value={query}
							placeholder="Search, or paste a GitHub URL"
							aria-label="Search your repositories, or paste a GitHub URL"
							aria-controls="{uid}-repos"
						/>
					</div>

					{#if pasted && !pastedIsListed}
						<button type="button" class="pasted" onclick={usePasted} disabled={!!busy}>
							<GitHubMark size={16} /> Use <strong>{pasted.owner}/{pasted.repo}</strong>
							{#if pasted.branch}<span class="muted">· {pasted.branch}</span>{/if}
						</button>
					{/if}

					<fieldset class="repos" id="{uid}-repos">
						<legend class="visually-hidden">Repository</legend>
						{#if repos === null}
							<p class="muted pad" role="status">
								<LoaderCircle size={14} class="spin" aria-hidden="true" /> Loading your repositories…
							</p>
						{:else if !results.length}
							<p class="muted pad">
								{repos.length
									? 'No repository matches. Paste its URL instead.'
									: 'Your token can’t see any repositories yet. Edit the token on GitHub to add some, or paste a public repository’s URL.'}
							</p>
						{:else}
							{#each results as repo (repo.fullName)}
								<label class="repo" class:on={selected?.fullName === repo.fullName}>
									<input
										type="radio"
										name="{uid}-repo"
										class="visually-hidden"
										checked={selected?.fullName === repo.fullName}
										onchange={() => choose(repo)}
									/>
									<span class="repo-name">
										{#if repo.private}<Lock size={13} aria-label="Private" />{/if}
										<span class="owner">{repo.owner}/</span><strong>{repo.repo}</strong>
										{#if !repo.canPush}<span class="tag">read-only</span>{/if}
									</span>
									{#if repo.description}<span class="desc">{repo.description}</span>{/if}
									<span class="when">{ago(repo.pushedAt)}</span>
								</label>
							{/each}
						{/if}
					</fieldset>

					{#if selected}
						<div class="branch-row">
							<label for="{uid}-branch">
								<GitBranch size={15} aria-hidden="true" /> Branch
								<small>the line of work to open</small>
							</label>
							<select id="{uid}-branch" bind:value={branch} disabled={!branches}>
								{#if !branches}<option value={branch}>{branch}</option>{/if}
								{#each branches ?? [] as b (b.name)}
									<option value={b.name}
										>{b.name}{b.name === selected.defaultBranch ? ' (default)' : ''}</option
									>
								{/each}
							</select>
						</div>
					{/if}
				</form>
			{/if}

			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>

		{#if connected}
			<footer>
				{#if busy}
					<div class="progress" role="status">
						<span>
							{busy}
							{#if progress && progress.total}{progress.done} of {progress.total}{/if}
						</span>
						{#if progress && progress.total}
							<progress max={progress.total} value={progress.done} aria-label="Files read"
							></progress>
						{/if}
					</div>
				{:else}
					<span class="who">
						{#if accounts.github?.user.avatarUrl}
							<img src={accounts.github.user.avatarUrl} alt="" width="20" height="20" />
						{/if}
						Signed in as <strong>{accounts.github?.user.login}</strong>
					</span>
				{/if}
				<button type="button" onclick={() => (open = false)} disabled={!!busy}>Cancel</button>
				<button
					type="submit"
					form="{uid}-form"
					class="primary"
					disabled={!selected || !branches || !!busy}
				>
					{action}
				</button>
			</footer>
		{/if}
	{/if}
</dialog>

<style>
	dialog {
		width: min(40rem, calc(100vw - 2rem));
		max-width: none;
		max-height: min(46rem, calc(100dvh - 4rem));
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 2px);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		animation: pop 180ms var(--ease);
	}
	dialog::backdrop {
		background: rgb(14 16 20 / 0.45);
		backdrop-filter: blur(6px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5);
	}
	header h2 {
		flex: 1;
		font-size: var(--text-xl);
	}
	.mark {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		background: var(--text);
		color: var(--surface);
	}
	.close {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
	}
	.body {
		flex: 1;
		display: grid;
		align-content: start;
		gap: var(--space-3);
		min-height: 0;
		padding: 0 var(--space-5) var(--space-4);
		overflow: auto;
	}
	.intro,
	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	form {
		display: grid;
		gap: var(--space-3);
	}
	.search {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
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
		height: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
	}
	.pasted {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px dashed var(--accent);
		border-radius: var(--radius-md);
		background: var(--accent-weak);
		color: var(--text);
		cursor: pointer;
	}
	.repos {
		display: grid;
		gap: 2px;
		max-height: 18rem;
		margin: 0;
		padding: 4px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	.pad {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
	}
	.repo {
		display: grid;
		gap: 1px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.repo:hover {
		background: var(--surface);
	}
	.repo.on {
		border-color: var(--accent);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.repo:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.repo-name {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.owner {
		color: var(--text-2);
	}
	.tag {
		margin-left: var(--space-2);
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--muted-weak);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.desc {
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.branch-row {
		display: grid;
		grid-template-columns: 1fr minmax(10rem, 16rem);
		align-items: center;
		gap: var(--space-3);
	}
	.branch-row label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--space-2);
		font-weight: 600;
	}
	.branch-row small {
		color: var(--text-3);
		font-weight: 400;
	}
	select {
		height: 2.5rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}
	.error {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		font-size: var(--text-sm);
	}
	footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}
	.who,
	.progress {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.progress {
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
	}
	progress {
		width: 100%;
		height: 6px;
		accent-color: var(--accent);
	}
	.who img {
		border-radius: 50%;
	}
	footer button {
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	footer .primary {
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	footer button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.body :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 760px) {
		dialog {
			width: 100vw;
			height: 100dvh;
			max-height: none;
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		.repos {
			max-height: none;
		}
		.branch-row {
			grid-template-columns: 1fr;
		}
		.who {
			display: none;
		}
		footer {
			justify-content: flex-end;
			padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open] {
			animation: none;
		}
	}
</style>
