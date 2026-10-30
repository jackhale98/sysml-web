/**
 * Fault trees and the reliability budget in the demo: the tree of
 * uncontrolled descent draws its events with their gates and
 * probabilities, an event selects its element, and the reliability budget
 * adds up the failure rates to the drone's MTBF against its requirement.
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

test('the fault tree of uncontrolled descent', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Drone falls tree', exact: true }).click();
	const diagram = page.getByRole('group', { name: 'Drone falls tree diagram' });
	const tree = diagram.getByRole('list', { name: 'Fault tree of droneFalls' });
	await expect(tree.getByRole('button').first()).toBeVisible({ timeout: 15_000 });
	// The top event, three gates below it and seven basic events; the board under two gates.
	await expect(tree.getByRole('button')).toHaveCount(12);
	await expect(tree.getByRole('button').first()).toHaveAccessibleName(
		/^Top event: droneFalls .* OR gate, P = 8\.5E-6$/
	);
	await expect(
		tree.getByRole('button', { name: /^Event: batteryRunsFlat .* AND gate,/ })
	).toBeVisible();
	await expect(
		tree.getByRole('button', { name: /^Basic event: boardFails .*repeated$/ })
	).toHaveCount(2);
	await expect(diagram.getByRole('list', { name: 'Top events' })).toContainText(
		'droneFalls: probability 8.5E-6, at most 1E-5 · 6 minimal cut sets'
	);
	await expect(diagram.getByRole('list', { name: 'Top events' })).toContainText('Satisfied');

	// An event selects its element.
	await tree.getByRole('button', { name: /^Basic event: motorStops/ }).click();
	await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('motorStops');

	const results = await analyze(page);
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
	).toEqual([]);
});

test('the minimal cut sets and the reliability budget', async ({ page }) => {
	await openDemo(page);
	await views(page).getByRole('button', { name: 'Drone falls cut sets', exact: true }).click();
	const cuts = page.getByRole('region', { name: 'Drone falls cut sets view' });
	await expect(cuts.getByText('6 rows')).toBeVisible({ timeout: 15_000 });
	await expect(cuts.locator('tbody tr').first()).toContainText('motorStops');
	await expect(cuts.locator('tbody tr').nth(1)).toContainText('lowCharge and returnNotTriggered');

	await views(page).getByRole('button', { name: 'Drone reliability budget', exact: true }).click();
	const budget = page.getByRole('region', { name: 'Drone reliability budget view' });
	await expect(budget.getByText('25 rows')).toBeVisible({ timeout: 15_000 });
	const drone = budget.locator('tbody tr').first();
	await expect(drone).toContainText('215000 FIT');
	await expect(drone).toContainText('4651 h');
	await expect(drone).toContainText('2651 h (133 %)');
	await expect(drone.getByText('Satisfied')).toBeAttached();
});
