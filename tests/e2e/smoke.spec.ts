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
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
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
	await rows.first().getByRole('button').first().click();
	await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('Requirement');
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

test('table cells edit the SysML behind them', async ({ page }) => {
	await openDemo(page);
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'System requirements' })
		.click();
	const table = page.getByRole('region', { name: 'System requirements view' });
	const row = table.locator('tbody tr').filter({ hasText: 'SYS-001' });
	await row.getByRole('button', { name: /Edit Priority/ }).click();
	await row.getByRole('combobox', { name: /Priority/ }).selectOption('low');
	await expect(row).toContainText('low');
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: /^SystemRequirements\.sysml/ }).click();
	await expect(page.locator('.cm-content')).toContainText('Priority::low');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.cm-content')).not.toContainText(':>> priority = Priority::low');
});

test('the SysML standard library can be browsed and searched, read-only', async ({ page }) => {
	await openDemo(page);
	await page.getByText('SysML standard library').click();
	await page.getByText('Systems Library', { exact: true }).click();
	await page.getByRole('button', { name: 'Ports', exact: true }).click();
	const file = page.getByRole('region', { name: /Standard library: .*Ports\.sysml/ });
	await expect(file).toContainText('LGPL-3.0-only');
	await expect(file.locator('.cm-content')).toContainText('port def');
	await expect(file.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');

	await page.getByPlaceholder('Filter elements').fill('MassValue');
	await page.getByRole('button', { name: /ISQBase::MassValue/ }).click();
	await expect(page.getByRole('region', { name: /ISQBase\.sysml/ })).toBeVisible();
	await expectAccessible(page);
});

test('a new project is ready to use, survives a reload, and round-trips as .kpar', async ({
	page
}) => {
	await page.goto('/projects');
	await page.getByLabel('Name').fill('Test bench');
	await page.getByLabel(/What is it/).fill('A rig for testing motors.');
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\/test-bench$/);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();

	// The starter's requirements table lists its first requirement.
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Requirements', exact: true })
		.first()
		.click();
	await expect(page.locator('tbody tr').first()).toContainText('REQ-001');

	// Edit the model; the change is saved and is still there after a reload.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /TestBench\.sysml/ })
		.click();
	await page.locator('.cm-content').getByText('part system : System;').click();
	await page.keyboard.press('End');
	await page.keyboard.type('\n    part def Motor;');
	await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
	await page.reload();
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /TestBench\.sysml/ })
		.click();
	await expect(page.locator('.cm-content')).toContainText('part def Motor;');

	// Export as .kpar and import it again as a second project.
	await page
		.getByRole('button', { name: /Test bench/ })
		.first()
		.click();
	const downloading = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: /Download as .kpar/ }).click();
	const kpar = await (await downloading).path();
	await page.goto('/projects');
	await expect(page.getByText('Test bench').first()).toBeVisible();
	await page.locator('input[type=file][accept*=kpar]').setInputFiles(kpar!);
	await expect(page).toHaveURL(/\/p\/test-bench-2$/);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /TestBench\.sysml/ })
		.click();
	await expect(page.locator('.cm-content')).toContainText('part def Motor;');
	await expectAccessible(page);
});

test('a state machine runs step by step in the emulator', async ({ page }) => {
	await openDemo(page);
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Run FlightModes' })
		.click();
	await expect(page.getByText(/(Started|Now) in idle/)).toBeVisible({ timeout: 15_000 });
	// The blocked event explains why and links to the variable to set.
	await page.getByRole('button', { name: 'preflightChecksPassed', exact: true }).click();
	await page.getByRole('switch', { name: /preflightChecksPassed/ }).click();
	await page.getByRole('button', { name: 'ArmCommand to armed' }).click();
	await expect(page.getByText(/Now in armed/)).toBeVisible();
	await page.getByRole('button', { name: 'TakeOffCommand to flying' }).click();
	await expect(page.getByText(/Now in flying/)).toBeVisible();
	await expectAccessible(page);
});

