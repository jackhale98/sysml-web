/**
 * An element's menu in the model tree (⋯, a right click, Shift+F10, or a
 * long press on a phone): duplicate, rename, show in text and delete from
 * the model, each the same action the inspector and diagrams have; and
 * "Duplicate" in the search box for the selected element.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

async function expectAccessible(page: Page, where: string) {
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`),
		`accessibility of ${where}`
	).toEqual([]);
}

async function newProject(page: Page, name: string) {
	await page.goto('/projects');
	await page.getByLabel('Name').fill(name);
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\//);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' }).first()).toBeVisible({
		timeout: 30_000
	});
}

const tree = (page: Page) => page.getByRole('tree', { name: 'Model' });
/** An element's row in the tree, by its name. */
const row = (page: Page, name: string) => tree(page).getByRole('button', { name, exact: true });
/** An element's ⋯ button. */
const more = (page: Page, name: string) =>
	tree(page).getByRole('button', { name: 'More actions', description: name, exact: true });
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const dialog = (page: Page) => page.getByTestId('element-dialog');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test('the tree’s element menu duplicates, renames, shows in text and deletes', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Menu bench');

	await more(page, 'System').click();
	const menu = page.getByRole('menu', { name: 'System' });
	await expect(menu.getByRole('menuitem')).toHaveText([
		/^\s*Duplicate\s*$/,
		/^\s*Rename…\s*F2$/,
		/^\s*Show in text\s*$/,
		/^\s*Delete from model… Takes it out of the text\s*$/
	]);
	await expect(menu.getByRole('menuitem').first()).toBeFocused();
	await expectAccessible(page, 'the element menu');
	// Escape closes it, back on its button.
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(more(page, 'System')).toBeFocused();

	// Duplicate: the copy is selected.
	await more(page, 'System').click();
	await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
	await expect(toasts(page)).toContainText('Duplicated System as System2');
	await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('System2', {
		timeout: 10_000
	});
	await expect(row(page, 'System2')).toBeVisible();

	// Rename, from the keyboard: Shift+F10 on the row opens its menu.
	await row(page, 'System2').focus();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menu', { name: 'System2' })).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(dialog(page).getByRole('heading', { name: 'Rename System2' })).toBeVisible();
	const name = dialog(page).getByLabel('Name');
	await expect(name).toBeFocused();
	await expectAccessible(page, 'the rename dialog');
	await page.keyboard.type('Spare');
	await page.keyboard.press('Enter');
	await expect(dialog(page)).toBeHidden();
	await expect(toasts(page)).toContainText('Renamed System2 to Spare');
	await expect(row(page, 'Spare')).toBeVisible({ timeout: 10_000 });

	// Delete from the model: it says what else uses it first.
	await more(page, 'Spare').click();
	await page.getByRole('menuitem', { name: /^Delete from model/ }).click();
	await expect(
		dialog(page).getByRole('heading', { name: 'Delete Spare from the model?' })
	).toBeVisible();
	await expect(dialog(page)).toContainText('Nothing else in the model refers to it.');
	await expectAccessible(page, 'the delete dialog');
	await dialog(page).getByRole('button', { name: 'Delete' }).click();
	await expect(dialog(page)).toBeHidden();
	await expect(row(page, 'Spare')).toHaveCount(0);
	await expect(more(page, 'System')).toBeVisible();

	// Show in text: its file opens.
	await more(page, 'System').click();
	await page.getByRole('menuitem', { name: 'Show in text' }).click();
	await expect(
		page
			.getByRole('list', { name: 'Open editors' })
			.getByRole('button', { name: /^MenuBench\.sysml/ })
	).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('part def System {');
});

test('the search box duplicates the selected element', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await newProject(page, 'Copy bench');
	await row(page, 'system').click();
	await page.keyboard.press('ControlOrMeta+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('duplicate');
	await palette.getByRole('option', { name: /Duplicate system/ }).click();
	await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('system2', {
		timeout: 10_000
	});
	await expect(toasts(page)).toContainText('Duplicated system as system2');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	/** Hold a finger on an element until its menu opens. */
	async function longPress(page: Page, target: Locator) {
		const box = (await target.boundingBox())!;
		const at = {
			pointerType: 'touch',
			isPrimary: true,
			pointerId: 7,
			clientX: box.x + box.width / 2,
			clientY: box.y + box.height / 2
		};
		await target.dispatchEvent('pointerdown', at);
		await page.waitForTimeout(700);
		await target.dispatchEvent('pointerup', at);
	}

	test('a long press or ⋯ opens the element’s menu as a sheet, with thumb-sized targets', async ({
		page
	}) => {
		await newProject(page, 'Pocket menu');
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		await expect(row(page, 'System')).toBeVisible();

		await longPress(page, row(page, 'System'));
		const sheet = page.getByRole('dialog', { name: 'System' });
		await expect(sheet).toBeVisible();
		for (const item of await sheet.getByRole('menuitem').all())
			expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await expectAccessible(page, 'the element sheet');
		await sheet.getByRole('menuitem', { name: 'Duplicate' }).click();
		await expect(toasts(page)).toContainText('Duplicated System as System2');

		// The ⋯ button is as big as a thumb, and renames in a sheet.
		await page.getByRole('button', { name: 'Close details' }).click();
		const dots = more(page, 'System2');
		const box = (await dots.boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
		await dots.click();
		await page
			.getByRole('dialog', { name: 'System2' })
			.getByRole('menuitem', { name: /^Rename/ })
			.click();
		await expect(dialog(page).getByRole('heading', { name: 'Rename System2' })).toBeVisible();
		await dialog(page).getByLabel('Name').fill('Spare');
		await expectAccessible(page, 'the rename sheet');
		await dialog(page).getByRole('button', { name: 'Rename' }).click();
		await expect(row(page, 'Spare')).toBeVisible({ timeout: 10_000 });
	});
});
