/**
 * Assessment (§5, state machine simulation): what the simulator tells the
 * user, in the app, about pending transitions, constructs it cannot run and
 * machines that never let time pass. The semantics themselves are checked in
 * `src/lib/sim/reference-traces.assessment.test.ts`.
 */
import { expect, test, type Page } from '@playwright/test';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

/** Type machines at the end of the demo's FlightControl.sysml and open one in the simulator. */
async function runTyped(page: Page, text: string, title: string) {
	await openDemo(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: 'FlightControl.sysml', exact: true })
		.click();
	await page.locator('.cm-content').getByText('private import DroneInterfaces::*;').click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(text);
	await page.getByRole('tab', { name: 'Model' }).click();
	const simulations = page.locator('section[aria-labelledby="views-heading"]');
	const run = simulations.getByRole('button', { name: `Run ${title}` });
	await expect(run).toBeVisible({ timeout: 15_000 });
	await run.click();
	const emulator = page.locator('section.emulator');
	await expect(emulator.getByText(/^Started in/)).toBeVisible({ timeout: 15_000 });
	return emulator;
}

const MACHINES = `
    state def PendingStep {
        entry; then a;
        state a; state b; state c; state d;
        transition first a then b;
        transition first a accept Go then c;
        transition first b accept Go then d;
    }
    state def Aborting {
        entry; then on;
        state on;
        accept Abort then stop;
        action stop terminate;
    }
    state def Spinning {
        entry; then a;
        state a; state b;
        transition first a then b;
        transition first b then a;
    }`;

test('an event waits while a transition without a trigger is ready: Step first', async ({
	page
}) => {
	const emulator = await runTyped(page, MACHINES, 'Pending step');
	// `a` is left as soon as it is entered; Go cannot be taken from it.
	const go = emulator.getByRole('button', { name: /^Go to/ });
	await expect(go).toHaveAttribute('aria-disabled', 'true');
	await emulator.getByRole('button', { name: /^Step/ }).click();
	await expect(emulator.getByText(/Now in b/)).toBeVisible();
	await emulator.getByRole('button', { name: 'Go to d' }).click();
	await expect(emulator.getByText(/Now in d after Go/)).toBeVisible();
});

test('a machine with a construct the simulator cannot run says so before it runs', async ({
	page
}) => {
	const emulator = await runTyped(page, MACHINES, 'Aborting');
	await expect(emulator.getByText(/may not run as written/)).toBeVisible();
});

test('a machine that never lets time pass stops a Wait and says why', async ({ page }) => {
	const emulator = await runTyped(page, MACHINES, 'Spinning');
	await emulator.getByLabel('How long to wait').selectOption('10');
	await emulator.getByRole('button', { name: 'Wait' }).click();
	await expect(emulator.getByText(/stopped after 200 steps/).first()).toBeVisible();
});
