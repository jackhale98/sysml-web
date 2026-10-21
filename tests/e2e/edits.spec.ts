/**
 * Model edits made by the toolkit engine: the inspector's form, table
 * cells and columns, and diagram add, connect, rename and delete. Each
 * writes SysML text, and Undo puts the text back.
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

async function openFile(page: Page, name: RegExp) {
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name }).click();
	await expect(page.locator('.cm-content')).toBeVisible();
}

/** Select an element with the command palette; the inspector then shows it. */
async function select(page: Page, name: string) {
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill(name);
	await palette
		.getByRole('option')
		.filter({ hasText: new RegExp(`^\\s*${name}\\b`) })
		.first()
		.click();
	await expect(palette).toBeHidden();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(new RegExp(`\\b${name}$`));
	return inspector;
}

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test('the inspector edits the declaration, says what a type change breaks, and undoes', async ({
	page
}) => {
	await openDemo(page);
	await openFile(page, /DroneArchitecture/);
	const text = page.locator('.cm-content');

	const rotors = await select(page, 'rotors');
	const howMany = rotors.getByLabel('How many');
	await howMany.fill('6');
	await howMany.press('Enter');
	await expect(text).toContainText('part rotors : Rotor[6];');
	await expect(toasts(page)).toContainText('Set the multiplicity of rotors to 6');

	const camera = await select(page, 'camera');
	const type = camera.getByLabel(/^Type/);
	await type.fill('Motor');
	await type.press('Enter');
	await expect(text).toContainText('part camera : Motor;');
	await expect(toasts(page)).toContainText('no longer resolve as before: imageOut (line 57)');

	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(text).toContainText('part camera : Camera;');
});

test('renaming updates references in every file; deleting says what no longer resolves', async ({
	page
}) => {
	await openDemo(page);
	await openFile(page, /DroneArchitecture/);
	const text = page.locator('.cm-content');

	const battery = await select(page, 'Battery');
	await battery.getByLabel('Name', { exact: true }).fill('PowerPack');
	await battery.getByLabel('Name', { exact: true }).press('Enter');
	await expect(text).toContainText('part def PowerPack :> Component');
	// The part in DroneArchitecture.sysml is retyped too.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('button', { name: /^DroneArchitecture\.sysml/ })
		.first()
		.click();
	await expect(text).toContainText('part battery : PowerPack;');

	const motor = await select(page, 'Motor');
	await motor.getByRole('button', { name: 'Delete' }).click();
	await motor.getByRole('alert').getByRole('button', { name: 'Delete' }).click();
	await expect(toasts(page)).toContainText(
		'3 references to Motor no longer resolve (DroneComponents::Rotor::motor)'
	);
	await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	await expect(page.getByRole('button', { name: /^Problems/ })).not.toContainText(/[1-9] error/);
});

test('a table’s columns are chosen and saved in its view', async ({ page }) => {
	await openDemo(page);
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'System requirements' })
		.click();
	const table = page.getByRole('region', { name: 'System requirements view' });
	await expect(table.locator('thead')).toContainText('Owner');
	await table.getByRole('button', { name: 'Columns' }).click();
	const chooser = page.getByRole('dialog', { name: 'Choose columns' });
	await chooser.getByRole('checkbox', { name: 'Owner' }).uncheck();
	await chooser.getByRole('button', { name: 'Apply' }).click();
	await expect(table.locator('thead')).not.toContainText('Owner', { timeout: 10_000 });
	await openFile(page, /^Views\.sysml/);
	await expect(page.locator('.cm-content')).toContainText(
		'@TableRendering { columns = "id; title;'
	);
	await expectAccessible(page);
});

test('diagram edits: add, specialize, rename and delete', async ({ page }) => {
	test.setTimeout(60_000);
	await openDemo(page);
	await openFile(page, /DroneArchitecture/);
	const diagram = page.getByRole('region', { name: /DroneArchitecture diagram/ });
	const text = page.locator('.cm-content');
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible();

	// Add: a definition in the package.
	await diagram.getByRole('button', { name: /Add/ }).click();
	const form = page.getByRole('form', { name: /Add to DroneArchitecture/ });
	await form.getByLabel('Kind').selectOption('part def');
	await form.getByLabel('Name').fill('Payload');
	await form.getByRole('button', { name: 'Add' }).click();
	await expect(text).toContainText('part def Payload', { timeout: 10_000 });
	await expect(diagram.getByText('Payload', { exact: true })).toBeVisible({ timeout: 10_000 });

	// Connect: DeliveryDrone specializes Battery (a declaration edit).
	await diagram.getByText('DeliveryDrone', { exact: true }).first().click();
	await diagram.getByRole('button', { name: 'Connect' }).click();
	const picker = page.getByRole('dialog', { name: /Connect from DeliveryDrone/ });
	await picker.getByLabel('Find an element to connect to').fill('Battery');
	await picker
		.getByRole('button', { name: /^Battery/ })
		.first()
		.click();
	const relation = page.getByRole('dialog', { name: /New relationship from DeliveryDrone/ });
	await relation.getByRole('radio', { name: /specializes/ }).check();
	await relation.getByRole('button', { name: 'Create' }).click();
	await expect(text).toContainText('part def DeliveryDrone :> Battery {', { timeout: 10_000 });

	// Rename: the usage typed by it follows.
	await diagram.getByText('DeliveryDrone', { exact: true }).first().click();
	await diagram.getByRole('button', { name: 'Rename' }).click();
	const name = diagram.getByRole('textbox', { name: 'New name for DeliveryDrone' });
	await name.fill('Quadcopter');
	await name.press('Enter');
	await expect(text).toContainText('part def Quadcopter :> Battery {', { timeout: 10_000 });
	await expect(text).toContainText('part drone : Quadcopter {');

	// Delete: the new definition (once the rename's re-analysis has settled the diagram).
	const confirm = page.getByRole('alertdialog', { name: 'Delete Payload?' });
	await expect(async () => {
		await diagram.getByText('Payload', { exact: true }).click();
		await diagram.getByRole('button', { name: 'Delete' }).click({ timeout: 2_000 });
		await expect(confirm).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await confirm.getByRole('button', { name: 'Delete' }).click();
	await expect(text).not.toContainText('part def Payload', { timeout: 10_000 });
	await expectAccessible(page);
});
