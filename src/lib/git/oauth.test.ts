import { describe, expect, it, vi } from 'vitest';
import { GitError } from './errors.ts';
import {
	authorizeUrl,
	challengeFor,
	completeSignIn,
	installUrl,
	needsRefresh,
	parseTokenResponse,
	pendingSignIn,
	refreshExpired,
	refreshTokens,
	rememberInstall,
	safeReturn,
	setResume,
	signInConfig,
	signInResume,
	startSignIn,
	takeInstall,
	takeResume,
	type SignInStores
} from './oauth.ts';

function memory() {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k)
	};
}

function stores() {
	const session = memory();
	const local = memory();
	return { session, local, both: { session, local } satisfies SignInStores };
}

const config = { clientId: 'Iv1.abc', worker: 'https://sync.example' };
const REDIRECT = 'https://app.example/sysml-web/auth/callback/';
const NOW = Date.UTC(2026, 9, 22, 12);

/** A worker that answers the token request with `body`, recording what it was sent. */
function worker(body: string, status = 200) {
	const calls: { url: string; body: Record<string, string> }[] = [];
	const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return new Response(body, { status });
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

/** Start a sign-in and return what GitHub would send back. */
async function started(s: SignInStores, now = NOW) {
	const url = new URL(
		await startSignIn(
			config,
			{ redirectUri: REDIRECT, returnTo: '/sysml-web/projects', resume: 'open-repository' },
			s,
			now
		)
	);
	return { url, state: url.searchParams.get('state')! };
}

describe('sign-in settings', () => {
	it('offers sign-in only with both a client ID and a worker', () => {
		expect(signInConfig({})).toBeNull();
		expect(signInConfig({ clientId: 'Iv1.abc' })).toBeNull();
		expect(signInConfig({ worker: 'https://sync.example' })).toBeNull();
		expect(signInConfig({ clientId: ' ', worker: 'https://sync.example' })).toBeNull();
		expect(signInConfig({ clientId: 'Iv1.abc', worker: 'https://sync.example/' })).toEqual(config);
		expect(
			signInConfig({ clientId: 'Iv1.abc', worker: 'https://sync.example', appSlug: 'sysml-web' })
		).toEqual({ ...config, appSlug: 'sysml-web' });
	});

	it('links to choosing repositories for the app', () => {
		expect(installUrl({ ...config, appSlug: 'sysml-web' })).toBe(
			'https://github.com/apps/sysml-web/installations/new'
		);
		expect(installUrl(config)).toBe('https://github.com/settings/installations');
	});
});

describe('starting a sign-in', () => {
	it('computes the RFC 7636 S256 challenge', async () => {
		expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});

	it('builds GitHub’s authorize URL', () => {
		const url = new URL(authorizeUrl('Iv1.abc', REDIRECT, 's', 'c'));
		expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: 'Iv1.abc',
			redirect_uri: REDIRECT,
			state: 's',
			code_challenge: 'c',
			code_challenge_method: 'S256'
		});
	});

	it('remembers the sign-in in the tab (and the browser) and sends the challenge', async () => {
		const s = stores();
		const { url, state } = await started(s.both);
		expect(url.searchParams.get('client_id')).toBe('Iv1.abc');
		expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
		const pending = JSON.parse(s.session.map.get('sysml-web:github-sign-in')!);
		expect(s.local.map.get('sysml-web:github-sign-in')).toBe(
			s.session.map.get('sysml-web:github-sign-in')
		);
		expect(pending).toMatchObject({
			state,
			redirectUri: REDIRECT,
			returnTo: '/sysml-web/projects',
			resume: 'open-repository'
		});
		expect(pending.verifier.length).toBeGreaterThanOrEqual(43);
		expect(url.searchParams.get('code_challenge')).toBe(await challengeFor(pending.verifier));
		expect(pendingSignIn(s.both)).toEqual({
			returnTo: '/sysml-web/projects',
			resume: 'open-repository'
		});
	});

	it('explains when the browser blocks storage', async () => {
		await expect(
			startSignIn(config, { redirectUri: REDIRECT, returnTo: '/' }, { session: null, local: null })
		).rejects.toThrow(/blocking site storage/);
	});
});

