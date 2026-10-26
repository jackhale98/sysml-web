/**
 * Assessment (§2, save/reload fidelity in the browser): a project opened
 * from a folder (the browser's private file system stands in for a disk
 * folder) keeps the bytes of its files through opening, an edit, a reload
 * (browser storage) and a save back to the folder: the edited file differs
 * only by the edit, and files that were not edited are written back, if at
 * all, exactly as they were.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

const ready = (page: Page) =>
	expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});

const PLAIN =
	'package Plain {\n\t// tabs, trailing spaces and unicode: µ Ω ✓ “quoted”   \n\tpart def Frame;\n\n\n    part def Wheel; /* odd indent */\n}\n';
const CRLF =
	'package Crlf {\r\n    part def Bolt;\r\n    // a comment\r\n    part def Nut;\r\n}\r\n';
const FILES: Record<string, string> = {
	'.project.json': '{\n\t"name": "Rig"\n}\n',
	'model/Plain.sysml': PLAIN,
	'model/Crlf.sysml': CRLF
};

/** Open a folder project whose folder is in the browser's private file system. */
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

/** The folder's files as bytes (path → byte values). */
const folderBytes = (page: Page) =>
	page.evaluate(async () => {
		const out: Record<string, number[]> = {};
		const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
			for await (const entry of (
				dir as unknown as { values(): AsyncIterable<FileSystemHandle> }
			).values()) {
				if (entry.kind === 'directory')
					await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`);
				else
					out[prefix + entry.name] = [
						...new Uint8Array(await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer())
					];
			}
		};
		await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('Rig'), '');
		return out;
	});

/** The texts the browser keeps for the project (IndexedDB), path → text. */
const storedTexts = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<Record<string, string>>((done) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onsuccess = () => {
					const all = open.result.transaction('projects').objectStore('projects').getAll();
					all.onsuccess = () => {
						open.result.close();
						const project = (all.result as { files: { path: string; text: string }[] }[])[0];
						done(Object.fromEntries((project?.files ?? []).map((f) => [f.path, f.text])));
					};
				};
			})
	);

const bytesOf = (text: string) => [...new TextEncoder().encode(text)];
const explorer = (page: Page) => page.getByRole('navigation', { name: 'Explorer' });
const unsaved = (page: Page) => page.getByRole('button', { name: /unsaved · Save to folder/ });

test('an edit, a reload and a save to the folder change only the edited line', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openFolderProject(page, FILES);
	await page.getByRole('tab', { name: 'Files' }).click();
	await explorer(page)
		.getByRole('button', { name: /^Plain\.sysml/ })
		.click();
	await page.locator('.cm-content').getByText('part def Frame;', { exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText('part def Axle;');
	await expect(unsaved(page)).toBeVisible({ timeout: 10_000 });
	// Kept in this browser, then reloaded.
	await expect.poll(async () => (await storedTexts(page))['model/Plain.sysml']).toContain('Axle');
	await page.reload();
	await ready(page);
	const stored = await storedTexts(page);
	const edited = stored['model/Plain.sysml']!;
	const lines = edited.split('\n');
	const added = lines.findIndex((l) => l.includes('part def Axle;'));
	expect(added).toBeGreaterThan(0);
	expect(lines.toSpliced(added, 1).join('\n')).toBe(PLAIN);
	expect(stored['model/Crlf.sysml']).toBe(CRLF);

	await unsaved(page).click();
	await expect(unsaved(page)).toBeHidden();
	const folder = await folderBytes(page);
	expect(folder['model/Plain.sysml']).toEqual(bytesOf(edited));
	expect(folder['model/Crlf.sysml']).toEqual(bytesOf(CRLF));
	expect(folder['.project.json']).toEqual(bytesOf(FILES['.project.json']!));
});

test('opening a file with Windows line endings in the editor leaves it as it was', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openFolderProject(page, FILES);
	await page.getByRole('tab', { name: 'Files' }).click();
	await explorer(page)
		.getByRole('button', { name: /^Crlf\.sysml/ })
		.click();
	await expect(page.locator('.cm-content')).toContainText('part def Nut;');
	// Give the workbench time to save anything it changed.
	await page.waitForTimeout(2_000);
	expect((await storedTexts(page))['model/Crlf.sysml']).toBe(CRLF);
	await expect(unsaved(page)).toBeHidden();

	// Typing a line, and pasting two, writes them with the file's line endings.
	await page.locator('.cm-content').getByText('part def Bolt;', { exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText('part def Washer;');
	await page.locator('.cm-content').evaluate((el) => {
		const data = new DataTransfer();
		data.setData('text/plain', '\npart def Pin;\npart def Clip;');
		el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
	});
	await expect(unsaved(page)).toBeVisible({ timeout: 10_000 });
	const stored = async () => (await storedTexts(page))['model/Crlf.sysml'] ?? '';
	await expect.poll(stored).toContain('part def Washer;\r\npart def Pin;\r\npart def Clip;\r\n');
	const text = await stored();
	expect(text.replace(/\r\n/g, ''), 'no line ending in LF alone').not.toContain('\n');
	expect(text.replace(/\s+part def (Washer|Pin|Clip);/g, '')).toBe(CRLF);
});

test('a line ending of another kind in a file is shown, and kept', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	// Windows line endings, but for one Unix one inside the second line.
	const mixed = 'package Mixed {\r\n    part def A;\n    part def B;\r\n}\r\n';
	await openFolderProject(page, { ...FILES, 'model/Mixed.sysml': mixed });
	await page.getByRole('tab', { name: 'Files' }).click();
	await explorer(page)
		.getByRole('button', { name: /^Mixed\.sysml/ })
		.click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('part def B;');
	await expect(page.locator('.cm-content .cm-specialChar')).toHaveCount(1);
	await page.waitForTimeout(2_000);
	expect((await storedTexts(page))['model/Mixed.sysml']).toBe(mixed);
});

test('moving a box on a diagram writes only the layout file, never the model', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openFolderProject(page, FILES);
	await page.getByRole('tab', { name: 'Files' }).click();
	await explorer(page)
		.getByRole('button', { name: /^Plain\.sysml/ })
		.click();
	const box = page.locator('.svelte-flow__node').filter({ hasText: 'Frame' }).first();
	await expect(box).toBeVisible({ timeout: 15_000 });
	const at = (await box.boundingBox())!;
	await page.mouse.move(at.x + at.width / 2, at.y + 12);
	await page.mouse.down();
	await page.mouse.move(at.x + at.width / 2 + 160, at.y + 132, { steps: 10 });
	await page.mouse.up();
	await expect(unsaved(page)).toBeVisible({ timeout: 10_000 });
	await expect
		.poll(async () => (await storedTexts(page))['layout/diagrams.json'] ?? '')
		.toContain('Frame');
	const stored = await storedTexts(page);
	expect(stored['model/Plain.sysml']).toBe(PLAIN);
	expect(stored['model/Crlf.sysml']).toBe(CRLF);

	await unsaved(page).click();
	await expect(unsaved(page)).toBeHidden();
	const folder = await folderBytes(page);
	expect(folder['model/Plain.sysml']).toEqual(bytesOf(PLAIN));
	expect(folder['model/Crlf.sysml']).toEqual(bytesOf(CRLF));
	expect(Object.keys(folder).sort()).toEqual([
		'.project.json',
		'layout/diagrams.json',
		'model/Crlf.sysml',
		'model/Plain.sysml'
	]);
});
