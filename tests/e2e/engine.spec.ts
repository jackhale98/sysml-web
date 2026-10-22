import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

/** How the toolkit loaded its library on this page: from source or from the snapshot. */
const libraryLoad = (page: Page) =>
	page.evaluate(
		() =>
			(
				performance.getEntriesByName('sysml:toolkit-ready')[0] as
					(PerformanceMark & { detail?: { library?: string } }) | undefined
			)?.detail?.library
	);

test('the model is analysed by the sysml-toolkit, without false problems', async ({ page }) => {
	await openDemo(page);
	const footer = page.locator('footer');
	await expect(footer).toContainText('engine toolkit 0.10.10');
	// No false problems (the earlier engine reported 78 findings, most of them false): the two
	// warnings are the risk review item the demo keeps on purpose.
	await expect(page.getByRole('button', { name: 'Problems: 0 errors, 2 warnings' })).toBeVisible();
	await expect(page.getByRole('tree', { name: 'Model' })).toContainText('DroneArchitecture');
	await expectAccessible(page);
});

test('later visits load the library from the snapshot fetched in the background', async ({
	page
}) => {
	test.setTimeout(120_000);
	await openDemo(page);
	expect(await libraryLoad(page)).toBe('source');
	// Once the page is idle the worker stores the prepared snapshot for next time.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					if (!(await caches.has('sysml-web-toolkit-snapshot'))) return 0;
					return (await (await caches.open('sysml-web-toolkit-snapshot')).keys()).length;
				}),
			{ timeout: 90_000 }
		)
		.toBe(1);
	await openDemo(page);
	expect(await libraryLoad(page)).toBe('snapshot');
	await expect(page.getByRole('button', { name: 'Problems: 0 errors, 2 warnings' })).toBeVisible();
});

test('when the toolkit cannot start, it is retried once and then says so', async ({ page }) => {
	let attempts = 0;
	await page.route('**/toolkit/sysmlv2_bg.wasm', (route) => {
		attempts++;
		return route.fulfill({ status: 500, body: 'unavailable' });
	});
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Engine error' })).toBeVisible({
		timeout: 30_000
	});
	expect(attempts).toBe(2);
	await expect(
		page.getByText('The SysML engine stopped working. Reload the page to try again.')
	).toBeVisible();
	await expectAccessible(page);
	await page.getByRole('button', { name: /^Problems:/ }).click();
	await expect(page.locator('section.problems-pane')).toContainText(
		/The SysML engine stopped working \(.+\)\. Reload the page to try again\./
	);
});
