/**
 * The landing page: what it says Tessera does, its links, accessibility in
 * both themes, and a phone without sideways scrolling.
 */
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

test('the sections lead with text and diagrams, then yours, then analysis', async ({ page }) => {
	await page.goto('/');
	const headings = page.locator('main h2');
	await expect(headings).toHaveText([
		'Two ways in. One model.',
		'Plain SysML v2, in your own repository.',
		'Ask the model, not a spreadsheet.',
		'The work you already do, as live model views.',
		'Learn the language by using it.',
		'Open a model in seconds.'
	]);
	for (const name of ['How it works', 'Yours', 'Analysis', 'Get started']) {
		const link = page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name });
		const target = await link.getAttribute('href');
		await expect(page.locator(target!)).toHaveCount(1);
	}
	const analysis = page.getByRole('region', { name: 'Ask the model, not a spreadsheet.' });
	for (const name of [
		'Checks and budgets',
		'Trade studies',
		'Simulate state machines',
		'Risk analysis',
		'Dependency matrices',
		'Reports and exports'
	])
		await expect(analysis.getByRole('heading', { name, level: 3 })).toBeVisible();
	// Nothing on offer is "coming soon".
	await expect(page.getByText('Coming soon')).toHaveCount(0);
});

test('every way to start goes where it says', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Start from a spreadsheet' }).click();
	await expect(page).toHaveURL(/\/projects\?new&template=requirements$/);
	await expect(page.getByRole('radio', { name: /Requirements first/ })).toBeChecked();

	await page.goto('/');
	await page.getByRole('link', { name: 'Open a folder or a file' }).click();
	await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`is accessible in the ${colorScheme} theme`, async ({ page }) => {
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expectAccessible(page);
	});
}

test('fits a phone without scrolling sideways', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBe(0);
	await page.emulateMedia({ colorScheme: 'dark' });
	await expectAccessible(page);
});

test('the wordmark is drawn whole, its last letter not clipped', async ({ page }) => {
	await page.goto('/');
	// The outlined letters must sit inside the drawing's box, with room for the
	// anti-aliased edge: an inline SVG clips at its box (seen on a phone's "a").
	const room = await page.locator('header .brand svg[aria-label="Tessera"]').evaluate((svg) => {
		const s = svg as SVGSVGElement;
		const view = s.viewBox.baseVal;
		const path = s.querySelector('path')!;
		const box = path.getBBox();
		const m = path.transform.baseVal.consolidate()?.matrix;
		const x = (v: number) => (m ? m.a * v + m.e : v);
		const y = (v: number) => (m ? m.d * v + m.f : v);
		return {
			left: x(box.x) - view.x,
			right: view.x + view.width - x(box.x + box.width),
			top: y(box.y) - view.y,
			bottom: view.y + view.height - y(box.y + box.height)
		};
	});
	for (const [side, gap] of Object.entries(room)) expect(gap, side).toBeGreaterThanOrEqual(0.5);
});
