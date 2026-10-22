/**
 * Model exchange: the demo downloaded as SysML v2 JSON and checked, that file
 * imported as a new project (views, no problems), and a Systems Modeling API
 * server (mocked with the shapes the specification documents): connect, list
 * projects, open one, change it and save the change back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MockApiServer } from '../../src/lib/exchange/api-mock';
import type { ElementJson } from '../../src/lib/exchange/elements';

const GARAGE = join(import.meta.dirname, '../../src/lib/exchange/fixtures/garage.json');
const SERVER = 'https://sysml.example.test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

async function expectModelReady(page: Page) {
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

/** Choose an item of the project menu (its button is the project's name). */
const menuItem = async (page: Page, project: string, item: string | RegExp) => {
	await page.locator('.project-menu').getByRole('button', { name: project, exact: true }).click();
	await page.getByRole('menuitem', { name: item }).click();
};

/** The mocked server, answering on `SERVER` for this page. */
async function serve(page: Page, server: MockApiServer) {
	await page.route(`${SERVER}/**`, async (route) => {
		const request = route.request();
		const answer = server.handle(
			request.method(),
			request.url(),
			request.headers(),
			request.postData() ?? undefined
		);
		await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
	});
}

test('the demo downloads as SysML v2 JSON, and that file opens as a project with its views', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto('/p/demo');
	await expectModelReady(page);
	await menuItem(page, 'Drone UAV', 'Download as SysML v2 JSON…');
	const dialog = page.getByRole('dialog', { name: 'Download as SysML v2 JSON' });
	await expect(dialog.getByRole('radio', { name: /Only my model/ })).toBeChecked();
	await expectAccessible(page);
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Download .json' }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('Drone-UAV.json');
	const path = await download.path();
	const elements = JSON.parse(readFileSync(path, 'utf8')) as ElementJson[];

	// Every element has an id and a type; references resolve in the file or to the library.
	expect(elements.length).toBeGreaterThan(6000);
	const ids = new Set(elements.map((e) => e['@id']));
	expect(ids.size).toBe(elements.length);
	for (const e of elements) {
		expect(e['@id']).toMatch(UUID);
		expect(e['@type']).toMatch(/^[A-Z]\w+$/);
	}
	const outside = new Set<string>();
	for (const e of elements)
		for (const [k, v] of Object.entries(e))
			for (const r of Array.isArray(v) ? v : [v])
				if (
					k !== '@id' &&
					r &&
					typeof r === 'object' &&
					typeof r['@id'] === 'string' &&
					!ids.has(r['@id'])
				)
					outside.add(r['@id']);
	const result = dialog.getByTestId('export-result');
	await expect(result).toContainText(
		`${elements.length.toLocaleString('en')} elements of your model`
	);
	// The ones outside are the standard library's (the dialog counts the references to it).
	expect(outside.size).toBeGreaterThan(20);
	await expect(result).toContainText(/\d+ references point at the standard library/);
	await dialog.getByRole('button', { name: 'Done' }).click();

	// The same file, imported as a new project.
	await page.goto('/projects');
	await page.locator('input[type=file][accept*=json]').setInputFiles({
		name: 'Drone-UAV.json',
		mimeType: 'application/json',
		buffer: readFileSync(path)
	});
	const report = page.getByRole('dialog', { name: /Import/ });
	await expect(report.getByTestId('import-summary')).toContainText(
		`Everything came across: ${elements.length.toLocaleString('en')} elements in 21 files, with no problems.`,
		{ timeout: 30_000 }
	);
	await expectAccessible(page);
	await report.getByLabel('Project name').fill('Drone from JSON');
	await report.getByRole('button', { name: 'Open project' }).click();
	await expect(page).toHaveURL(/\/p\/drone-from-json$/);
	await expectModelReady(page);
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Drone bill of materials' })
		.click();
	const table = page.getByRole('region', { name: 'Drone bill of materials view' });
	await expect(table.getByText('26 rows')).toBeVisible({ timeout: 15_000 });
});

test('a file that is not SysML v2 JSON says so on the projects page', async ({ page }) => {
	await page.goto('/projects');
	await page.locator('input[type=file][accept*=json]').setInputFiles({
		name: 'notes.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{"title": "my notes"}')
	});
	await expect(
		page.getByText(/notes\.json could not be imported: .*no model elements/)
	).toBeVisible({
		timeout: 30_000
	});
});

