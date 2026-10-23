/**
 * Assessment (§8 data integrity, Git collaboration and recovery), in the
 * built app: edits surviving a closed tab and a killed browser, a save the
 * browser refuses, two tabs of one project, importing a damaged archive,
 * saving to GitHub after someone else did, and where the GitHub token goes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import { zip } from '../../src/lib/dataio/zip';

test.describe.configure({ timeout: 120_000 });

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

const RIG = 'package Rig {\n    part def Frame;\n}\n';
const SPARES = 'package Spares {\n    part def Bolt;\n}\n';

interface Seed {
	files: Record<string, string>;
	git?: { base: string; token?: string };
}

/** Keep a project `rig` in this browser, as if made earlier (with a GitHub base if asked). */
async function seed(page: Page, { files, git }: Seed) {
	await page.goto('/');
	await page.evaluate(
		async ({ files, git }) => {
			const list = Object.entries(files).map(([path, text]) => ({ path, text }));
			const record = {
				id: 'rig',
				info: { name: 'Rig' },
				files: list,
				origin: git ? 'git' : 'new',
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				...(git
					? {
							git: {
								provider: 'github',
								owner: 'acme',
								repo: 'drone',
								branch: 'main',
								defaultBranch: 'main',
								base: git.base,
								baseTree: 'tree0',
								files: Object.fromEntries(
									list.map((f, i) => [f.path, { sha: `b${i}`, text: f.text }])
								),
								syncedAt: new Date().toISOString()
							}
						}
					: {})
			};
			await new Promise<void>((done, fail) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' });
				open.onsuccess = () => {
					const tx = open.result.transaction('projects', 'readwrite');
					tx.objectStore('projects').put(record);
					tx.oncomplete = () => {
						open.result.close();
						done();
					};
					tx.onerror = () => fail(tx.error);
				};
				open.onerror = () => fail(open.error);
			});
			if (git?.token)
				localStorage.setItem(
					'sysml-web:github',
					JSON.stringify({ token: git.token, user: { login: 'jo' }, connectedAt: '2026-10-20' })
				);
		},
		{ files, git }
	);
}

/** The stored project, as IndexedDB holds it. */
const storedRecord = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<unknown>((done) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onsuccess = () => {
					const get = open.result.transaction('projects').objectStore('projects').get('rig');
					get.onsuccess = () => {
						open.result.close();
						done(get.result);
					};
				};
			})
	);

const storedText = async (page: Page, path: string) =>
	((await storedRecord(page)) as { files: { path: string; text: string }[] }).files.find(
		(f) => f.path === path
	)?.text;

