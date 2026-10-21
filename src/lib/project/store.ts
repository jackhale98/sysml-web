/**
 * Projects kept in this browser (IndexedDB): every edit is saved here, so
 * work survives a reload. A project opened from a folder also keeps the
 * folder's handle so it can be saved back to disk.
 */
import type { ProjectFile, ProjectInfo } from './workspace.svelte.ts';

export interface StoredProject {
	id: string;
	info: ProjectInfo;
	files: ProjectFile[];
	/** Where the project came from. */
	origin: 'new' | 'folder' | 'archive' | 'demo';
	created: string;
	updated: string;
	/** For `folder` projects (Chromium): permission to write the files back. */
	folder?: FileSystemDirectoryHandle;
}

export type ProjectSummary = Omit<StoredProject, 'files'> & { fileCount: number };

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
		.map(({ files, ...rest }) => ({ ...rest, fileCount: files.length }))
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

/** The current time, ISO 8601. */
export function timestamp(): string {
	return new Date().toISOString();
}
