/**
 * Keeping Tessera on a phone's Home Screen, opening it where the work is,
 * switching projects without losing track of changes, and several GitHub
 * accounts, each project using its own. Phone-sized throughout; GitHub is
 * answered by the test.
 *
 * INSTALL_SHOTS=<dir> also saves light and dark screenshots of the guide,
 * the switch dialog and the accounts list there.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { analyze } from './axe';

const IPHONE_SAFARI =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)
	).toEqual([]);
}

/** Light and dark screenshots, when asked for (INSTALL_SHOTS). */
async function shoot(page: Page, name: string) {
	const dir = process.env.INSTALL_SHOTS;
	if (!dir) return;
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.waitForTimeout(350);
		await page.screenshot({ path: `${dir}/${name}-${scheme}.png` });
	}
	await page.emulateMedia({ colorScheme: 'light' });
}

const MODEL = 'package Drone {\n    part def Frame;\n}\n';
const EDITED = 'package Drone {\n    part def Frame;\n    part def Arm;\n}\n';

interface Seed {
	id: string;
	name: string;
	repo?: string;
	account?: string;
	edited?: boolean;
}

function project({ id, name, repo, account, edited }: Seed) {
	const now = new Date().toISOString();
	const path = 'model/Model.sysml';
	return {
		id,
		info: { name },
		files: [{ path, text: edited ? EDITED : MODEL }],
		origin: repo ? 'git' : 'new',
		created: now,
		updated: now,
		...(repo
			? {
					git: {
						provider: 'github',
						owner: repo.split('/')[0],
						repo: repo.split('/')[1],
						branch: 'main',
						defaultBranch: 'main',
						base: 'c1',
						baseTree: 't1',
						files: { [path]: { sha: 's1', text: MODEL } },
						syncedAt: now,
						...(account ? { account } : {})
					}
				}
			: {})
	};
}

/** Projects in this browser's storage, and optionally its GitHub accounts. */
async function seed(page: Page, projects: Seed[], accounts?: unknown) {
	await page.goto('/projects');
	await page.evaluate(
		async ({ projects, accounts }) => {
			if (accounts) localStorage.setItem('sysml-web:github-accounts', JSON.stringify(accounts));
			await new Promise<void>((done, fail) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' });
				open.onsuccess = () => {
					const tx = open.result.transaction('projects', 'readwrite');
					for (const p of projects) tx.objectStore('projects').put(p);
					tx.oncomplete = () => {
						open.result.close();
						done();
					};
					tx.onerror = () => fail(tx.error);
				};
				open.onerror = () => fail(open.error);
			});
		},
		{ projects: projects.map(project), accounts }
	);
}