/** Open the project and a file of it as text. */
async function openFile(page: Page, file: string) {
	await page.goto('/p/rig');
	await ready(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.locator('.explorer-pane').getByRole('button', { name: file, exact: true }).click();
	const text = page.getByRole('button', { name: 'Text', exact: true });
	if (await text.isVisible()) await text.click();
	await expect(page.locator('.cm-content')).toBeVisible();
}

/** Type a new line after `line` in the open editor. */
async function typeAfter(page: Page, line: string, text: string) {
	await page.locator('.cm-content').getByText(line, { exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(text);
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
});

test('an edit survives closing the tab straight after typing', async ({ page, context }) => {
	await seed(page, { files: { 'Rig.sysml': RIG } });
	await openFile(page, 'Rig.sysml');
	await typeAfter(page, '    part def Frame;', 'part def Mast;');
	// Closed at once: well within the autosave delay.
	await page.close({ runBeforeUnload: true });
	const again = await context.newPage();
	await again.setViewportSize({ width: 1440, height: 900 });
	await openFile(again, 'Rig.sysml');
	await expect(again.locator('.cm-content')).toContainText('part def Mast;');
});

// eslint-disable-next-line no-empty-pattern -- only the project settings are needed
test('an edit shown as saved survives the browser being killed', async ({}, testInfo) => {
	const dir = mkdtempSync(join(tmpdir(), 'fairtide-crash-'));
	const use = testInfo.project.use;
	const launch = () =>
		chromium.launchPersistentContext(dir, {
			...(use.launchOptions ?? {}),
			baseURL: use.baseURL,
			viewport: { width: 1440, height: 900 }
		});
	try {
		let context = await launch();
		let page = context.pages()[0] ?? (await context.newPage());
		await seed(page, { files: { 'Rig.sysml': RIG } });
		await openFile(page, 'Rig.sysml');
		await typeAfter(page, '    part def Frame;', 'part def Mast;');
		await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
		await expect.poll(() => storedText(page, 'Rig.sysml')).toContain('Mast');
		// Kill every process of this browser: no unload, no flush.
		execFileSync('pkill', ['-KILL', '-f', dir]);
		await context.close().catch(() => undefined);

		context = await launch();
		page = context.pages()[0] ?? (await context.newPage());
		await openFile(page, 'Rig.sysml');
		await expect(page.locator('.cm-content')).toContainText('part def Mast;');
		await context.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a save the browser refuses (storage full) is shown, leaving asks first, and a retry saves', async ({
	page
}) => {
	await page.addInitScript(() => {
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
			if ((window as unknown as { refuse?: boolean }).refuse)
				throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
			return put.apply(this, args as Parameters<typeof put>);
		} as typeof put;
	});
	await seed(page, { files: { 'Rig.sysml': RIG } });
	await openFile(page, 'Rig.sysml');
	await page.evaluate(() => ((window as unknown as { refuse: boolean }).refuse = true));
	await typeAfter(page, '    part def Frame;', 'part def Mast;');
	await expect(page.getByText('Not saved', { exact: true })).toBeVisible({ timeout: 10_000 });

	expect(await storedText(page, 'Rig.sysml')).toBe(RIG);

	// Leaving for all projects asks first, and "Try again" saves once the browser allows it.
	await page.getByRole('button', { name: 'Rig', exact: true }).click();
	await page.getByRole('menuitem', { name: /All projects/ }).click();
	const leave = page.getByTestId('leave-dialog');
	await expect(leave).toContainText('Your latest changes couldn’t be saved');
	await expect(page).toHaveURL(/\/p\/rig/);
	await page.evaluate(() => ((window as unknown as { refuse: boolean }).refuse = false));
	await leave.getByRole('button', { name: 'Try again' }).click();
	await expect(page).toHaveURL(/\/projects/);
	expect(await storedText(page, 'Rig.sysml')).toContain('part def Mast;');
});

// Fixed in this assessment: two tabs of one project each saved the whole project; the later save dropped the other tab's edits without a word.
test('two tabs of one project keep both edits, or say one would be lost', async ({
	page,
	context
}) => {
	await seed(page, { files: { 'Rig.sysml': RIG, 'Spares.sysml': SPARES } });
	const other = await context.newPage();
	await other.setViewportSize({ width: 1440, height: 900 });
	await openFile(page, 'Rig.sysml');
	await openFile(other, 'Spares.sysml');

	await page.bringToFront();
	await typeAfter(page, '    part def Frame;', 'part def Mast;');
	await expect.poll(() => storedText(page, 'Rig.sysml')).toContain('Mast');

	await other.bringToFront();
	await typeAfter(other, '    part def Bolt;', 'part def Nut;');
	// The first tab's edit is kept; the second tab says its own isn't saved, and why.
	const status = other.getByText('Not saved', { exact: true });
	await expect(status).toBeVisible({ timeout: 10_000 });
	await expect(
		other.locator('[role=status][title]').filter({ hasText: 'Not saved' })
	).toHaveAttribute('title', /another tab/);
	expect(await storedText(other, 'Rig.sysml')).toContain('Mast');
	// Reloaded, it shows both what the first tab saved and what it holds now.
	await other.reload();
	await openFile(other, 'Rig.sysml');
	await expect(other.locator('.cm-content')).toContainText('part def Mast;');
});

/** A ZIP with a UTF-8 model file and one in Latin-1. */
/**
 * A ZIP of a project: a UTF-8 model file, one in Latin-1 (not readable as
 * text), and a `.meta.json` whose checksum for the first doesn't hold and
 * which lists a file the archive doesn't have.
 */
async function damagedArchive(): Promise<Buffer> {
	const latin1 = new Uint8Array([
		...new TextEncoder().encode('package Weights {\n    // Gr'),
		0xf6,
		0xdf,
		0x65,
		...new TextEncoder().encode('\n    part def Ballast;\n}\n')
	]);
	const meta = {
		index: {},
		created: '2026-10-23T00:00:00Z',
		checksum: {
			'Rig.sysml': { value: '0'.repeat(64), algorithm: 'SHA256' },
			'Gone.sysml': { value: '0'.repeat(64), algorithm: 'SHA256' }
		}
	};
	return Buffer.from(
		await zip(
			[
				{ path: 'rig/.meta.json', data: JSON.stringify(meta) },
				{ path: 'rig/Rig.sysml', data: RIG },
				{ path: 'rig/Weights.sysml', data: latin1 }
			],
			{ store: true }
		)
	);
}

// Fixed in this assessment: "Import a project" dropped a model file that isn't UTF-8, and ignored checksum warnings, without telling the person.
test('importing an archive says which files were left out, and what did not check out', async ({
	page
}) => {
	await page.goto('/projects');
	await page.locator('input[type=file][accept*=kpar]').setInputFiles({
		name: 'rig.zip',
		mimeType: 'application/zip',
		buffer: await damagedArchive()
	});
	await expect(page).toHaveURL(/\/p\/rig/);
	await ready(page);
	const notice = page
		.getByRole('region', { name: 'Notifications' })
		.locator('.toast')
		.filter({ hasText: 'Weights.sysml' });
	await expect(notice).toBeVisible({ timeout: 5_000 });
	await expect(notice).toContainText('Rig.sysml has changed since the archive was made');
	await expect(notice).toContainText('Gone.sysml is listed');
	// The file that could be read is there.
	await page.getByRole('tab', { name: 'Files' }).click();
	await expect(
		page.locator('.explorer-pane').getByRole('button', { name: 'Rig.sysml', exact: true })
	).toBeVisible();
});

/** GitHub, as far as saving needs it; `head` is where the branch is now. */
async function mockGitHub(page: Page, head: string) {
	const requests: { url: string; auth: string | null }[] = [];
	await page.route('https://api.github.com/**', (route) => {
		const request = route.request();
		requests.push({ url: request.url(), auth: request.headers()['authorization'] ?? null });
		const url = new URL(request.url());
		const path = url.pathname.replace('/repos/acme/drone', '');
		const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
		if (path === '/branches/main')
			return json({ name: 'main', commit: { sha: head, commit: { tree: { sha: `t-${head}` } } } });
		if (path.startsWith('/compare/')) return json({ ahead_by: 1, behind_by: 0, status: 'ahead' });
		if (path === '/git/blobs') return json({ sha: 'blob1' }, 201);
		if (path === '/git/trees') return json({ sha: 'tree1' }, 201);
		if (path === '/git/commits')
			return json({ sha: 'c2', html_url: 'https://github.com/acme/drone/commit/c2' }, 201);
		if (path === '/git/refs/heads/main') return json({ object: { sha: 'c2' } });
		if (path === '/commits') return json([]);
		if (path === '/pulls') return json([]);
		return json({ message: 'Not Found' }, 404);
	});
	return requests;
}

const TOKEN = 'github_pat_assessment_0123456789';

test('saving to GitHub after someone else saved is refused plainly, and the changes stay', async ({
	page
}) => {
	await seed(page, { files: { 'Rig.sysml': RIG }, git: { base: 'c1', token: TOKEN } });
	const requests = await mockGitHub(page, 'c9');
	await openFile(page, 'Rig.sysml');
	await typeAfter(page, '    part def Frame;', 'part def Mast;');
	await page.getByRole('button', { name: 'Source control' }).click();
	const sheet = page.getByRole('dialog', { name: 'drone' });
	await sheet.getByRole('button', { name: /Save to GitHub/ }).click();
	await expect(sheet.getByRole('alert')).toContainText(/newer changes.*Get the latest first/s);
	expect(requests.some((r) => r.url.includes('/git/refs/'))).toBe(false);
	await expect
		.poll(async () => ((await storedRecord(page)) as { git: { base: string } }).git.base)
		.toBe('c1');
	await expect.poll(() => storedText(page, 'Rig.sysml')).toContain('Mast');
});

test('the GitHub token stays out of the project, its export, the offline cache, addresses and the console', async ({
	page
}) => {
	const logs: string[] = [];
	page.on('console', (message) => logs.push(message.text()));
	const addresses: string[] = [];
	page.on('framenavigated', (frame) => addresses.push(frame.url()));
	await seed(page, { files: { 'Rig.sysml': RIG }, git: { base: 'c1', token: TOKEN } });
	const requests = await mockGitHub(page, 'c1');
	await openFile(page, 'Rig.sysml');
	await typeAfter(page, '    part def Frame;', 'part def Mast;');
	await page.getByRole('button', { name: 'Source control' }).click();
	const sheet = page.getByRole('dialog', { name: 'drone' });
	await sheet.getByRole('button', { name: /Save to GitHub/ }).click();
	await expect(sheet.getByText(/Saved to GitHub/).first()).toBeVisible({ timeout: 15_000 });
	await page.keyboard.press('Escape');

	// The token went to GitHub, and only there.
	expect(requests.length).toBeGreaterThan(0);
	expect(requests.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
	expect(requests.every((r) => r.url.startsWith('https://api.github.com/'))).toBe(true);
	expect(requests.some((r) => r.url.includes(TOKEN))).toBe(false);

	// Not in the stored project.
	await expect
		.poll(async () => ((await storedRecord(page)) as { git: { base: string } }).git.base)
		.toBe('c2');
	expect(JSON.stringify(await storedRecord(page))).not.toContain(TOKEN);

	// Not in the exported archive.
	await page.getByRole('button', { name: 'Rig', exact: true }).click();
	const downloading = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: /Download as .kpar/ }).click();
	const kpar = readFileSync((await (await downloading).path())!);
	expect(kpar.includes(TOKEN)).toBe(false);
	expect(kpar.includes('Mast')).toBe(true);

	// Not in any cache the app keeps, and no GitHub answer is cached.
	const cached = await page.evaluate(async (token) => {
		const found: string[] = [];
		for (const name of await caches.keys()) {
			const cache = await caches.open(name);
			for (const request of await cache.keys()) {
				if (request.url.includes('api.github.com')) found.push(request.url);
				const response = await cache.match(request);
				const type = response?.headers.get('content-type') ?? '';
				if (/json|text|javascript/.test(type) && (await response!.text()).includes(token))
					found.push(request.url);
			}
		}
		return found;
	}, TOKEN);
	expect(cached).toEqual([]);

	// Not in an address or the console.
	expect(addresses.some((a) => a.includes(TOKEN))).toBe(false);
	expect(logs.some((l) => l.includes(TOKEN))).toBe(false);
	// Kept in this browser's local storage, where the app reads it.
	expect(
		await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => localStorage[k].includes('github_pat'))
		)
	).toEqual(['sysml-web:github']);
});
