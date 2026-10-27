/**
 * "Sign in with GitHub", end to end, with GitHub and the sign-in worker
 * answered by the test. The e2e build has sign-in set up (see SIGN_IN_TEST
 * in playwright.config.ts); `PW_SIGN_IN=off` builds without it, which is how
 * the site behaves until it is configured.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { SIGN_IN_TEST } from '../../playwright.config.ts';
import { analyze } from './axe';

const WORKER = SIGN_IN_TEST?.PUBLIC_SYNC_WORKER ?? 'https://sync.example.test';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)
	).toEqual([]);
}

const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({
		status,
		headers: {
			'access-control-allow-origin': '*',
			'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});

const repo = (full: string) => ({
	name: full.split('/')[1],
	full_name: full,
	owner: { login: full.split('/')[0] },
	private: true,
	default_branch: 'main',
	description: 'Pump station model',
	pushed_at: '2026-10-20T00:00:00Z',
	html_url: `https://github.com/${full}`,
	permissions: { push: true, admin: false }
});

/** GitHub (its sign-in page and API) and the worker, as far as signing in needs them. */
async function fakeGitHub(page: Page, options: { installed: boolean }) {
	const seen = { authorize: [] as URL[], worker: [] as Record<string, string>[] };
	let installed = options.installed;

	// GitHub's sign-in page: the person approves, and GitHub sends them back with a code.
	await page.route('https://github.com/login/oauth/authorize**', async (route) => {
		const url = new URL(route.request().url());
		seen.authorize.push(url);
		const back = new URL(url.searchParams.get('redirect_uri')!);
		back.searchParams.set('code', 'the-code');
		back.searchParams.set('state', url.searchParams.get('state')!);
		await route.fulfill({ status: 302, headers: { location: back.toString() } });
	});
	// Choosing repositories: GitHub installs the app and returns to the callback page.
	await page.route('https://github.com/apps/**', async (route) => {
		installed = true;
		const back = new URL('/auth/callback/', page.url());
		back.search = 'code=from-install&installation_id=7&setup_action=install';
		await route.fulfill({ status: 302, headers: { location: back.toString() } });
	});
	await page.route(`${WORKER}/**`, async (route) => {
		if (route.request().method() === 'OPTIONS') return json(route, {}, 204);
		seen.worker.push({
			path: new URL(route.request().url()).pathname,
			...(route.request().postDataJSON() as Record<string, string>)
		});
		return json(route, {
			access_token: 'ghu_e2e',
			refresh_token: 'ghr_e2e',
			expires_in: 28800,
			refresh_token_expires_in: 15897600,
			token_type: 'bearer',
			scope: ''
		});
	});
	await page.route('https://api.github.com/**', async (route) => {
		if (route.request().method() === 'OPTIONS') return json(route, {}, 204);
		const url = new URL(route.request().url());
		if (route.request().headers()['authorization'] !== 'Bearer ghu_e2e')
			return json(route, { message: 'Bad credentials' }, 401);
		if (url.pathname === '/user')
			return json(route, { login: 'octo', name: 'Octo Cat', avatar_url: '' });
		if (url.pathname === '/user/installations')
			return json(route, {
				total_count: installed ? 1 : 0,
				installations: installed ? [{ id: 7 }] : []
			});
		if (url.pathname === '/user/installations/7/repositories')
			return json(route, { total_count: 1, repositories: [repo('octo/pump-station')] });
		if (url.pathname === '/user/repos') return json(route, { message: 'Not for app tokens' }, 403);
		return json(route, { message: 'Not Found' }, 404);
	});
	return seen;
}

async function openConnect(page: Page) {
	await page.goto('/projects');
	await page.getByRole('button', { name: 'Connect GitHub…' }).click();
	return page.getByRole('dialog', { name: 'Open from GitHub' });
}

