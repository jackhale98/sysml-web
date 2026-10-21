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

/**
 * One change of a model edit made on a diagram: a member the engine places
 * in a definition or package, or a text patch computed against the file as
 * it is now (`before`), for what the engine cannot edit yet.
 */
export type EditStep =
	| { kind: 'member'; path: string; parent: string; text: string }
	| { kind: 'patch'; path: string; before: string; after: string };

/**
 * Apply edit steps as one undoable change, confirmed by a toast with Undo
 * ("Battery is now part of DeliveryDrone"). `check` can refuse a patched
 * text, e.g. when it would not parse.
 */
export async function applySteps(
	workspace: Workspace,
	label: string,
	steps: EditStep[],
	check?: (path: string, before: string, after: string) => Promise<string | null>
): Promise<string | null> {
	if (!steps.length) return 'Nothing to change.';
	return undoable(workspace, label, async () => {
		for (const step of steps) {
			const source = workspace.text(step.path);
			if (source === undefined) return `${step.path} is not in the project.`;
			if (step.kind === 'member') {
				const error = await workspace.edit(step.path, {
					op: 'insertMember',
					path: step.path,
					source,
					parent: step.parent,
					text: step.text
				});
				if (error) return error;
				continue;
			}
			if (source !== step.before) return 'The file changed meanwhile; try again.';
			const refused = check ? await check(step.path, step.before, step.after) : null;
			if (refused) return refused;
			if (workspace.text(step.path) !== step.before) {
				return 'The file changed meanwhile; try again.';
			}
			workspace.setText(step.path, step.after);
		}
		return null;
	});
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