async function openProject(page: Page, id: string) {
	await page.goto(`/p/${id}`);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const projectMenu = (page: Page, name: string) =>
	page.getByRole('button', { name, exact: true }).click();

test.describe('on an iPhone, in Safari', () => {
	test.use({ userAgent: IPHONE_SAFARI });

	test('the projects page shows how to add it to the Home Screen; dismissing it is remembered', async ({
		page
	}) => {
		await page.goto('/projects');
		const card = page.getByRole('complementary', { name: 'Keep Tessera on your Home Screen' });
		await expect(card).toBeVisible();
		await card.getByRole('button', { name: 'Show me how' }).click();

		const guide = page.getByRole('dialog', { name: 'Add Tessera to your Home Screen' });
		await expect(guide).toBeVisible();
		await expect(guide).toContainText('Tap Share in the bar at the bottom.');
		await expect(guide).toContainText('Scroll down and tap Add to Home Screen.');
		await expect(guide).toContainText('Tap Add at the top right.');
		await expectAccessible(page);
		await shoot(page, 'install-guide');
		await guide.getByRole('button', { name: 'Done' }).click();
		await expect(guide).toBeHidden();

		await card.getByRole('button', { name: 'Not now' }).click();
		await expect(card).toBeHidden();
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
		await expect(card).toBeHidden();

		// Still in Settings, for later.
		await page.getByRole('button', { name: 'Settings' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await settings.getByRole('tab', { name: 'About' }).click();
		await settings.getByRole('button', { name: 'Install app…' }).click();
		await expect(guide).toBeVisible();
	});

	test('the project menu has "Install app"', async ({ page }) => {
		await seed(page, [{ id: 'pump', name: 'Pump station' }]);
		await openProject(page, 'pump');
		await projectMenu(page, 'Pump station');
		await page.getByRole('menuitem', { name: /Install app/ }).click();
		await expect(
			page.getByRole('dialog', { name: 'Add Tessera to your Home Screen' })
		).toContainText('Add to Home Screen');
	});
});

test.describe('installed on an iPhone', () => {
	test.use({ userAgent: IPHONE_SAFARI });
	test.beforeEach(async ({ page }) => {
		// Opened from the Home Screen: Safari says so both ways.
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
			const real = window.matchMedia.bind(window);
			window.matchMedia = (query: string) =>
				query.includes('display-mode: standalone')
					? ({
							matches: true,
							media: query,
							onchange: null,
							addEventListener() {},
							removeEventListener() {},
							addListener() {},
							removeListener() {},
							dispatchEvent: () => false
						} as MediaQueryList)
					: real(query);
		});
	});

	test('no install help, and it opens on your projects, or back in the last project', async ({
		page
	}) => {
		await seed(page, [{ id: 'pump', name: 'Pump station' }]);
		await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
		await expect(page.getByRole('complementary', { name: /Home Screen/ })).toHaveCount(0);

		// Launched with nothing open: the projects page, not the landing page.
		await page.goto('/');
		await expect(page).toHaveURL(/\/projects$/);
		await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();

		// A project was open: launching goes straight back into it.
		await openProject(page, 'pump');
		await projectMenu(page, 'Pump station');
		await expect(page.getByRole('menuitem', { name: /Install app/ })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await page.goto('/');
		await expect(page).toHaveURL(/\/p\/pump$/);
		await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
			timeout: 30_000
		});

		// Back on the projects page by choice: the next launch starts there.
		await projectMenu(page, 'Pump station');
		await page.getByRole('menuitem', { name: 'All projects…' }).click();
		await expect(page).toHaveURL(/\/projects$/);
		await page.goto('/projects?launch');
		await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
		await expect(page).toHaveURL(/\/projects$/);

		await page.getByRole('button', { name: 'Settings' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await settings.getByRole('tab', { name: 'About' }).click();
		await expect(settings).toContainText("You're using Tessera as an installed app.");
	});
});

test('switching away from changes not on GitHub asks first, and each choice does what it says', async ({
	page
}) => {
	await seed(page, [
		{ id: 'drone', name: 'Drone', repo: 'acme/drone', edited: true },
		{ id: 'pump', name: 'Pump station' }
	]);
	// The projects page says which project has changes not on GitHub.
	await page.reload();
	const list = page.getByRole('region', { name: 'In this browser' });
	await expect(list.getByRole('listitem').filter({ hasText: 'Drone' })).toContainText(
		'1 change not on GitHub'
	);
	await expect(list.getByRole('listitem').filter({ hasText: 'Pump station' })).not.toContainText(
		'not on GitHub'
	);

	await openProject(page, 'drone');
	const dialog = page.getByRole('dialog', { name: 'Your changes aren’t on GitHub yet' });
	const switchToPump = async () => {
		await projectMenu(page, 'Drone');
		const group = page.getByRole('group', { name: 'Switch project' });
		await expect(group.getByRole('menuitem', { name: /Pump station/ })).toContainText(
			'This device'
		);
		await group.getByRole('menuitem', { name: /Pump station/ }).click();
		await expect(dialog).toBeVisible();
	};

	// Cancel: stay, with nothing changed.
	await switchToPump();
	await expect(dialog).toContainText('1 change in Drone is kept on this device');
	await expect(dialog).toContainText('acme/drone');
	await expectAccessible(page);
	await shoot(page, 'switch-dialog');
	await dialog.getByRole('button', { name: 'Cancel' }).first().click();
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL(/\/p\/drone$/);

	// Save to GitHub first: the GitHub sheet opens, and we stay.
	await switchToPump();
	await dialog.getByRole('button', { name: 'Save to GitHub first' }).click();
	await expect(dialog).toBeHidden();
	const sheet = page.getByRole('dialog', { name: 'drone' });
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(/\/p\/drone$/);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();

	// All projects asks too.
	await projectMenu(page, 'Drone');
	await page.getByRole('menuitem', { name: 'All projects…' }).click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Leave anyway' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).first().click();
	await expect(page).toHaveURL(/\/p\/drone$/);

	// Switch anyway: the other project opens; the changes stay here.
	await switchToPump();
	await dialog.getByRole('button', { name: 'Switch anyway' }).click();
	await expect(page).toHaveURL(/\/p\/pump$/);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

	// A project kept only in this browser has nothing to warn about.
	await projectMenu(page, 'Pump station');
	const back = page.getByRole('group', { name: 'Switch project' }).getByRole('menuitem', {
		name: /Drone/
	});
	await expect(back).toContainText('1 change not on GitHub');
	await expect(back).toContainText('acme/drone · main');
	await back.click();
	await expect(page).toHaveURL(/\/p\/drone$/);
	await expect(dialog).toHaveCount(0);
});

// --- Several GitHub accounts --------------------------------------------------

const ACCOUNTS = {
	active: 'alice',
	accounts: [
		{
			token: 'tok_alice',
			user: { login: 'alice', name: 'Alice Ng', avatarUrl: '' },
			connectedAt: '2026-10-01T00:00:00.000Z',
			via: 'token'
		},
		{
			token: 'tok_bob',
			user: { login: 'bob', name: null, avatarUrl: '' },
			connectedAt: '2026-10-02T00:00:00.000Z',
			via: 'token'
		}
	]
};

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
	description: null,
	pushed_at: '2026-10-20T00:00:00Z',
	html_url: `https://github.com/${full}`,
	permissions: { push: true, admin: false }
});

