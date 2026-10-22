/**
 * Build-time settings. All are optional and public (they end up in the
 * published JavaScript); an unset or empty one reads as `undefined`.
 * See docs/setup-github-sign-in.md.
 */
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => value?.trim() || undefined;

export const variables = defineEnvVars({
	PUBLIC_GITHUB_CLIENT_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'The GitHub App’s client ID, for “Sign in with GitHub”.'
	},
	PUBLIC_GITHUB_APP_SLUG: {
		public: true,
		static: true,
		schema: optional,
		description:
			'The GitHub App’s slug (github.com/apps/<slug>), for “Choose repositories on GitHub”.'
	},
	PUBLIC_SYNC_WORKER: {
		public: true,
		static: true,
		schema: optional,
		description:
			'The URL of the sign-in worker (worker/), which completes GitHub sign-in and refreshes it.'
	}
});
