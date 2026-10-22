/**
 * Projects kept in this browser (IndexedDB): every edit is saved here, so
 * work survives a reload. A project opened from a folder also keeps the
 * folder's handle so it can be saved back to disk; one opened from a git
 * repository keeps where it came from and the version its files are based on.
 */
import type { GitRecord } from '#lib/git/types.ts';
import { changesNotInFolder, changesNotOnGitHub } from './pending.ts';
import type { ProjectFile, ProjectInfo } from './workspace.svelte.ts';

export interface StoredProject {
	id: string;
	info: ProjectInfo;
	files: ProjectFile[];
	/** Where the project came from. */
	origin: 'new' | 'folder' | 'archive' | 'demo' | 'git';
	created: string;
	updated: string;
	/** For `folder` projects (Chromium): permission to write the files back. */
	folder?: FileSystemDirectoryHandle;
	/** The repository it is connected to (`git` projects, or any project connected later). */
	git?: GitRecord;
	/** The version "Review changes" compares with when there is no repository: set by "Mark as reviewed". */
	checkpoint?: { files: ProjectFile[]; at: string };
	/** For `folder` projects: files changed here and not yet written back to the folder. */
	unsavedToFolder?: string[];
}

export type ProjectSummary = Omit<StoredProject, 'files'> & {
	fileCount: number;
	/** Files changed here and not saved to GitHub yet (projects connected to a repository). */
	notOnGitHub: number;
	/** Files changed here and not saved to the folder yet (folder projects). */
	notInFolder: number;
};

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

export function loadProject(id: string): Promise<StoredProject | undefined> {
	return run<StoredProject | undefined>('readonly', (s) => s.get(id));
}

export async function saveProject(project: StoredProject): Promise<void> {
	await run('readwrite', (s) => s.put({ ...project, updated: new Date().toISOString() }));
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
			reject(new Error('Fairtide is open in another tab. Close it, then try again.'));
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
