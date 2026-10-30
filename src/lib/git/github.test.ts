import { describe, expect, it, vi } from 'vitest';
import { GitError } from './errors.ts';
import {
	GITHUB_API,
	GitHubProvider,
	githubApi,
	githubWeb,
	parseRepoUrl,
	tokenUrl,
	treePayload
} from './github.ts';

interface Call {
	method: string;
	url: string;
	body?: unknown;
	auth?: string;
}

/** A fetch that answers from a route table and records every call. */
function mockFetch(
	routes: Record<
		string,
		(call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }
	>
) {
	const calls: Call[] = [];
	const mock = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input).replace('https://api.github.com', '');
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		const call: Call = {
			method,
			url,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			auth: headers.get('authorization') ?? undefined
		};
		calls.push(call);
		const key = Object.keys(routes).find((k) => {
			const [m, pattern] = k.split(' ');
			return m === method && new RegExp(`^${pattern}$`).test(url);
		});
		const result = key ? routes[key]!(call) : { status: 404, body: { message: 'Not Found' } };
		// A 204 has no body.
		return new Response(result.status === 204 ? null : JSON.stringify(result.body ?? {}), {
			status: result.status ?? 200,
			headers: { 'content-type': 'application/json', ...result.headers }
		});
	}) as typeof fetch;
	return { fetch: mock, calls };
}

const ref = { owner: 'acme', repo: 'drone' };
const branch = (sha: string) => () => ({
	body: { name: 'main', commit: { sha, commit: { tree: { sha: `tree-of-${sha}` } } } }
});

describe('GitHub URLs and payloads', () => {
	it('reads repository URLs in the usual forms', () => {
		expect(parseRepoUrl('https://github.com/acme/drone')).toEqual(ref);
		expect(parseRepoUrl('github.com/acme/drone.git')).toEqual(ref);
		expect(parseRepoUrl('git@github.com:acme/drone.git')).toEqual(ref);
		expect(parseRepoUrl('acme/drone')).toEqual(ref);
		expect(parseRepoUrl('https://github.com/acme/drone/tree/feature/x')).toEqual({
			...ref,
			branch: 'feature/x'
		});
		expect(parseRepoUrl('https://gitlab.com/acme/drone')).toBeNull();
		expect(parseRepoUrl('not a repo')).toBeNull();
	});

	it('pre-fills a fine-grained token with the needed permissions', () => {
		const url = new URL(tokenUrl());
		expect(url.pathname).toBe('/settings/personal-access-tokens/new');
		expect(url.searchParams.get('contents')).toBe('write');
		expect(url.searchParams.get('pull_requests')).toBe('write');
	});

	it('builds the tree on the base tree, deleting with a null sha', () => {
		expect(
			treePayload(
				'base-tree',
				[
					{ path: 'model/A.sysml', text: 'part def A;' },
					{ path: 'old.sysml', text: null }
				],
				{ 'model/A.sysml': 'blob-a' }
			)
		).toEqual({
			base_tree: 'base-tree',
			tree: [
				{ path: 'model/A.sysml', mode: '100644', type: 'blob', sha: 'blob-a' },
				{ path: 'old.sysml', mode: '100644', type: 'blob', sha: null }
			]
		});
	});
});

