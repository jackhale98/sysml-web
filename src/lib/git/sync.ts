/**
 * What changed, and how to bring in what changed elsewhere, as plain
 * functions over file maps (so they are easy to test).
 *
 * - *base*: the project files at the commit the project is based on;
 * - *local*: the files now, in this browser;
 * - *remote*: the files at the branch's latest commit on the host.
 */
import { isProjectFile } from '#lib/project/sources.ts';
import { merge3 } from './diff.ts';
import type { FileChange, GitRecord, TreeEntry } from './types.ts';

export type BaseFiles = GitRecord['files'];

/** Files kept in sync with the repository: models and documents (`.project.json` is the project's info). */
export function isTrackedFile(path: string): boolean {
	return isProjectFile(path) && !/(^|\/)\.project\.json$/.test(path);
}

export type ChangeStatus = 'added' | 'modified' | 'deleted';

export interface LocalChange {
	path: string;
	status: ChangeStatus;
	/** Text at the base (null when added). */
	before: string | null;
	/** Text now (null when deleted). */
	after: string | null;
}

/** Files added, modified or deleted since the base, by path. */
export function localChanges(base: BaseFiles, local: Record<string, string>): LocalChange[] {
	const out: LocalChange[] = [];
	for (const [path, text] of Object.entries(local)) {
		if (!isTrackedFile(path)) continue;
		const was = base[path];
		if (!was) out.push({ path, status: 'added', before: null, after: text });
		else if (was.text !== text)
			out.push({ path, status: 'modified', before: was.text, after: text });
	}
	for (const [path, was] of Object.entries(base))
		if (!(path in local)) out.push({ path, status: 'deleted', before: was.text, after: null });
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The changes to commit. */
export function fileChanges(changes: LocalChange[]): FileChange[] {
	return changes.map((c) => ({ path: c.path, text: c.after }));
}

/** The base after a commit of `changes`, with the new blob SHAs. */
export function baseAfterCommit(
	base: BaseFiles,
	changes: FileChange[],
	blobs: Record<string, string>
): BaseFiles {
	const next = { ...base };
	for (const change of changes) {
		if (change.text === null) delete next[change.path];
		else next[change.path] = { sha: blobs[change.path]!, text: change.text };
	}
	return next;
}

/** The tracked files in a remote tree: path → blob SHA. */
export function trackedEntries(entries: TreeEntry[]): Record<string, string> {
	return Object.fromEntries(
		entries.filter((e) => isTrackedFile(e.path)).map((e) => [e.path, e.sha])
	);
}

/** Remote files whose content differs from the base (and so must be downloaded). */
export function remoteChanged(base: BaseFiles, remote: Record<string, string>): string[] {
	return Object.keys(remote)
		.filter((path) => base[path]?.sha !== remote[path])
		.sort();
}

export interface Conflict {
	path: string;
	base: string | null;
	/** This browser's version (null: deleted here). */
	mine: string | null;
	/** The host's version (null: deleted there). */
	theirs: string | null;
	/** Both sets of changes combined, when they touch different lines. */
	merged: string | null;
}

export type Resolution = 'mine' | 'theirs' | 'merged';

export interface PullPlan {
	/** Files that only changed remotely: taken as they are there (null: deleted there). */
	updates: Record<string, string | null>;
	/** Files changed both here and there, differently. */
	conflicts: Conflict[];
	/** The new base: every tracked remote file. */
	base: BaseFiles;
}

/**
 * How to bring in the remote changes. `remoteTexts` holds the text of every
 * file in `remoteChanged(base, remote)`.
 */
export function planPull(
	base: BaseFiles,
	local: Record<string, string>,
	remote: Record<string, string>,
	remoteTexts: Record<string, string>
): PullPlan {
	const nextBase: BaseFiles = {};
	for (const [path, sha] of Object.entries(remote)) {
		const text = base[path]?.sha === sha ? base[path]!.text : remoteTexts[path];
		if (text === undefined) throw new Error(`Missing the latest text of ${path}.`);
		nextBase[path] = { sha, text };
	}
	const updates: Record<string, string | null> = {};
	const conflicts: Conflict[] = [];
	const paths = new Set([...Object.keys(base), ...Object.keys(remote)]);
	for (const path of [...paths].sort()) {
		const was = base[path]?.text ?? null;
		const theirs = nextBase[path]?.text ?? null;
		if (base[path]?.sha === remote[path]) continue; // Unchanged there.
		const mine = path in local ? local[path]! : null;
		if (mine === was) {
			updates[path] = theirs;
			continue;
		}
		if (mine === theirs) continue; // The same change on both sides.
		const merged =
			was !== null && mine !== null && theirs !== null ? merge3(was, mine, theirs) : null;
		conflicts.push({ path, base: was, mine, theirs, merged });
	}
	return { updates, conflicts, base: nextBase };
}

/** The local files after a pull, with each conflict resolved as chosen (default: keep mine). */
export function applyPull(
	local: Record<string, string>,
	plan: PullPlan,
	choices: Record<string, Resolution> = {}
): Record<string, string> {
	const files = { ...local };
	const put = (path: string, text: string | null) => {
		if (text === null) delete files[path];
		else files[path] = text;
	};
	for (const [path, text] of Object.entries(plan.updates)) put(path, text);
	for (const conflict of plan.conflicts) {
		const choice = choices[conflict.path] ?? 'mine';
		if (choice === 'theirs') put(conflict.path, conflict.theirs);
		else if (choice === 'merged' && conflict.merged !== null) put(conflict.path, conflict.merged);
		else put(conflict.path, conflict.mine);
	}
	return files;
}

/** A branch name from free text: lower-case words joined by dashes. */
export function branchName(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9/._-]+/g, '-')
		.replace(/-*\/[-/]*/g, '/')
		.replace(/^[-./]+|[-./]+$/g, '')
		.replace(/\.{2,}/g, '.')
		.slice(0, 60);
}
