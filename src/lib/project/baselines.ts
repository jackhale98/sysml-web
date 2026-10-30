/**
 * Baselines: a version of the model frozen under a name at a design review
 * (SRR, PDR, CDR, …), that later versions are judged against. A project
 * connected to GitHub keeps them as annotated git tags (`baseline/PDR`), so
 * the whole team sees them; a project kept only in this browser, or opened
 * from a folder, keeps a frozen copy of its files with the project here.
 *
 * This module is the part without state: tag names and messages, reading a
 * tag back as a baseline, the order of the list, and which baseline the
 * model is at (or was last at).
 */
import type { TagSummary } from '#lib/git/types.ts';
import { sameCommit } from './verification.ts';

/** Where a project connected to GitHub keeps its baselines: tags named `baseline/…`. */
export const TAG_PREFIX = 'baseline/';

/** The trailer of a baseline tag's message that holds the review's date. */
const DATE_TRAILER = /^Baseline-date:\s*(\d{4}-\d{2}-\d{2})\s*$/i;

const MAX_NAME = 60;

/** A file, as the project keeps it. */
interface File {
	path: string;
	text: string;
}

/** A baseline kept with the project in this browser: the files as they were when it was marked. */
export interface StoredBaseline {
	name: string;
	/** The day it stands for (the review's), `2026-03-12`. */
	date: string;
	description?: string;
	/** When it was marked (ISO 8601). */
	at: string;
	/** Every project file, as it was. */
	files: File[];
}

/** A baseline as the list shows it, wherever it is kept. */
export interface Baseline {
	/** Unique in the list: `tag:baseline/PDR`, `browser:PDR`. */
	key: string;
	name: string;
	/** The day it stands for, `2026-03-12`; null when the tag doesn't say. */
	date: string | null;
	description: string;
	/** A tag on GitHub, or a copy kept in this browser. */
	where: 'github' | 'browser';
	/** On GitHub: the tag's name (`baseline/PDR`) and the commit it names. */
	tag?: string;
	commit?: string;
	/** In this browser: the files as they were. */
	files?: File[];
	/** When it was marked, when known (orders baselines of the same day). */
	at: string | null;
}

/** What the person types to mark a baseline. */
export interface BaselineInput {
	name: string;
	date: string;
	description?: string;
}

/** Which baseline the model is at, or was last at and has changed since. */
export interface BaselineStatus {
	baseline: Baseline;
	/** The model is exactly the baseline (not changed since). */
	exact: boolean;
}

/** Today, `2026-10-30`, in the person's time zone. */
export function today(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The tag for a baseline's name: `PDR` → `baseline/PDR`, `PDR 2` →
 * `baseline/PDR-2`. What git doesn't allow in a tag name (spaces, `~^:?*[\`,
 * `..`, a slash, a leading or trailing dot or dash) becomes a dash or goes.
 */