describe('GitHubProvider', () => {
	it('commits through blobs, a tree, a commit and a fast-forward ref update', async () => {
		const { fetch, calls } = mockFetch({
			'GET /repos/acme/drone/branches/main': branch('c1'),
			'POST /repos/acme/drone/git/blobs': (call) => ({
				status: 201,
				body: { sha: `blob-${(call.body as { content: string }).content.length}` }
			}),
			'POST /repos/acme/drone/git/trees': () => ({ status: 201, body: { sha: 't2' } }),
			'POST /repos/acme/drone/git/commits': () => ({
				status: 201,
				body: { sha: 'c2', html_url: 'https://github.com/acme/drone/commit/c2' }
			}),
			'PATCH /repos/acme/drone/git/refs/heads/main': () => ({ body: { object: { sha: 'c2' } } })
		});
		const github = new GitHubProvider('tok', { fetch });
		const result = await github.commit(ref, {
			branch: 'main',
			parent: 'c1',
			baseTree: 't1',
			message: 'Add a hook',
			changes: [
				{ path: 'model/A.sysml', text: 'part def A;' },
				{ path: 'gone.sysml', text: null }
			]
		});
		expect(result).toMatchObject({
			commit: 'c2',
			tree: 't2',
			blobs: { 'model/A.sysml': 'blob-11' }
		});
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'GET /repos/acme/drone/branches/main',
			'POST /repos/acme/drone/git/blobs',
			'POST /repos/acme/drone/git/trees',
			'POST /repos/acme/drone/git/commits',
			'PATCH /repos/acme/drone/git/refs/heads/main'
		]);
		expect(calls[0]!.auth).toBe('Bearer tok');
		expect(calls[1]!.body).toEqual({ content: 'part def A;', encoding: 'utf-8' });
		expect(calls[2]!.body).toEqual({
			base_tree: 't1',
			tree: [
				{ path: 'model/A.sysml', mode: '100644', type: 'blob', sha: 'blob-11' },
				{ path: 'gone.sysml', mode: '100644', type: 'blob', sha: null }
			]
		});
		expect(calls[3]!.body).toEqual({ message: 'Add a hook', tree: 't2', parents: ['c1'] });
		expect(calls[4]!.body).toEqual({ sha: 'c2', force: false });
	});

	it('refuses to commit when the branch moved, before writing anything', async () => {
		const { fetch, calls } = mockFetch({ 'GET /repos/acme/drone/branches/main': branch('c9') });
		const github = new GitHubProvider('tok', { fetch });
		const error = await github
			.commit(ref, {
				branch: 'main',
				parent: 'c1',
				baseTree: 't1',
				message: 'x',
				changes: [{ path: 'a.sysml', text: 'a' }]
			})
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GitError);
		expect((error as GitError).kind).toBe('behind');
		expect(calls).toHaveLength(1);
	});

	it('reads a tree and decodes UTF-8 blobs, reporting progress', async () => {
		const text = 'part def Größe;\n';
		const { fetch } = mockFetch({
			'GET /repos/acme/drone/git/commits/c1': () => ({ body: { tree: { sha: 't1' } } }),
			'GET /repos/acme/drone/git/trees/t1\\?recursive=1': () => ({
				body: {
					sha: 't1',
					truncated: false,
					tree: [
						{ path: 'model', type: 'tree', sha: 'd' },
						{ path: 'model/A.sysml', type: 'blob', sha: 'b1', size: 18 }
					]
				}
			}),
			'GET /repos/acme/drone/git/blobs/b1': () => ({
				body: { content: Buffer.from(text).toString('base64'), encoding: 'base64' }
			})
		});
		const github = new GitHubProvider('tok', { fetch });
		const tree = await github.readTree(ref, 'c1');
		expect(tree.entries).toEqual([{ path: 'model/A.sysml', sha: 'b1', size: 18 }]);
		const progress: string[] = [];
		const files = await github.readFiles(ref, tree.entries, (d, t) => progress.push(`${d}/${t}`));
		expect(files).toEqual({ 'model/A.sysml': text });
		expect(progress).toEqual(['0/1', '1/1']);
	});

	it('lists open proposals and recent versions, and finds where branches part', async () => {
		const { fetch } = mockFetch({
			'GET /repos/acme/drone/pulls\\?state=open.*': () => ({
				body: [
					{
						number: 9,
						html_url: 'https://github.com/acme/drone/pull/9',
						title: 'Heavier motors',
						user: { login: 'jo' },
						head: { ref: 'motors', sha: 'h9' },
						base: { ref: 'main', sha: 'b9' },
						updated_at: '2026-10-20T10:00:00Z'
					}
				]
			}),
			'GET /repos/acme/drone/commits\\?sha=main&per_page=5': () => ({
				body: [
					{
						sha: 'c2',
						commit: {
							message: 'Add SYS-011\n\nNoise at night',
							author: { name: 'Jo', date: '2026-10-20' }
						},
						author: null
					}
				]
			}),
			'GET /repos/acme/drone/compare/main...motors\\?per_page=1': () => ({
				body: { merge_base_commit: { sha: 'm1' } }
			})
		});
		const github = new GitHubProvider('tok', { fetch });
		expect(await github.listPullRequests(ref)).toEqual([
			{
				number: 9,
				url: 'https://github.com/acme/drone/pull/9',
				title: 'Heavier motors',
				author: 'jo',
				head: { ref: 'motors', sha: 'h9' },
				base: { ref: 'main', sha: 'b9' },
				updatedAt: '2026-10-20T10:00:00Z'
			}
		]);
		expect(await github.listCommits(ref, 'main', 5)).toEqual([
			{ sha: 'c2', title: 'Add SYS-011', author: 'Jo', date: '2026-10-20' }
		]);
		expect(await github.mergeBase(ref, 'main', 'motors')).toBe('m1');
	});

	it('creates branches, opens pull requests and compares', async () => {
		const { fetch, calls } = mockFetch({
			'POST /repos/acme/drone/git/refs': () => ({ status: 201, body: {} }),
			'POST /repos/acme/drone/pulls': () => ({
				status: 201,
				body: { number: 7, html_url: 'https://github.com/acme/drone/pull/7', title: 'Hook' }
			}),
			'GET /repos/acme/drone/compare/c1...feature/x\\?per_page=1': () => ({
				body: { ahead_by: 2, behind_by: 0, status: 'ahead' }
			})
		});
		const github = new GitHubProvider('tok', { fetch });
		await github.createBranch(ref, 'feature/x', 'c1');
		expect(calls[0]!.body).toEqual({ ref: 'refs/heads/feature/x', sha: 'c1' });
		const pr = await github.openPullRequest(ref, {
			title: 'Hook',
			body: 'Adds it',
			head: 'feature/x',
			base: 'main'
		});
		expect(pr).toEqual({ number: 7, url: 'https://github.com/acme/drone/pull/7', title: 'Hook' });
		expect(await github.compare(ref, 'c1', 'feature/x')).toEqual({
			ahead: 2,
			behind: 0,
			status: 'ahead'
		});
	});

	it('explains failures kindly', async () => {
		const kindOf = async (status: number, body: unknown, headers: Record<string, string> = {}) => {
			const { fetch } = mockFetch({ 'GET /user': () => ({ status, body, headers }) });
			const error = (await new GitHubProvider('tok', { fetch })
				.currentUser()
				.catch((e: unknown) => e)) as GitError;
			return [error.kind, error.message];
		};
		expect((await kindOf(401, { message: 'Bad credentials' }))[0]).toBe('auth');
		expect(
			(
				await kindOf(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
			)[0]
		).toBe('rate-limit');
		const [kind, message] = await kindOf(403, {
			message: 'Resource not accessible by personal access token'
		});
		expect(kind).toBe('permission');
		expect(message).toContain('Contents: Read and write');
		expect((await kindOf(404, { message: 'Not Found' }))[0]).toBe('not-found');
		expect((await kindOf(422, { message: 'Update is not a fast forward' }))[0]).toBe('behind');
		expect((await kindOf(409, { message: 'Git Repository is empty.' }))[0]).toBe('empty');
		expect((await kindOf(422, { message: 'Reference already exists' }))[0]).toBe('exists');

		const offline = new GitHubProvider('tok', {
			fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
		});
		expect(((await offline.currentUser().catch((e: unknown) => e)) as GitError).kind).toBe(
			'network'
		);
	});

	it('lists a signed-in account’s repositories from the app’s installations', async () => {
		const repo = (full: string, pushed: string, push = true) => ({
			name: full.split('/')[1],
			full_name: full,
			owner: { login: full.split('/')[0] },
			private: true,
			default_branch: 'main',
			description: null,
			pushed_at: pushed,
			html_url: `https://github.com/${full}`,
			permissions: { push }
		});
		const { fetch, calls } = mockFetch({
			'GET /user/installations\\?per_page=100&page=1': () => ({
				body: { total_count: 2, installations: [{ id: 7 }, { id: 9 }] }
			}),
			'GET /user/installations/7/repositories\\?per_page=100&page=1': () => ({
				body: { repositories: [repo('octo/rig', '2026-10-01T00:00:00Z')] }
			}),
			'GET /user/installations/9/repositories\\?per_page=100&page=1': () => ({
				body: {
					repositories: [
						repo('acme/drone', '2026-10-20T00:00:00Z', false),
						repo('octo/rig', '2026-10-01T00:00:00Z')
					]
				}
			})
		});
		const github = new GitHubProvider({ token: () => 'ghu_1', access: 'app' }, { fetch });
		const repos = await github.listRepos();
		expect(repos.map((r) => [r.fullName, r.canPush])).toEqual([
			['acme/drone', false],
			['octo/rig', true]
		]);
		expect(calls.every((c) => c.auth === 'Bearer ghu_1')).toBe(true);
		expect(calls.some((c) => c.url.startsWith('/user/repos'))).toBe(false);

		// Nothing chosen yet: an empty list, so the app can offer to choose some.
		const none = mockFetch({
			'GET /user/installations\\?per_page=100&page=1': () => ({
				body: { total_count: 0, installations: [] }
			})
		});
		expect(
			await new GitHubProvider(
				{ token: () => 't', access: 'app' },
				{ fetch: none.fetch }
			).listRepos()
		).toEqual([]);
	});

	it('explains failures for a signed-in account without talking about tokens', async () => {
		const failing = async (status: number): Promise<GitError> =>
			(await new GitHubProvider(
				{ token: () => 'ghu_1', access: 'app' },
				{
					fetch: mockFetch({
						'GET /repos/acme/drone': () => ({ status, body: { message: 'x' } })
					}).fetch
				}
			)
				.getRepo(ref)
				.catch((e: unknown) => e)) as GitError;
		for (const status of [401, 403, 404]) {
			const error = await failing(status);
			expect(error.message, String(status)).not.toMatch(/token/i);
		}
		expect((await failing(401)).message).toMatch(/Sign in again/);
		expect((await failing(403)).message).toMatch(/choose repositories on GitHub/);
		expect((await failing(404)).message).toMatch(/Tessera can use this repository/);
	});

	it('retries once with a renewed token when GitHub refuses one', async () => {
		const seen: string[] = [];
		const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			const auth = new Headers(init?.headers).get('authorization')!;
			seen.push(auth);
			return auth === 'Bearer new'
				? Response.json({ login: 'octo', name: null, avatar_url: '' })
				: Response.json({ message: 'Bad credentials' }, { status: 401 });
		}) as typeof globalThis.fetch;
		const renew = vi.fn(async () => 'new');
		const github = new GitHubProvider({ token: () => 'old', renew, access: 'app' }, { fetch });
		expect((await github.currentUser()).login).toBe('octo');
		expect(seen).toEqual(['Bearer old', 'Bearer new']);
		expect(renew).toHaveBeenCalledWith('old');

		// No new token: GitHub's refusal stands, and there is no second retry.
		seen.length = 0;
		const stuck = new GitHubProvider(
			{ token: () => 'old', renew: async () => null, access: 'app' },
			{ fetch }
		);
		await expect(stuck.currentUser()).rejects.toMatchObject({ kind: 'auth' });
		expect(seen).toEqual(['Bearer old']);
	});
});

