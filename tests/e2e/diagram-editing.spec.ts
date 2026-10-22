import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Diagram editing beyond drawing: taking elements off a diagram, deleting them from the model. */

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

async function openView(page: Page, name: string) {
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name, exact: true })
		.click();
	const diagram = page.getByRole('region', { name: new RegExp(`${name} diagram`) });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });
	return diagram;
}

const node = (diagram: Locator, id: string) =>
	diagram.locator(`.svelte-flow__node[data-id="${id}"]`);
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test('remove from diagram hides an element and keeps it in the model; undo brings it back', async ({
	page
}) => {
	await openDemo(page);
	const catalogue = await openView(page, 'Component catalogue');
	await expect(catalogue.locator('.svelte-flow__node')).toHaveCount(13);
	await node(catalogue, 'Camera').click({ button: 'right' });
	const menu = page.getByRole('menu', { name: 'Camera' });
	await expect(menu.getByRole('menuitem', { name: /Remove from diagram/ })).toContainText(
		'It stays in the model'
	);
	await expect(menu.getByRole('menuitem', { name: /Delete from model/ })).toContainText(
		'Takes it out of the text'
	);
	await expectAccessible(page);
	await menu.getByRole('menuitem', { name: /Remove from diagram/ }).click();
	await expect(node(catalogue, 'Camera')).toHaveCount(0);
	await expect(catalogue.locator('.svelte-flow__node')).toHaveCount(12);
	await expect(toasts(page)).toContainText('Hid Camera on this diagram (it stays in the model)');
	// Still in the model: the explorer and the palette find it.
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Camera');
	await expect(
		palette
			.getByRole('option')
			.filter({ hasText: /^\s*Camera\b/ })
			.first()
	).toBeVisible();
	await page.keyboard.press('Escape');

	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(node(catalogue, 'Camera')).toBeVisible();

	// The keyboard does the same: H on a selected node.
	await node(catalogue, 'Motor').focus();
	await page.keyboard.press('h');
	await expect(node(catalogue, 'Motor')).toHaveCount(0);
});

test('hidden elements are listed on the diagram, to show again one by one or all at once', async ({
	page
}) => {
	await openDemo(page);
	const catalogue = await openView(page, 'Component catalogue');
	for (const id of ['Camera', 'TelemetryRadio']) {
		await node(catalogue, id).focus();
		await page.keyboard.press('h');
		await expect(node(catalogue, id)).toHaveCount(0);
	}
	const hidden = catalogue.getByRole('group', { name: 'Hidden on this diagram' });
	await expect(hidden).toContainText('2 hidden');
	await hidden.getByRole('button', { name: '2 hidden' }).click();
	await expect(hidden.getByRole('listitem')).toHaveCount(2);
	await expect(hidden.getByRole('list')).toContainText('TelemetryRadio');
	await expectAccessible(page);
	await hidden.getByRole('button', { name: 'Show TelemetryRadio again' }).click();
	await expect(node(catalogue, 'TelemetryRadio')).toBeVisible();
	await expect(hidden).toContainText('1 hidden');
	// Another diagram hides nothing of it.
	const breakdown = await openView(page, 'Drone breakdown');
	await expect(breakdown.getByRole('group', { name: 'Hidden on this diagram' })).toHaveCount(0);
	await openView(page, 'Component catalogue');
	await hidden.getByRole('button', { name: 'Show all' }).click();
	await expect(node(catalogue, 'Camera')).toBeVisible();
	await expect(hidden).toHaveCount(0);
	// Showing is undone like any change.
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(node(catalogue, 'Camera')).toHaveCount(0);
});

