import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

/** Open the demo's FlightModes in the emulator by its deep link. */
async function openFlightModes(page: Page) {
	await page.goto('/p/demo#emulate=FlightControl::FlightModes');
	await expect(page.getByText(/Started in idle/)).toBeVisible({ timeout: 30_000 });
}

test('the emulator deep link runs a flight: guards, previews and a change trigger', async ({
	page
}) => {
	await openFlightModes(page);
	const emulator = page.locator('section.emulator');
	const arm = emulator.getByRole('button', { name: 'ArmCommand to armed' });
	await expect(arm).toHaveAttribute('aria-disabled', 'true');

	// The blocked event links to its variable; changing it previews the guard before the next step.
	await emulator.getByRole('button', { name: 'preflightChecksPassed', exact: true }).click();
	await emulator.getByRole('switch', { name: /preflightChecksPassed/ }).click();
	await expect(arm).toHaveAttribute('aria-disabled', 'false');
	await arm.click();
	await expect(emulator.getByText(/Now in armed/)).toBeVisible();
	await emulator.getByRole('button', { name: 'TakeOffCommand to flying' }).click();
	await expect(emulator.getByText(/Now in flying/)).toBeVisible();

	// The change trigger fires on a Step once the charge is low.
	const charge = emulator.getByRole('spinbutton', { name: /stateOfCharge/ });
	await charge.fill('0.1');
	await charge.press('Enter');
	await emulator.getByRole('button', { name: /^Step/ }).click();
	await expect(emulator.getByText(/Now in returningHome after lowBattery/)).toBeVisible();

	await emulator.getByRole('button', { name: 'ArrivedHome to landing' }).click();
	await emulator.getByRole('button', { name: 'TouchDown to idle' }).click();
	await expect(emulator.getByText(/Now in idle/)).toBeVisible();
	await expectAccessible(page);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('the emulator runs from its deep link without sideways scrolling', async ({ page }) => {
		await openFlightModes(page);
		const emulator = page.locator('section.emulator');
		await emulator.getByRole('button', { name: 'preflightChecksPassed', exact: true }).click();
		await emulator.getByRole('switch', { name: /preflightChecksPassed/ }).click();
		await emulator.getByRole('button', { name: 'ArmCommand to armed' }).click();
		await expect(emulator.getByText(/Now in armed/)).toBeVisible();
		const widths = await page.evaluate(() => {
			const d = document.documentElement;
			return { scroll: d.scrollWidth, client: d.clientWidth };
		});
		expect(widths.scroll).toBe(widths.client);
		await expectAccessible(page);
	});
});
