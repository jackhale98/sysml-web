/**
 * Saving to a server when someone else saved meanwhile, as the dialog does
 * it: the in-memory server (`api-mock.ts`), the engine's code run in Node
 * (`loadHost`), the planner and the weave.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '#lib/engine/client.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { dataVersions, SysmlApi } from './api';
import { MockApiServer } from './api-mock';
import { readElements, type ElementJson } from './elements';
import { changeLine } from './merge';
import { planMergeSave, pushPlanAgainst, weaveMerge } from './sync';

let host: ToolkitHost;
let engine: Engine;
beforeAll(async () => {
	host = await loadHost();
	engine = {
		exportInterchange: async (...a: Parameters<ToolkitHost['exportInterchange']>) =>
			host.exportInterchange(...a),
		mergeInputs: async (...a: Parameters<ToolkitHost['mergeInputs']>) => host.mergeInputs(...a),
		weaveInterchange: async (...a: Parameters<ToolkitHost['weaveInterchange']>) =>
			host.weaveInterchange(...a)
	} as unknown as Engine;
}, 60_000);

const garage = () =>
	readElements(readFileSync(join(import.meta.dirname, 'fixtures/garage.json'), 'utf8'));

/** A new part definition in the package named `owner`, as another tool would add it. */
function addPartDef(elements: ElementJson[], owner: string, name: string) {
	const pkg = elements.find((e) => e.declaredName === owner)!;
	const membership = `m-${name}`;
	const id = `e-${name}`;
	elements.push(
		{
			'@id': membership,
			'@type': 'OwningMembership',
			owningRelatedElement: { '@id': pkg['@id'] },
			ownedRelatedElement: [{ '@id': id }],
			visibility: 'public'
		},
		{
			'@id': id,
			'@type': 'PartDefinition',
			declaredName: name,
			owningRelationship: { '@id': membership }
		}
	);
	(pkg.ownedRelationship as unknown[]).push({ '@id': membership });
}

describe('saving after someone else saved', () => {
	it('brings theirs in and sends mine on top', async () => {
		const server = new MockApiServer();
		const projectId = server.addProject('Garage', garage());
		const api = new SysmlApi('https://sysml.example.org', null, server.fetch);
		const [opened] = await api.branches(projectId);
		const files = host.importInterchange(JSON.stringify(server.headElements(projectId))).files;

		server.commitAs(projectId, 'A trailer', (elements) =>
			addPartDef(elements, 'Garage', 'Trailer')
		);
		const mine = files.map((f) => ({
			path: f.path,
			text: f.text.replace('    part car : Vehicle;', '    part car : Vehicle;\n    part def Bike;')
		}));
		const [branch] = await api.branches(projectId);
		expect(branch!.head).not.toBe(opened!.head);

		const steps: string[] = [];
		const save = await planMergeSave(
			api,
			engine,
			projectId,
			opened!.head!,
			branch!.head!,
			mine,
			(s) => steps.push(s)
		);
		expect(steps).toContain('Comparing the changes…');
		expect(save.plan.incoming.map(changeLine)).toEqual(['Added part def Trailer to Garage']);
		expect(save.plan.outgoing.map(changeLine)).toEqual(['Added part def Bike to Garage']);
		expect(save.plan.conflicts).toEqual([]);
		expect(save.preview?.files.map((f) => f.path)).toEqual(['Garage.sysml']);

		const woven = await weaveMerge(engine, save, mine, {});
		const after = mine.map((f) => woven.files.find((w) => w.path === f.path) ?? f);
		expect(after[0]!.text).toContain('part def Trailer;\n    part def Bike;');

		const ours = readElements(host.exportInterchange(after, {}).json);
		const push = pushPlanAgainst(save.head, save.headElements, ours);
		// Only the bike goes: the trailer is the server's already, with its ids.
		expect(push.changes.created.map((e) => e['@type']).sort()).toEqual([
			'OwningMembership',
			'PartDefinition'
		]);
		// The package lists the bike; their membership gets the member the other tool left out.
		expect(push.changes.updated.map((e) => e['@type']).sort()).toEqual([
			'OwningMembership',
			'Package'
		]);
		expect(push.changes.deleted).toEqual([]);
		await api.commit(projectId, branch!.id, dataVersions(push.changes), 'A bike');
		const names = server.headElements(projectId).map((e) => e.declaredName);
		expect(names).toEqual(expect.arrayContaining(['Trailer', 'Bike', 'car']));
		expect(server.headElements(projectId).filter((e) => e.declaredName === 'Trailer')).toEqual([
			expect.objectContaining({ '@id': 'e-Trailer' })
		]);
	}, 60_000);

	it('says plainly when the project has syntax errors', async () => {
		const server = new MockApiServer();
		const projectId = server.addProject('Garage', garage());
		const api = new SysmlApi('https://sysml.example.org', null, server.fetch);
		const [opened] = await api.branches(projectId);
		server.commitAs(projectId, 'A trailer', (elements) =>
			addPartDef(elements, 'Garage', 'Trailer')
		);
		const [branch] = await api.branches(projectId);
		const broken = [{ path: 'Garage.sysml', text: 'package Garage { part def }' }];
		await expect(
			planMergeSave(api, engine, projectId, opened!.head!, branch!.head!, broken)
		).rejects.toThrow(/Fix the syntax errors in Garage\.sysml first/);
	}, 60_000);
});