test('an API server: connect with a token, open a project, change it and save the change', async ({
	page
}) => {
	test.setTimeout(120_000);
	const server = new MockApiServer({ token: 'e2e-token', pageSize: 8 });
	const projectId = server.addProject(
		'Garage',
		JSON.parse(readFileSync(GARAGE, 'utf8')) as ElementJson[],
		'A hand-written model'
	);
	await serve(page, server);
	await page.goto('/p/demo');
	await expectModelReady(page);

	await menuItem(page, 'Drone UAV', 'Connect to a SysML v2 API server…');
	const dialog = page.getByRole('dialog', { name: 'SysML v2 API server' });
	await dialog.getByLabel('Server address').fill(SERVER);
	await dialog.getByRole('button', { name: 'Connect' }).click();
	// No token yet: the server says it wants one, and the dialog says so plainly.
	await expect(dialog.getByRole('alert')).toContainText('wants a token');
	await dialog.getByLabel(/Token/).fill('e2e-token');
	await dialog.getByRole('button', { name: 'Connect' }).click();
	await expect(dialog.getByRole('radio', { name: /Garage/ })).toBeVisible();
	await expectAccessible(page);

	// Pull: the latest commit on main, as a new project.
	await dialog.getByRole('radio', { name: /Garage/ }).check();
	await expect(dialog.getByLabel('Branch')).toHaveValue(/.+/);
	await dialog.getByRole('button', { name: 'Open from server' }).click();
	await expect(dialog.getByTestId('import-summary')).toContainText('Everything came across', {
		timeout: 30_000
	});
	await dialog.getByRole('button', { name: 'Open project' }).click();
	await expect(page).toHaveURL(/\/p\/garage$/);
	await expectModelReady(page);
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();

	// Nothing changed yet: saving would send nothing.
	await menuItem(page, 'Garage', 'Connect to a SysML v2 API server…');
	const again = page.getByRole('dialog', { name: 'SysML v2 API server' });
	await expect(again.getByRole('radio', { name: /Garage/ })).toBeChecked();
	await again.getByRole('button', { name: 'Save to server' }).click();
	await expect(again.getByText('The server already has this version')).toBeVisible({
		timeout: 30_000
	});
	await again.getByRole('button', { name: 'Back' }).click();
	await again.getByRole('button', { name: 'Close' }).click();

	// A change: a new part definition in the text.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: 'Garage.sysml', exact: true }).click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type('part car : Vehicle;');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('part def Trailer;');
	await expect(page.locator('.cm-content')).toContainText('part def Trailer;');
	await expectModelReady(page);

	await menuItem(page, 'Garage', 'Connect to a SysML v2 API server…');
	await page
		.getByRole('dialog', { name: 'SysML v2 API server' })
		.getByRole('button', { name: 'Save to server' })
		.click();
	const plan = page.getByTestId('push-plan');
	await expect(plan).toContainText('2 elements new', { timeout: 30_000 });
	await expect(plan).toContainText('1 element changed');
	await expect(plan).toContainText('0 elements removed');
	await page.getByLabel('Describe the change').fill('Add a trailer');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved to Garage on sysml.example.test: 3 changes.')).toBeVisible();

	// The server has the trailer, under the package it already had (same ids, one new commit).
	const head = server.headElements(projectId);
	const trailer = head.find((e) => e.declaredName === 'Trailer');
	expect(trailer?.['@type']).toBe('PartDefinition');
	const garage = JSON.parse(readFileSync(GARAGE, 'utf8')) as ElementJson[];
	const pkg = garage.find((e) => e['@type'] === 'Package')!;
	expect(head.find((e) => e['@id'] === pkg['@id'])?.ownedRelationship).toHaveLength(5);
	expect(server.posted.at(-1)?.description).toBe('Add a trailer');
	expect(server.log.filter((l) => l.startsWith('POST'))).toHaveLength(1);
});

test('an API server that refuses this page says what it needs (CORS)', async ({ page }) => {
	await page.route(`${SERVER}/**`, (route) => route.abort('failed'));
	await page.goto('/p/demo');
	await expectModelReady(page);
	await menuItem(page, 'Drone UAV', 'Connect to a SysML v2 API server…');
	const dialog = page.getByRole('dialog', { name: 'SysML v2 API server' });
	await dialog.getByLabel('Server address').fill(SERVER);
	await dialog.getByRole('button', { name: 'Connect' }).click();
	await expect(dialog.getByRole('alert')).toContainText('(CORS)');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('the export and the server sheet fit the screen', async ({ page }) => {
		await page.goto('/p/demo');
		await expectModelReady(page);
		await menuItem(page, 'Drone UAV', 'Download as SysML v2 JSON…');
		const dialog = page.getByRole('dialog', { name: 'Download as SysML v2 JSON' });
		await expect(dialog.getByRole('button', { name: 'Download .json' })).toBeInViewport();
		await expectAccessible(page);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await menuItem(page, 'Drone UAV', 'Connect to a SysML v2 API server…');
		const server = page.getByRole('dialog', { name: 'SysML v2 API server' });
		await expect(server.getByRole('button', { name: 'Connect' })).toBeInViewport();
		await expectAccessible(page);
	});
});
