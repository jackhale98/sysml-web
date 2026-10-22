import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_KEY, Accounts, readAccount } from './account.svelte.ts';
import { GitError } from './errors.ts';

const NOW = Date.UTC(2026, 9, 22, 12);
const HOUR = 3_600_000;
const config = { clientId: 'Iv1.abc', worker: 'https://sync.example' };
const octo = { login: 'octo', name: 'Octo Cat', avatarUrl: 'https://avatars.example/octo' };

let stored: Map<string, string>;
beforeEach(() => {
	stored = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => stored.get(k) ?? null,
		setItem: (k: string, v: string) => void stored.set(k, v),
		removeItem: (k: string) => void stored.delete(k)
	});
});
afterEach(() => vi.unstubAllGlobals());

interface Call {
	url: string;
	auth?: string;
	body?: Record<string, string>;
}

/**
 * GitHub's API and the sign-in worker. The API accepts only the tokens in
 * `valid`; the worker hands out `ghu_<n>`/`ghr_<n>` for each refresh.
 */
function github(valid: Set<string>) {
	const calls: Call[] = [];
	let issued = 1;
	const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const auth = new Headers(init?.headers).get('authorization') ?? undefined;
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : undefined;
		calls.push({ url, auth, body });
		if (url === 'https://sync.example/oauth/github/refresh') {
			if (body?.refresh_token !== `ghr_${issued}`)
				return new Response('{"error":"bad_refresh_token"}');
			issued++;
			valid.add(`ghu_${issued}`);
			return new Response(
				JSON.stringify({
					access_token: `ghu_${issued}`,
					refresh_token: `ghr_${issued}`,
					expires_in: 28800,
					refresh_token_expires_in: 15897600
				})
			);
		}
		if (!auth || !valid.has(auth.replace('Bearer ', '')))
			return new Response('{"message":"Bad credentials"}', { status: 401 });
		if (url.endsWith('/user'))
			return Response.json({ login: 'octo', name: 'Octo Cat', avatar_url: octo.avatarUrl });
		return Response.json({ name: 'main', commit: { sha: 'c1', commit: { tree: { sha: 't1' } } } });
	}) as unknown as typeof globalThis.fetch;
	return {
		fetch,
		calls,
		api: () => calls.filter((c) => c.url.startsWith('https://api.github.com'))
	};
}

function accountsWith(fetch: typeof globalThis.fetch, now = NOW) {
	const accounts = new Accounts();
	accounts.fetch = fetch;
	accounts.signIn = config;
	accounts.now = () => now;
	return accounts;
}

const appAccount = (overrides: object = {}) =>
	JSON.stringify({
		token: 'ghu_1',
		user: octo,
		connectedAt: '2026-10-22T08:00:00.000Z',
		via: 'app',
		refreshToken: 'ghr_1',
		expiresAt: NOW + 4 * HOUR,
		refreshExpiresAt: NOW + 100 * 24 * HOUR,
		...overrides
	});

describe('stored accounts', () => {
	it('reads accounts stored before sign-in existed as access tokens', () => {
		expect(
			readAccount(JSON.stringify({ token: 'github_pat_1', user: octo, connectedAt: '2026-09-01' }))
		).toEqual({ token: 'github_pat_1', user: octo, connectedAt: '2026-09-01', via: 'token' });
		expect(readAccount(appAccount())).toMatchObject({ via: 'app', refreshToken: 'ghr_1' });
		for (const bad of [null, '', 'not json', '{}', '{"token":"t"}', '{"user":{"login":"o"}}'])
			expect(readAccount(bad), String(bad)).toBeNull();
	});

	it('keeps an old token account working, unchanged', async () => {
		stored.set(
			ACCOUNT_KEY,
			JSON.stringify({ token: 'github_pat_1', user: octo, connectedAt: '2026-09-01' })
		);
		const gh = github(new Set(['github_pat_1']));
		const accounts = accountsWith(gh.fetch);
		expect(accounts.connected).toBe(true);
		expect(accounts.github).toEqual({ user: octo, connectedAt: '2026-09-01', via: 'token' });
		await accounts.provider().head({ owner: 'acme', repo: 'drone' }, 'main');
		expect(gh.calls.map((c) => c.auth)).toEqual(['Bearer github_pat_1']);
		// Not rewritten: the old shape stays as it was.
		expect(JSON.parse(stored.get(ACCOUNT_KEY)!)).not.toHaveProperty('via');
	});

	it('words a refused access token as before', async () => {
		stored.set(ACCOUNT_KEY, JSON.stringify({ token: 'old', user: octo, connectedAt: 'x' }));
		const accounts = accountsWith(github(new Set()).fetch);
		await expect(accounts.provider().head({ owner: 'a', repo: 'b' }, 'main')).rejects.toThrow(
			/didn't accept your access token/
		);
	});

	it('remembers a sign-in with its tokens', async () => {
		const gh = github(new Set(['ghu_9']));
		const accounts = accountsWith(gh.fetch);
		const user = await accounts.signInWith({
			accessToken: 'ghu_9',
			refreshToken: 'ghr_9',
			expiresAt: NOW + 8 * HOUR,
			refreshExpiresAt: NOW + 184 * 24 * HOUR
		});
		expect(user.login).toBe('octo');
		expect(accounts.github?.via).toBe('app');
		expect(JSON.parse(stored.get(ACCOUNT_KEY)!)).toMatchObject({
			token: 'ghu_9',
			via: 'app',
			refreshToken: 'ghr_9',
			expiresAt: NOW + 8 * HOUR
		});
		accounts.signOut();
		expect(stored.has(ACCOUNT_KEY)).toBe(false);
		expect(accounts.connected).toBe(false);
	});
});

