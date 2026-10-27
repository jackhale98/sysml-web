<script lang="ts">
	import TesseraLoader from '#lib/ui/TesseraLoader.svelte';
	/**
	 * The project's GitHub side sheet: what changed (with diffs and Discard),
	 * Save to GitHub (commit & push), Get latest (pull, with a per-file choice
	 * when both sides changed), new branches and proposals (pull requests).
	 * Plain words first; the git term follows in small text.
	 */
	import {
		ArrowDownToLine,
		Check,
		ChevronRight,
		CircleAlert,
		CloudUpload,
		ExternalLink,
		GitBranch,
		GitBranchPlus,
		GitPullRequest,
		LoaderCircle,
		RefreshCw,
		Undo2,
		WifiOff,
		X
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { accounts } from './account.svelte.ts';
	import ConflictChoices from './ConflictChoices.svelte';
	import ConnectGitHub from './ConnectGitHub.svelte';
	import { defaultMessage } from './connection.svelte.ts';
	import { diffStats, lineDiff } from './diff.ts';
	import DiffView from './DiffView.svelte';
	import { GitError, messageOf } from './errors.ts';
	import GitHubMark from './GitHubMark.svelte';
	import OpenRepository from './OpenRepository.svelte';
	import {
		chooseRepositories,
		chooseRepositoriesUrl,
		SIGN_IN,
		signInWithGitHub
	} from './signin.ts';
	import { branchName, type Resolution } from './sync.ts';
	import ChangeSummary from '#lib/review/ChangeSummary.svelte';
	import { knowBlobs, modelFilesAt } from '#lib/review/remote.ts';
	import {
		commitMessage,
		markdownSummary,
		summarize,
		type ReviewSummary
	} from '#lib/review/summary.ts';
	import { isModelFile } from '#lib/project/workspace.svelte.ts';
	import type { BranchSummary, Progress, RepoChoice } from './types.ts';

	let {
		session,
		engine,
		open = $bindable(false),
		onreview
	}: {
		session: ProjectSession;
		engine: Engine;
		open?: boolean;
		/** Opens the full review of the changes (shown when the host can). */
		onreview?: () => void;
	} = $props();

	const uid = $props.id();
	const git = $derived(session.git);
	const record = $derived(session.record?.git ?? null);
	const changes = $derived(git.changes);
	/** The project's own account (or, before it has a repository, any account) is connected. */
	const connected = $derived(record ? !!git.account : accounts.connected);
	/** The project remembers an account that isn't signed in here (signed out, or another device). */
	const missingLogin = $derived(record?.account && !git.account ? record.account : null);
	/** Signed in with GitHub (rather than with an access token). */
	const signedIn = $derived((record ? git.account : accounts.github)?.via === 'app');
	/** Signed in: where to choose the repositories Tessera can use. */
	const installLink = $derived(signedIn ? chooseRepositoriesUrl() : null);

	function chooseOnGitHub(event: MouseEvent) {
		event.preventDefault();
		void chooseRepositories('source-control');
	}
	/** Signed in and online: GitHub can be reached. */
	const reachable = $derived(connected && pwa.online);
	const ref = $derived(record ? { owner: record.owner, repo: record.repo } : null);
	const webUrl = $derived(ref ? `https://github.com/${ref.owner}/${ref.repo}` : '');

	let dialog = $state<HTMLDialogElement>();
	let body = $state<HTMLDivElement>();
	let expanded = $state<string | null>(null);
	let confirmDiscard = $state<string | null>(null);
	let message = $state('');
	let error = $state<GitError | null>(null);
	let notice = $state<{ text: string; href?: string; link?: string } | null>(null);
	let linkOpen = $state(false);
	let branchInput = $state('');
	let prTitle = $state('');
	let prBody = $state('');
	let prInto = $state('');
	let branches = $state.raw<BranchSummary[] | null>(null);
	let choices = $state<Record<string, Resolution>>({});
	let progress = $state<{ done: number; total: number } | null>(null);

	const pending = $derived(git.pending);
	const busy = $derived(git.busy);
	const working = $derived(!!busy && busy !== 'checking');
	const onDefault = $derived(!!record && record.branch === record.defaultBranch);
	const newBranch = $derived(branchName(branchInput));
	const unresolved = $derived(
		pending ? pending.conflicts.filter((c) => !choices[c.path]).length : 0
	);
	const updatedCount = $derived(pending ? Object.keys(pending.updates).length : 0);
	const pr = $derived(
		record?.pullRequest && record.pullRequest.branch === record.branch ? record.pullRequest : null
	);

	// The model files at the base version, and as they are now: what the summary compares.
	const baseTexts = $derived(
		Object.fromEntries(
			Object.entries(record?.files ?? {})
				.filter(([path]) => isModelFile(path))
				.map(([path, f]) => [path, f.text])
		)
	);
	const currentTexts = $derived.by(() => {
		const now: Record<string, string> = { ...baseTexts };
		for (const c of changes) {
			if (!isModelFile(c.path)) continue;
			if (c.after === null) delete now[c.path];
			else now[c.path] = c.after;
		}
		return now;
	});
	/** The changes in plain language, for the commit message. */
	let semantic = $state.raw<ReviewSummary | null>(null);
	const suggested = $derived(semantic && !semantic.empty ? commitMessage(semantic) : '');
	let summarising = $state(false);

	/** Describe the proposal with what changed in the model on this branch. */
	async function describeProposal() {
		if (!record || !ref) return;
		summarising = true;
		try {
			const provider = git.provider();
			const start = await provider.mergeBase(ref, prInto || record.defaultBranch, record.base);
			knowBlobs(record.files);
			const before = await modelFilesAt(provider, ref, start);
			const list = (files: Record<string, string>) =>
				Object.keys(files)
					.sort()
					.map((path) => ({ path, text: files[path]! }));
			const comparison = await engine.compareModels(list(before), list(baseTexts));
			const summary = summarize(comparison.diff);
			prBody = summary.empty ? 'No change to the model itself.' : markdownSummary(summary);
			if (!prTitle.trim() && !summary.empty) prTitle = commitMessage(summary).split('\n')[0]!;
		} catch (e) {
			error = e instanceof GitError ? e : new GitError('other', messageOf(e));
		} finally {
			summarising = false;
		}
	}

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			error = null;
			notice = null;
			dialog.showModal();
			void git.check();
		} else if (!open && dialog.open) dialog.close();
	});

	// Bring news (success or failure) into view: it is shown at the top.
	$effect(() => {
		if (notice || error) body?.scrollTo({ top: 0, behavior: 'smooth' });
	});

	async function act(action: () => Promise<void>) {
		error = null;
		notice = null;
		try {
			await action();
		} catch (e) {
			error = e instanceof GitError ? e : new GitError('other', messageOf(e));
		}
	}

	const save = () =>
		act(async () => {
			const result = await git.save(message.trim() ? message : suggested);
			message = '';
			expanded = null;
			notice = {
				text: `Saved to GitHub on “${record?.branch}”.`,
				href: result.url,
				link: 'See the version'
			};
			toasts.show('Saved to GitHub.', { tone: 'success' });
		});

	const pull = () =>
		act(async () => {
			progress = null;
			const outcome = await git.pull(engine, (done, total) => (progress = { done, total }));
			progress = null;
			if (outcome === 'conflicts') {
				choices = Object.fromEntries(
					(git.pending?.conflicts ?? [])
						.filter((c) => c.merged !== null)
						.map((c) => [c.path, 'merged' as const])
				);
				expanded = null;
			} else
				notice = {
					text:
						outcome === 'up-to-date'
							? 'You already have the latest version.'
							: 'Got the latest version from GitHub.'
				};
		});

	const resolve = () =>
		act(async () => {
			await git.resolve($state.snapshot(choices), engine);
			choices = {};
			notice = { text: 'Got the latest version from GitHub. Your choices were kept.' };
		});

	const startBranch = (event: SubmitEvent) => {
		event.preventDefault();
		const name = newBranch;
		if (!name) return;
		return act(async () => {
			await git.createBranch(name);
			branchInput = '';
			branches = null;
			notice = {
				text: `You're now on the new branch “${name}”. Save to GitHub to put your changes there.`
			};
		});
	};

	async function loadBranches() {
		if (branches || !ref) return;
		try {
			branches = await git.provider().listBranches(ref);
		} catch {
			branches = [];
		}
		prInto ||= record?.defaultBranch ?? '';
	}

	const propose = (event: SubmitEvent) => {
		event.preventDefault();
		return act(async () => {
			const created = await git.propose(
				prTitle.trim() || defaultMessage(changes) || `Changes on ${record?.branch}`,
				prBody,
				prInto || record!.defaultBranch
			);
			prTitle = '';
			prBody = '';
			notice = {
				text: `Proposal #${created.number} is open for review.`,
				href: created.url,
				link: 'Open it on GitHub'
			};
		});
	};

	const discard = (path: string) =>
		act(async () => {
			await git.discard(path, engine);
			confirmDiscard = null;
			if (expanded === path) expanded = null;
		});

	const link = async (
		{ ref, branch, defaultBranch, account }: RepoChoice,
		onProgress: Progress
	) => {
		await git.link(ref, branch, defaultBranch, onProgress, account);
		notice = {
			text: `Connected to ${ref.owner}/${ref.repo}. Your files are compared with “${branch}” below.`
		};
	};

	function reconnect() {
		accounts.signOut(git.login);
		error = null;
	}

	const useAccount = (login: string) =>
		act(async () => {
			await git.useAccount(login);
			notice = { text: `This project now saves to GitHub as @${login}.` };
			void git.check();
		});

	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog) open = false;
	}

	const parts = (path: string) => {
		const i = path.lastIndexOf('/');
		return { dir: i < 0 ? '' : path.slice(0, i + 1), name: path.slice(i + 1) };
	};
	const STATUS = {
		added: { letter: 'A', word: 'Added' },
		modified: { letter: 'M', word: 'Changed' },
		deleted: { letter: 'D', word: 'Deleted' }
	} as const;
	const statsOf = (before: string | null, after: string | null) =>
		diffStats(lineDiff(before ?? '', after ?? ''));
	const checkedAgo = $derived.by(() => {
		const at = git.remote?.checkedAt;
		if (!at) return '';
		const minutes = Math.round((Date.now() - at) / 60000);
		return minutes < 1 ? 'just now' : `${minutes} min ago`;
	});
