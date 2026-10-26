/**
 * One open project: where it is stored, autosaving every change to this
 * browser, saving back to its folder or its git repository (`git`), and
 * exporting it as a `.kpar`.
 */
import { GitConnection } from '#lib/git/connection.svelte.ts';
import type { Resolution } from '#lib/git/sync.ts';
import { noteDownloaded } from '#lib/workbench/home/nextSteps.ts';
import { demoProject } from './demo.ts';
import { planFolderSave, sameConflicts, settleFolderSave, type FolderPlan } from './folderSync.ts';
import { leaveRisk, type LeaveRisk } from './pending.ts';
import { download, readFolder, writeToFolder } from './sources.ts';
import { NEWER_FORMAT, loadProject, saveProject, timestamp, type StoredProject } from './store.ts';
import type { ProjectFile, ProjectSource, Workspace } from './workspace.svelte.ts';

const AUTOSAVE_MS = 600;

/** Said when a save to the folder stops to ask about files changed there too. */
export const FOLDER_CONFLICTS =
	'Some files changed in the folder too. Choose what to keep: nothing is saved until you do.';

/** Said after a save to the folder, with the files it brought in from there. */
export function savedToFolder(broughtIn: string[]): string {
	if (!broughtIn.length) return 'Saved to the folder.';
	if (broughtIn.length === 1)
		return `Saved to the folder. ${broughtIn[0]!.split('/').pop()} had changed there, so its change was brought in.`;
	return `Saved to the folder. ${broughtIn.length} files had changed there, so their changes were brought in.`;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export class ProjectSession {
	record = $state.raw<StoredProject | null>(null);
	saveState = $state<SaveState>('idle');
	saveError = $state<string | null>(null);
	/** Why the stored project couldn't be read (a newer version saved it), when it couldn't. */
	loadError = $state<string | null>(null);
	/** Files changed since the folder was last written (folder projects). */
	unsavedToFolder = $state.raw<string[]>([]);
	/** A save to the folder waiting for the person to choose, for files changed in the folder too. */
	folderPending = $state.raw<FolderPlan | null>(null);
	/** Files the latest save to the folder brought in from it (changed there, not here). */
	broughtIn = $state.raw<string[]>([]);
	/** A save to the folder is under way. */
	savingToFolder = $state(false);

	/** The link to a git repository: changes, Save to GitHub, Get latest, … */
	readonly git: GitConnection;

	private timer: ReturnType<typeof setTimeout> | undefined;
	/** The folder's text of each file, as last read or written here. */
	private folderTexts: Record<string, string> = {};
	/** Files whose text in the folder isn't known (kept before the folder's texts were). */
	private unknownInFolder: string[] = [];
	/** The files as they were when the project was opened on this page. */
	private opened: ProjectFile[] = [];
	/**
	 * When the stored project was last saved, as this page knows it (null: not
	 * stored yet), so a save from another tab meanwhile isn't overwritten.
	 */
	private stamp: string | null | undefined;

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
		const stored = await loadProject(id).catch((error: unknown) => {
			if (error instanceof Error && error.message === NEWER_FORMAT) this.loadError = error.message;
			return undefined;
		});
		if (this.loadError) return null;
		if (stored) {
			this.record = stored;
			this.stamp = stored.updated;
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
				this.unknownInFolder = [...(stored.unknownInFolder ?? [])];
				if (!stored.folderTexts) {
					// Kept before the folder's texts were: a file deleted or renamed here is
					// still in the folder, and what the folder holds of these is unknown.
					const kept = stored.files.map((f) => f.path);
					for (const path of unsaved) {
						if (!kept.includes(path)) this.folderTexts[path] = '';
						if (!this.unknownInFolder.includes(path)) this.unknownInFolder.push(path);
					}
				}
				this.unsavedToFolder = unsaved;
			}
			this.opened = stored.files;
			return { id, info: stored.info, files: stored.files };
		}
		if (id === 'demo') {
			const demo = demoProject();
			const now = timestamp();
			this.stamp = null;
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

	/** Call when the workspace files change: saves shortly afterwards (shown as saving until then). */
	changed() {
		if (!this.record) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
		// Not saved yet: a crash before the autosave would lose it. "Not saved" stays until a save works.
		if (this.saveState !== 'error') this.saveState = 'saving';
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

	/** The save in progress: saves go one at a time, so each knows when the one before it saved. */
	private saving: Promise<void> = Promise.resolve();

	save(): Promise<void> {
		if (!this.record) return Promise.resolve();
		clearTimeout(this.timer);
		this.timer = undefined;
		this.saveState = 'saving';
		this.saving = this.saving.then(() => this.write());
		return this.saving;
	}

	private async write() {
		if (!this.record) return;
		try {
			const info = this.workspace.info ?? this.record.info;
			this.record = {
				...this.record,
				info,
				files: this.files(),
				// Remembered, so a reload still knows what isn't in the folder yet.
				...(this.record.origin === 'folder'
					? {
							unsavedToFolder: this.unsavedToFolder,
							folderTexts: this.unsavedFolderTexts(),
							unknownInFolder: this.unknownInFolder.length ? [...this.unknownInFolder] : undefined
						}
					: {})
			};
			this.stamp = await saveProject(this.record, this.stamp);
			// A change made while this save was under way is still waiting for its own.
			this.saveState = this.timer === undefined ? 'saved' : 'saving';
			this.saveError = null;
		} catch (error) {
			this.saveState = 'error';
			this.saveError = error instanceof Error ? error.message : String(error);
		}
	}

	/**
	 * Write the files changed here back into the opened folder, after reading
	 * it again: a file changed only in the folder meanwhile is brought into the
	 * project instead (`broughtIn`), and when files changed on both sides
	 * nothing is written until the person chooses (`folderPending`,
	 * `resolveFolder`). Returns what to tell the person when it didn't save.
	 */
	saveToFolder(): Promise<string | null> {
		this.folderPending = null;
		return this.toFolder(null);
	}

	/** Finish a save to the folder that stopped for conflicts, with the person's choice for each file. */
	resolveFolder(choices: Record<string, Resolution>): Promise<string | null> {
		const plan = this.folderPending;
		if (!plan) return Promise.resolve(null);
		return this.toFolder({ plan, choices });
	}

	/** Leave the folder as it is: the changes stay here, unsaved to it. */
	cancelFolderSave() {
		this.folderPending = null;
	}

	private folderSaving: Promise<string | null> | null = null;

	private toFolder(
		resolving: { plan: FolderPlan; choices: Record<string, Resolution> } | null
	): Promise<string | null> {
		// One at a time: a second Save to folder while one is under way is the same save.
		if (this.folderSaving) return this.folderSaving;
		this.savingToFolder = true;
		this.folderSaving = this.writeFolder(resolving).finally(() => {
			this.folderSaving = null;
			this.savingToFolder = false;
		});
		return this.folderSaving;
	}

	private async writeFolder(
		resolving: { plan: FolderPlan; choices: Record<string, Resolution> } | null
	): Promise<string | null> {
		const folder = this.record?.folder;
		if (!folder) return 'This project was not opened from a folder.';
		const local = this.workspace.files;
		let disk: Record<string, string>;
		try {
			disk = await readFolder(
				folder,
				Object.keys({ ...this.folderTexts, ...local, '.project.json': '' })
			);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		const plan = planFolderSave(this.folderTexts, local, disk, this.unknownInFolder);
		if (resolving && !sameConflicts(resolving.plan, plan)) {
			this.folderPending = null;
			return 'Files changed since you chose Save to folder, so nothing was saved. Save to folder again to compare them anew.';
		}
		if (plan.conflicts.length && !resolving) {
			this.folderPending = plan;
			return FOLDER_CONFLICTS;
		}
		const save = settleFolderSave(plan, resolving?.choices);
		const known = this.folderTexts;
		const put = (path: string, text: string | null) => {
			if (text === null) delete known[path];
			else known[path] = text;
		};
		// Into the project first, while the files are as they were read. A combined
		// version not taken (edited here meanwhile) isn't written either.
		const taken = await this.take(save.take, local);
		for (const path of Object.keys(save.take)) {
			if (!taken.includes(path)) delete save.write[path];
			else if (!(path in save.write)) put(path, save.take[path] ?? null);
		}
		this.broughtIn = taken.filter((path) => path in plan.updates);
		this.folderPending = null;
		const files = Object.entries(save.write).map(([path, text]) => ({ path, text }));
		// The project's info, for a folder that has none (one there is left as it is).
		if (!('.project.json' in disk))
			files.push({
				path: '.project.json',
				text: JSON.stringify(this.workspace.info ?? this.record!.info, null, '\t') + '\n'
			});
		let error: string | null = null;
		try {
			await writeToFolder(folder, files, save.remove);
			for (const [path, text] of Object.entries(plan.same)) put(path, text);
			for (const [path, text] of Object.entries(save.write)) put(path, text);
			for (const path of save.remove) delete known[path];
			this.unknownInFolder = [];
		} catch (e) {
			// Some files may be written (or made empty) already: what the folder holds of
			// these is this save's doing, so a retry writes them without asking.
			for (const path of [...Object.keys(save.write), ...save.remove])
				if (!this.unknownInFolder.includes(path)) this.unknownInFolder.push(path);
			error = e instanceof Error ? e.message : String(e);
		}
		this.unsavedToFolder = this.notInFolder();
		await this.save();
		return error;
	}

	/**
	 * Bring files from the folder (or combined) into the project, as one
	 * undoable step; one edited here since `was` is left as it is. Gives the
	 * paths brought in.
	 */
	private async take(
		texts: Record<string, string | null>,
		was: Record<string, string>
	): Promise<string[]> {
		const taken: string[] = [];
		await this.workspace.transact('Brought in changes from the folder', async () => {
			for (const [path, text] of Object.entries(texts)) {
				if (this.workspace.files[path] !== was[path]) continue;
				if (text === null) await this.workspace.deleteFile(path);
				else this.workspace.setText(path, text);
				taken.push(path);
			}
			return null;
		});
		return taken;
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
