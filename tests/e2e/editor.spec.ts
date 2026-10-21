import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

/** The demo with one file open as text. */
async function openText(page: Page, file: string) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: file, exact: true }).click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await expect(page.locator('.cm-content')).toBeVisible();
}

/** Select the first occurrence of `text` in the editor (the cursor ends after it). */
async function find(page: Page, text: string) {
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

test('the editor is coloured by the toolkit and hovers explain names', async ({ page }) => {
	await openText(page, 'DroneArchitecture.sysml');
	const editor = page.locator('.cm-content');
	await expect(editor.locator('.tok-keyword').first()).toHaveText('package');
	await expect(editor.locator('.tok-type-definition').first()).toBeVisible();
	await expect(editor.locator('.tok-comment-documentation').first()).toBeVisible();
	// Hover the `Battery` in `part battery : Battery;` (the editor draws only the lines in view).
	await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 400));
	const battery = editor.getByText('Battery', { exact: true }).first();
	await battery.hover();
	await expect(page.locator('.cm-tooltip-hover')).toContainText('DroneComponents::Battery');
	await expect(page.locator('.cm-tooltip-hover')).toContainText('Six-cell lithium-ion pack');
	await expectAccessible(page);
});

test('completion offers the project’s definitions, and rename changes every file', async ({
	page
}) => {
	await openText(page, 'DroneArchitecture.sysml');
	await find(page, 'part battery : Battery;');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('part spare : Batt');
	const options = page.locator('.cm-tooltip-autocomplete');
	await expect(options).toContainText('Battery');
	await page.keyboard.press('Escape');
	await page.keyboard.type('ery;');
	await expect(page.locator('.cm-content')).toContainText('part spare : Battery;');

	// F2 on `Battery`: rename it everywhere it is used.
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('F2');
	const input = page.getByRole('textbox', { name: 'New name for Battery' });
	await input.fill('PowerPack');
	await input.press('Enter');
	await expect(page.locator('.cm-content')).toContainText('part spare : PowerPack;');
	await expect(page.locator('.cm-content')).toContainText('part battery : PowerPack;');
	// The definition in Components.sysml changed too.
	await page.getByRole('tab', { name: 'Files' }).click();
	// (Edited files are marked, so the name has more after it.)
	await page
		.getByRole('button', { name: /^Components\.sysml/ })
		.first()
		.click();
	await expect(page.locator('.cm-content')).toContainText('part def PowerPack :> Component');
});
