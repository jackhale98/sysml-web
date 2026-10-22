/** Open a repository branch as a new project kept in this browser. */
import { newProjectId, persistStorage, saveProject, timestamp } from '#lib/project/store.ts';
import { accounts } from './account.svelte.ts';
import { GitError } from './errors.ts';
import { readRepository } from './open.ts';
import type { Progress, RepoChoice } from './types.ts';

/** Read the branch, store it as a project and return the project's id. */
export async function keepRepository(
	choice: RepoChoice,
	progress?: Progress
): Promise<{ id: string; notice?: string }> {
	const opened = await readRepository(
		accounts.provider(choice.account),
		choice.ref,
		choice.branch,
		choice.defaultBranch,
		progress
	);
	if (!opened.files.some((f) => /\.(sysml|kerml)$/.test(f.path)))
		throw new GitError(
			'not-found',
			`There are no .sysml or .kerml files on “${choice.branch}” in ${choice.ref.owner}/${choice.ref.repo}. Pick another repository or branch.`
		);
	const id = await newProjectId(opened.info.name);
	const now = timestamp();
	// The project keeps using the account it was opened with.
	const account = choice.account ?? accounts.github?.user.login;
	await saveProject({
		id,
		info: opened.info,
		files: opened.files,
		origin: 'git',
		git: { ...opened.git, ...(account ? { account } : {}) },
		created: now,
		updated: now
	});
	void persistStorage();
	return { id, notice: opened.notice };
}
