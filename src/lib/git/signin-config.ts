/**
 * This build's "Sign in with GitHub" settings (see src/env.ts). `null` when
 * the build has none: then people connect with an access token, as before.
 */
import { resolve } from '$app/paths';
import {
	PUBLIC_GITHUB_APP_SLUG,
	PUBLIC_GITHUB_CLIENT_ID,
	PUBLIC_SYNC_WORKER
} from '$app/env/public';
import { signInConfig } from './oauth.ts';

export const SIGN_IN = signInConfig({
	clientId: PUBLIC_GITHUB_CLIENT_ID,
	appSlug: PUBLIC_GITHUB_APP_SLUG,
	worker: PUBLIC_SYNC_WORKER
});

/** The callback page GitHub sends people back to (registered with the GitHub App). */
export function redirectUri(): string {
	return `${location.origin}${basePath()}/auth/callback/`;
}

/** The site's base path without a trailing slash: '' or e.g. '/sysml-web'. */
export function basePath(): string {
	return resolve('/').replace(/\/$/, '');
}

/** The page now (path, query and fragment), to come back to after GitHub. */
export function here(): string {
	return `${location.pathname}${location.search}${location.hash}`;
}
