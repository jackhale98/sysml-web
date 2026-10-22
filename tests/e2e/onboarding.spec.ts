/**
 * Getting going on your own project: each starting point makes a project
 * with its views and tour; the overview's next steps tick themselves as they
 * are done and can be put away; the help opens from the project menu,
 * Settings, the ? key and search, and finds topics; on a phone too. Every
 * screen is checked for accessibility.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' }).first()).toBeVisible({
		timeout: 30_000
	});

/** Make a project from a starting point, from the projects page. */
async function create(page: Page, name: string, template: RegExp) {
	await page.goto('/projects');
	await page.getByLabel('Name').fill(name);
	await page.getByRole('radio', { name: template }).check();
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\//);
	await ready(page);
}

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');
const steps = (page: Page) => page.getByRole('region', { name: 'Next steps' });
const step = (page: Page, id: string) => steps(page).locator(`li[data-step="${id}"]`);
const help = (page: Page) => page.getByRole('dialog', { name: 'Help' });

test('each starting point makes a project with its views, its tour and no problems', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/projects');
	const picker = page.getByRole('group', { name: 'Start from' });
	await expect(picker.getByRole('radio')).toHaveCount(3);
	await expect(picker.getByRole('radio', { name: /Blank/ })).toBeChecked();
	await expect(picker.getByRole('button', { name: /From GitHub/ })).toBeVisible();
	await expectAccessible(page);

	const made: [string, RegExp, string[]][] = [
		['Blank bench', /Blank/, ['Gaps', 'Structure']],
		[
			'Pump specs',
			/Requirements first/,
			['Gaps', 'Trace matrix', 'Verification matrix', 'Specification']
		],
		[
			'Bike light',
			/Small system/,
			['Parts tree', 'Connections', 'Mass budget', 'Design checks', 'Modes']
		]
	];
	for (const [name, template, saved] of made) {
		await create(page, name, template);
		await expect(
			page.getByRole('button', { name: /^Problems: 0 errors, 0 warnings/ })
		).toBeVisible();
		for (const view of saved)
			await expect(views(page).getByRole('button', { name: view, exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start the tour' })).toBeVisible();
		await expect(steps(page)).toContainText('0 of 6 done');
	}

	// The flashlight: its mass adds up to 130 g against the 150 g limit, and its modes run.
	await views(page).getByRole('button', { name: 'Mass budget', exact: true }).click();
	const budget = page.getByRole('region', { name: 'Mass budget view' });
	await expect(budget.locator('tbody tr').first()).toContainText('130 g', { timeout: 15_000 });
	await expect(views(page).getByRole('button', { name: 'Run Flashlight modes' })).toBeVisible();
	await page.getByRole('button', { name: 'Project overview' }).click();
	await page.getByRole('button', { name: 'Start the tour' }).click();
	await expect(page.getByRole('heading', { name: 'Start here: Bike light' })).toBeVisible();
	await expectAccessible(page);

	// Requirements first: the tour's import link opens the import.
	await page.goto('/projects');
	await page.getByRole('link', { name: /Pump specs/ }).click();
	await ready(page);
	await page.getByRole('button', { name: 'Start the tour' }).click();
	await page.getByRole('button', { name: 'Import from a spreadsheet' }).click();
	await expect(page.getByRole('dialog', { name: /Import requirements/ })).toBeVisible();
});

test('the next steps tick themselves as they are done, and can be put away', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await create(page, 'Step bench', /Blank/);
	await expect(steps(page)).toContainText('0 of 6 done');
	await expectAccessible(page);

	// Write a requirement: the add form opens on a requirement.
	await step(page, 'requirement').getByRole('button', { name: 'Add', exact: true }).click();
	const add = page.getByRole('dialog', { name: 'Add an element' });
	await expect(add.getByLabel('Kind')).toHaveValue('requirement');
	await expectAccessible(page);
	await add.getByLabel('Name').fill('Max mass');
	await add.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(add).toBeHidden();
	await expect(steps(page)).toContainText('1 of 6 done', { timeout: 15_000 });
	await expect(step(page, 'requirement')).toHaveClass(/ticked/);

	// Add a part: into the system's definition.
	await step(page, 'part').getByRole('button', { name: 'Add', exact: true }).click();
	await expect(add.getByLabel('Kind')).toHaveValue('part');
	await expect(add.getByLabel('Add inside')).toHaveValue(/.+/);
	await add.getByLabel('Name', { exact: true }).fill('battery');
	await add.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(steps(page)).toContainText('2 of 6 done', { timeout: 15_000 });

	// Make a view.
	await step(page, 'view').getByRole('button', { name: 'New view' }).click();
	const form = page.getByRole('dialog', { name: 'New view' });
	await form.getByText('Requirements table', { exact: true }).click();
	await form.getByRole('button', { name: 'Next' }).click();
	await form
		.getByRole('checkbox', { name: /StepBench/ })
		.first()
		.check();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(form).toBeHidden();
	// The new view opens once it is written; then back to the overview.
	await expect(page.getByRole('button', { name: /^Close Requirements/ })).toBeVisible({
		timeout: 15_000
	});
	await page.getByRole('button', { name: 'Project overview' }).click();
	await expect(steps(page)).toContainText('3 of 6 done', { timeout: 15_000 });

	// Set a limit opens its form on the first requirement.
	await step(page, 'numbers').getByRole('button', { name: 'Set a limit' }).click();
	const limit = page.getByRole('dialog', { name: /limit/i });
	await expect(limit).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(limit).toBeHidden();

	// Link them: the requirement's details, where the picker adds what satisfies it.
	await step(page, 'link').getByRole('button', { name: 'Show me' }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('Max mass');
	await inspector.getByRole('button', { name: 'Add what satisfies it' }).click();
	await inspector
		.getByRole('list', { name: 'Can satisfy it' })
		.getByRole('button', { name: /^system\b/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Project overview' }).click();
	await expect(steps(page)).toContainText('4 of 6 done', { timeout: 20_000 });
	await expect(step(page, 'link')).toHaveClass(/ticked/);

	// A requirement with a limit, written in the text.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /StepBench\.sysml/ })
		.click();
	await page.locator('.cm-content').getByText("satisfy 'First requirement' by system;").click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(
		"\n    requirement 'Light enough' { subject system : System; require constraint { system.mass <= 10 [kg] } }"
	);
	await page.getByRole('tab', { name: 'Model' }).click();
	await page.getByRole('button', { name: 'Project overview' }).click();
	await expect(steps(page)).toContainText('5 of 6 done', { timeout: 20_000 });
	await expect(step(page, 'numbers')).toHaveClass(/ticked/);

	// Keep a copy: a download ticks the last one.
	const downloading = page.waitForEvent('download');
	await step(page, 'keep').getByRole('button', { name: 'Download' }).click();
	await downloading;
	await expect(steps(page)).toContainText('All done');
	await expectAccessible(page);

	// Put away, and it stays away.
	await steps(page).getByRole('button', { name: 'Hide next steps' }).click();
	await expect(steps(page)).toBeHidden();
	await page.reload();
	await ready(page);
	await expect(page.getByRole('heading', { name: 'Requirements' }).first()).toBeVisible();
	await expect(steps(page)).toBeHidden();
});

test('the demo has no next steps', async ({ page }) => {
	await page.goto('/p/demo');
	await ready(page);
	await expect(page.getByRole('button', { name: 'Start the tour' })).toBeVisible();
	await expect(steps(page)).toBeHidden();
});

test('the help opens from the menu, Settings, the ? key and search, and finds topics', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await create(page, 'Help bench', /Blank/);

	// The project menu.
	await page
		.getByRole('button', { name: /^Help bench/ })
		.first()
		.click();
	await page.getByRole('menuitem', { name: /Help/ }).click();
	await expect(help(page)).toBeVisible();
	await expect(help(page).getByRole('heading', { name: 'Ideas in plain words' })).toBeVisible();
	await expectAccessible(page);
	await help(page).getByLabel('Search the help').fill('budget');
	await expect(help(page).getByRole('heading', { name: 'Check a budget' })).toBeVisible();
	await expect(help(page).getByRole('heading', { name: 'Port', exact: true })).toBeHidden();
	// Its button does what it says.
	await help(page).getByRole('button', { name: 'New budget' }).click();
	await expect(help(page)).toBeHidden();
	await expect(page.getByRole('dialog', { name: 'New view' })).toBeVisible();
	await page.keyboard.press('Escape');

	// Search: "?" lists the help, and a topic opens at its place.
	await page.keyboard.press('ControlOrMeta+k');
	const palette = page.getByRole('dialog').filter({ has: page.getByRole('listbox') });
	await palette.getByRole('combobox').fill('?');
	await expect(palette.getByRole('option', { name: /Help: Add a part/ })).toBeVisible();
	await palette.getByRole('combobox').fill('? port');
	await palette.getByRole('option', { name: /Help: Port/ }).click();
	await expect(help(page)).toBeVisible();
	const port = help(page).getByRole('region', { name: 'Port', exact: true });
	await expect(port).toBeFocused();
	await expect(port).toContainText('A port is a connection point on a part');
	await page.keyboard.press('Escape');
	await expect(help(page)).toBeHidden();

	// The ? key, away from the text.
	await page.locator('body').click({ position: { x: 700, y: 600 } });
	await page.keyboard.press('?');
	await expect(help(page)).toBeVisible();
	await page.keyboard.press('Escape');

	// Settings.
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('tab', { name: 'Help' }).click();
	await page.getByRole('button', { name: 'Open the help' }).click();
	await expect(help(page)).toBeVisible();
	await page.keyboard.press('Escape');

	// The help page itself, without a project.
	await page.goto('/help');
	await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
	await page.getByLabel('Search the help').fill('kpar');
	await expect(page.getByRole('heading', { name: 'Keeping a copy' })).toBeVisible();
	await expectAccessible(page);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('make a flashlight, take a step, and read the help', async ({ page }) => {
		await create(page, 'Pocket light', /Small system/);
		await expectAccessible(page);
		await expect(steps(page)).toContainText('0 of 6 done');
		await step(page, 'requirement').getByRole('button', { name: 'Add', exact: true }).click();
		const add = page.getByRole('dialog', { name: 'Add an element' });
		await expect(add.getByLabel('Kind')).toHaveValue('requirement');
		await add.getByLabel('Name').fill('Grip');
		await add.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(steps(page)).toContainText('1 of 6 done', { timeout: 15_000 });

		await page.getByRole('button', { name: /^More/ }).click();
		await page.getByRole('button', { name: 'Help' }).click();
		await expect(help(page)).toBeVisible();
		await help(page).getByLabel('Search the help').fill('state machine');
		await expect(
			help(page).getByRole('heading', { name: 'State machine', exact: true })
		).toBeVisible();
		await expectAccessible(page);
	});
});