describe('GitHub Enterprise Server', () => {
	const ghes = 'https://github.example.com/api/v3';

	it('finds the API from the server address github.com or an Enterprise server has', () => {
		expect(githubApi('')).toBe(GITHUB_API);
		expect(githubApi(' github.com ')).toBe(GITHUB_API);
		expect(githubApi('github.example.com')).toBe(ghes);
		expect(githubApi('https://github.example.com/')).toBe(ghes);
		expect(githubApi('https://github.example.com/api/v3')).toBe(ghes);
		expect(githubApi('https://git.example.com:8443')).toBe('https://git.example.com:8443/api/v3');
		expect(() => githubApi('http://github.example.com')).toThrow(/must start with https/);
		expect(githubWeb(ghes)).toBe('https://github.example.com');
		expect(githubWeb()).toBe('https://github.com');
	});

	it('makes tokens, reads repository addresses and links on that server', () => {
		expect(tokenUrl(ghes)).toMatch(
			/^https:\/\/github\.example\.com\/settings\/personal-access-tokens\/new\?/
		);
		expect(parseRepoUrl('https://github.example.com/acme/drone/tree/dev', ghes)).toEqual({
			owner: 'acme',
			repo: 'drone',
			branch: 'dev'
		});
		expect(parseRepoUrl('git@github.example.com:acme/drone.git', ghes)).toEqual({
			owner: 'acme',
			repo: 'drone'
		});
		// github.com's addresses are not that server's.
		expect(parseRepoUrl('https://github.com/acme/drone', ghes)).toBeNull();
		expect(new GitHubProvider('tok', { api: ghes }).webUrl(ref, 'main')).toBe(
			'https://github.example.com/acme/drone/tree/main'
		);
	});

	it('sends the token to that server only', async () => {
		const sent: { url: string; auth: string | null }[] = [];
		const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			sent.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
			return new Response(JSON.stringify({ login: 'octo', name: null, avatar_url: '' }), {
				headers: { 'content-type': 'application/json' }
			});
		}) as typeof globalThis.fetch;
		const github = new GitHubProvider('tok', { fetch, api: ghes });
		await github.currentUser();
		expect(sent).toEqual([{ url: `${ghes}/user`, auth: 'Bearer tok' }]);
		// An address on another site (as a link in an answer could name) is not requested at all.
		const request = (
			github as unknown as { request: (m: string, u: string) => Promise<unknown> }
		).request.bind(github);
		await expect(request('GET', 'https://api.github.com/user')).rejects.toThrow(
			/pointed to another site \(api\.github\.com\)/
		);
		expect(sent).toHaveLength(1);
	});
});

