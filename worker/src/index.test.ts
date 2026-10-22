import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

const env: Env = {
	ALLOWED_ORIGINS: 'https://app.example, http://localhost:4173',
	GITHUB_CLIENT_ID: 'id',
	GITHUB_CLIENT_SECRET: 'shh'
};
const ORIGIN = 'https://app.example';
const call = (
	path: string,
	init: RequestInit & { origin?: string | null } = {},
	withEnv: Env = env
) => {
	const headers = new Headers(init.headers);
	if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
	return worker.fetch(new Request(`https://sync.example${path}`, { ...init, headers }), withEnv);
};
const post = (path: string, body: unknown, withEnv?: Env) =>
	call(path, { method: 'POST', body: JSON.stringify(body) }, withEnv);

afterEach(() => vi.unstubAllGlobals());

describe('origins and CORS', () => {
	it('answers only allow-listed origins', async () => {
		const upstream = vi.fn();
		vi.stubGlobal('fetch', upstream);
		const none = await call('/oauth/github/token', { method: 'POST', origin: null, body: '{}' });
		expect(none.status).toBe(403);
		expect(await none.text()).toBe('Origin not allowed');
		expect(none.headers.get('Access-Control-Allow-Origin')).toBeNull();
		const evil = await call('/oauth/github/token', {
			method: 'POST',
			origin: 'https://evil.example',
			body: '{"code":"c"}'
		});
		expect(evil.status).toBe(403);
		expect(upstream).not.toHaveBeenCalled();
		// Also from localhost, for development.
		const local = await call('/oauth/github/token', {
			method: 'OPTIONS',
			origin: 'http://localhost:4173'
		});
		expect(local.status).toBe(204);
	});

	it('answers preflight with CORS headers', async () => {
		const res = await call('/oauth/github/token', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
		expect(res.headers.get('Vary')).toBe('Origin');
	});

	it('serves nothing but the sign-in endpoints', async () => {
		vi.stubGlobal('fetch', vi.fn());
		expect((await call('/')).status).toBe(404);
		expect((await call('/github.com/a/b.git/info/refs?service=git-upload-pack')).status).toBe(404);
		expect((await post('/oauth/gitlab/token', { code: 'c' })).status).toBe(404);
		expect((await post('/oauth/github/token/x', { code: 'c' })).status).toBe(404);
		expect((await call('/oauth/github/token')).status).toBe(404);
	});
});

describe('sign-in', () => {
	it('adds the client secret and relays the token response', async () => {
		const upstream = vi.fn(
			async () =>
				new Response('{"access_token":"t","refresh_token":"r","expires_in":28800}', {
					headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1' }
				})
		);
		vi.stubGlobal('fetch', upstream);
		const res = await post('/oauth/github/token', {
			code: 'c',
			code_verifier: 'v',
			redirect_uri: 'https://app.example/cb/'
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ access_token: 't', refresh_token: 'r', expires_in: 28800 });
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		expect(res.headers.get('Set-Cookie')).toBeNull();
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const [target, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
		expect(target).toBe('https://github.com/login/oauth/access_token');
		expect(new Headers(init.headers).get('accept')).toBe('application/json');
		expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
			grant_type: 'authorization_code',
			code: 'c',
			code_verifier: 'v',
			redirect_uri: 'https://app.example/cb/',
			client_id: 'id',
			client_secret: 'shh'
		});
	});

	it('refreshes with the refresh token and the secret', async () => {
		const upstream = vi.fn(async () => new Response('{"access_token":"t2"}'));
		vi.stubGlobal('fetch', upstream);
		const res = await post('/oauth/github/refresh', { refresh_token: 'r' });
		expect(res.status).toBe(200);
		const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
		expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
			grant_type: 'refresh_token',
			refresh_token: 'r',
			client_id: 'id',
			client_secret: 'shh'
		});
	});

	it('passes GitHub errors back as they came', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"error":"bad_verification_code"}', { status: 200 }))
		);
		const res = await post('/oauth/github/token', { code: 'old' });
		expect(await res.json()).toEqual({ error: 'bad_verification_code' });
	});

	it('refuses requests without what GitHub needs', async () => {
		const upstream = vi.fn();
		vi.stubGlobal('fetch', upstream);
		expect((await post('/oauth/github/token', { code_verifier: 'v' })).status).toBe(400);
		expect((await post('/oauth/github/refresh', {})).status).toBe(400);
		expect((await call('/oauth/github/token', { method: 'POST', body: 'code=c' })).status).toBe(
			400
		);
		expect(
			(await call('/oauth/github/token', { method: 'POST', body: 'x'.repeat(20_000) })).status
		).toBe(413);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('says which secret is missing, never its value', async () => {
		const res = await post(
			'/oauth/github/token',
			{ code: 'c' },
			{ ...env, GITHUB_CLIENT_SECRET: '' }
		);
		expect(res.status).toBe(501);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		const text = await res.text();
		expect(text).toBe(
			'github sign-in is not configured on this worker (missing at runtime: GITHUB_CLIENT_SECRET)'
		);
		const neither = await post(
			'/oauth/github/refresh',
			{ refresh_token: 'r' },
			{
				ALLOWED_ORIGINS: ORIGIN
			}
		);
		expect(await neither.text()).toContain('GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET');
	});

	it('reports when GitHub cannot be reached', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network');
			})
		);
		const res = await post('/oauth/github/token', { code: 'c' });
		expect(res.status).toBe(502);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
	});
});
