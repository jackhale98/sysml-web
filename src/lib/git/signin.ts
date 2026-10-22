/**
 * Leaving for GitHub from a page: to sign in, or to choose which
 * repositories SysML Web may use. Both come back to the page they left
 * (through /auth/callback/), which then reopens what the person was doing.
 * The same tab is used throughout, so this also works on phones and in the
 * installed app.
 */
import { pwa } from '#lib/offline/pwa.svelte.ts';
import { installUrl, rememberInstall, startSignIn, type Resume } from './oauth.ts';
import { here, redirectUri, SIGN_IN } from './signin-config.ts';

export { SIGN_IN };

/**
 * Go to GitHub to sign in, then come back here and reopen `resume`. False
 * when staying here (the person chose to keep unsaved work open).
 */
export async function signInWithGitHub(resume?: Resume): Promise<boolean> {
	if (!SIGN_IN) return false;
	if (!(await pwa.beforeLeaving('sign-in'))) return false;
	const url = await startSignIn(SIGN_IN, { redirectUri: redirectUri(), returnTo: here(), resume });
	location.assign(url);
	return true;
}

/** GitHub's page for choosing which repositories SysML Web may use. */
export function chooseRepositoriesUrl(): string | null {
	return SIGN_IN ? installUrl(SIGN_IN) : null;
}

/** Go to GitHub to choose repositories, then come back here and reopen `resume`. */
export async function chooseRepositories(resume?: Resume): Promise<void> {
	const url = chooseRepositoriesUrl();
	if (!url) return;
	if (!(await pwa.beforeLeaving('sign-in'))) return;
	rememberInstall(here(), resume);
	location.assign(url);
}
