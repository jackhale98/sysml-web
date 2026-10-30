/**
 * Projects kept in this browser (IndexedDB): every edit is saved here, so
 * work survives a reload. A project opened from a folder also keeps the
 * folder's handle so it can be saved back to disk; one opened from a git
 * repository keeps where it came from and the version its files are based on.
 */
import type { GitRecord } from '#lib/git/types.ts';
import type { StoredBaseline } from './baselines.ts';
import { changesNotInFolder, changesNotOnGitHub } from './pending.ts';
import type { ProjectFile, ProjectInfo } from './workspace.svelte.ts';

export interface StoredProject {
	/** The record's format version (`PROJECT_FORMAT`); records kept before it was are version 1. */
	format?: number;
	id: string;
	info: ProjectInfo;
	files: ProjectFile[];
	/** Where the project came from. */
	origin: 'new' | 'folder' | 'archive' | 'demo' | 'git';
	/** For `new` projects: the starting point it was made from (`blank`, `flashlight`, …). */
	template?: string;
	created: string;
	updated: string;
	/** For `folder` projects (Chromium): permission to write the files back. */
	folder?: FileSystemDirectoryHandle;
	/** The repository it is connected to (`git` projects, or any project connected later). */
	git?: GitRecord;
	/** The version "Review changes" compares with when there is no repository: set by "Mark as reviewed". */
	checkpoint?: { files: ProjectFile[]; at: string };
	/**
	 * Baselines kept in this browser (projects not connected to GitHub when
	 * they were marked; those connected keep theirs as tags there), oldest
	 * first. Missing in projects kept before there were baselines: none.
	 */
	baselines?: StoredBaseline[];
	/** For `folder` projects: files changed here and not yet written back to the folder. */
	unsavedToFolder?: string[];
	/**
	 * For `folder` projects: the folder's text of each of those files it has
	 * (one made here has none), so a reload still knows what the folder holds.
	 */
	folderTexts?: Record<string, string>;
	/** For `folder` projects: files whose text in the folder isn't known (kept before `folderTexts` were). */
	unknownInFolder?: string[];
}

export type ProjectSummary = Omit<StoredProject, 'files'> & {
	fileCount: number;
	/** Files changed here and not saved to GitHub yet (projects connected to a repository). */
	notOnGitHub: number;
	/** Files changed here and not saved to the folder yet (folder projects). */
	notInFolder: number;
};

/**
 * The stored project record's format version. Fields added later are
 * optional and read as absent by older code, so they keep the number; a
 * change an older version would misread raises it, and that version then
 * refuses the record rather than saving over it.
 */
export const PROJECT_FORMAT = 1;

/** Why a stored project can't be opened: a newer version of Tessera saved it. */
export const NEWER_FORMAT =
	'This project was saved by a newer version of Tessera. Reload the page to get the newer version.';

/** A record as this version reads it: one without a version is version 1; a newer one is refused. */
export function readStored(record: StoredProject | undefined): StoredProject | undefined {
	if (!record) return record;
	const format = record.format ?? 1;
	if (format > PROJECT_FORMAT) throw new Error(NEWER_FORMAT);
	return { ...record, format };
}

const DB = 'sysml-web';
const STORE = 'projects';

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
	db ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Browser storage is unavailable.'));
	});
	return db;
}

async function run<T>(
	mode: IDBTransactionMode,
	action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const database = await open();
	return new Promise((resolve, reject) => {
		const request = action(database.transaction(STORE, mode).objectStore(STORE));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Browser storage failed.'));
	});
}

