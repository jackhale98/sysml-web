import { describe, expect, it } from 'vitest';
import {
	applyPull,
	baseAfterCommit,
	branchName,
	fileChanges,
	localChanges,
	planPull,
	remoteChanged,
	trackedEntries,
	type BaseFiles
} from './sync.ts';
import { defaultMessage } from './connection.svelte.ts';

const base: BaseFiles = {
	'model/A.sysml': { sha: 'a1', text: 'part def A;\npart def A2;\npart def A3;\n' },
	'model/B.sysml': { sha: 'b1', text: 'part def B;\n' },
	'model/C.sysml': { sha: 'c1', text: 'part def C;\n' },
	'README.md': { sha: 'r1', text: '# Hi\n' }
};
const texts = (files: BaseFiles) =>
	Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.text]));

describe('local changes', () => {
	it('lists added, modified and deleted files and ignores untracked ones', () => {
		const local = texts(base);
		local['model/A.sysml'] = 'part def A;\n';
		delete local['model/C.sysml'];
		local['model/New.sysml'] = 'part def N;\n';
		local['.project.json'] = '{}';
		local['notes.txt'] = 'x';
		expect(localChanges(base, local).map((c) => [c.path, c.status])).toEqual([
			['model/A.sysml', 'modified'],
			['model/C.sysml', 'deleted'],
			['model/New.sysml', 'added']
		]);
	});

	it('moves the base forward after a commit', () => {
		const local: Record<string, string> = {
			...texts(base),
			'model/B.sysml': 'part def B2;\n',
			'x.sysml': 'x'
		};
		delete local['README.md'];
		const changes = fileChanges(localChanges(base, local));
		const next = baseAfterCommit(base, changes, { 'model/B.sysml': 'b2', 'x.sysml': 'x1' });
		expect(next['model/B.sysml']).toEqual({ sha: 'b2', text: 'part def B2;\n' });
		expect(next['x.sysml']).toEqual({ sha: 'x1', text: 'x' });
		expect(next['README.md']).toBeUndefined();
		expect(localChanges(next, local)).toEqual([]);
	});

	it('names commits and branches sensibly', () => {
		expect(defaultMessage([{ path: 'm/A.sysml', status: 'modified', before: '', after: '' }])).toBe(
			'Update A.sysml'
		);
		expect(branchName('  Add cargo hook / Täst!! ')).toBe('add-cargo-hook/tast');
		expect(branchName('feature//x..y')).toBe('feature/x.y');
	});
});

describe('pull planning', () => {
	const remoteShas = {
		'model/A.sysml': 'a2', // changed there
		'model/B.sysml': 'b2', // changed there and here
		// model/C.sysml deleted there
		'README.md': 'r1',
		'model/D.sysml': 'd1', // added there
		'docs/ignored.png': 'img'
	};
	const remoteTexts = {
		'model/A.sysml': 'part def A;\npart def A2;\npart def A3-theirs;\n',
		'model/B.sysml': 'part def B-theirs;\n',
		'model/D.sysml': 'part def D;\n'
	};

	it('downloads only what changed there', () => {
		const remote = trackedEntries(Object.entries(remoteShas).map(([path, sha]) => ({ path, sha })));
		expect(remote['docs/ignored.png']).toBeUndefined();
		expect(remoteChanged(base, remote)).toEqual([
			'model/A.sysml',
			'model/B.sysml',
			'model/D.sysml'
		]);
	});

	it('takes remote-only changes and reports both-sides changes as conflicts', () => {
		const remote = trackedEntries(Object.entries(remoteShas).map(([path, sha]) => ({ path, sha })));
		const local = { ...texts(base), 'model/B.sysml': 'part def B-mine;\n' };
		const plan = planPull(base, local, remote, remoteTexts);
		expect(plan.updates).toEqual({
			'model/A.sysml': remoteTexts['model/A.sysml'],
			'model/C.sysml': null,
			'model/D.sysml': 'part def D;\n'
		});
		expect(plan.conflicts).toEqual([
			{
				path: 'model/B.sysml',
				base: 'part def B;\n',
				mine: 'part def B-mine;\n',
				theirs: 'part def B-theirs;\n',
				merged: null
			}
		]);
		expect(Object.keys(plan.base).sort()).toEqual([
			'README.md',
			'model/A.sysml',
			'model/B.sysml',
			'model/D.sysml'
		]);

		// Nothing is overwritten silently: by default the person's version is kept.
		const kept = applyPull(local, plan);
		expect(kept['model/B.sysml']).toBe('part def B-mine;\n');
		expect(kept['model/C.sysml']).toBeUndefined();
		expect(kept['model/D.sysml']).toBe('part def D;\n');
		expect(applyPull(local, plan, { 'model/B.sysml': 'theirs' })['model/B.sysml']).toBe(
			'part def B-theirs;\n'
		);
		// After taking theirs, nothing differs from the new base.
		expect(localChanges(plan.base, applyPull(local, plan, { 'model/B.sysml': 'theirs' }))).toEqual(
			[]
		);
	});

	it('offers a combined version when the changes touch different lines', () => {
		const remote = {
			...trackedEntries([]),
			'model/A.sysml': 'a2',
			'model/B.sysml': 'b1',
			'model/C.sysml': 'c1',
			'README.md': 'r1'
		};
		const local = {
			...texts(base),
			'model/A.sysml': 'part def A-mine;\npart def A2;\npart def A3;\n'
		};
		const plan = planPull(base, local, remote, { 'model/A.sysml': remoteTexts['model/A.sysml'] });
		expect(plan.conflicts).toHaveLength(1);
		expect(plan.conflicts[0]!.merged).toBe('part def A-mine;\npart def A2;\npart def A3-theirs;\n');
		expect(applyPull(local, plan, { 'model/A.sysml': 'merged' })['model/A.sysml']).toBe(
			plan.conflicts[0]!.merged
		);
	});

	it('treats the same change on both sides, and a delete of an untouched file, as no conflict', () => {
		const remote = { 'model/A.sysml': 'a1', 'model/B.sysml': 'b2', 'README.md': 'r1' };
		const local = { ...texts(base), 'model/B.sysml': 'part def B-theirs;\n' };
		const plan = planPull(base, local, remote, { 'model/B.sysml': 'part def B-theirs;\n' });
		expect(plan.conflicts).toEqual([]);
		expect(plan.updates).toEqual({ 'model/C.sysml': null });
	});

	it('flags a file deleted here but changed there', () => {
		const remote = {
			...Object.fromEntries(Object.entries(base).map(([p, f]) => [p, f.sha])),
			'model/C.sysml': 'c2'
		};
		const local = texts(base);
		delete local['model/C.sysml'];
		const plan = planPull(base, local, remote, { 'model/C.sysml': 'part def C2;\n' });
		expect(plan.conflicts).toMatchObject([
			{ path: 'model/C.sysml', mine: null, theirs: 'part def C2;\n' }
		]);
	});
});
