/**
 * Deleting a file says what would stop resolving: the check an element's
 * delete makes, applied to the file's top-level packages, on the toolkit.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '#lib/engine/client.ts';
import type { EditRequest } from '#lib/engine/types.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { Workspace } from './workspace.svelte.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const engine = () =>
	({
		version: async () => host.version(),
		analyzeProject: async (f: { path: string; text: string }[]) => host.analyzeProject(f),
		listViews: async () => [],
		stateMachines: async () => [],
		checks: async () => null,
		edit: async (request: EditRequest) => host.edit(request)
	}) as unknown as Engine;

const MAIN = `package Main {
    private import Power::*;
    part battery : Battery;
}
`;
const POWER = `package Power {
    part def Battery;
}
`;

describe('what stops resolving without a file', () => {
	it("names the references into the file's packages, and changes nothing", async () => {
		const workspace = new Workspace();
		await workspace.open(
			{
				id: 'p',
				info: { name: 'P' },
				files: [
					{ path: 'Main.sysml', text: MAIN },
					{ path: 'structure/Power.sysml', text: POWER }
				]
			},
			engine()
		);
		expect(workspace.problems.filter((p) => p.severity === 'error')).toEqual([]);
		const warnings = await workspace.whatBreaksWithout('structure/Power.sysml');
		expect(warnings.join(' ')).toMatch(/no longer resolve/);
		expect(workspace.text('structure/Power.sysml')).toBe(POWER);
		expect(await workspace.whatBreaksWithout('Main.sysml')).toEqual([]);
	});
});
