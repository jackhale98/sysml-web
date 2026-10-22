/**
 * One open project: where it is stored, autosaving every change to this
 * browser, saving back to its folder or its git repository (`git`), and
 * exporting it as a `.kpar`.
 */
import { GitConnection } from '#lib/git/connection.svelte.ts';
import { noteDownloaded } from '#lib/workbench/home/nextSteps.ts';
import { demoProject } from './demo.ts';
import { leaveRisk, type LeaveRisk } from './pending.ts';
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
	/** The files as they were when the project was opened on this page. */
	private opened: ProjectFile[] = [];

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

	/**
	 * What leaving the project now would leave behind: changes not on GitHub,
	 * not in the folder, or not even saved in this browser. Null when nothing.
	 */
	get leaveRisk(): LeaveRisk | null {
		const git = this.record?.git;
		return leaveRisk({
			saveFailed: this.saveState === 'error',
			github: git
				? {
						owner: git.owner,
						repo: git.repo,
						branch: git.branch,
						changes: this.git.changes.length
					}
				: null,
			folder: this.canSaveToFolder ? this.unsavedToFolder.length : 0
		});
	}

	/** The project with this id: stored in the browser, or the bundled demo. */
	async load(id: string): Promise<ProjectSource | null> {
		const stored = await loadProject(id).catch(() => undefined);
		if (stored) {
			this.record = stored;
			if (stored.origin === 'folder') {
				// Files changed here but not written back are not what the folder holds:
				// the folder's text of those is kept beside them.
				const unsaved = stored.unsavedToFolder ?? [];
				this.folderTexts = {
					...Object.fromEntries(
						stored.files.filter((f) => !unsaved.includes(f.path)).map((f) => [f.path, f.text])
					),
					...stored.folderTexts
				};
				if (!stored.folderTexts) {
					// Kept before the folder's texts were: a file deleted or renamed here is
					// still in the folder, its text there unknown.
					const kept = stored.files.map((f) => f.path);
					for (const path of unsaved) if (!kept.includes(path)) this.folderTexts[path] = '';
				}
				this.unsavedToFolder = unsaved;
			}
			this.opened = stored.files;
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
			this.opened = demo.files;
			return demo;
		}
		return null;
	}

	/** Call when the workspace files change: saves shortly afterwards. */
	changed() {
		if (!this.record) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
		if (this.record.origin === 'folder') this.unsavedToFolder = this.notInFolder();
	}

	/** Files changed or added here and not written to the folder, and files to take out of it. */
	private notInFolder(): string[] {
		const files = this.workspace.files;
		return [
			...Object.keys(files).filter((p) => files[p] !== this.folderTexts[p]),
			...this.removedFromFolder()
		];
	}

	/** Files the folder still has that were deleted or renamed here (its info is always written). */
	private removedFromFolder(): string[] {
		return Object.keys(this.folderTexts).filter(
			(p) => !(p in this.workspace.files) && p !== '.project.json'
		);
	}

	/** The folder's text of each file not written to it yet that it has. */
	private unsavedFolderTexts(): Record<string, string> {
		return Object.fromEntries(
			this.unsavedToFolder
				.filter((p) => p in this.folderTexts)
				.map((p) => [p, this.folderTexts[p]!])
		);
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
			this.record = {
				...this.record,
				info,
				files: this.files(),
				// Remembered, so a reload still knows what isn't in the folder yet.
				...(this.record.origin === 'folder'
					? { unsavedToFolder: this.unsavedToFolder, folderTexts: this.unsavedFolderTexts() }
					: {})
			};
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
		const removed = this.removedFromFolder();
		try {
			await writeToFolder(
				folder,
				[
					...changed,
					{
						path: '.project.json',
						text: JSON.stringify(this.workspace.info ?? this.record!.info, null, '\t') + '\n'
					}
				],
				removed
			);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		for (const f of changed) this.folderTexts[f.path] = f.text;
		for (const path of removed) delete this.folderTexts[path];
		this.unsavedToFolder = [];
		await this.save();
		return null;
	}

	/**
	 * The version "Review changes" compares this browser's files with when the
	 * project isn't in a repository: the one marked as reviewed, else the
	 * folder's files (folder projects), the demo as it comes, or the files as
	 * they were when the project was opened.
	 */
	reviewBase(): { files: ProjectFile[]; label: string; checkpoint: boolean } {
		const record = this.record;
		if (record?.checkpoint)
			return {
				files: record.checkpoint.files,
				label: 'the version you marked as reviewed',
				checkpoint: true
			};
		if (record?.origin === 'folder' && Object.keys(this.folderTexts).length)
			return {
				files: Object.entries(this.folderTexts).map(([path, text]) => ({ path, text })),
				label: 'the files in the folder',
				checkpoint: false
			};
		if (record?.origin === 'demo')
			return { files: demoProject().files, label: 'the demo as it comes', checkpoint: false };
		return {
			files: this.opened,
			label: 'the version you opened',
			checkpoint: false
		};
	}

	/** Make the files as they are now the version later changes are reviewed against. */
	async markReviewed() {
		if (!this.record) return;
		this.record = { ...this.record, checkpoint: { files: this.files(), at: timestamp() } };
		await this.save();
	}

	/** Download the project as a `.kpar` (KerML 10.3 project interchange). */
	async exportKpar() {
		const info = this.workspace.info ?? this.record?.info ?? { name: 'project' };
		const { writeKpar } = await import('#lib/interchange/kpar.ts');
		const bytes = await writeKpar(info, this.files(), timestamp());
		const name = (info.name || 'project').replace(/[^\w.-]+/g, '-');
		download(`${name}.kpar`, bytes, 'application/zip');
		if (this.record) noteDownloaded(this.record.id);
	}
}
