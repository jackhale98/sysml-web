import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function openSequence(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Delivery sequence', exact: true })
		.click();
	const diagram = page.getByRole('group', { name: 'Delivery sequence diagram' });
	await expect(diagram.getByRole('button', { name: /^Message 1:/ })).toBeVisible({
		timeout: 15_000
	});
	return diagram;
}

test('a sequence view draws the lifelines and the messages in time order', async ({ page }) => {
	const diagram = await openSequence(page);
	const lifelines = diagram.getByRole('list', { name: 'Lifelines' }).getByRole('button');
	await expect(lifelines).toHaveCount(4);
	for (const [i, name] of [
		'operator : Operator',
		'groundStation : GroundStation',
		'drone : DeliveryDrone',
		'recipient : Recipient'
	].entries())
		await expect(lifelines.nth(i)).toHaveAccessibleName(`Lifeline «ref part» ${name}`);
	const messages = diagram
		.getByRole('list', { name: 'Messages, in time order' })
		.getByRole('button');
	await expect(messages).toHaveCount(8);
	await expect(messages.first()).toHaveAccessibleName(
		'Message 1: planDelivery of FlightPlan, from operator to groundStation'
	);
	await expect(messages.nth(6)).toHaveAccessibleName(
		'Message 7: handOver of Parcel, from drone to recipient'
	);
	// Top to bottom in that order, and each message between the lifelines it joins.
	const tops = await messages.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
	expect(tops).toEqual([...tops].sort((a, b) => a - b));
	const head = (name: string) =>
		diagram.getByRole('button', { name: `Lifeline «ref part» ${name}` });
	const [operator, station] = await Promise.all([
		head('operator').boundingBox(),
		head('groundStation').boundingBox()
	]);
	const first = (await messages.first().boundingBox())!;
	expect(first.x).toBeGreaterThan(operator!.x + operator!.width / 2);
	expect(first.x + first.width).toBeLessThan(station!.x + station!.width / 2);

	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
	).toEqual([]);
});

test('lifelines and messages select their elements, and show what they connect', async ({
	page
}) => {
	const diagram = await openSequence(page);
	const inspector = page.getByRole('complementary', { name: 'Inspector' });

	const report = diagram.getByRole('button', { name: /^Message 3:/ });
	await report.click();
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('preflightReport');
	await expect(report).toHaveAttribute('aria-pressed', 'true');
	// The two lifelines it joins are highlighted.
	await expect(diagram.locator('.heads .head.linked')).toHaveCount(2);

	// A lifeline: its messages are highlighted.
	await diagram.getByRole('button', { name: /^Lifeline «ref part» recipient/ }).click();
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('recipient');
	await expect(diagram.locator('.message.linked')).toHaveCount(1);
	await expect(diagram.locator('.message.linked')).toContainText('handOver');

	// The keyboard reaches every message.
	await diagram.getByRole('button', { name: /^Message 1:/ }).focus();
	await page.keyboard.press('Tab');
	await expect(diagram.getByRole('button', { name: /^Message 2:/ })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('uploadPlan');

	// Show in text opens the file at the message.
	await diagram.getByRole('button', { name: 'Show in text' }).click();
	await expect(
		page
			.getByRole('list', { name: 'Open editors' })
			.getByRole('button', { name: 'DeliverySequence.sysml', exact: true })
	).toHaveAttribute('aria-current', 'true');
});