export async function listProjects(): Promise<ProjectSummary[]> {
	const all = await run<StoredProject[]>('readonly', (s) => s.getAll());
	return all
		.map((project) => {
			const { files, ...rest } = project;
			return {
				...rest,
				fileCount: files.length,
				notOnGitHub: changesNotOnGitHub(project),
				notInFolder: changesNotInFolder(project)
			};
		})
		.sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function loadProject(id: string): Promise<StoredProject | undefined> {
	return readStored(await run<StoredProject | undefined>('readonly', (s) => s.get(id)));
}

/** Why a save was refused: the project was saved from another tab or window meanwhile. */
export const SAVED_ELSEWHERE =
	'This project was changed in another tab or window. Reload to see those changes: what you changed here since then is not saved.';

/**
 * Keep the project; gives the time it was saved (its new `updated`). With
 * `expected` (the `updated` this copy was read or last saved with; null for
 * a project not stored yet), the save is refused when the stored project
 * was saved meanwhile by someone else (another tab), instead of replacing
 * their changes.
 */
export async function saveProject(
	project: StoredProject,
	expected?: string | null
): Promise<string> {
	const updated = new Date().toISOString();
	const database = await open();
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(STORE, 'readwrite');
		const store = transaction.objectStore(STORE);
		// Both requests are made at once (a page being closed may not get to make
		// a second); the check aborts the transaction, put included, when stale.
		if (expected !== undefined) {
			const current = store.get(project.id);
			current.onsuccess = () => {
				const stored = current.result as StoredProject | undefined;
				if (stored && stored.updated !== expected) {
					reject(new Error(SAVED_ELSEWHERE));
					transaction.abort();
				}
			};
		}
		store.put({ ...project, format: PROJECT_FORMAT, updated });
		transaction.oncomplete = () => resolve();
		transaction.onerror = transaction.onabort = () =>
			reject(transaction.error ?? new Error('Browser storage failed.'));
	});
	void keepStorage();
	return updated;
}

export async function deleteProject(id: string): Promise<void> {
	await run('readwrite', (s) => s.delete(id));
}

/**
 * Give every GitHub project that doesn't say which account it uses this one
 * (the default account until now), so adding another account doesn't change
 * the account those projects save with. Their `updated` time is kept.
 */
export async function claimProjects(login: string): Promise<void> {
	const all = await run<StoredProject[]>('readonly', (s) => s.getAll());
	for (const project of all)
		if (project.git && !project.git.account)
			await run('readwrite', (s) =>
				s.put({ ...project, git: { ...project.git!, account: login } })
			);
}

/** A short, URL-safe id derived from the name, unique among stored projects. */
export async function newProjectId(name: string): Promise<string> {
	const base =
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 40) || 'project';
	const taken = new Set((await listProjects()).map((p) => p.id));
	if (base !== 'demo' && !taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Ask the browser to keep this site's storage (not evict it under pressure). */
export async function persistStorage(): Promise<boolean> {
	try {
		return (await navigator.storage?.persist?.()) ?? false;
	} catch {
		return false;
	}
}

let keepAsked: Promise<boolean> | null = null;

/**
 * Once per page load, ask the browser to keep this site's storage for good
 * (not clear it when space runs low, or after weeks unused), unless it
 * already does. Every save asks, so a project kept before this was asked,
 * or one saved after the browser first said no, still gets it; the browser
 * decides (Chrome by how much the site is used, Firefox by asking the person).
 */
export function keepStorage(): Promise<boolean> {
	keepAsked ??= isStoragePersisted().then((kept) => kept || persistStorage());
	return keepAsked;
}

/** Whether the browser has agreed to keep this site's storage. */
export async function isStoragePersisted(): Promise<boolean> {
	try {
		return (await navigator.storage?.persisted?.()) ?? false;
	} catch {
		return false;
	}
}

/** Bytes used and available to this site, when the browser says. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
	try {
		const estimate = await navigator.storage?.estimate?.();
		return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
	} catch {
		return null;
	}
}

/** Prefix of every key this app keeps in local storage. */
export const LOCAL_KEY_PREFIX = 'sysml-web:';

/**
 * Delete every project, setting and saved account in this browser. Files on
 * disk and in git repositories are not touched.
 */
export async function deleteAllData(): Promise<void> {
	const database = await db?.catch(() => undefined);
	database?.close();
	db = undefined;
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error('Browser storage failed.'));
		request.onblocked = () =>
			reject(new Error('Tessera is open in another tab. Close it, then try again.'));
	});
	try {
		for (const key of Object.keys(localStorage))
			if (key.startsWith(LOCAL_KEY_PREFIX)) localStorage.removeItem(key);
	} catch {
		// Local storage unavailable: nothing kept there.
	}
}

/** The current time, ISO 8601. */
export function timestamp(): string {
	return new Date().toISOString();
}
