/**
 * The traceability matrices (`TraceMatrix`, `VerificationMatrix`): every
 * requirement in scope down the side with its gaps flagged, readable element
 * names across the top, counts, a sideways scroll that says how much more
 * there is, marks that select what they link, and a card per requirement on
 * a phone. And requirement coverage: who satisfies and verifies, as links.
 */
import { readFile } from 'node:fs/promises';
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

/** Open a saved view: the demo saves both matrices; the palette reaches them on any screen. */
async function openSaved(page: Page, name: string) {
	await page.getByRole('button', { name: /Search the model/ }).click();
	const palette = page.getByRole('dialog').filter({ has: page.getByRole('listbox') });
	await palette.getByRole('combobox').fill(name);
	await palette
		.getByRole('option')
		.filter({ hasText: name })
		.filter({ hasNotText: 'New view' })
		.first()
		.click();
	await expect(palette).toBeHidden();
}

async function openView(page: Page, name: string) {
	if (name === 'Trace matrix' || name === 'Verification matrix') await openSaved(page, name);
	else
		await page
			.locator('section[aria-labelledby="views-heading"]')
			.getByRole('button', { name, exact: true })
			.click();
	const view = page.getByRole('region', { name: `${name} view` });
	await expect(view.getByText('24 rows')).toBeVisible({ timeout: 15_000 });
	return view;
}

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.describe('on a desktop', () => {
	test('the trace matrix has every requirement, readable headers, counts and flagged gaps', async ({
		page
	}) => {
		await openDemo(page);
		const view = await openView(page, 'Trace matrix');
		const grid = view.getByRole('table');
		await expect(grid.getByRole('columnheader', { name: 'Requirement' })).toHaveAttribute(
			'aria-sort',
			'ascending'
		);
		// The element's declared name in words, with the owner it is written under.
		await expect(
			grid.getByRole('columnheader', { name: 'Flight controller (drone)' })
		).toBeVisible();
		await expect(
			grid.getByRole('columnheader', { name: 'Battery management system' })
		).toBeVisible();
		await expect(grid.getByRole('columnheader', { name: /flightController/ })).toHaveCount(0);
		// Every requirement is a row: 24, and a total row.
		await expect(grid.getByRole('rowheader')).toHaveCount(25);
		const gap = grid.getByRole('row').filter({ hasText: 'SYS-005' });
		await expect(gap.getByRole('rowheader')).toContainText('Ingress protection');
		await expect(gap.getByRole('rowheader')).toContainText('Not satisfied');
		await expect(gap.getByRole('cell').last()).toHaveText('0');
		const met = grid.getByRole('row').filter({ hasText: 'SYS-010' });
		await expect(
			met.getByRole('button', {
				name: 'SYS-010 Command and telemetry link is satisfied by drone.radio'
			})
		).toBeVisible();
		await expect(met.getByRole('rowheader')).not.toContainText('Not satisfied');
		// By the coverage rule: the 16 linked, and the 4 needs satisfied through the requirements
		// derived from them (flagged as such, not as gaps).
		await expect(view.getByText('20 of 24')).toBeVisible();
		await expect(view.getByText('4 not satisfied')).toBeVisible();
		const need = grid.getByRole('row').filter({ hasText: 'STK-001' });
		await expect(need.getByRole('rowheader')).toContainText('Through derived requirements');
		await expect(need.getByRole('rowheader')).not.toContainText('Not satisfied');
		// The column totals: the drone satisfies three.
		const totals = grid
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: 'Total' }) });
		await expect(totals.getByRole('cell')).toHaveText([
			'1',
			'3',
			'1',
			'3',
			'2',
			'1',
			'1',
			'1',
			'1',
			'1',
			'1',
			'16'
		]);
		await expectAccessible(page);
	});

	test('a mark selects the requirement with its link; a header selects its element', async ({
		page
	}) => {
		await openDemo(page);
		const view = await openView(page, 'Trace matrix');
		await view
			.getByRole('button', {
				name: 'SYS-004 Wind tolerance is satisfied by drone.flightController'
			})
			.click();
		await expect(inspector(page).getByRole('heading', { level: 2 })).toContainText(
			'Wind tolerance'
		);
		await expect(inspector(page)).toContainText('drone.flightController');
		// The link chosen, said in words, with the way to its SysML.
		const picked = view.locator('.picked');
		await expect(picked).toContainText('Wind tolerance');
		await expect(picked).toContainText('is satisfied by');
		await expect(view.getByRole('row').filter({ hasText: 'SYS-004' })).toHaveClass(/selected/);

		await view.getByRole('columnheader', { name: 'Battery (drone)' }).getByRole('button').click();
		await expect(inspector(page).getByRole('heading', { level: 2 })).toContainText('battery');

		await view.getByRole('button', { name: /SYS-007 Geofencing is satisfied by/ }).click();
		await view.getByRole('button', { name: 'Show in SysML' }).click();
		// The file opens at the `satisfy`.
		await expect(page.locator('.cm-content').first()).toContainText("satisfy 'Geofencing'", {
			timeout: 10_000
		});
	});

	test('show only gaps, hide empty columns and sort by total', async ({ page }) => {
		await openDemo(page);
		const view = await openView(page, 'Trace matrix');
		const grid = view.getByRole('table');
		await view.getByRole('checkbox', { name: 'Show only gaps' }).check();
		const body = grid.locator('tbody tr');
		await expect(body).toHaveCount(4);
		for (const row of await body.all()) await expect(row).toContainText('Not satisfied');
		await view.getByRole('checkbox', { name: 'Hide empty columns' }).check();
		await expect(grid.locator('thead th[data-c]')).toHaveCount(0);
		await view.getByRole('checkbox', { name: 'Show only gaps' }).uncheck();
		await expect(body).toHaveCount(24);
		await expect(grid.locator('thead th[data-c]')).toHaveCount(11);

		// Sorted by how many: the most first, then fewest first.
		await grid.getByRole('button', { name: 'Total' }).click();
		await expect(grid.getByRole('columnheader', { name: 'Total' })).toHaveAttribute(
			'aria-sort',
			'descending'
		);
		await grid.getByRole('button', { name: 'Total' }).click();
		await expect(body.first().getByRole('cell').last()).toHaveText('0');
		await expect(grid.getByRole('columnheader', { name: 'Total' })).toHaveAttribute(
			'aria-sort',
			'ascending'
		);
		await expect(grid.getByRole('columnheader', { name: 'Requirement' })).not.toHaveAttribute(
			'aria-sort'
		);
	});

	test('the verification matrix exports its grid with readable headers', async ({ page }) => {
		await openDemo(page);
		const view = await openView(page, 'Verification matrix');
		await expect(view.getByRole('columnheader', { name: 'Endurance flight test' })).toBeVisible();
		await expect(
			view.getByRole('row').filter({ hasText: 'SYS-011' }).getByRole('rowheader')
		).toContainText('Not verified');
		await view.getByRole('button', { name: 'Export' }).click();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('menuitem', { name: /CSV/ }).click()
		]);
		const csv = (await readFile((await download.path())!)).toString('utf8');
		const [header, ...lines] = csv
			.replace(/^\uFEFF/, '')
			.trim()
			.split(/\r?\n/);
		expect(header).toBe(
			'ID,Requirement,Battery abuse test,Endurance flight test,Failsafe flight test,Hand over warning review,Link range test,Mass and payload check,Propeller guard inspection,Release interlock test,Rotor failure test,Wind hold test,Total'
		);
		expect(lines).toHaveLength(24);
		expect(lines).toContain(`SYS-001,Flight endurance,,✓${','.repeat(8)},1`);
		expect(lines).toContain(`SYS-011,Controlled parcel release${','.repeat(10)},0`);
		// Two risk controls are not verified yet, on purpose.
		expect(lines).toContain(`RC-007,Drop-zone clearance check${','.repeat(10)},0`);
	});

	test('requirement coverage names who satisfies and verifies, and what is not yet', async ({
		page
	}) => {
		await openDemo(page);
		const view = await openView(page, 'Requirement coverage');
		await expect(view.getByRole('columnheader', { name: 'Satisfied by' })).toBeVisible();
		const row = view.locator('tbody tr').filter({ hasText: 'Controlled parcel release' });
		await expect(row.locator('td').nth(3)).toHaveText('Not yet');
		await row.getByRole('button', { name: 'drone.payloadRelease' }).click();
		await expect(inspector(page).getByRole('heading', { level: 2 })).toContainText(
			'payloadRelease'
		);
		await expectAccessible(page);
	});
});