</script>

{#snippet term(text: string)}<small class="term">{text}</small>{/snippet}

<!-- A backdrop click closes it; so does Escape. -->
<dialog
	bind:this={dialog}
	class="sheet"
	aria-labelledby="{uid}-title"
	onclose={() => (open = false)}
	onclick={onbackdrop}
>
	{#if open}
		<header class="head">
			<span class="mark"><GitHubMark size={20} /></span>
			<div class="title">
				<h2 id="{uid}-title">{record ? record.repo : 'Save to GitHub'}</h2>
				{#if record}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
					<a href={webUrl} target="_blank" rel="noopener noreferrer">
						{record.owner}/{record.repo}
						<ExternalLink size={12} aria-hidden="true" /><span class="visually-hidden"
							>(opens GitHub in a new tab)</span
						>
					</a>
				{:else}
					<span class="sub">Keep versions, share and review</span>
				{/if}
			</div>
			<button type="button" class="icon" aria-label="Close" onclick={() => (open = false)}>
				<X size={18} />
			</button>
		</header>

		{#if record}
			<div class="branchbar">
				<span class="branch" title="The branch (line of work) you're on">
					<GitBranch size={14} aria-hidden="true" />
					<span class="visually-hidden">Branch:</span>
					<strong>{record.branch}</strong>
				</span>
				{#if busy === 'checking'}
					<span class="sync muted" role="status">
						<TesseraLoader size={24} label="" /> Checking GitHub…
					</span>
				{:else if git.behind > 0}
					<span class="sync warn" role="status">
						<ArrowDownToLine size={14} aria-hidden="true" />
						{git.behind} newer {git.behind === 1 ? 'version' : 'versions'} on GitHub
					</span>
				{:else if git.remote}
					<span class="sync ok" role="status">
						<Check size={14} aria-hidden="true" /> Up to date · {checkedAgo}
					</span>
				{:else}
					<span class="sync muted" role="status">Not checked yet</span>
				{/if}
				<button
					type="button"
					class="icon small"
					aria-label="Check GitHub for newer versions"
					disabled={!!busy || !reachable}
					onclick={() => void git.check()}
				>
					<RefreshCw size={14} />
				</button>
			</div>
		{/if}

		<div class="body" bind:this={body}>
			{#if !pwa.online}
				<p class="offline" role="status">
					<WifiOff size={16} aria-hidden="true" />
					<span
						>You're offline. Your changes are saved in this browser; saving to and getting the
						latest from GitHub wait until you're back online.</span
					>
				</p>
			{/if}
			{#if notice}
				<p class="notice" role="status">
					<Check size={16} aria-hidden="true" />
					<span>
						{notice.text}
						{#if notice.href}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
							<a href={notice.href} target="_blank" rel="noopener noreferrer"
								>{notice.link ?? 'Open'}
								<ExternalLink size={12} aria-hidden="true" /><span class="visually-hidden"
									>(opens in a new tab)</span
								></a
							>
						{/if}
					</span>
				</p>
			{/if}
			{#if error}
				<div class="alert" role="alert">
					<CircleAlert size={16} aria-hidden="true" />
					<div>
						<p>{error.message}</p>
						{#if error.kind === 'behind'}
							<button type="button" class="small-button" onclick={pull} disabled={working}>
								<ArrowDownToLine size={14} aria-hidden="true" /> Get latest {@render term('pull')}
							</button>
						{:else if error.kind === 'auth' && signedIn && SIGN_IN}
							<button
								type="button"
								class="small-button"
								onclick={() => void signInWithGitHub('source-control')}
							>
								<GitHubMark size={14} /> Sign in again
							</button>
						{:else if error.kind === 'auth'}
							<button type="button" class="small-button" onclick={reconnect}>Connect again</button>
						{:else if (error.kind === 'permission' || error.kind === 'not-found') && installLink}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- GitHub's page; returns to this one -->
							<a class="small-button" href={installLink} onclick={chooseOnGitHub}>
								Choose repositories on GitHub <ExternalLink size={13} aria-hidden="true" />
							</a>
						{/if}
					</div>
				</div>
			{/if}

			{#if missingLogin}
				<section class="card" aria-labelledby="{uid}-connect">
					<h3 id="{uid}-connect">Sign in as @{missingLogin}</h3>
					<p class="muted">
						This project saves to GitHub as <strong>@{missingLogin}</strong>, who isn't signed in
						here. Your changes are safe on this device.
					</p>
					{#if accounts.list.length}
						<div class="use-accounts">
							{#each accounts.list as other (other.user.login)}
								<button
									type="button"
									class="small-button"
									onclick={() => useAccount(other.user.login)}
								>
									{#if other.user.avatarUrl}<img
											src={other.user.avatarUrl}
											alt=""
											width="18"
											height="18"
										/>{/if}
									Use @{other.user.login} instead
								</button>
							{/each}
						</div>
					{/if}
					<ConnectGitHub resume="source-control" another={accounts.connected} />
				</section>
			{:else if !connected}
				<section class="card" aria-labelledby="{uid}-connect">
					<h3 id="{uid}-connect">Connect your GitHub account</h3>
					<ConnectGitHub resume="source-control" />
				</section>
			{/if}

			{#if !record}
				<section class="empty">
					<div class="art" aria-hidden="true">
						<CloudUpload size={30} />
					</div>
					<h3>This project is only in this browser</h3>
					<p>
						Connect it to a GitHub repository to keep every version, share it with your team and
						propose changes for review. You'll see exactly what will be saved before anything is
						sent.
					</p>
					<button
						type="button"
						class="primary"
						disabled={!reachable}
						onclick={() => (linkOpen = true)}
					>
						<GitHubMark size={16} /> Choose a repository…
					</button>
				</section>
			{:else if pending}
				<section class="conflicts" aria-labelledby="{uid}-conflicts">
					<h3 id="{uid}-conflicts">
						<CircleAlert size={18} aria-hidden="true" />
						You and GitHub both changed {pending.conflicts.length}
						{pending.conflicts.length === 1 ? 'file' : 'files'}
					</h3>
					<p class="muted">
						Choose which version to keep for each. Nothing is overwritten until you finish.
						{#if updatedCount}{updatedCount} other {updatedCount === 1 ? 'file' : 'files'} will simply
							be updated from GitHub.{/if}
					</p>
					<ConflictChoices
						conflicts={pending.conflicts}
						bind:choices
						where={{
							take: "Take GitHub's",
							deleted: 'deleted on GitHub',
							theirs: "GitHub's",
							only: 'only on GitHub'
						}}
					/>
					<div class="actions">
						<button type="button" onclick={() => git.cancelPull()} disabled={working}
							>Not now</button
						>
						<button
							type="button"
							class="primary"
							onclick={resolve}
							disabled={!!unresolved || working}
						>
							{#if busy === 'pulling'}<LoaderCircle
									size={16}
									class="spin"
									aria-hidden="true"
								/>{/if}
							Finish getting latest
						</button>
					</div>
					{#if unresolved}<p class="muted small">
							{unresolved} still to choose.
						</p>{/if}
				</section>
			{:else}
				{#if git.behind > 0}
					<section class="banner">
						<div>
							<strong>Newer changes are on GitHub</strong>
							<p>Get them before saving, so nobody's work is lost.</p>
						</div>
						<button type="button" class="primary" onclick={pull} disabled={working || !reachable}>
							{#if busy === 'pulling'}<LoaderCircle
									size={16}
									class="spin"
									aria-hidden="true"
								/>{:else}<ArrowDownToLine size={16} aria-hidden="true" />{/if}
							Get latest
						</button>
					</section>
				{/if}

				<section aria-labelledby="{uid}-changes">
					<div class="section-head">
						<h3 id="{uid}-changes">
							Your changes <span class="count">{changes.length}</span>
						</h3>
						{@render term('not yet on GitHub · working tree')}
					</div>
					{#if !changes.length}
						<p class="muted calm">
							<Check size={16} aria-hidden="true" /> Nothing new since the version on GitHub.
						</p>
					{:else}
						<ChangeSummary
							{engine}
							base={baseTexts}
							current={currentTexts}
							onreview={onreview
								? () => {
										open = false;
										onreview();
									}
								: undefined}
							bind:summary={semantic}
						/>
						<ul class="changes" aria-label="Changed files">
							{#each changes as change (change.path)}
								{@const p = parts(change.path)}
								{@const stats = statsOf(change.before, change.after)}
								{@const isOpen = expanded === change.path}
								<li class:open={isOpen}>
									<div class="row">
										<button
											type="button"
											class="file"
											aria-expanded={isOpen}
											aria-controls="{uid}-diff-{change.path}"
											onclick={() => (expanded = isOpen ? null : change.path)}
										>
											<ChevronRight size={14} class="chev" aria-hidden="true" />
											<span class="status {change.status}" title={STATUS[change.status].word}
												><span aria-hidden="true">{STATUS[change.status].letter}</span><span
													class="visually-hidden">{STATUS[change.status].word}:</span
												></span
											>
											<span class="path"><span class="dir">{p.dir}</span>{p.name}</span>
											<span class="stats" aria-hidden="true">
												{#if stats.added}<span class="plus">+{stats.added}</span>{/if}
												{#if stats.removed}<span class="minus">−{stats.removed}</span>{/if}
											</span>
											<span class="visually-hidden"
												>, {stats.added} lines added, {stats.removed} removed</span
											>
										</button>
										{#if confirmDiscard === change.path}
											<span class="confirm">
												<button type="button" class="danger" onclick={() => discard(change.path)}
													>Discard</button
												>
												<button type="button" onclick={() => (confirmDiscard = null)}>Keep</button>
											</span>
										{:else}
											<button
												type="button"
												class="icon small"
												aria-label="Discard changes to {change.path}"
												title="Discard: put it back as it is on GitHub"
												disabled={working}
												onclick={() => (confirmDiscard = change.path)}
											>
												<Undo2 size={15} />
											</button>
										{/if}
									</div>
									{#if isOpen}
										<div class="diff-wrap" id="{uid}-diff-{change.path}">
											<DiffView
												before={change.before}
												after={change.after}
												oldLabel="GitHub"
												newLabel="Yours"
											/>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<form
					class="card save"
					onsubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<label for="{uid}-message">
						<strong>Describe your changes</strong>
						<small>so your team knows what changed and why</small>
					</label>
					<textarea
						id="{uid}-message"
						bind:value={message}
						rows="2"
						placeholder={suggested
							? suggested.split('\n')[0]
							: changes.length
								? defaultMessage(changes)
								: 'e.g. Add the payload interface'}></textarea>
					{#if suggested && !message.trim()}
						<button type="button" class="link-button" onclick={() => (message = suggested)}>
							Use the change summary as the description
						</button>
					{/if}
					<div class="save-row">
						<button
							type="submit"
							class="primary"
							disabled={!changes.length || working || !reachable}
						>
							{#if busy === 'saving'}<LoaderCircle size={16} class="spin" aria-hidden="true" /> Saving…{:else}<CloudUpload
									size={16}
									aria-hidden="true"
								/> Save to GitHub{/if}
						</button>
						<span class="hint">
							{changes.length}
							{changes.length === 1 ? 'file' : 'files'} to <strong>{record.branch}</strong>
							{@render term('commit & push')}
						</span>
					</div>
					{#if git.behind === 0 && reachable}
						<button type="button" class="link-button" onclick={pull} disabled={working}>
							{#if busy === 'pulling'}<LoaderCircle
									size={14}
									class="spin"
									aria-hidden="true"
								/>{:else}<ArrowDownToLine size={14} aria-hidden="true" />{/if}
							Get latest {@render term('pull')}
							{#if progress?.total}<span class="muted">{progress.done}/{progress.total}</span>{/if}
						</button>
					{/if}
				</form>

				<details class="card fold">
					<summary>
						<GitBranchPlus size={17} aria-hidden="true" />
						<span><strong>Work on a separate branch</strong>{@render term('create branch')}</span>
					</summary>
					<p class="muted">
						A branch is a separate line of work. Changes saved there don't affect <strong
							>{record.defaultBranch}</strong
						> until they are reviewed and merged.
					</p>
					<form class="inline" onsubmit={startBranch}>
						<label for="{uid}-branch-name" class="visually-hidden">New branch name</label>
						<input
							id="{uid}-branch-name"
							bind:value={branchInput}
							placeholder="e.g. add payload interface"
							autocomplete="off"
							aria-describedby="{uid}-branch-hint"
						/>
						<button type="submit" disabled={!newBranch || working || !reachable}>
							{#if busy === 'branching'}<LoaderCircle
									size={14}
									class="spin"
									aria-hidden="true"
								/>{/if}
							Start branch
						</button>
					</form>
					<p class="muted small" id="{uid}-branch-hint">
						{#if newBranch}Will be named <code>{newBranch}</code>, starting from the version you
							have. Your unsaved changes come along.{:else}Starts from the version you have; your
							unsaved changes come along.{/if}
					</p>
				</details>

				<details class="card fold" ontoggle={(e) => e.currentTarget.open && loadBranches()}>
					<summary>
						<GitPullRequest size={17} aria-hidden="true" />
						<span><strong>Propose changes</strong>{@render term('pull request')}</span>
					</summary>
					{#if pr}
						<p class="pr">
							<GitPullRequest size={15} aria-hidden="true" />
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
							<a href={pr.url} target="_blank" rel="noopener noreferrer"
								>#{pr.number}
								{pr.title}
								<ExternalLink size={12} aria-hidden="true" /><span class="visually-hidden"
									>(opens in a new tab)</span
								></a
							>
						</p>
					{/if}
					{#if onDefault}
						<p class="muted">
							Ask your team to review changes before they reach <strong
								>{record.defaultBranch}</strong
							>. Start a separate branch first (above), save your changes there, then propose them
							here.
						</p>
					{:else}
						<p class="muted">
							Ask your team to review the changes on <strong>{record.branch}</strong> and merge them into
							another branch.
						</p>
						{#if changes.length}
							<p class="warn-note">
								<CircleAlert size={14} aria-hidden="true" />
								{changes.length}
								{changes.length === 1 ? 'change isn’t' : 'changes aren’t'} saved to GitHub yet; save them
								first so they're part of the proposal.
							</p>
						{/if}
						<form class="stack" onsubmit={propose}>
							<label>
								<span>Title</span>
								<input
									bind:value={prTitle}
									placeholder={changes.length
										? defaultMessage(changes)
										: `Changes on ${record.branch}`}
								/>
							</label>
							<label>
								<span>What and why <small>(optional)</small></span>
								<textarea bind:value={prBody} rows="3"></textarea>
							</label>
							<button
								type="button"
								class="link-button"
								disabled={summarising || !reachable}
								onclick={describeProposal}
							>
								{#if summarising}<LoaderCircle size={14} class="spin" aria-hidden="true" />{/if}
								Describe it with what changed in the model
							</button>
							<label>
								<span>Merge into</span>
								<select bind:value={prInto}>
									{#if !branches}<option value={record.defaultBranch}>{record.defaultBranch}</option
										>{/if}
									{#each (branches ?? []).filter((b) => b.name !== record.branch) as b (b.name)}
										<option value={b.name}>{b.name}</option>
									{/each}
								</select>
							</label>
							<button type="submit" class="primary" disabled={working || !reachable}>
								{#if busy === 'proposing'}<LoaderCircle
										size={16}
										class="spin"
										aria-hidden="true"
									/>{:else}<GitPullRequest size={16} aria-hidden="true" />{/if}
								Propose changes
							</button>
						</form>
					{/if}
				</details>

				<footer class="foot">
					<span class="muted small">
						Based on version <code title={record.base}>{record.base.slice(0, 7)}</code>
						{@render term('commit')}
					</span>
					<button
						type="button"
						class="link-button"
						onclick={() => void git.unlink()}
						disabled={working}
					>
						Disconnect
					</button>
				</footer>
			{/if}
		</div>
	{/if}
</dialog>

<OpenRepository
	bind:open={linkOpen}
	title="Connect to a GitHub repository"
	action="Connect"
	intro="Pick the repository and branch to save this project to. Nothing is sent yet: you'll review the changes first."
	resume="source-control"
	run={link}
/>

<style>
	.sheet {
		width: min(32rem, 100vw);
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0 0 0 auto;
		padding: 0;
		overflow: hidden;
		border: 0;
		border-left: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.sheet[open] {
		display: flex;
		flex-direction: column;
		animation: slide 220ms var(--ease);
	}
	.sheet::backdrop {
		background: rgb(14 16 20 / 0.35);
		backdrop-filter: blur(3px);
	}
	@keyframes slide {
		from {
			opacity: 0.4;
			transform: translateX(32px);
		}
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-3) var(--space-3) var(--space-5);
		background: var(--surface);
	}
	.mark {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		background: var(--text);
		color: var(--surface);
	}
	.title {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.title h2 {
		overflow: hidden;
		font-size: var(--text-xl);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title a,
	.sub {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon.small {
		width: 2rem;
		height: 2rem;
	}
	.icon:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--text);
	}
	.icon:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.branchbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.branch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 55%;
		height: 1.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.branch strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sync {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.sync.ok {
		color: var(--ok);
	}
	.sync.warn {
		color: var(--warn);
		font-weight: 600;
	}
	.body {
		display: grid;
		flex: 1;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5) var(--space-6);
		overflow: auto;
		overscroll-behavior: contain;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-lg);
	}
	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.small {
		font-size: var(--text-xs);
	}
	.term {
		margin-left: 6px;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
	}
	.card {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.notice,
	.offline,
	.alert {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}
	.notice {
		background: var(--ok-weak);
	}
	.offline {
		background: var(--warn-weak);
	}
	.offline :global(svg:first-child) {
		flex: none;
		color: var(--warn);
	}
	.notice :global(svg:first-child) {
		flex: none;
		color: var(--ok);
	}
	.notice a {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-left: 4px;
		font-weight: 600;
	}
	.alert {
		background: var(--danger-weak);
	}
	.alert > :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--danger);
	}
	.alert div {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-4);
		text-align: center;
	}
	.empty p {
		max-width: 36ch;
		color: var(--text-2);
	}
	.art {
		display: grid;
		place-items: center;
		width: 4rem;
		height: 4rem;
		border-radius: 1.25rem;
		background: linear-gradient(145deg, var(--accent-weak), var(--surface));
		color: var(--accent);
		box-shadow: var(--shadow-md);
	}
	.banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid color-mix(in oklab, var(--warn) 45%, var(--border));
		border-radius: var(--radius-lg);
		background: var(--warn-weak);
	}
	.banner div {
		flex: 1;
	}
	.banner p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-2);
		margin-bottom: var(--space-2);
	}
	.count {
		display: inline-grid;
		place-items: center;
		min-width: 1.5rem;
		height: 1.25rem;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--accent-weak);
		color: var(--accent);
		font-size: var(--text-xs);
	}
	.calm {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}
	.changes {
		display: grid;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		list-style: none;
	}
	.changes li + li {
		border-top: 1px solid var(--border);
	}
	.row {
		display: flex;
		align-items: center;
		padding-right: var(--space-1);
	}
	.file {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 var(--space-2) 0 var(--space-3);
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.file:hover {
		background: var(--surface-hover);
	}
	.file :global(.chev) {
		flex: none;
		color: var(--text-3);
		transition: transform var(--duration) var(--ease);
	}
	.open .file :global(.chev) {
		transform: rotate(90deg);
	}
	.status {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 5px;
		color: #fff;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
	}
	.status.added {
		background: var(--ok);
		color: var(--surface);
	}
	.status.modified {
		background: var(--warn);
		color: var(--surface);
	}
	.status.deleted {
		background: var(--danger);
		color: var(--surface);
	}
	.path {
		flex: 1;
		overflow: hidden;
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dir {
		color: var(--text-3);
		font-weight: 400;
	}
	.stats {
		display: flex;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.plus {
		color: var(--ok);
	}
	.minus {
		color: var(--danger);
	}
	.diff-wrap {
		padding: 0 var(--space-3) var(--space-3);
	}
	.confirm {
		display: inline-flex;
		gap: 4px;
	}
	.confirm button,
	.small-button,
	.inline button,
	.actions button:not(.primary) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	a.small-button {
		color: var(--text);
		text-decoration: none;
	}
	.use-accounts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.use-accounts img {
		border-radius: 50%;
	}
	.danger {
		border-color: transparent !important;
		background: var(--danger) !important;
		color: var(--surface);
	}
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.save label {
		display: grid;
	}
	.save label small,
	label small {
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 400;
	}
	textarea,
	input,
	select {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		resize: vertical;
	}
	input,
	select {
		height: 2.5rem;
		padding-block: 0;
	}
	textarea:focus,
	input:focus,
	select:focus {
		border-color: var(--accent);
		outline: 0;
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	.save-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.hint {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.link-button {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: 6px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.fold {
		gap: 0;
		padding: 0;
	}
	.fold > :not(summary) {
		margin: 0 var(--space-4) var(--space-3);
	}
	.fold > :last-child {
		margin-bottom: var(--space-4);
	}
	summary {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 3rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-lg);
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary::after {
		content: '';
		width: 0.5rem;
		height: 0.5rem;
		margin-left: auto;
		border-right: 2px solid var(--text-3);
		border-bottom: 2px solid var(--text-3);
		transform: rotate(-45deg);
		transition: transform var(--duration) var(--ease);
	}
	details[open] > summary::after {
		transform: rotate(45deg);
	}
	summary :global(svg) {
		flex: none;
		color: var(--accent);
	}
	.inline {
		display: flex;
		gap: var(--space-2);
	}
	.inline button {
		min-height: 2.5rem;
		white-space: nowrap;
	}
	.stack {
		display: grid;
		gap: var(--space-3);
	}
	.stack label {
		display: grid;
		gap: 4px;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.stack .primary {
		justify-self: start;
	}
	.pr {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--accent-weak);
		font-size: var(--text-sm);
	}
	.pr a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: 600;
	}
	.warn-note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		font-size: var(--text-sm);
	}
	code {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--surface-2);
	}
	.conflicts {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid color-mix(in oklab, var(--warn) 50%, var(--border));
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--warn-weak) 60%, var(--surface));
	}
	.conflicts h3 :global(svg) {
		color: var(--warn);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-top: var(--space-2);
	}
	.foot .link-button {
		color: var(--text-2);
		font-weight: 400;
	}
	.sheet :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 760px) {
		.sheet {
			width: 100vw;
			border: 0;
		}
		.head {
			padding-top: max(var(--space-3), env(safe-area-inset-top));
		}
		.body {
			padding: var(--space-4) var(--space-4) max(var(--space-6), env(safe-area-inset-bottom));
		}
		.sheet[open] {
			animation-name: rise;
		}
		@keyframes rise {
			from {
				opacity: 0.4;
				transform: translateY(24px);
			}
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet[open] {
			animation: none;
		}
	}
</style>
