/**
 * Tables are SysML views the toolkit engine renders: the standard tables of
 * `ModelViews`, the demo's saved views with their `expose`, and editing a
 * metadata cell (an FMEA rating) back into the SysML text.
 */
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

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

test('the bill of materials walks the parts tree the toolkit resolved', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Drone bill of materials' }).click();
	const table = page.getByRole('region', { name: 'Drone bill of materials view' });
	// `expose DroneArchitecture::drone::**` takes in the drone itself and its parts, nested.
	await expect(table.getByText('26 rows')).toBeVisible({ timeout: 15_000 });
	const motor = table.locator('tbody tr').filter({ hasText: 'drone.frontLeft.motor' });
	await expect(motor).toContainText('Motor');
	await expect(motor.locator('td').nth(3)).toHaveText('1');
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
	// The worksheet's figures follow the failure mode: severity, likelihood, detection, RPN.
	const rpn = row.locator('td').nth(5);
	await expect(rpn).toHaveText('144');
	await row.getByRole('button', { name: /Edit Severity/ }).click();
	const input = row.getByRole('textbox', { name: /Severity/ });
	await input.fill('9');
	await input.press('Enter');
	// 9 × 3 × 6, computed by the library's `Rpn` calc, which the view's column invokes.
	await expect(rpn).toHaveText('162', { timeout: 10_000 });
	await expect(row).toContainText('9');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(rpn).toHaveText('144', { timeout: 10_000 });
});

test('a trace matrix made with New view renders from the view library', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'New view' }).click();
	const form = page.getByRole('dialog', { name: 'New view' });
	await form.getByText('Trace matrix', { exact: true }).click();
	await form.getByRole('button', { name: 'Next' }).click();
	// The demo saves a trace matrix already: this one gets a name of its own.
	const name = form.getByLabel('Name', { exact: true });
	if (!(await name.isVisible())) await form.getByRole('button', { name: 'Next' }).click();
	await name.fill('Design trace');
	await form.getByRole('button', { name: 'Create' }).click();
	const table = page.getByRole('region', { name: 'Design trace view' });
	// Every requirement is a row, linked or not; the columns are named in words.
	await expect(table.getByText('25 rows')).toBeVisible({ timeout: 15_000 });
	await expect(table.getByRole('columnheader', { name: 'Payload release (drone)' })).toBeVisible();
	await expectAccessible(page);
});

test('Show SysML opens a table or report at its own view, not the top of the file', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	const cases: [RegExp, string][] = [
		[/mass budget/i, 'view droneMassBudget : MassBudget'],
		[/requirement coverage/i, 'view requirementCoverage : RequirementsTraceMatrix'],
		[/fmea worksheet/i, 'view fmeaWorksheet : DesignFmeaWorksheet'],
		[/drone specification/i, 'view droneSpecification : SpecificationDocument']
	];
	for (const [title, declaration] of cases) {
		await views(page).getByRole('button', { name: title }).first().click();
		await page
			.getByRole('button', { name: /^(Show SysML|SysML)$/ })
			.first()
			.click();
		await expect(page.locator('.cm-activeLine').first()).toContainText(declaration, {
			timeout: 10_000
		});
	}
});

test('a report shows where its chapters come from: the view def and each chapter view', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	await views(page)
		.getByRole('button', { name: /drone specification/i })
		.first()
		.click();
	const report = page.getByRole('article', { name: 'Delivery drone requirements specification' });
	// Each chapter names the view it is drawn from, and opens it.
	const source = report.getByRole('button', { name: 'view traceabilityChapter : TraceMatrix' });
	await expect(source).toBeVisible({ timeout: 15_000 });
	await expect(
		report.getByRole('button', { name: 'view requirementsChapter : RequirementsTable' })
	).toBeVisible();
	await source.click();
	await expect(page.locator('.cm-activeLine').first()).toContainText(
		'view traceabilityChapter : TraceMatrix',
		{ timeout: 10_000 }
	);
	// The definition in the header opens the view def that lists the chapters.
	await views(page)
		.getByRole('button', { name: /drone specification/i })
		.first()
		.click();
	await report.getByRole('button', { name: 'view def SpecificationDocument' }).click();
	await expect(page.locator('.cm-activeLine').first()).toContainText(
		'view def SpecificationDocument',
		{ timeout: 10_000 }
	);
});
