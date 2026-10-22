import { describe, expect, it } from 'vitest';
import {
	SNAPSHOT_CACHE,
	cacheNames,
	earlierEngineCaches,
	planCaches,
	routeRequest,
	staleCaches,
	type CachePlan
} from './caching.ts';

const manifest = {
	immutable: ['_app/immutable/entry/app.abc.js', '_app/immutable/assets/inter.def.woff2'],
	assets: [
		'.nojekyll',
		'favicon.svg',
		'manifest.webmanifest',
		'toolkit/LICENSE',
		'toolkit/sysmlv2.d.ts',
		'toolkit/sysmlv2.js',
		'toolkit/sysmlv2_bg.wasm',
		'toolkit/stdlib/sysml-library.json.gz',
		'toolkit/stdlib/sysml-library.libcache.gz',
		'toolkit/stdlib/sysml-library.prepared.gz'
	],
	prerendered: ['', 'projects', 'p/demo', 'auth/callback/']
};

describe('planCaches', () => {
	it('precaches the shell and leaves the engine for first use', () => {
		const plan = planCaches({ base: '/sysml-web/', ...manifest });
		expect(plan.base).toBe('/sysml-web');
		expect(plan.pages).toEqual([
			'/sysml-web/',
			'/sysml-web/projects',
			'/sysml-web/p/demo',
			'/sysml-web/auth/callback/'
		]);
		expect(plan.fallback).toBe('/sysml-web/404.html');
		expect(plan.shell).toEqual([
			'/sysml-web/_app/immutable/entry/app.abc.js',
			'/sysml-web/_app/immutable/assets/inter.def.woff2',
			'/sysml-web/favicon.svg',
			'/sysml-web/manifest.webmanifest'
		]);
		expect(plan.engine).toEqual([
			'/sysml-web/toolkit/LICENSE',
			// The toolkit's snapshots are left to its worker (10 MB is not for every visitor).
			'/sysml-web/toolkit/sysmlv2.js',
			'/sysml-web/toolkit/sysmlv2_bg.wasm',
			'/sysml-web/toolkit/stdlib/sysml-library.json.gz'
		]);
		expect(plan.engineStamp).toBe('/sysml-web/toolkit/stdlib/manifest.json');
	});

	it('works at the site root', () => {
		const plan = planCaches({ base: '/', ...manifest });
		expect(plan.base).toBe('');
		expect(plan.pages).toEqual(['/', '/projects', '/p/demo', '/auth/callback/']);
		expect(plan.fallback).toBe('/404.html');
		expect(plan.engine).toContain('/toolkit/sysmlv2_bg.wasm');
	});
});

describe('cache names', () => {
	const current = cacheNames('123');

	it('include the build version', () => {
		expect(current).toEqual({ shell: 'sysml-web-shell-123', engine: 'sysml-web-engine-123' });
	});

	it('delete only this app’s caches from other builds', () => {
		const keys = [
			'sysml-web-shell-100',
			'sysml-web-engine-100',
			'other-app',
			SNAPSHOT_CACHE,
			...Object.values(current)
		];
		expect(staleCaches(keys, current)).toEqual(['sysml-web-shell-100', 'sysml-web-engine-100']);
		expect(earlierEngineCaches(keys, current)).toEqual(['sysml-web-engine-100']);
	});
});

