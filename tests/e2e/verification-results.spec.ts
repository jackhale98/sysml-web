/**
 * Recording a verification result from the inspector: the case's
 * `@VerificationResult` written as one undoable step, and the result shown
 * where the requirement it verifies is (its details, the requirements
 * table), with whether it still holds (a project not on GitHub: commit
 * unknown).
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

/** Select an element with the command palette; the inspector then shows it. */
async function select(page: Page, name: string) {
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill(name);
	await palette
		.getByRole('option')
		.filter({ hasText: new RegExp(`^\\s*${name}\\b`) })
		.first()
		.click();
	await expect(palette).toBeHidden();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(new RegExp(`\\b${name}$`));
	return inspector;
}

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test('a test result is recorded on its case, shown on its requirement, and undone', async ({
	page
}) => {
	await openDemo(page);
	const vc = await select(page, 'enduranceFlightTest');
	await expect(vc.getByText('Not run yet: no result is recorded.')).toBeVisible();
	await vc.getByRole('button', { name: 'Record a result' }).click();
	const form = vc.getByRole('form', { name: 'Record a result for enduranceFlightTest' });
	await form.getByRole('radio', { name: 'Failed' }).check();
	await form.getByLabel('Run by').fill('A. Engineer');
	await form.getByLabel('Evidence').fill('https://example.com/log-17.csv');
	// The demo is not on GitHub: no commit to fill in, and it says why.
	await expect(form.getByLabel('Commit of the model')).toHaveValue('');
	await expect(form).toContainText('Not connected to GitHub');
	expect((await analyze(page)).violations.map((v) => v.id)).toEqual([]);
	await form.getByRole('button', { name: 'Record' }).click();
	await expect(toasts(page)).toContainText('Recorded enduranceFlightTest: failed');
	await expect(vc.getByText('Failed', { exact: true })).toBeVisible({ timeout: 15_000 });
	await expect(vc).toContainText('Commit unknown');

	const requirement = await select(page, 'Flight endurance');
	await expect(requirement.locator('.outcome')).toHaveText('Failed');

	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(requirement.locator('.outcome')).toHaveText('Not run', { timeout: 15_000 });
});
