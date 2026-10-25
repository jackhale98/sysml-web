/**
 * Assessment (docs/assessment/01-language.md, checklist 1.2): the editor
 * while someone types an unfinished declaration into the demo. The page
 * must not fail, the rest of the model must stay in the explorer, the
 * problem must be counted while the text is broken, and the count must go
 * back to the demo's own when the declaration is finished.
 */
import { expect, test, type Page } from '@playwright/test';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

test('typing an unfinished declaration keeps the model and counts the problem until it is finished', async ({
	page
}) => {
	const failures: string[] = [];
	page.on('pageerror', (error) => failures.push(error.message));
	await openDemo(page);
	const problems = page.getByRole('button', { name: /^Problems:/ });
	await expect(problems).toHaveAccessibleName('Problems: 0 errors, 2 warnings');

	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: /DroneArchitecture/ })
		.click();
	await page.locator('.cm-content').getByText('private import ISQ::*;').click();
	await page.keyboard.press('End');
	// Typed key by key: every prefix is analysed as it would be in use.
	await page.keyboard.type('\n    part def Hook { attribute load :> ISQ::mass', { delay: 20 });
	await expect(problems).toHaveAccessibleName(/Problems: [1-9]\d* errors?/, { timeout: 15_000 });
	// The rest of the model is still there while the text is broken.
	await page.getByRole('tab', { name: 'Model' }).click();
	const tree = page.getByRole('tree', { name: 'Model' });
	await expect(tree).toContainText('DroneArchitecture');
	await expect(tree).toContainText('DroneComponents');

	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: /DroneArchitecture/ })
		.click();
	// Finish the line (retyped whole, so it doesn't matter whether the editor closed the brace).
	await page.locator('.cm-content').getByText('attribute load :> ISQ::mass').click();
	await page.keyboard.press('End');
	await page.keyboard.press('Shift+Home');
	await page.keyboard.type('part def Hook { attribute load :> ISQ::mass; }', { delay: 20 });
	await expect(problems).toHaveAccessibleName('Problems: 0 errors, 2 warnings', {
		timeout: 15_000
	});
	expect(failures).toEqual([]);
});
