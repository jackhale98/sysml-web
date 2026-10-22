/**
 * Model-editing intents shared by diagrams, explorer and inspector. Each one
 * asks the engine for a minimal text edit and applies it to the workspace.
 * Results are `null` on success or a message to show.
 */
import type { DeclarationSet } from '#lib/engine/types.ts';
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
		// A deletion that leaves references unresolved says so (they show in Problems).
		const warning = workspace.warnings.join(' ');
		toasts.show(warning ? `${label}. ${warning}` : label, {
			tone: warning ? 'info' : 'success',
			// Long enough to read what no longer resolves.
			...(warning ? { duration: 12_000 } : {}),
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
			...parentOf(owner),
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
	const source = workspace.text(element.file);
	if (source === undefined) return `${element.file} is not open.`;
	return undoable(workspace, `Renamed ${element.label} to ${to}`, () =>
		workspace.edit(element.file, {
			op: 'rename',
			path: element.file,
			source,
			from: element.name,
			line: element.span.start_row,
			...(element.id ? { id: element.id } : {}),
			to
		})
	);
}

/** How an edit names an element: its id, and its name and line for when the id is unknown. */
export function parentOf(owner: ModelElement): {
	parent: string;
	parentLine: number;
	parentId?: string;
} {
	return {
		parent: owner.name,
		parentLine: owner.span.start_row,
		...(owner.id ? { parentId: owner.id } : {})
	};
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
			name: element.name,
			line: element.span.start_row,
			...(element.id ? { id: element.id } : {})
		})
	);
}

/** Change one table cell: the model value behind it, as a minimal SysML edit. */
export async function setField(
	workspace: Workspace,
	source: { element: string; file: string; line: number; id?: string },
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
			...(source.id ? { id: source.id } : {}),
			field,
			value
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
	| { kind: 'member'; path: string; parent: ModelElement; text: string }
	| { kind: 'declaration'; path: string; element: ModelElement; set: DeclarationSet }
	| { kind: 'remove'; path: string; element: ModelElement }
	| { kind: 'patch'; path: string; before: string; after: string }
	/** A new file of the project (undo removes it again). */
	| { kind: 'file'; path: string; text: string };

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
			if (step.kind === 'file') {
				if (workspace.text(step.path) !== undefined) return `${step.path} exists already.`;
				workspace.setText(step.path, step.text);
				continue;
			}
			const source = workspace.text(step.path);
			if (source === undefined) return `${step.path} is not in the project.`;
			if (step.kind === 'member') {
				const error = await workspace.edit(step.path, {
					op: 'insertMember',
					path: step.path,
					source,
					...parentOf(step.parent),
					text: step.text
				});
				if (error) return error;
				continue;
			}
			if (step.kind === 'remove') {
				const error = await workspace.edit(step.path, {
					op: 'remove',
					path: step.path,
					source,
					name: step.element.name,
					line: step.element.span.start_row,
					...(step.element.id ? { id: step.element.id } : {})
				});
				if (error) return error;
				continue;
			}
			if (step.kind === 'declaration') {
				const error = await workspace.edit(step.path, {
					op: 'setDeclaration',
					path: step.path,
					source,
					element: step.element.name,
					line: step.element.span.start_row,
					...(step.element.id ? { id: step.element.id } : {}),
					set: step.set
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
