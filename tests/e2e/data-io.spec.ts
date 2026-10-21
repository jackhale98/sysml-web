/**
 * Getting data in and out: exporting table views (CSV, Excel, print) and
 * importing requirements from a spreadsheet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readXlsx } from '../../src/lib/dataio/xlsx-read';

const FIXTURE = join(import.meta.dirname, 'fixtures/requirements.csv');

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

/** Open the demo and wait for the engine (WebAssembly, in a worker) to read it. */
async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

async function openRequirements(page: Page) {
	await page
		.getByRole('button', { name: /^Requirements/ })
		.first()
		.click();
	const table = page.getByRole('region', { name: 'Requirements table view' });
	await expect(table.getByRole('button', { name: 'SYS-001' })).toBeVisible();
	return table;
}

/** Nothing on a phone screen is wider than the screen, so the page never pans sideways. */
async function expectNoSidewaysScroll(page: Page) {
	const widths = await page.evaluate(() => {
		const d = document.documentElement;
		return { scroll: d.scrollWidth, client: d.clientWidth, x: window.scrollX };
	});
	expect(widths.scroll).toBe(widths.client);
	expect(widths.x).toBe(0);
}

test('a table exports as CSV that Excel reads', async ({ page }) => {
	await openDemo(page);
	const table = await openRequirements(page);
	await table.getByRole('button', { name: 'Export' }).click();
	const menu = page.getByRole('menu', { name: 'Export this table' });
	await expect(menu).toBeVisible();
	const download = page.waitForEvent('download');
	await menu.getByRole('menuitem', { name: 'CSV' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('Requirements table.csv');
	const csv = readFileSync(await file.path(), 'utf8');
	expect(csv.startsWith('﻿Id,Title,Text,Kind,Priority,Verification method,Status')).toBe(true);
	expect(csv).toContain('\r\nSYS-001,Flight endurance,');
	expect(csv).toContain(',performance,high,"analysis, test",done,J. Hale,');
});

test('a searched table exports only its rows, as an Excel workbook', async ({ page }) => {
	await openDemo(page);
	const table = await openRequirements(page);
	await table.getByRole('searchbox').fill('battery');
	await table.getByRole('button', { name: 'Export' }).click();
	await expect(page.getByText('Only the rows your search shows.')).toBeVisible();
	const download = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'Excel workbook' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('Requirements table.xlsx');
	const [sheet] = await readXlsx(new Uint8Array(readFileSync(await file.path())));
	expect(sheet!.name).toBe('Requirements table');
	expect(sheet!.rows[0]!.slice(0, 3)).toEqual(['Id', 'Title', 'Text']);
	const shown = await table.locator('tbody tr td:first-child').allTextContents();
	expect(shown.length).toBeGreaterThan(1);
	expect(shown.length).toBeLessThan(20);
	expect(sheet!.rows.slice(1).map((r) => r[0])).toEqual(shown.map((s) => s.trim()));
});

test('a table prints on its own page with its title, project and date', async ({ page }) => {
	await openDemo(page);
	const table = await openRequirements(page);
	await page.evaluate(() => {
		window.print = () => {};
	});
	await table.getByRole('button', { name: 'Export' }).click();
	await page.getByRole('menuitem', { name: 'Print or save as PDF' }).click();
	const sheet = page.locator('.sysml-print-sheet');
	await expect(sheet).toBeAttached();
	await expect(sheet).toBeHidden();
	await page.emulateMedia({ media: 'print' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('heading', { name: 'Requirements table' })).toBeVisible();
	await expect(sheet).toContainText('Drone UAV ·');
	await expect(sheet.getByRole('row')).toHaveCount(21);
	await expect(page.locator('.workbench')).toBeHidden();
});

test('requirements import from a CSV file in one undoable change', async ({ page }) => {
	await openDemo(page);
	const table = await openRequirements(page);
	await table.getByRole('button', { name: 'Import' }).click();
	const dialog = page.getByRole('dialog', { name: 'Import requirements' });
	await expect(dialog).toBeVisible();
	await expectAccessible(page);
	await dialog.locator('input[type=file]').setInputFiles(FIXTURE);

	// The columns are recognised from their headings.
	await expect(dialog.getByRole('combobox', { name: /Column A, Req ID/ })).toHaveValue('id');
	await expect(dialog.getByRole('combobox', { name: /Column C, Requirement text/ })).toHaveValue(
		'doc'
	);
	await expect(dialog.getByRole('combobox', { name: /Column E/ })).toHaveValue(
		'attr:verificationMethod'
	);
	await expect(dialog.getByRole('status')).toContainText('3 new requirements · 1 skipped');
	await expect(dialog).toContainText('Row 5 skipped: SYS-001 is already in the model.');
	await expect(dialog).toContainText('left out: ‘Draft’');
	await dialog.getByText('Show the SysML').click();
	await expect(dialog.locator('pre')).toContainText(
		"requirement <'SYS-101'> 'Landing light' : DroneRequirement {"
	);
	await expectAccessible(page);

	await dialog.getByRole('button', { name: 'Import 3 requirements' }).click();
	await expect(dialog).toBeHidden();
	const toast = page.getByText('Imported 3 requirements (1 skipped)');
	await expect(toast).toBeVisible();
	await expect(table.getByRole('button', { name: 'SYS-101' })).toBeVisible({ timeout: 10_000 });
	await expect(table.getByRole('row').filter({ hasText: 'SYS-103' })).toContainText(
		'Parcel temperature'
	);
	await expect(page.getByRole('button', { name: /^Requirements/ }).first()).toContainText('23');

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(table.getByRole('button', { name: 'SYS-101' })).toBeHidden({ timeout: 10_000 });
	await expect(page.getByRole('button', { name: /^Requirements/ }).first()).toContainText('20');
	await page.getByRole('tab', { name: 'Files' }).click();
	await expect(page.getByRole('button', { name: /Imported\.sysml/ })).toHaveCount(0);
});

test('cells pasted from a spreadsheet import into an existing package', async ({ page }) => {
	await openDemo(page);
	await page.getByRole('button', { name: 'Drone UAV' }).click();
	await page.getByRole('menuitem', { name: /Import requirements/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Import requirements' });
	await dialog
		.getByRole('textbox', { name: 'Paste cells' })
		.fill(
			'ID\tName\tShall statement\tPriority\nSTK-101\tNight deliveries\tThe operator needs to deliver after dark.\tLow'
		);
	await dialog.getByRole('button', { name: 'Use these cells' }).click();
	await expect(dialog.getByRole('combobox', { name: /Column B, Name/ })).toHaveValue('name');
	await dialog
		.getByRole('combobox', { name: /Each one is a/ })
		.selectOption('EngineeringRequirement');
	await dialog.getByRole('combobox', { name: /Put them in/ }).selectOption('StakeholderNeeds');
	await dialog.getByRole('button', { name: 'Import 1 requirement' }).click();
	await expect(page.getByText('Imported 1 requirement')).toBeVisible();

	const table = page.getByRole('region', { name: 'Requirements table view' });
	const row = table.getByRole('row').filter({ hasText: 'STK-101' });
	await expect(row).toContainText('Night deliveries');
	await expect(row).toContainText('low');
	await row.getByRole('button', { name: 'STK-101' }).click();
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: /^StakeholderNeeds\.sysml/ }).click();
	// The new requirement is the package's last member: go to the end of the text.
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+End');
	await expect(page.locator('.cm-content')).toContainText(
		"requirement <'STK-101'> 'Night deliveries' : EngineeringRequirement {"
	);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('on a phone, requirements import from a file and the table exports', async ({ page }) => {
		await openDemo(page);
		await page.getByRole('button', { name: /Switch view$/ }).click();
		await page
			.getByRole('dialog', { name: 'Views' })
			.getByRole('button', { name: /^Requirements/ })
			.click();
		await expect(page.locator('.cards .card').filter({ hasText: 'SYS-001' })).toBeVisible();

		await page.getByRole('button', { name: 'Export' }).click();
		const menu = page.getByRole('menu', { name: 'Export this table' });
		const box = await menu.boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(390);
		await page.keyboard.press('Escape');

		await page.getByRole('button', { name: 'Import' }).click();
		const dialog = page.getByRole('dialog', { name: 'Import requirements' });
		await dialog.locator('input[type=file]').setInputFiles(FIXTURE);
		await expect(dialog.getByRole('combobox', { name: /Column A, Req ID/ })).toHaveValue('id');
		await expectNoSidewaysScroll(page);
		const width = await dialog
			.locator('.body')
			.evaluate((d) => ({ scroll: d.scrollWidth, client: d.clientWidth }));
		expect(width.scroll).toBe(width.client);
		await expectAccessible(page);
		await dialog.getByRole('button', { name: 'Import 3 requirements' }).click();
		await expect(page.getByText('Imported 3 requirements (1 skipped)')).toBeVisible();
		await expect(page.locator('.cards .card').filter({ hasText: 'SYS-102' })).toBeVisible({
			timeout: 10_000
		});
		await expectNoSidewaysScroll(page);
	});
});