test('delete from model says what uses the element before it goes', async ({ page }) => {
	await openDemo(page);
	const catalogue = await openView(page, 'Component catalogue');
	await node(catalogue, 'Motor').click({ button: 'right' });
	await page.getByRole('menuitem', { name: /Delete from model/ }).click();
	const confirm = page.getByRole('alertdialog', { name: 'Delete Motor from the model?' });
	await expect(confirm).toContainText('it leaves every diagram and table');
	await expect(confirm.getByRole('status')).toContainText(
		'3 references to Motor would no longer resolve'
	);
	await expectAccessible(page);
	await confirm.getByRole('button', { name: 'Cancel' }).click();
	await expect(confirm).toHaveCount(0);
	await expect(node(catalogue, 'Motor')).toBeVisible();
});

async function openFileDiagram(page: Page, file: RegExp, name: RegExp) {
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: file })
		.click();
	const diagram = page.getByRole('region', { name });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });
	return diagram;
}

test('add connected elements puts what refers to an element on the diagram, in one step', async ({
	page
}) => {
	await openDemo(page);
	const diagram = await openFileDiagram(page, /^Components\.sysml/, /DroneComponents diagram/);
	const before = await diagram.locator('.svelte-flow__node').count();
	await node(diagram, 'Battery').click({ button: 'right' });
	await page.getByRole('menuitem', { name: /Add connected elements/ }).click();
	const form = page.getByRole('dialog', { name: 'Add connected elements of Battery' });
	await expect(form.getByRole('button', { name: /Outgoing/ })).toBeDisabled();
	await expect(form.getByRole('button', { name: /Incoming \(\d+\)/ })).toContainText(
		'What refers to Battery: '
	);
	await expectAccessible(page);
	await form.getByRole('button', { name: /Incoming/ }).click();
	await expect(form).toHaveCount(0);
	// The part typed by it, from another package, with the line to its type.
	await expect(node(diagram, 'battery')).toBeVisible();
	expect(await diagram.locator('.svelte-flow__node').count()).toBeGreaterThan(before);
	await expect(
		diagram.getByRole('group', { name: 'typing from battery : Battery to Battery' })
	).toHaveCount(1);
	await expect(toasts(page)).toContainText(/Added \d+ connected elements to this diagram/);
	// Removing it again takes it off the diagram's list, not into the hidden ones.
	await node(diagram, 'battery').focus();
	await page.keyboard.press('h');
	await expect(node(diagram, 'battery')).toHaveCount(0);
	await expect(diagram.getByRole('group', { name: 'Hidden on this diagram' })).toHaveCount(0);
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(node(diagram, 'battery')).toBeVisible();
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(node(diagram, 'battery')).toHaveCount(0);
});

test('in a saved view, add connected elements writes expose lines, and says what the filter leaves out', async ({
	page
}) => {
	await openDemo(page);
	const catalogue = await openView(page, 'Component catalogue');
	await node(catalogue, 'Battery').click({ button: 'right' });
	await page.getByRole('menuitem', { name: /Add connected elements/ }).click();
	const form = page.getByRole('dialog', { name: 'Add connected elements of Battery' });
	await form.getByRole('button', { name: /Incoming/ }).click();
	await expect(toasts(page)).toContainText(/Added \d+ connected elements to this diagram/);
	await expect(toasts(page)).toContainText('this view’s filter leaves them out');
	// The view's text says so.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: /^Views\.sysml/ })
		.click();
	const text = page.locator('.cm-content');
	await expect(async () => {
		await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 900));
		await expect(text).toContainText('expose DroneArchitecture::drone::battery;', {
			timeout: 1000
		});
	}).toPass({ timeout: 15_000 });
});