describe('GitHubProvider tags (baselines)', () => {
	const annotated = (sha: string, commit: string, message: string) => ({
		body: {
			sha,
			message,
			tagger: { name: 'Ada', date: '2026-03-12T09:30:00Z' },
			object: { sha: commit, type: 'commit' }
		}
	});

	it('lists the tags under a prefix: annotated ones with their message, lightweight ones bare', async () => {
		const { fetch, calls } = mockFetch({
			'GET /repos/acme/drone/git/matching-refs/tags/baseline/': () => ({
				body: [
					{ ref: 'refs/tags/baseline/PDR', object: { sha: 'tag-pdr', type: 'tag' } },
					{ ref: 'refs/tags/baseline/SRR', object: { sha: 'c-srr', type: 'commit' } },
					// A tag of a tag names no commit directly: left out.
					{ ref: 'refs/tags/baseline/odd', object: { sha: 'tag-odd', type: 'tag' } }
				]
			}),
			'GET /repos/acme/drone/git/tags/tag-pdr': () =>
				annotated('tag-pdr', 'c-pdr', 'PDR\n\nBaseline-date: 2026-03-12\n'),
			'GET /repos/acme/drone/git/tags/tag-odd': () => ({
				body: { sha: 'tag-odd', message: 'x', object: { sha: 'tag-pdr', type: 'tag' } }
			})
		});
		const github = new GitHubProvider('tok', { fetch });
		expect(await github.listTags(ref, 'baseline/')).toEqual([
			{
				name: 'baseline/PDR',
				commit: 'c-pdr',
				message: 'PDR\n\nBaseline-date: 2026-03-12\n',
				date: '2026-03-12T09:30:00Z',
				tagger: 'Ada'
			},
			{ name: 'baseline/SRR', commit: 'c-srr', message: '', date: null, tagger: null }
		]);
		expect(calls.every((c) => c.method === 'GET')).toBe(true);
	});

	it('makes an annotated tag: the tag object on the commit, then the ref that names it', async () => {
		const { fetch, calls } = mockFetch({
			'POST /repos/acme/drone/git/tags': (call) => ({
				status: 201,
				body: {
					...annotated('tag-cdr', 'c7', (call.body as { message: string }).message).body
				}
			}),
			'POST /repos/acme/drone/git/refs': () => ({ status: 201, body: {} })
		});
		const github = new GitHubProvider('tok', { fetch });
		const tag = await github.createTag(ref, {
			name: 'baseline/CDR',
			message: 'CDR\n\nBaseline-date: 2026-06-01\n',
			commit: 'c7'
		});
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'POST /repos/acme/drone/git/tags',
			'POST /repos/acme/drone/git/refs'
		]);
		expect(calls[0]!.body).toEqual({
			tag: 'baseline/CDR',
			message: 'CDR\n\nBaseline-date: 2026-06-01\n',
			object: 'c7',
			type: 'commit'
		});
		expect(calls[1]!.body).toEqual({ ref: 'refs/tags/baseline/CDR', sha: 'tag-cdr' });
		expect(tag).toMatchObject({ name: 'baseline/CDR', commit: 'c7', tagger: 'Ada' });
	});

	it('says plainly when the tag name is taken', async () => {
		const { fetch } = mockFetch({
			'POST /repos/acme/drone/git/tags': () => annotated('t', 'c7', 'CDR'),
			'POST /repos/acme/drone/git/refs': () => ({
				status: 422,
				body: { message: 'Reference already exists' }
			})
		});
		const github = new GitHubProvider('tok', { fetch });
		const error = await github
			.createTag(ref, { name: 'baseline/CDR', message: 'CDR', commit: 'c7' })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GitError);
		expect((error as GitError).kind).toBe('exists');
	});

	it('deletes a tag by its ref, keeping the slash in its name', async () => {
		const { fetch, calls } = mockFetch({
			'DELETE /repos/acme/drone/git/refs/tags/baseline/PDR-2': () => ({ status: 204 })
		});
		const github = new GitHubProvider('tok', { fetch });
		await github.deleteTag(ref, 'baseline/PDR-2');
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'DELETE /repos/acme/drone/git/refs/tags/baseline/PDR-2'
		]);
	});
});
