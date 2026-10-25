/**
 * Saving a folder project back to its folder (File System Access, mocked):
 * changed and new files are written, deleted and renamed-away ones removed,
 * and what is not in the folder yet is counted. Files changed in the folder
 * meanwhile (another editor, a git pull, a synced drive) are never
 * overwritten without asking: changed only there, they are brought in;
 * changed on both sides, the person chooses for each.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredProject } from './store.ts';

const stored = new Map<string, StoredProject>();
vi.mock('./store.ts', () => ({
	loadProject: async (id: string) => stored.get(id),
	saveProject: async (project: StoredProject) => void stored.set(project.id, project),
	timestamp: () => '2026-10-22T00:00:00Z'
}));

const { FOLDER_CONFLICTS, ProjectSession } = await import('./session.svelte.ts');
const { Workspace } = await import('./workspace.svelte.ts');

/** An in-memory folder with the File System Access calls the app makes. */
class MockDirectory {
	readonly kind = 'directory';
	entries = new Map<string, MockDirectory | MockFile>();
	constructor(readonly name: string) {}
	async *values() {
		yield* this.entries.values();
	}
	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		let dir = this.entries.get(name);
		if (!dir && options?.create) this.entries.set(name, (dir = new MockDirectory(name)));
		if (!(dir instanceof MockDirectory)) throw new DOMException(name, 'NotFoundError');
		return dir;
	}
	async getFileHandle(name: string, options?: { create?: boolean }) {
		let file = this.entries.get(name);
		if (!file && options?.create) this.entries.set(name, (file = new MockFile(name)));
		if (!(file instanceof MockFile)) throw new DOMException(name, 'NotFoundError');
		return file;
	}
	async removeEntry(name: string) {
		const entry = this.entries.get(name);
		if (!entry) throw new DOMException(name, 'NotFoundError');
		if (entry instanceof MockDirectory && entry.entries.size)
			throw new DOMException(name, 'InvalidModificationError');
		this.entries.delete(name);
	}
	async queryPermission() {
		return 'granted' as const;
	}
	/** Every file below, path → text. */
	list(prefix = ''): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [name, entry] of this.entries) {
			if (entry instanceof MockDirectory) Object.assign(out, entry.list(`${prefix}${name}/`));
			else out[prefix + name] = entry.text;
		}
		return out;
	}
	/** Folders below, empty ones included. */
	folders(prefix = ''): string[] {
		return [...this.entries]
			.filter(([, e]) => e instanceof MockDirectory)
			.flatMap(([name, e]) => [
				prefix + name,
				...(e as MockDirectory).folders(`${prefix}${name}/`)
			]);
	}
}

class MockFile {
	readonly kind = 'file';
	text = '';
	constructor(readonly name: string) {}
	async getFile() {
		return new File([this.text], this.name);
	}
	async createWritable() {
		let next = '';
		return {
			write: async (data: string) => void (next += data),
			close: async () => void (this.text = next)
		};
	}
}

const INFO = '{\n\t"name": "Drone"\n}\n';

async function folderProject(files: Record<string, string>) {
	const root = new MockDirectory('drone');
	for (const [path, text] of Object.entries(files)) {
		const parts = path.split('/');
		let dir = root;
		for (const part of parts.slice(0, -1))
			dir = await dir.getDirectoryHandle(part, { create: true });
		(await dir.getFileHandle(parts.at(-1)!, { create: true })).text = text;
	}
	stored.set('f', {
		id: 'f',
		info: { name: 'Drone' },
		files: Object.entries(files).map(([path, text]) => ({ path, text })),
		origin: 'folder',
		created: '',
		updated: '',
		folder: root as unknown as FileSystemDirectoryHandle
	});
	const workspace = new Workspace();
	const session = new ProjectSession(workspace);
	const source = (await session.load('f'))!;
	workspace.preview(source);
	return { root, workspace, session };
}

beforeEach(() => stored.clear());

