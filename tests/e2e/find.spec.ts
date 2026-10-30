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

async function searchFor(page: Page, text: string) {
	await page.getByRole('button', { name: /Search the model/ }).click();
	await page.getByRole('combobox', { name: /Search elements/ }).fill(text);
}

test('the inspector suggests types from the project and the standard library', async ({ page }) => {
	await openDemo(page);
	await searchFor(page, 'returnThreshold');
	await page
		.getByRole('option', { name: /returnThreshold/ })
		.first()
		.click();

	const type = page.getByRole('combobox', { name: /^Type/ });
	await expect(type).toHaveValue('Real');
	await type.fill('Mass');
	const suggestions = page.getByRole('listbox', { name: 'Suggestions' });
	await expect(suggestions.getByText('Standard library')).toBeVisible();
	await expect(suggestions.getByRole('option', { name: /MassValue/ }).first()).toBeVisible();
	await expectAccessible(page);

	// A part's type lists the part definitions already in the project.
	await page.keyboard.press('Escape');
	await searchFor(page, 'powerDistribution');
	await page
		.getByRole('option', { name: /powerDistribution/ })
		.first()
		.click();
	const partType = page.getByRole('combobox', { name: /^Type/ });
	await partType.fill('');
	await expect(suggestions.getByText('In this project')).toBeVisible();
	await expect(suggestions.getByRole('option', { name: /Battery/ }).first()).toBeVisible();
	await suggestions
		.getByRole('option', { name: /PowerDistributionBoard/ })
		.first()
		.click();
	await expect(partType).toHaveValue('PowerDistributionBoard');

	// Half-typed text is put back when you leave the field; Enter would keep it.
	await partType.fill('Rot');
	await page.keyboard.press('Tab');
	await expect(partType).toHaveValue('PowerDistributionBoard');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('a tapped type suggestion fills the field', async ({ page }) => {
		await openDemo(page);
		await searchFor(page, 'powerDistribution');
		await page
			.getByRole('option', { name: /powerDistribution/ })
			.first()
			.tap();
		const partType = page.getByRole('combobox', { name: /^Type/ });
		await partType.tap();
		await partType.fill('Batt');
		const suggestion = page
			.getByRole('listbox', { name: 'Suggestions' })
			.getByRole('option', { name: /^Battery\b/ })
			.first();
		// The field loses focus as the finger lifts, as it does on a phone.
		await suggestion.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
		await partType.evaluate((el) => (el as HTMLInputElement).blur());
		await suggestion.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
		await expect(partType).toHaveValue('Battery');
		await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(/Battery/);
	});

	test('search in a table takes you to the row, or shows only the matches', async ({ page }) => {
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Views' })
			.click();
		await page.getByText('Requirements', { exact: true }).first().click();
		await expect(page.getByText('25 rows')).toBeVisible();

		await searchFor(page, 'geofencing');
		await expect(page.getByRole('group', { name: 'In this table' })).toBeVisible();
		await expectAccessible(page);
		await page
			.getByRole('option', { name: /Geofencing/ })
			.first()
			.click();
		const card = page.locator('.cards .card').filter({ hasText: 'SYS-007' });
		await expect(card).toBeInViewport();

		await searchFor(page, 'high');
		const filter = page.getByRole('option', { name: /Show only the \d+ rows matching/ });
		const label = (await filter.textContent()) ?? '';
		const count = Number(label.match(/(\d+) rows/)?.[1]);
		await filter.click();
		await expect(page.getByText(`${count} of 25 rows`)).toBeVisible();
		await expect(page.locator('.cards .card')).toHaveCount(count);
	});
});
