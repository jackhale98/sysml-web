/**
 * Saving a project to a Systems Modeling API server: the elements at the
 * branch's head are read, the project's elements take the server's ids
 * wherever they sit in the same place (`rebaseIds`), and only what differs
 * is sent, as one commit.
 */
import type { ApiBranch, ApiCommit, SysmlApi } from './api';
import { dataVersions } from './api';
import { changeSet, rebaseIds, type ChangeSet, type ElementJson } from './elements';

export interface PushPlan {
	/** The commit the change is made against (null: the branch is empty). */
	head: string | null;
	changes: ChangeSet;
	/** Elements of ours that matched one of the server's. */
	matched: number;
}

/** What saving `ours` to `branch` would change on the server. */
export async function planPush(
	api: SysmlApi,
	projectId: string,
	branch: ApiBranch | null,
	ours: ElementJson[],
	onProgress?: (count: number) => void
): Promise<PushPlan> {
	const head = branch?.head ?? null;
	const base = head ? await api.elements(projectId, head, onProgress) : [];
	const { elements, matched } = rebaseIds(ours, base);
	return { head, changes: changeSet(base, elements), matched };
}

export const changeCount = (changes: ChangeSet): number =>
	changes.created.length + changes.updated.length + changes.deleted.length;

/** Send a planned change as one commit. */
export function push(
	api: SysmlApi,
	projectId: string,
	branch: ApiBranch | null,
	plan: PushPlan,
	description: string
): Promise<ApiCommit> {
	return api.commit(projectId, branch?.id ?? null, dataVersions(plan.changes), description);
}
