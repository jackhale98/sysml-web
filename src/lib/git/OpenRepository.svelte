<script lang="ts">
	import FairtideLoader from '#lib/ui/FairtideLoader.svelte';
	/**
	 * Choose a GitHub repository and branch: from the account's repositories
	 * (searchable) or a pasted URL. Connects the account first if needed.
	 * `run` does the work (open as a project, or connect the current one)
	 * while the dialog shows progress and any error.
	 */
	import { ExternalLink, GitBranch, Lock, Search, UserPlus, X } from '@lucide/svelte';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import { accounts } from './account.svelte.ts';
	import ConnectGitHub from './ConnectGitHub.svelte';
	import { GitError, messageOf } from './errors.ts';
	import GitHubMark from './GitHubMark.svelte';
	import { parseRepoUrl } from './github.ts';
	import type { Resume } from './oauth.ts';
	import { chooseRepositories, chooseRepositoriesUrl } from './signin.ts';
	import type { BranchSummary, Progress, RepoChoice, RepoSummary } from './types.ts';

	let {
		open = $bindable(false),
		title = 'Open from GitHub',
		action = 'Open',
		intro = 'Pick a repository with SysML files. Its .sysml, .kerml and Markdown files are copied into this browser to work on; save them back with “Save to GitHub”.',
		resume = 'open-repository',
		run
	}: {
		open?: boolean;
		title?: string;
		action?: string;
		intro?: string;
		/** What to reopen after a round trip to GitHub (signing in, choosing repositories). */
		resume?: Resume;
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
	/** The account whose repositories are listed (the default one unless another is picked). */
	let picked = $state<string | null>(null);
	const browsing = $derived(accounts.find(picked) ?? accounts.github);
	const login = $derived(browsing?.user.login ?? null);
	/** Adding another account, from here. */
	let adding = $state(false);
	/** Signed in with GitHub: the app sees only the repositories chosen for it on GitHub. */
	const installLink = $derived(browsing?.via === 'app' ? chooseRepositoriesUrl() : null);
	let errorKind = $state<string | null>(null);
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
			if (accounts.connected && (!repos || reposFor !== login)) {
				repos = null;
				selected = null;
				branches = null;
				void loadRepos();
			}
		} else if (!open && dialog.open) dialog.close();
	});

	/** Whose repositories `repos` lists. */
	let reposFor: string | null = null;

	async function loadRepos() {
		error = null;
		reposFor = login;
		try {
			repos = await accounts.provider(login).listRepos();
		} catch (e) {
			repos = [];
			fail(e);
		}
	}

	function fail(e: unknown) {
		error = messageOf(e);
		errorKind = e instanceof GitError ? e.kind : null;
	}

	function chooseOnGitHub(event: MouseEvent) {
		event.preventDefault();
		void chooseRepositories(resume);
	}

	async function choose(repo: RepoSummary, wanted?: string) {
		selected = repo;
		branches = null;
		branch = wanted ?? repo.defaultBranch;
		error = null;
		try {
			branches = await accounts.provider(login).listBranches(repo);
			if (!branches.some((b) => b.name === branch)) branch = branches[0]?.name ?? branch;
		} catch (e) {
			fail(e);
		}
	}

	async function usePasted() {
		if (!pasted) return;
		busy = 'Looking it up…';
		error = null;
		try {
			const repo = await accounts.provider(login).getRepo(pasted);
			repos = [repo, ...(repos ?? []).filter((r) => r.fullName !== repo.fullName)];
			query = '';
			await choose(repo, pasted.branch);
		} catch (e) {
			fail(e);
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
					defaultBranch: selected.defaultBranch,
					...(login ? { account: login } : {})
				},
				(done, total) => (progress = { done, total })
			);
			open = false;
		} catch (e) {
			fail(e);
		} finally {
			busy = null;
		}
	}

	/** List another account's repositories (and make it the default for next time). */
	function browseAs(next: string) {
		picked = next;
		accounts.use(next);
		repos = null;
		selected = null;
		branches = null;
		error = null;
		void loadRepos();
	}

	function added() {
		adding = false;
		if (accounts.github) browseAs(accounts.github.user.login);
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

{#snippet chooseLink(label: string)}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- GitHub's page; returns to this one -->
	<a class="choose" href={installLink} onclick={chooseOnGitHub}>
		{label}
		<ExternalLink size={13} aria-hidden="true" />
	</a>
{/snippet}

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
			{#if !pwa.online && connected}
				<p class="offline" role="status">
					You're offline. Opening a repository needs a connection to GitHub; try again once you're
					back online.
				</p>
			{/if}
			{#if !connected}
				<ConnectGitHub {resume} onconnected={() => void loadRepos()} />
			{:else if adding}
				<ConnectGitHub {resume} another onconnected={added} />
				<button type="button" class="link-button" onclick={() => (adding = false)}>
					Back to {login ? `@${login}'s` : 'your'} repositories
				</button>
			{:else}
				<p class="intro">{intro}</p>
				{#if accounts.list.length > 1}
					<div class="account-row">
						{#if browsing?.user.avatarUrl}
							<img src={browsing.user.avatarUrl} alt="" width="24" height="24" />
						{/if}
						<label for="{uid}-account">Account</label>
						<select
							id="{uid}-account"
							value={login}
							disabled={!!busy}
							onchange={(e) => browseAs(e.currentTarget.value)}
						>
							{#each accounts.list as a (a.user.login)}
								<option value={a.user.login}
									>@{a.user.login}{a.user.name ? ` (${a.user.name})` : ''}</option
								>
							{/each}
						</select>
					</div>
				{/if}
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
							<p class="muted pad loading" role="status">
								<FairtideLoader size={28} label="" /> Loading your repositories…
							</p>
						{:else if !results.length && !repos.length && installLink}
							<div class="none">
								<p>
									<strong>Choose the repositories Fairtide can use.</strong>
									GitHub asks you once which of your repositories (or your organisation’s) to open here.
									You’ll come straight back.
								</p>
								{@render chooseLink('Choose repositories on GitHub')}
							</div>
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
					{#if installLink && repos?.length}
						<p class="more">
							Don’t see a repository? {@render chooseLink('Choose repositories on GitHub')}
						</p>
					{/if}
					<button type="button" class="link-button" onclick={() => (adding = true)}>
						<UserPlus size={15} aria-hidden="true" /> Use another GitHub account
					</button>

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

			{#if error}
				<div class="error" role="alert">
					<p>{error}</p>
					{#if installLink && (errorKind === 'not-found' || errorKind === 'permission')}
						{@render chooseLink('Choose repositories on GitHub')}
					{/if}
				</div>
			{/if}
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
						{#if browsing?.user.avatarUrl}
							<img src={browsing.user.avatarUrl} alt="" width="20" height="20" />
						{/if}
						Signed in as <strong>{login}</strong>
					</span>
				{/if}
				<button type="button" onclick={() => (open = false)} disabled={!!busy}>Cancel</button>
				<button
					type="submit"
					form="{uid}-form"
					class="primary"
					disabled={!selected || !branches || !!busy || !pwa.online}
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
	.error,
	.offline {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		font-size: var(--text-sm);
	}
	.error {
		display: grid;
		gap: var(--space-1);
		justify-items: start;
	}
	.none {
		display: grid;
		gap: var(--space-3);
		justify-items: start;
		padding: var(--space-3);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.none strong {
		display: block;
		margin-bottom: 2px;
		color: var(--text);
	}
	.none .choose {
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--text);
		color: var(--surface);
		text-decoration: none;
	}
	.none .choose:hover {
		opacity: 0.9;
	}
	.more {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.choose {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: 600;
	}
	.offline {
		background: var(--warn-weak);
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
	.who img,
	.account-row img {
		border-radius: 50%;
	}
	.account-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.account-row label {
		color: var(--text-2);
		font-weight: 600;
	}
	.account-row select {
		flex: 1;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.link-button {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
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
