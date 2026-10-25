/**
 * Assessment §6: what a person sees when a calculation has no answer. The
 * drone's hover power set to 0 W makes its endurance a division by zero:
 * the inspector shows `?` and why, the requirement's check is undecided
 * (not met, not satisfied), and the mass budget is unaffected; undo puts
 * every value back.
 */
import { expect, test, type Page } from '@playwright/test';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

async function openView(page: Page, title: string) {
	await views(page).getByRole('button', { name: title }).click();
	return page.getByRole('region', { name: `${title} view` });
}

async function select(page: Page, name: string, kind: string, nth = 0, file?: string) {
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill(name);
	await palette
		.getByRole('option')
		.filter({ hasText: new RegExp(`^\\s*${name}\\s+${kind}\\b`) })
		.filter({ hasText: file ?? '' })
		.nth(nth)
		.click();
	await expect(palette).toBeHidden();
	return page.getByRole('complementary', { name: 'Inspector' });
}

test('a division by zero shows as unknown, with the reason, never as a number', async ({ page }) => {
	await openDemo(page);
	const power = await select(page, 'hoverPower', 'attribute', 1, 'DroneArchitecture.sysml');
	const value = power.getByRole('textbox', { name: /^Value \(/ });
	await expect(value).toHaveValue('400 [W]');
	await value.fill('0 [W]');
	await value.press('Enter');

	// endurance = HoverEndurance(usable energy, 0 W): energy / power has no value.
	const endurance = await select(page, 'endurance', 'attribute', 1, 'DroneArchitecture.sysml');
	await expect(endurance.getByText('= ?')).toBeVisible({ timeout: 15_000 });
	await endurance.getByRole('button', { name: 'Why?' }).click();
	await expect(endurance).toContainText(/division by zero/i);

	// The requirement it decides is neither met nor violated.
	const checks = await openView(page, 'Design checks');
	await expect(checks.locator('tbody tr').filter({ hasText: 'SYS-001' })).toContainText(
		'Undecided',
		{ timeout: 15_000 }
	);
	// The mass budget doesn't depend on it: the drone still weighs 2770 g.
	const budget = await openView(page, 'Drone mass budget');
	await expect(
		budget
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: 'drone', exact: true }) })
	).toContainText('2770 g', { timeout: 15_000 });

	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	const checksAgain = await openView(page, 'Design checks');
	await expect(checksAgain.locator('tbody tr').filter({ hasText: 'SYS-001' })).toContainText(
		'Satisfied',
		{ timeout: 15_000 }
	);
});
