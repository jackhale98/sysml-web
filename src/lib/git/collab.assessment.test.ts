/**
 * Assessment (§8 Git collaboration): two people on one branch, through the
 * app's own GitHub connection (`GitConnection`), against an in-memory
 * repository that behaves as GitHub does (a save is refused unless the branch
 * still points at the commit it was made on), and against the real GitHub
 * provider with a mocked API for the race between its check and its update.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '#lib/engine/client.ts';
import type { StoredProject } from '#lib/project/store.ts';
import { GitError } from './errors.ts';
import { GitHubProvider } from './github.ts';
import type { CommitRequest, GitProvider, GitRecord, RepoRef, TreeEntry } from './types.ts';

const stored = new Map<string, StoredProject>();
vi.mock('#lib/project/store.ts', () => ({
	loadProject: async (id: string) => structuredClone(stored.get(id)),
	saveProject: async (project: StoredProject) =>
		void stored.set(project.id, structuredClone(project)),
	timestamp: () => '2026-10-23T00:00:00Z'
}));

const { ProjectSession } = await import('#lib/project/session.svelte.ts');
const { Workspace } = await import('#lib/project/workspace.svelte.ts');

const sha = (text: string) => `blob:${text}`;

/** A repository with one branch, as GitHub keeps it. */
class Repo {
	commits = new Map<string, Record<string, string>>();
	head = 'c1';
	private next = 2;
	constructor(files: Record<string, string>) {
		this.commits.set('c1', files);
	}
	provider(): GitProvider {
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- the fake API reads the repository as it is now
		const repo = this;
		const fail = () => {
			throw new Error('not used');
		};
		return {
			id: 'github',
			label: 'GitHub',
			currentUser: fail,
			listRepos: fail,
			getRepo: fail,
			listBranches: fail,
			createBranch: fail,
			openPullRequest: fail,
			mergeBase: fail,
			listPullRequests: fail,
			listCommits: fail,
			webUrl: () => '',
			async head() {
				return { commit: repo.head, tree: `tree-${repo.head}` };
			},
			async compare() {
				return { ahead: 1, behind: 0, status: 'ahead' as const };
			},
			async readTree(_: RepoRef, commit: string) {
				const files = repo.commits.get(commit)!;
				return {
					commit,
					tree: `tree-${commit}`,
					truncated: false,
					entries: Object.entries(files).map(([path, text]) => ({ path, sha: sha(text) }))
				};
			},
			async readFiles(_: RepoRef, entries: TreeEntry[]) {
				const all = [...repo.commits.values()].flatMap((f) => Object.values(f));
				return Object.fromEntries(
					entries.map((e) => [e.path, all.find((text) => sha(text) === e.sha)!])
				);
			},
			async commit(_: RepoRef, request: CommitRequest) {
				if (request.parent !== repo.head)
					throw new GitError('behind', 'Someone saved newer changes. Get the latest first.', 409);
				const files = { ...repo.commits.get(repo.head)! };
				const blobs: Record<string, string> = {};
				for (const change of request.changes) {
					if (change.text === null) delete files[change.path];
					else {
						files[change.path] = change.text;
						blobs[change.path] = sha(change.text);
					}
				}
				const commit = `c${repo.next++}`;
				repo.commits.set(commit, files);
				repo.head = commit;
				return { commit, tree: `tree-${commit}`, blobs };
			}
		};
	}
}

/** Someone with the branch open in their browser, at the repository's head. */
async function person(id: string, repo: Repo) {
	const files = repo.commits.get(repo.head)!;
	const git: GitRecord = {
		provider: 'github',
		owner: 'acme',
		repo: 'drone',
		branch: 'main',
		defaultBranch: 'main',
		base: repo.head,
		baseTree: `tree-${repo.head}`,
		files: Object.fromEntries(
			Object.entries(files).map(([path, text]) => [path, { sha: sha(text), text }])
		),
		syncedAt: ''
	};
	stored.set(id, {
		id,
		info: { name: 'Drone' },
		files: Object.entries(files).map(([path, text]) => ({ path, text })),
		origin: 'git',
		created: '',
		updated: '',
		git
	});
	const workspace = new Workspace();
	const session = new ProjectSession(workspace);
	workspace.preview((await session.load(id))!);
	session.git.provider = () => repo.provider();
	return { workspace, session, git: session.git };
}

