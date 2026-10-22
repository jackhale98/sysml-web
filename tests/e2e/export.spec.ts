import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
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

async function bytes(download: Download): Promise<Buffer> {
	return readFile((await download.path())!);
}

test('a diagram exports as a standalone SVG with every node, inside its frame', async ({
	page
}) => {
	await openDemo(page);
	const diagram = await openView(page, 'Drone interconnection');
	// Zoomed in on one corner: the export still holds the whole drawing.
	for (let i = 0; i < 3; i++) await diagram.getByRole('button', { name: 'Zoom In' }).click();

	await diagram.getByRole('button', { name: 'Export' }).click();
	const menu = page.getByRole('menu', { name: 'Export diagram' });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'SVG', exact: true })).toBeFocused();
	await expectAccessible(page);

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		menu.getByRole('menuitem', { name: 'SVG', exact: true }).click()
	]);
	expect(download.suggestedFilename()).toBe('drone-interconnection.svg');
	const svg = (await bytes(download)).toString('utf8');
	expect(svg).not.toMatch(/foreignObject|<marker|url\(|var\(--|<image|href=/);

	// It parses as SVG, and holds what the canvas shows, frame included.
	const parsed = await page.evaluate((text) => {
		const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
		return {
			error: doc.querySelector('parsererror')?.textContent ?? null,
			root: doc.documentElement.tagName,
			texts: [...doc.querySelectorAll('text')].map((t) => t.textContent ?? '')
		};
	}, svg);
	expect(parsed.error).toBeNull();
	expect(parsed.root).toBe('svg');
	for (const text of [
		'iv [drone]',
		'airframe : Airframe',
		'battery : Battery',
		'powerDistribution : PowerDistributionBoard',
		'payloadRelease : PayloadRelease',
		'powerOut : PowerPort',
		'batteryPower',
		'«part»'
	]) {
		expect(parsed.texts).toContain(text);
	}
	expect(parsed.texts.filter((t) => t === 'MotorCommand')).toHaveLength(4);
	// The canvas is as it was: no selection or highlight leaked into the file.
	await expect(diagram.locator('.svelte-flow__node')).not.toHaveCount(0);
});

test('a diagram exports as a 2× PNG, white or transparent', async ({ page }) => {
	await openDemo(page);
	const diagram = await openView(page, 'Flight mode states');
	const exportAs = async (transparent: boolean) => {
		await diagram.getByRole('button', { name: 'Export' }).click();
		const option = page.getByRole('menuitemcheckbox', { name: 'Transparent background' });
		if ((await option.getAttribute('aria-checked')) !== String(transparent)) await option.click();
		await expect(option).toHaveAttribute('aria-checked', String(transparent));
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('menuitem', { name: 'PNG', exact: true }).click()
		]);
		expect(download.suggestedFilename()).toBe('flight-mode-states.png');
		return bytes(download);
	};
	const png = await exportAs(false);
	expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	expect(width).toBeGreaterThan(800);
	expect(height).toBeGreaterThan(800);

	// Decoded in the page: the corner is opaque white, or clear when asked.
	const corner = (data: Buffer) =>
		page.evaluate(async (base64) => {
			const image = new Image();
			image.src = `data:image/png;base64,${base64}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(image, 0, 0);
			return [...ctx.getImageData(2, 2, 1, 1).data];
		}, data.toString('base64'));
	expect(await corner(png)).toEqual([255, 255, 255, 255]);
	const clear = await exportAs(true);
	expect((await corner(clear))[3]).toBe(0);
});

test('a diagram copies to the clipboard as an image', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await openDemo(page);
	const diagram = await openView(page, 'Delivery flight flow');
	await diagram.getByRole('button', { name: 'Export' }).click();
	await page.getByRole('menuitem', { name: 'Copy image', exact: true }).click();
	await expect(page.getByText('Copied the diagram as an image.')).toBeVisible();
	const types = await page.evaluate(async () => {
		const items = await navigator.clipboard.read();
		return items.flatMap((item) => [...item.types]);
	});
	expect(types).toContain('image/png');
	// Focus returns to the button.
	await expect(diagram.getByRole('button', { name: 'Export' })).toBeFocused();
});

test('the export menu works from the keyboard and closes with Escape', async ({ page }) => {
	await openDemo(page);
	const diagram = await openView(page, 'Requirement tree');
	const button = diagram.getByRole('button', { name: 'Export' });
	await button.focus();
	await page.keyboard.press('Enter');
	const menu = page.getByRole('menu', { name: 'Export diagram' });
	await expect(menu.getByRole('menuitem', { name: 'SVG', exact: true })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitem', { name: 'PNG', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(button).toBeFocused();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('on a phone, the diagram toolbar exports the diagram', async ({ page }) => {
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Views' })
			.click();
		await page.getByRole('button', { name: 'Drone interconnection Diagram' }).first().click();
		const diagram = page.getByRole('region', { name: /Drone interconnection diagram/ });
		await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });

		const button = diagram.getByRole('button', { name: 'Export' });
		await expect(button).toBeInViewport();
		await button.click();
		const menu = page.getByRole('menu', { name: 'Export diagram' });
		await expect(menu).toBeInViewport({ ratio: 1 });
		await expectAccessible(page);
		// No share sheet in the test browser: the file downloads instead.
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			menu.getByRole('menuitem', { name: 'SVG', exact: true }).click()
		]);
		expect(download.suggestedFilename()).toBe('drone-interconnection.svg');
		expect((await bytes(download)).toString('utf8')).toContain('battery : Battery');
	});
});
