/**
 * The open project's link to its repository: what changed here, what
 * changed there, and the actions — save (commit & push), get latest (pull),
 * new branch and propose changes (pull request).
 */
import type { Engine } from '#lib/engine/client.ts';
import type { ProjectSession } from '#lib/project/session.svelte.ts';
import { timestamp } from '#lib/project/store.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { accounts, type AccountInfo } from './account.svelte.ts';
import { GitError } from './errors.ts';
import { readRepository } from './open.ts';
import {
	applyPull,
	baseAfterCommit,
	fileChanges,
	localChanges,
	planPull,
	remoteChanged,
	trackedEntries,
	type LocalChange,
	type PullPlan,
	type Resolution
} from './sync.ts';
import type { GitProvider, GitRecord, Head, Progress, PullRequest, RepoRef } from './types.ts';

export type GitBusy = 'checking' | 'saving' | 'pulling' | 'branching' | 'proposing' | 'linking';

export interface RemoteStatus {
	/** The branch's latest commit on the host. */
	head: string;
	/** Commits there that this project doesn't have yet. */
	behind: number;
	checkedAt: number;
}

export type PullOutcome = 'up-to-date' | 'updated' | 'conflicts';

export class GitConnection {
	busy = $state<GitBusy | null>(null);
	remote = $state.raw<RemoteStatus | null>(null);
	/** A pull waiting for the person to decide about conflicting files. */
	pending = $state.raw<(PullPlan & { head: Head }) | null>(null);

	constructor(
		private session: ProjectSession,
		private workspace: Workspace
	) {}

	get record(): GitRecord | null {
		return this.session.record?.git ?? null;
	}

	get ref(): RepoRef | null {
		const git = this.record;
		return git ? { owner: git.owner, repo: git.repo } : null;
	}

	/**
	 * The login of the GitHub account this project uses: the one that opened
	 * it, else (projects opened before several accounts could be kept, or not
	 * connected yet) the default account.
	 */
	get login(): string | null {
		return this.record?.account ?? accounts.github?.user.login ?? null;
	}

	/** The account this project uses, when it is signed in here. */
	get account(): AccountInfo | null {
		return accounts.accountFor(this.record?.account);
	}

	/** The GitHub API as this project's account. */
	provider(): GitProvider {
		return accounts.provider(this.record?.account);
	}

	/** Remember `login` as this project's account if it doesn't say yet (another account is being added). */
	async claim(login: string) {
		const git = this.record;
		if (git && !git.account) await this.setGit({ ...git, account: login });
	}

	/** Use another of the connected accounts for this project from now on. */
	async useAccount(login: string) {
		const git = this.record;
		const account = accounts.find(login);
		if (!git || !account) return;
		await this.setGit({ ...git, account: account.user.login });
		this.remote = null;
	}

	/** Changes since the base, in this browser. */
	changes: LocalChange[] = $derived.by(() => {
		const git = this.session.record?.git;
		return git ? localChanges(git.files, this.workspace.files) : [];
	});

	/** The branch moved on the host since the base. */
	get behind(): number {
		const git = this.record;
		return git && this.remote && this.remote.head !== git.base ? this.remote.behind : 0;
	}

	private require(): { git: GitRecord; ref: RepoRef } {
		const git = this.record;
		if (!git) throw new GitError('invalid', 'This project isn’t connected to a repository.');
		return { git, ref: { owner: git.owner, repo: git.repo } };
	}

	private async run<T>(busy: GitBusy, action: () => Promise<T>): Promise<T> {
		if (this.busy && this.busy !== 'checking')
			throw new GitError('invalid', 'One moment: still working.');
		this.busy = busy;
		try {
			return await action();
		} finally {
			this.busy = null;
		}
	}

	private async setGit(git: GitRecord, origin?: 'git') {
		const record = this.session.record;
		if (!record) return;
		this.session.record = { ...record, git, ...(origin ? { origin } : {}) };
		await this.session.save();
	}

	/** Ask the host whether the branch has moved. Quiet: failures leave the status unknown. */
	async check(): Promise<RemoteStatus | null> {
		if (!this.record || !this.account || this.busy) return this.remote;
		this.busy = 'checking';
		try {
			const { git, ref } = this.require();
			const provider = this.provider();
			const head = await provider.head(ref, git.branch);
			const behind =
				head.commit === git.base
					? 0
					: Math.max(1, (await provider.compare(ref, git.base, head.commit)).ahead);
			this.remote = { head: head.commit, behind, checkedAt: Date.now() };
			return this.remote;
		} catch {
			return null;
		} finally {
			this.busy = null;
		}
	}

	/** Commit every change and move the branch to it ("Save to GitHub"). */
	save(message: string): Promise<{ commit: string; url?: string }> {
		return this.run('saving', async () => {
			const { git, ref } = this.require();
			const changes = fileChanges(this.changes);
			if (!changes.length) throw new GitError('invalid', 'There are no changes to save.');
			const result = await this.provider().commit(ref, {
				branch: git.branch,
				parent: git.base,
				baseTree: git.baseTree,
				message: message.trim() || defaultMessage(this.changes),
				changes
			});
			await this.setGit({
				...git,
				base: result.commit,
				baseTree: result.tree,
				files: baseAfterCommit(git.files, changes, result.blobs),
				syncedAt: timestamp()
			});
			for (const change of changes) this.workspace.dirty.delete(change.path);
			this.remote = { head: result.commit, behind: 0, checkedAt: Date.now() };
			return { commit: result.commit, url: result.url };
		});
	}

