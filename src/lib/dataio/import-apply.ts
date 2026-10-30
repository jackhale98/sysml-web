/**
 * Carry out an import plan on the project: update the requirements already
 * there (one engine `setField` per changed field, renames through the
 * engine's `rename`), then add the new requirements to their package in one
 * engine `insertMember`, after the imports they need. The caller runs it
 * inside `workspace.transact`, so the whole import is one undoable change.
 */
import type { EditRequest } from '#lib/engine/types.ts';
import { lineBreakOf } from '#lib/project/lineBreaks.ts';
import type { ImportOptions, ImportPlan } from './import-plan';
import { derivationText, docComment, requirementText, sysmlName } from './sysml-text';

/** What an import needs from the workspace (the `Workspace` class has all of it). */
export interface ImportWorkspace {
	text(path: string): string | undefined;
	setText(path: string, text: string): void;
	edit(path: string, request: EditRequest): Promise<string | null>;
	readonly modelPaths: string[];
	sourceFiles(): { path: string; text: string }[];
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the text already imports what `wanted` brings in (`P::*` or `P::Name`). */
export function hasImport(text: string, wanted: string): boolean {
	const cut = wanted.lastIndexOf('::');
	const pkg = escapeRegExp(wanted.slice(0, cut));
	const name = wanted.slice(cut + 2);
	const member = name === '*' ? '\\*\\*?' : `(?:\\*\\*?|${escapeRegExp(name)})`;
	return new RegExp(`\\bimport\\s+${pkg}::${member}\\s*;`).test(text);
}

/**
 * Add `private import …;` lines to the package declared on `line` (1-based):
 * after its last import, or after its doc comment when it has none.
 */
export function withImports(text: string, line: number, imports: string[]): string {
	const missing = imports.filter((imp) => !hasImport(text, imp));
	if (!missing.length) return text;
	const lineBreak = lineBreakOf(text);
	const lines = text.split(lineBreak);
	let open = line - 1;
	while (open < lines.length && !lines[open]!.includes('{')) open++;
	if (open >= lines.length) return text;
	const indent = `${/^\s*/.exec(lines[line - 1] ?? '')![0]}    `;
	let after = open + 1;
	let lastImport = -1;
	for (let j = open + 1; j < lines.length; j++) {
		const t = lines[j]!.trim();
		if (t === '') continue;
		if (/^(doc\b|\/\*|\/\/)/.test(t)) {
			if (!t.startsWith('//') && !t.includes('*/')) {
				// A block comment: up to the line that closes it (`doc` may sit alone above it).
				if (t === 'doc' && lines[j + 1]?.trim().startsWith('/*')) j++;
				while (j < lines.length && !lines[j]!.includes('*/')) j++;
			}
			after = j + 1;
			continue;
		}
		if (/^(private\s+|public\s+)?import\s/.test(t)) {
			lastImport = j;
			continue;
		}
		break;
	}
	const block = missing.map((imp) => `${indent}private import ${imp};`);
	if (lastImport >= 0) {
		lines.splice(lastImport + 1, 0, ...block);
	} else {
		const before = after > open + 1 ? [''] : [];
		const next = lines[after]?.trim() ?? '';
		lines.splice(after, 0, ...before, ...block, ...(next && next !== '}' ? [''] : []));
	}
	return lines.join(lineBreak);
}

/** The members to add: each requirement, then the derivations, separated by blank lines. */
export function membersText(plan: ImportPlan): string {
	return [
		...plan.create.map((p) => requirementText(p.spec)),
		...plan.derivations.map((d) => derivationText(d.original, d.derived))
	].join('\n\n');
}

/** A new file holding one package with the imports the requirements need. */
export function newFileText(name: string, imports: string[], doc: string): string {
	const lines = [`package ${sysmlName(name)} {`, docComment(doc, '    ')];
	if (imports.length) lines.push('', ...imports.map((imp) => `    private import ${imp};`));
	return `${lines.join('\n')}\n}\n`;
}

export interface ImportResult {
	created: number;
	updated: number;
	/** Where the new requirements went. */
	path: string | null;
}

/**
 * Change the requirements already in the model that the plan updates.
 * Returns an error message, or null.
 */
export async function applyUpdates(
	workspace: ImportWorkspace,
	plan: Pick<ImportPlan, 'update'>
): Promise<string | null> {
	// Updates first, from the bottom of each file up, so the lines of the
	// requirements still to change stay where the analysis found them.
	const updates = plan.update.toSorted(
		(a, b) =>
			a.existing.row.file.localeCompare(b.existing.row.file) ||
			b.existing.row.span.start_row - a.existing.row.span.start_row
	);
	// Renames last: a rename changes the qualified name the other updates find their requirement by.
	const renames: { file: string; line: number; qualifiedName: string; to: string }[] = [];
	for (const update of updates) {
		const { row, qualifiedName } = update.existing;
		for (const change of update.changes) {
			if (change.field === 'name') {
				renames.push({
					file: row.file,
					line: row.span.start_row,
					qualifiedName,
					to: sysmlName(change.to)
				});
				continue;
			}
			const source = workspace.text(row.file);
			if (source === undefined) return `${row.file} is not in the project.`;
			const error = await workspace.edit(row.file, {
				op: 'setField',
				path: row.file,
				source,
				element: qualifiedName,
				line: row.span.start_row,
				field: change.field,
				value: change.to
			});
			if (error) return `Could not update ${row.id ?? row.title}: ${error}`;
		}
	}
	for (const { file, line, qualifiedName, to } of renames) {
		// The engine renames the requirement and every reference to it, in every file.
		const source = workspace.text(file);
		if (source === undefined) return `${file} is not in the project.`;
		const error = await workspace.edit(file, {
			op: 'rename',
			path: file,
			source,
			from: qualifiedName,
			line,
			to
		});
		if (error) return `Could not rename ${qualifiedName}: ${error}`;
	}
	return null;
}

/** Apply the plan. Returns an error message, or the result. */
export async function applyImport(
	workspace: ImportWorkspace,
	plan: ImportPlan,
	options: ImportOptions,
	doc: string
): Promise<ImportResult | string> {
	const failed = await applyUpdates(workspace, plan);
	if (failed) return failed;

	if (!plan.create.length) return { created: 0, updated: plan.update.length, path: null };

	const destination = options.destination;
	let path: string;
	let parent: string;
	if (destination.kind === 'new') {
		path = destination.path;
		parent = sysmlName(destination.name);
		if (workspace.text(path) !== undefined) return `${path} already exists.`;
		workspace.setText(path, newFileText(destination.name, plan.imports, doc));
	} else {
		path = destination.package.file;
		parent = destination.package.name;
		const before = workspace.text(path);
		if (before === undefined) return `${path} is not in the project.`;
		workspace.setText(path, withImports(before, destination.package.line, plan.imports));
	}
	const source = workspace.text(path)!;
	const error = await workspace.edit(path, {
		op: 'insertMember',
		path,
		source,
		parent,
		...(destination.kind === 'new' ? {} : { parentLine: destination.package.line }),
		text: `\n${membersText(plan)}`
	});
	if (error) return error;
	return { created: plan.create.length, updated: plan.update.length, path };
}
