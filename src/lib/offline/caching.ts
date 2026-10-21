/**
 * What the service worker keeps for offline use, and how it answers each
 * request. Pure functions (no DOM, no worker globals) so they can be unit
 * tested and shared with `src/service-worker`.
 *
 * - The app shell (prerendered pages, the `404.html` SPA fallback, hashed
 *   JS/CSS/fonts, icons and the manifest) is precached when the worker
 *   installs, and served cache-first.
 * - The engine (`engine/*`, ~10 MB of WebAssembly) is not precached, so a
 *   phone visiting the landing page doesn't download it: it is cached on first
 *   use (cache-first afterwards), and the page asks the worker to fill in any
 *   missing engine files once the engine has started.
 * - Anything else (other origins such as api.github.com, non-GET requests,
 *   unknown files) goes to the network and is never cached.
 */

/** Every cache this app creates starts with this; others are left alone. */
export const CACHE_PREFIX = 'sysml-web-';

export interface CacheNames {
	shell: string;
	engine: string;
}

/** Cache names for a build: a new build gets new caches, and old ones are deleted. */
export function cacheNames(version: string): CacheNames {
	return { shell: `${CACHE_PREFIX}shell-${version}`, engine: `${CACHE_PREFIX}engine-${version}` };
}

/** Caches from other builds of this app, to delete once a new worker activates. */
export function staleCaches(keys: string[], current: CacheNames): string[] {
	const keep = new Set([current.shell, current.engine]);
	return keys.filter((key) => key.startsWith(CACHE_PREFIX) && !keep.has(key));
}

/** Engine caches of earlier builds, whose files may be reused when the engine is unchanged. */
export function earlierEngineCaches(keys: string[], current: CacheNames): string[] {
	return keys.filter((key) => key.startsWith(`${CACHE_PREFIX}engine-`) && key !== current.engine);
}

export interface CachePlan {
	/** The base path: '' or e.g. '/sysml-web' (no trailing slash). */
	base: string;
	/** Prerendered pages, as paths (`/sysml-web/`, `/sysml-web/projects`, …). */
	pages: string[];
	/** The SPA fallback page that boots the router for any other route. */
	fallback: string;
	/** Other files precached at install: hashed build output, icons, manifest. */
	shell: string[];
	/** Engine files: cached on first use, never at install. */
	engine: string[];
	/** The engine's build stamp; when it is unchanged, cached engine files carry over. */
	engineStamp: string;
}

const ENGINE_DIR = 'engine/';

/** Static files not worth keeping offline (type declarations, host markers). */
function skipped(path: string): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1);
	return name.startsWith('.') || name.endsWith('.d.ts');
}

/**
 * Work out what to cache from the build manifest (paths relative to the base
 * path, as `$app/manifest` gives them).
 */
export function planCaches(input: {
	base: string;
	immutable: string[];
	assets: string[];
	prerendered: string[];
}): CachePlan {
	const base = input.base.replace(/\/$/, '');
	const at = (path: string) => `${base}/${path}`;
	const statics = input.assets.filter((path) => !skipped(path));
	return {
		base,
		pages: input.prerendered.map(at),
		fallback: at('404.html'),
		shell: [
			...input.immutable.map(at),
			...statics.filter((path) => !path.startsWith(ENGINE_DIR)).map(at)
		],
		engine: statics.filter((path) => path.startsWith(ENGINE_DIR)).map(at),
		engineStamp: at(`${ENGINE_DIR}build.json`)
	};
}

export type Route =
	/** Leave it to the browser: not cached, not touched. */
	| { strategy: 'network' }
	/** A precached file: from the cache, else the network. */
	| { strategy: 'shell'; key: string }
	/** An engine file: from the cache, else the network (and then cached). */
	| { strategy: 'engine'; key: string }
	/** A page: the precached copy of `key` (a prerendered page or the SPA fallback). */
	| { strategy: 'page'; key: string };

export interface RequestFacts {
	url: string;
	method: string;
	/** `Request.mode`: 'navigate' for page loads. */
	mode: string;
	/** Whether it asks for part of a file (`Range` header); those go to the network. */
	range?: boolean;
}

/** The page path for a navigation: `/projects/` and `/projects.html` are `/projects`. */
function pagePath(pathname: string, base: string): string {
	let path = pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
	if (path.length > base.length + 1) path = path.replace(/\/+$/, '');
	return path === base ? `${base}/` : path;
}

/** How the service worker should answer a request. */
export function routeRequest(request: RequestFacts, origin: string, plan: CachePlan): Route {
	const network: Route = { strategy: 'network' };
	if (request.method !== 'GET' || request.range) return network;

	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return network;
	}
	// Other origins (GitHub's API, avatars, …) are never cached.
	if (url.origin !== origin) return network;
	const { pathname } = url;
	if (pathname !== plan.base && !pathname.startsWith(`${plan.base}/`)) return network;

	if (plan.engine.includes(pathname)) return { strategy: 'engine', key: pathname };
	if (plan.shell.includes(pathname)) return { strategy: 'shell', key: pathname };

	if (request.mode === 'navigate') {
		if (pathname === plan.fallback) return { strategy: 'page', key: plan.fallback };
		const page = pagePath(pathname, plan.base);
		if (plan.pages.includes(page)) return { strategy: 'page', key: page };
		// A file that isn't an app route (a download, `robots.txt`, …).
		if (/\.[a-z0-9]+$/i.test(pathname)) return network;
		// Any other route (a stored project's `/p/<id>`) boots from the SPA fallback.
		return { strategy: 'page', key: plan.fallback };
	}
	return network;
}
