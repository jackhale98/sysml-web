/**
 * Saving a project to a Systems Modeling API server: the elements at the
 * branch's head are read, the project's elements take the server's ids
 * wherever they sit in the same place (`rebaseIds`), and only what differs
 * is sent, as one commit.
 *
 * After the commit, the branch is read back and set against what was sent
 * (`push`): whatever the server didn't keep is said, rather than "Saved".
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
import {
	changeSet,
	isRef,
	keyLabel,
	nameOf,
	ownerOf,
	ownershipKeys,
	rebaseIds,
	withIds,
	type ChangeSet,
	type ElementJson
} from './elements';
import { planMerge, resolveMerge, type MergePlan, type Side } from './merge';
import type { WeaveResult } from './types';

export interface PushPlan {
	/** The commit the change is made against (null: the branch is empty). */
	head: string | null;
	changes: ChangeSet;
	/** Elements of ours that matched one of the server's. */
	matched: number;
	/** The server's elements at `head`. */
	base: ElementJson[];
	/** Ours under the server's ids: the model the server should hold after the commit. */
	sent: ElementJson[];
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
	const { elements: rebased, matched } = rebaseIds(ours, elements, undefined, PLACES);
	const sent = withoutUnservedRoots(rebased, elements);
	return { head, changes: changeSet(elements, sent), matched, base: elements, sent };
}

/** Matching across tools: files (root namespaces) don't matter, nor whether a server serves them. */
const PLACES = { transparentRoots: true };

/**
 * `ours` (under the server's ids) for a server that doesn't serve root
 * namespaces (SysON: its top-level elements' owners are not among its
 * elements): our root namespaces and their memberships are left out, as the
 * server keeps its own, and what they owned refers to the server's owners.
 */
function withoutUnservedRoots(ours: ElementJson[], theirs: readonly ElementJson[]): ElementJson[] {
	const served = new Set(theirs.map((e) => e['@id']));
	const orphans = theirs.filter((e) => {
		const owner = ownerOf(e);
		return !!owner && !served.has(owner);
	});
	if (!orphans.length || theirs.some((e) => !ownerOf(e))) return ours;
	const byId = new Map(ours.map((e) => [e['@id'], e]));
	const hidden = new Set<string>();
	for (const e of ours) {
		if (ownerOf(e)) continue;
		hidden.add(e['@id']);
		for (const r of Array.isArray(e.ownedRelationship) ? e.ownedRelationship : [])
			if (isRef(r)) hidden.add(r['@id']);
	}
	const owners = new Map<string, string>();
	for (const s of orphans) {
		const o = byId.get(s['@id']);
		const ourOwner = o && ownerOf(o);
		if (ourOwner && hidden.has(ourOwner)) owners.set(ourOwner, ownerOf(s)!);
	}
	return ours.filter((e) => !hidden.has(e['@id'])).map((e) => withIds(e, owners));
}

export const changeCount = (changes: ChangeSet): number =>
	changes.created.length + changes.updated.length + changes.deleted.length;

/** A save the server answered but didn't keep in full: what is missing, in words. */
export class SaveNotKept extends Error {
	override name = 'SaveNotKept';
	constructor(
		message: string,
		/** The branch's head after the commit: what the server holds now. */
		readonly head: string | null,
		/** The changes the server doesn't have. */
		readonly missing: ChangeSet
	) {
		super(message);
	}
}

/**
 * Send a planned change as one commit, then read the branch back: every
 * change must be there. Throws `SaveNotKept`, naming what the server
 * didn't keep, when it isn't (a server may answer "saved" and drop
 * elements, as SysON does with new ones).
 */
export async function push(
	api: SysmlApi,
	projectId: string,
	branch: ApiBranch | null,
	plan: PushPlan,
	description: string
): Promise<ApiCommit> {
	const { created, updated, deleted } = plan.changes;
	// A server that drops new elements (SysON) must not get removals in the same commit:
	// an element moved elsewhere would be gone from both places. Removals go second, once
	// the new elements are seen kept.
	if (api.minimalPayloads && created.length && deleted.length) {
		const first = { ...plan, changes: { created, updated, deleted: [] } };
		await commitKept(
			api,
			projectId,
			branch,
			first,
			description,
			' Nothing was removed from the server.'
		);
		return commitKept(api, projectId, branch, plan, description, '');
	}
	return commitKept(api, projectId, branch, plan, description, '');
}