test.describe('without sign-in set up', () => {
	test.skip(!!SIGN_IN_TEST, 'this build has sign-in set up (PW_SIGN_IN=off builds without)');

	test('people connect with an access token, as before', async ({ page }) => {
		const dialog = await openConnect(page);
		await expect(dialog.getByLabel('Paste the token here')).toBeVisible();
		await expect(dialog.getByRole('link', { name: /Create a token on GitHub/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toHaveCount(0);
		await expect(page.getByText('Use an access token instead')).toHaveCount(0);
	});
});

test.describe('with sign-in set up', () => {
	test.skip(!SIGN_IN_TEST, 'this build has no sign-in (PW_SIGN_IN=off)');

	test('sign in with GitHub and come back to your repositories', async ({ page, baseURL }) => {
		const seen = await fakeGitHub(page, { installed: true });
		const dialog = await openConnect(page);

		// Signing in comes first; the access token is still there, quieter.
		const signIn = dialog.getByRole('button', { name: 'Sign in with GitHub' });
		await expect(signIn).toBeVisible();
		await expect(dialog.getByLabel('Paste the token here')).toBeHidden();
		await expect(dialog.getByText('Use an access token instead')).toBeVisible();
		await expect(dialog.getByText(/worker|OAuth|PKCE/i)).toHaveCount(0);
		await expectAccessible(page);

		await signIn.click();
		// Back on the page it started from, with the dialog open again and signed in.
		await expect(page).toHaveURL(/\/projects$/, { timeout: 15_000 });
		const reopened = page.getByRole('dialog', { name: 'Open from GitHub' });
		await expect(reopened.getByText('octo/')).toBeVisible({ timeout: 15_000 });
		await expect(reopened.getByText('pump-station')).toBeVisible();
		await expect(reopened.getByText('Signed in as')).toContainText('octo');
		await expect(
			reopened.getByRole('link', { name: /Choose repositories on GitHub/ })
		).toBeVisible();

		// GitHub was asked properly, and the worker got the code with its verifier.
		expect(seen.authorize).toHaveLength(1);
		const authorize = seen.authorize[0]!;
		expect(authorize.searchParams.get('client_id')).toBe(SIGN_IN_TEST!.PUBLIC_GITHUB_CLIENT_ID);
		expect(authorize.searchParams.get('redirect_uri')).toBe(`${baseURL}/auth/callback/`);
		expect(authorize.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
		expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
		expect(seen.worker).toEqual([
			{
				path: '/oauth/github/token',
				code: 'the-code',
				code_verifier: expect.stringMatching(/^[\w-]{43,128}$/),
				redirect_uri: `${baseURL}/auth/callback/`
			}
		]);

		// Kept in this browser, with what it needs to stay signed in.
		const kept = await page.evaluate(() =>
			JSON.parse(localStorage.getItem('sysml-web:github-accounts')!)
		);
		expect(kept.active).toBe('octo');
		const stored = kept.accounts[0];
		expect(stored).toMatchObject({
			token: 'ghu_e2e',
			refreshToken: 'ghr_e2e',
			via: 'app',
			user: { login: 'octo' }
		});
		expect(stored.expiresAt).toBeGreaterThan(Date.now() + 7 * 3_600_000);

		// Settings shows the account, and signing out brings the button back.
		await reopened.getByRole('button', { name: 'Cancel' }).click();
		await page.getByRole('button', { name: 'Settings' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await settings.getByRole('tab', { name: 'Accounts' }).click();
		await expect(settings.getByText('Signed in', { exact: true })).toBeVisible();
		await settings.getByRole('button', { name: 'Sign out' }).click();
		await expect(settings.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
	});

	test('with nothing chosen yet, choose repositories on GitHub and come back', async ({ page }) => {
		await fakeGitHub(page, { installed: false });
		const dialog = await openConnect(page);
		await dialog.getByRole('button', { name: 'Sign in with GitHub' }).click();

		const reopened = page.getByRole('dialog', { name: 'Open from GitHub' });
		await expect(reopened.getByText('Choose the repositories Tessera can use.')).toBeVisible({
			timeout: 15_000
		});
		const choose = reopened.getByRole('link', { name: /Choose repositories on GitHub/ });
		await expect(choose).toHaveAttribute(
			'href',
			`https://github.com/apps/${SIGN_IN_TEST!.PUBLIC_GITHUB_APP_SLUG}/installations/new`
		);
		await choose.click();

		// GitHub's own return (no state of ours) brings the list back, now with the repository.
		await expect(page).toHaveURL(/\/projects$/, { timeout: 15_000 });
		await expect(
			page.getByRole('dialog', { name: 'Open from GitHub' }).getByText('pump-station')
		).toBeVisible({ timeout: 15_000 });
	});

	test('the access token is still there for those who prefer it', async ({ page }) => {
		const dialog = await openConnect(page);
		await dialog.getByText('Use an access token instead').click();
		await expect(dialog.getByLabel('Paste the token here')).toBeVisible();
		await expect(dialog.getByRole('link', { name: /Create a token on GitHub/ })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Connect GitHub' })).toBeDisabled();
	});

	test('a sign-in that doesn’t match the one started here is stopped', async ({ page }) => {
		const seen = await fakeGitHub(page, { installed: true });
		await page.goto('/auth/callback/?code=stolen&state=forged');
		await expect(page.getByRole('heading', { name: 'Couldn’t sign you in' })).toBeVisible();
		await expect(page.getByRole('alert')).toContainText(/expired or was started somewhere else/);
		await expect(page.getByRole('link', { name: 'Back to Tessera' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
		expect(seen.worker).toEqual([]);
		await expectAccessible(page);
	});

	test.describe('on a phone', () => {
		test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

		test('signing in from a project comes back to its GitHub sheet', async ({ page }) => {
			test.slow();
			await fakeGitHub(page, { installed: true });
			await page.goto('/p/demo');
			await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
				timeout: 30_000
			});
			await page
				.getByRole('button', { name: /Drone UAV/ })
				.first()
				.click();
			await page.getByRole('menuitem', { name: /Save to GitHub/ }).click();
			const sheet = page.getByRole('dialog', { name: 'Save to GitHub' });
			await sheet.getByRole('button', { name: 'Sign in with GitHub' }).click();

			await expect(page).toHaveURL(/\/p\/demo$/, { timeout: 15_000 });
			const back = page.getByRole('dialog', { name: 'Save to GitHub' });
			await expect(back.getByText('This project is only in this browser')).toBeVisible({
				timeout: 30_000
			});
			await expect(back.getByRole('button', { name: /Choose a repository/ })).toBeEnabled();
			await expect(back.getByRole('button', { name: 'Sign in with GitHub' })).toHaveCount(0);
		});
	});
});
