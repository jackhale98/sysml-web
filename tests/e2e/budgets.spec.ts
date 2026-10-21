/**
 * Budgets and constraint checks: the mass and power budgets add up the parts
 * tree with the values the engine evaluates; the checks view says whether
 * the design meets each requirement stated as a constraint, and shows the
 * claim in the text; a violation is a problem until it is undone; the
 * inspector shows what an expression comes to.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations.map((v) => v.id)).toEqual([]);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const problems = (page: Page) => page.getByRole('button', { name: /^Problems:/ });

async function openView(page: Page, title: string) {
	await views(page).getByRole('button', { name: title }).click();
	return page.getByRole('region', { name: `${title} view` });
}

/** Select an element with the command palette: the `nth` one of that name and kind. */
async function select(page: Page, name: string, kind: string, nth = 0) {
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill(name);
	await palette
		.getByRole('option')
		.filter({ hasText: new RegExp(`^\\s*${name}\\s+${kind}\\b`) })
		.nth(nth)
		.click();
	await expect(palette).toBeHidden();
	return page.getByRole('complementary', { name: 'Inspector' });
}

test('the mass budget adds up the parts tree, with units and the limit a requirement sets', async ({
	page
}) => {
	await openDemo(page);
	const table = await openView(page, 'Drone mass budget');
	await expect(table.getByText('28 rows')).toBeVisible({ timeout: 15_000 });
	const row = (path: string) =>
		table
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: path, exact: true }) });
	// The drone has no mass of its own: its row adds up its parts.
	await expect(row('drone')).toContainText('2770 g');
	await expect(row('drone')).toContainText('100 %');
	await expect(row('drone.frontLeft').locator('td')).toHaveText([
		'frontLeft',
		'Rotor',
		'1',
		'180 g',
		'180 g',
		'6.5 %',
		'',
		'',
		''
	]);
	// The drone's own masses, with the limit 'Maximum take-off mass' sets on one of them.
	await expect(row('drone.takeOffMass')).toContainText('≤ 4 kg');
	await expect(row('drone.payloadCapacity')).toContainText('1 kg');
	await expect(row('drone.payloadCapacity').getByText('Satisfied')).toBeAttached();
	await expectAccessible(page);

	const power = await openView(page, 'Drone power budget');
	await expect(
		power
			.locator('tbody tr')
			.filter({ has: page.getByRole('button', { name: 'drone', exact: true }) })
	).toContainText('397 W');
	await expect(power).not.toContainText('airframe');
});

test('the checks view says which requirements the design meets, and shows the claim', async ({
	page
}) => {
	await openDemo(page);
	const table = await openView(page, 'Design checks');
	const rows = table.locator('tbody tr');
	await expect(rows).toHaveCount(3, { timeout: 15_000 });
	const mass = rows.filter({ hasText: 'SYS-003' });
	await expect(mass).toContainText('Satisfied');
	await expect(mass).toContainText('0.23 kg (5.8 %)');
	await expect(mass).toContainText('Met: drone.takeOffMass = 3.77 kg (needs ≤ 4 kg).');
	const endurance = rows.filter({ hasText: 'SYS-001' });
	await expect(endurance).toContainText('Satisfied');
	await expect(endurance).toContainText('2.54 min (10 %)');
	await expect(endurance).toContainText('Met: drone.endurance = 27.54 min (needs ≥ 25 min).');
	await expectAccessible(page);

	await endurance
		.getByRole('button', { name: /SYS-001 Flight endurance, show in the text/ })
		.click();
	await expect(page.getByRole('button', { name: 'Satisfaction.sysml', exact: true })).toBeVisible();
	await expect(
		page.locator('.cm-line').filter({ hasText: "satisfy 'Flight endurance' by drone;" })
	).toBeVisible();
	await expect(page.locator('.cm-selectionBackground').first()).toBeAttached();
});

test('a value that breaks a requirement is a violation and a problem, until undone', async ({
	page
}) => {
	await openDemo(page);
	await expect(problems(page)).toHaveAccessibleName('Problems: 0 errors, 0 warnings');
	// The drone's own hover power (the second `hoverPower` attribute: DeliveryDrone declares it).
	const inspector = await select(page, 'hoverPower', 'attribute', 1);
	const value = inspector.getByLabel(/^Value/);
	await expect(value).toHaveValue('400 [W]');
	await value.fill('450 [W]');
	await value.press('Enter');
	await expect(problems(page)).toHaveAccessibleName('Problems: 0 errors, 1 warnings', {
		timeout: 15_000
	});

	const table = await openView(page, 'Design checks');
	const endurance = table.locator('tbody tr').filter({ hasText: 'SYS-001' });
	await expect(endurance).toContainText('Violated');
	await expect(endurance).toContainText('Not met: drone.endurance = 24.48 min (needs ≥ 25 min).');
	await expect(table.locator('tbody tr').first()).toContainText('Violated');
	await problems(page).click();
	await expect(page.locator('section.problems-pane')).toContainText(
		'SYS-001 Flight endurance is not met by drone: drone.endurance = 24.48 min (needs ≥ 25 min)'
	);
	await expectAccessible(page);

	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(endurance).toContainText('Satisfied', { timeout: 15_000 });
	await expect(problems(page)).toHaveAccessibleName('Problems: 0 errors, 0 warnings');
});

test('the inspector shows what an expression comes to, and why when it cannot', async ({
	page
}) => {
	await openDemo(page);
	const endurance = await select(page, 'endurance', 'attribute', 1);
	await expect(endurance.getByLabel(/^Value/)).toHaveValue(
		'HoverEndurance(battery.usableEnergy, hoverPower)'
	);
	await expect(endurance.getByText('= 27.54 min')).toBeVisible({ timeout: 10_000 });

	// The roll-up over the parts, the four rotors included.
	const empty = await select(page, 'emptyMass', 'attribute', 1);
	await expect(empty.getByText('= 2.77 kg')).toBeVisible({ timeout: 10_000 });
	await expect(empty.getByRole('button', { name: 'Why?' })).toHaveCount(0);

	// What nothing gives a value stays unknown, with the reason.
	const takeOff = await select(page, 'takeOffMass', 'attribute');
	await expect(takeOff.getByText('= ?')).toBeVisible({ timeout: 10_000 });
	await takeOff.getByRole('button', { name: 'Why?' }).click();
	await expect(takeOff).toContainText('`emptyMass` has no value in `DeliveryDrone`');
	await expectAccessible(page);

	// A part's attributes, with their values.
	const battery = await select(page, 'Battery', 'part def');
	await expect(battery.getByRole('button', { name: /usableEnergy/ })).toContainText('183.6 W·h');
});

test('the requirements table says whether the design meets each requirement', async ({ page }) => {
	await openDemo(page);
	await page
		.getByRole('button', { name: /^Requirements/ })
		.first()
		.click();
	const table = page.getByRole('region', { name: /Requirements table view/ });
	const row = table.locator('tbody tr').filter({ hasText: 'SYS-001' });
	await expect(row.getByText('Satisfied')).toBeAttached({ timeout: 15_000 });
	await expect(
		table.locator('tbody tr').filter({ hasText: 'SYS-003' }).getByText('Satisfied')
	).toBeAttached();
	await expectAccessible(page);
});
