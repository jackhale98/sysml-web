/**
 * Uncertain values (docs/uncertainty.md): the demo's battery says how much
 * its mass, capacity and usable share vary, so the mass budget shows each
 * total's likely range and the share of cases within the take-off limit,
 * and the endurance check says how often it is met.
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

async function openView(page: Page, title: string) {
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: title })
		.click();
	return page.getByRole('region', { name: `${title} view` });
}

test('a budget shows the spread of its totals and the share within the limit', async ({ page }) => {
	await openDemo(page);
	const table = await openView(page, 'Drone mass budget');
	await expect(table.getByText('28 rows')).toBeVisible({ timeout: 15_000 });
	await expect(table.getByRole('columnheader', { name: 'Likely range' })).toBeVisible();
	await expect(table.getByRole('columnheader', { name: 'Within limit' })).toBeVisible();
	const row = (path: string) =>
		table
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: path, exact: true }) });
	// The battery's tolerance, +60/−40 g, read as ±3σ: 90 % of packs between 1082 and 1138 g.
	await expect(row('drone.battery')).toContainText('1082 – 1138 g');
	// An exact part has no range.
	await expect(row('drone.airframe').locator('td').nth(5)).toHaveText('');
	// The take-off mass: its range, and every sampled case within the 4 kg limit.
	await expect(row('drone.takeOffMass')).toContainText('3.752 – 3.808 kg');
	await expect(row('drone.takeOffMass').locator('td').last()).toHaveText('100 %');
	expect((await analyze(page)).violations.map((v) => v.id)).toEqual([]);

	const checks = await openView(page, 'Design checks');
	const endurance = checks.locator('tbody tr').filter({ hasText: 'SYS-001' });
	await expect(endurance).toContainText('Satisfied', { timeout: 15_000 });
	await expect(endurance).toContainText(
		'Met in 98.8 % of cases: drone.endurance = 27.54 min, in 90 % of cases between 25.59 and 29.54 min (needs ≥ 25 min).'
	);
});
