/**
 * Model-editing intents shared by diagrams, explorer and inspector. Each one
 * asks the engine for a minimal text edit and applies it to the workspace.
 * Results are `null` on success or a message to show.
 */
import type { DeclarationSet } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { inLineBreaksOf } from '#lib/project/lineBreaks.ts';
import { applyChanges, minimalChange, type Workspace } from '#lib/project/workspace.svelte.ts';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import { planDuplicate } from '#lib/diagram/duplicate.ts';
import { modelContext } from '#lib/diagram/modelContext.ts';
import { elementText, formatName, type AddKind } from './templates';
import type { SelectionSource, WorkbenchUi } from './ui.svelte.ts';

/**
 * Run an edit as one undoable step and confirm it with a toast that offers
 * Undo, so every gesture is safe to try.
 */
export async function undoable(
	workspace: Workspace,
	given: string | (() => string),
	run: () => Promise<string | null>
): Promise<string | null> {
	const before = workspace.lastEdit;
	const error = await workspace.transact(given, run);
	const edit = workspace.lastEdit;
	if (!error && edit !== undefined && edit !== before) {
		const label = typeof given === 'function' ? given() : given;
		// A deletion that leaves references unresolved says so (they show in Problems).
		const warning = workspace.warnings.join(' ');
		toasts.show(warning ? `${label}. ${warning}` : label, {
			tone: warning ? 'info' : 'success',
			// Long enough to read what no longer resolves.
			...(warning ? { duration: 12_000 } : {}),
			action: undoAction(workspace, edit)
		});
	}
	return error;
}

/**
 * A toast's Undo: it undoes the edit the toast is about (`edit`, its id),
 * not whichever came last, keeping what was typed or edited since; it says
 * what it undid, or why it couldn't.
 */
export function undoAction(workspace: Workspace, edit: number): { label: string; run: () => void } {
	return {
		label: 'Undo',
		run: () => {
			const outcome = workspace.undoEdit(edit);
			if (!outcome) toasts.show('That change can’t be undone any more.', { tone: 'error' });
			else if ('refused' in outcome)
				toasts.show(outcome.refused, { tone: 'error', duration: 12_000 });
			else toasts.show(`Undid: ${outcome.undone}`);
		}
	};
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

/**
 * Copy an element under a free name, right after it (one undoable step), and
 * give back the copy once the model has read it, to select it.
 */
export async function duplicateElement(
	workspace: Workspace,
	element: ModelElement,
	check?: (path: string, before: string, after: string) => Promise<string | null>
): Promise<{ error: string | null; copy?: ModelElement }> {
	if (element.file.startsWith('libraries/'))
		return { error: 'Library elements can’t be changed here.' };
	const ctx = modelContext(workspace);
	const owner = ctx.owners.get(element.key);
	const plan = planDuplicate(element, ctx);
	if (typeof plan === 'string') return { error: plan };
	const error = await applySteps(workspace, plan.label, plan.steps, check);
	if (error) return { error };
	for (let i = 0; i < 200 && !workspace.settled; i++) {
		await new Promise((done) => setTimeout(done, 40));
	}
	const now = modelContext(workspace);
	const copy = workspace.elements.find(
		(e) =>
			e.label === plan.name && e.file === element.file && now.owners.get(e.key)?.key === owner?.key
	);
	return { error: null, ...(copy ? { copy } : {}) };
}

/**
 * Duplicate an element and select the copy, or say why it can't be: the
 * shortcut, the search box and the explorer's menu do it so.
 */
export async function duplicateAndSelect(
	workspace: Workspace,
	ui: WorkbenchUi,
	element: ModelElement,
	source: SelectionSource
): Promise<void> {
	const { error, copy } = await duplicateElement(workspace, element);
	if (error) toasts.show(error, { tone: 'error' });
	else if (copy) ui.select(copy.key, source);
}

/** What else a delete affects, in a line for its confirmation. */
export async function deleteImpact(workspace: Workspace, element: ModelElement): Promise<string> {
	const broken = await workspace.whatBreaksWithoutElement(element);
	if (broken === '') return 'Nothing else in the model refers to it.';
	if (broken === null) return 'Anything that refers to it will show as a problem.';
	const would = broken.replace(/\bno longer resolves?\b/, 'would no longer resolve');
	return `Other elements use it: ${would.charAt(0).toLowerCase()}${would.slice(1)} They will show as problems until you change them.`;
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
	let imported: string[] = [];
	return undoable(
		workspace,
		() => withImported(label, imported),
		async () => {
			const error = await workspace.edit(source.file, {
				op: 'setField',
				path: source.file,
				source: text,
				element: source.element,
				line: source.line,
				...(source.id ? { id: source.id } : {}),
				field,
				value
			});
			if (error) return error;
			if (value.includes('[')) imported = await workspace.importUnits(source.file, text);
			return null;
		}
	);
}

/** How libraries of units read in a toast. */
const UNIT_LIBRARIES: Record<string, string> = { SI: 'SI', USCustomaryUnits: 'US customary' };

/** "Set mass to 3 [kg], and imported the SI units it uses". */
export function withImported(label: string, libraries: string[]): string {
	if (!libraries.length) return label;
	const names = libraries.map((l) => UNIT_LIBRARIES[l] ?? l).join(' and ');
	return `${label}, and imported the ${names} units it uses`;
}

/** Choose and order a table view's columns (its @TableRendering). */
/**
 * Remove a table row's metadata annotation (an FMEA line, `@Fmea about x
 * { … }`) by its element id, as one undoable step.
 */
export async function removeAnnotation(
	workspace: Workspace,
	source: { file: string; line: number; annotation: string },
	label: string
): Promise<string | null> {
	const text = workspace.text(source.file);
	if (text === undefined) return `${source.file} is not in the project.`;
	return undoable(workspace, label, () =>
		workspace.edit(source.file, {
			op: 'remove',
			path: source.file,
			source: text,
			name: '',
			line: source.line,
			id: source.annotation
		})
	);
}

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
 * Save one setting of a view in its own rendering metadata (`@MatrixRendering
 * { order = "clustered"; }`), as one undoable step.
 */
export async function setViewSetting(
	workspace: Workspace,
	view: { file: string; name: string; id?: string | undefined },
	metadata: string,
	field: string,
	value: string,
	label: string
): Promise<string | null> {
	const text = workspace.text(view.file);
	if (text === undefined) return `${view.file} is not in the project.`;
	return undoable(workspace, label, () =>
		workspace.edit(view.file, {
			op: 'setViewMetadata',
			path: view.file,
			source: text,
			view: view.name,
			...(view.id ? { id: view.id } : {}),
			metadata,
			field,
			value
		})
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
	| { kind: 'patch'; path: string; before: string; after: string };

/** An edit step, or a new file of the project (undo removes it again). */
export type WriteStep = EditStep | { kind: 'file'; path: string; text: string };

/**
 * Apply edit steps as one undoable change, confirmed by a toast with Undo
 * ("Battery is now part of DeliveryDrone"). `check` can refuse a patched
 * text, e.g. when it would not parse.
 */
export async function applySteps(
	workspace: Workspace,
	label: string,
	steps: WriteStep[],
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
			// Lines it adds end as the file's other lines do.
			const change = minimalChange(step.before, step.after);
			workspace.setText(
				step.path,
				change ? applyChanges(step.before, inLineBreaksOf(step.before, [change])) : step.after
			);
		}
		return null;
	});
}
