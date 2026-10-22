/**
 * Saving a folder project back to its folder (File System Access, mocked):
 * changed and new files are written, deleted and renamed-away ones removed,
 * and what is not in the folder yet is counted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredProject } from './store.ts';

const stored = new Map<string, StoredProject>();
vi.mock('./store.ts', () => ({
	loadProject: async (id: string) => stored.get(id),
	saveProject: async (project: StoredProject) => void stored.set(project.id, project),
	timestamp: () => '2026-10-22T00:00:00Z'
}));

const { ProjectSession } = await import('./session.svelte.ts');
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
