import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * `vite preview` serves SvelteKit's output, not `build/`, so it has no `404.html`
 * (it renders unknown paths on the fly). Copy the SPA fallback in, so the
 * preview serves it like GitHub Pages does and the service worker can cache it.
 */
function previewFallback(): Plugin {
	return {
		name: 'sysml-web:preview-fallback',
		apply: 'build',
		// After SvelteKit's own post hook, which runs the adapter.
		buildApp: {
			order: 'post',
			async handler() {
				if (existsSync('build/404.html')) {
					await copyFile('build/404.html', '.svelte-kit/output/client/404.html');
				}
			}
		}
	};
}

/** The commit being built (Settings → About), or '' outside a git checkout. */
function commit(): string {
	try {
		return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], {
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
	} catch {
		return process.env.GITHUB_SHA?.slice(0, 10) ?? '';
	}
}

/** The build's date (UTC), or the date `SOURCE_DATE_EPOCH` gives, for a reproducible build. */
function buildDate(): string {
	const epoch = Number(process.env.SOURCE_DATE_EPOCH);
	return new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now())
		.toISOString()
		.slice(0, 10);
}

// SvelteKit 3 reads its configuration from the `sveltekit()` plugin (svelte.config.js is unsupported).
export default defineConfig({
	plugins: [
		sveltekit({
			// SPA mode: unknown paths are served by 404.html, which boots the client router.
			// GitHub Pages serves 404.html for deep links, so they keep working.
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: '404.html',
				precompress: false,
				strict: true
			}),
			// Small stylesheets go inline, saving the first paint a round trip each.
			inlineStyleThreshold: 4096,
			// src/service-worker is registered by #lib/offline/pwa.svelte.ts, which also
			// handles updates (a "new version" notice instead of a surprise reload).
			serviceWorker: { register: false },
			paths: {
				// Set BASE_PATH=/sysml-web when deploying to a GitHub Pages project site.
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		}),
		previewFallback()
	],
	define: {
		__APP_COMMIT__: JSON.stringify(commit()),
		__APP_BUILT__: JSON.stringify(buildDate())
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'worker/src/**/*.test.ts']
	}
});
