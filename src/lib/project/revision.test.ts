import { describe, expect, it } from 'vitest';
import type { GitProvider, GitRecord, RemoteTree, TreeEntry } from '#lib/git/types.ts';
import { ProjectRevision, revisionStamp, sameModelAt } from './revision.svelte';
import { freshness, type RecordedResult } from './verification';

const BASE = 'b'.repeat(40);
const EARLIER = 'a'.repeat(40);
const model = 'package V {\n    verification vc {\n    }\n}\n';
const withResult = `package V {
    private import VerificationResults::VerificationResult;
    verification vc {
        @VerificationResult { verdict = VerdictKind::pass; date = "2026-10-20"; commit = "${EARLIER}"; }
    }
}
`;

const git = (files: Record<string, string>): GitRecord => ({
	provider: 'github',
	owner: 'acme',
	repo: 'drone',
	branch: 'main',
	defaultBranch: 'main',
	base: BASE,
	baseTree: 't',
	files: Object.fromEntries(
		Object.entries(files).map(([path, text]) => [path, { sha: `sha:${text.length}:${path}`, text }])
	),
	syncedAt: ''
});

/** A host with one earlier commit, `files` its texts; counts what it was asked. */
function provider(files: Record<string, string>) {
	const asked: string[] = [];
	const entries: TreeEntry[] = Object.entries(files).map(([path, text]) => ({
		path,
		sha: `sha:${text.length}:${path}`
	}));
	const host = {
		readTree: async (_: unknown, commit: string): Promise<RemoteTree> => {
			asked.push(`tree ${commit.slice(0, 1)}`);
			return { commit, tree: 't', truncated: false, entries };
		},
		readFiles: async (_: unknown, wanted: TreeEntry[]) => {
			asked.push(...wanted.map((e) => `file ${e.path}`));
			return Object.fromEntries(wanted.map((e) => [e.path, files[e.path]!]));
		}
	} as unknown as GitProvider;
	return { host, asked };
}

const result = (commit: string | null): RecordedResult => ({
	caseId: 'vc',
	caseName: 'vc',
	verdict: 'pass',
	date: '2026-10-20',
	runBy: null,
	commit,
	evidence: null,
	file: 'v.sysml',
	span: { start_row: 1, start_col: 1, end_row: 1, end_col: 1, start_byte: 0, end_byte: 0 }
});

describe('the model at another commit', () => {
	it('is the same when only recorded results (and their library) differ', async () => {
		const { host, asked } = provider({ 'v.sysml': model, 'README.md': 'old notes' });
		const base = git({
			'v.sysml': withResult,
			'libraries/VerificationResults.sysml': 'library package VerificationResults;',
			'README.md': 'new notes'
		}).files;
		expect(await sameModelAt(host, { owner: 'acme', repo: 'drone' }, EARLIER, base)).toBe(true);
		// Only the model file whose blob differs is read.
		expect(asked).toEqual(['tree a', 'file v.sysml']);
	});

	it('differs when the model does', async () => {
		const { host } = provider({ 'v.sysml': model.replace('vc', 'vc2') });
		const base = git({ 'v.sysml': withResult }).files;
		expect(await sameModelAt(host, { owner: 'acme', repo: 'drone' }, EARLIER, base)).toBe(false);
	});
});

describe('the project’s revision', () => {
	it('finds out once whether a result’s commit has the same model, then says it holds', async () => {
		const { host, asked } = provider({ 'v.sysml': model });
		let files: Record<string, string> = { 'v.sysml': withResult };
		const revision = new ProjectRevision({
			git: () => git({ 'v.sysml': withResult }),
			files: () => files,
			provider: () => host,
			login: () => 'ace'
		});
		expect(revision.changed).toBe(false);
		expect(freshness(result(EARLIER), revision).state).toBe('checking');
		await new Promise((r) => setTimeout(r, 0));
		expect(freshness(result(EARLIER), revision).state).toBe('current');
		expect(freshness(result(EARLIER), revision).state).toBe('current');
		expect(asked.filter((a) => a.startsWith('tree'))).toHaveLength(1);
		// Recording another result changes no model; changing the model does.
		files = { 'v.sysml': withResult.replace('date = "2026-10-20"', 'date = "2026-10-21"') };
		expect(new ProjectRevision({ ...sourceOf(files), provider: () => host }).changed).toBe(false);
		files = { 'v.sysml': withResult.replace('verification vc', 'verification vd') };
		expect(new ProjectRevision({ ...sourceOf(files), provider: () => host }).changed).toBe(true);
	});

	it('names the commit a report is made from', () => {
		const revision = new ProjectRevision(sourceOf({ 'v.sysml': withResult }));
		expect(revision.stamp).toBe('Commit bbbbbbb of acme/drone (main)');
		expect(new ProjectRevision(sourceOf({ 'v.sysml': model })).stamp).toBe(
			'Commit bbbbbbb of acme/drone (main), with changes not committed'
		);
		expect(revisionStamp(null)).toBe('Not committed');
		expect(revisionStamp({ commit: null, changed: false })).toBe('Not committed');
	});
});

function sourceOf(files: Record<string, string>) {
	return {
		git: () => git({ 'v.sysml': withResult }),
		files: () => files,
		provider: () => null,
		login: () => null
	};
}