describe('back from GitHub', () => {
	it('trades the code through the worker and returns where the sign-in started', async () => {
		const s = stores();
		const { url, state } = await started(s.both);
		const w = worker(
			JSON.stringify({
				access_token: 'ghu_1',
				refresh_token: 'ghr_1',
				expires_in: 28800,
				refresh_token_expires_in: 15897600,
				token_type: 'bearer'
			})
		);
		const done = await completeSignIn(new URLSearchParams({ code: 'the-code', state }), config, {
			stores: s.both,
			fetch: w.fetch,
			now: () => NOW
		});
		expect(w.calls).toHaveLength(1);
		expect(w.calls[0]!.url).toBe('https://sync.example/oauth/github/token');
		expect(pendingSignIn(s.both)).toBeNull(); // Forgotten in the tab and the browser.
		expect(w.calls[0]!.body).toMatchObject({ code: 'the-code', redirect_uri: REDIRECT });
		// The verifier sent is the one behind the challenge GitHub was given.
		expect(await challengeFor(w.calls[0]!.body.code_verifier!)).toBe(
			url.searchParams.get('code_challenge')
		);
		expect(done).toEqual({
			returnTo: '/sysml-web/projects',
			resume: 'open-repository',
			tokens: {
				accessToken: 'ghu_1',
				refreshToken: 'ghr_1',
				expiresAt: NOW + 28800_000,
				refreshExpiresAt: NOW + 15897600_000
			}
		});
	});

	it('uses the browser’s copy when the tab lost its own', async () => {
		const s = stores();
		const { state } = await started(s.both);
		s.session.map.clear();
		const w = worker('{"access_token":"ghu_1"}');
		const done = await completeSignIn(new URLSearchParams({ code: 'c', state }), config, {
			stores: s.both,
			fetch: w.fetch,
			now: () => NOW
		});
		expect(done.tokens.accessToken).toBe('ghu_1');
	});

	it('stops a sign-in whose state doesn’t match, without asking the worker', async () => {
		const s = stores();
		await started(s.both);
		const w = worker('{"access_token":"x"}');
		const attempt = completeSignIn(new URLSearchParams({ code: 'c', state: 'forged' }), config, {
			stores: s.both,
			fetch: w.fetch,
			now: () => NOW
		});
		await expect(attempt).rejects.toThrow(/doesn’t match/);
		await expect(attempt).rejects.toBeInstanceOf(GitError);
		expect(w.fetch).not.toHaveBeenCalled();
		// It can't be retried with the same pending sign-in.
		expect(pendingSignIn(s.both)).toBeNull();
	});

	it('refuses a callback nobody started here, or one left too long', async () => {
		const w = worker('{"access_token":"x"}');
		await expect(
			completeSignIn(new URLSearchParams({ code: 'c', state: 's' }), config, {
				stores: stores().both,
				fetch: w.fetch
			})
		).rejects.toThrow(/expired or was started somewhere else/);
		const s = stores();
		const { state } = await started(s.both, NOW);
		await expect(
			completeSignIn(new URLSearchParams({ code: 'c', state }), config, {
				stores: s.both,
				fetch: w.fetch,
				now: () => NOW + 31 * 60_000
			})
		).rejects.toThrow(/expired/);
		expect(w.fetch).not.toHaveBeenCalled();
	});

	it('says so when the person cancels on GitHub', async () => {
		const s = stores();
		const { state } = await started(s.both);
		await expect(
			completeSignIn(new URLSearchParams({ error: 'access_denied', state }), config, {
				stores: s.both,
				now: () => NOW
			})
		).rejects.toThrow(/cancelled on GitHub/);
	});
});

describe('token responses', () => {
	it('reads JSON and form-encoded answers', () => {
		expect(
			parseTokenResponse('{"access_token":"a","refresh_token":"r","expires_in":60}', 200, 1000)
		).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 61_000, refreshExpiresAt: null });
		expect(
			parseTokenResponse(
				'access_token=a&expires_in=28800&refresh_token=r&refresh_token_expires_in=100&scope=&token_type=bearer',
				200,
				0
			)
		).toEqual({
			accessToken: 'a',
			refreshToken: 'r',
			expiresAt: 28_800_000,
			refreshExpiresAt: 100_000
		});
		// A token that doesn't expire (an app with expiry turned off).
		expect(parseTokenResponse('access_token=a&scope=&token_type=bearer', 200)).toMatchObject({
			accessToken: 'a',
			refreshToken: null,
			expiresAt: null
		});
	});

	it('turns GitHub’s errors into plain words', () => {
		const error = (text: string, status = 200) => {
			try {
				parseTokenResponse(text, status);
			} catch (e) {
				return e as GitError;
			}
			throw new Error('expected an error');
		};
		expect(error('{"error":"bad_refresh_token"}').kind).toBe('auth');
		expect(error('{"error":"bad_refresh_token"}').message).toMatch(/expired/);
		expect(error('error=bad_verification_code&error_description=The+code+is+wrong').detail).toBe(
			'bad_verification_code: The code is wrong'
		);
		expect(
			error('github sign-in is not configured on this worker (missing at runtime: X)', 501).message
		).toMatch(/isn’t set up on this site/);
		expect(error('Origin not allowed', 403).message).toMatch(/isn’t available at this address/);
		expect(error('<html>Bad gateway</html>', 502).message).toMatch(/Try again/);
		for (const e of [error('{"error":"redirect_uri_mismatch"}'), error('', 500)])
			expect(e.message).not.toMatch(/worker|OAuth|PKCE/i);
	});
});

