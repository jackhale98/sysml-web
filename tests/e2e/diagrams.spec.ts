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

async function openView(page: Page, name: string) {
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name, exact: true })
		.click();
	const diagram = page.getByRole('region', { name: new RegExp(`${name} diagram`) });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });
	return diagram;
}

test('an interconnection view shows inherited ports, flows and bindings', async ({ page }) => {
	await openDemo(page);
	const diagram = await openView(page, 'Drone interconnection');
	// The drone's own port comes from DeliveryDrone; it is bound to the radio's.
	await expect(diagram.getByText('commandLink : ~CommandLinkPort').first()).toBeVisible();
	await expect(diagram.getByText('MotorCommand')).toHaveCount(4);
	await expect(diagram.getByText('batteryPower')).toBeVisible();
	// Nodes map to the elements they draw.
	await diagram.getByText('battery : Battery', { exact: true }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('battery');
	await expectAccessible(page);
});

test('on an interconnection view, each line runs to the ports it connects', async ({ page }) => {
	await openDemo(page);
	const diagram = await openView(page, 'Drone interconnection');
	/** Where a line ends on screen, and where the port squares at its ends are. */
	const check = async (label: string, from: [string, string], to: [string, string]) => {
		const line = diagram.getByRole('group', { name: label });
		const ends = await line
			.locator('path.svelte-flow__edge-path')
			.evaluate((path: SVGPathElement) => {
				const m = path.getScreenCTM()!;
				const at = (l: number) => {
					const p = path.getPointAtLength(l).matrixTransform(m);
					return { x: p.x, y: p.y };
				};
				return [at(0), at(path.getTotalLength())];
			});
		const zoom = await diagram
			.locator('.svelte-flow__viewport')
			.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
		for (const [[name, port], end] of [
			[from, ends[0]!],
			[to, ends[1]!]
		] as const) {
			const node = diagram.locator(`.svelte-flow__node[data-id="${name}"]`);
			const row = (await node.locator('.side li').filter({ hasText: port }).boundingBox())!;
			const box = (await node.boundingBox())!;
			// The port's square sits on the border, 9 px below the top of its row.
			expect(Math.abs(end.y - (row.y + 9 * zoom)), `${label}: ${name}.${port} (y)`).toBeLessThan(
				2 * zoom + 1
			);
			const border = Math.min(Math.abs(end.x - box.x), Math.abs(end.x - (box.x + box.width)));
			expect(border, `${label}: ${name}.${port} (x)`).toBeLessThan(9 * zoom);
		}
	};
	await check(
		'connection from battery : Battery to powerDistribution : PowerDistributionBoard',
		['battery', 'powerOut'],
		['powerDistribution', 'powerIn']
	);
	await check(
		'flow from gnss : GnssReceiver to flightController : FlightController',
		['gnss', 'navigation'],
		['flightController', 'navigation']
	);
	await check(
		'connection from radio : TelemetryRadio to flightController : FlightController',
		['radio', 'controllerLink'],
		['flightController', 'commandLink']
	);
	await check(
		'flow from camera : Camera to flightController : FlightController',
		['camera', 'imageOut'],
		['flightController', 'imageIn']
	);
	await check(
		'connection from powerDistribution : PowerDistributionBoard to frontLeft : Rotor',
		['powerDistribution', 'rotorPower'],
		['frontLeft', 'powerIn']
	);
	// A box moved by hand keeps its lines on its ports.
	const battery = (await diagram
		.locator('.svelte-flow__node[data-id="battery"] .head')
		.boundingBox())!;
	await page.mouse.move(battery.x + battery.width / 2, battery.y + battery.height / 2);
	await page.mouse.down();
	await page.mouse.move(battery.x + battery.width / 2, battery.y + 90, { steps: 8 });
	await page.mouse.up();
	const moved = (await diagram
		.locator('.svelte-flow__node[data-id="battery"] .head')
		.boundingBox())!;
	expect(moved.y - battery.y).toBeGreaterThan(30);
	await check(
		'connection from battery : Battery to powerDistribution : PowerDistributionBoard',
		['battery', 'powerOut'],
		['powerDistribution', 'powerIn']
	);
});

test('selecting a node highlights its connections and what they reach', async ({ page }) => {
	await openDemo(page);
	const diagram = await openView(page, 'Drone interconnection');
	await expect(diagram.locator('.sysml-edge.lit')).toHaveCount(0);
	await diagram.getByText('powerDistribution : PowerDistributionBoard', { exact: true }).click();
	// The battery feeds it; it feeds the four rotors and the flight controller.
	await expect(diagram.locator('.sysml-edge.lit')).toHaveCount(6);
	await expect(diagram.locator('.svelte-flow__node .linked')).toHaveCount(6);
	await expect(diagram.locator('.sysml-edge-label.lit').first()).toBeVisible();
	await expect(diagram.locator('.sysml-edge.dim').first()).toBeAttached();
	await expectAccessible(page);
	// Clicking the canvas clears it.
	await diagram.locator('.svelte-flow__pane').click({ position: { x: 5, y: 5 } });
	await expect(diagram.locator('.sysml-edge.lit')).toHaveCount(0);
});

test('state and action views draw transitions and decision branches', async ({ page }) => {
	await openDemo(page);
	const states = await openView(page, 'Flight mode states');
	await expect(states.getByText('ArmCommand [preflightChecksPassed]')).toBeVisible();
	await expect(states.getByText('when stateOfCharge < returnThreshold')).toBeVisible();
	await expect(states.locator('.svelte-flow__edge')).toHaveCount(17);
	// Transition labels never cover each other (antiparallel ones included).
	const boxes = await states
		.locator('.sysml-edge-label')
		.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
	const crossing = boxes.flatMap((a, i) =>
		boxes
			.slice(i + 1)
			.filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
	);
	expect(boxes.length).toBeGreaterThan(8);
	expect(crossing).toEqual([]);

	const flow = await openView(page, 'Delivery flight flow');
	await expect(flow.getByText('[checkDropZone.isClear]')).toBeVisible();
	await expect(flow.getByText('returnHome', { exact: true })).toBeVisible();
	await expectAccessible(page);
});

test('general views draw a view usage with its filters, and «derive» links', async ({ page }) => {
	await openDemo(page);
	const catalogue = await openView(page, 'Component catalogue');
	await expect(catalogue.getByText('gv [componentCatalogue]')).toBeVisible();
	await expect(catalogue.locator('.svelte-flow__node')).toHaveCount(13);

	const tree = await openView(page, 'Requirement tree');
	await expect(tree.locator('.svelte-flow__node')).toHaveCount(17);
	await expect(tree.getByText('derive').first()).toBeVisible();
	await expect(tree.locator('.svelte-flow__edge')).toHaveCount(11);
});

test('deleting a specialization drawn from the supertype down removes its text', async ({
	page
}) => {
	await openDemo(page);
	const catalogue = await openView(page, 'Component catalogue');
	const edge = catalogue.getByRole('group', { name: /specialization from Camera to Component/ });
	// Edges overlap near the supertype: pick this one by keyboard.
	await edge.focus();
	await page.keyboard.press('Delete');
	const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
	await expect(dialog.getByText(/no longer specializes Component/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Remove' }).click();
	await expect(catalogue.getByRole('group', { name: /specialization from Camera/ })).toHaveCount(
		0,
		{ timeout: 10_000 }
	);
});

test('the divider between the text and the diagram resizes them, and stays put', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: /^DroneArchitecture\.sysml/ })
		.click();
	const divider = page.getByRole('separator', { name: 'Resize the text and the diagram' });
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	const text = page.locator('.split .text');
	const before = (await text.boundingBox())!.width;

	// By keyboard: two steps toward the diagram.
	await divider.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(divider).toHaveAttribute('aria-valuenow', '60');
	await expect.poll(async () => (await text.boundingBox())!.width).toBeGreaterThan(before);

	// By dragging: most of the way left (it stops at a fifth).
	const box = (await divider.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + 200);
	await page.mouse.down();
	await page.mouse.move(box.x - 600, box.y + 200, { steps: 5 });
	await page.mouse.up();
	await expect(divider).toHaveAttribute('aria-valuenow', '20');

	// Remembered on this device.
	await page.reload();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: /^DroneArchitecture\.sysml/ })
		.click();
	await expect(
		page.getByRole('separator', { name: 'Resize the text and the diagram' })
	).toHaveAttribute('aria-valuenow', '20');
	await expectAccessible(page);
});