/** One commit of `plan`'s changes, then the branch read back: throws `SaveNotKept` when they aren't all there. */
async function commitKept(
	api: SysmlApi,
	projectId: string,
	branch: ApiBranch | null,
	plan: PushPlan,
	description: string,
	more: string
): Promise<ApiCommit> {
	const made = await api.commit(
		projectId,
		branch?.id ?? null,
		dataVersions(plan.changes, api.minimalPayloads ? plan.base : undefined),
		description
	);
	// Where the branch is now: its head (some servers answer with a commit id they don't serve).
	const after = branch
		? (await api.branches(projectId)).find((b) => b.id === branch.id)?.head
		: undefined;
	const head = after ?? made?.id ?? null;
	const back = head ? await api.elements(projectId, head) : [];
	const missing = notKept(plan, back);
	const count = missing.created.length + missing.updated.length + missing.deleted.length;
	if (count) throw new SaveNotKept(notKeptMessage(api.host, plan, missing) + more, head, missing);
	return made ?? { id: head ?? '', description, created: null, previous: [] };
}

/** The changes of `plan` that the server's elements `back` don't have. */
export function notKept(plan: PushPlan, back: ElementJson[]): ChangeSet {
	const { elements: again } = rebaseIds(plan.sent, back, undefined, PLACES);
	// `again` is `plan.sent` in order, under the ids the server has now.
	const sentId = new Map(again.map((e, i) => [e['@id'], plan.sent[i]!['@id']]));
	const ours = new Set([...plan.changes.created, ...plan.changes.updated].map((e) => e['@id']));
	const now = changeSet(back, again);
	const there = new Set(back.map((e) => e['@id']));
	return {
		created: now.created.filter((e) => ours.has(sentId.get(e['@id']) ?? '')),
		updated: now.updated.filter((e) => ours.has(sentId.get(e['@id']) ?? '')),
		deleted: plan.changes.deleted.filter((id) => there.has(id))
	};
}

/** What the server didn't keep, in words: counts and the first few names. */
function notKeptMessage(host: string, plan: PushPlan, missing: ChangeSet): string {
	const keys = ownershipKeys(plan.sent);
	const baseKeys = ownershipKeys(plan.base);
	const label = (e: ElementJson | undefined, keyed: Map<string, string>) =>
		e ? (nameOf(e) ?? keyLabel(keyed.get(e['@id']) ?? e['@type'])) : '?';
	const sentById = new Map(plan.sent.map((e) => [e['@id'], e]));
	const baseById = new Map(plan.base.map((e) => [e['@id'], e]));
	const names = (labels: string[]) => {
		const unique = [...new Set(labels)];
		return unique.length > 5
			? `${unique.slice(0, 5).join(', ')} and ${unique.length - 5} more`
			: unique.join(', ');
	};
	const part = (n: number, of: number, noun: string, what: string, labels: string[]) =>
		`${n === of ? (n === 1 ? `the ${noun}` : `all ${n} ${noun}s`) : `${n} of ${of} ${noun}${of === 1 ? '' : 's'}`} ${what} (${names(labels)})`;
	const parts: string[] = [];
	if (missing.created.length)
		parts.push(
			part(
				missing.created.length,
				plan.changes.created.length,
				'new element',
				missing.created.length === 1 ? 'is missing' : 'are missing',
				missing.created.map((e) => label(sentById.get(e['@id']) ?? e, keys))
			)
		);
	if (missing.updated.length)
		parts.push(
			part(
				missing.updated.length,
				plan.changes.updated.length,
				'changed element',
				missing.updated.length === 1 ? 'is not as sent' : 'are not as sent',
				missing.updated.map((e) => label(e, keys))
			)
		);
	if (missing.deleted.length)
		parts.push(
			part(
				missing.deleted.length,
				plan.changes.deleted.length,
				'removed element',
				missing.deleted.length === 1 ? 'is still there' : 'are still there',
				missing.deleted.map((id) => label(baseById.get(id), baseKeys))
			)
		);
	return `${host} didn’t keep all of this save. Read back from the server, ${parts.join('; ')}. Your project here still has all of it.`;
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
