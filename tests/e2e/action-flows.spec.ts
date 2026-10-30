import { expect, test, type Locator, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

/** Open the demo's delivery flight in the action flow runner by its deep link. */
async function openDeliveryFlight(page: Page): Promise<Locator> {
	await page.goto('/p/demo#run=DeliveryMission::DeliveryFlight');
	const runner = page.locator('section.runner');
	await expect(runner.getByText('Started DeliveryFlight')).toBeVisible({ timeout: 30_000 });
	return runner;
}

const node = (runner: Locator, id: string) => runner.locator(`[data-node="${id}"]`);

async function noSideScroll(page: Page) {
	const widths = await page.evaluate(() => {
		const d = document.documentElement;
		return { scroll: d.scrollWidth, client: d.clientWidth };
	});
	expect(widths.scroll).toBe(widths.client);
}

test('the delivery flight runs step by step: fork, join, decision and merge on the diagram', async ({
	page
}) => {
	const runner = await openDeliveryFlight(page);
	const step = runner.getByRole('button', { name: 'Step', exact: true });
	await expect(node(runner, 'takeOff')).toHaveClass(/is-running/);

	await step.click();
	await expect(runner.getByText('takeOff ended; flyToDropPoint started')).toBeVisible();
	await expect(node(runner, 'takeOff')).toHaveClass(/is-done/);

	// The fork starts both at once.
	await step.click();
	await expect(
		runner.getByText('flyToDropPoint ended; descend and checkDropZone started')
	).toBeVisible();
	await expect(node(runner, 'descend')).toHaveClass(/is-running/);
	await expect(node(runner, 'checkDropZone')).toHaveClass(/is-running/);

	// The join waits for both, the decision reads the drop-zone check.
	await step.click();
	await expect(
		runner.getByText('descend and checkDropZone ended; releaseParcel started')
	).toBeVisible();
	await step.click();
	await step.click();
	await step.click();
	await expect(runner.getByText(/land ended\. The action completed/)).toBeVisible();
	await expect(runner.getByText('Completed', { exact: true })).toBeVisible();
	await expect(node(runner, 'keepParcel')).not.toHaveClass(/is-done/);

	// The timeline lists every step; Back goes to an earlier one.
	const timeline = runner.locator('.trace li');
	await expect(timeline).toHaveCount(7);
	await runner.getByRole('button', { name: 'Back' }).click();
	await expect(node(runner, 'land')).toHaveClass(/is-running/);
	await expectAccessible(page);
});

test('a value given before the decision takes the other branch', async ({ page }) => {
	const runner = await openDeliveryFlight(page);
	const step = runner.getByRole('button', { name: 'Step', exact: true });
	await step.click();
	await step.click();
	await expect(node(runner, 'checkDropZone')).toHaveClass(/is-running/);
	// The Values section starts folded where the tab is narrow.
	const values = runner.locator('details.section').first();
	if (!(await values.evaluate((d) => (d as HTMLDetailsElement).open)))
		await values.locator('summary').click();
	await runner.getByLabel(/checkDropZone\.isClear/).selectOption('false');
	await step.click();
	await expect(
		runner.getByText('descend and checkDropZone ended; keepParcel started')
	).toBeVisible();
});

test('Simulations offers the action flows, and auto-run takes the use case through the flight it performs', async ({
	page
}) => {
	await page.goto('/p/demo');
	await page.getByRole('button', { name: 'Run Deliver parcel' }).click();
	const runner = page.locator('section.runner');
	await expect(runner.getByText('Started DeliverParcel')).toBeVisible({ timeout: 30_000 });
	await runner.getByRole('button', { name: 'Auto-run' }).click();
	// The performed flight is drawn while it runs, under the use case's name.
	const crumbs = runner.getByRole('navigation', { name: 'Performed actions' });
	await expect(crumbs).toContainText('drone.deliveryFlight', { timeout: 20_000 });
	await expect(runner.getByText('Completed', { exact: true })).toBeVisible({ timeout: 40_000 });
});

test.describe('on a short phone', () => {
	test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

	test('the delivery flight runs to the end, the running step in sight', async ({ page }) => {
		const runner = await openDeliveryFlight(page);
		const step = runner.getByRole('button', { name: 'Step', exact: true });
		await step.click();
		await step.click();
		await expect(node(runner, 'descend')).toHaveClass(/is-running/);
		const box = async (selector: string) => (await runner.locator(selector).first().boundingBox())!;
		// The diagram keeps a good part of the screen above the controls, with the running step in it.
		await expect
			.poll(async () => {
				const [area, stage, dock] = [
					await runner.boundingBox(),
					await box('.stage'),
					await box('.dock')
				];
				const seen = Math.min(stage.y + stage.height, dock.y) - Math.max(stage.y, area!.y);
				return seen / area!.height;
			})
			.toBeGreaterThanOrEqual(0.45);
		await expect
			.poll(async () => {
				const now = await box('.action.is-running');
				const [stage, dock] = [await box('.stage'), await box('.dock')];
				return now.y >= stage.y && now.y + now.height <= dock.y;
			})
			.toBe(true);
		for (let i = 0; i < 4; i++) await step.click();
		await expect(runner.getByText('Completed', { exact: true })).toBeVisible();
		await noSideScroll(page);
		await expectAccessible(page);
	});
});
