import { expect, test, type Page } from '@playwright/test';

/**
 * Saving a project asks the browser to keep the site's storage for good, so
 * it is not cleared when space runs low or after weeks unused: not only when
 * a project is made, but whenever one is saved (a project made before the
 * browser agreed, or before the app asked, still gets it).
 */

/** Count the requests to keep storage, and say no, as a browser does for a site it hardly knows. */
async function countRequests(page: Page) {
	await page.addInitScript(() => {
		const calls = { persist: 0 };
		Object.assign(window, { __keep: calls });
		const storage = navigator.storage;
		storage.persist = async () => {
			calls.persist++;
			return false;
		};
		storage.persisted = async () => false;
	});
}

const requests = (page: Page) =>
	page.evaluate(() => (window as unknown as { __keep: { persist: number } }).__keep.persist);

test('editing a stored project asks the browser to keep its storage', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await countRequests(page);
	await page.goto('/projects');
	await page.getByLabel('Name').fill('Kept');
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\//);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

	// Later, in a new page load: the browser said no before, and is asked again on a save.
	await page.reload();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	expect(await requests(page)).toBe(0);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: 'New file' }).click();
	const form = page.getByRole('dialog');
	await form.getByLabel('Name', { exact: true }).fill('Extra');
	await form.getByRole('button', { name: 'Create file' }).click();
	await expect(form).toBeHidden();
	await expect.poll(() => requests(page), { timeout: 10_000 }).toBe(1);

	// Once per page load, however many saves follow.
	await page.getByRole('button', { name: 'New file' }).click();
	await form.getByLabel('Name', { exact: true }).fill('More');
	await form.getByRole('button', { name: 'Create file' }).click();
	await expect(form).toBeHidden();
	await page.waitForTimeout(1500);
	expect(await requests(page)).toBe(1);
});
