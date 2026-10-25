/**
 * Trade studies: the battery trade study compares today's battery with three
 * candidate packs, side by side, and says which one its objective selects;
 * names open their element; a changed value changes the ranking until it is
 * undone; the inspector sums a study up; the table exports as CSV.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(results.violations.map((v) => v.id)).toEqual([]);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

async function openTrade(page: Page) {
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Battery trade' })
		.click();
	const view = page.getByRole('region', { name: 'Battery trade view' });
	await expect(view.getByText('is selected')).toBeVisible({ timeout: 15_000 });
	return view;
}

const column = (view: ReturnType<Page['getByRole']>, name: string) =>
	view.locator('thead th').filter({ has: view.page().getByRole('button', { name, exact: true }) });

test('the battery trade study ranks the packs and says which one to fly', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	const view = await openTrade(page);
	await expect(view.locator('.verdict')).toContainText(
		'semiSolidState is selected: it has the highest score, 0.59.'
	);
	await expect(view.locator('.verdict')).toContainText(
		'The design uses drone.battery today: ranked 2 of 4, score 0.39.'
	);
	await expect(column(view, 'semiSolidState')).toContainText('#1');
	await expect(column(view, 'semiSolidState')).toContainText('Selected');
	await expect(column(view, 'drone.battery')).toContainText('In the design');
	// A row per criterion, with units and weights; the score last.
	const row = (name: string) => view.locator('tbody tr').filter({ hasText: name });
	await expect(row('Endurance').locator('td')).toHaveText([
		'50 %',
		/27.54 min/,
		/25.13 min/,
		/35.77 min/,
		/36.54 min.*best/
	]);
	await expect(row('Price')).toContainText('lower is better');
	await expect(row('Score').locator('td')).toHaveText(['100 %', '0.39', '0.28', '0.00', '0.59']);
	// It fits beside the inspector without scrolling sideways.
	const overflow = await view.locator('.scroll').evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(1);
	await expectAccessible(page);

	// A criterion opens its attribute in the evaluation function.
	await row('Endurance').getByRole('button', { name: 'Endurance' }).click();
	await expect(inspector(page).getByRole('heading', { name: 'endurance' })).toBeVisible();
	await expect(inspector(page).getByRole('textbox', { name: /^Value \(/ })).toHaveValue(
		'HoverEndurance(pack.usableEnergy, hoverPower)'
	);
});

test('a pricier pack changes the choice, until undone', async ({ page }) => {
	await openDemo(page);
	const view = await openTrade(page);
	// The alternative opens in the inspector, with its values, each edited in place.
	await column(view, 'semiSolidState').getByRole('button', { name: 'semiSolidState' }).click();
	await expect(inspector(page).getByRole('heading', { name: 'semiSolidState' })).toBeVisible();
	const values = inspector(page).getByRole('region', { name: 'Values' });
	await values.getByRole('button', { name: /^price: 1150\.0/ }).click();
	const price = values.getByRole('textbox', { name: 'price of semiSolidState' });
	await price.fill('2500.0');
	await price.press('Enter');

	await expect(view.locator('.verdict')).toContainText(
		'drone.battery is selected: it has the highest score, 0.39.',
		{ timeout: 15_000 }
	);
	await expect(view.locator('.verdict')).toContainText('The design already uses it.');
	await expect(column(view, 'semiSolidState')).toContainText('#2');

	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(view.locator('.verdict')).toContainText('semiSolidState is selected', {
		timeout: 15_000
	});
});

test('the inspector sums a trade study up, and the table exports as CSV', async ({ page }) => {
	await openDemo(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('batteryTradeStudy');
	await palette
		.getByRole('option')
		.filter({ hasText: /batteryTradeStudy\s+analysis/ })
		.first()
		.click();
	const summary = inspector(page).getByRole('region', { name: 'Trade study result' });
	await expect(summary).toContainText('semiSolidState is selected (highest score).', {
		timeout: 15_000
	});
	await expect(summary.getByRole('listitem')).toHaveText([
		/semiSolidState\s*0.59/,
		/drone.battery\s*in the design\s*0.39/,
		/lithiumPolymer\s*0.28/,
		/lithiumIon3P\s*0.00/
	]);
	await expectAccessible(page);

	await summary.getByRole('button', { name: 'Compare in Battery trade' }).click();
	const view = page.getByRole('region', { name: 'Battery trade view' });
	await expect(view.getByText('is selected')).toBeVisible({ timeout: 15_000 });
	await view.getByRole('button', { name: 'Export' }).click();
	const download = page.waitForEvent('download');
	await page
		.getByRole('menu', { name: 'Export this table' })
		.getByRole('menuitem', { name: 'CSV' })
		.click();
	const csv = readFileSync(await (await download).path(), 'utf8');
	expect(
		csv.startsWith('﻿Criterion,Weight,drone.battery,lithiumPolymer,lithiumIon3P,semiSolidState')
	).toBe(true);
	expect(csv).toContain('\r\nendurance,50 %,27.54 min,25.13 min,35.77 min,36.54 min\r\n');
	expect(csv).toContain('\r\nrank,,2,3,4,1');
});
