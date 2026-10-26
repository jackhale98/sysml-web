/**
 * The project's version, as recorded verification results and reports name
 * it: the commit its files are based on when it is connected to GitHub, and
 * whether the model changed since (recorded results aside, so recording a
 * result doesn't make it, or another, out of date).
 *
 * A result run against another commit holds when the model there is the same
 * as at this one: found out once per commit by reading that commit's files
 * from GitHub (`sameModelAt`), and remembered while the page is open.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { GitProvider, GitRecord, RepoRef } from '#lib/git/types.ts';
import {
	isComparedFile,
	sameCommit,
	sameModel,
	shortCommit,
	type RevisionInfo
} from './verification';

export interface RevisionSource {
	/** The project's link to its repository, when it has one. */
	git(): GitRecord | null;
	/** The project's files now. */
	files(): Record<string, string>;
	/** The GitHub API as the project's account, when it is signed in here. */
	provider(): GitProvider | null;
	/** The signed-in person's GitHub login, to say who recorded a result. */
	login(): string | null;
}

export class ProjectRevision implements RevisionInfo {
	/** What is known of other commits: the same model as the base (true), changed (false). */
	private readonly known = new SvelteMap<string, boolean>();
	/** Commits being found out (bookkeeping, not state). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private readonly asked = new Set<string>();

	constructor(private readonly source: RevisionSource) {}

	get commit(): string | null {
		return this.source.git()?.base ?? null;
	}

	/** `owner/repo` and branch, when connected. */
	get repository(): string | null {
		const git = this.source.git();
		return git ? `${git.owner}/${git.repo}` : null;
	}

	get branch(): string | null {
		return this.source.git()?.branch ?? null;
	}

	get login(): string | null {
		return this.source.login();
	}

	/** The model changed since the base commit (recorded results aside). */
	changed: boolean = $derived.by(() => {
		const git = this.source.git();
		if (!git) return false;
		const base = Object.fromEntries(Object.entries(git.files).map(([p, f]) => [p, f.text]));
		return !sameModel(base, this.source.files());
	});

	/** Model files changed since the base commit at all (a recorded result or a comment counts too). */
	get uncommitted(): boolean {
		const git = this.source.git();
		if (!git) return false;
		const files = this.source.files();
		const paths = [...Object.keys(git.files), ...Object.keys(files)].filter((p) =>
			/\.(sysml|kerml)$/.test(p)
		);
		return paths.some((p) => git.files[p]?.text !== files[p]);
	}

	sameModel(commit: string): boolean | null {
		const base = this.commit;
		if (!base) return null;
		if (sameCommit(commit, base)) return true;
		const key = `${base} ${commit}`;
		const known = this.known.get(key);
		if (known !== undefined) return known;
		if (!this.asked.has(key)) {
			this.asked.add(key);
			const git = this.source.git();
			const provider = this.source.provider();
			if (git && provider)
				void sameModelAt(provider, { owner: git.owner, repo: git.repo }, commit, git.files)
					.then((same) => this.known.set(key, same))
					.catch(() => this.asked.delete(key));
		}
		return null;
	}

	/** How a report names the version it was made from. */
	get stamp(): string {
		return revisionStamp({
			commit: this.commit,
			repository: this.repository,
			branch: this.branch,
			changed: this.uncommitted
		});
	}
}

/**
 * Whether the model at `commit` is the model at the base (`base`, the
 * project's files at its base commit), recorded results aside: the files
 * whose blobs differ are read and compared.
 */
export async function sameModelAt(
	provider: GitProvider,
	ref: RepoRef,
	commit: string,
	base: GitRecord['files']
): Promise<boolean> {
	const tree = await provider.readTree(ref, commit);
	const there = Object.fromEntries(
		tree.entries.filter((e) => isComparedFile(e.path)).map((e) => [e.path, e])
	);
	const paths = [...Object.keys(there), ...Object.keys(base).filter(isComparedFile)];
	const differ = paths.filter((p, i) => paths.indexOf(p) === i && there[p]?.sha !== base[p]?.sha);
	// A model file added or removed (the results library is not the model).
	if (differ.some((p) => !there[p] || !base[p])) return false;
	const texts = await provider.readFiles(
		ref,
		differ.map((p) => there[p]!)
	);
	const before = Object.fromEntries(differ.map((p) => [p, texts[p]]));
	const now = Object.fromEntries(differ.map((p) => [p, base[p]!.text]));
	return sameModel(before, now);
}

/** What a revision says about itself, for a report or an export. */
export interface RevisionStamp {
	commit: string | null;
	repository?: string | null;
	branch?: string | null;
	/** The model changed since that commit. */
	changed: boolean;
}

/**
 * `Commit 3f2a9c1 of owner/repo (main)`, `Commit 3f2a9c1 of owner/repo (main),
 * with changes not committed`, or `Not committed`.
 */
export function revisionStamp(revision: RevisionStamp | null): string {
	if (!revision?.commit) return 'Not committed';
	const where = revision.repository
		? ` of ${revision.repository}${revision.branch ? ` (${revision.branch})` : ''}`
		: '';
	const at = `Commit ${shortCommit(revision.commit)}${where}`;
	return revision.changed ? `${at}, with changes not committed` : at;
}
