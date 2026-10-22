/**
 * Making, renaming, moving and deleting the project's files: each is one
 * undoable step, confirmed by a toast with Undo (`undoable`).
 */
import { folderOf, nameOf } from '#lib/project/filenames.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import { undoable } from '../actions.ts';

/** Add a model file and open it (as text: there is nothing to draw yet). */
export async function createFile(
	workspace: Workspace,
	path: string,
	text: string,
	open: (path: string) => void
): Promise<string | null> {
	const error = await undoable(workspace, `Created ${path}`, () =>
		workspace.createFile(path, text)
	);
	if (!error) open(path);
	return error;
}

/** "Renamed Power.sysml to Supply.sysml", "Moved Power.sysml to parts/". */
export function renameLabel(from: string, to: string): string {
	if (folderOf(from) === folderOf(to)) return `Renamed ${nameOf(from)} to ${nameOf(to)}`;
	const folder = folderOf(to);
	return `Moved ${nameOf(from)} to ${folder ? `${folder}/` : 'the top level'}`;
}

/** Give a file another path; only the path changes. */
export function renameFile(workspace: Workspace, from: string, to: string): Promise<string | null> {
	return undoable(workspace, renameLabel(from, to), () => workspace.renameFile(from, to));
}

/** Take a file out; `breaks` (what stops resolving) is said in the toast. */
export function deleteFile(
	workspace: Workspace,
	path: string,
	breaks: string[] = []
): Promise<string | null> {
	return undoable(workspace, `Deleted ${nameOf(path)}`, async () => {
		const error = await workspace.deleteFile(path);
		if (!error) workspace.warnings.push(...breaks);
		return error;
	});
}

/** The project's own views that use what a library file defines (by their view def). */
export function viewsUsing(workspace: Workspace, path: string): string[] {
	if (!isLibraryFile(path)) return [];
	const defined = new Set(
		workspace.views.filter((v) => v.file === path && !v.isUsage).map((v) => v.name)
	);
	const qualified = new Set(
		workspace.views
			.filter((v) => v.file === path && !v.isUsage && v.qualifiedName)
			.map((v) => v.qualifiedName!)
	);
	return workspace.views
		.filter(
			(v) =>
				v.isUsage &&
				!v.builtin &&
				v.file !== path &&
				!!v.definition &&
				(defined.has(v.definition) ||
					qualified.has(v.definition) ||
					defined.has(v.definition.split('::').pop()!))
		)
		.map((v) => v.name);
}
