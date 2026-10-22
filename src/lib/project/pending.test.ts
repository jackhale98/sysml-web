import { describe, expect, it } from 'vitest';
import type { GitRecord } from '#lib/git/types.ts';
import {
	changesNotInFolder,
	changesNotOnGitHub,
	leaveRisk,
	pendingLabel,
	strandedBySignOut
} from './pending.ts';

const git = (files: Record<string, string>, account?: string): GitRecord => ({
	provider: 'github',
	owner: 'acme',
	repo: 'drone',
	branch: 'main',
	defaultBranch: 'main',
	base: 'c1',
	baseTree: 't1',
	files: Object.fromEntries(
		Object.entries(files).map(([path, text]) => [path, { sha: path, text }])
	),
	syncedAt: '2026-10-22',
	...(account ? { account } : {})
});

const files = (map: Record<string, string>) =>
	Object.entries(map).map(([path, text]) => ({ path, text }));

describe('changes not on GitHub', () => {
	const base = { 'model/a.sysml': 'part a;', 'model/b.sysml': 'part b;', 'README.md': '# Drone' };

	it('is nothing when the files are as on GitHub, or the project has no repository', () => {
		expect(changesNotOnGitHub({ files: files(base), git: git(base) })).toBe(0);
		expect(changesNotOnGitHub({ files: files({ 'x.sysml': 'part x;' }) })).toBe(0);
	});

	it('counts files changed, added and deleted here', () => {
		const local = {
			'model/a.sysml': 'part a { attribute m; }',
			'model/c.sysml': 'part c;',
			'README.md': '# Drone'
		};
		expect(changesNotOnGitHub({ files: files(local), git: git(base) })).toBe(3);
	});

	it("ignores files GitHub doesn't keep in sync, like the project's info", () => {
		const local = { ...base, '.project.json': '{"name":"Drone"}', 'notes.txt': 'hi' };
		expect(changesNotOnGitHub({ files: files(local), git: git(base) })).toBe(0);
	});
});

describe('changes not in the folder', () => {
	it('counts only folder projects', () => {
		expect(changesNotInFolder({ origin: 'folder', unsavedToFolder: ['a', 'b'] })).toBe(2);
		expect(changesNotInFolder({ origin: 'folder' })).toBe(0);
		expect(changesNotInFolder({ origin: 'new', unsavedToFolder: ['a'] })).toBe(0);
	});
});

describe('the badge', () => {
	it('says what is pending in plain words', () => {
		expect(pendingLabel({ notOnGitHub: 3, notInFolder: 0 })).toBe('3 changes not on GitHub');
		expect(pendingLabel({ notOnGitHub: 1, notInFolder: 0 })).toBe('1 change not on GitHub');
		expect(pendingLabel({ notOnGitHub: 0, notInFolder: 1 })).toBe(
			'1 change not saved to the folder'
		);
		expect(pendingLabel({ notOnGitHub: 0, notInFolder: 0 })).toBeNull();
	});
});

describe('before leaving the open project', () => {
	const github = { owner: 'acme', repo: 'drone', branch: 'main', changes: 2 };

	it('asks about changes not on GitHub', () => {
		expect(leaveRisk({ saveFailed: false, github })).toEqual({
			kind: 'github',
			count: 2,
			repo: 'acme/drone',
			branch: 'main'
		});
	});

	it('asks about changes not in the folder', () => {
		expect(leaveRisk({ saveFailed: false, github: null, folder: 4 })).toEqual({
			kind: 'folder',
			count: 4
		});
	});

	it('says nothing for a project kept only in this browser, or one that is all saved', () => {
		expect(leaveRisk({ saveFailed: false })).toBeNull();
		expect(
			leaveRisk({ saveFailed: false, github: { ...github, changes: 0 }, folder: 0 })
		).toBeNull();
	});

	it('puts a failed save in this browser first', () => {
		expect(leaveRisk({ saveFailed: true, github })).toEqual({ kind: 'not-saved' });
	});
});

describe('signing out', () => {
	const project = (id: string, notOnGitHub: number, account?: string, connected = true) => ({
		id,
		notOnGitHub,
		...(connected ? { git: git({}, account) } : {})
	});
	const all = [
		project('mine', 2, 'octo'),
		project('saved', 0, 'octo'),
		project('theirs', 5, 'team-bot'),
		project('older', 1),
		project('local', 3, undefined, false)
	];

	it('lists the projects with changes that account would save', () => {
		expect(strandedBySignOut(all, 'OCTO', false).map((p) => p.id)).toEqual(['mine']);
		expect(strandedBySignOut(all, 'team-bot', false).map((p) => p.id)).toEqual(['theirs']);
	});

	it("includes projects that don't say which account they use when it is the default", () => {
		expect(strandedBySignOut(all, 'octo', true).map((p) => p.id)).toEqual(['mine', 'older']);
	});
});
