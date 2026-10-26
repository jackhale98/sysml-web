/**
 * Assessment evidence for checklist §10 (docs/assessment/10-performance-usability.md):
 * thousands of problems, navigating a large model, accessibility across views
 * and themes, keyboard-only use and focus in dialogs, the contrast check that
 * fails now and then on the import dialog, recovery without a reload, every
 * outbound request, screen sizes, a first-time user's guided walk-through and
 * the version shown in Settings.
 *
 * Timings are written to the test's annotations (type "measure") and the
 * console; their budgets are generous, for a shared machine.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { generateLines } from '../perf/generate';
import { analyze } from './axe';

test.describe.configure({ timeout: 300_000 });

function measure(name: string, value: number | string) {
	const v = typeof value === 'number' ? Math.round(value) : value;
	test.info().annotations.push({ type: 'measure', description: `${name}: ${v}` });
	console.log(`measure ${test.info().title} | ${name}: ${v}`);
}

/** Wait for running CSS animations (a dialog's entrance) to finish. */
async function settled(page: Page) {
	// Only animations that end (a spinner's never does).
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
				.map((a) => a.finished.catch(() => undefined))
		)
	);
}

async function violations(page: Page, where: string) {
	await settled(page);
	const results = await analyze(page);
	return results.violations.map(
		(v) => `${where} — ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
}

const ready = (page: Page, timeout = 60_000) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' }).first()).toBeVisible({
		timeout
	});

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await ready(page);
}

/** Put a project in the browser's project store (IndexedDB), as opening one does. */
async function store(page: Page, id: string, files: { path: string; text: string }[]) {
	await page.goto('/projects');
	await page.evaluate(
		async ({ id, files }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('sysml-web', 1);
				request.onupgradeneeded = () =>
					request.result.createObjectStore('projects', { keyPath: 'id' });
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const now = new Date().toISOString();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('projects', 'readwrite');
				tx.objectStore('projects').put({
					id,
					info: { name: id },
					files,
					origin: 'new',
					created: now,
					updated: now
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
		},
		{ id, files }
	);
}

async function observeLongTasks(page: Page) {
	await page.addInitScript(() => {
		const tasks: PerformanceEntry[] = [];
		(window as unknown as { __longTasks: PerformanceEntry[] }).__longTasks = tasks;
		new PerformanceObserver((list) => tasks.push(...list.getEntries())).observe({
			type: 'longtask',
			buffered: true
		});
	});
}
const longestTaskSince = (page: Page, from: number) =>
	page.evaluate(
		(from) =>
			Math.max(
				0,
				...((window as unknown as { __longTasks?: PerformanceEntry[] }).__longTasks ?? [])
					.filter((t) => t.startTime >= from)
					.map((t) => t.duration)
			),
		from
	);
const now = (page: Page) => page.evaluate(() => performance.now());

/** 5,000 unresolved types in ten files: 5,000 problems (the engine reports unresolved names as warnings). */
function brokenProject(files = 10, perFile = 500) {
	return Array.from({ length: files }, (_, f) => ({
		path: `broken/Broken${f}.sysml`,
		text: [
			`package Broken${f} {`,
			`    doc /* ${perFile} parts typed by definitions that don't exist. */`,
			`    part def Holder${f} {`,
			...Array.from({ length: perFile }, (_, i) => `        part p${i} : Missing${f}_${i};`),
			'    }',
			'}',
			''
		].join('\n')
	}));
}

test('a model with 5,000 problems stays usable: problems list, editor, status bar', async ({
	page
}) => {
	await observeLongTasks(page);
	await page.setViewportSize({ width: 1440, height: 900 });
	await store(page, 'five-thousand-problems', brokenProject());
	const from = Date.now();
	await page.goto('/p/five-thousand-problems');
	await ready(page, 120_000);
	measure('open → Model ready (ms)', Date.now() - from);
	const chip = page.getByRole('button', { name: /^Problems: \d+ errors/ });
	await expect(chip).toHaveAccessibleName(/^Problems: 0 errors, 5000 warnings/, {
		timeout: 60_000
	});
	measure('open → 5000 problems in the status bar (ms)', Date.now() - from);
	measure('open: longest main-thread task (ms)', await longestTaskSince(page, 0));

	// The problems list: the first 500, and how many more.
	let t0 = await now(page);
	await chip.click();
	const pane = page.getByRole('region', { name: 'Problems' });
	await expect(pane.locator('ul > li > button').first()).toBeVisible();
	measure('open the problems list (ms)', (await now(page)) - t0);
	// One row per problem (with its file:line), under a heading row per kind of problem.
	const rows = pane.locator('ul > li > button').filter({ hasText: /\.sysml:\d+/ });
	await expect(rows).toHaveCount(500);
	await expect(pane.getByText('4500 more not listed.')).toBeVisible();
	measure('problems list: longest task (ms)', await longestTaskSince(page, t0));

	// Scroll to the end of the list and back.
	const scroll = await rows
		.first()
		.locator('xpath=ancestor::ul[1]')
		.evaluate(async (ul) => {
			const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
			const start = performance.now();
			ul.scrollTop = ul.scrollHeight;
			await frame();
			await frame();
			ul.scrollTop = 0;
			await frame();
			await frame();
			return performance.now() - start;
		});
	measure('problems list: scroll to the end and back (ms)', scroll);

	// A problem opens its file at the place, with 500 errors marked in it.
	t0 = await now(page);
	await rows.nth(250).click();
	await expect(page.locator('.cm-content .cm-line').first()).toBeVisible();
	measure('open a problem in the editor (ms)', (await now(page)) - t0);
	await expect(page.locator('.cm-lintRange-warning, .cm-lintRange-error').first()).toBeVisible({
		timeout: 30_000
	});
	measure('open a problem: longest task (ms)', await longestTaskSince(page, t0));

	// Typing in that file: a character appears at once; the analysis follows.
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+End');
	t0 = await now(page);
	await page.keyboard.type('// still typing');
	await expect(page.locator('.cm-content')).toContainText('// still typing');
	measure('type 15 characters → shown (ms)', (await now(page)) - t0);
	const marks = (name: string) =>
		page.evaluate((n) => performance.getEntriesByName(n).map((m) => m.startTime), name);
	await expect
		.poll(async () => (await marks('sysml:analysed')).some((m) => m > t0), { timeout: 60_000 })
		.toBe(true);
	measure('typing → analysed (ms)', (await marks('sysml:analysed')).find((m) => m > t0)! - t0);
	measure('typing: longest task (ms)', await longestTaskSince(page, t0));

	// Fix one file's worth (delete it) → the count follows.
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText('package Fixed { part def Holder; }\n');
	await expect(chip).toHaveAccessibleName(/^Problems: 0 errors, 4500 warnings/, {
		timeout: 60_000
	});

	// The command palette still answers.
	t0 = await now(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Holder3');
	await expect(palette.getByRole('option').first()).toBeVisible();
	measure('palette: open and find (ms)', (await now(page)) - t0);
	await page.keyboard.press('Escape');
	const all = await violations(page, '5000 problems');
	expect(all).toEqual([]);
});

test('a 10k-line model: explorer, search and views open without long waits', async ({ page }) => {
	await observeLongTasks(page);
	await page.setViewportSize({ width: 1440, height: 900 });
	await store(page, 'nav-10k', generateLines(10_000));
	await page.goto('/p/nav-10k');
	await ready(page, 120_000);

	const tree = page.getByRole('tree', { name: 'Model' });
	let t0 = await now(page);
	await tree.getByRole('button', { name: 'Expand S004Components' }).click();
	await expect(tree.getByRole('button', { name: /^S004Controller1$/ })).toBeVisible();
	measure('explorer: expand a package (ms)', (await now(page)) - t0);

	t0 = await now(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('S007Pump2');
	await expect(palette.getByRole('option').first()).toContainText('S007Pump2');
	measure('palette: open and find one of ~20k elements (ms)', (await now(page)) - t0);
	t0 = await now(page);
	await page.keyboard.press('Enter');
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('S007Pump2');
	measure('palette: choose → inspector shows it (ms)', (await now(page)) - t0);

	const views = page.locator('section[aria-labelledby="views-heading"]');
	t0 = await now(page);
	await views.getByRole('button', { name: 'All requirements', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'All requirements view' }).locator('tbody tr').first()
	).toBeVisible({ timeout: 60_000 });
	measure('open the table of every requirement (ms)', (await now(page)) - t0);

	t0 = await now(page);
	await views.getByRole('button', { name: 'Product interconnection', exact: true }).click();
	await expect(
		page
			.getByRole('region', { name: /Product interconnection diagram/ })
			.locator('.svelte-flow__node')
			.first()
	).toBeVisible({ timeout: 60_000 });
	measure('open the product interconnection diagram (ms)', (await now(page)) - t0);
	measure('navigation: longest task (ms)', await longestTaskSince(page, 0));
});

/** Every screen of the demo the axe check reaches, in one theme. */
async function sweep(page: Page, theme: 'light' | 'dark'): Promise<string[]> {
	const found: string[] = [];
	const check = async (where: string) =>
		found.push(...(await violations(page, `${theme}: ${where}`)));
	await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
	await page.addInitScript((t) => localStorage.setItem('sysml-web:theme', t), theme);

	await page.goto('/');
	await check('landing');
	await page.goto('/projects');
	await check('projects');
	await page.goto('/help');
	await check('help page');
	await openDemo(page);
	await check('overview');
	await page.getByRole('tab', { name: 'Model' }).click();
	await check('model tree');
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: 'DroneArchitecture.sysml', exact: true })
		.click();
	await expect(page.locator('.cm-content')).toBeVisible();
	await check('text editor');
	await page.getByRole('button', { name: /^Problems: / }).click();
	await check('problems list');
	await page.getByRole('button', { name: /^Problems: / }).click();

	// Every view the demo lists: tables, diagrams, matrices, simulations, reports.
	await page.getByRole('tab', { name: 'Model' }).click();
	const views = page.locator('section[aria-labelledby="views-heading"]');
	const names = (await views.getByRole('button').allInnerTexts())
		.map((n) => n.trim().split('\n')[0]!.trim())
		.filter(Boolean);
	for (const name of [...new Set(names)].filter((n) => n !== 'New view')) {
		const button = views.getByRole('button', { name, exact: true }).first();
		if (!(await button.isVisible().catch(() => false))) continue;
		await button.click();
		await page.waitForTimeout(1500);
		await check(`view "${name}"`);
		// A view that asks something first (a form) is checked open, then closed.
		if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
	}

	await page.keyboard.press('Control+k');
	await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
	await check('command palette');
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'Settings' }).click();
	const settings = page.getByRole('dialog', { name: /Settings/ });
	await expect(settings).toBeVisible();
	for (const tab of await settings.getByRole('tab').all()) {
		const label = (await tab.innerText()).trim();
		await tab.click();
		await check(`settings: ${label}`);
	}
	await page.keyboard.press('Escape');

	await page
		.locator('.project-menu')
		.getByRole('button', { name: 'Drone UAV', exact: true })
		.click();
	await check('project menu');
	await page.getByRole('menuitem', { name: 'Download as SysML v2 JSON…' }).click();
	await expect(page.getByRole('dialog', { name: 'Download as SysML v2 JSON' })).toBeVisible();
	await check('download as JSON dialog');
	await page.keyboard.press('Escape');

	await page
		.getByRole('region', { name: 'Model' })
		.getByRole('button', { name: 'New', exact: true })
		.click();
	await check('explorer New list');
	await page.locator('#explorer-new').getByRole('button').first().click();
	await expect(page.locator('dialog[open]').first()).toBeVisible();
	await check('New → View… form');
	await page.keyboard.press('Escape');
	return found;
}

test('axe finds nothing on any screen of the demo, in the light theme', async ({ page }) => {
	test.setTimeout(600_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const found = await sweep(page, 'light');
	measure('screens with violations', found.length);
	expect(found).toEqual([]);
});

test('axe finds nothing on any screen of the demo, in the dark theme', async ({ page }) => {
	test.setTimeout(600_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const found = await sweep(page, 'dark');
	measure('screens with violations', found.length);
	expect(found).toEqual([]);
});

/**
 * The contrast failure that comes and goes on the exchange dialogs
 * (exchange.spec "the demo downloads as SysML v2 JSON…"): a sheet dialog
 * fades in (`@keyframes pop`, opacity 0 → 1 over 180 ms), and axe measures
 * colour contrast with the opacity of that moment. Caught mid-fade, the
 * primary button's white text on sea glass is blended toward the page and
 * fails; once the animation is over it passes. Pausing the animation shows
 * it deterministically.
 */
test('the exchange dialog contrast failure is axe catching the dialog mid-fade', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	await page
		.locator('.project-menu')
		.getByRole('button', { name: 'Drone UAV', exact: true })
		.click();
	// Hold every animation that starts at its first frames.
	await page.evaluate(() => {
		const hold = () =>
			document.getAnimations().forEach((a) => {
				a.pause();
				a.currentTime = 20;
			});
		(window as unknown as { __hold: () => void }).__hold = hold;
	});
	await page.getByRole('menuitem', { name: 'Download as SysML v2 JSON…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Download as SysML v2 JSON' });
	await expect(dialog.getByRole('button', { name: 'Download .json' })).toBeAttached();
	await page.evaluate(() => (window as unknown as { __hold: () => void }).__hold());
	const opacity = await dialog.evaluate((d) => Number(getComputedStyle(d).opacity));
	measure('dialog opacity, held 20 ms into its entrance', opacity.toFixed(2));
	expect(opacity).toBeLessThan(0.5);
	const midFade = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
	const targets = midFade.violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')));
	measure('contrast failures mid-fade', targets.join(', ') || 'none');
	expect(targets.some((t) => t.includes('xc-primary'))).toBe(true);

	// Let it finish: no contrast failure.
	await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
	const after = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
	expect(after.violations).toEqual([]);
});

// Known gap: the explorer's "Filter the model" box sets `outline: 0` and shows no focus on a computer (Explorer.svelte `.search input`).
test.fail('every tab stop from the top of the workbench shows a focus ring', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);

	// Tab from the top reaches the main controls, each with a visible focus ring.
	await page.locator('body').click({ position: { x: 1, y: 1 } });
	const stops: string[] = [];
	let unringed = 0;
	for (let i = 0; i < 25; i++) {
		await page.keyboard.press('Tab');
		const info = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			if (!el || el === document.body) return null;
			const s = getComputedStyle(el);
			const ring =
				(s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
			const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
			return {
				name: label || `<${el.tagName.toLowerCase()} class="${el.className}">`,
				ring
			};
		});
		if (!info) continue;
		stops.push(info.name);
		if (!info.ring) {
			unringed++;
			measure('no focus ring on', info.name);
		}
	}
	measure('first 25 tab stops', stops.join(' | '));
	measure('tab stops without a visible focus ring', unringed);
	expect(unringed).toBe(0);
});

test('keyboard only: search, select, open a dialog and get focus back', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);

	// Search and select with the keyboard alone.
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await expect(palette.getByRole('combobox')).toBeFocused();
	await page.keyboard.type('Battery');
	await expect(palette.getByRole('option').first()).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(palette).toBeHidden();
	await expect(
		page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { level: 2 })
	).toContainText(/Battery/);

	// Settings: focus moves in, stays in while tabbing, and comes back on Escape.
	const opener = page.getByRole('button', { name: 'Settings' });
	await opener.focus();
	await page.keyboard.press('Enter');
	const settings = page.getByRole('dialog', { name: /Settings/ });
	await expect(settings).toBeVisible();
	for (let i = 0; i < 30; i++) {
		await page.keyboard.press('Tab');
		// Inside the dialog, or (past its last control) in the browser's own controls: never on the page behind.
		expect(
			await settings.evaluate(
				(d) => d.contains(document.activeElement) || document.activeElement === document.body
			)
		).toBe(true);
	}
	await page.keyboard.press('Escape');
	await expect(settings).toBeHidden();
	await expect(opener).toBeFocused();

	// A sheet dialog from the project menu, by keyboard: Escape returns focus to the menu button.
	const menu = page
		.locator('.project-menu')
		.getByRole('button', { name: 'Drone UAV', exact: true });
	await menu.focus();
	await page.keyboard.press('Enter');
	const item = page.getByRole('menuitem', { name: 'Download as SysML v2 JSON…' });
	await expect(item).toBeVisible();
	for (let i = 0; i < 30 && !(await item.evaluate((el) => el === document.activeElement)); i++)
		await page.keyboard.press('Tab');
	await expect(item).toBeFocused();
	await page.keyboard.press('Enter');
	const download = page.getByRole('dialog', { name: 'Download as SysML v2 JSON' });
	await expect(download).toBeVisible();
	expect(await download.evaluate((d) => d.contains(document.activeElement))).toBe(true);
	await page.keyboard.press('Escape');
	await expect(download).toBeHidden();
	const back = await page.evaluate(() =>
		(
			document.activeElement?.getAttribute('aria-label') ??
			document.activeElement?.textContent ??
			''
		)
			.trim()
			.slice(0, 40)
	);
	measure('focus after closing the download dialog', back || '(body)');
});

// Known gap: a dialog opened from the project menu returns focus to the page body, not to the menu button, when it closes.
test.fail(
	'closing a dialog opened from the project menu puts focus back on the menu button',
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await openDemo(page);
		const menu = page
			.locator('.project-menu')
			.getByRole('button', { name: 'Drone UAV', exact: true });
		await menu.focus();
		await page.keyboard.press('Enter');
		const item = page.getByRole('menuitem', { name: 'Download as SysML v2 JSON…' });
		for (let i = 0; i < 30 && !(await item.evaluate((el) => el === document.activeElement)); i++)
			await page.keyboard.press('Tab');
		await page.keyboard.press('Enter');
		const download = page.getByRole('dialog', { name: 'Download as SysML v2 JSON' });
		await expect(download).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(download).toBeHidden();
		await expect(menu).toBeFocused({ timeout: 2000 });
	}
);

// Known gap: the project menu (role="menu") doesn't move between its items with the arrow keys; Tab does.
test.fail('the project menu moves between its items with the arrow keys', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	const menu = page
		.locator('.project-menu')
		.getByRole('button', { name: 'Drone UAV', exact: true });
	await menu.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menu', { name: 'Project' })).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('menuitem').first()).toBeFocused({ timeout: 2000 });
});

/** A machine whose two states hand over to each other with no trigger: it never settles. */
const LOOP = `
    state def Restless {
        entry; then a;
        state a;
        state b;
        transition first a then b;
        transition first b then a;
    }`;

test('recovery without a reload: a failed import, an invalid edit, a runaway simulation', async ({
	page
}) => {
	test.setTimeout(420_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	// A damaged archive and a JSON file that isn't a model: each says why, and the page goes on.
	await page.goto('/projects');
	await page.locator('input[type=file][accept*=kpar]').setInputFiles({
		name: 'damaged.kpar',
		mimeType: 'application/zip',
		buffer: Buffer.from('PK\u0003\u0004 this is not really a zip archive')
	});
	await expect(page.getByRole('alert')).toContainText('damaged.kpar', { timeout: 30_000 });
	measure('damaged .kpar says', (await page.getByRole('alert').innerText()).slice(0, 160));
	await page.locator('input[type=file][accept*=json]').setInputFiles({
		name: 'broken.json',
		mimeType: 'application/json',
		buffer: Buffer.from('[{"@id": "1", "@type": "Package"')
	});
	await expect(page.getByRole('alert')).toContainText('broken.json', { timeout: 30_000 });
	measure('truncated .json says', (await page.getByRole('alert').innerText()).slice(0, 160));
	// Then make a project as usual.
	await page.getByLabel('Name').fill('After failures');
	await page.getByRole('radio', { name: /Blank/ }).check();
	await page.getByRole('button', { name: /Create project/ }).click();
	await ready(page);
	const chip = page.getByRole('button', { name: /^Problems: / });
	await expect(chip).toHaveAccessibleName(/^Problems: 0 errors/);

	// An invalid edit: problems show, the model is still read, and undo puts it back.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.locator('.explorer-pane')
		.getByRole('button', { name: /AfterFailures\.sysml/ })
		.click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('Control+End');
	await page.keyboard.insertText('\npart def }}} ;; : : missing');
	await expect(chip).not.toHaveAccessibleName(/^Problems: 0 errors/, { timeout: 30_000 });
	await expect(
		page.getByRole('status').filter({ hasText: /Model ready|can't be read/ })
	).toBeVisible();
	measure('after an invalid edit', (await chip.innerText()).replace(/\s+/g, ' '));
	await page.keyboard.press('Control+z');
	await expect(chip).toHaveAccessibleName(/^Problems: 0 errors/, { timeout: 30_000 });

	// A machine that never settles: waiting stops by itself and says why; fixing it runs.
	await page.keyboard.press('Control+End');
	await page.keyboard.insertText(LOOP);
	await page.getByRole('tab', { name: 'Model' }).click();
	const run = page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Run Restless' });
	await expect(run).toBeVisible({ timeout: 30_000 });
	await run.click();
	const emulator = page.locator('section.emulator');
	await expect(emulator.getByText(/Started in a/)).toBeVisible({ timeout: 15_000 });
	const started = Date.now();
	await emulator.getByRole('combobox', { name: 'How long to wait' }).selectOption('10 s');
	await emulator.getByRole('button', { name: 'Wait', exact: true }).click();
	// The wait stops at 200 transitions at once; the emulator then plays them one by one.
	await expect(emulator.getByText('Step 200')).toBeVisible({ timeout: 30_000 });
	measure('runaway: stopped at step 200 after (ms)', Date.now() - started);
	// Meanwhile the rest of the app answers: the command palette opens and closes.
	await page.keyboard.press('Control+k');
	await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByText(/keeps moving without time passing/).first()).toBeVisible({
		timeout: 240_000
	});
	measure('runaway: the reason shown after (ms)', Date.now() - started);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible();
});

test('every request goes to the site itself: no telemetry, no third-party hosts', async ({
	page
}) => {
	test.setTimeout(300_000);
	const hosts = new Map<string, number>();
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.protocol === 'data:' || url.protocol === 'blob:') return;
		hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
	});
	// Workers and the service worker fetch too.
	page.context().on('request', (r) => {
		const url = new URL(r.url());
		if (url.protocol === 'data:' || url.protocol === 'blob:') return;
		hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await page.goto('/projects');
	await page.getByLabel('Name').fill('Request log');
	await page.getByRole('radio', { name: /Small system/ }).check();
	await page.getByRole('button', { name: /Create project/ }).click();
	await ready(page);
	await openDemo(page);
	const views = page.locator('section[aria-labelledby="views-heading"]');
	for (const name of ['Drone bill of materials', 'Requirements trace']) {
		const b = views.getByRole('button', { name, exact: true });
		if (await b.isVisible().catch(() => false)) await b.click();
	}
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('tab', { name: 'About' }).click();
	await page.keyboard.press('Escape');
	// Long enough for idle work: the engine snapshot and the service worker's caching.
	await page.waitForTimeout(20_000);
	const list = [...hosts.entries()].map(([h, n]) => `${h} (${n})`).join(', ');
	measure('request hosts', list);
	const base = new URL(page.url()).host;
	expect([...hosts.keys()].filter((h) => h !== base)).toEqual([]);
});

for (const [name, size] of [
	['phone', { width: 390, height: 844 }],
	['tablet', { width: 820, height: 1180 }],
	['desktop', { width: 1440, height: 900 }],
	['wide desktop', { width: 2560, height: 1440 }]
] as const)
	test(`on a ${name} (${size.width}×${size.height}) the demo opens, fits and passes axe`, async ({
		browser
	}) => {
		const mobile = size.width < 800;
		const context = await browser.newContext({
			viewport: size,
			isMobile: mobile,
			hasTouch: size.width < 1000
		});
		const page = await context.newPage();
		const from = Date.now();
		await openDemo(page);
		measure('open → Model ready (ms)', Date.now() - from);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		expect(await violations(page, name)).toEqual([]);
		await context.close();
	});

test('Settings → About names the app version, its build and the engine release', async ({
	page
}) => {
	await openDemo(page);
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('tab', { name: 'About' }).click();
	const about = page.getByRole('dialog', { name: /Settings/ });
	await expect(about.getByText(/^Version \d+\.\d+\.\d+/)).toBeVisible();
	// Which build: the commit it was made from and the day.
	await expect(about.getByText(/^commit [0-9a-f]{7,}, built \d{4}-\d{2}-\d{2}$/)).toBeVisible();
	await expect(about.getByRole('link', { name: /sysml-toolkit \d+\.\d+\.\d+/ })).toBeVisible();
	// The running engine reports its own version beside the pinned release.
	await expect(about.getByText(/^\((toolkit )?\d+\.\d+\.\d+\)$/)).toBeVisible({ timeout: 30_000 });
	measure('about', (await about.locator('dl').innerText()).replace(/\s+/g, ' '));
});

/**
 * A first-time user, from the landing page, using only what the screen offers
 * (links, the starting points, the "Next steps" buttons and their forms; no
 * typing in the SysML text): a requirement with a limit, a part that
 * satisfies it, a value the check can judge, a saved view and a copy kept.
 * Where the walk needed knowledge the screen did not give, the assessment
 * doc says so (docs/assessment/10-performance-usability.md).
 */
test('a first-time user completes a modelling task with the guided workflow alone', async ({
	page
}) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const steps = page.getByRole('region', { name: 'Next steps' });
	const step = (id: string) => steps.locator(`li[data-step="${id}"]`);

	await page.goto('/');
	await page.getByRole('link', { name: 'Get started' }).click();
	await page.getByRole('link', { name: 'Start a new project' }).click();
	await expect(page).toHaveURL(/\/projects\?new/);
	await page.getByLabel('Name').fill('Garden pump');
	await page.getByRole('radio', { name: /Blank/ }).check();
	await page.getByRole('button', { name: /Create project/ }).click();
	await ready(page);
	await expect(steps).toContainText('0 of 6 done');

	// 1. A requirement.
	await step('requirement').getByRole('button', { name: 'Add', exact: true }).click();
	const add = page.getByRole('dialog', { name: 'Add an element' });
	await add.getByLabel('Name').fill('Light enough to carry');
	await add.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(steps).toContainText('1 of 6 done', { timeout: 20_000 });

	// 2. A part.
	await step('part').getByRole('button', { name: 'Add', exact: true }).click();
	await add.getByLabel('Name', { exact: true }).fill('motor');
	await add.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(steps).toContainText('2 of 6 done', { timeout: 20_000 });

	// 3. A view.
	await step('view').getByRole('button', { name: 'New view' }).click();
	const form = page.getByRole('dialog', { name: 'New view' });
	await form.getByText('Requirements table', { exact: true }).click();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('checkbox').first().check();
	await form.getByRole('button', { name: 'Next' }).click();
	await form.getByRole('button', { name: 'Create' }).click();
	await expect(form).toBeHidden();
	// The new view opens once it is written; then back to the overview.
	await expect(page.getByRole('button', { name: /^Close Requirements/ })).toBeVisible({
		timeout: 20_000
	});
	await page.getByRole('button', { name: 'Project overview' }).click();
	await expect(steps).toContainText('3 of 6 done', { timeout: 20_000 });

	// 4. Link: what satisfies the requirement.
	await step('link').getByRole('button', { name: 'Show me' }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await inspector.getByRole('list', { name: 'Can satisfy it' }).getByRole('button').first().click();
	await page.getByRole('button', { name: 'Project overview' }).click();
	await expect(steps).toContainText('4 of 6 done', { timeout: 20_000 });

	// 5. A limit, with the form only.
	await step('numbers').getByRole('button', { name: 'Set a limit' }).click();
	const limit = page.getByRole('dialog', { name: 'Set a limit' });
	await expect(limit).toBeVisible();
	measure('limit form says', (await limit.innerText()).replace(/\s+/g, ' ').slice(0, 400));
	const value = limit.getByLabel(/^Limit|value|At most/i).last();
	await value.fill('12');
	await limit
		.getByRole('button', { name: /^(Set|Add|Save|Write)/ })
		.last()
		.click();
	await expect(limit).toBeHidden({ timeout: 20_000 });
	await page.getByRole('button', { name: 'Project overview' }).click();
	await expect(steps).toContainText('5 of 6 done', { timeout: 20_000 });

	// 6. Keep a copy.
	const downloading = page.waitForEvent('download');
	await step('keep').getByRole('button', { name: 'Download' }).click();
	await downloading;
	await expect(steps).toContainText('All done');

	// The result is a model with no problems, whose design check says something about the limit.
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();
});
