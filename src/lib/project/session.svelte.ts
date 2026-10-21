/**
 * One open project: where it is stored, autosaving every change to this
 * browser, saving back to its folder or its git repository (`git`), and
 * exporting it as a `.kpar`.
 */
import { GitConnection } from '#lib/git/connection.svelte.ts';
import { demoProject } from './demo.ts';
import { download, writeToFolder } from './sources.ts';
import { loadProject, saveProject, timestamp, type StoredProject } from './store.ts';
import type { ProjectFile, ProjectSource, Workspace } from './workspace.svelte.ts';

const AUTOSAVE_MS = 600;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export class ProjectSession {
	record = $state.raw<StoredProject | null>(null);
	saveState = $state<SaveState>('idle');
	saveError = $state<string | null>(null);
	/** Files changed since the folder was last written (folder projects). */
	unsavedToFolder = $state.raw<string[]>([]);

	/** The link to a git repository: changes, Save to GitHub, Get latest, … */
	readonly git: GitConnection;

	private timer: ReturnType<typeof setTimeout> | undefined;
	private folderTexts: Record<string, string> = {};

	constructor(private workspace: Workspace) {
		this.git = new GitConnection(this, workspace);
	}

	/** Whether the project is connected to a git repository. */
	get isGit(): boolean {
		return !!this.record?.git;
	}

	get canSaveToFolder(): boolean {
		return this.record?.origin === 'folder' && !!this.record.folder;
	}

	/** The project with this id: stored in the browser, or the bundled demo. */
	async load(id: string): Promise<ProjectSource | null> {
		const stored = await loadProject(id).catch(() => undefined);
		if (stored) {
			this.record = stored;
			if (stored.origin === 'folder') {
				this.folderTexts = Object.fromEntries(stored.files.map((f) => [f.path, f.text]));
			}
			return { id, info: stored.info, files: stored.files };
		}
		if (id === 'demo') {
			const demo = demoProject();
			const now = timestamp();
			this.record = {
				id,
				info: demo.info,
				files: demo.files,
				origin: 'demo',
				created: now,
				updated: now
			};
			return demo;
		}
		return null;
	}

	/** Call when the workspace files change: saves shortly afterwards. */
	changed() {
		if (!this.record) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
		if (this.record.origin === 'folder') {
			const files = this.workspace.files;
			this.unsavedToFolder = Object.keys(files).filter((p) => files[p] !== this.folderTexts[p]);
		}
	}

	private files(): ProjectFile[] {
		return Object.entries(this.workspace.files).map(([path, text]) => ({ path, text }));
	}

	/** Save now if a change is still waiting to be saved (before the page reloads). */
	async flush() {
		if (this.timer !== undefined) await this.save();
	}

	async save() {
		if (!this.record) return;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.saveState = 'saving';
		try {
			const info = this.workspace.info ?? this.record.info;
			this.record = { ...this.record, info, files: this.files() };
			await saveProject(this.record);
			this.saveState = 'saved';
			this.saveError = null;
		} catch (error) {
			this.saveState = 'error';
			this.saveError = error instanceof Error ? error.message : String(error);
		}
	}

	/** Write changed files (and `.project.json`) back into the opened folder. */
	async saveToFolder(): Promise<string | null> {
		const folder = this.record?.folder;
		if (!folder) return 'This project was not opened from a folder.';
		const changed = this.files().filter((f) => this.folderTexts[f.path] !== f.text);
		try {
			await writeToFolder(folder, [
				...changed,
				{
					path: '.project.json',
					text: JSON.stringify(this.workspace.info ?? this.record!.info, null, '\t') + '\n'
				}
			]);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		for (const f of changed) this.folderTexts[f.path] = f.text;
		this.unsavedToFolder = [];
		return null;
	}

	/** Download the project as a `.kpar` (KerML 10.3 project interchange). */
	async exportKpar() {
		const info = this.workspace.info ?? this.record?.info ?? { name: 'project' };
		const { writeKpar } = await import('#lib/interchange/kpar.ts');
		const bytes = await writeKpar(info, this.files(), timestamp());
		const name = (info.name || 'project').replace(/[^\w.-]+/g, '-');
		download(`${name}.kpar`, bytes, 'application/zip');
	}
}
