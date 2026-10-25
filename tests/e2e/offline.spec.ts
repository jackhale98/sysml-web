import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

// The service worker caches the app for offline use (src/service-worker, #lib/offline).

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

async function expectModelReady(page: Page) {
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

/** Wait until the service worker is active, controls the page and has the app shell cached. */
async function waitForShell(page: Page) {
	const ready = () =>
		page.evaluate(async () => {
			if (navigator.serviceWorker.controller?.state !== 'activated') return false;
			const shell = (await caches.keys()).find((key) => key.startsWith('sysml-web-shell-'));
			return !!shell && !!(await (await caches.open(shell)).match('/404.html'));
		});
	await expect.poll(ready, { timeout: 30_000 }).toBe(true);
}

/** Whether the engine's WebAssembly is in the engine cache. */
function engineCached(page: Page) {
	return page.evaluate(async () => {
		const engine = (await caches.keys()).find((key) => key.startsWith('sysml-web-engine-'));
		return !!engine && !!(await (await caches.open(engine)).match('/toolkit/sysmlv2_bg.wasm'));
	});
}

async function waitForEngineCache(page: Page) {
	await expect.poll(() => engineCached(page), { timeout: 30_000 }).toBe(true);
}

test('the landing page installs the app shell but not the engine', async ({ page, context }) => {
	const wasm: string[] = [];
	context.on('request', (request) => {
		if (request.url().endsWith('.wasm')) wasm.push(request.url());
	});

	await page.goto('/');
	await waitForShell(page);
	expect(await engineCached(page)).toBe(false);
	expect(wasm).toEqual([]);

	// Offline, the landing page still opens.
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'Write it. Draw it. Understand it.'
	);
});

test('the demo opens and analyses offline, with the engine from the cache', async ({
	page,
	context
}) => {
	test.slow();
	await page.goto('/p/demo');
	await expectModelReady(page);
	await waitForShell(page);
	await waitForEngineCache(page);

	await context.setOffline(true);
	await page.reload();
	await expectModelReady(page);
	await expect(page.getByRole('tree', { name: 'Model' })).toContainText('DroneArchitecture');
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();
	await expect(page.locator('.statusbar').getByText('Offline')).toBeVisible();

	// Saving to the browser keeps working; GitHub says why it can't be used.
	await page
		.getByRole('button', { name: /Drone UAV/ })
		.first()
		.click();
	await expect(page.getByText("You're offline.")).toBeVisible();
	await expect(page.getByRole('menuitem', { name: /Open from GitHub/ })).toBeDisabled();
	await expectAccessible(page);

	// Back online, the notice goes away.
	await page.keyboard.press('Escape');
	await context.setOffline(false);
	await expect(page.locator('.statusbar').getByText('Offline')).toBeHidden();
});

test('stored projects and the project list open offline', async ({ page, context }) => {
	test.slow();
	await page.goto('/projects');
	await page.getByLabel('Name').fill('Field rig');
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\/field-rig$/);
	await expectModelReady(page);
	await waitForShell(page);
	await waitForEngineCache(page);

	await context.setOffline(true);
	// A deep link to a stored project boots from the cached SPA fallback.
	await page.goto('/p/field-rig');
	await expectModelReady(page);
	await expect(page).toHaveTitle(/Field rig/);

	await page.goto('/projects');
	await expect(page.getByRole('heading', { level: 1, name: 'Your projects' })).toBeVisible();
	await expect(page.getByText('Field rig').first()).toBeVisible();
	await expect(
		page.getByRole('button', { name: /Connect GitHub|Choose a repository/ })
	).toBeDisabled();
	await expect(page.getByText('Opening a repository needs a connection')).toBeVisible();
	await expectAccessible(page);
});

test('a new version is offered quietly and loads only when asked', async ({ page }) => {
	await page.goto('/projects');
	await waitForShell(page);
	const firstLoad = await page.evaluate(() => performance.timeOrigin);

	// A changed worker, as after a deploy (a new script URL counts as a new version).
	await page.evaluate(async () => {
		await navigator.serviceWorker.register('/service-worker.js?next', { type: 'module' });
	});

	const notice = page.getByRole('region', { name: 'Notifications' });
	await expect(notice).toContainText('A new version is ready.');
	await expectAccessible(page);
	// Nothing reloads by itself.
	expect(await page.evaluate(() => performance.timeOrigin)).toBe(firstLoad);

	await notice.getByRole('button', { name: 'Reload' }).click();
	await expect
		.poll(() => page.evaluate(() => performance.timeOrigin).catch(() => firstLoad))
		.not.toBe(firstLoad);
	await expect(page.getByRole('heading', { level: 1, name: 'Your projects' })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
		.toContain('?next');
});

test('reloading for a new version keeps the latest edit', async ({ page }) => {
	test.slow();
	await page.goto('/projects');
	await page.getByLabel('Name').fill('Update rig');
	await page.getByRole('button', { name: /Create project/ }).click();
	await expectModelReady(page);
	await waitForShell(page);

	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /UpdateRig\.sysml/ })
		.click();
	await page.evaluate(async () => {
		await navigator.serviceWorker.register('/service-worker.js?next', { type: 'module' });
	});
	const notice = page.getByRole('region', { name: 'Notifications' });
	await expect(notice).toContainText('A new version is ready.');

	// Type, then reload straight away: before the autosave would have run.
	await page.locator('.cm-content').getByText('part system : System;').click();
	await page.keyboard.press('End');
	await page.keyboard.type('\n    part def Winch;');
	await notice.getByRole('button', { name: 'Reload' }).click();

	await expectModelReady(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /UpdateRig\.sysml/ })
		.click();
	await expect(page.locator('.cm-content')).toContainText('part def Winch;');
});
