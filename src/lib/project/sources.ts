/**
 * Where projects come from: a starter template, a folder on disk (File
 * System Access in Chromium, a folder upload elsewhere) or an archive.
 */
import type { ProjectFile, ProjectInfo } from './workspace.svelte.ts';

/** Files the workbench reads; everything else in a folder is left alone. */
const PROJECT_FILE = /\.(sysml|kerml|md)$|(^|\/)\.project\.json$/;
const SKIP_DIR = /^(\.git|node_modules|target|build|dist|\.svelte-kit)$/;
const MAX_FILES = 2000;

export function isProjectFile(path: string): boolean {
	return PROJECT_FILE.test(path);
}

/** A SysML name for the project: a plain identifier when possible, else quoted. */
export function packageName(projectName: string): string {
	const words = projectName
		.trim()
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
	const ident = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
	if (/^[A-Za-z_]\w*$/.test(ident)) return ident;
	return `'${projectName.trim().replace(/'/g, '') || 'Model'}'`;
}

/** A package named after the project's, with a suffix: `RoverViews`, `'2024 rig Views'`. */
export function relatedPackage(pkg: string, suffix: string): string {
	return pkg.startsWith("'") ? `${pkg.slice(0, -1)} ${suffix}'` : `${pkg}${suffix}`;
}

/** A file name for a package: `Rover`, `2024rig` (no quotes or spaces). */
export function fileStem(pkg: string): string {
	return pkg.replace(/'/g, '').replace(/\s+/g, '');
}

// --- Folders ---------------------------------------------------------------

/** Minimal File System Access API types (Chromium). */
interface DirectoryHandle {
	kind: 'directory';
	name: string;
	values(): AsyncIterable<DirectoryHandle | FileHandle>;
	getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
	getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
	queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
	requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface FileHandle {
	kind: 'file';
	name: string;
	getFile(): Promise<File>;
	createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** Whether this browser can open a folder and save back to it. */
export function canOpenFolders(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export interface OpenedFolder {
	name: string;
	handle: FileSystemDirectoryHandle;
	files: ProjectFile[];
}

/** Let the person pick a folder and read its SysML, Markdown and project files. */
export async function pickFolder(): Promise<OpenedFolder> {
	const picker = (
		window as unknown as {
			showDirectoryPicker(options: { mode: 'readwrite' }): Promise<DirectoryHandle>;
		}
	).showDirectoryPicker;
	const handle = await picker.call(window, { mode: 'readwrite' });
	const files: ProjectFile[] = [];
	await readDirectory(handle, '', files);
	return { name: handle.name, handle: handle as unknown as FileSystemDirectoryHandle, files };
}

async function readDirectory(dir: DirectoryHandle, prefix: string, out: ProjectFile[]) {
	for await (const entry of dir.values()) {
		if (out.length >= MAX_FILES) return;
		const path = prefix + entry.name;
		if (entry.kind === 'directory') {
			if (!SKIP_DIR.test(entry.name)) await readDirectory(entry, `${path}/`, out);
		} else if (isProjectFile(path)) {
			out.push({ path, text: await (await entry.getFile()).text() });
		}
	}
}

/** Write the given files back into the folder, creating sub-folders as needed. */
export async function writeToFolder(
	folder: FileSystemDirectoryHandle,
	files: ProjectFile[]
): Promise<void> {
	const root = folder as unknown as DirectoryHandle;
	const allowed =
		(await root.queryPermission?.({ mode: 'readwrite' })) === 'granted' ||
		(await root.requestPermission?.({ mode: 'readwrite' })) === 'granted';
	if (!allowed) throw new Error('Permission to save into the folder was not granted.');
	for (const file of files) {
		const parts = file.path.split('/');
		let dir = root;
		for (const part of parts.slice(0, -1))
			dir = await dir.getDirectoryHandle(part, { create: true });
		const writable = await (
			await dir.getFileHandle(parts.at(-1)!, { create: true })
		).createWritable();
		await writable.write(file.text);
		await writable.close();
	}
}

/** Files chosen with `<input type="file" webkitdirectory>` (browsers without folder access). */
export async function readUploadedFolder(
	list: FileList
): Promise<{ name: string; files: ProjectFile[] }> {
	const all = [...list];
	const first = all[0]?.webkitRelativePath ?? '';
	const top = first.includes('/') ? first.slice(0, first.indexOf('/') + 1) : '';
	const files: ProjectFile[] = [];
	for (const file of all) {
		const path = (file.webkitRelativePath || file.name).slice(top.length);
		if (path.split('/').some((p) => SKIP_DIR.test(p)) || !isProjectFile(path)) continue;
		files.push({ path, text: await file.text() });
		if (files.length >= MAX_FILES) break;
	}
	return { name: top.replace(/\/$/, '') || 'Uploaded project', files };
}

/** `.project.json` from the files, if present. */
export function infoFromFiles(files: ProjectFile[], fallback: string): ProjectInfo {
	const json = files.find((f) => f.path === '.project.json');
	if (json) {
		try {
			const parsed = JSON.parse(json.text) as Partial<ProjectInfo>;
			if (parsed.name) return { ...parsed, name: parsed.name };
		} catch {
			// Fall through to a plain name.
		}
	}
	return { name: fallback };
}

/** Offer a file to the person to save. */
export function download(name: string, data: Uint8Array | string, type: string) {
	const blob = new Blob([data as BlobPart], { type });
	const url = URL.createObjectURL(blob);
	const a = Object.assign(document.createElement('a'), { href: url, download: name });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
