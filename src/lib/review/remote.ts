/**
 * Model files of other versions on GitHub, for a review: a commit's files
 * (downloading only the blobs not already known), the version a branch
 * started from, and a pull request's two sides.
 */
import { isModelFile } from '#lib/project/workspace.svelte.ts';
import type {
	GitProvider,
	GitRecord,
	Progress,
	PullRequestSummary,
	RepoRef
} from '#lib/git/types.ts';

/** Blob texts by SHA: the same file in two versions is downloaded once. */
const blobs = new Map<string, string>();

/** Remember the texts of the project's base version (no need to download them). */
export function knowBlobs(files: GitRecord['files']) {
	for (const { sha, text } of Object.values(files)) blobs.set(sha, text);
}

/** The model files of a commit, path → text. */
export async function modelFilesAt(
	provider: GitProvider,
	ref: RepoRef,
	commit: string,
	progress?: Progress
): Promise<Record<string, string>> {
	const tree = await provider.readTree(ref, commit);
	const entries = tree.entries.filter((e) => isModelFile(e.path));
	const missing = entries.filter((e) => !blobs.has(e.sha));
	const texts = missing.length ? await provider.readFiles(ref, missing, progress) : {};
	for (const e of missing) if (texts[e.path] !== undefined) blobs.set(e.sha, texts[e.path]!);
	return Object.fromEntries(entries.map((e) => [e.path, blobs.get(e.sha) ?? texts[e.path] ?? '']));
}

/** A pull request's two sides: where its branch parted from the target, and its latest commit. */
export async function pullRequestFiles(
	provider: GitProvider,
	ref: RepoRef,
	pr: PullRequestSummary,
	progress?: Progress
): Promise<{ base: Record<string, string>; head: Record<string, string>; baseCommit: string }> {
	const baseCommit = await provider.mergeBase(ref, pr.base.sha, pr.head.sha);
	const base = await modelFilesAt(provider, ref, baseCommit, progress);
	const head = await modelFilesAt(provider, ref, pr.head.sha, progress);
	return { base, head, baseCommit };
}
