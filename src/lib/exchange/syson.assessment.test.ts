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
 * and never reports a save as done when the server did not keep it.
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
	// Known gap: createProject sends a JSON body; SysON needs ?name= and answers with its web page.
	it.fails('creates a project there', async () => {
		const server = sysonLike([]);
		const api = new SysmlApi(BASE, null, server.fetch);
		await api.createProject('From Fairtide');
		expect(server.projects.map((p) => p.name)).toEqual(['From Fairtide']);
	});

	it('says that creating failed (it does not claim a project was made)', async () => {
		const server = sysonLike([]);
		const api = new SysmlApi(BASE, null, server.fetch);
		await expect(api.createProject('From Fairtide')).rejects.toMatchObject({ kind: 'format' });
		expect(server.projects).toEqual([]);
	});

	// Known gap: the commit's identity has no "@type": "DataIdentity", and payloads carry every property; SysON keeps nothing.
	it.fails('saves a changed element there', async () => {
		const wheel = part('w1', 'Wheel');
		const server = sysonLike([wheel]);
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(PROJECT);
		const plan = await planPush(api, PROJECT, branch!, [part('w1', 'Rim')]);
		expect(changeCount(plan.changes)).toBe(1);
		await push(api, PROJECT, branch!, plan, 'rename');
		expect(server.elements.get('w1')!.declaredName).toBe('Rim');
	});

	it('says that saving failed, and the server is unchanged', async () => {
		const server = sysonLike([part('w1', 'Wheel')]);
		const api = new SysmlApi(BASE, null, server.fetch);
		const [branch] = await api.branches(PROJECT);
		const plan = await planPush(api, PROJECT, branch!, [part('w1', 'Rim')]);
		await expect(push(api, PROJECT, branch!, plan, 'rename')).rejects.toThrow(
			/something other than JSON/
		);
		expect(server.elements.get('w1')!.declaredName).toBe('Wheel');
	});

	// Known gap: a save is reported done when the server answers 201; nothing reads the branch back. Today SysON never gets that far (above); once the identity is fixed, SysON's dropping of new elements would pass as saved.
	it.fails('does not report a save as done when the server dropped new elements', async () => {
		const server = sysonLike([part('w1', 'Wheel')]);
		// The client as it would be with the identity fixed (minimal payloads, typed identity).
		const typed = (async (input: string | URL | Request, init?: RequestInit) => {
			if (init?.method === 'POST' && String(input).includes('/commits')) {
				const body = JSON.parse(String(init.body)) as {
					change: { identity: Record<string, unknown>; payload: ElementJson | null }[];
				};
				for (const c of body.change) c.identity['@type'] = 'DataIdentity';
				init = { ...init, body: JSON.stringify(body) };
			}
			return server.fetch(input, init);
		}) as typeof globalThis.fetch;
		const api = new SysmlApi(BASE, null, typed);
		const [branch] = await api.branches(PROJECT);
		const plan = await planPush(api, PROJECT, branch!, [part('w1', 'Wheel'), part('n1', 'Rim')]);
		expect(plan.changes.created.map((e) => e.declaredName)).toEqual(['Rim']);
		const saved = await push(api, PROJECT, branch!, plan, 'add Rim').then(
			() => 'reported as saved',
			() => 'reported as failed'
		);
		expect(server.elements.has('n1')).toBe(false); // the server dropped it
		expect(saved).toBe('reported as failed');
	});
});