test('duplicate copies an element beside it, selects the copy, and undoes in one step', async ({
	page
}) => {
	await openDemo(page);
	const diagram = await openFileDiagram(
		page,
		/^DroneArchitecture\.sysml/,
		/DroneArchitecture diagram/
	);
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await node(diagram, 'drone.battery').click({ button: 'right' });
	await page.getByRole('menuitem', { name: /^Duplicate/ }).click();
	await expect(node(diagram, 'drone.battery2')).toBeVisible({ timeout: 10_000 });
	await expect(toasts(page)).toContainText('Duplicated battery as battery2');
	await expect(inspector.getByRole('heading', { level: 2 })).toHaveText('battery2');
	await expect(page.locator('.cm-content')).toContainText('part battery2 : Battery;');
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(node(diagram, 'drone.battery2')).toHaveCount(0);

	// The keyboard: Ctrl+D (⌘D on a Mac) on the node.
	await node(diagram, 'drone.camera').focus();
	await page.keyboard.press('Control+d');
	await expect(node(diagram, 'drone.camera2')).toBeVisible({ timeout: 10_000 });
	// And the inspector's button, counting on from the last copy.
	await inspector.getByRole('button', { name: 'Duplicate' }).click();
	await expect(inspector.getByRole('heading', { level: 2 })).toHaveText('camera3', {
		timeout: 10_000
	});
	await expect(node(diagram, 'drone.camera3')).toBeVisible();
	await expectAccessible(page);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	/** Hold a finger on a node until its menu opens. */
	async function longPress(page: Page, target: Locator) {
		const box = (await target.boundingBox())!;
		const at = {
			pointerType: 'touch',
			isPrimary: true,
			pointerId: 7,
			clientX: box.x + box.width / 2,
			clientY: box.y + Math.min(box.height / 2, 14)
		};
		await target.dispatchEvent('pointerdown', at);
		await page.waitForTimeout(700);
		await target.dispatchEvent('pointerup', at);
	}

	async function openPhoneView(page: Page, name: string) {
		await page.getByRole('button', { name: /Switch view$/ }).click();
		const drawer = page.getByRole('dialog', { name: 'Views' });
		await drawer.getByRole('button', { name: new RegExp(`^${name} Diagram$`) }).click();
		await expect(drawer).toBeHidden();
		const diagram = page.getByRole('region', { name: new RegExp(`${name} diagram`) });
		await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });
		return diagram;
	}

	test('the node’s actions are a sheet: remove, show again, duplicate and add connected by touch', async ({
		page
	}) => {
		await openDemo(page);
		const catalogue = await openPhoneView(page, 'Component catalogue');
		await longPress(page, node(catalogue, 'Camera'));
		const sheet = page.getByRole('dialog', { name: 'Camera' });
		await expect(sheet).toBeVisible();
		for (const item of await sheet.getByRole('menuitem').all()) {
			expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
		await expectAccessible(page);
		await sheet.getByRole('menuitem', { name: /Remove from diagram/ }).click();
		await expect(sheet).toHaveCount(0);
		await expect(node(catalogue, 'Camera')).toHaveCount(0);
		// The hidden list is in thumb reach too.
		const hidden = catalogue.getByRole('group', { name: 'Hidden on this diagram' });
		const all = hidden.getByRole('button', { name: 'Show all' });
		expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await all.tap();
		await expect(node(catalogue, 'Camera')).toBeVisible();
		// Duplicate is in the sheet too.
		await longPress(page, node(catalogue, 'Camera'));
		await page
			.getByRole('dialog', { name: 'Camera' })
			.getByRole('menuitem', { name: 'Duplicate' })
			.click();
		await expect(node(catalogue, 'Camera2')).toBeVisible({ timeout: 10_000 });

		// Adding connected elements is a bottom sheet with thumb-sized choices.
		await longPress(page, node(catalogue, 'Battery'));
		await page
			.getByRole('dialog', { name: 'Battery' })
			.getByRole('menuitem', { name: /Add connected elements/ })
			.click();
		const form = page.getByRole('dialog', { name: 'Add connected elements of Battery' });
		await expect(form).toHaveClass(/sheet/);
		const incoming = form.getByRole('button', { name: /Incoming/ });
		expect((await incoming.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await expectAccessible(page);
		await incoming.tap();
		await expect(toasts(page)).toContainText(/Added \d+ connected elements to this diagram/);
	});
});
