/**
 * GitHub through its REST API, straight from the browser (the API allows
 * cross-origin requests, so no proxy is needed). Authenticated with a
 * fine-grained personal access token, or with the token from "Sign in with
 * GitHub" (a GitHub App user token, which can be refreshed).
 */
import { GitError, errorFor, networkError, type Access } from './errors.ts';
import type {
	BranchSummary,
	CommitRequest,
	CommitResult,
	CommitSummary,
	Comparison,
	FileChange,
	GitProvider,
	GitUser,
	Head,
	Progress,
	PullRequest,
	PullRequestInput,
	PullRequestSummary,
	RemoteTree,
	RepoRef,
	RepoSummary,
	TreeEntry
} from './types.ts';

/** github.com's API. */
export const GITHUB_API = 'https://api.github.com';
const HOST = 'GitHub';

/**
 * The API address for a GitHub server: github.com's for none (or
 * github.com), else a GitHub Enterprise Server's (`https://github.example.com`
 * → `https://github.example.com/api/v3`). Throws, in plain words, for what
 * isn't an https address.
 */
export function githubApi(server?: string | null): string {
	const text = server?.trim();
	if (!text) return GITHUB_API;
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
	} catch {
		throw new Error(`“${text}” isn’t a web address.`);
	}
	if (url.protocol !== 'https:')
		throw new Error('The GitHub server’s address must start with https://.');
	if (url.host === 'github.com' || url.host === 'www.github.com' || url.host === 'api.github.com')
		return GITHUB_API;
	const path = url.pathname.replace(/\/+$/, '');
	return `${url.origin}${path.endsWith('/api/v3') ? path : `${path}/api/v3`}`;
}

/** The web address for a GitHub API address: `https://github.com`, or the Enterprise server's. */
export function githubWeb(api: string = GITHUB_API): string {
	if (api === GITHUB_API) return 'https://github.com';
	return api.replace(/\/api\/v3$/, '');
}
/** Parallel blob downloads: quick without tripping GitHub's abuse limits. */
const PARALLEL = 6;
const MAX_REPO_PAGES = 5;
const MAX_INSTALLATIONS = 20;

/** Where the provider gets its token. */
export interface TokenSource {
	/** The token to send (refreshed first if it is about to expire). */
	token(): string | Promise<string>;
	/** GitHub refused `rejected` (401): a fresh token to retry with once, or null. */
	renew?(rejected: string): Promise<string | null>;
	/** How the account connected; decides how errors are worded and how repositories are listed. */
	access?: Access;
}

/**
 * Where to create a fine-grained token with the right permissions filled
 * in. The person still picks which repositories it covers.
 */
export function tokenUrl(api: string = GITHUB_API): string {
	const params = new URLSearchParams({
		name: 'Tessera',
		description: 'Open and save SysML models from Tessera.',
		expires_in: '90',
		contents: 'write',
		pull_requests: 'write',
		metadata: 'read'
	});
	// GitHub Enterprise Server has classic tokens only on some versions; its token page is the same path.
	return `${githubWeb(api)}/settings/personal-access-tokens/new?${params}`;
}

/** `owner/repo` from a GitHub URL, an SSH remote or `owner/repo`; the branch too if the URL has one. */
export function parseRepoUrl(
	input: string,
	api: string = GITHUB_API
): (RepoRef & { branch?: string }) | null {
	const text = input.trim();
	const host = (api === GITHUB_API ? 'github.com' : new URL(githubWeb(api)).host).replace(
		/[.]/g,
		'\\.'
	);
	const ssh = new RegExp(`^git@${host}:([\\w.-]+)\\/([\\w.-]+?)(?:\\.git)?$`).exec(text);
	if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
	const web = new RegExp(
		`^(?:https?:\\/\\/)?(?:www\\.)?${host}\\/([\\w.-]+)\\/([\\w.-]+?)(?:\\.git)?(?:\\/tree\\/([^?#]+))?\\/?(?:[?#].*)?$`
	).exec(text);
	if (web)
		return {
			owner: web[1]!,
			repo: web[2]!,
			...(web[3] ? { branch: decodeURIComponent(web[3]) } : {})
		};
	const short = /^([\w.-]+)\/([\w.-]+)$/.exec(text);
	if (short) return { owner: short[1]!, repo: short[2]! };
	return null;
}

