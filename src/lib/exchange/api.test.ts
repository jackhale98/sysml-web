/**
 * The Systems Modeling API client against an in-memory server that answers
 * as the specification documents (`api-mock.ts`), and saving to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, connectTo, nextLink, normalizeBase, SysmlApi } from './api';
import { MockApiServer } from './api-mock';
import { readElements, type ElementJson } from './elements';
import { changeCount, planPush, push } from './sync';

const BASE = 'https://sysml.example.org';
const garage = () =>
	readElements(readFileSync(join(import.meta.dirname, 'fixtures/garage.json'), 'utf8'));

function serverWithGarage(options = {}) {
	const server = new MockApiServer(options);
	const id = server.addProject('Garage', garage(), 'A small model');
	return { server, id };
}

describe('addresses', () => {
	it('normalizes the base URL', () => {
		expect(normalizeBase('sysml.example.org/api/rest/')).toBe('https://sysml.example.org/api/rest');
		expect(normalizeBase(' http://localhost:9000/ ')).toBe('http://localhost:9000');
		expect(normalizeBase('https://x.org/a?b=1#c')).toBe('https://x.org/a');
	});

	it('reads the next page from a Link header', () => {
		const request = 'https://x.org/projects/1/commits/2/elements';
		expect(nextLink('<https://x.org/p?page[after]=MTA=>; rel="next"', request)).toBe(
			'https://x.org/p?page[after]=MTA='
		);
		expect(
			nextLink('</p?page[before]=a>; rel="prev", </p?page[after]=b>; rel="next"', request)
		).toBe('https://x.org/p?page[after]=b');
		expect(nextLink('</p?page[before]=a>; rel="prev"', request)).toBeNull();
		expect(nextLink(null, request)).toBeNull();
	});
});

describe('reading', () => {
	it('lists projects, branches and commits', async () => {
		const { server, id } = serverWithGarage();
		const api = new SysmlApi(BASE, null, server.fetch);
		const projects = await api.projects();
		expect(projects).toEqual([
			expect.objectContaining({ id, name: 'Garage', description: 'A small model' })
		]);
		const branches = await api.branches(id);
		expect(branches).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(projects[0]!.defaultBranch).toBe(branches[0]!.id);
		const commits = await api.commits(id);
		expect(commits).toHaveLength(1);
		expect(branches[0]!.head).toBe(commits[0]!.id);
	});

	it('reads every element of a commit, page by page', async () => {
		const { server, id } = serverWithGarage({ pageSize: 5 });
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(id);
		const pages: number[] = [];
		const elements = await api.elements(id, branch!.head!, (n) => pages.push(n));
		expect(elements.map((e) => e['@id']).sort()).toEqual(
			garage()
				.map((e) => e['@id'])
				.sort()
		);
		expect(pages).toEqual([5, 10, 15, 20, 21]);
	});

	it('sends the token, and says so when the server wants one', async () => {
		const { server } = serverWithGarage({ token: 's3cret' });
		await expect(new SysmlApi(BASE, null, server.fetch).projects()).rejects.toMatchObject({
			kind: 'auth',
			message: expect.stringMatching(/wants a token/)
		});
		await expect(new SysmlApi(BASE, 's3cret', server.fetch).projects()).resolves.toHaveLength(1);
	});

	it('explains a refused or unreachable server in plain words (CORS)', async () => {
		const failing: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
		const error = await new SysmlApi(BASE, null, failing).projects().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).kind).toBe('network');
		expect((error as ApiError).message).toMatch(/CORS/);
	});

	it('finds SysON’s API under /api/rest when given the site’s address', async () => {
		const server = new MockApiServer({ prefix: '/api/rest' });
		server.addProject('Batmobile', garage());
		const { api, projects } = await connectTo('https://syson.example.org', null, server.fetch);
		expect(api.base).toBe('https://syson.example.org/api/rest');
		expect(projects.map((p) => p.name)).toEqual(['Batmobile']);
	});

	it('says when an answer is not the API’s', async () => {
		const html: typeof fetch = async () => new Response('<html>hi</html>', { status: 200 });
		await expect(new SysmlApi(BASE, null, html).projects()).rejects.toMatchObject({
			kind: 'format'
		});
	});
});

describe('saving', () => {
	it('creates a project and saves every element to it the first time', async () => {
		const server = new MockApiServer();
		const api = new SysmlApi(BASE, null, server.fetch);
		const project = await api.createProject('Garage copy');
		const [branch] = await api.branches(project.id);
		expect(branch!.head).toBeNull();
		const plan = await planPush(api, project.id, branch!, garage());
		expect(plan.changes.created).toHaveLength(21);
		expect(changeCount(plan.changes)).toBe(21);
		const commit = await push(api, project.id, branch!, plan, 'First save');
		expect(commit.description).toBe('First save');
		expect(server.headElements(project.id)).toHaveLength(21);
		// The commit carries data versions with the elements as payloads.
		const change = server.posted[0]!.change as {
			identity: { '@id': string };
			payload: ElementJson;
		}[];
		expect(change[0]!.identity['@id']).toBe(change[0]!.payload['@id']);
	});

	it('sends only what changed, matched to the server’s ids by place', async () => {
		const { server, id } = serverWithGarage();
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(id);
		// The same model from another tool: other ids, one name changed, one part removed.
		const ours = renumber(garage());
		const engine = ours.find((e) => e.declaredName === 'Engine')!;
		engine.declaredName = 'Motor';
		const car = ours.find((e) => e.declaredName === 'car')!;
		const removed = new Set([
			car['@id'],
			...ours.filter((e) => refersTo(e, car['@id'])).map((e) => e['@id'])
		]);
		const pkg = ours.find((e) => e['@type'] === 'Package')!;
		const kept = ours.filter((e) => !removed.has(e['@id']));
		pkg.ownedRelationship = (pkg.ownedRelationship as { '@id': string }[]).filter(
			(r) => !removed.has(r['@id'])
		);
		const plan = await planPush(api, id, branch!, kept);
		expect(plan.matched).toBeGreaterThan(14);
		// Engine's name and the package's list changed; car, its membership and typing went.
		expect(plan.changes.created).toEqual([]);
		expect(plan.changes.updated.map((e) => e['@type']).sort()).toEqual([
			'Package',
			'PartDefinition'
		]);
		expect(plan.changes.deleted).toHaveLength(3);
		await push(api, id, branch!, plan, 'Rename Engine');
		const head = server.headElements(id);
		expect(head.find((e) => e.declaredName === 'Motor')?.['@id']).toBe(
			garage().find((e) => e.declaredName === 'Engine')!['@id']
		);
		expect(head.some((e) => e.declaredName === 'car')).toBe(false);
		// Saving again changes nothing.
		const [after] = await api.branches(id);
		const again = await planPush(api, id, after!, kept);
		expect(changeCount(again.changes)).toBe(0);
	});
});

/** The elements with fresh ids, as another tool would have them. */
function renumber(elements: ElementJson[]): ElementJson[] {
	const map = new Map(
		elements.map((e, i) => [e['@id'], `11111111-2222-4333-8444-${String(i).padStart(12, '0')}`])
	);
	const swap = (v: unknown): unknown =>
		v && typeof v === 'object' && !Array.isArray(v) && '@id' in v
			? { '@id': map.get((v as { '@id': string })['@id']) ?? (v as { '@id': string })['@id'] }
			: Array.isArray(v)
				? v.map(swap)
				: v;
	return elements.map((e) => {
		const out: ElementJson = { '@id': map.get(e['@id'])!, '@type': e['@type'] };
		for (const [k, v] of Object.entries(e)) if (k !== '@id' && k !== '@type') out[k] = swap(v);
		if (out.elementId) out.elementId = out['@id'];
		return out;
	});
}

const refersTo = (e: ElementJson, id: string) =>
	JSON.stringify(e.owningRelatedElement) === JSON.stringify({ '@id': id }) ||
	JSON.stringify(e.ownedRelatedElement) === JSON.stringify([{ '@id': id }]);
