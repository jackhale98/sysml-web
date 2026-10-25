import { describe, expect, it } from 'vitest';
import { applyChanges, Workspace } from './workspace.svelte.ts';

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

	it('keeps what was typed in the file after the edit, also right next to it', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n    part def B;\n}\n' });
		await workspace.transact('Added part x to A', async () => {
			workspace.setText('a.sysml', 'package A {\n    part def B;\n    part x;\n}\n');
			return null;
		});
		// Typed on the line before, at the end of the edit's own line, and after it.
		workspace.setText(
			'a.sysml',
			'package A {\n    part def B; // typed\n    part x;\n    part y;\n}\n// end\n'
		);
		expect(workspace.undo()).toBe('Added part x to A');
		expect(workspace.text('a.sysml')).toBe(
			'package A {\n    part def B; // typed\n    part y;\n}\n// end\n'
		);
		expect(workspace.undoStack).toHaveLength(0);
	});

	it('refuses to undo an edit whose text was changed since, and changes nothing', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n', 'b.sysml': 'package B {\n}\n' });
		await workspace.transact('Added part x to A', async () => {
			workspace.setText('a.sysml', 'package A {\n    part x;\n}\n');
			workspace.setText('b.sysml', 'package B {\n    part y;\n}\n');
			return null;
		});
		const typed = 'package A {\n    part x : Engine;\n}\n';
		workspace.setText('a.sysml', typed);
		const files = { ...workspace.files };
		const outcome = workspace.undoEdit();
		expect(outcome).toEqual({
			refused:
				'Can’t undo “Added part x to A”: what it changed in a.sysml has been changed again since.'
		});
		expect(workspace.undo()).toBeNull();
		// Neither file changed, not even the one that could have been undone.
		expect(workspace.files).toEqual(files);
		expect(workspace.text('a.sysml')).toBe(typed);
		expect(workspace.undoStack).toHaveLength(1);
	});

	it('undoes the edit it is asked to, keeping the later ones', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n    part def B;\n    part def C;\n}\n' });
		await workspace.transact('Added part x to A', async () => {
			workspace.setText(
				'a.sysml',
				'package A {\n    part x;\n    part def B;\n    part def C;\n}\n'
			);
			return null;
		});
		const first = workspace.lastEdit!;
		await workspace.transact('Renamed C to D', async () => {
			workspace.setText(
				'a.sysml',
				'package A {\n    part x;\n    part def B;\n    part def D;\n}\n'
			);
			return null;
		});
		expect(workspace.lastEdit).not.toBe(first);
		expect(workspace.undoEdit(first)).toEqual({ undone: 'Added part x to A' });
		expect(workspace.text('a.sysml')).toBe('package A {\n    part def B;\n    part def D;\n}\n');
		expect(workspace.undoStack.map((e) => e.label)).toEqual(['Renamed C to D']);
		// Undone already: nothing to undo by that id any more.
		expect(workspace.undoEdit(first)).toBeNull();
		expect(workspace.undo()).toBe('Renamed C to D');
		expect(workspace.text('a.sysml')).toBe('package A {\n    part def B;\n    part def C;\n}\n');
	});

	it('refuses to remove a file it created once it has been typed in', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n' });
		await workspace.createFile('b.sysml', 'package B {\n}\n');
		workspace.setText('b.sysml', 'package B {\n    part typed;\n}\n');
		expect(workspace.undoEdit()).toEqual({
			refused:
				'Can’t undo “Created b.sysml”: b.sysml has been changed since, and undoing would remove it.'
		});
		expect(workspace.text('b.sysml')).toBe('package B {\n    part typed;\n}\n');
	});

	it('moves a renamed file back with what was typed in it since', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n', 'b.sysml': 'package B {\n}\n' });
		await workspace.renameFile('a.sysml', 'c.sysml');
		workspace.setText('c.sysml', 'package A {\n    part typed;\n}\n');
		expect(workspace.undo()).toBe('Renamed a.sysml to c.sysml');
		expect(workspace.paths).toEqual(['a.sysml', 'b.sysml']);
		expect(Object.keys(workspace.files)).toEqual(['a.sysml', 'b.sysml']);
		expect(workspace.text('a.sysml')).toBe('package A {\n    part typed;\n}\n');
	});

	it('undoes through the open editor, as changes to its text as it is now', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n' });
		const applied: unknown[] = [];
		workspace.attachEditor('a.sysml', {
			apply: (changes) => {
				applied.push(changes);
				workspace.setText('a.sysml', applyChanges(workspace.text('a.sysml')!, changes));
			}
		});
		await workspace.transact('Added part x to A', async () => {
			workspace.setText('a.sysml', 'package A {\n    part x;\n}\n');
			return null;
		});
		workspace.setText('a.sysml', '// typed\npackage A {\n    part x;\n}\n');
		workspace.undo();
		expect(applied).toEqual([[{ from: 21, to: 33, insert: '' }]]);
		expect(workspace.text('a.sysml')).toBe('// typed\npackage A {\n}\n');
	});

	it('takes an edit the text editor has undone already as undone', async () => {
		const workspace = project({ 'a.sysml': 'package A {\n}\n' });
		await workspace.transact('Added part x to A', async () => {
			workspace.setText('a.sysml', 'package A {\n    part x;\n}\n');
			return null;
		});
		workspace.setText('a.sysml', 'package A {\n}\n');
		expect(workspace.undo()).toBe('Added part x to A');
		expect(workspace.text('a.sysml')).toBe('package A {\n}\n');
	});

	it('gives each edit its own id, also once the history is full', async () => {
		const workspace = project({ 'a.sysml': '' });
		const ids = new Set<number | undefined>();
		for (let i = 0; i < 60; i++) {
			await workspace.transact(`Edit ${i}`, async () => {
				workspace.setText('a.sysml', `${i}\n`);
				return null;
			});
			ids.add(workspace.lastEdit);
		}
		expect(ids.size).toBe(60);
		expect(workspace.undoStack).toHaveLength(50);
	});
});
