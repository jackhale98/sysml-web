/**
 * Reviewing risk on the demo, without writing SysML: the risk policy
 * painted on a grid recolours the risk matrix; a worksheet filtered to the
 * lines to review, exported as shown and saved as a view; a risk control
 * linked to a line from its details, with whether it is verified; and the
 * same on a phone. Each is accessible and can be undone.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

test.describe.configure({ timeout: 120_000 });

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

async function tall(locator: Locator, what: string) {
	const box = await locator.boundingBox();
	expect(box!.height, what).toBeGreaterThanOrEqual(44);
}

/** Choose the zone to paint the policy's grid with. */
async function brush(form: Locator, zone: string) {
	await form
		.getByRole('radiogroup', { name: 'Zone to paint' })
		.getByText(zone, { exact: true })
		.click();
	await expect(form.getByRole('radio', { name: zone, exact: true })).toBeChecked();
}

async function fits(page: Page, what: string) {
	const wide = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(wide, what).toBeLessThanOrEqual(0);
}

test.describe('on a desktop', () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test('the risk policy, painted on a grid, recolours the risk matrix', async ({ page }) => {
		await openDemo(page);
		await views(page).getByRole('button', { name: 'Risk matrix', exact: true }).click();
		const matrix = page.getByRole('region', { name: 'Risk matrix view' });
		const zones = matrix.getByRole('list', { name: 'Zones of the risk policy' });
		await expect(zones).toContainText('Unacceptable', { timeout: 15_000 });
		await expect(zones).toContainText('Reduce as far as possible');
		// Severity 8, likelihood 3: two lines, in the zone to reduce.
		const cell = matrix.getByRole('row', { name: /^8\b/ }).getByRole('cell').nth(2);
		await expect(cell).toHaveAttribute('data-zone', 'reduce');
		await expect(cell).toContainText('2');
		await expectAccessible(page);

		await matrix.getByRole('button', { name: 'Risk policy' }).click();
		const form = dialog(page, 'Risk policy');
		await expect(form.getByRole('heading', { name: 'Which risks are acceptable?' })).toBeVisible();
		await brush(form, 'Unacceptable');
		await form
			.getByRole('button', { name: 'Severity 8, likelihood 3: reduce as far as possible' })
			.click();
		await expect(
			form.getByRole('button', { name: 'Severity 8, likelihood 3: unacceptable' })
		).toBeVisible();
		await expectAccessible(page);
		await form.getByRole('button', { name: 'Next' }).click();
		await form.getByRole('spinbutton', { name: 'High from' }).fill('120');
		await expect(form.getByRole('list', { name: 'The bands' })).toContainText('51 to 119');
		await form.getByRole('button', { name: 'Next' }).click();
		await form.getByText('Action priority', { exact: true }).click();
		await expect(form.getByRole('radio', { name: /Action priority/ })).toBeChecked();
		await expectAccessible(page);
		await form.getByRole('button', { name: 'Save policy' }).click();
		await expect(form).toBeHidden();
		// Reached by keyboard, the toast waits while the page is checked.
		const undo = toasts(page).getByRole('button', { name: 'Undo' }).last();
		await undo.focus();

		await expect(cell).toHaveAttribute('data-zone', 'unacceptable', { timeout: 15_000 });
		await expect(zones).toContainText(/Unacceptable\s*3 lines/);
		// The two lines are now unacceptable risks: problems to review.
		await expect(page.getByRole('button', { name: /^Problems:/ })).toHaveAccessibleName(
			/Problems: 0 errors, [1-9]\d* warnings/
		);
		await expectAccessible(page);
		await undo.click();
		await expect(cell).toHaveAttribute('data-zone', 'reduce', { timeout: 15_000 });
	});

	test('a worksheet filtered to the lines to review, exported as shown and saved as a view', async ({
		page
	}) => {
		await openDemo(page);
		await views(page).getByRole('button', { name: 'FMEA worksheet', exact: true }).click();
		const sheet = page.getByRole('region', { name: 'FMEA worksheet view' });
		await expect(sheet.getByText('9 rows')).toBeVisible({ timeout: 15_000 });
		// A quick review: the one line whose RPN is in the high band.
		const preset = sheet.getByRole('button', { name: 'RPN ≥ 151', exact: true });
		await preset.click();
		await expect(preset).toHaveAttribute('aria-pressed', 'true');
		await expect(sheet.getByText('1 of 9 rows')).toBeVisible();
		await expect(sheet.locator('tbody tr')).toContainText('A person under the drop point');
		await preset.click();
		await expect(sheet.getByText('9 rows')).toBeVisible();
		// No line is of severity 9 or more.
		await sheet.getByRole('button', { name: 'Severity ≥ 9', exact: true }).click();
		await expect(sheet.getByText('No rows match the filters.')).toBeVisible();
		await sheet.getByRole('button', { name: 'Show all rows' }).click();
		await expect(sheet.getByText('9 rows')).toBeVisible();

		// A filter of a column: the lines the policy says to reduce.
		await sheet.getByRole('button', { name: /^Filter/ }).click();
		const panel = page.getByRole('dialog', { name: 'Filter rows' });
		await panel.getByLabel('Add a filter').selectOption('acceptability');
		await panel.getByRole('checkbox', { name: 'reduce' }).check();
		await expectAccessible(page);
		await panel.getByRole('button', { name: 'Done' }).click();
		await expect(sheet.getByText('4 of 9 rows')).toBeVisible();
		await expect(sheet.locator('tbody tr')).toHaveCount(4);
		await expect(
			sheet.getByRole('button', { name: 'Remove the filter Acceptability: reduce' })
		).toBeVisible();
		await expectAccessible(page);

		// Exported as shown.
		await sheet.getByRole('button', { name: 'Export' }).click();
		await expect(page.getByText('Only the rows shown, as searched and filtered.')).toBeVisible();
		const download = page.waitForEvent('download');
		await page
			.getByRole('menu', { name: 'Export this table' })
			.getByRole('menuitem', { name: 'CSV' })
			.click();
		const csv = readFileSync(await (await download).path(), 'utf8');
		const lines = csv.trim().split('\r\n');
		expect(lines[0]).toContain('Acceptability');
		expect(lines).toHaveLength(5);
		expect(csv).not.toContain('Software lock-up');

		// Saved as a view: the filter becomes its `where`.
		await sheet.getByRole('button', { name: 'Save as a view' }).click();
		const form = dialog(page, 'Save as a view');
		await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue(
			'Filtered FMEA worksheet'
		);
		await form.getByRole('textbox', { name: 'Name' }).fill('Lines to reduce');
		await form.getByText('See the SysML').click();
		await expect(form.locator('pre')).toContainText(
			'where = "Acceptability(severity, likelihood) == RiskAcceptability::reduce"'
		);
		await expectAccessible(page);
		await form.getByRole('button', { name: 'Save view' }).click();
		const saved = page.getByRole('region', { name: 'Lines to reduce view' });
		await expect(saved.getByText('4 rows')).toBeVisible({ timeout: 15_000 });
		await expectAccessible(page);
	});

	test('a risk control linked to a line from its details, with whether it is verified', async ({
		page
	}) => {
		await openDemo(page);
		await views(page).getByRole('button', { name: 'FMEA worksheet', exact: true }).click();
		const sheet = page.getByRole('region', { name: 'FMEA worksheet view' });
		const row = sheet.locator('tbody tr').filter({ hasText: 'Command link lost' });
		await expect(row).toContainText('RC-003 Navigation integrity monitoring', { timeout: 15_000 });
		await expect(row).toContainText('Not verified');
		await expect(sheet.locator('tbody tr').filter({ hasText: 'Thermal runaway' })).toContainText(
			'Verified'
		);

		await row.getByRole('button', { name: 'drone::radio', exact: true }).click();
		const inspector = page.getByRole('complementary', { name: 'Inspector' });
		const line = inspector.getByRole('article', { name: 'FMEA line Command link lost' });
		await expect(line).toContainText('Not verified yet', { timeout: 15_000 });
		await expect(line).toContainText('Implemented by navigationIntegrityMonitor');
		await expect(line).toContainText('proposed');
		await expectAccessible(page);

		await line.getByRole('button', { name: 'Link a risk control or mitigation' }).click();
		await line.getByRole('searchbox').fill('thermal');
		await expectAccessible(page);
		await line.getByRole('button', { name: /RC-001 Battery thermal protection/ }).click();
		// Reached by keyboard, the toast waits while the page is checked.
		const undo = toasts(page).getByRole('button', { name: 'Undo' }).last();
		await undo.focus();
		await expect(line).toContainText('Verified by batteryAbuseTest', { timeout: 15_000 });
		await expect(row).toContainText('RC-001 Battery thermal protection');
		await expect(row.locator('.control-state').filter({ hasText: /^\s*Verified/ })).toHaveCount(1);
		await expectAccessible(page);

		await undo.click();
		await expect(row).not.toContainText('RC-001', { timeout: 15_000 });
	});
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	const nav = (page: Page, name: string) =>
		page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name }).click();

	test('filters on the worksheet’s cards, the coloured matrix and the policy form', async ({
		page
	}) => {
		await openDemo(page);
		await nav(page, 'Views');
		const list = page.locator('.catalog');
		await list.getByRole('button', { name: /^FMEA worksheet/ }).click();
		const sheet = page.getByRole('region', { name: 'FMEA worksheet view' });
		const cards = sheet.locator('.cards .card');
		await expect(cards).toHaveCount(9, { timeout: 15_000 });
		await tall(sheet.getByRole('button', { name: 'High priority' }), 'a quick review');
		// Each line's controls, with whether they are verified.
		await expect(cards.filter({ hasText: 'Thermal runaway' })).toContainText('Verified');

		const filter = sheet.getByRole('button', { name: /^Filter/ });
		await tall(filter, 'Filter');
		await filter.click();
		const panel = dialog(page, 'Filter rows');
		await panel.getByLabel('Add a filter').selectOption('severity');
		await panel.getByRole('spinbutton', { name: 'At least' }).fill('8');
		await fits(page, 'the filter sheet');
		await expectAccessible(page);
		await panel.getByRole('button', { name: 'Done' }).click();
		await expect(cards).toHaveCount(6);
		await expect(sheet.getByText('6 of 9 rows')).toBeVisible();
		await tall(sheet.getByRole('button', { name: 'Save as a view' }), 'Save as a view');
		await fits(page, 'the filtered worksheet');
		await expectAccessible(page);

		await nav(page, 'Views');
		await list.getByRole('button', { name: /^Risk matrix/ }).click();
		const matrix = page.getByRole('region', { name: 'Risk matrix view' });
		await expect(matrix.getByRole('list', { name: 'Zones of the risk policy' })).toBeVisible({
			timeout: 15_000
		});
		await fits(page, 'the risk matrix');
		await expectAccessible(page);
		const policy = matrix.getByRole('button', { name: 'Risk policy' });
		await tall(policy, 'Risk policy');
		await policy.click();
		const form = dialog(page, 'Risk policy');
		const cell = form.getByRole('button', { name: /^Severity 10, likelihood 10/ });
		await tall(cell, 'a cell of the grid');
		await brush(form, 'Acceptable');
		await cell.click();
		await expect(
			form.getByRole('button', { name: 'Severity 10, likelihood 10: acceptable' })
		).toBeVisible();
		await fits(page, 'the policy form');
		await expectAccessible(page);
		await form.getByRole('button', { name: 'Cancel' }).click();
	});
});
