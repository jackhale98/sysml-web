/**
 * Risk analysis from the app, without writing SysML: a design FMEA made on
 * a new Small system project (which gets the risk libraries), its lines
 * added and removed, its risk matrix; a hazard with its harm and control
 * in the hazard log, the control linked to what implements it; the demo's
 * worksheet with the details panel open, a rating out of scale flagged;
 * and the same forms on a phone. Each is accessible and can be undone.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

test.describe.configure({ timeout: 120_000 });

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

async function smallSystem(page: Page, name: string) {
	await page.goto('/projects');
	await page.getByLabel('Name').fill(name);
	await page.getByRole('radio', { name: /Small system/ }).check();
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\//);
	await ready(page);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await ready(page);
}

const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

/** Run a command from the search box (⌘K). */
async function command(page: Page, query: string, option: RegExp) {
	await page.keyboard.press('ControlOrMeta+k');
	const palette = page.getByRole('dialog').filter({ has: page.getByRole('listbox') });
	await palette.getByRole('combobox').fill(query);
	await palette.getByRole('option', { name: option }).click();
}

/** Add a line from a worksheet's form, on any screen. */
async function addLine(
	page: Page,
	element: RegExp,
	failure: string,
	ratings: [string, string, string]
) {
	const form = dialog(page, /^Add a line/);
	await form.getByRole('radio', { name: element }).check();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('textbox', { name: /Failure mode|Use error/ }).fill(failure);
	await form.getByRole('textbox', { name: /^Effect/ }).fill('The light goes out');
	await form.getByRole('textbox', { name: /^Cause/ }).fill('Left in a hot car');
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByLabel(/^Severity/).selectOption(ratings[0]);
	await form.getByLabel(/^Likelihood/).selectOption(ratings[1]);
	await form.getByLabel(/^Detection/).selectOption(ratings[2]);
	return form;
}

test('a design FMEA on a new Small system project: the libraries come with it, lines are added and removed', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await smallSystem(page, 'Torch');
	await page.getByRole('button', { name: 'New', exact: true }).last().click();
	await page.getByRole('button', { name: 'FMEA…' }).click();
	const form = dialog(page, 'New FMEA');
	await expect(form.getByRole('heading', { name: 'What kind of FMEA?' })).toBeVisible();
	await expect(form.getByText('How the steps of a process can go wrong')).toBeVisible();
	await form.getByText('Design FMEA', { exact: false }).first().click();
	await form.getByRole('button', { name: 'Next' }).click();
	await form
		.getByRole('checkbox', { name: /flashlight/ })
		.first()
		.check();
	await form.getByRole('button', { name: 'Next' }).click();
	await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Flashlight design FMEA');
	await form.getByText('See the SysML').click();
	await expect(form.locator('pre')).toContainText(
		'view flashlightDesignFMEA : DesignFmeaWorksheet'
	);
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Create' }).click();

	const sheet = page.getByRole('region', { name: 'Flashlight design FMEA view' });
	await expect(sheet.getByText('No lines yet')).toBeVisible({ timeout: 15_000 });
	// The first FMEA brought the risk libraries into the project's libraries folder.
	await page.getByRole('tab', { name: 'Files' }).click();
	const files = page.locator('.explorer-pane').getByRole('list', { name: 'Files' });
	await files.locator('summary', { hasText: 'libraries' }).click();
	await expect(files.getByRole('button', { name: /^RiskAnalysis\.sysml/ })).toBeVisible();
	await expect(files.getByRole('button', { name: /^HazardAnalysis\.sysml/ })).toBeVisible();
	await page.getByRole('tab', { name: 'Model' }).click();

	await sheet.getByRole('button', { name: 'Add a line' }).first().click();
	const line = await addLine(page, /battery/, 'Cells leak', ['7', '4', '8']);
	// Each rating says what it means.
	await expect(line.getByText('7 of 10: The main function works less well')).toBeVisible();
	await expect(line.getByText('Risk priority number: 224')).toBeVisible();
	await expectAccessible(page);
	await line.getByRole('button', { name: 'Add line' }).click();
	const row = sheet.locator('tbody tr').filter({ hasText: 'Cells leak' });
	await expect(row).toContainText('224', { timeout: 15_000 });
	await expect(row).toContainText(/high/i);
	await expect(sheet.getByRole('columnheader', { name: 'Part' })).toBeVisible();
	await expectAccessible(page);

	// The risk matrix of the sheet: every rating, the line in its cell.
	await sheet.getByRole('button', { name: 'Risk matrix' }).click();
	const matrix = page.getByRole('region', { name: /Flashlight design FMEA matrix view/i });
	await expect(matrix.getByRole('table')).toBeVisible({ timeout: 15_000 });
	await expect(matrix.getByRole('rowheader')).toHaveCount(10);
	await expect(matrix.getByRole('row', { name: /^7\b/ }).getByRole('cell').nth(3)).toHaveText('1');
	await expectAccessible(page);

	await views(page).getByRole('button', { name: 'Flashlight design FMEA', exact: true }).click();
	await row
		.getByRole('button', { name: /Remove the line “Cells leak” of flashlight::battery/ })
		.click();
	await expect(row).toBeHidden({ timeout: 15_000 });
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(row).toBeVisible({ timeout: 15_000 });
});

