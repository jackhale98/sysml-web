/**
 * Model-editing intents shared by diagrams, explorer and inspector. Each one
 * asks the engine for a minimal text edit and applies it to the workspace.
 * Results are `null` on success or a message to show.
 */
import type { ModelElement } from '#lib/project/elements.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import { elementText, formatName, type AddKind } from './templates';

/**
 * Run an edit as one undoable step and confirm it with a toast that offers
 * Undo, so every gesture is safe to try.
 */
async function undoable(
	workspace: Workspace,
	label: string,
	run: () => Promise<string | null>
): Promise<string | null> {
	const before = workspace.undoStack.length;
	const error = await workspace.transact(label, run);
	if (!error && workspace.undoStack.length > before) {
		toasts.show(label, {
			tone: 'success',
			action: {
				label: 'Undo',
				run: () => {
					const undone = workspace.undo();
					if (undone) toasts.show(`Undid: ${undone}`);
				}
			}
		});
	}
	return error;
}

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
	return undoable(workspace, `Added ${kind} ${formatName(name)} to ${owner.label}`, () =>
		workspace.edit(owner.file, {
			op: 'insertMember',
			path: owner.file,
			source,
			parent: owner.name,
			text: elementText(kind, name, type)
		})
	);
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
	return undoable(workspace, `Renamed ${element.label} to ${to}`, async () => {
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
	});
}

export async function deleteElement(
	workspace: Workspace,
	element: ModelElement
): Promise<string | null> {
	const source = workspace.text(element.file);
	if (source === undefined) return `${element.file} is not open.`;
	return undoable(workspace, `Deleted ${element.label}`, () =>
		workspace.edit(element.file, {
			op: 'remove',
			path: element.file,
			source,
			name: element.name
		})
	);
}

/** Change one table cell: the model value behind it, as a minimal SysML edit. */
export async function setField(
	workspace: Workspace,
	source: { element: string; file: string; line: number },
	field: string,
	value: string,
	label: string
): Promise<string | null> {
	const text = workspace.text(source.file);
	if (text === undefined) return `${source.file} is not in the project.`;
	return undoable(workspace, label, () =>
		workspace.edit(source.file, {
			op: 'setField',
			path: source.file,
			source: text,
			element: source.element,
			line: source.line,
			field,
			value,
			files: workspace.sourceFiles()
		})
	);
}

/** Choose and order a table view's columns (its @TableRendering). */
export async function setTableColumns(
	workspace: Workspace,
	file: string,
	view: string,
	columns: string[]
): Promise<string | null> {
	const text = workspace.text(file);
	if (text === undefined) return `${file} is not in the project.`;
	return undoable(workspace, `Changed the columns of ${view}`, () =>
		workspace.edit(file, { op: 'setTableColumns', path: file, source: text, view, columns })
	);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
