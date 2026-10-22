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

	test('a long press opens the node’s actions as a sheet; remove from diagram works by touch', async ({
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
	});
});