	/**
	 * Bring in the branch's latest version ("Get latest"). Files changed only
	 * there are updated; files changed on both sides wait in `pending` for
	 * the person to choose, and nothing is overwritten meanwhile.
	 */
	pull(engine: Engine, progress?: Progress): Promise<PullOutcome> {
		return this.run('pulling', async () => {
			const { git, ref } = this.require();
			const provider = this.provider();
			const head = await provider.head(ref, git.branch);
			if (head.commit === git.base) {
				this.remote = { head: head.commit, behind: 0, checkedAt: Date.now() };
				return 'up-to-date';
			}
			const tree = await provider.readTree(ref, head.commit);
			const remote = trackedEntries(tree.entries);
			const changed = remoteChanged(git.files, remote);
			const texts = await provider.readFiles(
				ref,
				changed.map((path) => ({ path, sha: remote[path]! })),
				progress
			);
			const plan = { ...planPull(git.files, this.workspace.files, remote, texts), head };
			if (plan.conflicts.length) {
				this.pending = plan;
				return 'conflicts';
			}
			await this.finish(plan, {}, engine);
			return 'updated';
		});
	}

	/** Finish a pull that had conflicts, with the person's choice for each file. */
	resolve(choices: Record<string, Resolution>, engine: Engine): Promise<void> {
		return this.run('pulling', async () => {
			const plan = this.pending;
			if (!plan) return;
			await this.finish(plan, choices, engine);
			this.pending = null;
		});
	}

	cancelPull() {
		this.pending = null;
	}

	private async finish(
		plan: PullPlan & { head: Head },
		choices: Record<string, Resolution>,
		engine: Engine
	) {
		const { git } = this.require();
		const files = applyPull(this.workspace.files, plan, choices);
		await this.replaceFiles(files, engine);
		await this.setGit({
			...git,
			base: plan.head.commit,
			baseTree: plan.head.tree,
			files: plan.base,
			syncedAt: timestamp()
		});
		this.remote = { head: plan.head.commit, behind: 0, checkedAt: Date.now() };
	}

	/** Put a file back as it is in the base version. */
	async discard(path: string, engine: Engine) {
		const { git } = this.require();
		const files = { ...this.workspace.files };
		const was = git.files[path];
		if (was) files[path] = was.text;
		else delete files[path];
		await this.replaceFiles(files, engine);
		this.workspace.dirty.delete(path);
		await this.session.save();
	}

	/** Start a new branch from the base version and switch to it; changes stay here, unsaved. */
	createBranch(name: string): Promise<void> {
		return this.run('branching', async () => {
			const { git, ref } = this.require();
			await this.provider().createBranch(ref, name, git.base);
			await this.setGit({ ...git, branch: name });
			this.remote = { head: git.base, behind: 0, checkedAt: Date.now() };
		});
	}

	/** Open a pull request from the current branch ("Propose changes"). */
	propose(title: string, body: string, into: string): Promise<PullRequest> {
		return this.run('proposing', async () => {
			const { git, ref } = this.require();
			if (into === git.branch)
				throw new GitError(
					'invalid',
					'Changes are proposed from one branch into another. Start a new branch first.'
				);
			const pr = await this.provider().openPullRequest(ref, {
				title,
				body,
				head: git.branch,
				base: into
			});
			await this.setGit({ ...git, pullRequest: { ...pr, branch: git.branch } });
			return pr;
		});
	}

	/**
	 * Connect a project kept in this browser to a repository branch. The
	 * branch's files become the base, so the project's files show as changes
	 * against it, ready to review and save.
	 */
	link(
		ref: RepoRef,
		branch: string,
		defaultBranch: string,
		progress?: Progress,
		account?: string
	): Promise<void> {
		return this.run('linking', async () => {
			const opened = await readRepository(
				accounts.provider(account),
				ref,
				branch,
				defaultBranch,
				progress
			);
			const login = account ?? accounts.github?.user.login;
			await this.setGit({ ...opened.git, ...(login ? { account: login } : {}) });
			this.remote = { head: opened.git.base, behind: 0, checkedAt: Date.now() };
		});
	}

	/** Disconnect from the repository; the files stay in this browser. */
	async unlink() {
		const record = this.session.record;
		if (!record) return;
		const next = {
			...record,
			origin: record.origin === 'git' ? ('archive' as const) : record.origin
		};
		delete next.git;
		this.session.record = next;
		this.remote = null;
		this.pending = null;
		await this.session.save();
	}

	/** Update the workspace to exactly these files (re-reading the model when files come or go). */
	private async replaceFiles(files: Record<string, string>, engine: Engine) {
		const current = this.workspace.files;
		const sameSet =
			Object.keys(files).length === Object.keys(current).length &&
			Object.keys(files).every((p) => p in current);
		if (sameSet) {
			for (const [path, text] of Object.entries(files))
				if (current[path] !== text) this.workspace.setText(path, text);
			return;
		}
		const record = this.session.record;
		await this.workspace.open(
			{
				id: record?.id ?? '',
				info: this.workspace.info ?? record?.info ?? { name: 'Project' },
				files: Object.entries(files).map(([path, text]) => ({ path, text }))
			},
			engine
		);
	}
}

/** A message when the person didn't write one: what changed, briefly. */
export function defaultMessage(changes: LocalChange[]): string {
	const name = (path: string) => path.split('/').pop() ?? path;
	if (changes.length === 1) {
		const c = changes[0]!;
		const verb = c.status === 'added' ? 'Add' : c.status === 'deleted' ? 'Delete' : 'Update';
		return `${verb} ${name(c.path)}`;
	}
	const shown = changes.slice(0, 3).map((c) => name(c.path));
	return `Update ${shown.join(', ')}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}`;
}