describe('refreshing', () => {
	it('refreshes shortly before the token expires, and only when it can', () => {
		const hour = 3_600_000;
		expect(needsRefresh({ refreshToken: 'r', expiresAt: NOW + 8 * hour }, NOW)).toBe(false);
		expect(needsRefresh({ refreshToken: 'r', expiresAt: NOW + 60_000 }, NOW)).toBe(true);
		expect(needsRefresh({ refreshToken: 'r', expiresAt: NOW - 1 }, NOW)).toBe(true);
		expect(needsRefresh({ refreshToken: null, expiresAt: NOW - 1 }, NOW)).toBe(false);
		expect(needsRefresh({ refreshToken: 'r', expiresAt: null }, NOW)).toBe(false);
		expect(refreshExpired({ refreshExpiresAt: NOW - 1 }, NOW)).toBe(true);
		expect(refreshExpired({ refreshExpiresAt: null }, NOW)).toBe(false);
	});

	it('sends the refresh token to the worker and keeps it if GitHub sends no new one', async () => {
		const w = worker('{"access_token":"ghu_2","expires_in":28800}');
		const tokens = await refreshTokens(config, 'ghr_1', w.fetch, () => NOW);
		expect(w.calls).toEqual([
			{ url: 'https://sync.example/oauth/github/refresh', body: { refresh_token: 'ghr_1' } }
		]);
		expect(tokens).toMatchObject({
			accessToken: 'ghu_2',
			refreshToken: 'ghr_1',
			expiresAt: NOW + 28800_000
		});
	});

	it('reports a network failure as one', async () => {
		const failing = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		}) as unknown as typeof fetch;
		await expect(refreshTokens(config, 'r', failing)).rejects.toMatchObject({ kind: 'network' });
	});
});

describe('coming back to the right place', () => {
	it('returns only to pages on this site', () => {
		const fallback = '/sysml-web/projects';
		expect(safeReturn('/sysml-web/p/abc#github', '/sysml-web', fallback)).toBe(
			'/sysml-web/p/abc#github'
		);
		expect(safeReturn('/sysml-web', '/sysml-web', fallback)).toBe('/sysml-web');
		expect(safeReturn('/p/abc', '', '/projects')).toBe('/p/abc');
		for (const bad of [
			'https://evil.example/',
			'//evil.example/x',
			'/\\evil.example',
			'/other-site/',
			'javascript:alert(1)',
			'',
			null
		])
			expect(safeReturn(bad, '/sysml-web', fallback), String(bad)).toBe(fallback);
	});

	it('reopens what the person was doing, once', () => {
		const s = stores();
		setResume('source-control', s.both, NOW);
		expect(signInResume(s.both, NOW)).toBe('source-control');
		expect(takeResume('settings', s.both, NOW)).toBe(false);
		expect(takeResume('source-control', s.both, NOW)).toBe(true);
		expect(takeResume('source-control', s.both, NOW)).toBe(false);
		// Not for a page loaded long after.
		setResume('settings', s.both, NOW);
		expect(takeResume('settings', s.both, NOW + 10 * 60_000)).toBe(false);
	});

	it('remembers where to return after choosing repositories', () => {
		const s = stores();
		rememberInstall('/sysml-web/p/abc', 'source-control', s.both, NOW);
		expect(takeInstall(s.both, NOW + 60_000)).toEqual({
			returnTo: '/sysml-web/p/abc',
			resume: 'source-control'
		});
		expect(takeInstall(s.both, NOW)).toBeNull();
		rememberInstall('/sysml-web/p/abc', undefined, s.both, NOW);
		expect(takeInstall(s.both, NOW + 3_600_000)).toBeNull();
	});
});
