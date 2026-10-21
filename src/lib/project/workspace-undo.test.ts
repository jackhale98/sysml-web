import { describe, expect, it } from 'vitest';
import { Workspace } from './workspace.svelte.ts';

describe('Workspace undo', () => {
	it('puts changed files back and removes files the edit created', async () => {
		const workspace = new Workspace();
		workspace.preview({
			id: 'p',
			info: { name: 'P' },
			files: [{ path: 'a.sysml', text: 'package A {\n}\n' }]
		});
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
});
