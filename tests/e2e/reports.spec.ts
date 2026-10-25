import { readFileSync } from 'node:fs';
import { viewTitle } from '../../src/lib/workbench/views.ts';
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
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

async function expectNoSidewaysScroll(page: Page) {
	const widths = await page.evaluate(() => {
		const d = document.documentElement;
		return { scroll: d.scrollWidth, client: d.clientWidth, x: window.scrollX };
	});
	expect(widths.scroll).toBe(widths.client);
	expect(widths.x).toBe(0);
}

const SPEC_TITLE = 'Delivery drone requirements specification';

async function openSpecification(page: Page) {
	await openDemo(page);
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: 'Drone specification' })
		.click();
	const report = page.getByRole('article', { name: SPEC_TITLE });
	await expect(report.getByRole('heading', { name: SPEC_TITLE })).toBeVisible({ timeout: 15_000 });
	return report;
}

test('the specification report shows each requirement with its trace', async ({ page }) => {
	const report = await openSpecification(page);
	const sys1 = report.locator('section.rd-entry', {
		has: page.getByRole('heading', { name: /SYS-001\s*Flight endurance/ })
	});
	await expect(sys1).toContainText('The drone shall fly for at least 25 minutes');
	await expect(sys1).toContainText(/Satisfied by\s*drone/);
	await expect(sys1).toContainText(/Verified by\s*enduranceFlightTest/);
	await expect(sys1).toContainText(/Derived from\s*STK-001 Parcel delivery/);
	await expect(report.getByRole('heading', { name: /Gaps/ })).toBeVisible();
	await expectAccessible(page);

	// Names in the report select their element, and the report stays open.
	await sys1.getByRole('button', { name: 'enduranceFlightTest' }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('enduranceFlightTest');
	await expect(report).toBeVisible();
});

test('a report prints without the app around it', async ({ page }) => {
	const report = await openSpecification(page);
	await page.emulateMedia({ media: 'print' });
	await expect(report).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Explorer' })).toBeHidden();
	await expect(page.getByRole('button', { name: /Search the model/ })).toBeHidden();
	await expect(page.getByRole('button', { name: /Print/ })).toBeHidden();
	await expect(page.getByRole('navigation', { name: 'On this page' })).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeHidden();
	// The document flows over pages instead of scrolling inside the app.
	const height = await report.evaluate((e) => e.getBoundingClientRect().height);
	const viewport = page.viewportSize()!.height;
	expect(height).toBeGreaterThan(viewport * 3);
	// Printed, it runs over many pages: title page, contents, then a page per chapter at least.
	const pdf = (await page.pdf({ format: 'A4', preferCSSPageSize: true })).toString('latin1');
	expect(pdf.match(/\/Type\s*\/Page\b/g)?.length ?? 0).toBeGreaterThan(6);
	await page.emulateMedia({ media: 'screen' });
	await expect(page.getByRole('navigation', { name: 'Explorer' })).toBeVisible();
});

test('a report downloads as one HTML file and as Markdown', async ({ page }) => {
	await openSpecification(page);
	const [html] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'HTML' }).click()
	]);
	expect(html.suggestedFilename()).toBe(
		'drn-spec-001-delivery-drone-requirements-specification.html'
	);
	const text = readFileSync((await html.path())!, 'utf8');
	expect(text).toContain(`<title>${SPEC_TITLE}</title>`);
	expect(text).toContain('<h1 class="rd-title">');
	expect(text).toContain('SYS-001');
	expect(text).toContain('<style>');
	expect(text).not.toContain('<button');
	expect(text).not.toMatch(/<(script|link)\b/);

	const [md] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Markdown' }).click()
	]);
	const markdown = readFileSync((await md.path())!, 'utf8');
	expect(markdown).toMatch(new RegExp(`^# ${SPEC_TITLE}`));
	expect(markdown).toContain('SYS-001 Flight endurance');
});

test('the interface control document draws the interconnection and lists connections', async ({
	page
}) => {
	await openDemo(page);
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: 'Drone interface control' })
		.click();
	const report = page.getByRole('article', { name: 'Delivery drone interface control document' });
	const diagram = report.getByRole('img', { name: /Diagram of the parts of drone/ });
	await expect(diagram.locator('svg')).toBeVisible({ timeout: 20_000 });
	await expect(diagram).toContainText('powerDistribution');
	const connections = report.locator('section', {
		has: page.getByRole('heading', { name: /^\s*3\s*Connections/ })
	});
	await expect(connections.getByRole('row', { name: /batteryPower/ })).toContainText(
		'battery.powerOut'
	);
	await expect(report.getByRole('heading', { name: /PowerSupply/ })).toBeVisible();
	await expectAccessible(page);
});

test('a standard report can be saved into the model as a view', async ({ page }) => {
	// A new project has no saved reports, so the standard specification is offered.
	await page.goto('/projects');
	await page.getByLabel('Name').fill('Report bench');
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	const explorer = page.getByRole('navigation', { name: 'Explorer' });
	await explorer.getByRole('button', { name: 'Specification', exact: true }).click();
	await expect(
		page.getByRole('article', { name: 'Report bench requirements specification' })
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Save to model' }).click();
	const saved = page.getByText(/Saved as the view (\w+)/);
	await expect(saved).toBeVisible();
	const name = (await saved.textContent())!.match(/Saved as the view (\w+)/)![1]!;
	// The saved copy takes the standard one's place in the list.
	await expect(explorer.getByRole('button', { name: viewTitle(name), exact: true })).toBeVisible();
	await expect(explorer.getByRole('button', { name: 'Specification', exact: true })).toBeHidden();
	await expect(page.getByRole('button', { name: 'SysML' })).toBeVisible();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('on a phone, a report opens from the views drawer and reads without sideways scrolling', async ({
		page
	}) => {
		await openDemo(page);
		await page.getByRole('button', { name: /Switch view$/ }).click();
		const drawer = page.getByRole('dialog', { name: 'Views' });
		await drawer.getByRole('button', { name: /Drone specification/ }).click();
		const report = page.getByRole('article', { name: SPEC_TITLE });
		await expect(report.getByRole('heading', { name: SPEC_TITLE })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByRole('button', { name: 'Add an element' })).toBeHidden();
		await report.getByRole('heading', { name: /SYS-001/ }).scrollIntoViewIfNeeded();
		await report.getByRole('heading', { name: /Traceability/ }).scrollIntoViewIfNeeded();
		await expectNoSidewaysScroll(page);
		const overflow = await report.evaluate((e) => e.scrollWidth - e.clientWidth);
		expect(overflow).toBeLessThanOrEqual(0);
		await expectAccessible(page);
	});
});
