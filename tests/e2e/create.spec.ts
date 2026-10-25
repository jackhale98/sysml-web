/**
 * The guided forms, from a new project: a requirements table and a general
 * diagram made with "New view"; a mass added up over a design's parts, with
 * its budget; a limit whose check flips when a value changes; a trade study
 * of three alternatives, ranked. Each is accessible and can be undone; one
 * form is used on a phone.
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

/** The design the forms work on: a rover with a body, four wheels, a motor and a spare. */
const DESIGN = `part def Wheel {
        attribute mass :> ISQ::mass = 2 [kg];
    }
    part def Body {
        attribute mass :> ISQ::mass = 20 [kg];
    }
    part def Motor {
        attribute mass :> ISQ::mass;
        attribute price : Real;
        attribute power :> ISQ::power;
    }
    part def SmallMotor :> Motor {
        attribute :>> mass = 1.2 [kg];
        attribute :>> price = 100.0;
        attribute :>> power = 300 [W];
    }
    part system : System {
        part body : Body;
        part wheels : Wheel[4];
        part motor : Motor {
            attribute :>> mass = 1500 [g];
            attribute :>> price = 150.0;
            attribute :>> power = 400 [W];
        }
    }
    part spare : Motor {
        attribute :>> mass = 1.4 [kg];
        attribute :>> price = 90.0;
        attribute :>> power = 350 [W];
    }`;

test.describe.configure({ timeout: 90_000 });

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

async function newProject(page: Page, name: string, design = false) {
	await page.goto('/projects');
	await page.getByLabel('Name').fill(name);
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\//);
	await ready(page);
	if (!design) return;
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /^Rover\w*\.sysml/ })
		.click();
	await page.locator('.cm-content').getByText('part system : System;').click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.insertText(DESIGN);
	await page.getByRole('tab', { name: 'Model' }).click();
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible({
		timeout: 15_000
	});
	await expect(page.getByRole('treeitem', { name: /spare/ })).toBeVisible({ timeout: 15_000 });
}

/** Run a command from the search box (⌘K). */
async function command(page: Page, query: string, option: RegExp) {
	await page.keyboard.press('ControlOrMeta+k');
	const palette = page.getByRole('dialog').filter({ has: page.getByRole('listbox') });
	await palette.getByRole('combobox').fill(query);
	await palette.getByRole('option', { name: option }).click();
}

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

function select(page: Page, name: string) {
	return page
		.locator('.explorer-pane')
		.getByRole('treeitem')
		.getByRole('button', { name, exact: true })
		.first()
		.click();
}

test('New view makes a requirements table and a general diagram, each undoable', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Rover');

	await views(page).getByRole('button', { name: 'New view' }).click();
	const form = dialog(page, 'New view');
	await expect(form.getByRole('heading', { name: 'What kind of view?' })).toBeVisible();
	await form.getByText('Requirements table', { exact: true }).click();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('checkbox', { name: /Rover/ }).first().check();
	await form.getByRole('button', { name: 'Next' }).click();
	await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
		'Requirements 2'
	);
	await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Rover requirements');
	await form.getByText('See the SysML').click();
	await expect(form.locator('pre')).toContainText('view roverRequirements : RequirementsTable {');
	await expect(form.locator('pre')).toContainText('expose Rover::*;');
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(form).toBeHidden();
	await expect(toasts(page)).toContainText('Created the view Rover requirements');
	const table = page.getByRole('region', { name: 'Rover requirements view' });
	await expect(table.locator('tbody tr').first()).toContainText('REQ-001', { timeout: 15_000 });
	await expect(views(page).getByRole('heading', { name: 'Requirements' })).toBeVisible();
	await expect(views(page).getByRole('button', { name: 'Rover requirements' })).toBeVisible();
	await toasts(page).getByRole('button', { name: 'Undo' }).click();
	await expect(views(page).getByRole('button', { name: 'Rover requirements' })).toBeHidden({
		timeout: 15_000
	});

	// From the palette: a general diagram of the system.
	await command(page, 'new view general', /New view: General diagram/);
	await expect(form.getByRole('heading', { name: /What does it cover\?/ })).toBeVisible();
	await form.getByRole('checkbox', { name: /system/ }).check();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('textbox', { name: 'Name', exact: true }).fill('System diagram');
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByRole('region', { name: 'System diagram diagram' })).toBeVisible({
		timeout: 15_000
	});
	await expect(views(page).getByRole('heading', { name: 'Structure' })).toBeVisible();
	await expectAccessible(page);
});

test('Add up a mass over the parts and see its budget', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Rover', true);
	await select(page, 'system');
	await inspector(page)
		.getByRole('button', { name: 'Add up mass over the parts of system' })
		.click();
	const form = dialog(page, 'Add up mass');
	await expect(form.getByText('4 × wheels')).toBeVisible();
	await expect(form.getByText('Comes to')).toContainText('29.5 kg');
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Add up', exact: true }).click();
	await expect(toasts(page)).toContainText('system’s mass now adds up its parts');
	// Reached by keyboard, the toast waits while the page is checked.
	const undo = toasts(page).getByRole('button', { name: 'Undo' });
	await undo.focus();
	const budget = page.getByRole('region', { name: 'System mass budget view' });
	await expect(budget.locator('tbody tr').first()).toContainText('29.5 kg', { timeout: 15_000 });
	await expectAccessible(page);
	await undo.click();
	await expect(views(page).getByRole('button', { name: 'System mass budget' })).toBeHidden({
		timeout: 15_000
	});
});

