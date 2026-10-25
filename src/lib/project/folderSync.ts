/**
 * Saving a folder project back to its folder without overwriting what
 * changed there meanwhile (another editor, a git pull, a synced drive), as
 * plain functions over file maps (so they are easy to test):
 *
 * - *known*: the folder's text of each file as last read or written here;
 * - *local*: the files now, in this browser;
 * - *disk*: the folder's files now, read just before saving.
 *
 * A file changed only here is written; one changed only in the folder is
 * brought into the project; one changed on both sides, differently, waits
 * for the person to choose (as "Get latest" does with GitHub).
 */
import { merge3 } from '#lib/git/diff.ts';
import type { Conflict, Resolution } from '#lib/git/sync.ts';

/** The project's info: written only when the folder has none, never compared. */
const INFO = '.project.json';

export interface FolderPlan {
	/** Files to write into the folder: changed or added here, not there. */
	write: Record<string, string>;
	/** Files to take out of the folder: deleted here, unchanged there. */
	remove: string[];
	/** Files changed only in the folder: brought into the project as they are there (null: deleted there). */
	updates: Record<string, string | null>;
	/** Files changed both here and in the folder, differently (`theirs`: the folder's). */
	conflicts: Conflict[];
	/** Files already the same here and in the folder (null: in neither). */
	same: Record<string, string | null>;
}

/**
 * What saving to the folder would do. `unknown` are files whose text in the
 * folder was never kept (from before it was): they are taken as unchanged there.
 */
export function planFolderSave(
	known: Record<string, string>,
	local: Record<string, string>,
	disk: Record<string, string>,
	unknown: Iterable<string> = []
): FolderPlan {
	const plan: FolderPlan = { write: {}, remove: [], updates: {}, conflicts: [], same: {} };
	const unsure = new Set(unknown);
	const paths = new Set([...Object.keys(known), ...Object.keys(local), ...Object.keys(disk)]);
	paths.delete(INFO);
	for (const path of [...paths].sort()) {
		const theirs = path in disk ? disk[path]! : null;
		const was = unsure.has(path) ? theirs : path in known ? known[path]! : null;
		const mine = path in local ? local[path]! : null;
		if (mine === theirs) plan.same[path] = theirs;
		else if (theirs === was) {
			if (mine === null) plan.remove.push(path);
			else plan.write[path] = mine;
		} else if (mine === was) plan.updates[path] = theirs;
		else
			plan.conflicts.push({
				path,
				base: was,
				mine,
				theirs,
				merged: was !== null && mine !== null && theirs !== null ? merge3(was, mine, theirs) : null
			});
	}
	return plan;
}

/** Whether two plans ask about the same files, with the same texts on both sides. */
export function sameConflicts(a: FolderPlan, b: FolderPlan): boolean {
	return (
		a.conflicts.length === b.conflicts.length &&
		a.conflicts.every((c, i) => {
			const d = b.conflicts[i]!;
			return c.path === d.path && c.mine === d.mine && c.theirs === d.theirs;
		})
	);
}

export interface FolderSave {
	/** Into the folder. */
	write: Record<string, string>;
	/** Out of the folder. */
	remove: string[];
	/** Into the project, from the folder or combined (null: out of the project). */
	take: Record<string, string | null>;
}

/**
 * The plan with each conflict settled as chosen: keep mine (write it, or
 * take the file out of the folder), take the folder's, or combine both
 * (into the folder and the project). A conflict not chosen is left as it
 * is on both sides.
 */
export function settleFolderSave(
	plan: FolderPlan,
	choices: Record<string, Resolution> = {}
): FolderSave {
	const save: FolderSave = {
		write: { ...plan.write },
		remove: [...plan.remove],
		take: { ...plan.updates }
	};
	for (const conflict of plan.conflicts) {
		const choice = choices[conflict.path];
		if (choice === 'mine') {
			if (conflict.mine === null) save.remove.push(conflict.path);
			else save.write[conflict.path] = conflict.mine;
		} else if (choice === 'theirs') save.take[conflict.path] = conflict.theirs;
		else if (choice === 'merged' && conflict.merged !== null) {
			save.write[conflict.path] = conflict.merged;
			save.take[conflict.path] = conflict.merged;
		}
	}
	return save;
}
