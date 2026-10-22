/**
 * The project's files, from a new project: a file made in a new folder and
 * used from the main file (by import), renamed (only the path changes, so
 * nothing breaks), and deleted (the dialog says what stops resolving, and
 * Undo brings it back). Once with a mouse, once on a phone with a long press.
 * In a project opened from a folder, a file deleted and not yet saved to the
 * folder is still a deleted file after a reload.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

async function expectAccessible(page: Page, where: string) {
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`),
		`accessibility of ${where}`
	).toEqual([]);
}

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

async function newProject(page: Page, name: string) {
	await page.goto('/projects');
	await page.getByLabel('Name').fill(name);
	await page.getByRole('button', { name: /Create project/ }).click();
	await expect(page).toHaveURL(/\/p\//);
	await ready(page);
}

/** The status bar's problem count (desktop): none at all. */
const noErrors = (page: Page) =>
	expect(page.getByRole('button', { name: /^Problems: 0 errors, 0 warnings/ })).toBeVisible({
		timeout: 20_000
	});

/** Put the cursor at the end of a line of the open editor and type lines after it. */
async function typeAfter(page: Page, line: string, text: string) {
	await page.locator('.cm-content').getByText(line, { exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(text);
}

/** A toast whose text matches. */
const toast = (page: Page, text: RegExp) =>
	page.getByRole('region', { name: 'Notifications' }).locator('.toast').filter({ hasText: text });

/** Run a command from the search box (⌘K). */
async function command(page: Page, query: string, option: RegExp) {
	await page.keyboard.press('ControlOrMeta+k');
	const palette = page.getByRole('dialog', { name: 'Command palette' });
	await palette.getByRole('combobox').fill(query);
	await palette.getByRole('option', { name: option }).click();
}

/** The open editors' tabs (desktop). */
const tabs = (page: Page) => page.getByRole('list', { name: 'Open editors' });

const files = (page: Page) => page.getByRole('list', { name: 'Files' });
/** A file's ⋯ button. */
const more = (page: Page, file: string) =>
	files(page).getByRole('button', { name: 'More actions', description: file, exact: true });
const dialog = (page: Page) => page.getByTestId('file-dialog');

test('make a file in a new folder, use it, rename it, delete it and undo', async ({ page }) => {
	await newProject(page, 'Grid');
	await page.getByRole('tab', { name: 'Files' }).click();

	// New file: a new folder and a name; .sysml is added, the package is named after it.
	await page.getByRole('button', { name: 'New file' }).click();
	await expect(dialog(page).getByRole('heading', { name: 'New file' })).toBeVisible();
	await dialog(page).getByLabel('Folder', { exact: true }).selectOption({ label: 'New folder…' });
	await dialog(page).getByLabel('New folder name').fill('structure');
	await dialog(page).getByLabel('Name', { exact: true }).fill('Power');
	await expect(dialog(page)).toContainText('Makes structure/Power.sysml with package Power.');
	await expectAccessible(page, 'the new file form');

	// A name that is taken (in any capitals) is refused before anything is made.
	await dialog(page).getByLabel('Folder', { exact: true }).selectOption('model');
	await dialog(page).getByLabel('Name', { exact: true }).fill('grid');
	await expect(dialog(page)).toContainText(/There is a file model\/Grid.sysml already/);
	await dialog(page).getByLabel('Folder', { exact: true }).selectOption({ label: 'New folder…' });
	await dialog(page).getByLabel('New folder name').fill('structure');
	await dialog(page).getByLabel('Name', { exact: true }).fill('Power');
	await dialog(page).getByRole('button', { name: 'Create file' }).click();
	await expect(dialog(page)).toBeHidden();

	// It opens, valid at once.
	await expect(tabs(page).getByRole('button', { name: /^Power\.sysml/ })).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('package Power {');
	await expect(files(page)).toContainText('structure');
	await typeAfter(page, 'package Power {', 'part def Battery;');

	// Used from the main file, by import.
	await files(page)
		.getByRole('button', { name: /^Grid\.sysml/ })
		.click();
	await typeAfter(
		page,
		'    part system : System;',
		'private import Power::*;\npart battery : Battery;'
	);
	await noErrors(page);
	await expect(page.locator('.problems-pane')).not.toContainText('Battery');

	// Rename: only the path changes; the open tab follows.
	await files(page)
		.getByRole('button', { name: /^Power\.sysml/ })
		.click();
	await more(page, 'Power.sysml').click();
	const menu = page.getByRole('menu', { name: 'Power.sysml: file' });
	await expect(menu.getByRole('menuitem')).toHaveText(['Rename…', 'Move to folder…', 'Delete…']);
	await expectAccessible(page, 'the file menu');
	await menu.getByRole('menuitem', { name: 'Rename…' }).click();
	await expect(dialog(page)).toContainText(
		'Packages and references stay the same; SysML finds them by name, not by file.'
	);
	// The name is selected without its extension, ready to type over.
	await page.keyboard.type('PowerSupply');
	await expect(dialog(page)).toContainText('Renames it to structure/PowerSupply.sysml.');
	await page.keyboard.press('Enter');
	await expect(toast(page, /Renamed Power.sysml to PowerSupply.sysml/)).toBeVisible();
	await expect(files(page).getByRole('button', { name: /^PowerSupply\.sysml/ })).toBeVisible();
	await expect(files(page).getByRole('button', { name: /^Power\.sysml/ })).toHaveCount(0);
	await expect(tabs(page).getByRole('button', { name: /^PowerSupply\.sysml/ })).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('part def Battery;');
	await ready(page);
	await noErrors(page);

	// Move it to another folder.
	await more(page, 'PowerSupply.sysml').click();
	await page.getByRole('menuitem', { name: 'Move to folder…' }).click();
	await dialog(page).getByLabel('Folder', { exact: true }).selectOption('model');
	await expect(dialog(page)).toContainText('Moves it to model/PowerSupply.sysml.');
	await dialog(page).getByRole('button', { name: 'Move' }).click();
	await expect(files(page)).not.toContainText('structure');
	await noErrors(page);

	// Delete: the dialog says what would stop resolving.
	await more(page, 'PowerSupply.sysml').click();
	await page.getByRole('menuitem', { name: 'Delete…' }).click();
	await expect(dialog(page)).toContainText('These would stop resolving:');
	await expect(dialog(page)).toContainText(/references to Power no longer resolve \(Grid\)/);
	await expectAccessible(page, 'the delete warning');
	await dialog(page).getByRole('button', { name: 'Delete file' }).click();
	const deleted = toast(page, /Deleted PowerSupply.sysml/);
	await expect(deleted).toContainText(/no longer resolve/);
	await expect(files(page).getByRole('button', { name: /^PowerSupply\.sysml/ })).toHaveCount(0);
	await expect(tabs(page).getByRole('button', { name: /^PowerSupply\.sysml/ })).toHaveCount(0);
	// References that no longer resolve are warnings.
	await expect(page.getByRole('button', { name: /^Problems: .*[1-9]\d* warning/ })).toBeVisible({
		timeout: 20_000
	});

	// Undo brings it back, and the model with it.
	await deleted.getByRole('button', { name: 'Undo' }).click();
	await expect(files(page).getByRole('button', { name: /^PowerSupply\.sysml/ })).toBeVisible();
	await noErrors(page);

	// The palette has the same: a new file, and the open file's rename, move and delete.
	await files(page)
		.getByRole('button', { name: /^PowerSupply\.sysml/ })
		.click();
	await command(page, 'rename file', /^Rename file/);
	await expect(
		dialog(page).getByRole('heading', { name: 'Rename PowerSupply.sysml' })
	).toBeVisible();
	await page.keyboard.press('Escape');
	await command(page, 'new file', /^New file/);
	await expect(dialog(page).getByRole('heading', { name: 'New file' })).toBeVisible();
	await page.keyboard.press('Escape');

	// And so does the explorer's New menu.
	await page.getByRole('tab', { name: 'Model' }).click();
	await page.getByRole('button', { name: 'New', exact: true }).click();
	await page.getByRole('button', { name: 'File…' }).click();
	await expect(dialog(page).getByRole('heading', { name: 'New file' })).toBeVisible();
});

/**
 * Open a folder project: the folder is kept in the browser's private file
 * system (a real folder handle), and choosing a folder picks it.
 */
async function openFolderProject(page: Page, files: Record<string, string>) {
	await page.addInitScript(() => {
		(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker =
			async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Rig');
	});
	await page.goto('/projects');
	await page.evaluate(async (files) => {
		const root = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle('Rig', {
			create: true
		});
		for (const [path, text] of Object.entries(files)) {
			const parts = path.split('/');
			let dir = root;
			for (const part of parts.slice(0, -1))
				dir = await dir.getDirectoryHandle(part, { create: true });
			const writable = await (
				await dir.getFileHandle(parts.at(-1)!, { create: true })
			).createWritable();
			await writable.write(text);
			await writable.close();
		}
	}, files);
	await page.getByRole('button', { name: 'Choose a folder…' }).click();
	await expect(page).toHaveURL(/\/p\//);
	await ready(page);
}

/** The paths of the files in the folder project's folder. */
const folderFiles = (page: Page) =>
	page.evaluate(async () => {
		const out: string[] = [];
		const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
			for await (const entry of (
				dir as unknown as { values(): AsyncIterable<FileSystemHandle> }
			).values()) {
				if (entry.kind === 'directory')
					await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`);
				else out.push(prefix + entry.name);
			}
		};
		await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('Rig'), '');
		return out.sort();
	});

test('a file deleted in a folder project shows as deleted in the review after a reload, and saving takes it out of the folder', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openFolderProject(page, {
		'.project.json': '{\n\t"name": "Rig"\n}\n',
		'model/Rig.sysml': 'package Rig {\n    part def Frame;\n}\n',
		'model/Spares.sysml': 'package Spares {\n    part def Bolt;\n    part def Washer;\n}\n'
	});
	await page.getByRole('tab', { name: 'Files' }).click();
	await more(page, 'Spares.sysml').click();
	await page.getByRole('menuitem', { name: 'Delete…' }).click();
	await dialog(page).getByRole('button', { name: 'Delete file' }).click();
	await expect(files(page).getByRole('button', { name: /^Spares\.sysml/ })).toHaveCount(0);
	const unsaved = page.getByRole('button', { name: /1 unsaved · Save to folder/ });
	await expect(unsaved).toBeVisible();
	// Kept in this browser (it saves a moment after each change), then reloaded.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Promise<string[]>((done) => {
						const open = indexedDB.open('sysml-web', 1);
						open.onsuccess = () => {
							const all = open.result.transaction('projects').objectStore('projects').getAll();
							all.onsuccess = () => {
								open.result.close();
								done(
									(all.result as { unsavedToFolder?: string[] }[]).flatMap(
										(p) => p.unsavedToFolder ?? []
									)
								);
							};
						};
					})
			)
		)
		.toEqual(['model/Spares.sysml']);
	await page.reload();
	await ready(page);
	await expect(unsaved).toBeVisible();

	await command(page, 'Review changes', /Review changes/);
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(review).toContainText('Comparing your version with the files in the folder');
	await expect(review.locator('[data-change]').filter({ hasText: /Removed .*Spares/ })).toBeVisible(
		{ timeout: 30_000 }
	);
	await expectAccessible(page, 'the review of a deleted file');

	await unsaved.click();
	await expect(unsaved).toBeHidden();
	expect(await folderFiles(page)).toEqual(['.project.json', 'model/Rig.sysml']);
});

test('deleting a file of several packages counts only what uses them from elsewhere', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	// Power and Spares use each other; only Rig, in another file, stays.
	await openFolderProject(page, {
		'model/Rig.sysml':
			'package Rig {\n    private import Power::*;\n    part battery : Battery;\n}\n',
		'model/Power.sysml':
			'package Power {\n    part def Battery { part fuse : Spares::Fuse; }\n}\n\n' +
			'package Spares {\n    private import Power::*;\n    part def Fuse;\n    part spare : Battery;\n}\n'
	});
	await noErrors(page);
	await page.getByRole('tab', { name: 'Files' }).click();
	await more(page, 'Power.sysml').click();
	await page.getByRole('menuitem', { name: 'Delete…' }).click();
	await expect(dialog(page)).toContainText('These would stop resolving:');
	const breaks = dialog(page).getByRole('listitem');
	await expect(breaks).toHaveCount(1);
	await expect(breaks).toContainText(/to Power no longer resolves? \(Rig\)/);
	await expectAccessible(page, 'the delete warning of several packages');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	/** Hold a finger on an element until its menu opens. */
	async function longPress(page: Page, target: ReturnType<Page['locator']>) {
		const box = (await target.boundingBox())!;
		const at = {
			pointerType: 'touch',
			isPrimary: true,
			pointerId: 7,
			clientX: box.x + box.width / 2,
			clientY: box.y + box.height / 2
		};
		await target.dispatchEvent('pointerdown', at);
		await page.waitForTimeout(700);
		await target.dispatchEvent('pointerup', at);
	}

	test('a long press on a file opens its menu as a sheet, with thumb-sized targets', async ({
		page
	}) => {
		await newProject(page, 'Pocket');
		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		await page.getByRole('tab', { name: 'Files' }).click();

		await page.getByRole('button', { name: 'New file' }).click();
		await expect(dialog(page).getByRole('heading', { name: 'New file' })).toBeVisible();
		await dialog(page).getByLabel('Folder', { exact: true }).selectOption({ label: 'New folder…' });
		await dialog(page).getByLabel('New folder name').fill('structure');
		await dialog(page).getByLabel('Name', { exact: true }).fill('Power');
		await expectAccessible(page, 'the new file sheet');
		await dialog(page).getByRole('button', { name: 'Create file' }).click();
		await expect(page.locator('.cm-content')).toContainText('package Power {');

		await page
			.getByRole('navigation', { name: 'Sections' })
			.getByRole('button', { name: 'Model' })
			.click();
		const file = files(page).getByRole('button', { name: /^Power\.sysml/ });
		await longPress(page, file);
		const sheet = page.getByRole('dialog', { name: 'Power.sysml' });
		await expect(sheet).toBeVisible();
		for (const item of await sheet.getByRole('menuitem').all()) {
			expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
		const dots = more(page, 'Power.sysml');
		await expectAccessible(page, 'the file sheet');

		await sheet.getByRole('menuitem', { name: 'Delete…' }).click();
		await expect(dialog(page)).toContainText('Nothing else in the model uses what it holds.');
		await dialog(page).getByRole('button', { name: 'Delete file' }).click();
		await expect(files(page).getByRole('button', { name: /^Power\.sysml/ })).toHaveCount(0);
		await toast(page, /Deleted Power.sysml/)
			.getByRole('button', { name: 'Undo' })
			.click();
		await expect(file).toBeVisible();
		// The ⋯ button is as big as a thumb too.
		const box = (await dots.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(44);
		expect(box.width).toBeGreaterThanOrEqual(44);
	});
});
