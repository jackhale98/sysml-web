/**
 * Dependency matrices (DSM, N² chart): the demo's part DSM with its marks,
 * flags and legend; what counts and the order, saved in the view and undone;
 * a cell's links, shown in the text; a connection made from an empty cell and
 * undone; what a change to a part reaches; the N², functional and requirement
 * matrices; the New DSM form on a Small system project, which brings the
 * library; and on a phone, a list of the parts that open to their links, the
 * settings in a sheet and the grid sideways. Each is accessible.
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

test.describe.configure({ timeout: 120_000 });

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await ready(page);
}

/** Open a saved view from the search box, on any screen. */
async function openSaved(page: Page, name: string) {
	await page.getByRole('button', { name: /Search the model/ }).click();
	const palette = page.getByRole('dialog').filter({ has: page.getByRole('listbox') });
	await palette.getByRole('combobox').fill(name);
	await palette
		.getByRole('option')
		.filter({ hasText: name })
		.filter({ hasNotText: 'New' })
		.first()
		.click();
	await expect(palette).toBeHidden();
	return page.getByRole('region', { name: `${name} view` });
}

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const views = (page: Page) => page.locator('section[aria-labelledby="views-heading"]');

test.describe('on a desktop', () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test('the drone’s part DSM: numbered parts, a mark per link, the unlinked airframe flagged', async ({
		page
	}) => {
		await openDemo(page);
		await views(page).getByRole('button', { name: 'Drone DSM', exact: true }).click();
		const view = page.getByRole('region', { name: 'Drone DSM view' });
		const grid = view.getByRole('table');
		await expect(grid.getByRole('rowheader')).toHaveCount(12, { timeout: 15_000 });
		await expect(view.getByText('12 parts of drone, 14 links')).toBeVisible();
		await expect(grid.getByRole('rowheader', { name: /^1 Airframe/ })).toContainText('No links');
		// Row = from, column = to: the flight controller commands the rotors, not the other way.
		await expect(
			grid.getByRole('button', { name: 'From Flight controller to Front left: 1 flow' })
		).toBeVisible();
		await expect(
			grid.getByRole('button', { name: 'No link from Front left to Flight controller' })
		).toBeVisible();
		// A connection goes both ways.
		await expect(
			grid.getByRole('button', { name: 'From Power distribution to Battery: 1 connection' })
		).toBeVisible();
		await expect(view.getByRole('list', { name: 'What the marks mean' })).toContainText(
			'passes an item to'
		);
		await expectAccessible(page);
	});

	test('what counts and the order are saved in the view, and undone', async ({ page }) => {
		await openDemo(page);
		const view = await openSaved(page, 'Drone DSM');
		const grid = view.getByRole('table');
		await expect(grid.getByRole('rowheader')).toHaveCount(12, { timeout: 15_000 });
		const counts = view.getByRole('group', { name: 'What counts as a link' });

		await counts.getByRole('button', { name: /Flows/ }).click();
		await expect(counts.getByRole('button', { name: /Flows/ })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		await expect(view.getByText('12 parts of drone, 7 links')).toBeVisible();
		await expect(
			grid.getByRole('button', { name: 'No link from Flight controller to Front left' })
		).toBeVisible();
		await expect(toasts(page)).toContainText('Drone DSM now counts connections and bindings');
		await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
		await expect(view.getByText('12 parts of drone, 14 links')).toBeVisible({ timeout: 15_000 });

		const order = view.getByRole('group', { name: 'Order' });
		await order.getByRole('button', { name: 'Suggested modules' }).click();
		await expect(view.getByText('Suggested modules put parts')).toBeVisible();
		await expect(grid.getByRole('rowheader', { name: 'Suggested module 1' })).toBeVisible();
		await expect(grid.getByRole('rowheader', { name: 'Suggested module 2' })).toBeVisible();
		// Power and propulsion first; the airframe, linked to nothing, last.
		const names = grid.locator('th.name .name-button');
		await expect(names.first()).toHaveText('Battery');
		await expect(names.last()).toHaveText('Airframe');
		await expectAccessible(page);
		// Saved in the view's own text.
		await view.getByRole('button', { name: 'Show SysML' }).click();
		await expect(page.locator('.cm-content').first()).toContainText(
			'@MatrixRendering { order = "clustered"; }',
			{ timeout: 10_000 }
		);
	});

	test('a cell’s links: what they are, the connection in the inspector and in the text', async ({
		page
	}) => {
		await openDemo(page);
		const view = await openSaved(page, 'Drone DSM');
		const cell = view.getByRole('button', {
			name: 'From Battery to Power distribution: 1 connection'
		});
		await cell.click();
		await expect(cell).toHaveAttribute('aria-pressed', 'true');
		const detail = view.locator('.detail');
		await expect(detail).toContainText(
			'Battery is connected to Power distribution (Battery power), by a power supply interface; carries electric power.'
		);
		await expect(inspector(page).getByRole('textbox', { name: 'Name' })).toHaveValue(
			'batteryPower'
		);
		// The keyboard moves between cells; the cell in focus is the one described.
		await page.keyboard.press('ArrowRight');
		await expect(
			view
				.getByRole('button', { name: 'From Battery to Front left: 1 connection' })
				.or(view.getByRole('button', { name: 'No link from Battery to Front left' }))
		).toBeFocused();
		await expect(detail).toContainText('No link from Battery to Front left');
		await page.keyboard.press('ArrowLeft');
		await expect(cell).toBeFocused();
		await expect(detail).toContainText('Battery is connected to Power distribution');
		await detail.getByRole('button', { name: 'Show in SysML' }).click();
		await expect(page.locator('.cm-content').first()).toContainText(
			'interface batteryPower : PowerSupply connect battery.powerOut to powerDistribution.powerIn;',
			{ timeout: 10_000 }
		);
	});

	test('an empty cell connects two parts, as one step that undoes', async ({ page }) => {
		await openDemo(page);
		const view = await openSaved(page, 'Drone DSM');
		await view.getByRole('button', { name: 'No link from Airframe to Camera' }).click();
		await expect(view.locator('.detail')).toContainText('No link from Airframe to Camera');
		await view.getByRole('button', { name: 'Connect them…' }).click();
		const pop = page.getByRole('dialog', { name: 'New relationship from airframe to camera' });
		await expect(pop.getByLabel('SysML that will be written')).toHaveText(
			'connect airframe to camera.imageOut;'
		);
		await expectAccessible(page);
		await pop.getByRole('button', { name: 'Create' }).click();
		const made = view.getByRole('button', { name: 'From Airframe to Camera: 1 connection' });
		await expect(made).toBeVisible({ timeout: 15_000 });
		// A connection with no interface definition is flagged for review.
		await expect(view.getByText('1 connection with no interface definition')).toBeVisible();
		await expect(view.getByText('with no links')).toBeHidden();
		await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
		await expect(view.getByRole('button', { name: 'No link from Airframe to Camera' })).toBeVisible(
			{ timeout: 15_000 }
		);
		await expect(view.getByText('1 with no links')).toBeVisible();
	});

	test('what a change to the battery reaches, directly and through others', async ({ page }) => {
		await openDemo(page);
		const view = await openSaved(page, 'Drone DSM');
		await view.getByRole('button', { name: 'What a change to Battery affects' }).click();
		await expect(view.getByRole('status')).toContainText(
			'A change to Battery may affect 8 of 11 parts: 1 directly, 7 through others.'
		);
		const grid = view.getByRole('table');
		const row = (name: string) =>
			grid.getByRole('rowheader', { name: new RegExp(`^\\d+ ${name}`) });
		await expect(row('Power distribution')).toContainText('directly');
		await expect(row('Payload release')).toContainText('3 steps');
		await expect(row('Gnss')).not.toContainText('steps');
		await expectAccessible(page);
		await view.getByRole('button', { name: /^Clear/ }).click();
		await expect(view.getByRole('status')).toBeHidden();
	});

	test('the N² chart names what passes; the delivery flight and the requirements have theirs', async ({
		page
	}) => {
		await openDemo(page);
		const n2 = await openSaved(page, 'Drone N2');
		await expect(
			n2.getByRole('button', {
				name: 'From Battery to Power distribution: Power supply, Electric power'
			})
		).toBeVisible({ timeout: 15_000 });
		// Back the other way, the interface carries nothing.
		await expect(
			n2.getByRole('button', { name: 'From Power distribution to Battery: Power supply' })
		).toBeVisible();
		await expect(
			n2.getByRole('button', { name: 'From Gnss to Flight controller: Position fix' })
		).toBeVisible();
		await expectAccessible(page);

		const flight = await openSaved(page, 'Delivery flight DSM');
		await expect(flight.getByText('8 steps of DeliveryFlight, 10 links')).toBeVisible({
			timeout: 15_000
		});
		await expect(
			flight.getByRole('button', { name: 'From Descend to Release parcel: 1 step after' })
		).toBeVisible();

		const requirements = await openSaved(page, 'Requirement DSM');
		await expect(
			requirements.getByRole('button', {
				name: 'From STK-001 Parcel delivery to SYS-001 Flight endurance: 1 derivation'
			})
		).toBeVisible({ timeout: 15_000 });
		await expectAccessible(page);
	});

	test('New DSM on a Small system project: the library comes with it, the matrix opens', async ({
		page
	}) => {
		await page.goto('/projects');
		await page.getByLabel('Name').fill('Torch DSM');
		await page.getByRole('radio', { name: /Small system/ }).check();
		await page.getByRole('button', { name: /Create project/ }).click();
		await expect(page).toHaveURL(/\/p\//);
		await ready(page);
		await page.keyboard.press('ControlOrMeta+k');
		const palette = page.getByRole('dialog').filter({ has: page.getByRole('listbox') });
		await palette.getByRole('combobox').fill('dsm');
		await palette.getByRole('option', { name: /New DSM/ }).click();
		const form = page.getByRole('dialog', { name: 'New DSM' });
		await expect(form.getByRole('heading', { name: 'What kind of matrix?' })).toBeVisible();
		await form.getByText('Part DSM').click();
		await form.getByRole('button', { name: 'Next' }).click();
		await form.getByRole('radio', { name: /flashlight/ }).check();
		await form.getByRole('button', { name: 'Next' }).click();
		await form.getByRole('checkbox', { name: /Bindings/ }).uncheck();
		await form.getByText('Suggested modules').click();
		await form.getByRole('button', { name: 'Next' }).click();
		await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Flashlight DSM');
		await form.getByText('See the SysML').click();
		await expect(form.locator('pre')).toContainText('view flashlightDSM : DependencyMatrix {');
		await expect(form.locator('pre')).toContainText('expose');
		await expect(form.locator('pre')).toContainText(
			'@MatrixRendering { dependencies = "connection; flow"; order = "clustered"; }'
		);
		await expectAccessible(page);
		await form.getByRole('button', { name: 'Create' }).click();

		const view = page.getByRole('region', { name: 'Flashlight DSM view' });
		await expect(view.getByText('4 parts of flashlight, 2 links')).toBeVisible({ timeout: 15_000 });
		await expect(
			view.getByRole('table').getByRole('rowheader', { name: /^4 Housing/ })
		).toContainText('No links');
		await expect(
			view.getByRole('group', { name: 'Order' }).getByRole('button', { name: 'Suggested modules' })
		).toHaveAttribute('aria-pressed', 'true');
		// The library came into the project's libraries folder.
		await page.getByRole('tab', { name: 'Files' }).click();
		const files = page.locator('.explorer-pane').getByRole('list', { name: 'Files' });
		await files.locator('summary', { hasText: 'libraries' }).click();
		await expect(files.getByRole('button', { name: /^DependencyMatrices\.sysml/ })).toBeVisible();
		await expectAccessible(page);
	});
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	async function fits(page: Page, what: string) {
		const wide = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(wide, what).toBeLessThanOrEqual(0);
	}

	/** Every visible button of `scope` is at least 44px tall: a finger's width. */
	async function tall(scope: ReturnType<Page['locator']>, what: string) {
		const heights = await scope.locator('button:visible').evaluateAll((buttons) =>
			buttons.map((b) => ({
				text: (b.textContent ?? '').trim() || b.getAttribute('aria-label'),
				h: b.getBoundingClientRect().height
			}))
		);
		expect(
			heights.filter((b) => b.h < 44),
			what
		).toEqual([]);
	}

	test('a list of the parts, each opening to its links, with what a change reaches', async ({
		page
	}) => {
		await openDemo(page);
		const view = await openSaved(page, 'Drone DSM');
		const list = view.getByRole('list', { name: 'Each part and its links' });
		await expect(list.locator(':scope > li.card')).toHaveCount(12, { timeout: 15_000 });
		await expect(list.locator(':scope > li.card').first()).toContainText('No links');
		const board = list.locator(':scope > li.card').filter({ hasText: 'Power distribution' });
		await board
			.getByRole('button', { name: /Power distribution/ })
			.first()
			.click();
		await expect(board.getByRole('heading', { name: 'Connected with' })).toBeVisible();
		await expect(board.getByRole('button', { name: /Front left.*Electric power/ })).toBeVisible();
		await board.getByRole('button', { name: 'What a change affects' }).click();
		await expect(board).toContainText('A change to it may affect 8 of 11');
		const frontLeft = list
			.locator(':scope > li.card')
			.filter({ has: page.getByRole('button', { name: /^\d+ Front left/ }) });
		await expect(frontLeft).toContainText('affected directly');
		await fits(page, 'the list');
		await tall(view, 'the list');
		await expectAccessible(page);

		// The settings: a sheet.
		await view.getByRole('button', { name: /^Counts connections, flows and bindings/ }).click();
		const sheet = page.getByRole('dialog', { name: 'What counts, and the order' });
		await sheet.getByRole('button', { name: 'Suggested modules' }).click();
		await tall(sheet, 'the settings');
		await sheet.getByRole('button', { name: 'Done' }).click();
		await expect(view.getByText('Suggested module 1')).toBeVisible();
		await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
	});

	test('a connection from a part’s card, undone; the grid sideways', async ({ page }) => {
		await openDemo(page);
		const view = await openSaved(page, 'Drone DSM');
		const list = view.getByRole('list', { name: 'Each part and its links' });
		const airframe = list.locator(':scope > li.card').filter({ hasText: 'Airframe' });
		await airframe
			.getByRole('button', { name: /Airframe/ })
			.first()
			.click();
		await airframe.getByRole('button', { name: 'Add a connection' }).click();
		const picker = page.getByRole('dialog', { name: 'Connect Airframe to…' });
		await tall(picker, 'the parts to connect to');
		await picker.getByRole('button', { name: 'Camera' }).click();
		const pop = page.getByRole('dialog', { name: 'New relationship from airframe to camera' });
		await pop.getByRole('button', { name: 'Create' }).click();
		await expect(airframe).toContainText('1 connected', { timeout: 15_000 });
		await toasts(page).getByRole('button', { name: 'Undo' }).last().click();
		await expect(airframe).toContainText('No links', { timeout: 15_000 });

		await view
			.getByRole('group', { name: 'Show as' })
			.getByRole('button', { name: 'Grid' })
			.click();
		const grid = view.getByRole('table');
		await expect(grid.getByRole('rowheader')).toHaveCount(12);
		// The grid scrolls sideways inside its frame; the page doesn't.
		const scroller = view.locator('.frame .scroll');
		expect(await scroller.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
		await fits(page, 'the grid');
		await expectAccessible(page);
	});
});