test('Set a limit on a requirement, and see the check flip when the value changes', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Rover', true);
	// The system's mass is given, so it can be checked.
	await select(page, 'system');
	await inspector(page).getByRole('button', { name: 'mass: Not set. Edit' }).click();
	await page.keyboard.type('30 [kg]');
	await page.keyboard.press('Enter');
	await expect(toasts(page)).toContainText('Set mass of system');

	await select(page, 'REQ-001 First requirement');
	await inspector(page).getByRole('button', { name: 'Set a limit' }).click();
	const form = dialog(page, 'Set a limit');
	await expect(form.getByLabel('Value')).toHaveValue('mass');
	await form.getByLabel('Limit').fill('35');
	await expect(form.getByText('it meets at most 35 kg')).toBeVisible();
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Set the limit' }).click();
	await expect(toasts(page)).toContainText(
		'REQ-001 First requirement now checks theSystem.mass <= 35 [kg]'
	);

	await command(page, 'new view design checks', /New view: Design checks/);
	await dialog(page, 'New view').getByRole('button', { name: 'Create' }).click();
	const checks = page.getByRole('region', { name: 'Design checks view' });
	const row = checks.locator('tbody tr').filter({ hasText: 'REQ-001' });
	await expect(row).toContainText(/satisfied|Met/i, { timeout: 15_000 });

	// Heavier: the check is violated.
	await select(page, 'system');
	await inspector(page)
		.getByRole('button', { name: /^mass: 30 \[kg\]/ })
		.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('40 [kg]');
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Design checks', exact: true }).first().click();
	await expect(row).toContainText(/violated|Not met/i, { timeout: 15_000 });
	await expectAccessible(page);
});

test('Set a limit on a value makes a requirement for it', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Rover', true);
	await select(page, 'spare');
	await inspector(page).getByRole('button', { name: 'Set a limit on power of spare' }).click();
	const form = dialog(page, 'Set a limit');
	await form.getByText('At least', { exact: true }).click();
	await form.getByLabel('Limit').fill('320');
	await expect(form.getByLabel('Unit')).toHaveValue('W');
	await expect(form.getByText('Now 350 W: it meets at least 320 W.')).toBeVisible();
	await form.getByRole('button', { name: 'Next' }).click();
	await expect(form.getByLabel('ID')).toHaveValue('REQ-002');
	await expect(form.getByLabel('Title')).toHaveValue('Minimum power');
	await expect(form.getByLabel('Statement')).toHaveValue(
		"The spare's power shall be at least 320 W."
	);
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Create the requirement' }).click();
	await expect(toasts(page)).toContainText('Created the requirement REQ-002 Minimum power');
	await page.getByRole('button', { name: 'Requirements', exact: true }).first().click();
	const row = page.locator('tbody tr').filter({ hasText: 'REQ-002' });
	await expect(row).toContainText('spare', { timeout: 15_000 });
});

test('A trade study of three alternatives, ranked', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Rover', true);
	await page
		.locator('section[aria-labelledby="model-heading"]')
		.getByRole('button', { name: 'New' })
		.click();
	await page.getByRole('button', { name: 'Trade study…' }).click();
	const form = dialog(page, 'New trade study');
	await form.getByRole('checkbox', { name: /^motor/ }).check();
	await form.getByRole('checkbox', { name: /^spare/ }).check();
	await form.getByRole('checkbox', { name: /^SmallMotor/ }).check();
	await expect(form.getByText('Comparing 3 motor alternatives.')).toBeVisible();
	await form.getByRole('button', { name: 'Next' }).click();
	await expect(form.getByRole('checkbox', { name: /mass/ })).toBeChecked();
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Next' }).click();
	await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
		'Motor choice'
	);
	await form.getByText('See the SysML').click();
	await expect(form.locator('pre')).toContainText(
		'attribute massScore : Real = (1.5 [kg] - mass) / 0.3 [kg];'
	);
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(toasts(page)).toContainText('Created the trade study Motor choice');
	// Reached by keyboard, the toast waits while the page is checked.
	const undo = toasts(page).getByRole('button', { name: 'Undo' });
	await undo.focus();
	const view = page.getByRole('region', { name: 'Motor choice view' });
	await expect(view.getByText('is selected')).toBeVisible({ timeout: 20_000 });
	await expect(view.locator('.verdict')).toContainText('smallMotor is selected');
	await expect(view.locator('tbody tr').filter({ hasText: 'Score' })).toContainText(
		'0.00 0.61 0.94'
	);
	await expectAccessible(page);
	await undo.click();
	await expect(views(page).getByRole('button', { name: 'Motor choice' })).toBeHidden({
		timeout: 15_000
	});
});

test('On a phone, New view is a full-screen form that fits', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await newProject(page, 'Rover');
	await page.getByRole('button', { name: /Switch view/ }).click();
	// In the list of views (the overview's next steps have a "New view" too).
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /^New view/ })
		.click();
	const form = dialog(page, 'New view');
	await expect(form).toBeVisible();
	const box = (await form.boundingBox())!;
	expect(box.width).toBeLessThanOrEqual(390);
	expect(box.x).toBeGreaterThanOrEqual(0);
	const overflow = await form.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(1);
	// Touch targets of 44 px or more.
	const next = await form.getByRole('button', { name: 'Next' }).boundingBox();
	expect(next!.height).toBeGreaterThanOrEqual(44);
	await form.getByText('Bill of materials', { exact: true }).click();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('radio', { name: /system/ }).check();
	await form.getByRole('button', { name: 'Next' }).click();
	await expectAccessible(page);
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByRole('region', { name: 'Bill of materials view' })).toBeVisible({
		timeout: 15_000
	});
});
