import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

/** The demo is analysed by the WebAssembly engine in a worker. */
async function waitForAnalysis(page: Page) {
	await expect(page.getByRole('status')).toContainText('Analysed in', { timeout: 30_000 });
}

test('landing page introduces the product and opens the demo', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Systems engineering');
	await expectAccessible(page);

	await page.getByRole('link', { name: 'Try the demo' }).click();
	await expect(page).toHaveURL(/\/p\/demo$/);
});

test('overview summarises the analysed demo project', async ({ page }) => {
	await page.goto('/p/demo');
	await waitForAnalysis(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Drone UAV' })).toBeVisible();
	await expect(page.getByRole('meter', { name: 'Covered by a test' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
	await expectAccessible(page);
});

test('requirements grid lists, filters and explains requirements', async ({ page }) => {
	await page.goto('/p/demo/requirements');
	await waitForAnalysis(page);

	const rows = page.locator('tbody tr');
	await expect(rows.first()).toContainText(/STK|SYS|RC/);
	const total = await rows.count();
	expect(total).toBeGreaterThanOrEqual(15);

	await page.getByRole('button', { name: /With gaps/ }).click();
	expect(await rows.count()).toBeLessThan(total);

	await page.getByRole('button', { name: /^All/ }).click();
	await page.getByRole('searchbox', { name: 'Search requirements' }).fill('SYS-001');
	await expect(rows).toHaveCount(1);

	const title = (await rows.first().locator('.title').textContent()) ?? '';
	await rows.first().getByRole('button').click();
	const panel = page.getByRole('complementary', { name: title });
	await expect(panel.getByRole('heading', { level: 2 })).toBeVisible();
	await panel.getByText('Show SysML').click();
	await expect(panel.locator('pre')).toContainText("requirement <'SYS-001'>");
	await expectAccessible(page);

	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
});

test('model area shows the SysML files and their problems', async ({ page }) => {
	await page.goto('/p/demo/model');
	await waitForAnalysis(page);
	await expect(page.getByRole('navigation', { name: 'Files' })).toContainText('Catalog.sysml');
	await page.getByRole('button', { name: /System Requirements/ }).click();
	await expect(page.locator('pre.code')).toContainText('requirement');
	await expectAccessible(page);
});

test('planned areas explain what is coming', async ({ page }) => {
	await page.goto('/p/demo/risk');
	await expect(page.getByRole('heading', { level: 1, name: 'Risk' })).toBeVisible();
	await expect(page.getByText(/Planned for phase/)).toBeVisible();
	await expectAccessible(page);
});