describe('saving to the folder', () => {
	it('removes deleted files and writes renamed ones, counting both until saved', async () => {
		const { root, workspace, session } = await folderProject({
			'.project.json': INFO,
			'model/Drone.sysml': 'package Drone {\n}\n',
			'structure/Power.sysml': 'package Power {\n}\n',
			'structure/Old.sysml': 'package Old {\n}\n'
		});
		await workspace.renameFile('structure/Power.sysml', 'parts/Power.sysml');
		await workspace.deleteFile('structure/Old.sysml');
		await workspace.createFile('notes/New.sysml', 'package New {\n}\n');
		session.changed();
		expect([...session.unsavedToFolder].sort()).toEqual([
			'notes/New.sysml',
			'parts/Power.sysml',
			'structure/Old.sysml',
			'structure/Power.sysml'
		]);
		expect(session.leaveRisk).toEqual({ kind: 'folder', count: 4 });

		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()).toEqual({
			'.project.json': INFO,
			'model/Drone.sysml': 'package Drone {\n}\n',
			'parts/Power.sysml': 'package Power {\n}\n',
			'notes/New.sysml': 'package New {\n}\n'
		});
		// The folder the last file left goes with it.
		expect(root.folders().sort()).toEqual(['model', 'notes', 'parts']);
		expect(session.unsavedToFolder).toEqual([]);
		session.changed();
		expect(session.unsavedToFolder).toEqual([]);
	});

	it('keeps a folder that still holds other things', async () => {
		const { root, workspace, session } = await folderProject({
			'structure/Power.sysml': 'package Power {\n}\n',
			'structure/Frame.sysml': 'package Frame {\n}\n'
		});
		await workspace.deleteFile('structure/Power.sysml');
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(Object.keys(root.list()).sort()).toEqual(['.project.json', 'structure/Frame.sysml']);
	});

	it('renames a file whose name only changes case', async () => {
		const { root, workspace, session } = await folderProject({
			'model/power.sysml': 'package Power {\n}\n'
		});
		await workspace.renameFile('model/power.sysml', 'model/Power.sysml');
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()['model/Power.sysml']).toBe('package Power {\n}\n');
		expect(root.list()['model/power.sysml']).toBeUndefined();
	});

	it('remembers, after a reload, a deleted file the folder still has', async () => {
		const { root, workspace, session } = await folderProject({
			'model/Drone.sysml': 'package Drone {\n}\n',
			'model/Old.sysml': 'package Old {\n}\n'
		});
		await workspace.deleteFile('model/Old.sysml');
		session.changed();
		await session.save();
		expect(stored.get('f')!.unsavedToFolder).toEqual(['model/Old.sysml']);

		const again = new Workspace();
		const reopened = new ProjectSession(again);
		again.preview((await reopened.load('f'))!);
		expect(reopened.unsavedToFolder).toEqual(['model/Old.sysml']);
		reopened.changed();
		expect(reopened.unsavedToFolder).toEqual(['model/Old.sysml']);
		expect(await reopened.saveToFolder()).toBeNull();
		expect(Object.keys(root.list()).sort()).toEqual(['.project.json', 'model/Drone.sysml']);
	});

	it('reviews, after a reload, against what the folder holds: deleted and changed files as they were', async () => {
		const { workspace, session } = await folderProject({
			'model/Drone.sysml': 'package Drone {\n}\n',
			'model/Old.sysml': 'package Old {\n}\n'
		});
		await workspace.deleteFile('model/Old.sysml');
		workspace.setText('model/Drone.sysml', 'package Drone {\n    part frame;\n}\n');
		await workspace.createFile('model/New.sysml', 'package New {\n}\n');
		session.changed();
		await session.save();

		const again = new Workspace();
		const reopened = new ProjectSession(again);
		again.preview((await reopened.load('f'))!);
		reopened.changed();
		expect([...reopened.unsavedToFolder].sort()).toEqual([
			'model/Drone.sysml',
			'model/New.sysml',
			'model/Old.sysml'
		]);
		const base = Object.fromEntries(reopened.reviewBase().files.map((f) => [f.path, f.text]));
		expect(base).toEqual({
			'model/Drone.sysml': 'package Drone {\n}\n',
			'model/Old.sysml': 'package Old {\n}\n'
		});
		expect(reopened.reviewBase().label).toBe('the files in the folder');
	});

	it('still removes a deleted file kept before the folder texts were', async () => {
		const { root } = await folderProject({
			'model/Drone.sysml': 'package Drone {\n}\n',
			'model/Old.sysml': 'package Old {\n}\n'
		});
		stored.set('f', {
			...stored.get('f')!,
			files: [{ path: 'model/Drone.sysml', text: 'package Drone {\n}\n' }],
			unsavedToFolder: ['model/Old.sysml']
		});
		const again = new Workspace();
		const reopened = new ProjectSession(again);
		again.preview((await reopened.load('f'))!);
		reopened.changed();
		expect(reopened.unsavedToFolder).toEqual(['model/Old.sysml']);
		expect(await reopened.saveToFolder()).toBeNull();
		expect(Object.keys(root.list()).sort()).toEqual(['.project.json', 'model/Drone.sysml']);
	});
});

