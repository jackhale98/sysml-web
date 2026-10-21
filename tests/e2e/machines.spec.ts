import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

/** A parallel state def: both regions take the same event (classic didn't see `parallel` here). */
const PAYLOAD = `
    state def PayloadModes parallel {
        state latch {
            entry; then closed;
            state closed;
            state open;
            transition first closed accept Release then open;
        }
        state camera {
            entry; then standby;
            state standby;
            state recording;
            transition first standby accept Release then recording;
        }
    }`;

test('a state machine typed into the model is listed and runs, its regions in parallel', async ({
	page
}) => {
	await openDemo(page);
	const simulations = page.locator('section[aria-labelledby="views-heading"]');
	await expect(simulations.getByRole('button', { name: 'Run FlightModes' })).toBeVisible();

	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: 'FlightControl.sysml behaviour' }).click();
	await page.locator('.cm-content').getByText('private import DroneInterfaces::*;').click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(PAYLOAD);

	await page.getByRole('tab', { name: 'Model' }).click();
	const run = simulations.getByRole('button', { name: 'Run PayloadModes' });
	await expect(run).toBeVisible({ timeout: 15_000 });
	await run.click();
	const emulator = page.locator('section.emulator');
	await expect(emulator.getByText('Started in latch.closed and camera.standby')).toBeVisible({
		timeout: 15_000
	});
	await emulator.getByRole('button', { name: /^Release to/ }).click();
	await expect(emulator.getByText(/Now in latch\.open and camera\.recording/)).toBeVisible();
	await expectAccessible(page);
});