describe('routeRequest', () => {
	const origin = 'https://example.github.io';
	const plans: [string, CachePlan][] = [
		['/sysml-web', planCaches({ base: '/sysml-web', ...manifest })],
		['', planCaches({ base: '', ...manifest })]
	];

	for (const [base, plan] of plans) {
		const get = (path: string, mode = 'cors', extra: object = {}) =>
			routeRequest({ url: origin + path, method: 'GET', mode, ...extra }, origin, plan);
		const navigate = (path: string) => get(path, 'navigate');

		describe(`with base '${base}'`, () => {
			it('serves prerendered pages from the precache', () => {
				expect(navigate(`${base}/`)).toEqual({ strategy: 'page', key: `${base}/` });
				expect(navigate(`${base}/?from=home`)).toEqual({ strategy: 'page', key: `${base}/` });
				expect(navigate(`${base}/projects`)).toEqual({
					strategy: 'page',
					key: `${base}/projects`
				});
				expect(navigate(`${base}/projects/`)).toEqual({
					strategy: 'page',
					key: `${base}/projects`
				});
				expect(navigate(`${base}/projects.html`)).toEqual({
					strategy: 'page',
					key: `${base}/projects`
				});
				expect(navigate(`${base}/p/demo?view=Requirements`)).toEqual({
					strategy: 'page',
					key: `${base}/p/demo`
				});
				expect(navigate(`${base}/index.html`)).toEqual({ strategy: 'page', key: `${base}/` });
			});

			it('serves the sign-in callback (a page kept with its trailing slash) in the installed app', () => {
				const callback = { strategy: 'page', key: `${base}/auth/callback/` };
				expect(navigate(`${base}/auth/callback/?code=c&state=s`)).toEqual(callback);
				expect(navigate(`${base}/auth/callback`)).toEqual(callback);
				expect(navigate(`${base}/auth/callback/index.html`)).toEqual(callback);
			});

			it('opens other routes, such as stored projects, from the SPA fallback', () => {
				const fallback = { strategy: 'page', key: `${base}/404.html` };
				expect(navigate(`${base}/p/test-bench`)).toEqual(fallback);
				expect(navigate(`${base}/p/test-bench/`)).toEqual(fallback);
				expect(navigate(`${base}/404.html`)).toEqual(fallback);
			});

			it('serves the shell cache-first', () => {
				expect(get(`${base}/_app/immutable/entry/app.abc.js`)).toEqual({
					strategy: 'shell',
					key: `${base}/_app/immutable/entry/app.abc.js`
				});
				expect(get(`${base}/manifest.webmanifest`).strategy).toBe('shell');
			});

			it('caches the engine on use', () => {
				expect(get(`${base}/toolkit/sysmlv2_bg.wasm`)).toEqual({
					strategy: 'engine',
					key: `${base}/toolkit/sysmlv2_bg.wasm`
				});
				expect(navigate(`${base}/toolkit/LICENSE`).strategy).toBe('engine');
			});

			it('leaves everything else to the network', () => {
				expect(get(`${base}/_app/version.json`)).toEqual({ strategy: 'network' });
				expect(get(`${base}/toolkit/sysmlv2.d.ts`)).toEqual({ strategy: 'network' });
				expect(get(`${base}/toolkit/stdlib/sysml-library.prepared.gz`)).toEqual({
					strategy: 'network'
				});
				expect(get(`${base}/service-worker.js`)).toEqual({ strategy: 'network' });
				expect(navigate(`${base}/robots.txt`)).toEqual({ strategy: 'network' });
				expect(
					routeRequest(
						{ url: `${origin}${base}/p/demo`, method: 'POST', mode: 'navigate' },
						origin,
						plan
					)
				).toEqual({ strategy: 'network' });
				expect(get(`${base}/toolkit/sysmlv2_bg.wasm`, 'cors', { range: true })).toEqual({
					strategy: 'network'
				});
			});
		});
	}

	it('never caches other origins, such as the GitHub API', () => {
		const plan = plans[0]![1];
		for (const url of [
			'https://api.github.com/user/repos',
			'https://avatars.githubusercontent.com/u/1',
			'https://other.example/sysml-web/toolkit/sysmlv2_bg.wasm'
		]) {
			expect(routeRequest({ url, method: 'GET', mode: 'cors' }, origin, plan)).toEqual({
				strategy: 'network'
			});
		}
	});

	it('ignores paths outside the base path', () => {
		const plan = plans[0]![1];
		const route = (path: string) =>
			routeRequest({ url: origin + path, method: 'GET', mode: 'navigate' }, origin, plan);
		expect(route('/another-site/')).toEqual({ strategy: 'network' });
		expect(route('/sysml-webby/p/x')).toEqual({ strategy: 'network' });
		expect(route('/sysml-web')).toEqual({ strategy: 'page', key: '/sysml-web/' });
	});
});
