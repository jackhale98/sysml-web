/**
 * Review mode: which two versions are compared, the engine's comparison of
 * them (`compareModels`), and keeping it up to date while the person goes
 * on editing. One review at a time (the workbench shows one project).
 *
 * What can be compared:
 * - **Your changes** (`local`): the project now against the last version
 *   saved to or got from GitHub; for a project only in this browser, the
 *   version marked as reviewed, else the folder's files, the demo as it
 *   comes, or the files as they were when the project was opened.
 * - **This branch** (`branch`): the project now against where its branch
 *   started from the repository's main branch.
 * - **An earlier version** (`commit`): against a commit of the branch.
 * - **A proposal** (`pull`): a pull request's latest commit against where
 *   its branch started from the branch it would be merged into.
 */
import { untrack } from 'svelte';
import type { Engine } from '#lib/engine/client.ts';
import { accounts } from '#lib/git/account.svelte.ts';
import { messageOf } from '#lib/git/errors.ts';
import type { CommitSummary, GitRecord, PullRequestSummary } from '#lib/git/types.ts';
import type { ProjectSession } from '#lib/project/session.svelte.ts';
import { isModelFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import { reviewMarks } from './marks.svelte.ts';
import { knowBlobs, modelFilesAt, pullRequestFiles } from './remote.ts';
import { summarize, type ReviewSummary } from './summary.ts';
import type { ModelComparison } from './types.ts';

export type ReviewSource =
	| { kind: 'local' }
	| { kind: 'branch' }
	| { kind: 'commit'; commit: CommitSummary }
	| { kind: 'pull'; pr: PullRequestSummary };

export interface ReviewContext {
	workspace: Workspace;
	session?: ProjectSession;
	engine: Engine;
}

/** How long to wait after an edit before comparing again. */
const REFRESH_MS = 500;

const short = (sha: string) => sha.slice(0, 7);

class Review {
	source = $state.raw<ReviewSource>({ kind: 'local' });
	status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	error = $state<string | null>(null);
	/** Downloading another version's files. */
	progress = $state<{ done: number; total: number } | null>(null);
	/** What the project is compared with, in words: `the version on GitHub (a1b2c3d)`. */
	against = $state('');
	/** What is compared with it: `your version`, `proposal #9 “Heavier motors”`. */
	subject = $state('your version');
	baseFiles = $state.raw<Record<string, string>>({});
	/** The compared version when it isn't the open project (a proposal); null: the project, live. */
	currentFiles = $state.raw<Record<string, string> | null>(null);
	comparison = $state.raw<ModelComparison | null>(null);
	summary: ReviewSummary | null = $derived(
		this.comparison ? summarize(this.comparison.diff) : null
	);
	/** The base is a version the person can move to now ("Mark as reviewed"). */
	canMarkReviewed = $state(false);

	private ctx: ReviewContext | null = null;
	private generation = 0;
	private stopWatching: (() => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		reviewMarks.onEnd = () => this.end();
	}

	/** The repository the project is connected to, if any. */
	git(ctx = this.ctx): GitRecord | null {
		return ctx?.session?.record?.git ?? null;
	}

	/** A file's text on the new side (the project's, or the proposal's). */
	currentText(path: string): string | undefined {
		return this.currentFiles ? this.currentFiles[path] : this.ctx?.workspace.files[path];
	}

	/** Start (or switch) the review: fetch the versions and compare them. */
	async start(ctx: ReviewContext, source: ReviewSource = this.source): Promise<void> {
		this.ctx = ctx;
		this.source = source;
		const generation = ++this.generation;
		this.stopWatching?.();
		this.stopWatching = null;
		this.status = 'loading';
		this.error = null;
		this.progress = null;
		try {
			const versions = await this.versions(ctx, source);
			if (generation !== this.generation) return;
			this.baseFiles = versions.base;
			this.currentFiles = versions.current;
			this.against = versions.against;
			this.subject = versions.subject;
			this.canMarkReviewed = versions.canMarkReviewed;
			this.progress = null;
			await this.compare(generation);
			if (generation === this.generation && !this.currentFiles) this.watch(ctx);
		} catch (error) {
			if (generation !== this.generation) return;
			this.status = 'error';
			this.error = messageOf(error);
			this.progress = null;
		}
	}

	/** Compare again (after an edit, or when the person asks). */
	async refresh(): Promise<void> {
		if (!this.ctx || this.status === 'idle') return;
		await this.compare(this.generation);
	}

	/** Make the project as it is now the version later changes are compared with. */
	async markReviewed(): Promise<void> {
		const ctx = this.ctx;
		if (!ctx?.session || !this.canMarkReviewed) return;
		await ctx.session.markReviewed();
		await this.start(ctx, { kind: 'local' });
	}

	/** Leave review mode: no more marks, no more comparing. */
	end() {
		this.generation++;
		this.stopWatching?.();
		this.stopWatching = null;
		clearTimeout(this.timer);
		this.comparison = null;
		this.status = 'idle';
		this.error = null;
		if (reviewMarks.active) reviewMarks.clear();
	}

	private async versions(
		ctx: ReviewContext,
		source: ReviewSource
	): Promise<{
		base: Record<string, string>;
		current: Record<string, string> | null;
		against: string;
		subject: string;
		canMarkReviewed: boolean;
	}> {
		const git = this.git(ctx);
		const progress = (done: number, total: number) => (this.progress = { done, total });
		if (source.kind === 'local') {
			if (git) {
				knowBlobs(git.files);
				return {
					base: modelTexts(Object.entries(git.files).map(([path, f]) => ({ path, text: f.text }))),
					current: null,
					against: `the version on GitHub (${short(git.base)})`,
					subject: 'your version',
					canMarkReviewed: false
				};
			}
			const base = ctx.session?.reviewBase() ?? {
				files: ctx.workspace.sourceFiles(),
				label: 'the version you opened',
				checkpoint: false
			};
			return {
				base: modelTexts(base.files),
				current: null,
				against: base.label,
				subject: 'your version',
				canMarkReviewed: !!ctx.session
			};
		}
		if (!git) throw new Error('This project isn’t connected to a GitHub repository.');
		knowBlobs(git.files);
		const provider = accounts.provider(git.account);
		const ref = { owner: git.owner, repo: git.repo };
		if (source.kind === 'branch') {
			const start = await provider.mergeBase(ref, git.defaultBranch, git.base);
			return {
				base: await modelFilesAt(provider, ref, start, progress),
				current: null,
				against: `${git.defaultBranch}, where “${git.branch}” started (${short(start)})`,
				subject: 'this branch',
				canMarkReviewed: false
			};
		}
		if (source.kind === 'commit')
			return {
				base: await modelFilesAt(provider, ref, source.commit.sha, progress),
				current: null,
				against: `the version “${source.commit.title}” (${short(source.commit.sha)})`,
				subject: 'your version',
				canMarkReviewed: false
			};
		const { base, head, baseCommit } = await pullRequestFiles(provider, ref, source.pr, progress);
		return {
			base,
			current: head,
			against: `${source.pr.base.ref} (${short(baseCommit)})`,
			subject: `proposal #${source.pr.number} “${source.pr.title}”`,
			canMarkReviewed: false
		};
	}

	private async compare(generation: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const current = this.currentFiles ? toList(this.currentFiles) : ctx.workspace.sourceFiles();
		const base = toList(this.baseFiles);
		const comparison = await ctx.engine.compareModels(base, current);
		if (generation !== this.generation) return;
		// Edited meanwhile: compare again once the edit is analysed.
		if (!this.currentFiles && current.some((f) => ctx.workspace.files[f.path] !== f.text)) {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => void this.refresh(), REFRESH_MS);
			return;
		}
		this.comparison = comparison;
		this.status = 'ready';
		performance.mark('sysml:review', { detail: comparison.ms });
		reviewMarks.set(comparison.diff, this.against);
	}

	/**
	 * Compare again shortly after each analysis of the project, and start
	 * over when the version compared with moves (saved to or got from
	 * GitHub, marked as reviewed).
	 */
	private watch(ctx: ReviewContext) {
		const baseKey = () => {
			const record = ctx.session?.record;
			return `${record?.git?.base ?? ''}|${record?.checkpoint?.at ?? ''}`;
		};
		const startedWith = untrack(baseKey);
		this.stopWatching = $effect.root(() => {
			let first = true;
			$effect(() => {
				void ctx.workspace.analyses;
				if (first) {
					first = false;
					return;
				}
				untrack(() => {
					clearTimeout(this.timer);
					this.timer = setTimeout(() => void this.refresh(), REFRESH_MS);
				});
			});
			$effect(() => {
				if (baseKey() !== startedWith && this.source.kind === 'local')
					untrack(() => void this.start(ctx, this.source));
			});
		});
	}
}

function modelTexts(files: { path: string; text: string }[]): Record<string, string> {
	return Object.fromEntries(files.filter((f) => isModelFile(f.path)).map((f) => [f.path, f.text]));
}

function toList(files: Record<string, string>): { path: string; text: string }[] {
	return Object.keys(files)
		.filter(isModelFile)
		.sort()
		.map((path) => ({ path, text: files[path]! }));
}

export const review = new Review();
