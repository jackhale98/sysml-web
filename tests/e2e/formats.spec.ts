/**
 * Stored formats: a project the previous build kept in this browser, layout
 * file included, from before records and layout files carried a version
 * (`src/lib/project/fixtures/formats/stored-project-v1.json`, read back from
 * IndexedDB after that build made it), opens as it was and is saved in the
 * current format; a project saved by a newer version is left alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

interface Stored {
	id: string;
	format?: number;
	updated: string;
	files: { path: string; text: string }[];
}

const V1: Stored = JSON.parse(
	readFileSync(
		join(import.meta.dirname, '../../src/lib/project/fixtures/formats/stored-project-v1.json'),
		'utf8'
	)
);
const layoutOf = (record: Stored) =>
	record.files.find((f) => f.path === 'layout/diagrams.json')?.text ?? '';

async function seed(page: Page, record: Stored) {
	await page.goto('/projects');
	await page.evaluate(
		(record) =>
			new Promise<void>((done, fail) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' });
				open.onsuccess = () => {
					const tx = open.result.transaction('projects', 'readwrite');
					tx.objectStore('projects').put(record);
					tx.oncomplete = () => {
						open.result.close();
						done();
					};
					tx.onerror = () => fail(tx.error);
				};
				open.onerror = () => fail(open.error);
			}),
		record
	);
}

function stored(page: Page, id: string): Promise<Stored> {
	return page.evaluate(
		(id) =>
			new Promise<Stored>((done, fail) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onsuccess = () => {
					const get = open.result.transaction('projects').objectStore('projects').get(id);
					get.onsuccess = () => {
						open.result.close();
						done(get.result as Stored);
					};
					get.onerror = () => fail(get.error);
				};
				open.onerror = () => fail(open.error);
			}),
		id
	);
}

test('a project stored by the previous build opens as it was and is saved in the current format', async ({
	page
}) => {
	const layout = JSON.parse(layoutOf(V1)) as Record<string, Record<string, unknown>>;
	const [key, diagram] = Object.entries(layout)[0]!;
	const hidden = (diagram['#hidden'] as string[]) ?? [];
	expect(hidden.length).toBeGreaterThan(0);

	await seed(page, V1);
	await page.goto(`/p/${V1.id}`);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 60_000
	});
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();

	// The diagram the layout file is about still leaves out what was removed from it.
	expect(key).toMatch(/^interconnection:/);
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: /connections/i })
		.first()
		.click();
	const canvas = page.getByRole('region', { name: /diagram/ }).first();
	const nodes = canvas.locator('.svelte-flow__node');
	await expect(nodes.first()).toBeVisible({ timeout: 15_000 });
	for (const id of hidden)
		await expect(canvas.locator(`.svelte-flow__node[data-id="${id}"]`)).toHaveCount(0);

	// Moving a node saves the project: in the current format, the layout file with its version
	// and with everything it held before.
	const box = (await nodes.nth(1).boundingBox())!;
	await page.mouse.move(box.x + 10, box.y + 8);
	await page.mouse.down();
	await page.mouse.move(box.x + 70, box.y + 50, { steps: 6 });
	await page.mouse.up();
	await expect.poll(async () => layoutOf(await stored(page, V1.id))).toContain('"#format": 1');
	const after = await stored(page, V1.id);
	expect(after.format).toBe(1);
	const written = JSON.parse(layoutOf(after)) as Record<string, Record<string, unknown>>;
	expect(written[key]!['#hidden']).toEqual(hidden);
	expect(after.files.filter((f) => f.path !== 'layout/diagrams.json')).toEqual(
		V1.files.filter((f) => f.path !== 'layout/diagrams.json')
	);
});

test('a project saved by a newer version is not opened, and not overwritten', async ({ page }) => {
	const newer: Stored = { ...V1, id: 'from-the-future', format: 2 };
	await seed(page, newer);
	await page.goto(`/p/${newer.id}`);
	await expect(page.getByRole('heading', { name: "Project can't be opened here" })).toBeVisible({
		timeout: 30_000
	});
	await expect(
		page.getByText('This project was saved by a newer version of Fairtide.')
	).toBeVisible();
	expect(await stored(page, newer.id)).toEqual(newer);
});
