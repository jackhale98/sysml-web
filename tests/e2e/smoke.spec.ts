import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
	await expect(page.getByRole('status')).toContainText('Model ready', { timeout: 30_000 });
}

async function openFile(page: Page, name: RegExp) {
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name }).click();
	await expect(page.locator('.cm-content')).toBeVisible();
}

test('landing page introduces the product and opens the demo', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toContainText(
		'Write it. Draw it. Understand it.'
	);
	await expectAccessible(page);
	await page.getByRole('link', { name: 'Try the demo' }).click();
	await expect(page).toHaveURL(/\/p\/demo$/);
});

test('the workbench shows the model, its health and an explorer', async ({ page }) => {
	await openDemo(page);
	await expect(page.getByRole('heading', { name: 'Drone UAV' }).first()).toBeVisible();
	await expect(page.getByRole('meter', { name: 'Covered by a test' })).toBeVisible();
	await expect(page.getByRole('tree', { name: 'Model' })).toContainText('DroneArchitecture');
	await expectAccessible(page);
});

test('text edits redraw the live diagram', async ({ page }) => {
	await openDemo(page);
	await openFile(page, /DroneArchitecture/);
	const diagram = page.getByRole('region', { name: /DroneArchitecture diagram/ });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible();

	// Type a new part definition inside the package, after its imports.
	await page.locator('.cm-content').getByText('private import ISQ::*;').click();
	await page.keyboard.press('End');
	await page.keyboard.type('\n    part def CargoHook;');
	await expect(diagram.getByText('CargoHook')).toBeVisible({ timeout: 10_000 });
});

test('diagram edits write SysML text', async ({ page }) => {
	await openDemo(page);
	await openFile(page, /DroneArchitecture/);
	const diagram = page.getByRole('region', { name: /DroneArchitecture diagram/ });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible();

	await diagram.getByRole('button', { name: /Add/ }).click();
	const form = page.getByRole('form', { name: /Add to DroneArchitecture/ });
	await form.getByLabel('Kind').selectOption('part def');
	await form.getByLabel('Name').fill('Parachute');
	await expect(form.getByLabel('SysML that will be added')).toContainText('part def Parachute');
	await form.getByRole('button', { name: 'Add' }).click();

	await expect(page.locator('.cm-content')).toContainText('part def Parachute', {
		timeout: 10_000
	});
	await expect(diagram.getByText('Parachute')).toBeVisible({ timeout: 10_000 });
});

test('selecting an element explains it in the inspector', async ({ page }) => {
	await openDemo(page);
	await openFile(page, /DroneArchitecture/);
	await page
		.getByRole('region', { name: /DroneArchitecture diagram/ })
		.getByText('DeliveryDrone', { exact: true })
		.first()
		.click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector).toContainText('Part definition');
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('DeliveryDrone');
	await expectAccessible(page);
});

test('requirements view lists requirements with their trace status', async ({ page }) => {
	await openDemo(page);
	await page.getByRole('button', { name: /^Requirements/ }).click();
	const rows = page.locator('tbody tr');
	await expect(rows.first()).toContainText(/STK|SYS|RC/);
	expect(await rows.count()).toBeGreaterThanOrEqual(15);
	await page.getByRole('searchbox', { name: 'Search requirements' }).fill('SYS-001');
	await expect(rows).toHaveCount(1);
	await rows.first().getByRole('button').click();
	await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('Requirement');
	await expectAccessible(page);
});

test('on a phone, one pane shows at a time', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openDemo(page);
	const panes = page.getByRole('navigation', { name: 'Panes' });
	await panes.getByRole('button', { name: 'Model' }).click();
	await expect(page.getByRole('tree', { name: 'Model' })).toBeVisible();
	await panes.getByRole('button', { name: 'Inspector' }).click();
	await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
	await expectAccessible(page);
});

test('saved SysML views render as tables and diagrams', async ({ page }) => {
	await openDemo(page);
	const views = page.locator('section[aria-labelledby="views-heading"]');
	await views.getByRole('button', { name: 'Requirement gaps' }).click();
	const table = page.getByRole('region', { name: 'Requirement gaps view' });
	await expect(table.locator('tbody tr').first()).toBeVisible();
	await expect(table).toContainText('SYS-005');
	await expectAccessible(page);

	await views.getByRole('button', { name: 'Drone interconnection' }).click();
	const diagram = page.getByRole('region', { name: /Drone interconnection diagram/ });
	await expect(diagram.getByText('battery : Battery')).toBeVisible();
});

test('the command palette jumps to any element', async ({ page }) => {
	await openDemo(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Battery');
	await page.keyboard.press('Enter');
	await expect(palette).toBeHidden();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('Battery');
});

test('the guided tour reads as a page whose references open the model', async ({ page }) => {
	await openDemo(page);
	await page.getByRole('button', { name: /Start the tour/ }).click();
	await expect(page.getByRole('heading', { name: /guided tour/ })).toBeVisible();
	await expectAccessible(page);
	await page.getByRole('button', { name: 'DroneViews::serviceContext' }).first().click();
	await expect(page.getByRole('region', { name: /Service context diagram/ })).toBeVisible();
});

test('on a phone, a file switches between text and diagram instead of splitting', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openDemo(page);
	await page
		.getByRole('navigation', { name: 'Panes' })
		.getByRole('button', { name: 'Model' })
		.click();
	await openFile(page, /DroneArchitecture/);
	const layouts = page.getByRole('group', { name: 'Show the model as' });
	await expect(layouts.getByRole('button')).toHaveCount(2);
	await expect(page.getByRole('region', { name: /DroneArchitecture diagram/ })).toHaveCount(0);
	await layouts.getByRole('button', { name: /Diagram/ }).click();
	await expect(page.getByRole('region', { name: /DroneArchitecture diagram/ })).toBeVisible();
	await expect(page.locator('.cm-content')).toBeHidden();
});
