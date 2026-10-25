/**
 * Assessment (§8 data integrity): what happens to work in this browser and in
 * an opened folder when saving fails, is interrupted, or races another writer.
 * The browser store is replaced by an in-memory one with the same semantics
 * as IndexedDB's `put` (the whole record is replaced); the folder is an
 * in-memory File System Access directory that can be made to fail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredProject } from './store.ts';

const stored = new Map<string, StoredProject>();
/** When set, the next saves fail with this error (as IndexedDB does when the quota is used up). */
let failSave: Error | null = null;
let saves = 0;
vi.mock('./store.ts', () => ({
	// Copies, as IndexedDB gives and keeps (the folder handle is kept as it is).
	loadProject: async (id: string) => {
		const project = stored.get(id);
		return (
			project && { ...structuredClone({ ...project, folder: undefined }), folder: project.folder }
		);
	},
	// As the store does: refused when `expected` is given and someone else saved since.
	saveProject: async (project: StoredProject, expected?: string | null) => {
		if (failSave) throw failSave;
		const current = stored.get(project.id);
		if (expected !== undefined && current && current.updated !== expected)
			throw new Error('This project was changed in another tab or window.');
		const updated = `2026-10-23T00:00:${String(++saves).padStart(2, '0')}Z`;
		stored.set(project.id, {
			...structuredClone({ ...project, folder: undefined }),
			folder: project.folder,
			updated
		});
		return updated;
	},
	timestamp: () => '2026-10-23T00:00:00Z'
}));

const { ProjectSession } = await import('./session.svelte.ts');
const { Workspace } = await import('./workspace.svelte.ts');

class MockDirectory {
	readonly kind = 'directory';
	entries = new Map<string, MockDirectory | MockFile>();
	permission: PermissionState = 'granted';
	constructor(readonly name: string) {}
	async *values() {
		yield* this.entries.values();
	}
	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		let dir = this.entries.get(name);
		if (!dir && options?.create) {
			dir = new MockDirectory(name);
			this.entries.set(name, dir);
		}
		if (!(dir instanceof MockDirectory)) throw new DOMException(name, 'NotFoundError');
		return dir;
	}
	async getFileHandle(name: string, options?: { create?: boolean }) {
		let file = this.entries.get(name);
		if (!file && options?.create) this.entries.set(name, (file = new MockFile(name, this)));
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
		return this.permission;
	}
	async requestPermission() {
		return this.permission;
	}
	list(prefix = ''): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [name, entry] of this.entries) {
			if (entry instanceof MockDirectory) Object.assign(out, entry.list(`${prefix}${name}/`));
			else out[prefix + name] = entry.text;
		}
		return out;
	}
}

/** Writes allowed before the next one fails (a disk that fills up, a drive unplugged). */
const budget = { left: Infinity };

class MockFile {
	readonly kind = 'file';
	text = '';
	constructor(
		readonly name: string,
		readonly dir: MockDirectory
	) {}
	async getFile() {
		return new File([this.text], this.name);
	}
	async createWritable() {
		let next = '';
		return {
			write: async (data: string) => {
				if (budget.left-- <= 0) throw new DOMException('The disk is full.', 'QuotaExceededError');
				next += data;
			},
			// Like the real API: the file changes only when the writable is closed.
			close: async () => void (this.text = next)
		};
	}
}

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
	workspace.preview((await session.load('f'))!);
	return { root, workspace, session };
}

function browserProject(files: Record<string, string>) {
	stored.set('p', {
		id: 'p',
		info: { name: 'Rover' },
		files: Object.entries(files).map(([path, text]) => ({ path, text })),
		origin: 'new',
		created: '',
		updated: ''
	});
}

/** A tab with the project open. */
async function openTab(id: string) {
	const workspace = new Workspace();
	const session = new ProjectSession(workspace);
	workspace.preview((await session.load(id))!);
	return { workspace, session };
}

const textOf = (id: string, path: string) =>
	stored.get(id)!.files.find((f) => f.path === path)?.text;

