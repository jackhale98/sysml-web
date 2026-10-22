/**
 * Saving a project to a Systems Modeling API server: the elements at the
 * branch's head are read, the project's elements take the server's ids
 * wherever they sit in the same place (`rebaseIds`), and only what differs
 * is sent, as one commit.
 *
 * When others saved to the branch since the project was opened from it (or
 * last saved to it), the save merges first (`merge.ts`): their changes come
 * into the project's text (`weaveInterchange`), and the commit then holds
 * the project's changes on top of theirs.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { SourceFile } from '#lib/engine/protocol.ts';
import type { ApiBranch, ApiCommit, SysmlApi } from './api';
import { dataVersions } from './api';
import { changeSet, rebaseIds, type ChangeSet, type ElementJson } from './elements';
import { planMerge, resolveMerge, type MergePlan, type Side } from './merge';
import type { WeaveResult } from './types';

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
	return pushPlanAgainst(head, base, ours);
}

/** What saving `ours` would change on a server whose branch holds `elements` at `head`. */
export function pushPlanAgainst(
	head: string | null,
	elements: ElementJson[],
	ours: ElementJson[]
): PushPlan {
	const { elements: rebased, matched } = rebaseIds(ours, elements);
	return { head, changes: changeSet(elements, rebased), matched };
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

/** A save that merges with what others saved since `base`. */
export interface MergeSave {
	/** The commit the project was opened from or last saved to. */
	base: string;
	/** The branch's head: the new commit's parent. */
	head: string;
	plan: MergePlan;
	/** The head's elements as the server sent them. */
	headElements: ElementJson[];
	/** What bringing their changes in does to the text, every conflict kept as mine (null: nothing comes in). */
	preview: WeaveResult | null;
}

/**
 * Plan a save that merges: the base and the head are read, and the project's
 * changes since the base are set against theirs. Throws, in plain words, when
 * the project has syntax errors (the merge needs every element in its place).
 */
export async function planMergeSave(
	api: SysmlApi,
	engine: Engine,
	projectId: string,
	base: string,
	head: string,
	files: SourceFile[],
	onProgress?: (what: string) => void
): Promise<MergeSave> {
	const count = (n: number) => n.toLocaleString('en');
	onProgress?.('Reading the version you started from…');
	const baseElements = await api.elements(projectId, base, (n) =>
		onProgress?.(`Reading the version you started from… ${count(n)} elements`)
	);
	onProgress?.('Reading the latest version…');
	const headElements = await api.elements(projectId, head, (n) =>
		onProgress?.(`Reading the latest version… ${count(n)} elements`)
	);
	onProgress?.('Comparing the changes…');
	const inputs = await engine.mergeInputs(files, baseElements, headElements);
	if (inputs.broken.length)
		throw new Error(
			`Fix the syntax errors in ${inputs.broken.join(', ')} first: merging needs every element in its place.`
		);
	const plan = planMerge(inputs.base, inputs.ours, inputs.theirs, {
		nameOf: (id) => inputs.names[id] || undefined
	});
	const preview = plan.incoming.length
		? await engine.weaveInterchange(files, resolveMerge(plan))
		: null;
	return { base, head, plan, headElements, preview };
}

/** The project's files with their changes in, as `choices` decide the conflicts. */
export function weaveMerge(
	engine: Engine,
	save: MergeSave,
	files: SourceFile[],
	choices: Record<string, Side>
): Promise<WeaveResult> {
	return engine.weaveInterchange(files, resolveMerge(save.plan, choices));
}

/** What a save that merged did, for the dialog to say. */
export interface MergeOutcome {
	/** What came in, in words. */
	incoming: string[];
	/** What went out, in words. */
	outgoing: string[];
	/** The project's files as the merge changed them. */
	woven: WeaveResult | null;
	/** The new commit's description and how many element changes it holds (null: none was needed). */
	commit: { description: string; changes: number } | null;
	server: string;
	branch: string;
}
