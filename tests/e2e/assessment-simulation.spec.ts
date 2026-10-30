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
    }
    state def Looping {
        attribute n : Integer = 0;
        entry; then on;
        // An accept inside a state's action cannot wait within one step: the simulator says so.
        state on { entry action { accept Ping; assign n := 1; } }
        state off;
        state island;
        transition first on accept Stop then off;
        transition first island accept Go then off;
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

test('a machine with a construct the simulator cannot run says so before it runs, and what it can never reach', async ({
	page
}) => {
	const emulator = await runTyped(page, MACHINES, 'Looping');
	await expect(emulator.getByText(/may not run as written/)).toBeVisible();
	const reach = emulator.getByText(/1 state can never be reached; 1 transition can never fire/);
	await expect(reach).toBeVisible();
	await reach.click();
	await expect(emulator.getByText('state island: no transition can reach it')).toBeVisible();
});

test('a transition to a terminate action ends the machine', async ({ page }) => {
	const emulator = await runTyped(page, MACHINES, 'Aborting');
	await expect(emulator.getByText(/may not run as written/)).toHaveCount(0);
	await emulator.getByRole('button', { name: /^Abort to/ }).click();
	await expect(emulator.getByText('Completed', { exact: true })).toBeVisible();
});

test('a machine that never lets time pass stops a Wait and says why at once', async ({ page }) => {
	const emulator = await runTyped(page, MACHINES, 'Spinning');
	await emulator.getByLabel('How long to wait').selectOption('10');
	await emulator.getByRole('button', { name: 'Wait' }).click();
	// The 200 steps are not animated one by one (that took about 1.5 min): the reason shows now.
	await expect(emulator.getByText(/stopped after 200 steps/).first()).toBeVisible({
		timeout: 10_000
	});
	await expect(emulator.getByText(/Step 200/).first()).toBeVisible();
});

test('the Timeline says why each step fired and saves the run', async ({ page }) => {
	const emulator = await runTyped(page, MACHINES, 'Pending step');
	await emulator.getByRole('button', { name: /^Step/ }).click();
	await emulator.getByRole('button', { name: 'Go to d' }).click();
	await expect(emulator.getByText(/Now in d after Go/)).toBeVisible();
	// The Timeline starts folded where the emulator is narrow.
	const timeline = emulator.locator('details.section', { hasText: 'Timeline' });
	await timeline.evaluate((d) => ((d as HTMLDetailsElement).open = true));
	await expect(emulator.getByText('completion of a')).toBeVisible();
	await expect(emulator.getByText('event Go')).toBeVisible();
	const [csv] = await Promise.all([
		page.waitForEvent('download'),
		emulator.getByRole('button', { name: 'CSV' }).click()
	]);
	expect(csv.suggestedFilename()).toBe('PendingStep run.csv');
	const [json] = await Promise.all([
		page.waitForEvent('download'),
		emulator.getByRole('button', { name: 'JSON' }).click()
	]);
	const { readFile } = await import('node:fs/promises');
	const run = JSON.parse(await readFile((await json.path())!, 'utf8')) as {
		machine: { qualifiedName: string };
		trace: unknown[];
	};
	expect(run.machine.qualifiedName).toMatch(/PendingStep$/);
	expect(run.trace).toHaveLength(3);
});