beforeEach(() => {
	stored.clear();
	failSave = null;
	saves = 0;
	budget.left = Infinity;
});

describe('saving in this browser', () => {
	it('reports a save the browser refused (storage full), asks before leaving, and saves on retry', async () => {
		browserProject({ 'Rover.sysml': 'package Rover {\n}\n' });
		const { workspace, session } = await openTab('p');
		workspace.setText('Rover.sysml', 'package Rover {\n    part wheel;\n}\n');
		session.changed();
		failSave = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		await session.flush();
		expect(session.saveState).toBe('error');
		expect(session.saveError).toMatch(/quota/i);
		expect(session.leaveRisk).toEqual({ kind: 'not-saved' });
		// Nothing half-written: the stored copy is still the last good one.
		expect(textOf('p', 'Rover.sysml')).toBe('package Rover {\n}\n');

		failSave = null;
		await session.save();
		expect(session.saveState).toBe('saved');
		expect(session.leaveRisk).toBeNull();
		expect(textOf('p', 'Rover.sysml')).toBe('package Rover {\n    part wheel;\n}\n');
	});

	it('saves a change still waiting for the autosave at once when flushed (page hidden or left)', async () => {
		browserProject({ 'Rover.sysml': 'package Rover {\n}\n' });
		const { workspace, session } = await openTab('p');
		workspace.setText('Rover.sysml', 'package Rover {\n    part arm;\n}\n');
		session.changed();
		// Within the autosave delay nothing is stored yet…
		expect(textOf('p', 'Rover.sysml')).toBe('package Rover {\n}\n');
		// …and a flush (what the page does when it is hidden or left) stores it.
		await session.flush();
		expect(textOf('p', 'Rover.sysml')).toBe('package Rover {\n    part arm;\n}\n');
	});

	// Known gap: for the 0.6 s between an edit and its autosave the status still says "Saved" (from the save before), so an edit lost to a crash in that moment was shown as saved.
	it.fails('does not show a change waiting for its autosave as saved', async () => {
		browserProject({ 'Rover.sysml': 'package Rover {\n}\n' });
		const { workspace, session } = await openTab('p');
		workspace.setText('Rover.sysml', 'package Rover {\n    part arm;\n}\n');
		session.changed();
		await session.flush();
		expect(session.saveState).toBe('saved');
		workspace.setText('Rover.sysml', 'package Rover {\n    part arm;\n    part leg;\n}\n');
		session.changed();
		expect(session.saveState).not.toBe('saved');
	});

	// Fixed in this assessment: two tabs of one project each saved the whole project, so the later save dropped the other tab's edits without a word.
	it('keeps the edits of two tabs of the same project, or says one would be lost', async () => {
		browserProject({
			'A.sysml': 'package A {\n}\n',
			'B.sysml': 'package B {\n}\n'
		});
		const one = await openTab('p');
		const two = await openTab('p');
		one.workspace.setText('A.sysml', 'package A {\n    part a;\n}\n');
		one.session.changed();
		await one.session.flush();
		two.workspace.setText('B.sysml', 'package B {\n    part b;\n}\n');
		two.session.changed();
		await two.session.flush();
		// Either both edits are kept, or the second tab knows its save would drop the first's.
		const kept = textOf('p', 'A.sysml') === 'package A {\n    part a;\n}\n';
		expect(kept || two.session.saveState === 'error').toBe(true);
		expect(kept).toBe(true);
		expect(two.session.saveState).toBe('error');
		expect(two.session.saveError).toMatch(/another tab/);
		expect(two.session.leaveRisk).toEqual({ kind: 'not-saved' });
	});

	it('saves one at a time, so its own saves in quick succession are not taken for another tab', async () => {
		browserProject({ 'A.sysml': 'package A {\n}\n' });
		const { workspace, session } = await openTab('p');
		workspace.setText('A.sysml', 'package A {\n    part a;\n}\n');
		await Promise.all([session.save(), session.save(), session.markReviewed()]);
		expect(session.saveState).toBe('saved');
		expect(textOf('p', 'A.sysml')).toBe('package A {\n    part a;\n}\n');
	});
});

