import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

/**
 * The demo's `GroundLink::linkTest`: the ground station's console and the
 * flight controller, each running its own state machine on one clock, the
 * console's commands going over the command link between their ports.
 */
async function openLinkTest(page: Page) {
	await page.goto('/p/demo#emulate=GroundLink::linkTest');
	const emulator = page.locator('section.emulator.system');
	await expect(emulator.getByRole('region', { name: /station: console/ })).toBeVisible({
		timeout: 30_000
	});
	return emulator;
}

test.describe('on a desktop screen', () => {
	// Room for both machines beside the explorer and the side panel.
	test.use({ viewport: { width: 1680, height: 1000 } });

	test('two parts run together: the console commands the flight controller over the link', async ({
		page
	}) => {
		const emulator = await openLinkTest(page);
		// Side by side on a wide screen.
		await expect(emulator.getByRole('region', { name: /controller: FlightModes/ })).toBeVisible();
		await expect(emulator.locator('[data-part-state="station"]')).toHaveText('standby');
		await expect(emulator.locator('[data-part-state="controller"]')).toHaveText('idle');

		// The flight controller's checks have passed (a variable of its machine).
		await emulator.getByRole('button', { name: /^controller FlightModes/ }).click();
		await emulator.getByRole('switch', { name: /preflightChecksPassed/ }).click();

		// The operator starts the flight at the console.
		await emulator.getByRole('button', { name: /^station console/ }).click();
		await expect(emulator.getByText('Events for station')).toBeVisible();
		await emulator.getByRole('button', { name: 'StartFlight to arming' }).click();
		await expect(emulator.locator('[data-part-state="station"]')).toHaveText('arming');

		// The timeline says who sent what to whom.
		const timeline = emulator.getByRole('list', { name: 'Timeline of every part' });
		await expect(timeline).toContainText('sent ArmCommand through commandLink to controller');

		// A Step: the flight controller takes the command.
		await emulator.getByRole('button', { name: /^Step/ }).click();
		await expect(emulator.locator('[data-part-state="controller"]')).toHaveText('armed');

		// Wait to the console's timer: it sends the take-off, and the drone flies, on one clock.
		await emulator.getByRole('button', { name: /^Wait/ }).click();
		await expect(emulator.locator('[data-part-state="controller"]')).toHaveText('cruising');
		await expect(emulator.locator('[data-part-state="station"]')).toHaveText('watching');
		await expect(emulator.getByRole('group', { name: /^Time/ })).toContainText('10 s');
		await expect(timeline).toContainText('sent TakeOffCommand through commandLink to controller');

		const results = await analyze(page);
		expect(results.violations.map((v) => v.id)).toEqual([]);
	});

	/** A machine that reads the values of the signal it accepts. */
	const GAUGE = `
    item def Reading { attribute v : ScalarValues::Integer default 1; }
    state def Gauge {
        attribute last : ScalarValues::Integer = 0;
        entry; then low;
        state low; state high;
        transition first low accept r : Reading if r.v > 5 do assign last := r.v then high;
    }`;

	test('a signal sent with the event buttons carries the values given', async ({ page }) => {
		await page.goto('/p/demo');
		await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
			timeout: 30_000
		});
		await page.getByRole('tab', { name: 'Files' }).click();
		await page
			.getByRole('navigation', { name: 'Explorer' })
			.getByRole('button', { name: 'FlightControl.sysml', exact: true })
			.click();
		await page.locator('.cm-content').getByText('private import DroneInterfaces::*;').click();
		await page.keyboard.press('End');
		await page.keyboard.insertText(GAUGE);
		await page.getByRole('tab', { name: 'Model' }).click();
		const simulations = page.locator('section[aria-labelledby="views-heading"]');
		const run = simulations.getByRole('button', { name: 'Run Gauge' });
		await expect(run).toBeVisible({ timeout: 15_000 });
		await run.click();
		const emulator = page.locator('section.emulator');
		await expect(emulator.getByText('Started in low')).toBeVisible({ timeout: 15_000 });

		// With its definition's default (1) the guard is false.
		const reading = emulator.getByRole('button', { name: 'Reading to high' });
		await expect(reading).toHaveAttribute('aria-disabled', 'true');
		await emulator.getByRole('button', { name: 'Values for Reading' }).click();
		const form = emulator.getByRole('form', { name: 'Values of Reading' });
		await expect(form.getByRole('spinbutton', { name: /^v/ })).toHaveValue('1');
		await form.getByRole('spinbutton', { name: /^v/ }).fill('7');
		await form.getByRole('button', { name: 'Send Reading' }).click();
		await expect(emulator.getByText(/Now in high/)).toBeVisible();
		await expect(emulator.getByRole('spinbutton', { name: /^last/ })).toHaveValue('7');
	});
});

test.describe('on a short phone', () => {
	test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

	test('one machine at a time, switched with tabs, the events below it', async ({ page }) => {
		const emulator = await openLinkTest(page);
		const tabs = emulator.getByRole('tablist', { name: 'Parts' });
		await expect(tabs.getByRole('tab')).toHaveCount(2);
		// Only the selected part's machine is drawn.
		await expect(emulator.getByRole('region', { name: /controller: FlightModes/ })).toHaveCount(0);

		await emulator.getByRole('button', { name: 'StartFlight to arming' }).click();
		await expect(tabs.getByRole('tab', { name: /station/ })).toContainText('arming');

		await tabs.getByRole('tab', { name: /controller/ }).click();
		await expect(emulator.getByRole('region', { name: /controller: FlightModes/ })).toBeVisible();
		await expect(emulator.getByText('Events for controller')).toBeVisible();
		// The command waits at the controller; a Step takes it (its guard has no value yet: dropped).
		await expect(emulator.getByText('1 waiting')).toBeVisible();

		// The machine keeps a good part of the screen above the events.
		const box = async (selector: string) => (await emulator.locator(selector).boundingBox())!;
		await emulator.evaluate((el) => el.scrollTo({ top: 0 }));
		await expect
			.poll(async () => {
				const [area, stage, dock] = [
					await emulator.boundingBox(),
					await box('.stage'),
					await box('.dock')
				];
				return (
					(Math.min(stage.y + stage.height, dock.y) - Math.max(stage.y, area!.y)) / area!.height
				);
			})
			.toBeGreaterThanOrEqual(0.35);
		// No sideways scroll of the page.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
