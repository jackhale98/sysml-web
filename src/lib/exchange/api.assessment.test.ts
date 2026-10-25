/**
 * Assessment (§8 credentials): a Systems Modeling API server's token goes
 * only to that server. The client follows the server's `Link` header from
 * page to page; a page link that points at another host must not carry the
 * token there.
 */
import { describe, expect, it } from 'vitest';
import { SysmlApi } from './api';

describe('the API token', () => {
	// Known gap: the token is sent to whatever host a "next page" Link header names, not only to the server it was given for.
	it.fails('is not sent to another host named by a "next page" link', async () => {
		const sent: { host: string; auth: string | null }[] = [];
		const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			sent.push({ host: url.host, auth: new Headers(init?.headers).get('authorization') });
			if (url.host === 'sysml.example.org')
				return new Response(JSON.stringify([{ '@id': 'p1', name: 'One' }]), {
					headers: {
						'content-type': 'application/json',
						link: '<https://elsewhere.example.net/projects?page=2>; rel="next"'
					}
				});
			return new Response('[]', { headers: { 'content-type': 'application/json' } });
		}) as typeof globalThis.fetch;
		const api = new SysmlApi('https://sysml.example.org', 'secret-token', fetch);
		await api.projects().catch(() => undefined);
		expect(sent[0]).toEqual({ host: 'sysml.example.org', auth: 'Bearer secret-token' });
		expect(sent.filter((s) => s.host !== 'sysml.example.org' && s.auth)).toEqual([]);
	});

	it('is sent to the server it was given for, and is not part of any address', async () => {
		const urls: string[] = [];
		const fetch = (async (input: string | URL | Request) => {
			urls.push(String(input));
			return new Response('[]', { headers: { 'content-type': 'application/json' } });
		}) as typeof globalThis.fetch;
		const api = new SysmlApi('https://sysml.example.org', 'secret-token', fetch);
		await api.projects();
		expect(urls).toEqual(['https://sysml.example.org/projects']);
	});

	it('does not appear in the errors the client reports', async () => {
		const fetch = (async () =>
			new Response('Unauthorized', { status: 401 })) as unknown as typeof globalThis.fetch;
		const api = new SysmlApi('https://sysml.example.org', 'secret-token', fetch);
		const error = await api.projects().catch((e: unknown) => e as Error);
		expect(error).toBeInstanceOf(Error);
		expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain('secret-token');
	});
});
