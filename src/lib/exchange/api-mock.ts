/**
 * For tests: an in-memory Systems Modeling API server answering the REST
 * shapes the OMG specification documents (clause 8.1 and annex B; the pilot
 * implementation's JSON): projects with a default branch, branches with a
 * `head`, commits with `previousCommit`, elements per commit in pages linked by
 * the `Link` header, and `POST …/commits?branchId=` applying data versions.
 * `handle` is transport-free: unit tests wrap it as `fetch`, e2e tests as a
 * Playwright route.
 */
import type { ElementJson } from './elements';

export interface MockResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

interface StoredCommit {
	record: Record<string, unknown>;
	elements: Map<string, ElementJson>;
}

interface StoredProject {
	record: Record<string, unknown>;
	branches: Map<string, Record<string, unknown>>;
	commits: Map<string, StoredCommit>;
}

export interface MockOptions {
	/** Requests without `Authorization: Bearer <token>` get 401. */
	token?: string;
	/** Elements per page (the `Link` header leads on). */
	pageSize?: number;
	/** The path the API lives under (`/api/rest` for SysON). */
	prefix?: string;
	/** Ids, made deterministically for tests. */
	ids?: () => string;
	now?: () => string;
}

let counter = 0;
const defaultIds = () => {
	const n = (++counter).toString(16).padStart(12, '0');
	return `00000000-0000-4000-8000-${n}`;
};

export class MockApiServer {
	readonly projects = new Map<string, StoredProject>();
	/** Every request, as `METHOD path`. */
	readonly log: string[] = [];
	/** The bodies of the commits posted, in order. */
	readonly posted: Record<string, unknown>[] = [];
	private readonly options: Required<Omit<MockOptions, 'token'>> & { token?: string };
	private clock = Date.parse('2026-01-01T00:00:00Z');

	constructor(options: MockOptions = {}) {
		this.options = {
			pageSize: 100,
			prefix: '',
			ids: defaultIds,
			now: () => new Date((this.clock += 1000)).toISOString(),
			...options
		};
	}

	/** A project holding `elements` in one commit on `main`. */
	addProject(name: string, elements: ElementJson[], description = ''): string {
		const id = this.options.ids();
		const branch = this.options.ids();
		const project: StoredProject = {
			record: {
				'@id': id,
				'@type': 'Project',
				name,
				description,
				created: this.options.now(),
				defaultBranch: { '@id': branch }
			},
			branches: new Map(),
			commits: new Map()
		};
		project.branches.set(branch, {
			'@id': branch,
			'@type': 'Branch',
			name: 'main',
			owningProject: { '@id': id },
			head: null,
			created: this.options.now()
		});
		this.projects.set(id, project);
		if (elements.length)
			this.applyCommit(project, branch, {
				description: 'Initial model',
				change: elements.map((e) => ({ identity: { '@id': e['@id'] }, payload: e }))
			});
		return id;
	}

	private applyCommit(
		project: StoredProject,
		branchId: string,
		body: { description?: unknown; change?: unknown }
	): Record<string, unknown> {
		const branch = project.branches.get(branchId)!;
		const head = (branch.head as { '@id': string } | null)?.['@id'];
		const elements = new Map(head ? project.commits.get(head)!.elements : []);
		for (const version of (body.change as {
			identity?: { '@id'?: string };
			payload?: ElementJson | null;
		}[]) ?? []) {
			const id = version.identity?.['@id'] ?? version.payload?.['@id'];
			if (!id) continue;
			if (version.payload) elements.set(id, version.payload);
			else elements.delete(id);
		}
		const id = this.options.ids();
		const record = {
			'@id': id,
			'@type': 'Commit',
			description: typeof body.description === 'string' ? body.description : null,
			created: this.options.now(),
			owningProject: { '@id': project.record['@id'] },
			previousCommit: head ? [{ '@id': head }] : []
		};
		project.commits.set(id, { record, elements });
		branch.head = { '@id': id };
		return record;
	}

	/** Answer one request. */
	handle(
		method: string,
		url: string,
		headers: Record<string, string>,
		body?: string
	): MockResponse {
		const parsed = new URL(url);
		this.log.push(`${method} ${parsed.pathname}`);
		const cors = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Expose-Headers': 'Link',
			'Content-Type': 'application/json'
		};
		const json = (status: number, data: unknown, extra: Record<string, string> = {}) => ({
			status,
			headers: { ...cors, ...extra },
			body: JSON.stringify(data)
		});
		if (method === 'OPTIONS')
			return {
				status: 204,
				headers: {
					...cors,
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
					'Access-Control-Allow-Headers': 'Authorization, Content-Type'
				},
				body: ''
			};
		const auth = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
		if (this.options.token && auth !== `Bearer ${this.options.token}`)
			return json(401, { error: 'unauthorized' });
		if (!parsed.pathname.startsWith(`${this.options.prefix}/`))
			return { status: 404, headers: cors, body: 'Not Found' };
		const path = parsed.pathname.slice(this.options.prefix.length).split('/').filter(Boolean);
		const [root, projectId, kind, itemId, sub] = path;
		if (root !== 'projects') return json(404, { error: 'not found' });