/** The tree for a commit: changed files point at their new blobs, deleted ones at nothing. */
export function treePayload(
	baseTree: string,
	changes: FileChange[],
	blobs: Record<string, string>
): {
	base_tree: string;
	tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[];
} {
	return {
		base_tree: baseTree,
		tree: changes.map((c) => ({
			path: c.path,
			mode: '100644',
			type: 'blob',
			sha: c.text === null ? null : blobs[c.path]!
		}))
	};
}

/** UTF-8 text from base64, as the blobs API returns it. */
export function decodeBase64(data: string): string {
	const binary = atob(data.replace(/\s/g, ''));
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

const path = (ref: RepoRef) =>
	`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
/** A branch name in a URL path: segments encoded, slashes kept. */
const branchPath = (name: string) => name.split('/').map(encodeURIComponent).join('/');

interface GitHubRepo {
	name: string;
	full_name: string;
	owner: { login: string };
	private: boolean;
	default_branch: string;
	description: string | null;
	pushed_at: string | null;
	html_url: string;
	permissions?: { push?: boolean; admin?: boolean };
}

function summary(r: GitHubRepo): RepoSummary {
	return {
		owner: r.owner.login,
		repo: r.name,
		fullName: r.full_name,
		private: r.private,
		defaultBranch: r.default_branch,
		description: r.description,
		pushedAt: r.pushed_at,
		canPush: !!(r.permissions?.push || r.permissions?.admin),
		htmlUrl: r.html_url
	};
}

export class GitHubProvider implements GitProvider {
	readonly id = 'github' as const;
	readonly label = HOST;
	readonly access: Access;
	private fetch: typeof fetch;
	private api: string;
	private auth: TokenSource;

	constructor(auth: string | TokenSource, options: { fetch?: typeof fetch; api?: string } = {}) {
		this.auth = typeof auth === 'string' ? { token: () => auth } : auth;
		this.access = this.auth.access ?? 'token';
		this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
		this.api = options.api ?? GITHUB_API;
	}

	/** The server's web address (`https://github.com`, or a GitHub Enterprise Server's). */
	get web(): string {
		return githubWeb(this.api);
	}

	private async send(method: string, url: string, body: unknown, token: string) {
		const target = url.startsWith('http') ? url : this.api + url;
		// The token is for this server only, whatever address an answer links to.
		if (new URL(target).origin !== new URL(this.api).origin)
			throw new GitError(
				'invalid',
				`${HOST} pointed to another site (${new URL(target).host}); it was not followed.`
			);
		try {
			return await this.fetch(target, {
				method,
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28',
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				cache: 'no-store'
			});
		} catch (error) {
			throw networkError(HOST, error);
		}
	}

	private async request<T>(method: string, url: string, body?: unknown, what?: string): Promise<T> {
		const token = await this.auth.token();
		let response = await this.send(method, url, body, token);
		// An expired sign-in: refresh it and try once more.
		if (response.status === 401 && this.auth.renew) {
			const fresh = await this.auth.renew(token);
			if (fresh && fresh !== token) response = await this.send(method, url, body, fresh);
		}
		if (!response.ok) {
			let detail = '';
			try {
				const json = (await response.json()) as {
					message?: string;
					errors?: { message?: string }[];
				};
				detail = [json.message, ...(json.errors ?? []).map((e) => e.message)]
					.filter(Boolean)
					.join(': ');
			} catch {
				// No JSON body.
			}
			throw errorFor(response, detail, HOST, what, this.access);
		}
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}

	async currentUser(): Promise<GitUser> {
		const user = await this.request<{ login: string; name: string | null; avatar_url: string }>(
			'GET',
			'/user',
			undefined,
			'sign in'
		);
		return { login: user.login, name: user.name, avatarUrl: user.avatar_url };
	}

	async listRepos(): Promise<RepoSummary[]> {
		if (this.access === 'app') return this.listInstalledRepos();
		const out: RepoSummary[] = [];
		for (let page = 1; page <= MAX_REPO_PAGES; page++) {
			const repos = await this.request<GitHubRepo[]>(
				'GET',
				`/user/repos?per_page=100&sort=pushed&page=${page}`,
				undefined,
				'your repositories'
			);
			out.push(...repos.map(summary));
			if (repos.length < 100) break;
		}
		return out;
	}

	/**
	 * A signed-in (GitHub App) account sees the repositories the app was given:
	 * those of every installation the person can use.
	 */
	private async listInstalledRepos(): Promise<RepoSummary[]> {
		const installations: number[] = [];
		for (let page = 1; page <= MAX_REPO_PAGES; page++) {
			const result = await this.request<{ installations: { id: number }[] }>(
				'GET',
				`/user/installations?per_page=100&page=${page}`,
				undefined,
				'your repositories'
			);
			installations.push(...result.installations.map((i) => i.id));
			if (result.installations.length < 100) break;
		}
		const byName = new Map<string, RepoSummary>();
		for (const id of installations.slice(0, MAX_INSTALLATIONS)) {
			for (let page = 1; page <= MAX_REPO_PAGES; page++) {
				const result = await this.request<{ repositories: GitHubRepo[] }>(
					'GET',
					`/user/installations/${id}/repositories?per_page=100&page=${page}`,
					undefined,
					'your repositories'
				);
				for (const repo of result.repositories) byName.set(repo.full_name, summary(repo));
				if (result.repositories.length < 100) break;
			}
		}
		return [...byName.values()].sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
	}

	async getRepo(ref: RepoRef): Promise<RepoSummary> {
		return summary(
			await this.request<GitHubRepo>(
				'GET',
				path(ref),
				undefined,
				`the repository ${ref.owner}/${ref.repo}`
			)
		);
	}

	async listBranches(ref: RepoRef): Promise<BranchSummary[]> {
		const branches = await this.request<
			{ name: string; commit: { sha: string }; protected?: boolean }[]
		>('GET', `${path(ref)}/branches?per_page=100`, undefined, 'the branches');
		return branches.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
	}

	async head(ref: RepoRef, branch: string): Promise<Head> {
		const b = await this.request<{
			commit: { sha: string; commit: { tree: { sha: string } } };
		}>('GET', `${path(ref)}/branches/${branchPath(branch)}`, undefined, `the branch “${branch}”`);
		return { commit: b.commit.sha, tree: b.commit.commit.tree.sha };
	}

	async readTree(ref: RepoRef, commit: string): Promise<RemoteTree> {
		const c = await this.request<{ tree: { sha: string } }>(
			'GET',
			`${path(ref)}/git/commits/${commit}`,
			undefined,
			'that version'
		);
		const tree = await this.request<{
			sha: string;
			truncated: boolean;
			tree: { path: string; type: string; sha: string; size?: number }[];
		}>('GET', `${path(ref)}/git/trees/${c.tree.sha}?recursive=1`, undefined, 'the files');
		return {
			commit,
			tree: tree.sha,
			truncated: tree.truncated,
			entries: tree.tree
				.filter((e) => e.type === 'blob')
				.map((e) => ({ path: e.path, sha: e.sha, size: e.size }))
		};
	}

	async readFiles(
		ref: RepoRef,
		entries: TreeEntry[],
		progress?: Progress
	): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		let done = 0;
		let next = 0;
		progress?.(0, entries.length);
		const worker = async () => {
			while (next < entries.length) {
				const entry = entries[next++]!;
				const blob = await this.request<{ content: string; encoding: string }>(
					'GET',
					`${path(ref)}/git/blobs/${entry.sha}`,
					undefined,
					entry.path
				);
				out[entry.path] =
					blob.encoding === 'base64' ? decodeBase64(blob.content) : String(blob.content);
				progress?.(++done, entries.length);
			}
		};
		await Promise.all(Array.from({ length: Math.min(PARALLEL, entries.length) }, worker));
		return out;
	}

	/** Blobs → tree → commit → move the branch (refused unless it is a fast-forward). */
	async commit(ref: RepoRef, request: CommitRequest): Promise<CommitResult> {
		if (!request.changes.length) throw new GitError('invalid', 'There are no changes to save.');
		const head = await this.head(ref, request.branch);
		if (head.commit !== request.parent)
			throw new GitError(
				'behind',
				`Someone saved newer changes to “${request.branch}” on ${HOST}. Get the latest first, then save again.`,
				409
			);
		const blobs: Record<string, string> = {};
		for (const change of request.changes) {
			if (change.text === null) continue;
			const blob = await this.request<{ sha: string }>(
				'POST',
				`${path(ref)}/git/blobs`,
				{ content: change.text, encoding: 'utf-8' },
				`saving ${change.path}`
			);
			blobs[change.path] = blob.sha;
		}
		const tree = await this.request<{ sha: string }>(
			'POST',
			`${path(ref)}/git/trees`,
			treePayload(request.baseTree, request.changes, blobs),
			'saving the files'
		);
		const commit = await this.request<{ sha: string; html_url?: string }>(
			'POST',
			`${path(ref)}/git/commits`,
			{ message: request.message, tree: tree.sha, parents: [request.parent] },
			'saving the version'
		);
		await this.request(
			'PATCH',
			`${path(ref)}/git/refs/heads/${branchPath(request.branch)}`,
			{ sha: commit.sha, force: false },
			`updating “${request.branch}”`
		);
		return { commit: commit.sha, tree: tree.sha, blobs, url: commit.html_url };
	}

	async createBranch(ref: RepoRef, name: string, from: string): Promise<BranchSummary> {
		await this.request(
			'POST',
			`${path(ref)}/git/refs`,
			{ ref: `refs/heads/${name}`, sha: from },
			`a branch named “${name}”`
		);
		return { name, sha: from };
	}

	async openPullRequest(ref: RepoRef, input: PullRequestInput): Promise<PullRequest> {
		const pr = await this.request<{ number: number; html_url: string; title: string }>(
			'POST',
			`${path(ref)}/pulls`,
			{
				title: input.title,
				body: input.body,
				head: input.head,
				base: input.base,
				draft: input.draft ?? false
			},
			'opening a proposal'
		);
		return { number: pr.number, url: pr.html_url, title: pr.title };
	}

	async compare(ref: RepoRef, base: string, head: string): Promise<Comparison> {
		const c = await this.request<{
			ahead_by: number;
			behind_by: number;
			status: Comparison['status'];
		}>(
			'GET',
			`${path(ref)}/compare/${branchPath(base)}...${branchPath(head)}?per_page=1`,
			undefined,
			'the latest changes'
		);
		return { ahead: c.ahead_by, behind: c.behind_by, status: c.status };
	}

	async mergeBase(ref: RepoRef, base: string, head: string): Promise<string> {
		const c = await this.request<{ merge_base_commit: { sha: string } }>(
			'GET',
			`${path(ref)}/compare/${branchPath(base)}...${branchPath(head)}?per_page=1`,
			undefined,
			'where the branches part'
		);
		return c.merge_base_commit.sha;
	}

	async listPullRequests(ref: RepoRef): Promise<PullRequestSummary[]> {
		const prs = await this.request<
			{
				number: number;
				html_url: string;
				title: string;
				user: { login: string } | null;
				head: { ref: string; sha: string };
				base: { ref: string; sha: string };
				updated_at: string | null;
			}[]
		>(
			'GET',
			`${path(ref)}/pulls?state=open&sort=updated&direction=desc&per_page=30`,
			undefined,
			'the proposals'
		);
		return prs.map((p) => ({
			number: p.number,
			url: p.html_url,
			title: p.title,
			author: p.user?.login ?? null,
			head: { ref: p.head.ref, sha: p.head.sha },
			base: { ref: p.base.ref, sha: p.base.sha },
			updatedAt: p.updated_at
		}));
	}

	async listCommits(ref: RepoRef, branch: string, count = 20): Promise<CommitSummary[]> {
		const commits = await this.request<
			{
				sha: string;
				commit: { message: string; author: { name?: string; date?: string } | null };
				author: { login: string } | null;
			}[]
		>(
			'GET',
			`${path(ref)}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`,
			undefined,
			'the versions'
		);
		return commits.map((c) => ({
			sha: c.sha,
			title: c.commit.message.split('\n')[0] ?? '',
			author: c.author?.login ?? c.commit.author?.name ?? null,
			date: c.commit.author?.date ?? null
		}));
	}

	webUrl(ref: RepoRef, branch?: string): string {
		const base = `${this.web}/${ref.owner}/${ref.repo}`;
		return branch ? `${base}/tree/${branchPath(branch)}` : base;
	}
}
