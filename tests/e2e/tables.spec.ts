/**
 * Tables are SysML views the toolkit engine renders: the standard tables of
 * `ModelViews`, the demo's saved views with their `expose`, and editing a
 * metadata cell (an FMEA rating) back into the SysML text.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations.map((v) => v.id)).toEqual([]);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

test('the bill of materials walks the parts tree the toolkit resolved', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Drone bill of materials' }).click();
	const table = page.getByRole('region', { name: 'Drone bill of materials view' });
	// `expose DroneArchitecture::drone::**` takes in the drone itself and its parts, nested.
	await expect(table.getByText('14 rows')).toBeVisible({ timeout: 15_000 });
	const motor = table.locator('tbody tr').filter({ hasText: 'drone.rotors.motor' });
	await expect(motor).toContainText('Motor');
	await expect(motor.locator('td').nth(3)).toHaveText('4');
	await expectAccessible(page);
});

test('the interface table shows what each port connects to', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Drone interfaces' }).click();
	const table = page.getByRole('region', { name: 'Drone interfaces view' });
	const row = table
		.locator('tbody tr')
		.filter({ hasText: 'PowerDistributionBoard' })
		.filter({ hasText: '~PowerPort' });
	await expect(row).toContainText('battery.powerOut');
	await expect(row).toContainText('batteryPower');
	await expect(table.getByText('19 rows')).toBeVisible();
});

test('an FMEA rating edits the annotation behind it, and the RPN follows', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Fmea worksheet' }).click();
	const table = page.getByRole('region', { name: 'Fmea worksheet view' });
	const row = table.locator('tbody tr').filter({ hasText: 'Thermal runaway' });
	await expect(row.locator('td').last()).toHaveText('144');
	await row.getByRole('button', { name: /Edit Severity/ }).click();
	const input = row.getByRole('textbox', { name: /Severity/ });
	await input.fill('9');
	await input.press('Enter');
	// 9 × 3 × 6, computed by the view's `rpn = severity*likelihood*detection`.
	await expect(row.locator('td').last()).toHaveText('162', { timeout: 10_000 });
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: /^DesignFmea\.sysml/ }).click();
	await expect(page.locator('.cm-content')).toContainText('severity = 9; likelihood = 3');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.cm-content')).toContainText('severity = 8; likelihood = 3');
});

test('a standard table renders from the bundled view library', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Trace matrix' }).click();
	const table = page.getByRole('region', { name: 'Trace matrix view' });
	await expect(table.getByText('12 rows')).toBeVisible({ timeout: 15_000 });
	await expect(table.getByRole('columnheader', { name: 'drone.payloadRelease' })).toBeVisible();
	await expectAccessible(page);
});
