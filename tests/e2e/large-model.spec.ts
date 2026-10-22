/**
 * A generated project of about 10k lines (`tests/perf/generate.ts`;
 * docs/performance.md) opens within a budget, its explorer lists a page of
 * the model rather than all of it, its tables and diagrams open, and a view
 * too large to lay out says how to narrow it. The full benchmark is
 * `npm run bench`.
 */
import { expect, test, type Page } from '@playwright/test';
import { generateLines } from '../perf/generate';

const files = generateLines(10_000);

/** Put the project in the browser's project store (IndexedDB), as opening one does. */
async function store(page: Page, id: string) {
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
					info: { name: 'Large model' },
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

test('a 10k-line project opens within budget and stays usable', async ({ page }) => {
	test.setTimeout(240_000);
	await store(page, 'large-model');
	await page.goto('/p/large-model');
	// Typically a few seconds; generous for shared machines and parallel tests.
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 90_000
	});
	await expect(page.getByRole('button', { name: 'Problems: 0 errors, 0 warnings' })).toBeVisible();

	// Seventy-odd top-level packages start closed, and long lists show a page at a time.
	const tree = page.getByRole('tree', { name: 'Model' });
	await expect(tree.getByRole('treeitem').first()).toBeVisible();
	expect(await tree.getByRole('treeitem').count()).toBeLessThanOrEqual(201);
	await tree.getByRole('button', { name: 'Expand S000Components' }).click();
	await expect(tree.getByRole('button', { name: /^S000Controller1$/ })).toBeVisible();

	const views = page.locator('section[aria-labelledby="views-heading"]');
	await views.getByRole('button', { name: 'All requirements', exact: true }).click();
	const table = page.getByRole('region', { name: 'All requirements view' });
	await expect(table.getByText(/\d+ rows/)).toBeVisible({ timeout: 60_000 });
	await expect(table.locator('tbody tr').first()).toBeVisible();

	await views.getByRole('button', { name: 'S000 interconnection', exact: true }).click();
	const diagram = page.getByRole('region', { name: /S000 interconnection diagram/ });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 60_000 });

	// Every part of the product, nested: more than the canvas lays out.
	await views.getByRole('button', { name: 'Product bill of materials', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'Product bill of materials view' }).getByText(/\d+ rows/)
	).toBeVisible({ timeout: 60_000 });
});
