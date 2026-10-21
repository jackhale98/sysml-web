import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

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
			paths: {
				// Set BASE_PATH=/sysml-web when deploying to a GitHub Pages project site.
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		})
	],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts']
	}
});