/** Change a file in the folder, as another program would (null: delete it). */
async function onDisk(root: MockDirectory, path: string, text: string | null) {
	const parts = path.split('/');
	let dir = root;
	for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
	if (text === null) await dir.removeEntry(parts.at(-1)!);
	else (await dir.getFileHandle(parts.at(-1)!, { create: true })).text = text;
}

const A = 'package A {\n    part a1;\n    part a2;\n    part a3;\n    part a4;\n}\n';
const A_HERE = A.replace('part a1;', 'part a1here;');
const A_THERE = A.replace('part a4;', 'part a4there;');
const A_BOTH = A.replace('part a1;', 'part a1here;').replace('part a4;', 'part a4there;');

describe('files changed in the folder meanwhile', () => {
	it('asks about a file changed on both sides, and writes nothing until the person chooses', async () => {
		const { root, workspace, session } = await folderProject({
			'.project.json': INFO,
			'model/A.sysml': A,
			'model/B.sysml': 'package B {\n}\n'
		});
		await onDisk(root, 'model/A.sysml', A_THERE);
		workspace.setText('model/A.sysml', A_HERE);
		workspace.setText('model/B.sysml', 'package B {\n    part b;\n}\n');
		session.changed();

		expect(await session.saveToFolder()).toBe(FOLDER_CONFLICTS);
		expect(session.folderPending?.conflicts).toEqual([
			{ path: 'model/A.sysml', base: A, mine: A_HERE, theirs: A_THERE, merged: A_BOTH }
		]);
		// Nothing written, not even the file only changed here; both still count as unsaved.
		expect(root.list()['model/A.sysml']).toBe(A_THERE);
		expect(root.list()['model/B.sysml']).toBe('package B {\n}\n');
		expect([...session.unsavedToFolder].sort()).toEqual(['model/A.sysml', 'model/B.sysml']);
	});

	it('keeps mine when chosen: the folder gets my version', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A_THERE);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		expect(await session.resolveFolder({ 'model/A.sysml': 'mine' })).toBeNull();
		expect(root.list()['model/A.sysml']).toBe(A_HERE);
		expect(workspace.files['model/A.sysml']).toBe(A_HERE);
		expect(session.folderPending).toBeNull();
		expect(session.unsavedToFolder).toEqual([]);
	});

	it("takes the folder's when chosen: the project gets the folder's version, as one undoable step", async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A_THERE);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		expect(await session.resolveFolder({ 'model/A.sysml': 'theirs' })).toBeNull();
		expect(root.list()['model/A.sysml']).toBe(A_THERE);
		expect(workspace.files['model/A.sysml']).toBe(A_THERE);
		expect(session.unsavedToFolder).toEqual([]);
		expect(stored.get('f')!.files.find((f) => f.path === 'model/A.sysml')?.text).toBe(A_THERE);
		// Undo brings my version back, as a change not in the folder.
		expect(workspace.undo()).toBe('Brought in changes from the folder');
		session.changed();
		expect(workspace.files['model/A.sysml']).toBe(A_HERE);
		expect(session.unsavedToFolder).toEqual(['model/A.sysml']);
	});

	it('combines both when chosen and the changes touch different lines', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A_THERE);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		expect(await session.resolveFolder({ 'model/A.sysml': 'merged' })).toBeNull();
		expect(root.list()['model/A.sysml']).toBe(A_BOTH);
		expect(workspace.files['model/A.sysml']).toBe(A_BOTH);
		expect(session.unsavedToFolder).toEqual([]);
	});

	it('offers no combined version when both changed the same line', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A.replace('part a1;', 'part a1there;'));
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		expect(session.folderPending?.conflicts[0]?.merged).toBeNull();
	});

	it('leaves both sides as they are on "Not now"', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A_THERE);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		session.cancelFolderSave();
		expect(session.folderPending).toBeNull();
		expect(root.list()['model/A.sysml']).toBe(A_THERE);
		expect(workspace.files['model/A.sysml']).toBe(A_HERE);
		expect(session.unsavedToFolder).toEqual(['model/A.sysml']);
		// Asked again next time.
		expect(await session.saveToFolder()).toBe(FOLDER_CONFLICTS);
	});

	it('writes nothing when the file changed again (here or there) after the question, and says so', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A_THERE);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		workspace.setText('model/A.sysml', A_HERE + '\n');
		session.changed();
		expect(await session.resolveFolder({ 'model/A.sysml': 'mine' })).toMatch(
			/changed since you chose Save to folder, so nothing was saved/
		);
		expect(root.list()['model/A.sysml']).toBe(A_THERE);
		expect(session.folderPending).toBeNull();

		// The same when the folder's copy changed again meanwhile.
		await session.saveToFolder();
		await onDisk(root, 'model/A.sysml', A_THERE + '\n');
		expect(await session.resolveFolder({ 'model/A.sysml': 'mine' })).toMatch(/nothing was saved/);
		expect(root.list()['model/A.sysml']).toBe(A_THERE + '\n');
	});

	it('writes the other files with the choices, and leaves a file not chosen as it is', async () => {
		const { root, workspace, session } = await folderProject({
			'model/A.sysml': A,
			'model/B.sysml': A.replace('A', 'B'),
			'model/C.sysml': 'package C {\n}\n'
		});
		await onDisk(root, 'model/A.sysml', A_THERE);
		await onDisk(root, 'model/B.sysml', A_THERE.replace('A', 'B'));
		workspace.setText('model/A.sysml', A_HERE);
		workspace.setText('model/B.sysml', A_HERE.replace('A', 'B'));
		workspace.setText('model/C.sysml', 'package C {\n    part c;\n}\n');
		session.changed();
		await session.saveToFolder();
		expect(await session.resolveFolder({ 'model/A.sysml': 'mine' })).toBeNull();
		expect(root.list()).toMatchObject({
			'model/A.sysml': A_HERE,
			'model/B.sysml': A_THERE.replace('A', 'B'),
			'model/C.sysml': 'package C {\n    part c;\n}\n'
		});
		expect(session.unsavedToFolder).toEqual(['model/B.sysml']);
	});

	it('asks about a new file whose name a new file in the folder took meanwhile', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await workspace.createFile('model/New.sysml', 'package New {\n    part mine;\n}\n');
		await onDisk(root, 'model/New.sysml', 'package New {\n    part theirs;\n}\n');
		session.changed();
		expect(await session.saveToFolder()).toBe(FOLDER_CONFLICTS);
		expect(session.folderPending?.conflicts).toEqual([
			{
				path: 'model/New.sysml',
				base: null,
				mine: 'package New {\n    part mine;\n}\n',
				theirs: 'package New {\n    part theirs;\n}\n',
				merged: null
			}
		]);
		expect(root.list()['model/New.sysml']).toBe('package New {\n    part theirs;\n}\n');
		expect(await session.resolveFolder({ 'model/New.sysml': 'mine' })).toBeNull();
		expect(root.list()['model/New.sysml']).toBe('package New {\n    part mine;\n}\n');
	});

	it('asks about a file deleted in the folder but edited here: keep mine writes it back', async () => {
		const { root, workspace, session } = await folderProject({
			'model/A.sysml': A,
			'model/B.sysml': 'package B {\n}\n'
		});
		await onDisk(root, 'model/A.sysml', null);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		expect(session.folderPending?.conflicts).toEqual([
			{ path: 'model/A.sysml', base: A, mine: A_HERE, theirs: null, merged: null }
		]);
		expect(await session.resolveFolder({ 'model/A.sysml': 'mine' })).toBeNull();
		expect(root.list()['model/A.sysml']).toBe(A_HERE);
	});

	it("…and taking the folder's takes it out of the project", async () => {
		const { root, workspace, session } = await folderProject({
			'model/A.sysml': A,
			'model/B.sysml': 'package B {\n}\n'
		});
		await onDisk(root, 'model/A.sysml', null);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		await session.saveToFolder();
		expect(await session.resolveFolder({ 'model/A.sysml': 'theirs' })).toBeNull();
		expect('model/A.sysml' in workspace.files).toBe(false);
		expect(root.list()['model/A.sysml']).toBeUndefined();
		expect(session.unsavedToFolder).toEqual([]);
	});

	it('asks before deleting a file in the folder that changed there since: keep mine deletes it, theirs brings it back', async () => {
		for (const choice of ['mine', 'theirs'] as const) {
			const { root, workspace, session } = await folderProject({
				'model/A.sysml': A,
				'model/B.sysml': 'package B {\n}\n'
			});
			await workspace.deleteFile('model/A.sysml');
			await onDisk(root, 'model/A.sysml', A_THERE);
			session.changed();
			await session.saveToFolder();
			expect(root.list()['model/A.sysml']).toBe(A_THERE);
			expect(session.folderPending?.conflicts).toEqual([
				{ path: 'model/A.sysml', base: A, mine: null, theirs: A_THERE, merged: null }
			]);
			expect(await session.resolveFolder({ 'model/A.sysml': choice })).toBeNull();
			if (choice === 'mine') {
				expect(root.list()['model/A.sysml']).toBeUndefined();
				expect('model/A.sysml' in workspace.files).toBe(false);
			} else {
				expect(root.list()['model/A.sysml']).toBe(A_THERE);
				expect(workspace.files['model/A.sysml']).toBe(A_THERE);
			}
			expect(session.unsavedToFolder).toEqual([]);
		}
	});

	it('brings in files changed, added or deleted only in the folder, and saves the rest', async () => {
		const { root, workspace, session } = await folderProject({
			'model/A.sysml': A,
			'model/B.sysml': 'package B {\n}\n',
			'model/Gone.sysml': 'package Gone {\n}\n'
		});
		await onDisk(root, 'model/A.sysml', A_THERE);
		await onDisk(root, 'model/Gone.sysml', null);
		await onDisk(root, 'model/Added.sysml', 'package Added {\n}\n');
		workspace.setText('model/B.sysml', 'package B {\n    part b;\n}\n');
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(session.folderPending).toBeNull();
		expect([...session.broughtIn].sort()).toEqual([
			'model/A.sysml',
			'model/Added.sysml',
			'model/Gone.sysml'
		]);
		expect(workspace.files).toEqual({
			'model/A.sysml': A_THERE,
			'model/Added.sysml': 'package Added {\n}\n',
			'model/B.sysml': 'package B {\n    part b;\n}\n'
		});
		expect(root.list()).toEqual({
			'.project.json': INFO,
			'model/A.sysml': A_THERE,
			'model/Added.sysml': 'package Added {\n}\n',
			'model/B.sysml': 'package B {\n    part b;\n}\n'
		});
		expect(session.unsavedToFolder).toEqual([]);
		// Kept in this browser too, and compared with the folder as it is now.
		expect(
			stored
				.get('f')!
				.files.map((f) => f.path)
				.sort()
		).toEqual(['model/A.sysml', 'model/Added.sysml', 'model/B.sysml']);
		expect(session.reviewBase().files.find((f) => f.path === 'model/A.sysml')?.text).toBe(A_THERE);
	});

	it('does not ask when the folder already has the same change', async () => {
		const { root, workspace, session } = await folderProject({ 'model/A.sysml': A });
		await onDisk(root, 'model/A.sysml', A_HERE);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(session.broughtIn).toEqual([]);
		expect(session.unsavedToFolder).toEqual([]);
		// And a later change of mine is written without asking.
		workspace.setText('model/A.sysml', A_BOTH);
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()['model/A.sysml']).toBe(A_BOTH);
	});

	it("leaves the folder's .project.json as it is there", async () => {
		const { root, workspace, session } = await folderProject({
			'.project.json': INFO,
			'model/A.sysml': A
		});
		const edited = '{\n\t"name": "Drone",\n\t"description": "Edited on disk"\n}\n';
		await onDisk(root, '.project.json', edited);
		workspace.setText('model/A.sysml', A_HERE);
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()['.project.json']).toBe(edited);
	});

	it('renames a file whose name only changes case on a disk that ignores case', async () => {
		const { root, workspace, session } = await folderProject({
			'model/power.sysml': 'package Power {\n}\n'
		});
		ignoreCase(root);
		await workspace.renameFile('model/power.sysml', 'model/Power.sysml');
		session.changed();
		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()).toEqual({
			'.project.json': INFO,
			'model/Power.sysml': 'package Power {\n}\n'
		});
	});
});

/** Make a folder (and those below it) find names whatever their case, as macOS and Windows disks do. */
function ignoreCase(dir: MockDirectory) {
	const find = (name: string) =>
		[...dir.entries.keys()].find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
	const { getDirectoryHandle, getFileHandle, removeEntry } = dir;
	dir.getDirectoryHandle = (name, options) => getDirectoryHandle.call(dir, find(name), options);
	dir.getFileHandle = (name, options) => getFileHandle.call(dir, find(name), options);
	dir.removeEntry = (name) => removeEntry.call(dir, find(name));
	for (const entry of dir.entries.values()) if (entry instanceof MockDirectory) ignoreCase(entry);
}
