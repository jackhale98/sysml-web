/**
 * Model-editing intents shared by diagrams, explorer and inspector. Each one
 * asks the engine for a minimal text edit and applies it to the workspace.
 * Results are `null` on success or a message to show.
 */
import type { ModelElement } from '#lib/project/elements.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { elementText, formatName, type AddKind } from './templates';

export async function addElement(
	workspace: Workspace,
	owner: ModelElement,
	kind: AddKind,
	name: string,
	type = ''
): Promise<string | null> {
	if (!name.trim()) return 'Give the new element a name.';
	const source = workspace.text(owner.file);
	if (source === undefined) return `${owner.file} is not open.`;
	return workspace.edit(owner.file, {
		op: 'insertMember',
		path: owner.file,
		source,
		parent: owner.name,
		text: elementText(kind, name, type)
	});
}

/** Rename an element and its references, in every file that mentions it. */
export async function renameElement(
	workspace: Workspace,
	element: ModelElement,
	newName: string
): Promise<string | null> {
	const to = formatName(newName);
	if (!newName.trim()) return 'A name cannot be empty.';
	if (to === element.name) return null;
	const word = new RegExp(`(^|[^A-Za-z0-9_'])${escapeRegExp(element.name)}($|[^A-Za-z0-9_'])`);
	for (const path of workspace.modelPaths) {
		const source = workspace.text(path);
		if (source === undefined || !word.test(source)) continue;
		const error = await workspace.edit(path, {
			op: 'rename',
			path,
			source,
			from: element.name,
			to
		});
		if (error) return error;
	}
	return null;
}

export async function deleteElement(
	workspace: Workspace,
	element: ModelElement
): Promise<string | null> {
	const source = workspace.text(element.file);
	if (source === undefined) return `${element.file} is not open.`;
	return workspace.edit(element.file, {
		op: 'remove',
		path: element.file,
		source,
		name: element.name
	});
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
