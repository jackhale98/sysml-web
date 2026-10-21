import { describe, expect, it } from 'vitest';
import { GitError } from './errors.ts';
import { GitHubProvider, parseRepoUrl, tokenUrl, treePayload } from './github.ts';

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
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
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
		return new Response(JSON.stringify(result.body ?? {}), {
			status: result.status ?? 200,
			headers: { 'content-type': 'application/json', ...result.headers }
		});
	}) as typeof fetch;
	return { fetch, calls };
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
});