/** GitHub: alice's token sees acme/drone, bob's sees bobco/pump. Each request is noted with its token. */
async function fakeGitHub(page: Page) {
	const seen: string[] = [];
	const owns: Record<string, string> = { tok_alice: 'acme/drone', tok_bob: 'bobco/pump' };
	await page.route('https://api.github.com/**', async (route) => {
		if (route.request().method() === 'OPTIONS') return json(route, {}, 204);
		const url = new URL(route.request().url());
		const token = (route.request().headers()['authorization'] ?? '').replace('Bearer ', '');
		seen.push(`${url.pathname} ${token}`);
		const mine = owns[token];
		if (!mine) return json(route, { message: 'Bad credentials' }, 401);
		if (url.pathname === '/user')
			return json(route, { login: token === 'tok_alice' ? 'alice' : 'bob', avatar_url: '' });
		if (url.pathname === '/user/repos') return json(route, [repo(mine)]);
		if (url.pathname === `/repos/${mine}/branches/main`)
			return json(route, { name: 'main', commit: { sha: 'c1', commit: { tree: { sha: 't1' } } } });
		return json(route, { message: 'Not Found' }, 404);
	});
	return seen;
}

test('two accounts: each project uses its own, and the picker browses either', async ({ page }) => {
	const seen = await fakeGitHub(page);
	await seed(
		page,
		[
			{ id: 'drone', name: 'Drone', repo: 'acme/drone', account: 'alice' },
			{ id: 'pump', name: 'Pump station', repo: 'bobco/pump', account: 'bob', edited: true }
		],
		ACCOUNTS
	);
	await page.reload();
	const list = page.getByRole('region', { name: 'In this browser' });
	await expect(list.getByRole('listitem').filter({ hasText: 'Drone' })).toContainText('as @alice');
	await expect(list.getByRole('listitem').filter({ hasText: 'Pump station' })).toContainText(
		'as @bob'
	);

	// The repository picker lists the chosen account's repositories.
	await page.getByRole('button', { name: 'Choose a repository…' }).click();
	const picker = page.getByRole('dialog', { name: 'Open from GitHub' });
	await expect(picker.getByText('drone', { exact: true })).toBeVisible();
	await picker.getByRole('combobox', { name: 'Account' }).selectOption('bob');
	await expect(picker.getByText('pump', { exact: true })).toBeVisible();
	await expect(picker.getByText('drone', { exact: true })).toHaveCount(0);
	expect(seen).toContain('/user/repos tok_alice');
	expect(seen).toContain('/user/repos tok_bob');
	await picker.getByRole('button', { name: 'Close' }).click();

	// Each project asks GitHub with its own account's token.
	await openProject(page, 'drone');
	await expect.poll(() => seen).toContain('/repos/acme/drone/branches/main tok_alice');
	await projectMenu(page, 'Drone');
	await expect(page.getByText('as @alice')).toBeVisible();
	await page
		.getByRole('group', { name: 'Switch project' })
		.getByRole('menuitem', { name: /Pump/ })
		.click();
	await expect(page).toHaveURL(/\/p\/pump$/);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await expect.poll(() => seen).toContain('/repos/bobco/pump/branches/main tok_bob');
	expect(seen.filter((s) => s.includes('acme/drone') && !s.endsWith('tok_alice'))).toEqual([]);
	expect(seen.filter((s) => s.includes('bobco/pump') && !s.endsWith('tok_bob'))).toEqual([]);
});

