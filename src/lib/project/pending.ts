/**
 * Work that is kept on this device but not yet where it belongs: changes
 * not saved to GitHub (projects connected to a repository) or not saved to
 * the folder they were opened from. Plain functions, so they are easy to
 * test; the projects page, the project menu and the "before you leave"
 * dialog all count the same way.
 *
 * Projects kept only in this browser have nothing pending: every change is
 * saved here as it is made (the open project saves within a moment, and
 * that save is finished before the project is left).
 */
import { sameLogin } from '#lib/git/account.svelte.ts';
import { localChanges } from '#lib/git/sync.ts';
import type { GitRecord } from '#lib/git/types.ts';
import type { ProjectFile } from './workspace.svelte.ts';

/** How many files of a stored project differ from the version on GitHub it is based on. */
export function changesNotOnGitHub(project: { files: ProjectFile[]; git?: GitRecord }): number {
	if (!project.git) return 0;
	const local = Object.fromEntries(project.files.map((f) => [f.path, f.text]));
	return localChanges(project.git.files, local).length;
}

/** How many files of a folder project are not yet written back to the folder. */
export function changesNotInFolder(project: {
	origin: string;
	unsavedToFolder?: string[];
}): number {
	return project.origin === 'folder' ? (project.unsavedToFolder?.length ?? 0) : 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 changes not on GitHub", "1 change not saved to the folder", or null when nothing is pending. */
export function pendingLabel(counts: { notOnGitHub: number; notInFolder: number }): string | null {
	if (counts.notOnGitHub) return `${plural(counts.notOnGitHub, 'change', 'changes')} not on GitHub`;
	if (counts.notInFolder)
		return `${plural(counts.notInFolder, 'change', 'changes')} not saved to the folder`;
	return null;
}

/** What could be left behind by leaving the open project now. */
export type LeaveRisk =
	/** The latest changes couldn't be saved in this browser (storage full or blocked). */
	| { kind: 'not-saved' }
	/** Changes kept here but not on GitHub yet. */
	| { kind: 'github'; count: number; repo: string; branch: string }
	/** Changes kept here but not written to the folder yet. */
	| { kind: 'folder'; count: number };

export interface OpenProjectState {
	/** The latest save to this browser failed. */
	saveFailed: boolean;
	/** The project's repository and its changes not on GitHub, when connected. */
	github?: { owner: string; repo: string; branch: string; changes: number } | null;
	/** Files not written to the folder (folder projects that can be saved back). */
	folder?: number;
}

/** Whether leaving the open project needs a word first, and about what. */
export function leaveRisk(state: OpenProjectState): LeaveRisk | null {
	if (state.saveFailed) return { kind: 'not-saved' };
	const github = state.github;
	if (github && github.changes > 0)
		return {
			kind: 'github',
			count: github.changes,
			repo: `${github.owner}/${github.repo}`,
			branch: github.branch
		};
	if (state.folder) return { kind: 'folder', count: state.folder };
	return null;
}

/**
 * The projects whose changes not on GitHub would be stranded by signing out
 * of `login`: those it opened, and (when it is the default account) those
 * that don't say which account they use.
 */
export function strandedBySignOut<
	T extends { git?: Pick<GitRecord, 'account'>; notOnGitHub: number }
>(projects: T[], login: string, isDefault: boolean): T[] {
	return projects.filter(
		(p) =>
			!!p.git && p.notOnGitHub > 0 && (p.git.account ? sameLogin(p.git.account, login) : isDefault)
	);
}
