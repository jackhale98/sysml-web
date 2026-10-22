import { describe, expect, it } from 'vitest';
import type { ViewInfo } from '#lib/engine/types.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { renameLabel, viewsUsing } from './fileActions.ts';

const view = (name: string, file: string, extra: Partial<ViewInfo> = {}): ViewInfo => ({
	name,
	file,
	isUsage: true,
	hasTable: false,
	builtin: false,
	...extra
});

describe('file actions', () => {
	it('names a rename and a move in plain words', () => {
		expect(renameLabel('structure/Power.sysml', 'structure/Supply.sysml')).toBe(
			'Renamed Power.sysml to Supply.sysml'
		);
		expect(renameLabel('structure/Power.sysml', 'parts/Power.sysml')).toBe(
			'Moved Power.sysml to parts/'
		);
		expect(renameLabel('structure/Power.sysml', 'Power.sysml')).toBe(
			'Moved Power.sysml to the top level'
		);
	});

	it('finds the views drawn with what a library file defines', () => {
		const workspace = {
			views: [
				view('RequirementsTable', 'libraries/ModelViews.sysml', {
					isUsage: false,
					qualifiedName: 'ModelViews::RequirementsTable'
				}),
				view('requirements', 'views/Views.sysml', { definition: 'RequirementsTable' }),
				view('gaps', 'views/Views.sysml', { definition: 'ModelViews::RequirementsTable' }),
				view('structure', 'views/Views.sysml', { definition: 'GeneralView' }),
				view('GeneralView', 'std/Views.sysml', { isUsage: false, builtin: true })
			]
		} as unknown as Workspace;
		expect(viewsUsing(workspace, 'libraries/ModelViews.sysml')).toEqual(['requirements', 'gaps']);
		// Only library files warn about it.
		expect(viewsUsing(workspace, 'views/Views.sysml')).toEqual([]);
	});
});