describe('saving to the folder', () => {
	it('reports a write that failed part-way, keeps every file counted as unsaved, and a retry finishes it', async () => {
		const { root, workspace, session } = await folderProject({
			'model/A.sysml': 'package A {\n}\n',
			'model/B.sysml': 'package B {\n}\n',
			'model/C.sysml': 'package C {\n}\n'
		});
		workspace.setText('model/A.sysml', 'package A {\n    part a;\n}\n');
		workspace.setText('model/B.sysml', 'package B {\n    part b;\n}\n');
		workspace.setText('model/C.sysml', 'package C {\n    part c;\n}\n');
		session.changed();
		budget.left = 1;
		const error = await session.saveToFolder();
		expect(error).toMatch(/disk is full/);
		// The browser copy holds all three changes, and all three still count as not in the folder.
		expect([...session.unsavedToFolder].sort()).toEqual([
			'model/A.sysml',
			'model/B.sysml',
			'model/C.sysml'
		]);
		expect(session.leaveRisk).toEqual({ kind: 'folder', count: 3 });
		await session.save();
		expect(textOf('f', 'model/C.sysml')).toBe('package C {\n    part c;\n}\n');

		budget.left = Infinity;
		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()).toMatchObject({
			'model/A.sysml': 'package A {\n    part a;\n}\n',
			'model/B.sysml': 'package B {\n    part b;\n}\n',
			'model/C.sysml': 'package C {\n    part c;\n}\n'
		});
		expect(session.unsavedToFolder).toEqual([]);
	});

	it('writes nothing and says so when permission to the folder is refused', async () => {
		const { root, workspace, session } = await folderProject({
			'model/A.sysml': 'package A {\n}\n'
		});
		root.permission = 'denied';
		workspace.setText('model/A.sysml', 'package A {\n    part a;\n}\n');
		session.changed();
		expect(await session.saveToFolder()).toBe(
			'Permission to save into the folder was not granted.'
		);
		expect(root.list()['model/A.sysml']).toBe('package A {\n}\n');
		expect(session.unsavedToFolder).toEqual(['model/A.sysml']);
	});

	it('a rename whose write fails keeps the file in the browser copy and still counts both paths', async () => {
		const { root, workspace, session } = await folderProject({
			'model/power.sysml': 'package Power {\n}\n'
		});
		await workspace.renameFile('model/power.sysml', 'model/Power.sysml');
		session.changed();
		budget.left = 0;
		expect(await session.saveToFolder()).toMatch(/disk is full/);
		// The old name was taken out first (a case-only rename), the new one not written:
		// the folder lacks the file, but the browser copy has it and it still counts as unsaved.
		expect(root.list()['model/power.sysml']).toBeUndefined();
		expect(workspace.files['model/Power.sysml']).toBe('package Power {\n}\n');
		expect(session.unsavedToFolder).toContain('model/Power.sysml');
		budget.left = Infinity;
		expect(await session.saveToFolder()).toBeNull();
		expect(root.list()['model/Power.sysml']).toBe('package Power {\n}\n');
	});

	// Known gap: the folder is not re-read before saving, so a change made to the same file on disk (another editor, a git pull, a synced drive) is overwritten without a warning.
	it.fails(
		'does not overwrite a file changed on disk since it was opened without saying so',
		async () => {
			const { root, workspace, session } = await folderProject({
				'model/A.sysml': 'package A {\n}\n'
			});
			// Someone else edits the file on disk…
			(await (await root.getDirectoryHandle('model')).getFileHandle('A.sysml')).text =
				'package A {\n    part fromDisk;\n}\n';
			// …while it is edited here too.
			workspace.setText('model/A.sysml', 'package A {\n    part fromHere;\n}\n');
			session.changed();
			const error = await session.saveToFolder();
			const kept = root.list()['model/A.sysml']!.includes('fromDisk');
			expect(kept || error !== null).toBe(true);
		}
	);
});
