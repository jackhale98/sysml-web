/**
 * Product configurations: choosing one above a budget shows that product's
 * values (the long-range drone's lighter battery and heavier radio), read
 * only, and "As written" brings the model back; the variability matrix lists
 * each configuration's choices; a structure diagram shows the same choice.
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

async function openView(page: Page, title: string) {
	await views(page).getByRole('button', { name: title, exact: true }).click();
	return page.getByRole('region', { name: `${title} view` });
}

test('choosing a configuration shows its mass budget, and As written the model', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	const table = await openView(page, 'Drone mass budget');
	const row = (path: string) =>
		table
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: path, exact: true }) });
	await expect(row('drone')).toContainText('2770 g', { timeout: 15_000 });
	const configuration = table.getByRole('combobox', { name: 'Configuration' });
	await expect(configuration).toHaveValue('');

	await configuration.selectOption({ label: 'longRangeDrone' });
	// 2770 g - 100 g (the semi-solid-state pack) + 45 g (the long-range radio).
	await expect(row('drone')).toContainText('2715 g', { timeout: 15_000 });
	await expect(row('drone.battery')).toContainText('1000 g');
	await expect(row('drone.radio')).toContainText('75 g');
	await expect(table.getByRole('status')).toContainText(
		'Showing the configuration longRangeDrone (battery: longRangePack, radio: longRangeRadio)'
	);
	expect((await analyze(page)).violations.map((v) => v.id)).toEqual([]);

	// The same choice applies to the other tables that read the product's values.
	const power = await openView(page, 'Drone power budget');
	await expect(power.getByRole('combobox', { name: 'Configuration' })).toHaveValue(
		'DroneConfigurations::longRangeDrone'
	);
	await expect(
		power
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: 'drone', exact: true }) })
	).toContainText('402 W', { timeout: 15_000 });
	await power
		.getByRole('combobox', { name: 'Configuration' })
		.selectOption({ label: 'As written' });
	await expect(
		power
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: 'drone', exact: true }) })
	).toContainText('397 W', { timeout: 15_000 });
	await expect(power.getByRole('status')).toHaveCount(0);
});

test('the variability matrix lists each configuration and the variant it chooses', async ({
	page
}) => {
	await openDemo(page);
	const table = await openView(page, 'Drone variants');
	await expect(table.locator('thead th')).toHaveText([
		/configuration/i,
		/battery/i,
		/radio/i,
		/description/i
	]);
	await expect(table.locator('tbody tr').first().locator('td').nth(1)).toHaveText('standardPack', {
		timeout: 15_000
	});
	await expect(table.locator('tbody tr').nth(1)).toContainText('longRangeRadio');
	// The matrix is not a product's values: it has no configuration to choose.
	await expect(table.getByRole('combobox', { name: 'Configuration' })).toHaveCount(0);
});

test('a structure diagram shows the configuration chosen, read only', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Drone interconnection', exact: true }).click();
	const tools = page.getByRole('toolbar', { name: 'Diagram tools' });
	const configuration = tools.getByRole('combobox', { name: 'Configuration' });
	await configuration.selectOption({ label: 'longRangeDrone' }, { timeout: 30_000 });
	await expect(
		page.getByRole('status').filter({ hasText: 'Showing longRangeDrone' })
	).toContainText('battery: longRangePack, radio: longRangeRadio');
	await expect(tools.getByRole('button', { name: 'Add' })).toBeDisabled();
});
