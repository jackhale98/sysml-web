/**
 * The open project's baselines: those kept with it in this browser, and,
 * when it is connected to GitHub, the `baseline/…` tags of its repository
 * (listed once the account is signed in here). Marking one tags the commit
 * the project is based on, or keeps a frozen copy of the files here; removing
 * one deletes the tag, or the copy. `status` says which baseline the model
 * is at, or was last at (for reports).
 */
import { SvelteMap } from 'svelte/reactivity';
import { messageOf } from '#lib/git/errors.ts';
import type { GitProvider, GitRecord } from '#lib/git/types.ts';
import {
	baselineStatus,
	fromStored,
	fromTag,
	inputProblem,
	sortBaselines,
	tagMessage,
	tagName,
	TAG_PREFIX,
	type Baseline,
	type BaselineInput,
	type BaselineStatus,
	type StoredBaseline
} from './baselines.ts';
import { sameCommit } from './verification.ts';

export interface BaselineSource {
	/** Baselines kept with the project in this browser. */
	stored(): StoredBaseline[];
	/** Keep these instead (saved with the project). */
	store(list: StoredBaseline[]): Promise<void>;
	/** The project's files now. */
	files(): Record<string, string>;
	/** The project's link to its repository, when it has one. */
	git(): GitRecord | null;
	/** The GitHub API as the project's account, when it is signed in here. */
	provider(): GitProvider | null;
	/** Model files changed since the commit the project is based on. */
	uncommitted(): boolean;
	/** The current time (ISO 8601). */
	now(): string;
}

/** Said when a project connected to GitHub has changes not saved there yet. */
export const SAVE_FIRST =
	'Save your changes to GitHub first: a baseline is a version on GitHub, and yours has changes that aren’t there yet.';

/** Said when the project's GitHub account isn't signed in here. */
export const SIGN_IN_FIRST =
	'Connect to GitHub first: this project keeps its baselines there, as tags.';

export class ProjectBaselines {
	/** The repository's baselines (its `baseline/…` tags); null until listed. */
	tags = $state.raw<Baseline[] | null>(null);
	/** Listing them, or marking or removing one. */
	busy = $state(false);
	/** Why the tags couldn't be listed. */
	error = $state<string | null>(null);
	/** The repository `tags` are from (`owner/repo`). */
	private tagsOf = $state<string | null>(null);

	/** Whether a commit is in the history of the project's base: `base commit` → known. */
	private readonly contained = new SvelteMap<string, boolean>();
	/** Bookkeeping, not state: what was asked of GitHub already. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private readonly asked = new Set<string>();
	/** The repository whose tags were listed (or are being). */
	private listed: string | null = null;

	constructor(private readonly source: BaselineSource) {}

	/** Every baseline, newest first. */
	list: Baseline[] = $derived.by(() => {
		this.autoload();
		return sortBaselines([
			...this.source.stored().map(fromStored),
			...(this.tagsOf === this.repository() ? (this.tags ?? []) : [])
		]);
	});

	/** Which baseline the model is at, else the latest it was at (null: none). */
	status: BaselineStatus | null = $derived.by(() => {
		const git = this.source.git();
		return baselineStatus(this.list, {
			files: this.source.files(),
			commit: git?.base ?? null,
			uncommitted: this.source.uncommitted(),
			contains: (commit) => this.contains(commit)
		});
	});

	/** Connected to GitHub with model changes not saved there: no baseline can be marked yet. */
	get unsaved(): boolean {
		return !!this.source.git() && this.source.uncommitted();
	}

	/** `owner/repo` of the connected repository. */
	private repository(): string | null {
		const git = this.source.git();
		return git ? `${git.owner}/${git.repo}` : null;
	}

	/** List the repository's tags once, when it can be reached (from a derivation: later). */
	private autoload() {
		const repository = this.repository();
		if (!repository || this.listed === repository || !this.source.provider()) return;
		this.listed = repository;
		queueMicrotask(() => void this.load());
	}