export function tagName(name: string): string {
	const slug = name
		.trim()
		// eslint-disable-next-line no-control-regex -- control characters aren't allowed in git names
		.replace(/[\s~^:?*[\]\\/\x00-\x1f\x7f]+/g, '-')
		.replace(/\.{2,}/g, '.')
		.replace(/@\{/g, '@-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.replace(/\.lock$/i, '-lock');
	return TAG_PREFIX + (slug || 'baseline');
}

/** The tag's message: the name, the description, and the date as a trailer git tools keep. */
export function tagMessage(input: BaselineInput): string {
	const description = input.description?.trim();
	return (
		[input.name.trim(), description, `Baseline-date: ${input.date}`].filter(Boolean).join('\n\n') +
		'\n'
	);
}

/**
 * A `baseline/…` tag read back: its message's first line is the name (else
 * the tag's own), the trailer the date (else the day it was tagged), and
 * what lies between the description. Tags made with git itself read too.
 */
export function fromTag(tag: TagSummary): Baseline {
	const lines = tag.message.replace(/\r/g, '').trim().split('\n');
	let date: string | null = null;
	const last = lines.length - 1;
	const trailer = DATE_TRAILER.exec(lines[last] ?? '');
	if (trailer) {
		date = trailer[1]!;
		lines.splice(last, 1);
	}
	const name = lines.shift()?.trim() || tag.name.slice(TAG_PREFIX.length) || tag.name;
	return {
		key: `tag:${tag.name}`,
		name,
		date: date ?? (tag.date ? tag.date.slice(0, 10) : null),
		description: lines.join('\n').trim(),
		where: 'github',
		tag: tag.name,
		commit: tag.commit,
		at: tag.date
	};
}

/** A baseline kept in this browser, as the list shows it. */
export function fromStored(stored: StoredBaseline): Baseline {
	return {
		key: `browser:${stored.name}`,
		name: stored.name,
		date: stored.date,
		description: stored.description ?? '',
		where: 'browser',
		files: stored.files,
		at: stored.at
	};
}

/** Newest first: by the day each stands for, then by when it was marked. */
export function sortBaselines(list: Baseline[]): Baseline[] {
	return [...list].sort(
		(a, b) =>
			(b.date ?? '').localeCompare(a.date ?? '') ||
			(b.at ?? '').localeCompare(a.at ?? '') ||
			a.name.localeCompare(b.name)
	);
}

/**
 * Why a baseline can't be marked with this input, in words for the form;
 * null when it can. Names are unique, ignoring case, and so are the tags
 * they make.
 */
export function inputProblem(input: BaselineInput, existing: Baseline[]): string | null {
	const name = input.name.trim();
	if (!name) return 'Give the baseline a name, such as PDR.';
	if (name.length > MAX_NAME) return `Keep the name to ${MAX_NAME} characters or fewer.`;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date)))
		return 'Choose the date it stands for.';
	const lower = name.toLowerCase();
	const tag = tagName(name).toLowerCase();
	if (
		existing.some((b) => b.name.toLowerCase() === lower || (b.tag && b.tag.toLowerCase() === tag))
	)
		return `There is already a baseline named “${name}”. Choose another name, or remove that one first.`;
	return null;
}

const isModel = (path: string) => path.endsWith('.sysml') || path.endsWith('.kerml');

/** Whether two sets of files hold the same model files, word for word. */
export function sameModelFiles(a: File[], b: Record<string, string>): boolean {
	const before = new Map(a.filter((f) => isModel(f.path)).map((f) => [f.path, f.text]));
	const after = Object.keys(b).filter(isModel);
	return after.length === before.size && after.every((path) => before.get(path) === b[path]);
}

/** The project as it is now, for `baselineStatus`. */
export interface ModelNow {
	files: Record<string, string>;
	/** The commit its files are based on (connected to GitHub). */
	commit: string | null;
	/** Model files changed since that commit. */
	uncommitted: boolean;
	/** Whether a commit is in the history of `commit`: true, false, or null while unknown. */
	contains(commit: string): boolean | null;
}

/**
 * Which baseline the model is at, else the latest it was at. It is at a
 * baseline kept here when its model files are word for word the same, and
 * at a tag when its files are those of the tagged commit. It was at every
 * baseline kept here (they were marked on this project) and at every tag in
 * its commit's history. Null when there is none.
 */
export function baselineStatus(list: Baseline[], now: ModelNow): BaselineStatus | null {
	const sorted = sortBaselines(list);
	const exact = sorted.find((b) =>
		b.where === 'browser'
			? sameModelFiles(b.files ?? [], now.files)
			: !!b.commit && !!now.commit && !now.uncommitted && sameCommit(b.commit, now.commit)
	);
	if (exact) return { baseline: exact, exact: true };
	const last = sorted.find((b) =>
		b.where === 'browser' ? true : !!b.commit && now.contains(b.commit) === true
	);
	return last ? { baseline: last, exact: false } : null;
}

/** How a report names it: `Baseline: CDR`, or `Changed since baseline CDR`. */
export function baselineStamp(status: BaselineStatus | null): string | null {
	if (!status) return null;
	return status.exact
		? `Baseline: ${status.baseline.name}`
		: `Changed since baseline ${status.baseline.name}`;
}

/** `12 March 2026`, from `2026-03-12`. */
export function longDay(date: string | null): string {
	if (!date) return '';
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
