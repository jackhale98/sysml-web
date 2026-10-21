import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The standard library browser (the sysml-toolkit's library, read in a worker)
// and project archives (.kpar and .zip, read and written in TypeScript).

const FIXTURES = join(import.meta.dirname, 'fixtures');

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

async function expectModelReady(page: Page) {
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

test('the standard library lists its files, opens them read-only under EPL-2.0', async ({
	page
}) => {
	await openDemo(page);
	await page.getByText('SysML standard library').click();
	await page.getByText('Kernel Libraries/Kernel Data Type Library', { exact: true }).click();
	await page.getByRole('button', { name: 'ScalarValues', exact: true }).click();
	const file = page.getByRole('region', { name: /Standard library: .*ScalarValues\.kerml/ });
	await expect(file.locator('.cm-content')).toContainText('datatype Real');
	await expect(file.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await file.getByText('EPL-2.0', { exact: true }).click();
	await expect(file).toContainText('Eclipse Public License 2.0');
	await expectAccessible(page);
});

test('library search finds definitions and opens them at their line', async ({ page }) => {
	await openDemo(page);
	await page.getByPlaceholder('Filter elements').fill('PowerValue');
	const hit = page.getByRole('button', { name: /ISQMechanics::PowerValue/ });
	await expect(hit).toBeVisible();
	await hit.click();
	const file = page.getByRole('region', { name: /ISQMechanics\.sysml/ });
	// Scrolled to the declaration, far down a long file.
	await expect(file.locator('.cm-line', { hasText: 'attribute def PowerValue' })).toBeInViewport();
	await expect(file.locator('.cm-activeLine')).toContainText('attribute def PowerValue');

	// Another hit in the same file moves the open tab to its line.
	await page.getByPlaceholder('Filter elements').fill('MassFlowRateValue');
	await page.getByRole('button', { name: /ISQMechanics::MassFlowRateValue/ }).click();
	await expect(file.locator('.cm-activeLine')).toContainText('attribute def MassFlowRateValue');
	await expectAccessible(page);
});

test('go to definition opens a library type in the library file', async ({ page }) => {
	await openDemo(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	// Exact: the overview may list the file too (among the files with most elements).
	await page.getByRole('button', { name: 'FlightControl.sysml', exact: true }).click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('returnThreshold : Real');
	// Ctrl-click the `Real` in `attribute returnThreshold : Real`.
	const at = await page.evaluate(() => {
		const line = [...document.querySelectorAll('.cm-line')].find((l) =>
			l.textContent?.includes('attribute returnThreshold : Real')
		)!;
		const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
		let seen = '';
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const text = node.textContent ?? '';
			const i = text.indexOf('Real');
			if (i >= 0 && (seen + text.slice(0, i)).includes('returnThreshold')) {
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + 4);
				const box = range.getBoundingClientRect();
				return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			}
			seen += text;
		}
		throw new Error('Real not found');
	});
	await page.keyboard.down('Control');
	await page.mouse.click(at.x, at.y);
	await page.keyboard.up('Control');
	const file = page.getByRole('region', { name: /ScalarValues\.kerml/ });
	await expect(file.locator('.cm-activeLine')).toContainText('datatype Real');
});

test('a .kpar written by another tool imports, with its metadata', async ({ page }) => {
	await page.goto('/projects');
	await page
		.locator('input[type=file][accept*=kpar]')
		.setInputFiles(join(FIXTURES, 'motor-rig.kpar'));
	await expect(page).toHaveURL(/\/p\/motor-rig$/);
	await expectModelReady(page);
	await expect(page.getByRole('heading', { name: 'Motor rig' }).first()).toBeVisible();
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /MotorRig\.sysml/ })
		.click();
	await expect(page.locator('.cm-content')).toContainText('part def LoadCell');
	await expectAccessible(page);
});

test('a .zip of a repository imports without its top folder and binaries', async ({ page }) => {
	await page.goto('/projects');
	await page
		.locator('input[type=file][accept*=kpar]')
		.setInputFiles(join(FIXTURES, 'pump-station-main.zip'));
	await expect(page).toHaveURL(/\/p\/pump-station-main$/);
	await expectModelReady(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	const files = page.locator('.explorer-pane');
	await expect(files.getByRole('button', { name: /PumpStation\.sysml/ })).toBeVisible();
	await expect(files.getByRole('button', { name: /logo\.png/ })).toHaveCount(0);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('the views catalogue lists the standard library', async ({ page }) => {
		await openDemo(page);
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Views' })
			.click();
		const views = page.getByRole('region', { name: 'Editor' });
		await views.getByText('SysML standard library').click();
		await views.getByRole('button', { name: /^Ports/ }).click();
		const file = page.getByRole('region', { name: /Standard library: .*Ports\.sysml/ });
		await expect(file.locator('.cm-content')).toContainText('port def Port');
		await expectAccessible(page);
	});
});
