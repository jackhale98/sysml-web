import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { analyze } from './axe';

/**
 * The use case diagram: the demo's delivery use cases in the drone's
 * boundary with their actors outside, on a desktop and on a phone, and an
 * edit drawn on it (an actor joined to a use case) checked in the text.
 */

async function openUseCases(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	const open = page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Delivery use cases', exact: true });
	await open.scrollIntoViewIfNeeded();
	await open.click();
	const diagram = page.getByRole('region', { name: /Delivery use cases diagram/ });
	await expect(useCase(diagram, 'DeliverParcel')).toBeVisible({ timeout: 15_000 });
	return diagram;
}

const useCase = (diagram: Locator, name: string) =>
	diagram.getByRole('group', { name: `use case def ${name}`, exact: true });
const actor = (diagram: Locator, name: string) =>
	diagram.getByRole('group', { name: `actor ${name}`, exact: true });

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
	).toEqual([]);
}

test('a use case view draws the use cases in the subject’s boundary, the actors outside', async ({
	page
}) => {
	const diagram = await openUseCases(page);
	await expect(diagram.getByText('uc [deliveryUseCases]')).toBeVisible();
	const names = ['DeliverParcel', 'VerifyDropZone', 'PlanRoute', 'ChargeBattery'];
	for (const name of names) await expect(useCase(diagram, name)).toBeVisible();
	// Use cases are ellipses, with their objective; actors stick figures.
	await expect(useCase(diagram, 'ChargeBattery').locator('.ellipse')).toContainText(
		'A full battery before the next flight.'
	);
	await expect(actor(diagram, 'Operator').locator('svg.figure')).toBeVisible();

	const boundary = diagram.locator('.boundary').filter({ hasText: 'DeliveryDrone' });
	await expect(boundary).toBeVisible();
	const frame = (await boundary.boundingBox())!;
	const box = async (l: Locator) => (await l.boundingBox())!;
	for (const name of names) {
		const b = await box(useCase(diagram, name));
		expect(b.x, name).toBeGreaterThan(frame.x);
		expect(b.x + b.width, name).toBeLessThan(frame.x + frame.width);
		expect(b.y, name).toBeGreaterThan(frame.y);
		expect(b.y + b.height, name).toBeLessThan(frame.y + frame.height);
	}
	// The operator starts the use cases: on the left; the others join in from the right.
	const operator = await box(actor(diagram, 'Operator'));
	expect(operator.x + operator.width).toBeLessThan(frame.x);
	for (const name of ['Recipient', 'AviationAuthority'])
		expect((await box(actor(diagram, name))).x, name).toBeGreaterThan(frame.x + frame.width);

	// Six lines from actors, one «include».
	await expect(diagram.getByRole('group', { name: /^actor from / })).toHaveCount(6);
	// (A level line has no height, so it is counted rather than seen.)
	await expect(
		diagram.getByRole('group', { name: 'include from DeliverParcel to VerifyDropZone' })
	).toHaveCount(1);
	await expect(diagram.locator('.svelte-flow__edge-labels')).toContainText('«include»');
	await expectAccessible(page);

	// The export draws the boundary, the ellipses and the figures too.
	await diagram.getByRole('button', { name: 'Export' }).click();
	const menu = page.getByRole('menu', { name: 'Export diagram' });
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		menu.getByRole('menuitem', { name: 'SVG', exact: true }).click()
	]);
	expect(file.suggestedFilename()).toBe('delivery-use-cases.svg');
	const svg = (await readFile((await file.path())!)).toString('utf8');
	expect(svg.match(/<ellipse /g)).toHaveLength(4);
	for (const text of ['DeliveryDrone', 'Operator', '«include»', 'uc [deliveryUseCases]'])
		expect(svg).toContain(`>${text}</text>`);
});

test('connecting an actor to a use case writes its actor parameter', async ({ page }) => {
	const diagram = await openUseCases(page);
	await actor(diagram, 'AviationAuthority').click();
	await diagram.getByRole('button', { name: 'Connect' }).click();
	const picker = page.getByRole('dialog', { name: /Connect from AviationAuthority/ });
	await picker.getByLabel('Find an element to connect to').fill('ChargeBattery');
	await picker
		.getByRole('button', { name: /^ChargeBattery/ })
		.first()
		.click();
	const relation = page.getByRole('dialog', {
		name: 'New relationship from AviationAuthority to ChargeBattery'
	});
	await expect(relation.getByRole('radio', { name: /takes part in/ })).toBeChecked();
	await expect(relation.getByLabel('SysML that will be written')).toHaveText(
		'actor aviationAuthority : AviationAuthority;'
	);
	await relation.getByRole('button', { name: 'Create' }).click();
	// A new line from the authority to the use case…
	await expect(
		diagram.getByRole('group', { name: 'actor from AviationAuthority to ChargeBattery' })
	).toBeVisible({ timeout: 15_000 });
	// …written in the use case, beside its other actor.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: /DeliveryUseCases/ })
		.click();
	const text = page.locator('.cm-content');
	await expect(text).toContainText(
		'actor operator : Operator;        actor aviationAuthority : AviationAuthority;'
	);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('a use case diagram opens readable, below the tools, and fits the width', async ({
		page
	}) => {
		await page.goto('/p/demo');
		await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
			timeout: 30_000
		});
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Views' })
			.click();
		const open = page.getByRole('button', { name: /^Delivery use cases/ }).first();
		await open.scrollIntoViewIfNeeded();
		await open.click();
		const diagram = page.getByRole('region', { name: /Delivery use cases diagram/ });
		const operator = actor(diagram, 'Operator');
		await expect(operator).toBeVisible({ timeout: 15_000 });
		await expect
			.poll(() =>
				diagram
					.locator('.svelte-flow__viewport')
					.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
			)
			.toBeGreaterThanOrEqual(0.65);
		// It starts at its left: the operator, inside the canvas and below the diagram tools.
		await expect
			.poll(async () => {
				const tools = (await diagram
					.getByRole('toolbar', { name: 'Diagram tools' })
					.boundingBox())!;
				const box = (await operator.boundingBox())!;
				return box.y >= tools.y + tools.height && box.x >= 0 && box.x + box.width <= 390;
			})
			.toBe(true);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	});
});
