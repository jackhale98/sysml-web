/** Read a repository branch's project files, ready to keep as a project. */
import { infoFromFiles, isProjectFile } from '#lib/project/sources.ts';
import type { ProjectFile, ProjectInfo } from '#lib/project/workspace.svelte.ts';
import { isTrackedFile, trackedEntries } from './sync.ts';
import type { GitProvider, GitRecord, Progress, RepoRef } from './types.ts';

/** More files than this is not a SysML project the browser should hold. */
const MAX_FILES = 2000;

export interface OpenedRepository {
	info: ProjectInfo;
	files: ProjectFile[];
	git: GitRecord;
	/** Something the person should know (e.g. a partial listing). */
	notice?: string;
}

export async function readRepository(
	provider: GitProvider,
	ref: RepoRef,
	branch: string,
	defaultBranch: string,
	progress?: Progress
): Promise<OpenedRepository> {
	const head = await provider.head(ref, branch);
	const tree = await provider.readTree(ref, head.commit);
	const wanted = tree.entries.filter((e) => isProjectFile(e.path)).slice(0, MAX_FILES);
	const texts = await provider.readFiles(ref, wanted, progress);
	const all = wanted.map((e) => ({ path: e.path, text: texts[e.path] ?? '' }));
	const tracked = trackedEntries(wanted);
	const files = all.filter((f) => isTrackedFile(f.path));
	const info = infoFromFiles(all, ref.repo);
	const notice = tree.truncated
		? 'This repository is very large: GitHub listed only part of it, so some files may be missing.'
		: wanted.length === MAX_FILES
			? `Only the first ${MAX_FILES} model files were opened.`
			: undefined;
	return {
		info,
		files,
		notice,
		git: {
			provider: provider.id,
			owner: ref.owner,
			repo: ref.repo,
			branch,
			defaultBranch,
			base: head.commit,
			baseTree: tree.tree,
			files: Object.fromEntries(
				Object.entries(tracked).map(([path, sha]) => [path, { sha, text: texts[path] ?? '' }])
			),
			syncedAt: new Date().toISOString()
		}
	};
}
