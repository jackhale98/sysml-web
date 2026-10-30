/**
 * Baselines: tag names and messages, reading tags back, which baseline the
 * model is at, and marking and removing them, kept in this browser or as
 * tags on GitHub (a fake of the GitHub calls).
 */
import { describe, expect, it } from 'vitest';
import type { Comparison, GitProvider, GitRecord, TagInput, TagSummary } from '#lib/git/types.ts';
import { ProjectBaselines, SAVE_FIRST, SIGN_IN_FIRST } from './baselines.svelte.ts';
import {
	baselineStamp,
	baselineStatus,
	fromStored,
	fromTag,
	inputProblem,
	longDay,
	sortBaselines,
	tagMessage,
	tagName,
	type Baseline,
	type StoredBaseline
} from './baselines.ts';

const BASE = 'b'.repeat(40);
const OLDER = 'a'.repeat(40);
const ELSEWHERE = 'e'.repeat(40);

describe('baseline tags', () => {
	it('names the tag after the baseline, in what git allows', () => {
		expect(tagName('PDR')).toBe('baseline/PDR');
		expect(tagName('  PDR 2 ')).toBe('baseline/PDR-2');
		expect(tagName('CDR: final/approved?')).toBe('baseline/CDR-final-approved');
		expect(tagName('..odd..name.')).toBe('baseline/odd.name');
		expect(tagName('x.lock')).toBe('baseline/x-lock');
		expect(tagName('~^')).toBe('baseline/baseline');
	});

	it('reads its own message back: name, description and date', () => {
		const message = tagMessage({
			name: 'PDR',
			date: '2026-03-12',
			description: 'As presented.\nActions closed.'
		});
		expect(message).toBe('PDR\n\nAs presented.\nActions closed.\n\nBaseline-date: 2026-03-12\n');
		const tag: TagSummary = {
			name: 'baseline/PDR',
			commit: OLDER,
			message,
			date: '2026-03-13T08:00:00Z',
			tagger: 'Ada'
		};
		expect(fromTag(tag)).toEqual({
			key: 'tag:baseline/PDR',
			name: 'PDR',
			date: '2026-03-12',
			description: 'As presented.\nActions closed.',
			where: 'github',
			tag: 'baseline/PDR',
			commit: OLDER,
			at: '2026-03-13T08:00:00Z'
		});
	});

	it('reads a tag made with git itself: its name from the tag, its date the day it was tagged', () => {
		const plain = fromTag({
			name: 'baseline/SRR',
			commit: OLDER,
			message: '',
			date: '2026-01-05T17:00:00Z',
			tagger: null
		});
		expect(plain).toMatchObject({ name: 'SRR', date: '2026-01-05', description: '' });
		const bare = fromTag({
			name: 'baseline/SRR',
			commit: OLDER,
			message: '',
			date: null,
			tagger: null
		});
		expect(bare.date).toBeNull();
	});
});

const browser = (name: string, date: string, files: Record<string, string>): Baseline =>
	fromStored({
		name,
		date,
		at: `${date}T12:00:00Z`,
		files: Object.entries(files).map(([path, text]) => ({ path, text }))
	});

const tagged = (name: string, date: string, commit: string): Baseline =>
	fromTag({
		name: tagName(name),
		commit,
		message: tagMessage({ name, date }),
		date: `${date}T12:00:00Z`,
		tagger: null
	});

describe('the list of baselines', () => {
	it('is newest first, by the day each stands for', () => {
		const list = sortBaselines([
			browser('SRR', '2026-01-05', {}),
			tagged('CDR', '2026-06-01', BASE),
			browser('PDR', '2026-03-12', {})
		]);
		expect(list.map((b) => b.name)).toEqual(['CDR', 'PDR', 'SRR']);
	});

	it('refuses a name already used (ignoring case, or making the same tag), an empty one, or no date', () => {
		const existing = [tagged('PDR 2', '2026-03-12', BASE), browser('SRR', '2026-01-05', {})];
		expect(inputProblem({ name: 'CDR', date: '2026-06-01' }, existing)).toBeNull();
		expect(inputProblem({ name: ' srr ', date: '2026-06-01' }, existing)).toMatch(
			/already a baseline named “srr”/
		);
		expect(inputProblem({ name: 'PDR:2', date: '2026-06-01' }, existing)).toMatch(/already/);
		expect(inputProblem({ name: '  ', date: '2026-06-01' }, existing)).toMatch(/Give the baseline/);
		expect(inputProblem({ name: 'CDR', date: '' }, existing)).toMatch(/Choose the date/);
		expect(inputProblem({ name: 'x'.repeat(61), date: '2026-06-01' }, existing)).toMatch(/60/);
	});

	it('writes days out in full', () => {
		expect(longDay('2026-03-12')).toBe('12 March 2026');
		expect(longDay(null)).toBe('');
	});
});

