/**
 * Git hosting, as the app sees it. Every host (GitHub today; GitLab or an
 * OAuth-backed GitHub later) implements `GitProvider`, so the rest of the
 * app never speaks a host's API directly.
 *
 * The model is deliberately simple: a project remembers the commit its files
 * came from (the *base*). Changes are the difference between the files now
 * and the base; saving makes one commit on top of the base and moves the
 * branch to it. There is no local history, staging area or index.
 */

export type ProviderId = 'github';

export interface GitUser {
	login: string;
	name?: string | null;
	avatarUrl?: string;
}

/** A repository, as `owner/name`. */
export interface RepoRef {
	owner: string;
	repo: string;
}

export interface RepoSummary extends RepoRef {
	fullName: string;
	private: boolean;
	defaultBranch: string;
	description?: string | null;
	pushedAt?: string | null;
	/** Whether the signed-in account may push to it. */
	canPush: boolean;
	htmlUrl: string;
}

export interface BranchSummary {
	name: string;
	/** The commit the branch points at. */
	sha: string;
	protected?: boolean;
}

/** A branch head: its commit and that commit's root tree. */
export interface Head {
	commit: string;
	tree: string;
}

/** A file (blob) in a tree. */
export interface TreeEntry {
	path: string;
	sha: string;
	size?: number;
}

export interface RemoteTree extends Head {
	entries: TreeEntry[];
	/** The host cut the listing short (very large repositories). */
	truncated: boolean;
}

/** A file to write (`text`) or delete (`text: null`) in a commit. */
export interface FileChange {
	path: string;
	text: string | null;
}

export interface CommitRequest {
	branch: string;
	/** The commit the changes were made on; the branch must still point at it. */
	parent: string;
	/** `parent`'s root tree. */
	baseTree: string;
	message: string;
	changes: FileChange[];
}

export interface CommitResult extends Head {
	/** Blob SHA of every written file. */
	blobs: Record<string, string>;
	url?: string;
}

/** How `head` relates to `base`. */
export interface Comparison {
	/** Commits in `head` that `base` doesn't have. */
	ahead: number;
	/** Commits in `base` that `head` doesn't have. */
	behind: number;
	status: 'identical' | 'ahead' | 'behind' | 'diverged';
}

export interface PullRequestInput {
	title: string;
	body: string;
	/** The branch with the changes. */
	head: string;
	/** The branch to merge them into. */
	base: string;
	draft?: boolean;
}

export interface PullRequest {
	number: number;
	url: string;
	title: string;
}

/** An open pull request, to review. */
export interface PullRequestSummary extends PullRequest {
	author: string | null;
	/** The branch with the changes, and its latest commit. */
	head: { ref: string; sha: string };
	/** The branch they would be merged into, and its latest commit. */
	base: { ref: string; sha: string };
	updatedAt: string | null;
}

/** A commit in a branch's history. */
export interface CommitSummary {
	sha: string;
	/** The first line of its message. */
	title: string;
	author: string | null;
	date: string | null;
}

/** A repository branch chosen to open or connect. */
export interface RepoChoice {
	ref: RepoRef;
	branch: string;
	defaultBranch: string;
}

export type Progress = (done: number, total: number) => void;

export interface GitProvider {
	readonly id: ProviderId;
	/** The host's name, for people: "GitHub". */
	readonly label: string;
	/** The signed-in account; validates the credentials. */
	currentUser(): Promise<GitUser>;
	/** Repositories the account can see, most recently pushed first. */
	listRepos(): Promise<RepoSummary[]>;
	getRepo(ref: RepoRef): Promise<RepoSummary>;
	listBranches(ref: RepoRef): Promise<BranchSummary[]>;
	head(ref: RepoRef, branch: string): Promise<Head>;
	/** Every file in a commit's tree. */
	readTree(ref: RepoRef, commit: string): Promise<RemoteTree>;
	/** File texts by path. */
	readFiles(
		ref: RepoRef,
		entries: TreeEntry[],
		progress?: Progress
	): Promise<Record<string, string>>;
	/** One commit on `request.branch`, refused if the branch moved since `parent`. */
	commit(ref: RepoRef, request: CommitRequest): Promise<CommitResult>;
	createBranch(ref: RepoRef, name: string, from: string): Promise<BranchSummary>;
	openPullRequest(ref: RepoRef, input: PullRequestInput): Promise<PullRequest>;
	compare(ref: RepoRef, base: string, head: string): Promise<Comparison>;
	/** The latest commit both have (where `head` branched off `base`). */
	mergeBase(ref: RepoRef, base: string, head: string): Promise<string>;
	/** Open pull requests, most recently updated first. */
	listPullRequests(ref: RepoRef): Promise<PullRequestSummary[]>;
	/** A branch's latest commits, newest first. */
	listCommits(ref: RepoRef, branch: string, count?: number): Promise<CommitSummary[]>;
	/** The repository's page, or a branch's, on the host. */
	webUrl(ref: RepoRef, branch?: string): string;
}

/** What a project opened from a repository remembers about it. */
export interface GitRecord {
	provider: ProviderId;
	owner: string;
	repo: string;
	branch: string;
	defaultBranch: string;
	/** The commit the project's files are based on. */
	base: string;
	/** `base`'s root tree. */
	baseTree: string;
	/** Project files at `base`: blob SHA and text (for changes, diffs and Discard). */
	files: Record<string, { sha: string; text: string }>;
	/** When the files were last brought up to date with the branch. */
	syncedAt: string;
	/** The latest proposal (pull request) opened from here. */
	pullRequest?: PullRequest & { branch: string };
}