test('a hazard with its harm and control: the hazard log links the control to what implements it', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await smallSystem(page, 'Torch');
	await command(page, 'hazard', /New hazard/);
	const form = dialog(page, 'New hazard');
	await form.getByRole('textbox', { name: 'Hazard' }).fill('Hot battery');
	await form
		.getByRole('textbox', { name: 'Description', exact: true })
		.fill('The cells heat up when shorted.');
	await form.getByRole('textbox', { name: 'Situation' }).fill('Held in the hand');
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('textbox', { name: 'Harm' }).fill('Burned hand');
	await form.getByRole('radio', { name: /Serious/ }).check();
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('button', { name: 'Add a risk control' }).click();
	await expect(form.getByRole('textbox', { name: 'ID' })).toHaveValue('RC-001');
	await form.getByRole('textbox', { name: 'Title' }).fill('Thermal fuse');
	await form
		.getByRole('textbox', { name: 'What it requires' })
		.fill('The battery holder shall cut the current above 60 °C.');
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Create' }).click();

	const log = page.getByRole('region', { name: 'Hazard log view' });
	const row = log.locator('tbody tr').filter({ hasText: 'Hot battery' });
	await expect(row).toContainText('Burned hand', { timeout: 15_000 });
	await expect(row).toContainText(/serious/i);
	await expect(row).toContainText('RC-001 Thermal fuse');
	await expectAccessible(page);

	// Nothing implements the control yet: its details open with the picker.
	await row.getByRole('button', { name: /say what implements/ }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByText('Thermal fuse').first()).toBeVisible();
	await inspector
		.getByRole('button', { name: /battery/ })
		.first()
		.click();
	await expect(row).toContainText('battery', { timeout: 15_000 });
});