describe('which baseline the model is at', () => {
	const files = { 'model/Drone.sysml': 'package Drone;\n', 'layout.json': '{}' };
	const none = () => null;

	it('is a browser baseline whose model files are the same, word for word (layout aside)', () => {
		const pdr = browser('PDR', '2026-03-12', { ...files, 'layout.json': '{"moved":1}' });
		const now = { files, commit: null, uncommitted: false, contains: none };
		expect(baselineStatus([pdr], now)).toEqual({ baseline: pdr, exact: true });
		expect(baselineStamp(baselineStatus([pdr], now))).toBe('Baseline: PDR');
		const changed = { ...now, files: { ...files, 'model/Drone.sysml': 'package Drone2;\n' } };
		expect(baselineStatus([pdr], changed)).toEqual({ baseline: pdr, exact: false });
		expect(baselineStamp(baselineStatus([pdr], changed))).toBe('Changed since baseline PDR');
		// A model file added since is a change too.
		expect(
			baselineStatus([pdr], { ...now, files: { ...files, 'model/New.sysml': 'package New;' } })
				?.exact
		).toBe(false);
		expect(baselineStamp(baselineStatus([], now))).toBeNull();
	});

	it('is the latest it was at once it has changed', () => {
		const srr = browser('SRR', '2026-01-05', { 'model/Drone.sysml': 'old' });
		const pdr = browser('PDR', '2026-03-12', { 'model/Drone.sysml': 'less old' });
		const status = baselineStatus([srr, pdr], {
			files,
			commit: null,
			uncommitted: false,
			contains: none
		});
		expect(status).toEqual({ baseline: pdr, exact: false });
	});

	it('is a tag on the commit the project is at, unless the model changed since', () => {
		const cdr = tagged('CDR', '2026-06-01', BASE);
		const at = { files, commit: BASE, uncommitted: false, contains: none };
		expect(baselineStatus([cdr], at)).toEqual({ baseline: cdr, exact: true });
		// Changed since that commit: it was at it (its own commit), and has changed.
		const contains = (c: string) => c === BASE;
		expect(baselineStatus([cdr], { ...at, uncommitted: true, contains })).toEqual({
			baseline: cdr,
			exact: false
		});
	});

	it('was at a tag in its commit’s history, not one on another line of work or not known yet', () => {
		const pdr = tagged('PDR', '2026-03-12', OLDER);
		const other = tagged('Trial', '2026-04-01', ELSEWHERE);
		const contains = (c: string) => (c === OLDER ? true : c === ELSEWHERE ? false : null);
		const now = { files, commit: BASE, uncommitted: false, contains };
		expect(baselineStatus([pdr, other], now)).toEqual({ baseline: pdr, exact: false });
		expect(baselineStatus([pdr], { ...now, contains: none })).toBeNull();
	});
});

/** A repository's tags and history, with the GitHub calls baselines make. */
function fakeGitHub(tags: TagSummary[] = []) {
	const calls: string[] = [];
	const provider = {
		async listTags(_: unknown, prefix: string) {
			calls.push(`list ${prefix}`);
			return tags.filter((t) => t.name.startsWith(prefix));
		},
		async createTag(_: unknown, input: TagInput) {
			calls.push(`create ${input.name} on ${input.commit.slice(0, 1)}`);
			const tag: TagSummary = {
				name: input.name,
				commit: input.commit,
				message: input.message,
				date: '2026-10-30T10:00:00Z',
				tagger: 'Ada'
			};
			tags.push(tag);
			return tag;
		},
		async deleteTag(_: unknown, name: string) {
			calls.push(`delete ${name}`);
			tags.splice(
				tags.findIndex((t) => t.name === name),
				1
			);
		},
		async compare(_: unknown, base: string): Promise<Comparison> {
			calls.push(`compare ${base.slice(0, 1)}`);
			return base === OLDER
				? { ahead: 3, behind: 0, status: 'ahead' }
				: { ahead: 2, behind: 4, status: 'diverged' };
		}
	} as unknown as GitProvider;
	return { provider, calls, tags };
}

const record: GitRecord = {
	provider: 'github',
	owner: 'acme',
	repo: 'drone',
	branch: 'main',
	defaultBranch: 'main',
	base: BASE,
	baseTree: 't',
	files: {},
	syncedAt: ''
};

/** A project's baselines, with what the session would give them. */
function project(
	options: {
		git?: GitRecord | null;
		provider?: GitProvider | null;
		uncommitted?: boolean;
		files?: Record<string, string>;
		stored?: StoredBaseline[];
	} = {}
) {
	let stored = options.stored ?? [];
	const files = options.files ?? { 'model/Drone.sysml': 'package Drone;\n' };
	const baselines = new ProjectBaselines({
		stored: () => stored,
		store: async (list) => void (stored = list),
		files: () => files,
		git: () => options.git ?? null,
		provider: () => options.provider ?? null,
		uncommitted: () => options.uncommitted ?? false,
		now: () => '2026-10-30T09:00:00Z'
	});
	return { baselines, stored: () => stored, files };
}