test('Settings lists the accounts; signing out of one with unsaved projects warns and lists them', async ({
	page
}) => {
	await fakeGitHub(page);
	await seed(
		page,
		[
			{ id: 'drone', name: 'Drone', repo: 'acme/drone', account: 'alice' },
			{ id: 'pump', name: 'Pump station', repo: 'bobco/pump', account: 'bob', edited: true }
		],
		ACCOUNTS
	);
	await page.reload();
	await page.getByRole('button', { name: 'Settings' }).click();
	const settings = page.getByRole('dialog', { name: 'Settings' });
	await settings.getByRole('tab', { name: 'Accounts' }).click();
	const accounts = settings.getByRole('list', { name: 'GitHub accounts' });
	await expect(accounts.getByRole('listitem')).toHaveCount(2);
	await expect(accounts.getByRole('listitem').first()).toContainText('@alice');
	await expect(accounts.getByRole('listitem').first()).toContainText('Default');
	await expect(settings.getByRole('button', { name: 'Add another account' })).toBeVisible();
	await expectAccessible(page);
	await shoot(page, 'accounts');

	// Adding another: GitHub picks whoever is signed in there, said plainly.
	await settings.getByRole('button', { name: 'Add another account' }).click();
	await expect(settings).toContainText('sign out of GitHub in the browser first');
	await settings.getByRole('button', { name: 'Cancel' }).click();

	// Signing out of bob, whose project has a change not on GitHub, warns first.
	await settings.getByRole('button', { name: 'Sign out @bob' }).click();
	const warning = settings.getByRole('alert');
	await expect(warning).toContainText('A project has changes not on GitHub that @bob would save');
	await expect(warning.getByRole('link', { name: 'Pump station' })).toBeVisible();
	await expect(warning).toContainText('1 change not on GitHub');
	await expectAccessible(page);
	await shoot(page, 'accounts-sign-out');
	await warning.getByRole('button', { name: 'Sign out anyway' }).click();
	await expect(accounts.getByRole('listitem')).toHaveCount(1);
	await expect(accounts).toContainText('@alice');

	// Alice has nothing waiting: she signs out at once.
	await settings.getByRole('button', { name: 'Sign out @alice' }).click();
	await expect(
		settings.getByRole('button', { name: /Sign in with GitHub|Connect GitHub/ })
	).toBeVisible();
});
