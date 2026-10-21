import { expect, test, type Page } from '@playwright/test';

/**
 * Phones: every screen fits the display width. Neither the page nor any
 * scrolling area inside it may pan sideways, except the things that scroll
 * by nature: code blocks, the code editor and diagram canvases.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Code blocks, the code editor, diagram canvases and marked carousels ([data-scroll-x]).
const ALLOWED = ['pre', '.cm-scroller', '.cm-editor', '.svelte-flow', '.xyflow', '[data-scroll-x]'];

async function expectFitsWidth(page: Page, where: string) {
	const offenders = await page.evaluate((allowed) => {
		const out: string[] = [];
		const doc = document.documentElement;
		if (doc.scrollWidth > doc.clientWidth || window.scrollX !== 0) out.push('the page itself');
		for (const el of document.querySelectorAll<HTMLElement>('body *')) {
			if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
			const { overflowX } = getComputedStyle(el);
			if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
			if (el.scrollWidth <= el.clientWidth + 1) continue;
			if (allowed.some((selector) => el.matches(selector) || el.closest(selector))) continue;
			out.push(
				`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (+${el.scrollWidth - el.clientWidth}px)`
			);
		}
		return out;
	}, ALLOWED);
	expect(offenders, `sideways scrolling on ${where}`).toEqual([]);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

const nav = (page: Page, name: string) =>
	page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name }).click();

test('on a phone, every main screen fits the width without panning sideways', async ({ page }) => {
	await openDemo(page);
	await expectFitsWidth(page, 'the overview');

	await page.getByRole('button', { name: /Start the tour/ }).click();
	await expect(page.locator('article.document')).toBeVisible();
	await expectFitsWidth(page, 'the tour document');
	// Scroll through the whole document: long names further down must wrap too.
	await page.locator('article.document').evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await expectFitsWidth(page, 'the end of the tour document');

	await nav(page, 'Model');
	await expectFitsWidth(page, 'the model tree');

	await nav(page, 'Views');
	await expectFitsWidth(page, 'the views catalogue');
	await page.getByRole('button', { name: /Search the model/ }).click();
	await page.getByRole('combobox', { name: /Search elements/ }).fill('Open requirements');
	await page.keyboard.press('Enter');
	await expect(page.locator('.cards .card').first()).toBeVisible();
	await expectFitsWidth(page, 'the requirements table');
});

test('on a phone, the budgets and the checks are cards that fit the width', async ({ page }) => {
	await openDemo(page);
	for (const [view, card] of [
		['Drone mass budget', '180 g'],
		['Drone power budget', '397 W'],
		['Design checks', 'Satisfied']
	] as const) {
		await nav(page, 'Views');
		const open = page.getByRole('button', { name: new RegExp(`^${view}`) }).first();
		await open.scrollIntoViewIfNeeded();
		await open.click();
		await expect(page.locator('.cards .card').filter({ hasText: card }).first()).toBeVisible({
			timeout: 15_000
		});
		await expectFitsWidth(page, view);
		await page.locator('.cards-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
		await expectFitsWidth(page, `the end of ${view}`);
	}
});
