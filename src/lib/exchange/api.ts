/**
 * A client for the OMG Systems Modeling API's REST/HTTP binding (Systems
 * Modeling API and Services 1.0, clause 8.1): the pilot implementation
 * (SysML-v2-API-Services) and SysON's `/api/rest` answer the same paths.
 *
 * - `GET  /projects`, `POST /projects`
 * - `GET  /projects/{p}/branches`, `GET /projects/{p}/commits`
 * - `GET  /projects/{p}/commits/{c}/elements` (paged: the `Link` header's `rel="next"`)
 * - `POST /projects/{p}/commits?branchId={b}` with `{"@type": "Commit", "change": [DataVersion…]}`
 *
 * SysON (2026.9) departs from the pilot in what it takes: a project's name
 * as `?name=` (both are sent), an identity typed `"DataIdentity"` (the
 * specification's type, always sent), and for an element it has, only the
 * properties that change (`minimalPayloads`, for servers under `/api/rest`).
 * What a server keeps is checked by reading it back (`sync.ts`, `push`).
 *
 * The browser calls the server directly (there is no proxy), so the server
 * must allow this page's origin (CORS; see docs/interchange.md). A token, when
 * given, goes only to this server, as `Authorization: Bearer …`.
 */
import { changedProperties, type ElementJson } from './elements';

export interface ApiProject {
	id: string;
	name: string;
	description: string | null;
	defaultBranch: string | null;
	created: string | null;
}

export interface ApiBranch {
	id: string;
	name: string;
	/** The commit the branch is at (null for an empty project). */
	head: string | null;
	created: string | null;
}

export interface ApiCommit {
	id: string;
	description: string | null;
	created: string | null;
	previous: string[];
}

/** A change to one element: its new version, or `payload: null` to delete it. */
export interface DataVersion {
	'@type': 'DataVersion';
	identity: { '@type': 'DataIdentity'; '@id': string };
	payload: ElementJson | null;
}

export type ApiErrorKind = 'network' | 'auth' | 'not-found' | 'refused' | 'server' | 'format';

export class ApiError extends Error {
	override name = 'ApiError';
	constructor(
		readonly kind: ApiErrorKind,
		message: string,
		readonly status?: number
	) {
		super(message);
	}
}

type Fetch = typeof fetch;

/** Pages of elements read at most (a guard against a server that links to itself). */
const MAX_PAGES = 5000;

const refId = (value: unknown): string | null =>
	value && typeof value === 'object' && typeof (value as { '@id'?: unknown })['@id'] === 'string'
		? (value as { '@id': string })['@id']
		: null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `https://host/api/rest/` → `https://host/api/rest`; a missing scheme becomes https. */
export function normalizeBase(url: string): string {
	let base = url.trim();
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) base = `https://${base}`;
	const parsed = new URL(base);
	parsed.search = '';
	parsed.hash = '';
	return parsed.href.replace(/\/+$/, '');
}

/** Whether two addresses are on the same site (scheme, host and port). */
export function sameOrigin(a: string, b: string): boolean {
	try {
		return new URL(a).origin === new URL(b).origin;
	} catch {
		return false;
	}
}

/** The `rel="next"` URL of a `Link` header (RFC 8288), resolved against the request. */
export function nextLink(header: string | null, request: string): string | null {
	if (!header) return null;
	for (const part of header.split(/,(?=\s*<)/)) {
		const match = /<([^>]*)>\s*;(.*)$/.exec(part.trim());
		if (match && /\brel\s*=\s*"?next"?/i.test(match[2]!)) return new URL(match[1]!, request).href;
	}
	return null;
}

export class SysmlApi {
	readonly base: string;
	private readonly token: string | null;
	private readonly fetcher: Fetch;

	constructor(base: string, token: string | null = null, fetcher?: Fetch) {
		this.base = normalizeBase(base);
		this.token = token?.trim() || null;
		this.fetcher = fetcher ?? ((...args) => fetch(...args));
	}

	/**
	 * Whether a change to an element it has sends only the properties that
	 * change. SysON (whose API is under `/api/rest`) fails a commit carrying a
	 * whole element; the pilot replaces an element with its payload, so it
	 * gets whole elements.
	 */
	get minimalPayloads(): boolean {
		return /\/api\/rest$/.test(new URL(this.base).pathname);
	}

	/** Where the server is, in words: its host. */
	get host(): string {
		return new URL(this.base).host;
	}

