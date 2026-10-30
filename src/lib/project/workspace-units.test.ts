/**
 * A value written with a unit its package can't resolve (`[kg]` without
 * `import SI::*`) brings the import with it, in the same undoable step.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '#lib/engine/client.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { SourceFile } from '#lib/engine/protocol.ts';
import type { EditRequest } from '#lib/engine/types.ts';
import { setField, withImported } from '#lib/workbench/actions.ts';
import { Workspace } from './workspace.svelte.ts';

let host: ToolkitHost;
const RIG = 'Rig.sysml';
const TEXT = `package Rig {
    private import ISQ::*;

    part def Motor {
        attribute mass :> ISQ::mass;
        attribute power :> ISQ::power;
    }
}
`;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

async function open(text = TEXT): Promise<Workspace> {
	const engine = {
		version: async () => host.version(),
		analyzeProject: async (f: SourceFile[]) => host.analyzeProject(f),
		listViews: async () => [],
		stateMachines: async () => [],
		variability: async () => ({ points: [], configurations: [] }),
		checks: async (f: SourceFile[]) => host.checks(f),
		edit: async (request: EditRequest) => host.edit(request),
		codeActions: async (f: SourceFile[], path: string, from: number, to: number) =>
			host.codeActions(f, path, from, to)
	} as unknown as Engine;
	const workspace = new Workspace();
	await workspace.open({ id: 'rig', info: { name: 'Rig' }, files: [{ path: RIG, text }] }, engine);
	return workspace;
}

/** Set an attribute's value as the inspector does. */
async function setValue(workspace: Workspace, name: string, value: string) {
	const source = workspace.text(RIG)!;
	let imported: string[] = [];
	const error = await workspace.transact(
		() => withImported(`Set ${name}`, imported),
		async () => {
			const failed = await workspace.edit(RIG, {
				op: 'setDeclaration',
				path: RIG,
				source,
				element: name,
				line: source.split('\n').findIndex((l) => l.includes(`attribute ${name}`)) + 1,
				set: { value }
			});
			if (!failed) imported = await workspace.importUnits(RIG, source);
			return failed;
		}
	);
	return { error, imported };
}

describe('units in a value', () => {
	it('import SI with the value, undone with it in one step', async () => {
		const workspace = await open();
		const { error, imported } = await setValue(workspace, 'mass', '2 [kg]');
		expect(error).toBeNull();
		expect(imported).toEqual(['SI']);
		expect(workspace.text(RIG)).toContain(
			'    private import ISQ::*;\n    private import SI::*;\n'
		);
		expect(workspace.text(RIG)).toContain('attribute mass :> ISQ::mass = 2 [kg];');
		expect(host.analyzeProject(workspace.sourceFiles())[0]!.diagnostics).toEqual([]);
		expect(workspace.undoStack.at(-1)!.label).toBe('Set mass, and imported the SI units it uses');
		// Another unit of the same library: nothing more to import.
		expect((await setValue(workspace, 'power', '30 [W]')).imported).toEqual([]);
		expect(workspace.text(RIG)!.match(/import SI::\*/g)).toHaveLength(1);
		workspace.undo();
		workspace.undo();
		expect(workspace.text(RIG)).toBe(TEXT);
	});

	it('import the library a unit is in', async () => {
		const workspace = await open();
		expect((await setValue(workspace, 'mass', '4 [lb]')).imported).toEqual(['USCustomaryUnits']);
		expect(workspace.text(RIG)).toContain('private import USCustomaryUnits::*;');
	});

	it('leave a unit that resolves, or one no library has, as it is', async () => {
		const workspace = await open(TEXT.replace('ISQ::*;', 'ISQ::*;\n    private import SI::*;'));
		const before = workspace.text(RIG)!;
		expect((await setValue(workspace, 'mass', '2 [kg]')).imported).toEqual([]);
		expect((await setValue(workspace, 'power', '2 [mW]')).imported).toEqual([]);
		expect(workspace.text(RIG)!.replace(/ = 2 \[(kg|mW)\]/g, '')).toBe(before);
	});

	it('a table cell does the same', async () => {
		const workspace = await open(TEXT.replace('    }\n}', '    }\n    part motor : Motor;\n}'));
		const line =
			workspace
				.text(RIG)!
				.split('\n')
				.findIndex((l) => l.includes('part motor')) + 1;
		const error = await setField(
			workspace,
			{ element: 'motor', file: RIG, line },
			'feature:mass',
			'1.2 [kg]',
			'Set the mass of motor to 1.2 [kg]'
		);
		expect(error).toBeNull();
		expect(workspace.text(RIG)).toContain('private import SI::*;');
		expect(workspace.undoStack.at(-1)!.label).toBe(
			'Set the mass of motor to 1.2 [kg], and imported the SI units it uses'
		);
	});
});
