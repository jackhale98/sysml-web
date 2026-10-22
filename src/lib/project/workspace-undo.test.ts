import { describe, expect, it } from 'vitest';
import { Workspace } from './workspace.svelte.ts';

function project(files: Record<string, string>): Workspace {
	const workspace = new Workspace();
	workspace.preview({
		id: 'p',
		info: { name: 'P' },
		files: Object.entries(files).map(([path, text]) => ({ path, text }))
	});
	return workspace;
}

/** What the workspace tells listeners about files that move or go. */
function moves(workspace: Workspace): [string, string | null][] {
	const heard: [string, string | null][] = [];
	workspace.onFileMoved((from, to) => heard.push([from, to]));
	return heard;
}

describe('Workspace undo', () => {
	it('puts changed files back and removes files the edit created', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n' });
		await workspace.transact('Imported 2 requirements', async () => {
			workspace.setText('a.sysml', 'package A {\n    part x;\n}\n');
			workspace.setText('requirements/Imported.sysml', 'package Imported {\n}\n');
			return null;
		});
		expect(workspace.paths).toEqual(['a.sysml', 'requirements/Imported.sysml']);
		expect(workspace.undo()).toBe('Imported 2 requirements');
		expect(workspace.paths).toEqual(['a.sysml']);
		expect(workspace.text('a.sysml')).toBe('package A {\n}\n');
		expect(workspace.dirty.has('requirements/Imported.sysml')).toBe(false);
	});

	it('creates a file as one step, and undo takes it out and closes its tabs', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n' });
		const heard = moves(workspace);
		expect(await workspace.createFile('structure/Power.sysml', 'package Power {\n}\n')).toBeNull();
		expect(workspace.text('structure/Power.sysml')).toBe('package Power {\n}\n');
		expect(workspace.undoStack).toHaveLength(1);
		expect(await workspace.createFile('structure/Power.sysml', 'x')).toMatch(/exists already/);
		expect(workspace.undoStack).toHaveLength(1);
		expect(workspace.undo()).toBe('Created structure/Power.sysml');
		expect(workspace.paths).toEqual(['a.sysml']);
		expect(heard).toEqual([['structure/Power.sysml', null]]);
	});

	it('renames a file as one step, and undo moves it back with its tabs', async () => {
		const workspace = project({
			'a.sysml': 'package A {\n}\n',
			'structure/Power.sysml': 'package Power {\n    part def Battery;\n}\n'
		});
		const heard = moves(workspace);
		expect(await workspace.renameFile('structure/Power.sysml', 'parts/Supply.sysml')).toBeNull();
		expect(workspace.paths).toEqual(['a.sysml', 'parts/Supply.sysml']);
		expect(workspace.text('parts/Supply.sysml')).toContain('part def Battery;');
		expect(workspace.dirty.has('parts/Supply.sysml')).toBe(true);
		expect(heard).toEqual([['structure/Power.sysml', 'parts/Supply.sysml']]);
		expect(workspace.undoStack).toHaveLength(1);

		expect(workspace.undo()).toBe('Renamed structure/Power.sysml to parts/Supply.sysml');
		expect(workspace.paths).toEqual(['a.sysml', 'structure/Power.sysml']);
		expect(workspace.text('structure/Power.sysml')).toBe(
			'package Power {\n    part def Battery;\n}\n'
		);
		expect(heard.at(-1)).toEqual(['parts/Supply.sysml', 'structure/Power.sysml']);
		expect(heard).toHaveLength(2);
	});

	it('refuses to rename onto a file that exists, or a file that does not', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n', 'b.sysml': 'package B {\n}\n' });
		expect(await workspace.renameFile('a.sysml', 'b.sysml')).toMatch(/exists already/);
		expect(await workspace.renameFile('c.sysml', 'd.sysml')).toMatch(/not in the project/);
		expect(workspace.paths).toEqual(['a.sysml', 'b.sysml']);
		expect(workspace.undoStack).toHaveLength(0);
	});

	it('deletes a file as one step, and undo restores it', async () => {
		const workspace = project({
			'a.sysml': 'package A {\n}\n',
			'structure/Power.sysml': 'package Power {\n}\n'
		});
		const heard = moves(workspace);
		expect(await workspace.deleteFile('structure/Power.sysml')).toBeNull();
		expect(workspace.paths).toEqual(['a.sysml']);
		expect(heard).toEqual([['structure/Power.sysml', null]]);
		expect(workspace.undo()).toBe('Deleted structure/Power.sysml');
		expect(workspace.text('structure/Power.sysml')).toBe('package Power {\n}\n');
		expect(workspace.paths).toEqual(['a.sysml', 'structure/Power.sysml']);
	});

	it('makes a transaction inside another part of it: one undo step for both', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n', 'b.sysml': 'package B {\n}\n' });
		await workspace.transact('Tidied up', async () => {
			await workspace.deleteFile('b.sysml');
			await workspace.renameFile('a.sysml', 'model/A.sysml');
			workspace.setText('model/A.sysml', 'package A {\n    part x;\n}\n');
			return null;
		});
		expect(workspace.undoStack.map((e) => e.label)).toEqual(['Tidied up']);
		expect(workspace.paths).toEqual(['model/A.sysml']);
		workspace.undo();
		expect(workspace.files).toEqual({
			'a.sysml': 'package A {\n}\n',
			'b.sysml': 'package B {\n}\n'
		});
	});
});
