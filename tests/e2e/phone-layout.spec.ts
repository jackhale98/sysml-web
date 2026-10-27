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

test('on a phone, the budgets, the checks and the trade study are cards that fit the width', async ({
	page
}) => {
	// Four views opened one after another: more than the default 30 s when the machine is busy.
	test.setTimeout(60_000);
	await openDemo(page);
	for (const [view, card] of [
		['Drone mass budget', '180 g'],
		['Drone power budget', '397 W'],
		['Design checks', 'Satisfied'],
		// A card per alternative, best first.
		['Battery trade', 'semiSolidState']
	] as const) {
		await nav(page, 'Views');
		const open = page.getByRole('button', { name: new RegExp(`^${view}`) }).first();
		await open.scrollIntoViewIfNeeded();
		await open.click();
		await expect(page.locator('.cards .card').filter({ hasText: card }).first()).toBeVisible({
			timeout: 15_000
		});
		await expectFitsWidth(page, view);
		await page
			.locator('.view-table')
			.first()
			.evaluate((el) => el.scrollTo(0, el.scrollHeight));
		await expectFitsWidth(page, `the end of ${view}`);
	}
});

test('on a phone, a sequence diagram scrolls inside its canvas, never the page', async ({
	page
}) => {
	await openDemo(page);
	await nav(page, 'Views');
	const open = page.getByRole('button', { name: /^Delivery sequence/ }).first();
	await open.scrollIntoViewIfNeeded();
	await open.click();
	const diagram = page.getByRole('group', { name: 'Delivery sequence diagram' });
	await expect(diagram.getByRole('button', { name: /^Lifeline «ref part» operator/ })).toBeVisible({
		timeout: 15_000
	});
	await expectFitsWidth(page, 'the sequence diagram');
	const box = (await diagram.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
	// Readable rather than shrunk to fit: drawn at no less than 80 % of full size.
	const size = await diagram
		.locator('.message .name')
		.first()
		.evaluate((el) => el.getBoundingClientRect().height);
	expect(size).toBeGreaterThanOrEqual(12);
	// Panning sideways moves the drawing, not the page.
	const before = await diagram
		.getByRole('button', { name: /^Lifeline «ref part» recipient/ })
		.boundingBox();
	await diagram.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const at = (x: number) => ({
			clientX: x,
			clientY: r.top + r.height / 2,
			pointerId: 1,
			bubbles: true
		});
		el.dispatchEvent(
			new PointerEvent('pointerdown', { ...at(r.right - 20), pointerType: 'touch' })
		);
		el.dispatchEvent(new PointerEvent('pointermove', { ...at(r.left + 40), pointerType: 'touch' }));
		el.dispatchEvent(new PointerEvent('pointerup', { ...at(r.left + 40), pointerType: 'touch' }));
	});
	const after = await diagram
		.getByRole('button', { name: /^Lifeline «ref part» recipient/ })
		.boundingBox();
	expect(after!.x).toBeLessThan(before!.x - 100);
	expect(after!.x + after!.width).toBeLessThanOrEqual(390);
	await expectFitsWidth(page, 'the panned sequence diagram');
});

test('on a phone, the guided forms fit the width', async ({ page }) => {
	await openDemo(page);
	await nav(page, 'Views');
	await page.getByRole('button', { name: 'New view' }).click();
	const view = page.getByRole('dialog', { name: 'New view' });
	await expect(view.getByText('Bill of materials', { exact: true })).toBeVisible();
	await expectFitsWidth(page, 'the new view form');
	await view.getByText('Budget', { exact: true }).click();
	await view.getByRole('button', { name: 'Next' }).click();
	await expectFitsWidth(page, 'the new view form’s second step');
	await page.keyboard.press('Escape');

	await nav(page, 'Model');
	await page
		.getByRole('treeitem')
		.getByRole('button', { name: 'drone', exact: true })
		.first()
		.click();
	await page.getByRole('button', { name: 'Set a limit on takeOffMass of drone' }).click();
	await expect(page.getByRole('dialog', { name: 'Set a limit' }).getByLabel('Limit')).toBeVisible();
	await expectFitsWidth(page, 'the limit form');
});

test('on a phone, recording a test result fits the width', async ({ page }) => {
	await openDemo(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('enduranceFlightTest');
	await palette
		.getByRole('option')
		.filter({ hasText: /^\s*enduranceFlightTest\b/ })
		.first()
		.click();
	await nav(page, 'Details');
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await inspector.getByRole('button', { name: 'Record a result' }).click();
	const form = inspector.getByRole('form', { name: 'Record a result for enduranceFlightTest' });
	await expect(form.getByLabel('Date')).toBeVisible();
	await expectFitsWidth(page, 'the result form');
	// Nothing in the form reaches past the inspector's edge either.
	const past = await form.evaluate((f) => {
		const edge = f.getBoundingClientRect().right;
		return [...f.querySelectorAll('*')]
			.filter((el) => el.getBoundingClientRect().right > edge + 1)
			.map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`);
	});
	expect(past, 'form fields wider than the form').toEqual([]);
});

test('on a phone, a large diagram opens readable from its start, clear of the toolbar', async ({
	page
}) => {
	await openDemo(page);
	await nav(page, 'Views');
	const open = page.getByRole('button', { name: /^Flight mode states/ }).first();
	await open.scrollIntoViewIfNeeded();
	await open.click();
	const diagram = page.getByRole('region', { name: /Flight mode states diagram/ });
	const idle = diagram.getByRole('group', { name: 'state idle', exact: true });
	await expect(idle).toBeVisible({ timeout: 15_000 });
	// Not shrunk to fit the whole machine on the screen: drawn at a readable zoom…
	await expect
		.poll(() =>
			diagram
				.locator('.svelte-flow__viewport')
				.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
		)
		.toBeGreaterThanOrEqual(0.65);
	// …from its first state, inside the canvas and below the diagram tools.
	await expect
		.poll(async () => {
			const tools = (await diagram.getByRole('toolbar', { name: 'Diagram tools' }).boundingBox())!;
			const box = (await idle.boundingBox())!;
			return box.y >= tools.y + tools.height && box.x >= 0 && box.x + box.width <= 390;
		})
		.toBe(true);
	await expectFitsWidth(page, 'the state diagram');
});