test('the demo’s worksheet keeps its figures in view beside the details, and flags a rating out of scale', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openDemo(page);
	await views(page).getByRole('button', { name: 'FMEA worksheet' }).click();
	const sheet = page.getByRole('region', { name: 'FMEA worksheet view' });
	const row = sheet.locator('tbody tr').filter({ hasText: 'Thermal runaway' });
	await expect(row).toContainText('144', { timeout: 15_000 });
	// Select a line: the details panel shows the part, beside the table.
	await row.getByRole('button', { name: 'drone::battery', exact: true }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('textbox', { name: 'Name' })).toHaveValue('battery');
	const scroller = await sheet.locator('.scroll').boundingBox();
	for (const name of ['Severity', 'Likelihood', 'Detection', 'RPN', 'Action priority']) {
		const header = await sheet.getByRole('columnheader', { name, exact: true }).boundingBox();
		expect(header!.x + header!.width, name).toBeLessThanOrEqual(scroller!.x + scroller!.width + 1);
	}

	await row.getByRole('button', { name: /Edit Severity/ }).click();
	const input = row.getByRole('textbox', { name: /Severity/ });
	await input.fill('14');
	await input.press('Enter');
	const cell = sheet
		.locator('tbody tr')
		.filter({ hasText: 'Thermal runaway' })
		.locator('td.problem');
	await expect(cell).toContainText('14', { timeout: 15_000 });
	await expect(cell.locator('.flag')).toHaveAttribute(
		'title',
		'Severity is 14, outside the scale of 1 to 10.'
	);
	const problems = page.getByRole('button', { name: /^Problems:/ });
	// Out of scale, and not the battery fire's worst harm (critical, 8).
	await expect(problems).toHaveAccessibleName('Problems: 0 errors, 2 warnings');
	await problems.click();
	await expect(page.locator('section.problems-pane')).toContainText(
		'Severity is 14, outside the scale of 1 to 10 (@Fmea about drone::battery).'
	);
	await expectAccessible(page);
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(sheet.locator('td.problem')).toHaveCount(0, { timeout: 15_000 });
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	const nav = (page: Page, name: string) =>
		page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name }).click();

	async function fits(page: Page, what: string) {
		const wide = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(wide, what).toBeLessThanOrEqual(0);
	}

	async function tall(page: Page, locator: ReturnType<Page['locator']>, what: string) {
		const box = await locator.boundingBox();
		expect(box!.height, what).toBeGreaterThanOrEqual(44);
	}

	test('a use FMEA and a hazard on the demo, from the views list, in forms that fit', async ({
		page
	}) => {
		await openDemo(page);
		await nav(page, 'Views');
		// The list of views: a page of its own, or a sheet over the open view.
		const list = page.locator('.catalog');
		await list.getByRole('button', { name: /New FMEA/ }).click();
		const form = dialog(page, 'New FMEA');
		const box = (await form.boundingBox())!;
		expect(box.width).toBeLessThanOrEqual(390);
		await tall(page, form.getByRole('button', { name: 'Next' }), 'Next');
		await form.getByText('Use FMEA', { exact: false }).first().click();
		await form.getByRole('button', { name: 'Next' }).click();
		await form.getByRole('checkbox', { name: /DeliverParcel/ }).check();
		await form.getByRole('button', { name: 'Next' }).click();
		await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('DeliverParcel use FMEA');
		await fits(page, 'the new FMEA form');
		await expectAccessible(page);
		await form.getByRole('button', { name: 'Create' }).click();

		const sheet = page.getByRole('region', { name: 'Deliver parcel use FMEA view' });
		await expect(sheet.getByText('No lines yet')).toBeVisible({ timeout: 15_000 });
		await sheet.getByRole('button', { name: 'Add a line' }).first().click();
		const line = await addLine(page, /prepareFlight/, 'Uploads the wrong plan', ['5', '4', '4']);
		await fits(page, 'the add a line form');
		await tall(page, line.getByLabel(/^Severity/), 'a rating');
		await line.getByRole('button', { name: 'Add line' }).click();
		const card = sheet.locator('.cards .card').filter({ hasText: 'Uploads the wrong plan' });
		await expect(card).toContainText('80', { timeout: 15_000 });
		await expect(card.getByText('Use error', { exact: true })).toBeVisible();
		await tall(page, card.getByRole('button', { name: 'Remove line' }), 'Remove line');
		await tall(page, sheet.getByRole('button', { name: 'Add a line' }).first(), 'Add a line');
		await fits(page, 'the use FMEA worksheet');
		await expectAccessible(page);

		await nav(page, 'Views');
		await list.getByRole('button', { name: /New hazard/ }).click();
		const hazard = dialog(page, 'New hazard');
		await hazard.getByRole('textbox', { name: 'Hazard' }).fill('Parcel drop');
		await hazard.getByRole('button', { name: 'Next' }).click();
		await hazard.getByRole('checkbox', { name: 'impactInjury' }).check();
		await hazard.getByRole('button', { name: /Remove harm 1/ }).click();
		await fits(page, 'the hazard form');
		await hazard.getByRole('button', { name: 'Next' }).click();
		await hazard.getByRole('button', { name: 'Create' }).click();
		const log = page.getByRole('region', { name: 'Hazard log view' });
		const entry = log.locator('.cards .card').filter({ hasText: 'Parcel drop' });
		await expect(entry).toContainText(/critical/i, { timeout: 15_000 });
		await fits(page, 'the hazard log');
		await expectAccessible(page);

		await nav(page, 'Views');
		await list.getByRole('button', { name: /^Risk matrix/ }).click();
		const grid = page.getByRole('region', { name: 'Risk matrix view' });
		await expect(grid.getByRole('rowheader')).toHaveCount(10, { timeout: 15_000 });
		await fits(page, 'the risk matrix');
		await expectAccessible(page);
	});
});
