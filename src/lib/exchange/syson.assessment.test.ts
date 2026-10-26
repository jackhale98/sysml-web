/**
 * Assessment (§3, question 3): Fairtide's Systems Modeling API client against
 * a server that answers as Eclipse SysON v2026.9.3 did when checked live on
 * 2026-10-23 (tools/interop; docs/assessment/03-interchange.md):
 *
 * - `POST /projects` needs `?name=`; with only a JSON body it answers 200
 *   with its web page (HTML) and creates nothing.
 * - A commit whose `identity` lacks `"@type": "DataIdentity"` answers 200
 *   with its web page and changes nothing.
 * - With the `@type`: a full element payload (as Fairtide sends it) answers
 *   200 with an empty body and changes nothing; a minimal payload changing a
 *   property of an element it has answers 201 and applies it; new elements
 *   answer 201 and are dropped.
 *
 * Correct behaviour: Fairtide creates and saves where the server allows it,
 * and never reports a save as done when the server did not keep it. (The
 * same answers were checked live against SysON v2026.9.3 again on
 * 2026-10-26: docs/interchange.md.)
 */
import { describe, expect, it } from 'vitest';
import { SysmlApi } from './api';
import type { ElementJson } from './elements';
import { changeCount, planPush, push } from './sync';

const BASE = 'http://syson.test/api/rest';
const PAGE = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8" /></head></html>';
const PROJECT = '11111111-1111-4111-8111-111111111111';

/** A fake with SysON's observed answers. One project, one branch; its "commit" is the project id. */
function sysonLike(initial: ElementJson[]) {
	const elements = new Map(initial.map((e) => [e['@id'], { ...e }]));
	const projects: { '@id': string; name: string }[] = [];
	const answer = (status: number, body: unknown, type = 'application/json') =>
		new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status,
			headers: { 'content-type': type }
		});
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const path = url.pathname.replace('/api/rest', '');
		const method = init?.method ?? 'GET';
		if (method === 'POST' && path === '/projects') {
			const name = url.searchParams.get('name');
			if (!name) return answer(200, PAGE, 'text/html');
			const project = { '@id': PROJECT, '@type': 'Project', name };
			projects.push(project);
			return answer(201, { ...project, defaultBranch: { '@id': PROJECT } });
		}
		if (method === 'GET' && path === '/projects') return answer(200, projects);
		if (method === 'GET' && path === `/projects/${PROJECT}`)
			return answer(200, { '@id': PROJECT, name: 'p', defaultBranch: { '@id': PROJECT } });
		if (method === 'GET' && path === `/projects/${PROJECT}/branches`)
			return answer(200, [{ '@id': PROJECT, name: 'defaultBranch', head: { '@id': PROJECT } }]);
		if (method === 'GET' && path === `/projects/${PROJECT}/commits/${PROJECT}/elements`)
			return answer(200, [...elements.values()]);
		if (method === 'POST' && path === `/projects/${PROJECT}/commits`) {
			const body = JSON.parse(String(init?.body)) as {
				change: { identity: Record<string, unknown>; payload: ElementJson | null }[];
			};
			if (body.change.some((c) => c.identity['@type'] !== 'DataIdentity'))
				return answer(200, PAGE, 'text/html');
			// A payload with every property (as Fairtide sends) fails inside the server.
			if (body.change.some((c) => c.payload && Object.keys(c.payload).length > 6))
				return answer(200, '');
			for (const c of body.change) {
				const known = c.payload && elements.get(c.payload['@id']);
				if (known) Object.assign(known, c.payload); // new elements: dropped
			}
			return answer(201, { '@id': crypto.randomUUID(), '@type': 'Commit' });
		}
		return answer(404, 'not found', 'text/plain');
	}) as typeof globalThis.fetch;
	return { fetch, elements, projects };
}

const part = (id: string, name: string, extra: Record<string, unknown> = {}): ElementJson => ({
	'@id': id,
	'@type': 'PartDefinition',
	declaredName: name,
	...extra
});

