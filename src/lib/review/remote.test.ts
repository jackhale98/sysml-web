import { describe, expect, it } from 'vitest';
import type { GitProvider, TreeEntry } from '#lib/git/types.ts';
import { knowBlobs, modelFilesAt, pullRequestFiles } from './remote';

/** A provider with two commits; it counts the blobs it is asked for. */
function fakeProvider() {
	const trees: Record<string, TreeEntry[]> = {
		c1: [
			{ path: 'a.sysml', sha: 'sa1' },
			{ path: 'b.sysml', sha: 'sb1' },
			{ path: 'README.md', sha: 'sr1' }
		],
		c2: [
			{ path: 'a.sysml', sha: 'sa2' },
			{ path: 'b.sysml', sha: 'sb1' }
		]
	};
	const texts: Record<string, string> = { sa1: 'A1', sa2: 'A2', sb1: 'B1', sr1: '# r' };
	const downloaded: string[] = [];
	const provider = {
		readTree: async (_ref: unknown, commit: string) => ({
			commit,
			tree: `t-${commit}`,
			truncated: false,
			entries: trees[commit]!
		}),
		readFiles: async (_ref: unknown, entries: TreeEntry[]) => {
			downloaded.push(...entries.map((e) => e.sha));
			return Object.fromEntries(entries.map((e) => [e.path, texts[e.sha]!]));
		},
		mergeBase: async () => 'c1'
	} as unknown as GitProvider;
	return { provider, downloaded };
}

const ref = { owner: 'acme', repo: 'drone' };

describe('versions on GitHub', () => {
	it('reads a commit’s model files, downloading each blob once', async () => {
		const { provider, downloaded } = fakeProvider();
		knowBlobs({ 'b.sysml': { sha: 'sb1', text: 'B1' } });
		expect(await modelFilesAt(provider, ref, 'c1')).toEqual({ 'a.sysml': 'A1', 'b.sysml': 'B1' });
		expect(await modelFilesAt(provider, ref, 'c2')).toEqual({ 'a.sysml': 'A2', 'b.sysml': 'B1' });
		expect(await modelFilesAt(provider, ref, 'c1')).toEqual({ 'a.sysml': 'A1', 'b.sysml': 'B1' });
		// b.sysml was known; the README is not a model file.
		expect(downloaded).toEqual(['sa1', 'sa2']);
	});

	it('reads a proposal from where its branch parted to its latest commit', async () => {
		const { provider } = fakeProvider();
		const files = await pullRequestFiles(provider, ref, {
			number: 9,
			url: '',
			title: 'x',
			author: null,
			head: { ref: 'f', sha: 'c2' },
			base: { ref: 'main', sha: 'c0' },
			updatedAt: null
		});
		expect(files).toEqual({
			base: { 'a.sysml': 'A1', 'b.sysml': 'B1' },
			head: { 'a.sysml': 'A2', 'b.sysml': 'B1' },
			baseCommit: 'c1'
		});
	});
});
