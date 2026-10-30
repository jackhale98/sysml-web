/**
 * ReqIF in and out: importing a DOORS Next export through the requirements
 * import dialog (attributes matched, types and relations named, a second
 * import of the same file changing nothing), and exporting the project's
 * requirements as ReqIF from a requirements table's export menu.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkReqif } from '../../src/lib/dataio/reqif-write';
import { analyze } from './axe';

const FIXTURE = join(import.meta.dirname, '../../src/lib/dataio/fixtures/reqif/doors-next.reqif');

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

async function openRequirements(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	await page
		.getByRole('button', { name: /^Requirements/ })
		.first()
		.click();
	const table = page.getByRole('region', { name: 'Requirements table view' });
	await expect(table.getByRole('button', { name: 'SYS-001' })).toBeVisible();
	return table;
}

test('a DOORS Next ReqIF file imports as packages and requirements, once', async ({ page }) => {
	const table = await openRequirements(page);
	const importFile = async () => {
		await table.getByRole('button', { name: 'Import' }).click();
		const dialog = page.getByRole('dialog', { name: 'Import requirements' });
		await expect(dialog).toBeVisible();
		await dialog.locator('input[type=file]').setInputFiles(FIXTURE);
		return dialog;
	};

	const dialog = await importFile();
	await expect(dialog).toContainText('Step 2 of 2 · Match the attributes');
	await expect(
		dialog.getByRole('combobox', { name: 'Attribute ReqIF.ForeignID becomes' })
	).toHaveValue('id');
	await expect(dialog.getByRole('combobox', { name: 'Attribute ReqIF.Text becomes' })).toHaveValue(
		'doc'
	);
	await expect(
		dialog.getByRole('combobox', { name: 'Attribute Verification Method becomes' })
	).toHaveValue('attr:verificationMethod');
	await expect(dialog.getByRole('combobox', { name: 'Objects of type Heading are' })).toHaveValue(
		'heading'
	);
	await expect(
		dialog.getByRole('combobox', { name: 'Objects of type Information are' })
	).toHaveValue('skip');
	await expect(
		dialog.getByRole('combobox', { name: 'Relations of type Derived From are' })
	).toHaveValue('derived-from');
	await expect(dialog.getByRole('status')).toContainText(
		'4 new requirements · 2 new packages · 2 derivations'
	);
	const leftOut = dialog.getByRole('list', { name: 'What is left out' });
	await expect(leftOut).toContainText('Relations left out, by type: ‘Satisfies’.');
	await expect(leftOut).toContainText('Objects left out, by type: ‘Information (1)’.');
	await expectAccessible(page);

	await dialog.getByRole('button', { name: 'Import 4 requirements' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText('Imported 4 requirements')).toBeVisible();
	await expect(table.getByRole('button', { name: '1007' })).toBeVisible({ timeout: 10_000 });
	await expect(table.getByRole('row').filter({ hasText: '1002' })).toContainText('Hover endurance');

	// The same file again: everything is already there.
	const again = await importFile();
	await expect(again.getByRole('status')).toContainText('0 new requirements · 4 unchanged');
	await expect(again.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
	await again.getByRole('button', { name: 'Close' }).click();

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(table.getByRole('button', { name: '1007' })).toBeHidden({ timeout: 10_000 });
});

test('the requirements export as ReqIF that follows the schema', async ({ page }) => {
	const table = await openRequirements(page);
	await table.getByRole('button', { name: 'Export' }).click();
	const menu = page.getByRole('menu', { name: 'Export this table' });
	await expect(menu.getByRole('menuitem', { name: 'ReqIF' })).toBeVisible();
	const download = page.waitForEvent('download');
	await menu.getByRole('menuitem', { name: 'ReqIF' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/ requirements\.reqif$/);
	const xml = readFileSync(await file.path(), 'utf8');
	expect(checkReqif(xml)).toEqual([]);
	expect(xml).toContain('<SPEC-OBJECT IDENTIFIER="tessera-req-SYS-001"');
	expect(xml).toContain('LONG-NAME="Derived from"');
});
