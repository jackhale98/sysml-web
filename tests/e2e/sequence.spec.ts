import { readFileSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { analyze } from './axe';

async function openSequence(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Delivery sequence', exact: true })
		.click();
	const diagram = page.getByRole('group', { name: 'Delivery sequence diagram' });
	await expect(diagram.getByRole('button', { name: /^Message 1:/ })).toBeVisible({
		timeout: 15_000
	});
	return diagram;
}

test('a sequence view draws the lifelines and the messages in time order', async ({ page }) => {
	const diagram = await openSequence(page);
	const lifelines = diagram.getByRole('list', { name: 'Lifelines' }).getByRole('button');
	await expect(lifelines).toHaveCount(4);
	for (const [i, name] of [
		'operator : Operator',
		'groundStation : GroundStation',
		'drone : DeliveryDrone',
		'recipient : Recipient'
	].entries())
		await expect(lifelines.nth(i)).toHaveAccessibleName(`Lifeline «ref part» ${name}`);
	const messages = diagram
		.getByRole('list', { name: 'Messages, in time order' })
		.getByRole('button');
	await expect(messages).toHaveCount(8);
	await expect(messages.first()).toHaveAccessibleName(
		'Message 1: planDelivery of FlightPlan, from operator to groundStation'
	);
	await expect(messages.nth(6)).toHaveAccessibleName(
		'Message 7: handOver of Parcel, from drone to recipient'
	);
	// Top to bottom in that order, and each message between the lifelines it joins.
	const tops = await messages.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
	expect(tops).toEqual([...tops].sort((a, b) => a - b));
	const head = (name: string) =>
		diagram.getByRole('button', { name: `Lifeline «ref part» ${name}` });
	const [operator, station] = await Promise.all([
		head('operator').boundingBox(),
		head('groundStation').boundingBox()
	]);
	const first = (await messages.first().boundingBox())!;
	expect(first.x).toBeGreaterThan(operator!.x + operator!.width / 2);
	expect(first.x + first.width).toBeLessThan(station!.x + station!.width / 2);

	const results = await analyze(page);
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
	).toEqual([]);
});

test('lifelines and messages select their elements, and show what they connect', async ({
	page
}) => {
	const diagram = await openSequence(page);
	const inspector = page.getByRole('complementary', { name: 'Inspector' });

	const report = diagram.getByRole('button', { name: /^Message 3:/ });
	await report.click();
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('preflightReport');
	await expect(report).toHaveAttribute('aria-current', 'true');
	// The two lifelines it joins are highlighted.
	await expect(diagram.locator('.heads .head.linked')).toHaveCount(2);

	// A lifeline: its messages are highlighted.
	await diagram.getByRole('button', { name: /^Lifeline «ref part» recipient/ }).click();
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('recipient');
	await expect(diagram.locator('.message.linked')).toHaveCount(1);
	await expect(diagram.locator('.message.linked')).toContainText('handOver');
	// A click on the empty canvas clears the highlight; the element stays selected.
	await diagram.click({ position: { x: 200, y: 12 } });
	await expect(diagram.locator('.message.linked')).toHaveCount(0);
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('recipient');

	// The keyboard reaches every message.
	await diagram.getByRole('button', { name: /^Message 1:/ }).focus();
	await page.keyboard.press('Tab');
	await expect(diagram.getByRole('button', { name: /^Message 2:/ })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(inspector.getByRole('heading', { level: 2 })).toContainText('uploadPlan');

	// Show in text opens the file at the message.
	await diagram.getByRole('button', { name: 'Show in text' }).click();
	await expect(
		page
			.getByRole('list', { name: 'Open editors' })
			.getByRole('button', { name: 'DeliverySequence.sysml', exact: true })
	).toHaveAttribute('aria-current', 'true');
});

test('a sequence diagram exports as a standalone SVG and a PNG', async ({ page }) => {
	const diagram = await openSequence(page);
	await diagram.getByRole('button', { name: 'Export' }).click();
	const menu = page.getByRole('menu', { name: 'Export diagram' });
	await expect(menu.getByRole('menuitem', { name: 'SVG', exact: true })).toBeFocused();

	const [svgFile] = await Promise.all([
		page.waitForEvent('download'),
		menu.getByRole('menuitem', { name: 'SVG', exact: true }).click()
	]);
	expect(svgFile.suggestedFilename()).toBe('delivery-sequence.svg');
	const svg = (await readFile((await svgFile.path())!)).toString('utf8');
	expect(svg).not.toMatch(/foreignObject|<marker|url\(|var\(--|class=/);
	const parsed = await page.evaluate((text) => {
		const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
		return {
			error: doc.querySelector('parsererror')?.textContent ?? null,
			texts: [...doc.querySelectorAll('text')].map((t) => t.textContent)
		};
	}, svg);
	expect(parsed.error).toBeNull();
	expect(parsed.texts).toContain('sv [ParcelDelivery]');
	expect(parsed.texts).toContain('handOver');
	expect(parsed.texts).toContain('recipient');

	await diagram.getByRole('button', { name: 'Export' }).click();
	const [pngFile] = await Promise.all([
		page.waitForEvent('download'),
		menu.getByRole('menuitem', { name: 'PNG', exact: true }).click()
	]);
	expect(pngFile.suggestedFilename()).toBe('delivery-sequence.png');
	const png = await readFile((await pngFile.path())!);
	expect(png.subarray(1, 4).toString()).toBe('PNG');
});

/** The demo's files with `edit` applied, kept in this browser as if edited earlier. */
async function seedEditedDemo(page: Page, edit: (path: string, text: string) => string) {
	const root = resolve(import.meta.dirname, '../../src/demo/drone');
	const files: { path: string; text: string }[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(sysml|kerml|md)$/.test(name)) {
				const at = relative(root, path);
				files.push({ path: at, text: edit(at, readFileSync(path, 'utf8')) });
			}
		}
	};
	walk(root);
	const info = JSON.parse(readFileSync(join(root, '.project.json'), 'utf8')) as unknown;
	await page.goto('/');
	await page.evaluate(
		async ({ files, info }) => {
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
						origin: 'demo',
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
		{ files, info }
	);
}

test('in a review, the sequence marks the messages that are new or changed', async ({ page }) => {
	test.setTimeout(90_000);
	await seedEditedDemo(page, (path, text) =>
		path === 'behaviour/DeliverySequence.sysml'
			? text
					.replace(
						'The operator checks the report and clears the drone for take-off.',
						'The operator checks the report and the weather, then clears the drone.'
					)
					.replace(
						'            doc /* The parcel is delivered and the drone is on its way home. */\n        }',
						'            doc /* The parcel is delivered and the drone is on its way home. */\n        }\n        then message landed of Telemetry from drone to groundStation;'
					)
			: text
	);
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill('Review changes');
	await palette.getByRole('option').filter({ hasText: 'Review changes' }).first().click();
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(review.getByText('landed', { exact: false }).first()).toBeVisible({
		timeout: 30_000
	});

	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Delivery sequence', exact: true })
		.click();
	const diagram = page.getByRole('group', { name: 'Delivery sequence diagram' });
	await expect(
		diagram.getByRole('button', { name: /^Message 9: landed .*, added in this review$/ })
	).toBeVisible({ timeout: 15_000 });
	await expect(
		diagram.getByRole('button', {
			name: /^Message 4: launch of TakeOffCommand.*, changed in this review$/
		})
	).toBeVisible();
	await expect(diagram.locator('.review-badge')).not.toHaveCount(0);
	const results = await analyze(page);
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
	).toEqual([]);
});