	/** List the repository's baselines (again). Failures are kept in `error`. */
	async load(): Promise<void> {
		const git = this.source.git();
		const provider = this.source.provider();
		if (!git || !provider) {
			this.tags = null;
			return;
		}
		this.listed = `${git.owner}/${git.repo}`;
		this.busy = true;
		this.error = null;
		try {
			const tags = await provider.listTags({ owner: git.owner, repo: git.repo }, TAG_PREFIX);
			this.tags = tags.map(fromTag);
			this.tagsOf = `${git.owner}/${git.repo}`;
		} catch (error) {
			this.error = messageOf(error);
		} finally {
			this.busy = false;
		}
	}

	/** Whether `commit` is in the history of the base commit: asked of GitHub once, then known. */
	private contains(commit: string): boolean | null {
		const git = this.source.git();
		if (!git) return null;
		if (sameCommit(commit, git.base)) return true;
		const key = `${git.base} ${commit}`;
		const known = this.contained.get(key);
		if (known !== undefined) return known;
		const provider = this.source.provider();
		if (provider && !this.asked.has(key)) {
			this.asked.add(key);
			void provider
				.compare({ owner: git.owner, repo: git.repo }, commit, git.base)
				.then((c) => this.contained.set(key, c.status === 'ahead' || c.status === 'identical'))
				.catch(() => this.asked.delete(key));
		}
		return null;
	}

	/**
	 * Mark the project as it is now as a baseline. Connected to GitHub: an
	 * annotated tag on the commit the project is based on (its changes must
	 * be saved there first). Otherwise: a frozen copy of its files, kept with
	 * the project in this browser.
	 */
	async mark(input: BaselineInput): Promise<Baseline> {
		const git = this.source.git();
		const clean = {
			name: input.name.trim(),
			date: input.date,
			description: input.description?.trim() || undefined
		};
		if (!git) {
			const problem = inputProblem(clean, this.list);
			if (problem) throw new Error(problem);
			const stored: StoredBaseline = {
				...clean,
				at: this.source.now(),
				files: Object.entries(this.source.files()).map(([path, text]) => ({ path, text }))
			};
			await this.source.store([...this.source.stored(), stored]);
			return fromStored(stored);
		}
		const provider = this.source.provider();
		if (!provider) throw new Error(SIGN_IN_FIRST);
		if (this.unsaved) throw new Error(SAVE_FIRST);
		this.busy = true;
		try {
			// Someone may have marked one since the list was read: read it again first.
			const ref = { owner: git.owner, repo: git.repo };
			const tags = (await provider.listTags(ref, TAG_PREFIX)).map(fromTag);
			this.tags = tags;
			this.tagsOf = this.listed = `${git.owner}/${git.repo}`;
			const problem = inputProblem(clean, this.list);
			if (problem) throw new Error(problem);
			const tag = await provider.createTag(ref, {
				name: tagName(clean.name),
				message: tagMessage(clean),
				commit: git.base
			});
			const made = fromTag(tag);
			this.tags = [...tags, made];
			return made;
		} finally {
			this.busy = false;
		}
	}

	/** Remove a baseline: its tag from the repository, or its copy from this browser. */
	async remove(baseline: Baseline): Promise<void> {
		if (baseline.where === 'browser') {
			await this.source.store(this.source.stored().filter((b) => b.name !== baseline.name));
			return;
		}
		const git = this.source.git();
		const provider = this.source.provider();
		if (!git || !baseline.tag) return;
		if (!provider) throw new Error(SIGN_IN_FIRST);
		this.busy = true;
		try {
			await provider.deleteTag({ owner: git.owner, repo: git.repo }, baseline.tag);
			this.tags = (this.tags ?? []).filter((b) => b.key !== baseline.key);
		} finally {
			this.busy = false;
		}
	}
}
