/**
 * Review mode: edit the demo, open "Review changes", read what changed in
 * plain language (what it does to the requirement checks first), select a
 * change's element, see the marks in a diagram and a table, on a phone too;
 * and the summary where changes are saved to GitHub.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

const ROOT = resolve(import.meta.dirname, '../../src/demo/drone');

/** The demo's files, as the app bundles them. */
function demoFiles(): { path: string; text: string }[] {
	const out: { path: string; text: string }[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(sysml|kerml|md)$/.test(name))
				out.push({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(ROOT);
	return out;
}

/** The demo after some work: heavier motors, a new requirement, a status, a removed wire. */
function editedDemo() {
	const files = demoFiles();
	const edit = (path: string, from: string, to: string) => {
		const file = files.find((f) => f.path === path)!;
		expect(file.text).toContain(from);
		file.text = file.text.replace(from, to);
	};
	const C = 'system/Components.sysml';
	const R = 'requirements/SystemRequirements.sysml';
	edit(C, 'attribute :>> mass = 120 [g];', 'attribute :>> mass = 190 [g];');
	edit(C, '        connect motor to propeller;     // shaft and hub\n', '');
	edit(
		R,
		'    // ---- Environment ----',
		"    requirement <'SYS-012'> 'Noise at night' : DroneRequirement {\n        doc /* The drone shall be quiet at night. */\n    }\n\n    // ---- Environment ----"
	);
	edit(R, '@StatusInfo { status = StatusKind::closed;', '@StatusInfo { status = StatusKind::done;');
	return files;
}

/** Keep `files` as the demo in this browser (as if edited earlier), with a GitHub base if given. */
async function seedDemo(page: Page, files: { path: string; text: string }[], gitBase = false) {
	const info = JSON.parse(readFileSync(join(ROOT, '.project.json'), 'utf8')) as unknown;
	const git = gitBase
		? {
				provider: 'github',
				owner: 'acme',
				repo: 'drone',
				branch: 'main',
				defaultBranch: 'main',
				base: 'c0ffee1234567890',
				baseTree: 'tree',
				files: Object.fromEntries(
					demoFiles().map((f, i) => [f.path, { sha: `b${i}`, text: f.text }])
				),
				syncedAt: new Date().toISOString()
			}
		: undefined;
	await page.goto('/');
	await page.evaluate(
		async ({ files, info, git }) => {
			await new Promise<void>((done, fail) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' });
				open.onsuccess = () => {
					const tx = open.result.transaction('projects', 'readwrite');
					const now = new Date().toISOString();
					tx.objectStore('projects').put({
						id: 'demo',
						info,
						files,
						...(git ? { git } : {}),
						origin: git ? 'git' : 'demo',
						created: now,
						updated: now
					});
					tx.oncomplete = () => {
						open.result.close();
						done();
					};
					tx.onerror = () => fail(tx.error);
				};
				open.onerror = () => fail(open.error);
			});
		},
		{ files, info, git }
	);
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

async function openReview(page: Page) {
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Review changes');
	await palette.getByRole('option').filter({ hasText: 'Review changes' }).first().click();
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(review.getByText('Comparing your version with')).toBeVisible();
	return review;
}

const tabs = (page: Page) => page.getByRole('list', { name: 'Open editors' });

const group = (review: ReturnType<Page['getByRole']>, title: string) =>
	review.getByRole('region', { name: new RegExp(`^${title}`) });

test('an edit in the text shows in the review, with the requirement it breaks first', async ({
	page
}) => {
	await openDemo(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: 'Components.sysml', exact: true }).click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	const editor = page.locator('.cm-content');
	await expect(editor).toBeVisible();
	// The motor's mass: 120 g → 190 g.
	await editor.click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type('mass = 120 [g]');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.type('mass = 190 [g]');
	await expect(editor).toContainText('attribute :>> mass = 190 [g];');

	const review = await openReview(page);
	await expect(review.getByText('the demo as it comes')).toBeVisible();
	const impact = group(review, 'What it changes');
	await expect(impact.locator('[data-change]').first()).toContainText(
		'drone.takeOffMass now violates SYS-003 ‘Maximum take-off mass’ (4.05 kg > 4 kg)',
		{ timeout: 30_000 }
	);
	await expect(impact.locator('[data-change]').first()).toContainText('Now fails');
	await expect(impact).toContainText('Drone mass budget: drone adds up to 3.05 kg (was 2.77 kg)');
	const design = group(review, 'Design');
	const change = design.locator('[data-change]').filter({ hasText: 'Motor.mass' });
	await expect(change).toContainText('Motor.mass changed 120 g → 190 g');

	// The change selects its element: the inspector shows it.
	await change.getByRole('button', { name: /Motor\.mass changed/ }).click();
	const inspector = page.getByRole('complementary', { name: 'Inspector' });
	await expect(inspector.getByRole('textbox', { name: 'Name' })).toHaveValue('mass');
	// Its text change, on demand.
	await change.getByRole('button', { name: 'Show the text change' }).click();
	await expect(change.getByRole('region', { name: /Differences/ })).toContainText('190 [g]');
	await expectAccessible(page);

	// Put the mass back: the review follows, and finds nothing left.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page
		.getByRole('button', { name: /^Components\.sysml/ })
		.first()
		.click();
	await editor.click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type('mass = 190 [g]');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.type('mass = 120 [g]');
	await tabs(page).getByRole('button', { name: 'Review changes', exact: true }).click();
	await expect(review.getByText('No changes to the model')).toBeVisible({ timeout: 30_000 });
});

test('the review groups the changes, and marks them in diagrams and tables', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await seedDemo(page, editedDemo());
	await openDemo(page);
	const review = await openReview(page);
	await expect(group(review, 'Requirements')).toContainText(
		'Added requirement SYS-012 ‘Noise at night’ to SystemRequirements',
		{ timeout: 30_000 }
	);
	await expect(group(review, 'Requirements')).toContainText(
		'SYS-002 ‘Payload capacity’: status closed → done'
	);
	await expect(group(review, 'Design')).toContainText(
		'Removed the connection motor to propeller in Rotor'
	);
	await expect(review.getByText('1 added')).toBeVisible();
	await expectAccessible(page);

	// A diagram marks what changed (in words for screen readers), and lists nothing removed here.
	await group(review, 'Design')
		.locator('[data-change]')
		.filter({ hasText: 'Motor.mass' })
		.getByRole('button', { name: 'Show in diagram' })
		.click();
	const diagram = page.getByRole('region', { name: 'DroneComponents diagram' });
	await expect(diagram.getByRole('group', { name: /Motor, changed in this review/ })).toBeVisible({
		timeout: 30_000
	});
	const legend = diagram.getByRole('note', { name: 'Review changes' });
	await expect(legend).toContainText('New');
	await expect(legend).toContainText('Changed');
	await expectAccessible(page);
	await legend.getByRole('button', { name: 'Hide marks' }).click();
	await expect(diagram.getByRole('group', { name: /Motor, changed in this review/ })).toHaveCount(
		0
	);

	// Marks on again, from the review; the requirements table marks the new and changed rows.
	await tabs(page).getByRole('button', { name: 'Review changes', exact: true }).click();
	await review.getByRole('button', { name: 'Mark changes in diagrams and tables' }).click();
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Open requirements');
	await palette.getByRole('option').filter({ hasText: 'Open requirements' }).first().click();
	const table = page.locator('tbody');
	await expect(table.locator('tr', { hasText: 'SYS-012' })).toContainText('New');
	await expect(table.locator('tr', { hasText: 'SYS-002' })).toContainText('Changed');
	await expect(table.locator('tr', { hasText: 'SYS-001' })).not.toContainText('Changed');

	// Ending the review clears the marks.
	await tabs(page).getByRole('button', { name: 'Review changes', exact: true }).click();
	await review.getByRole('button', { name: 'End the review' }).click();
	await expect(tabs(page).getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(
		0
	);
	await tabs(page).getByRole('button', { name: 'Requirements', exact: true }).click();
	await expect(page.locator('tbody tr', { hasText: 'SYS-012' })).toBeVisible();
	await expect(page.locator('tbody tr', { hasText: 'SYS-012' })).not.toContainText('New');
});

test('on a phone the review is a full-screen section that never pans sideways', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedDemo(page, editedDemo());
	await openDemo(page);
	await page.getByRole('button', { name: /^Search the model/ }).click();
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Review changes');
	await palette.getByRole('option').filter({ hasText: 'Review changes' }).first().click();
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(group(review, 'Requirements')).toBeVisible({ timeout: 30_000 });
	const box = await review.boundingBox();
	expect(box!.width).toBeGreaterThan(370);
	expect(box!.x).toBeLessThanOrEqual(1);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	// Opening a text change keeps it inside the screen (it scrolls in its own box).
	const removed = group(review, 'Design').locator('[data-change]').filter({ hasText: 'Removed' });
	await removed.getByRole('button', { name: 'Show the text change' }).click();
	const diff = removed.getByRole('region', { name: /Differences/ });
	await expect(diff).toContainText('connect motor to propeller');
	const diffBox = await diff.boundingBox();
	expect(diffBox!.x + diffBox!.width).toBeLessThanOrEqual(390);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
	).toBeLessThanOrEqual(0);
	await expectAccessible(page);
});

test('saving to GitHub shows what changed in the model and suggests the description', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await seedDemo(page, editedDemo(), true);
	await openDemo(page);
	await page.getByRole('button', { name: 'Source control' }).click();
	const sheet = page.getByRole('dialog', { name: 'drone' });
	const summary = sheet.getByRole('region', { name: 'In the model' });
	await expect(summary).toContainText(
		'drone.takeOffMass now violates SYS-003 ‘Maximum take-off mass’',
		{ timeout: 30_000 }
	);
	await expect(summary).toContainText('Added requirement SYS-012');
	await sheet.getByRole('button', { name: 'Use the change summary as the description' }).click();
	const message = sheet.getByRole('textbox', { name: /Describe your changes/ });
	await expect(message).toHaveValue(/^Update status of SYS-002; add requirement SYS-012/);
	await expect(message).toHaveValue(/- drone.takeOffMass now violates SYS-003/);
	await expectAccessible(page);
	await summary.getByRole('button', { name: 'Review all changes' }).click();
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(review.getByText(/the version on GitHub \(c0ffee1\)/)).toBeVisible();
	await expect(group(review, 'Requirements')).toBeVisible({ timeout: 30_000 });
});