describe('a signed-in account', () => {
	const ref = { owner: 'acme', repo: 'drone' };

	it('uses its token while it is fresh', async () => {
		stored.set(ACCOUNT_KEY, appAccount());
		const gh = github(new Set(['ghu_1']));
		await accountsWith(gh.fetch).provider().head(ref, 'main');
		expect(gh.calls.map((c) => c.auth)).toEqual(['Bearer ghu_1']);
	});

	it('refreshes shortly before the token expires, then uses the new one', async () => {
		stored.set(ACCOUNT_KEY, appAccount({ expiresAt: NOW + 60_000 }));
		const gh = github(new Set(['ghu_1']));
		const accounts = accountsWith(gh.fetch);
		await accounts.provider().head(ref, 'main');
		expect(gh.calls.map((c) => c.url)).toEqual([
			'https://sync.example/oauth/github/refresh',
			'https://api.github.com/repos/acme/drone/branches/main'
		]);
		expect(gh.api()[0]!.auth).toBe('Bearer ghu_2');
		expect(JSON.parse(stored.get(ACCOUNT_KEY)!)).toMatchObject({
			token: 'ghu_2',
			refreshToken: 'ghr_2',
			expiresAt: NOW + 28800_000,
			via: 'app'
		});
	});

	it('refreshes once when GitHub refuses the token, and tries again', async () => {
		stored.set(ACCOUNT_KEY, appAccount());
		const gh = github(new Set()); // ghu_1 was revoked early; the refresh still works.
		const accounts = accountsWith(gh.fetch);
		await accounts.provider().head(ref, 'main');
		expect(gh.calls.map((c) => c.auth ?? c.url)).toEqual([
			'Bearer ghu_1',
			'https://sync.example/oauth/github/refresh',
			'Bearer ghu_2'
		]);
	});

	it('asks to sign in again when the refresh fails too, after one try', async () => {
		stored.set(ACCOUNT_KEY, appAccount({ refreshToken: 'ghr_stale' }));
		const gh = github(new Set());
		const attempt = accountsWith(gh.fetch).provider().head(ref, 'main');
		await expect(attempt).rejects.toBeInstanceOf(GitError);
		await expect(attempt).rejects.toMatchObject({ kind: 'auth' });
		await expect(attempt).rejects.toThrow(/sign-in has expired or was revoked\. Sign in again/);
		expect(gh.calls.filter((c) => c.url.includes('/refresh'))).toHaveLength(1);
		expect(gh.api()).toHaveLength(1);
	});

	it('asks to sign in again once the refresh token has expired, without trying it', async () => {
		stored.set(ACCOUNT_KEY, appAccount({ expiresAt: NOW - HOUR, refreshExpiresAt: NOW - 1 }));
		const gh = github(new Set());
		await expect(accountsWith(gh.fetch).provider().head(ref, 'main')).rejects.toThrow(
			/Sign in again/
		);
		expect(gh.calls).toEqual([]);
	});

	it('refreshes once for requests made together', async () => {
		stored.set(ACCOUNT_KEY, appAccount({ expiresAt: NOW - 1 }));
		const gh = github(new Set());
		const provider = accountsWith(gh.fetch).provider();
		await Promise.all(
			[provider.head(ref, 'main'), provider.head(ref, 'dev'), provider.getRepo(ref)].map((p) =>
				p.catch(() => null)
			)
		);
		expect(gh.calls.filter((c) => c.url.includes('/refresh'))).toHaveLength(1);
		expect(new Set(gh.api().map((c) => c.auth))).toEqual(new Set(['Bearer ghu_2']));
	});

	it('uses the token another tab already refreshed instead of refreshing again', async () => {
		stored.set(ACCOUNT_KEY, appAccount({ expiresAt: NOW - 1 }));
		const gh = github(new Set(['ghu_7']));
		const accounts = accountsWith(gh.fetch);
		accounts.init();
		// Another tab refreshed meanwhile (GitHub accepts each refresh token only once).
		stored.set(
			ACCOUNT_KEY,
			appAccount({ token: 'ghu_7', refreshToken: 'ghr_7', expiresAt: NOW + 8 * HOUR })
		);
		await accounts.provider().head(ref, 'main');
		expect(gh.calls.map((c) => c.auth ?? c.url)).toEqual(['Bearer ghu_7']);
	});
});
