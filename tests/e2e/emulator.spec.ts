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
	await emulator.getByRole('button', { name: 'TouchDown to charging' }).click();
	await expect(emulator.getByText(/Now in charging/)).toBeVisible();
	await expectAccessible(page);
});

/**
 * The demo through a whole charge cycle without typing a value: Steps let
 * time pass, the flight drains the battery, the drone flies home, lands and
 * charges until it is ready again.
 */
async function chargeCycle(page: Page) {
	await openFlightModes(page);
	const emulator = page.locator('section.emulator');
	const clock = emulator.getByRole('group', { name: /^Time/ });
	const step = emulator.getByRole('button', { name: /^Step/ });
	await expect(clock).toContainText('0 s');
	await emulator.getByRole('button', { name: 'preflightChecksPassed', exact: true }).click();
	await emulator.getByRole('switch', { name: /preflightChecksPassed/ }).click();
	await emulator.getByRole('button', { name: 'ArmCommand to armed' }).click();
	await expect(emulator.getByText(/Now in armed/)).toBeVisible();
	await emulator.getByRole('button', { name: 'TakeOffCommand to flying' }).click();
	await expect(emulator.getByText(/Now in flying\.cruising/)).toBeVisible();

	// Each Step lets 5 minutes pass in the air; the battery runs down.
	await expect(step).toContainText('in 5 min: useCharge');
	for (const minutes of [5, 10, 15, 20, 25]) {
		await step.click();
		await expect(
			emulator.getByText(`Now in flying.cruising after useCharge, at ${minutes} min`)
		).toBeVisible();
	}
	await expect(clock).toContainText('25 min');
	// The low charge is taken at once, with no more time passing.
	await expect(step).toContainText('lowBattery');
	await step.click();
	await expect(
		emulator.getByText('Now in returningHome after lowBattery, at 25 min')
	).toBeVisible();

	await emulator.getByRole('button', { name: 'ArrivedHome to landing' }).click();
	await expect(emulator.getByText(/Now in landing/)).toBeVisible();
	await emulator.getByRole('button', { name: 'TouchDown to charging' }).click();
	await expect(emulator.getByText(/Now in charging/)).toBeVisible();

	// Wait until the next timer: 10 minutes on the charger.
	await emulator.getByRole('button', { name: 'Wait', exact: true }).click();
	await expect(emulator.getByText('Now in charging after addCharge, at 35 min')).toBeVisible();
	await step.click();
	await expect(emulator.getByText(/at 45 min/)).toBeVisible();
	await step.click();
	await expect(emulator.getByText(/at 55 min/)).toBeVisible();
	await step.click();
	await expect(emulator.getByText('Now in idle after charged, at 55 min')).toBeVisible();
	await expect(clock).toContainText('55 min');
	return emulator;
}

test('the demo drains its battery in flight and charges it on the ground, step by step', async ({
	page
}) => {
	const emulator = await chargeCycle(page);
	// The timeline says when each step happened.
	const last = emulator.locator('ol.trace li').last();
	await expect(last).toContainText('charging');
	await expect(last).toContainText('55 min');
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

	test('the demo runs a whole charge cycle, with time shown', async ({ page }) => {
		await chargeCycle(page);
		const widths = await page.evaluate(() => {
			const d = document.documentElement;
			return { scroll: d.scrollWidth, client: d.clientWidth };
		});
		expect(widths.scroll).toBe(widths.client);
		await expectAccessible(page);
	});
});