/** Pulls here never add or remove files, so the workspace needs no engine. */
const engine = {} as Engine;

const A = 'package A {\n    part def Frame;\n\n    part def Arm;\n\n    part def Rotor;\n}\n';

beforeEach(() => stored.clear());

describe('two people saving to one branch', () => {
	it('refuses the second save, keeps its changes, then merges and saves both', async () => {
		const repo = new Repo({ 'A.sysml': A, 'B.sysml': 'package B {\n}\n' });
		const ann = await person('ann', repo);
		const bob = await person('bob', repo);

		ann.workspace.setText(
			'A.sysml',
			A.replace('part def Frame;', 'part def Frame { attribute mass; }')
		);
		await ann.git.save('Frame mass');

		bob.workspace.setText(
			'A.sysml',
			A.replace('part def Rotor;', 'part def Rotor { attribute rpm; }')
		);
		bob.workspace.setText('B.sysml', 'package B {\n    part def Battery;\n}\n');
		const refused = await bob.git.save('Rotor speed').catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(GitError);
		expect((refused as GitError).kind).toBe('behind');
		// Nothing of Bob's was lost or sent; his base is where it was.
		expect(bob.git.record!.base).toBe('c1');
		expect(bob.git.changes.map((c) => c.path)).toEqual(['A.sysml', 'B.sysml']);
		expect(repo.commits.get(repo.head)!['A.sysml']).not.toContain('rpm');

		// Get latest: both changed A.sysml, on different lines, so a combined version is offered.
		expect(await bob.git.pull(engine)).toBe('conflicts');
		const [conflict] = bob.git.pending!.conflicts;
		expect(conflict!.path).toBe('A.sysml');
		expect(conflict!.merged).toContain('attribute mass');
		expect(conflict!.merged).toContain('attribute rpm');
		await bob.git.resolve({ 'A.sysml': 'merged' }, engine);
		await bob.git.save('Rotor speed');
		const head = repo.commits.get(repo.head)!;
		expect(head['A.sysml']).toContain('attribute mass');
		expect(head['A.sysml']).toContain('attribute rpm');
		expect(head['B.sysml']).toContain('Battery');
	});

	it('asks when both changed the same element (the same line), offering no automatic merge', async () => {
		const repo = new Repo({ 'A.sysml': A });
		const ann = await person('ann', repo);
		const bob = await person('bob', repo);
		ann.workspace.setText(
			'A.sysml',
			A.replace('part def Arm;', 'part def Arm { attribute length; }')
		);
		await ann.git.save('Arm length');
		bob.workspace.setText('A.sysml', A.replace('part def Arm;', 'part def Boom;'));
		expect(await bob.git.pull(engine)).toBe('conflicts');
		expect(bob.git.pending!.conflicts).toMatchObject([{ path: 'A.sysml', merged: null }]);
		// Nothing changes until the person chooses.
		expect(bob.workspace.files['A.sysml']).toContain('part def Boom;');
	});

	it('flags a file renamed here and changed there (seen as deleted here)', async () => {
		const repo = new Repo({ 'A.sysml': A });
		const ann = await person('ann', repo);
		const bob = await person('bob', repo);
		ann.workspace.setText(
			'A.sysml',
			A.replace('part def Arm;', 'part def Arm { attribute length; }')
		);
		await ann.git.save('Arm length');
		await bob.workspace.renameFile('A.sysml', 'structure/A.sysml');
		expect(await bob.git.pull(engine)).toBe('conflicts');
		expect(bob.git.pending!.conflicts).toMatchObject([{ path: 'A.sysml', mine: null }]);
	});

	// Fixed in this assessment: a pull waiting on conflicts applied the files as they were when it was planned, replacing edits made meanwhile (the sheet closed, the editor used) without a word.
	it('keeps edits made while a pull waits for its conflicts to be decided', async () => {
		const repo = new Repo({ 'A.sysml': A, 'B.sysml': 'package B {\n}\n' });
		const ann = await person('ann', repo);
		const bob = await person('bob', repo);
		ann.workspace.setText(
			'A.sysml',
			A.replace('part def Arm;', 'part def Arm { attribute length; }')
		);
		ann.workspace.setText('B.sysml', 'package B {\n    part def Battery;\n}\n');
		await ann.git.save('Arm length, battery');

		bob.workspace.setText('A.sysml', A.replace('part def Arm;', 'part def Boom;'));
		expect(await bob.git.pull(engine)).toBe('conflicts');
		// The sheet is closed without choosing; Bob carries on editing A.sysml.
		const later = A.replace('part def Arm;', 'part def Boom;').replace(
			'part def Rotor;',
			'part def Rotor { attribute rpm; }'
		);
		bob.workspace.setText('A.sysml', later);
		const refused = await bob.git.resolve({ 'A.sysml': 'mine' }, engine).catch((e: unknown) => e);
		// "Keep mine" keeps what is mine now, or the pull is refused as out of date.
		expect(bob.workspace.files['A.sysml']).toBe(later);
		if (refused) {
			expect((refused as GitError).message).toMatch(/Get latest again/);
			expect(bob.git.pending).toBeNull();
			expect(bob.git.record!.base).toBe('c1');
		}
	});

	// Fixed in this assessment: as above, for a file only they changed.
	it('keeps an edit made, while a pull waits, to a file only they had changed', async () => {
		const repo = new Repo({ 'A.sysml': A, 'B.sysml': 'package B {\n}\n' });
		const ann = await person('ann', repo);
		const bob = await person('bob', repo);
		ann.workspace.setText(
			'A.sysml',
			A.replace('part def Arm;', 'part def Arm { attribute length; }')
		);
		ann.workspace.setText('B.sysml', 'package B {\n    part def Battery;\n}\n');
		await ann.git.save('Arm length, battery');

		bob.workspace.setText('A.sysml', A.replace('part def Arm;', 'part def Boom;'));
		expect(await bob.git.pull(engine)).toBe('conflicts');
		bob.workspace.setText('B.sysml', 'package B {\n    part def Charger;\n}\n');
		await bob.git.resolve({ 'A.sysml': 'mine' }, engine).catch(() => undefined);
		expect(bob.workspace.files['B.sysml']).toContain('Charger');
		// Planned again, the pull brings theirs in around it.
		expect(await bob.git.pull(engine)).toBe('conflicts');
		expect(bob.git.pending!.conflicts.map((c) => c.path).sort()).toEqual(['A.sysml', 'B.sysml']);
	});
});