describe('Fairtide and a SysON server', () => {
	it('creates a project there', async () => {
		const server = sysonLike([]);
		const api = new SysmlApi(BASE, null, server.fetch);
		await api.createProject('From Fairtide');
		expect(server.projects.map((p) => p.name)).toEqual(['From Fairtide']);
	});

	it('says that creating failed when the server answers with its web page, and why', async () => {
		const server = sysonLike([]);
		// A server that answers every new project with its web page (as SysON does without ?name=).
		const page = (async (input: string | URL | Request, init?: RequestInit) =>
			init?.method === 'POST'
				? new Response(PAGE, { headers: { 'content-type': 'text/html' } })
				: server.fetch(input, init)) as typeof globalThis.fetch;
		const api = new SysmlApi(BASE, null, page);
		const error = await api.createProject('From Fairtide').then(
			() => new Error('created'),
			(e: unknown) => e as Error
		);
		expect(error).toMatchObject({ kind: 'format' });
		expect(error.message).toMatch(/didn’t take the request: it answered with a web page/);
		// Not a question about the address: the address answered, as the API, to reads.
		expect(error.message).not.toMatch(/address/);
		expect(server.projects).toEqual([]);
	});

	it('saves a changed element there, sending only what changed', async () => {
		const wheel = part('w1', 'Wheel');
		const server = sysonLike([wheel]);
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(PROJECT);
		const plan = await planPush(api, PROJECT, branch!, [part('w1', 'Rim')]);
		expect(changeCount(plan.changes)).toBe(1);
		await push(api, PROJECT, branch!, plan, 'rename');
		expect(server.elements.get('w1')!.declaredName).toBe('Rim');
	});

	it('changes a property of an element with many properties (the payload holds only the change)', async () => {
		const many = {
			isAbstract: false,
			isVariation: false,
			isIndividual: false,
			isSufficient: false
		};
		const server = sysonLike([part('w1', 'Wheel', many)]);
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(PROJECT);
		const plan = await planPush(api, PROJECT, branch!, [
			part('w1', 'Wheel', { ...many, isAbstract: true })
		]);
		await push(api, PROJECT, branch!, plan, 'abstract');
		expect(server.elements.get('w1')!.isAbstract).toBe(true);
	});

	it('says that saving failed when the server answers with nothing, and the server is unchanged', async () => {
		const server = sysonLike([part('w1', 'Wheel')]);
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(PROJECT);
		// A new element with all its properties: SysON answers 200 with an empty body and keeps nothing.
		const rim = part('n1', 'Rim', {
			isAbstract: false,
			isVariation: false,
			isIndividual: false,
			isSufficient: false
		});
		const plan = await planPush(api, PROJECT, branch!, [part('w1', 'Tyre'), rim]);
		expect(changeCount(plan.changes)).toBe(2);
		await expect(push(api, PROJECT, branch!, plan, 'two changes')).rejects.toThrow(
			'syson.test didn’t keep all of this save. Read back from the server, the new element is missing (Rim); the changed element is not as sent (Tyre). Your project here still has all of it.'
		);
		expect(server.elements.get('w1')!.declaredName).toBe('Wheel');
	});

	it('does not report a save as done when the server dropped new elements', async () => {
		const server = sysonLike([part('w1', 'Wheel')]);
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(PROJECT);
		const plan = await planPush(api, PROJECT, branch!, [part('w1', 'Wheel'), part('n1', 'Rim')]);
		expect(plan.changes.created.map((e) => e.declaredName)).toEqual(['Rim']);
		const saved = await push(api, PROJECT, branch!, plan, 'add Rim').then(
			() => 'reported as saved',
			(e: unknown) => `reported as failed: ${(e as Error).message}`
		);
		expect(server.elements.has('n1')).toBe(false); // the server dropped it
		expect(saved).toMatch(/^reported as failed: .*the new element is missing \(Rim\)/);
	});
});