describe('marking and removing baselines', () => {
	it('keeps a frozen copy of the files in a project kept in this browser', async () => {
		const { baselines, stored, files } = project();
		const made = await baselines.mark({ name: ' PDR ', date: '2026-03-12', description: ' ' });
		expect(stored()).toEqual([
			{
				name: 'PDR',
				date: '2026-03-12',
				at: '2026-10-30T09:00:00Z',
				files: [{ path: 'model/Drone.sysml', text: 'package Drone;\n' }]
			}
		]);
		expect(made.where).toBe('browser');
		// The copy is frozen: changing the project later doesn't change it.
		files['model/Drone.sysml'] = 'package Changed;\n';
		expect(stored()[0]!.files[0]!.text).toBe('package Drone;\n');
		await expect(baselines.mark({ name: 'pdr', date: '2026-03-12' })).rejects.toThrow(/already/);
		await baselines.remove(baselines.list[0]!);
		expect(stored()).toEqual([]);
	});

	it('tags the commit the project is based on, on GitHub', async () => {
		const github = fakeGitHub();
		const { baselines } = project({ git: record, provider: github.provider });
		const made = await baselines.mark({
			name: 'CDR',
			date: '2026-06-01',
			description: 'Signed off.'
		});
		expect(github.calls).toEqual(['list baseline/', 'create baseline/CDR on b']);
		expect(github.tags[0]!.message).toBe('CDR\n\nSigned off.\n\nBaseline-date: 2026-06-01\n');
		expect(made).toMatchObject({ name: 'CDR', where: 'github', commit: BASE });
		expect(baselines.list.map((b) => b.name)).toEqual(['CDR']);
		expect(baselines.status).toMatchObject({ exact: true, baseline: { name: 'CDR' } });

		await baselines.remove(baselines.list[0]!);
		expect(github.calls.at(-1)).toBe('delete baseline/CDR');
		expect(baselines.list).toEqual([]);
	});

	it('refuses to tag when the changes aren’t on GitHub yet, or the account isn’t signed in', async () => {
		const github = fakeGitHub();
		const unsaved = project({ git: record, provider: github.provider, uncommitted: true });
		await expect(unsaved.baselines.mark({ name: 'CDR', date: '2026-06-01' })).rejects.toThrow(
			SAVE_FIRST
		);
		const signedOut = project({ git: record, provider: null });
		await expect(signedOut.baselines.mark({ name: 'CDR', date: '2026-06-01' })).rejects.toThrow(
			SIGN_IN_FIRST
		);
		expect(github.calls).toEqual([]);
	});

	it('reads the tags again before tagging, so one made meanwhile by someone else isn’t doubled', async () => {
		const github = fakeGitHub();
		const { baselines } = project({ git: record, provider: github.provider });
		github.tags.push({
			name: 'baseline/CDR',
			commit: OLDER,
			message: tagMessage({ name: 'CDR', date: '2026-06-01' }),
			date: null,
			tagger: null
		});
		await expect(baselines.mark({ name: 'CDR', date: '2026-06-02' })).rejects.toThrow(/already/);
		expect(github.calls).toEqual(['list baseline/']);
	});

	it('lists the repository’s baselines and asks GitHub once which are in the project’s history', async () => {
		const github = fakeGitHub([
			{
				name: 'baseline/PDR',
				commit: OLDER,
				message: tagMessage({ name: 'PDR', date: '2026-03-12' }),
				date: null,
				tagger: null
			},
			{
				name: 'baseline/Trial',
				commit: ELSEWHERE,
				message: tagMessage({ name: 'Trial', date: '2026-04-01' }),
				date: null,
				tagger: null
			}
		]);
		const { baselines } = project({ git: record, provider: github.provider });
		await baselines.load();
		expect(baselines.list.map((b) => b.name)).toEqual(['Trial', 'PDR']);
		expect(baselines.status).toBeNull();
		await new Promise((r) => setTimeout(r));
		expect(baselines.status).toMatchObject({ exact: false, baseline: { name: 'PDR' } });
		expect(github.calls.filter((c) => c.startsWith('compare')).sort()).toEqual([
			'compare a',
			'compare e'
		]);
	});

	it('keeps baselines marked before the project was connected to GitHub beside its tags', async () => {
		const github = fakeGitHub();
		const stored: StoredBaseline[] = [
			{ name: 'SRR', date: '2026-01-05', at: '2026-01-05T10:00:00Z', files: [] }
		];
		const { baselines } = project({ git: record, provider: github.provider, stored });
		await baselines.mark({ name: 'PDR', date: '2026-03-12' });
		expect(baselines.list.map((b) => [b.name, b.where])).toEqual([
			['PDR', 'github'],
			['SRR', 'browser']
		]);
	});
});