describe('the GitHub provider when the branch moves during a save', () => {
	it('reports the refused branch update as "get the latest first", and the project keeps its base and changes', async () => {
		const repo = new Repo({ 'A.sysml': A });
		const bob = await person('bob', repo);
		// GitHub: the branch is at c1 when checked, but someone moves it before the update.
		const calls: string[] = [];
		const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input).replace('https://api.github.com', '');
			const method = init?.method ?? 'GET';
			calls.push(`${method} ${url}`);
			const json = (status: number, body: unknown) =>
				new Response(JSON.stringify(body), {
					status,
					headers: { 'content-type': 'application/json' }
				});
			if (method === 'GET' && url.endsWith('/branches/main'))
				return json(200, {
					name: 'main',
					commit: { sha: 'c1', commit: { tree: { sha: 'tree-c1' } } }
				});
			if (url.endsWith('/git/blobs')) return json(201, { sha: 'b2' });
			if (url.endsWith('/git/trees')) return json(201, { sha: 't2' });
			if (url.endsWith('/git/commits')) return json(201, { sha: 'c2' });
			if (method === 'PATCH') return json(422, { message: 'Update is not a fast forward' });
			return json(404, { message: 'Not Found' });
		}) as typeof globalThis.fetch;
		const github = new GitHubProvider('tok', { fetch });
		bob.session.git.provider = () => github;
		bob.workspace.setText('A.sysml', A.replace('part def Arm;', 'part def Boom;'));

		const error = await bob.git.save('Boom').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GitError);
		expect((error as GitError).kind).toBe('behind');
		expect((error as GitError).message).toMatch(/Get the latest first/);
		expect(calls.at(-1)).toBe('PATCH /repos/acme/drone/git/refs/heads/main');
		expect(bob.git.record!.base).toBe('c1');
		expect(bob.git.changes.map((c) => c.path)).toEqual(['A.sysml']);
		expect(stored.get('bob')!.git!.base).toBe('c1');
	});
});