	private async request(
		method: string,
		url: string,
		body?: unknown
	): Promise<{ data: unknown; link: string | null }> {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		// The token is for this server only: never for an address elsewhere.
		if (this.token && sameOrigin(url, this.base)) headers.Authorization = `Bearer ${this.token}`;
		let response: Response;
		try {
			response = await this.fetcher(url, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch {
			throw new ApiError('network', unreachable(this.base));
		}
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw statusError(response.status, method, detail);
		}
		const raw = await response.text();
		let data: unknown = null;
		if (raw.trim()) {
			try {
				data = JSON.parse(raw);
			} catch {
				throw notJson(method, this.base, raw);
			}
		}
		return { data, link: nextLink(response.headers.get('Link'), url) };
	}

	/** Every record of a collection, following the `Link` header from page to page. */
	private async collection(path: string, onPage?: (count: number) => void): Promise<unknown[]> {
		const items: unknown[] = [];
		let url: string | null = `${this.base}${path}`;
		for (let page = 0; url && page < MAX_PAGES; page++) {
			const { data, link }: { data: unknown; link: string | null } = await this.request('GET', url);
			if (!Array.isArray(data))
				throw new ApiError('format', `The server’s answer to ${path} is not a list.`);
			items.push(...data);
			onPage?.(items.length);
			// A next page elsewhere is not followed: the token (and the request) stay with this server.
			if (link && !sameOrigin(link, this.base))
				throw new ApiError(
					'format',
					`The server sent the next page of ${path} on another site (${new URL(link).host}). It was not read there: only ${this.host} is trusted with this connection.`
				);
			url = link;
		}
		return items;
	}

	async projects(): Promise<ApiProject[]> {
		return (await this.collection('/projects')).map(toProject);
	}

	async project(id: string): Promise<ApiProject> {
		return toProject((await this.request('GET', `${this.base}/projects/${enc(id)}`)).data);
	}

	/** A new project: its name both in the body (the pilot) and as `?name=` (SysON). */
	async createProject(name: string, description = ''): Promise<ApiProject> {
		const { data } = await this.request(
			'POST',
			`${this.base}/projects?${new URLSearchParams({ name })}`,
			{ '@type': 'Project', name, description }
		);
		if (data === null)
			throw new ApiError(
				'server',
				'The server answered without the project it should have made, so it most likely made none.'
			);
		return toProject(data);
	}

	async branches(projectId: string): Promise<ApiBranch[]> {
		return (await this.collection(`/projects/${enc(projectId)}/branches`)).map(toBranch);
	}

	/** The project's commits, newest first. */
	async commits(projectId: string): Promise<ApiCommit[]> {
		const commits = (await this.collection(`/projects/${enc(projectId)}/commits`)).map(toCommit);
		return commits.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
	}

	/** Every element at a commit. */
	async elements(
		projectId: string,
		commitId: string,
		onProgress?: (count: number) => void
	): Promise<ElementJson[]> {
		const items = await this.collection(
			`/projects/${enc(projectId)}/commits/${enc(commitId)}/elements`,
			onProgress
		);
		return items.filter(
			(e): e is ElementJson =>
				!!e && typeof e === 'object' && typeof (e as ElementJson)['@id'] === 'string'
		);
	}

	/**
	 * A new commit on a branch (the default branch when `branchId` is null).
	 * Null when the server answered without one (SysON does, for a commit it
	 * failed): only reading it back tells what it kept.
	 */
	async commit(
		projectId: string,
		branchId: string | null,
		change: DataVersion[],
		description: string
	): Promise<ApiCommit | null> {
		const query = branchId ? `?branchId=${enc(branchId)}` : '';
		const { data } = await this.request(
			'POST',
			`${this.base}/projects/${enc(projectId)}/commits${query}`,
			{ '@type': 'Commit', description, change }
		);
		return data === null ? null : toCommit(data);
	}
}

const enc = encodeURIComponent;

function toProject(value: unknown): ApiProject {
	const v = (value ?? {}) as Record<string, unknown>;
	const id = text(v['@id']) ?? text(v.id);
	if (!id) throw new ApiError('format', 'The server sent a project without an "@id".');
	return {
		id,
		name: text(v.name) ?? '(no name)',
		description: text(v.description),
		defaultBranch: refId(v.defaultBranch),
		created: text(v.created)
	};
}

function toBranch(value: unknown): ApiBranch {
	const v = (value ?? {}) as Record<string, unknown>;
	const id = text(v['@id']) ?? text(v.id);
	if (!id) throw new ApiError('format', 'The server sent a branch without an "@id".');
	return {
		id,
		name: text(v.name) ?? id,
		head: refId(v.head) ?? refId(v.referencedCommit),
		created: text(v.created)
	};
}

function toCommit(value: unknown): ApiCommit {
	const v = (value ?? {}) as Record<string, unknown>;
	const id = text(v['@id']) ?? text(v.id);
	if (!id) throw new ApiError('format', 'The server sent a commit without an "@id".');
	const previous = Array.isArray(v.previousCommit)
		? v.previousCommit.map(refId).filter((p): p is string => !!p)
		: refId(v.previousCommit)
			? [refId(v.previousCommit)!]
			: [];
	return { id, description: text(v.description), created: text(v.created), previous };
}

/** What to say when the request never got an answer: usually CORS, else the address. */
export function unreachable(base: string): string {
	const origin = typeof location === 'undefined' ? 'this page' : location.origin;
	const insecure =
		typeof location !== 'undefined' &&
		location.protocol === 'https:' &&
		base.startsWith('http://') &&
		!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(base);
	if (insecure)
		return `The browser blocked the request: this page is served over HTTPS, so the server must be too (http:// works only for localhost).`;
	return `No answer from ${base}. Either the server isn’t reachable at that address, or it doesn’t allow requests from ${origin} (CORS). Ask whoever runs it to allow this origin; the help says which headers it needs.`;
}

/**
 * A 2xx answer that isn't JSON. To a read, that is usually a web site's page
 * at an address that isn't the API's (SysON answers its app for any unknown
 * path); to a change, a server that didn't take the request.
 */
function notJson(method: string, base: string, raw: string): ApiError {
	const page = /^\s*<(!doctype|html)/i.test(raw);
	if (method === 'GET')
		return new ApiError(
			'format',
			`The server answered with ${page ? 'a web page' : 'something'} other than JSON. Is ${base} the address of a SysML v2 API (for SysON, it ends in /api/rest)?`
		);
	return new ApiError(
		'format',
		`The server didn’t take the request: it answered with ${page ? 'a web page' : 'something other than JSON'} instead of the API’s answer, which is what it does for a request it doesn’t understand.`
	);
}

function statusError(status: number, method: string, detail: string): ApiError {
	const said = detail ? ` (${detail.replace(/\s+/g, ' ').slice(0, 160)})` : '';
	if (status === 401 || status === 403)
		return new ApiError(
			'auth',
			status === 401
				? 'The server wants a token: add one to the connection, or check that it is still valid.'
				: 'The server refused: the token doesn’t allow this.',
			status
		);
	if (status === 404)
		return new ApiError(
			'not-found',
			`The server has no such page${said}. Check the address: it is the API’s base (for SysON, it ends in /api/rest).`,
			status
		);
	if (status === 405 || status === 501)
		return new ApiError(
			'refused',
			method === 'GET'
				? `The server doesn’t offer this (HTTP ${status}).`
				: `The server doesn’t accept changes through the API (HTTP ${status}).`,
			status
		);
	return new ApiError(
		'server',
		`The server answered with an error (HTTP ${status})${said}.`,
		status
	);
}

/**
 * Data versions for a change set: new and changed elements as payloads,
 * removed ones as `null`. With `minimalAgainst` (the server's elements), a
 * changed element's payload holds only `@id`, `@type` and the properties
 * whose value differs from the server's.
 */
export function dataVersions(
	changes: {
		created: ElementJson[];
		updated: ElementJson[];
		deleted: string[];
	},
	minimalAgainst?: readonly ElementJson[]
): DataVersion[] {
	const theirs = minimalAgainst && new Map(minimalAgainst.map((e) => [e['@id'], e]));
	const version = (payload: ElementJson | null, id: string): DataVersion => ({
		'@type': 'DataVersion',
		identity: { '@type': 'DataIdentity', '@id': id },
		payload
	});
	return [
		...changes.created.map((payload) => version(payload, payload['@id'])),
		...changes.updated.map((payload) => {
			const old = theirs?.get(payload['@id']);
			return version(old ? changedOnly(payload, old) : payload, payload['@id']);
		}),
		...changes.deleted.map((id) => version(null, id))
	];
}

/** `next` cut down to its identity and the properties whose value isn't `old`'s. */
function changedOnly(next: ElementJson, old: ElementJson): ElementJson {
	const out: ElementJson = { '@id': next['@id'], '@type': next['@type'] };
	for (const property of changedProperties(next, old))
		if (property !== '@type') out[property] = next[property];
	return out;
}

/**
 * Connect to a server: its project list answers at `url`, or, for an address
 * without the API's path (SysON's site), at `url/api/rest`.
 */
export async function connectTo(
	url: string,
	token: string | null,
	fetcher?: Fetch
): Promise<{ api: SysmlApi; projects: ApiProject[] }> {
	const api = new SysmlApi(url, token, fetcher);
	try {
		return { api, projects: await api.projects() };
	} catch (error) {
		const retry =
			error instanceof ApiError &&
			(error.kind === 'not-found' || error.kind === 'format') &&
			!/\/api\/rest$/.test(api.base);
		if (!retry) throw error;
		const rest = new SysmlApi(`${api.base}/api/rest`, token, fetcher);
		try {
			return { api: rest, projects: await rest.projects() };
		} catch {
			throw error;
		}
	}
}