test.describe('in a narrow pane', () => {
	test.use({ viewport: { width: 820, height: 760 } });

	test('the columns scroll sideways under the requirements, saying how many more there are', async ({
		page
	}) => {
		await openDemo(page);
		const view = await openView(page, 'Trace matrix');
		const scroller = view.locator('.frame .scroll');
		const more = view.getByRole('button', { name: /^Scroll right: \d+ more column/ });
		await expect(more).toBeVisible();
		const last = view.getByRole('columnheader', { name: 'Warning labels and tone' });
		const inView = async () =>
			last.evaluate((th) => {
				const box = th.closest('.scroll')!.getBoundingClientRect();
				const r = th.getBoundingClientRect();
				return r.right <= box.right - 60;
			});
		expect(await inView()).toBe(false);
		await more.click();
		await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
		// A page of columns at a time, until the last is in view.
		await expect
			.poll(async () => {
				if (!(await inView()) && (await more.isVisible())) await more.click();
				return inView();
			})
			.toBe(true);
		await expect(view.getByRole('button', { name: /^Scroll left: \d+ more column/ })).toBeVisible();
		// The requirements stay put.
		await expect(view.getByRole('rowheader', { name: /RC-001/ })).toBeInViewport();
		await expectAccessible(page);
	});
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('a card per requirement, what satisfies it as chips, gaps flagged', async ({ page }) => {
		await openDemo(page);
		await openSaved(page, 'Trace matrix');
		const view = page.getByRole('region', { name: 'Trace matrix view' });
		const cards = view.getByRole('list', { name: /Requirements and what they are satisfied by/ });
		await expect(cards.locator(':scope > li')).toHaveCount(24, { timeout: 15_000 });
		const wind = cards.locator(':scope > li').filter({ hasText: 'SYS-004' });
		await expect(wind).toContainText('Wind tolerance');
		await expect(
			wind.getByRole('button', { name: 'Flight controller (drone), select' })
		).toBeVisible();
		const gap = cards.locator(':scope > li').filter({ hasText: 'SYS-005' });
		await expect(gap).toContainText('Not satisfied');
		// Nothing pans sideways.
		const wide = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth
		);
		expect(wide).toBe(false);
		await view.getByRole('checkbox', { name: 'Show only gaps' }).check();
		await expect(cards.locator(':scope > li')).toHaveCount(4);
		await expectAccessible(page);
	});
});
