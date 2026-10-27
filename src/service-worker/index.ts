/**
 * Keeps Tessera working offline once visited. What is cached and how each
 * request is answered is decided in `#lib/offline/caching.ts`; this file only
 * talks to the Cache API. Registered by `#lib/offline/pwa.svelte.ts` after the
 * page has loaded, so it never competes with the first paint.
 */
import { self } from '$app/service-worker';
import { resolve } from '$app/paths';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import {
	cacheNames,
	earlierEngineCaches,
	planCaches,
	routeRequest,
	staleCaches,
	type Route
} from '#lib/offline/caching.ts';

const names = cacheNames(version);
const plan = planCaches({
	base: resolve('/'),
	immutable: immutable.map((file) => file.path),
	assets: assets.map((file) => file.path),
	prerendered: prerendered.map((page) => page.path)
});

/** Pages and unhashed files are fetched past the HTTP cache, so they match this build. */
const fresh = (path: string) => new Request(path, { cache: 'no-cache' });

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const shell = await caches.open(names.shell);
			const hashed = new Set(immutable.map((file) => `${plan.base}/${file.path}`));
			await Promise.all([
				shell.addAll([
					...plan.pages.map(fresh),
					...plan.shell.map((path) => (hashed.has(path) ? path : fresh(path)))
				]),
				storeFallback(shell)
			]);
			await carryOverEngine();
		})()
	);
	// No skipWaiting here: an open tab keeps its version until the person
	// chooses "Reload" (or every tab is closed).
});

/**
 * The SPA fallback page. Hosts serve it with status 404 (that's how deep links
 * reach it), so it is stored as a normal page.
 */
async function storeFallback(shell: Cache) {
	const response = await fetch(fresh(plan.fallback));
	if (!response.ok && response.status !== 404)
		throw new Error(`${plan.fallback}: ${response.status}`);
	const page = new Response(await response.blob(), { status: 200, headers: response.headers });
	await shell.put(plan.fallback, page);
}

/** Reuse the engine cached by an earlier build when the engine itself hasn't changed. */
async function carryOverEngine() {
	const earlier = earlierEngineCaches(await caches.keys(), names);
	if (!earlier.length) return;
	const current = await fetch(fresh(plan.engineStamp))
		.then((response) => (response.ok ? response.text() : null))
		.catch(() => null);
	if (current === null) return;
	for (const name of earlier) {
		const old = await caches.open(name);
		if ((await (await old.match(plan.engineStamp))?.text()) !== current) continue;
		const engine = await caches.open(names.engine);
		for (const request of await old.keys()) {
			const response = await old.match(request);
			if (response) await engine.put(request, response);
		}
		return;
	}
}

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			await Promise.all(staleCaches(await caches.keys(), names).map((key) => caches.delete(key)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const route = routeRequest(
		{
			url: request.url,
			method: request.method,
			mode: request.mode,
			range: request.headers.has('range')
		},
		self.location.origin,
		plan
	);
	if (route.strategy === 'network') return;
	event.respondWith(answer(event, route));
});

async function answer(event: FetchEvent, route: Exclude<Route, { strategy: 'network' }>) {
	const { request } = event;
	if (route.strategy === 'engine') {
		const cache = await caches.open(names.engine);
		const cached = await cache.match(route.key);
		if (cached) return cached;
		const response = await fetch(request);
		// Stored alongside, so the page can compile the WebAssembly while it streams in.
		if (response.status === 200) event.waitUntil(cache.put(route.key, response.clone()));
		return response;
	}

	const cached = await caches.match(route.key, { cacheName: names.shell });
	if (cached) return cached;
	try {
		return await fetch(request);
	} catch (error) {
		// Offline and not cached (storage was cleared): any page can still boot from the fallback.
		const fallback =
			route.strategy === 'page'
				? await caches.match(plan.fallback, { cacheName: names.shell })
				: null;
		if (fallback) return fallback;
		throw error;
	}
}

/** Fetch the engine files that aren't cached yet (asked for once the engine has started). */
async function warmEngine() {
	const cache = await caches.open(names.engine);
	for (const path of plan.engine) {
		if (await cache.match(path)) continue;
		try {
			const response = await fetch(path);
			if (response.status === 200) await cache.put(path, response);
		} catch {
			return; // Offline: try again next time.
		}
	}
}

self.addEventListener('message', (event) => {
	const type = (event.data as { type?: string } | null)?.type;
	if (type === 'skip-waiting') void self.skipWaiting();
	else if (type === 'warm-engine') event.waitUntil(warmEngine());
});