/** Nothing on a phone screen is wider than the screen, so the page never pans sideways. */
async function expectNoSidewaysScroll(page: Page) {
	const widths = await page.evaluate(() => {
		const d = document.documentElement;
		return { scroll: d.scrollWidth, client: d.clientWidth, x: window.scrollX };
	});
	expect(widths.scroll).toBe(widths.client);
	expect(widths.x).toBe(0);
}

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('on a phone, the bottom navigation switches sections and details open in a sheet', async ({
		page
	}) => {
		await openDemo(page);
		const nav = page.getByRole('navigation', { name: 'Sections' });
		await expect(nav.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
		await expectNoSidewaysScroll(page);

		await nav.getByRole('button', { name: 'Model' }).click();
		await expect(page.getByRole('tree', { name: 'Model' })).toBeVisible();
		await page
			.getByRole('tree', { name: 'Model' })
			.getByRole('button', { name: 'DroneArchitecture', exact: true })
			.click();
		const sheet = page.getByRole('group', { name: 'Element details' });
		await expect(sheet).toHaveAttribute('data-snap', 'half');
		const inspector = sheet.getByRole('complementary', { name: 'Inspector' });
		await expect(inspector.getByRole('heading', { level: 2 })).toContainText('DroneArchitecture');
		await expectNoSidewaysScroll(page);
		await expectAccessible(page);

		// Going elsewhere lowers the sheet to a peek; Details brings it back up.
		await nav.getByRole('button', { name: 'Views' }).click();
		await expect(sheet).toHaveAttribute('data-snap', 'peek');
		await nav.getByRole('button', { name: 'Details' }).click();
		await expect(sheet).toHaveAttribute('data-snap', 'full');

		// Everything the desktop top bar has is in the More menu.
		await page.getByRole('button', { name: /^More/ }).click();
		const more = page.getByRole('dialog', { name: 'More' });
		await more.getByRole('button', { name: /Problems/ }).click();
		await expect(page.getByRole('dialog', { name: 'Problems' })).toBeVisible();
	});

	test('on a phone, the views drawer switches views and tables show as cards', async ({ page }) => {
		await openDemo(page);
		await page.getByRole('button', { name: /Switch view$/ }).click();
		const drawer = page.getByRole('dialog', { name: 'Views' });
		await drawer.getByRole('button', { name: /System requirements/ }).click();
		await expect(drawer).toBeHidden();
		const card = page.locator('.cards .card').filter({ hasText: 'SYS-001' });
		await expect(card).toBeVisible();
		await expectNoSidewaysScroll(page);
		await expectAccessible(page);
		await card.getByRole('button', { name: /Edit Priority/ }).click();
		await card.getByRole('combobox', { name: /Priority/ }).selectOption('low');
		await expect(card).toContainText('low');

		await page.getByRole('button', { name: /Switch view$/ }).click();
		await expect(
			drawer.getByRole('button', { name: 'System requirements', exact: true })
		).toHaveAttribute('aria-current', 'true');
		await drawer.getByRole('button', { name: 'Run FlightModes' }).click();
		await expect(page.getByText(/(Started|Now) in idle/)).toBeVisible({ timeout: 15_000 });
		await expectNoSidewaysScroll(page);
	});

	async function editorFontSize(page: Page, setting: number) {
		await page.addInitScript((size) => {
			localStorage.setItem('sysml-web:settings', JSON.stringify({ editorFontSize: size }));
		}, setting);
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		await page.getByRole('tab', { name: 'Files' }).click();
		await page.getByRole('button', { name: /^DroneArchitecture\.sysml/ }).click();
		await page
			.getByRole('group', { name: 'Show the model as' })
			.getByRole('button', { name: /Text/ })
			.click();
		return page.locator('.cm-editor').evaluate((e) => getComputedStyle(e).fontSize);
	}

	test('on a phone, the editor uses the text size setting', async ({ page }) => {
		expect(await editorFontSize(page, 19)).toBe('19px');
	});

	test.describe('on an iPhone', () => {
		test.use({
			userAgent:
				'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
		});
		test('on an iPhone, the editor text is never small enough to zoom the page', async ({
			page
		}) => {
			expect(await editorFontSize(page, 12)).toBe('16px');
		});
	});

	test('on a phone, a file opens as its diagram and its text is read-only until Edit text', async ({
		page
	}) => {
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		await page.getByRole('tab', { name: 'Files' }).click();
		await page.getByRole('button', { name: /^DroneArchitecture\.sysml/ }).click();
		const layouts = page.getByRole('group', { name: 'Show the model as' });
		await expect(layouts.getByRole('button')).toHaveCount(2);
		await expect(page.getByRole('region', { name: /DroneArchitecture diagram/ })).toBeVisible();

		await layouts.getByRole('button', { name: /Text/ }).click();
		const text = page.locator('.cm-content');
		await expect(text).toHaveAttribute('contenteditable', 'false');
		await expect(page.getByRole('region', { name: /DroneArchitecture diagram/ })).toHaveCount(0);
		await page.getByRole('button', { name: 'Edit text' }).click();
		await expect(text).toHaveAttribute('contenteditable', 'true');
		await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
		const typing = page.getByRole('toolbar', { name: 'Typing' });
		await typing.getByRole('button', { name: 'Type {' }).click();
		await typing.getByRole('button', { name: 'Undo' }).click();
		await typing.getByRole('button', { name: 'Done' }).click();
		await expect(text).toHaveAttribute('contenteditable', 'false');
		await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
		await expectNoSidewaysScroll(page);
	});

	test('on a phone, filtering the model shows matching elements at once', async ({ page }) => {
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		await page.getByPlaceholder('Filter elements').fill('batt');
		const results = page.getByRole('region', { name: /results/ });
		const first = results.getByRole('button').first();
		await expect(first).toBeInViewport();
		await expect(first).toContainText(/batt/i);
		await expectAccessible(page);
		await first.click();
		await expect(
			page.getByRole('group', { name: 'Element details' }).getByRole('heading', { level: 2 })
		).toContainText(/batt/i);
	});

	test('on a phone, elements are added with a form', async ({ page }) => {
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		await page.getByRole('button', { name: 'Add an element' }).click();
		const sheet = page.getByRole('dialog', { name: 'Add an element' });
		await sheet.getByLabel('Name').fill('Hangar');
		await sheet.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(sheet).toBeHidden();
		await expect(page.getByRole('tree', { name: 'Model' })).toContainText('Hangar');
	});
});