		if (!projectId) {
			if (method === 'GET')
				return json(
					200,
					[...this.projects.values()].map((p) => p.record)
				);
			if (method === 'POST') {
				const data = JSON.parse(body ?? '{}') as { name?: string; description?: string };
				if (!data.name) return json(400, { error: 'a project needs a name' });
				const id = this.addProject(data.name, [], data.description ?? '');
				return json(200, this.projects.get(id)!.record);
			}
			return json(405, { error: 'method not allowed' });
		}
		const project = this.projects.get(projectId);
		if (!project) return json(404, { error: 'no such project' });
		if (!kind) return json(200, project.record);
		if (kind === 'branches' && !itemId) return json(200, [...project.branches.values()]);
		if (kind === 'commits' && !itemId) {
			if (method === 'GET')
				return json(
					200,
					[...project.commits.values()].map((c) => c.record)
				);
			if (method === 'POST') {
				const branchId =
					parsed.searchParams.get('branchId') ??
					(project.record.defaultBranch as { '@id': string })['@id'];
				if (!project.branches.has(branchId)) return json(404, { error: 'no such branch' });
				const data = JSON.parse(body ?? '{}') as Record<string, unknown>;
				this.posted.push(data);
				return json(200, this.applyCommit(project, branchId, data));
			}
		}
		if (kind === 'commits' && itemId) {
			const commit = project.commits.get(itemId);
			if (!commit) return json(404, { error: 'no such commit' });
			if (!sub) return json(200, commit.record);
			if (sub === 'elements') {
				const all = [...commit.elements.values()];
				const size = Number(parsed.searchParams.get('page[size]')) || this.options.pageSize;
				const after = parsed.searchParams.get('page[after]');
				const start = after ? Number(atob(after)) : 0;
				const page = all.slice(start, start + size);
				const extra: Record<string, string> = {};
				if (start + size < all.length) {
					const next = new URL(parsed.href);
					next.searchParams.set('page[after]', btoa(String(start + size)));
					next.searchParams.set('page[size]', String(size));
					extra.Link = `<${next.href}>; rel="next"`;
				}
				return json(200, page, extra);
			}
		}
		return json(404, { error: 'not found' });
	}

	/** `handle` as a `fetch`. */
	get fetch(): typeof fetch {
		return async (input, init) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			const headers = Object.fromEntries(new Headers(init?.headers).entries());
			const r = this.handle(init?.method ?? 'GET', url, headers, init?.body as string | undefined);
			return new Response(r.status === 204 ? null : r.body, {
				status: r.status,
				headers: r.headers
			});
		};
	}

	/**
	 * Someone else saves: `edit` changes a copy of the elements at the
	 * branch's head (in place, or by returning the new list), and what differs
	 * is one commit on that branch. Gives the commit's id.
	 */
	commitAs(
		projectId: string,
		description: string,
		edit: (elements: ElementJson[]) => ElementJson[] | void,
		branch = 'main'
	): string {
		const project = this.projects.get(projectId)!;
		const [branchId] = [...project.branches].find(([, b]) => b.name === branch)!;
		const before = this.headElements(projectId, branch);
		const copy = structuredClone(before);
		const after = edit(copy) ?? copy;
		const was = new Map(before.map((e) => [e['@id'], JSON.stringify(e)]));
		const now = new Set(after.map((e) => e['@id']));
		const change = [
			...after
				.filter((e) => was.get(e['@id']) !== JSON.stringify(e))
				.map((e) => ({ identity: { '@id': e['@id'] }, payload: e })),
			...before
				.filter((e) => !now.has(e['@id']))
				.map((e) => ({ identity: { '@id': e['@id'] }, payload: null }))
		];
		return this.applyCommit(project, branchId, { description, change })['@id'] as string;
	}

	/** The elements at a branch's head. */
	headElements(projectId: string, branch = 'main'): ElementJson[] {
		const project = this.projects.get(projectId)!;
		const b = [...project.branches.values()].find((x) => x.name === branch)!;
		const head = (b.head as { '@id': string } | null)?.['@id'];
		return head ? [...project.commits.get(head)!.elements.values()] : [];
	}
}
