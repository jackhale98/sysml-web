/**
 * Carry out a ReqIF import plan: update the requirements already there (as
 * the spreadsheet import does), add the ReqIF library when the project lacks
 * it, then write what is new: into the packages an earlier import made (new
 * requirements of a heading already imported go under that heading), and
 * into the destination, a new file or a package. The caller runs it inside
 * `workspace.transact`, so the whole import is one undoable change.
 */
import { withoutComments } from '#lib/project/derivations.ts';
import { lineBreakOf } from '#lib/project/lineBreaks.ts';
import library from '/src/lib/project/libraries/ReqIFInterchange.sysml?raw';
import { applyUpdates, newFileText, withImports, type ImportWorkspace } from './import-apply';
import type { ReqifOptions, ReqifPlan } from './reqif-plan';
import { nodesText, REQIF_LIBRARY_PATH, splitQualified } from './reqif-plan';
import { reqifAnnotation, sysmlName } from './sysml-text';

/** The ReqIF library's text, as a project gets it. */
export const REQIF_LIBRARY = library;

export interface ReqifImportResult {
	created: number;
	updated: number;
	/** The file the new requirements went to, when there is one place. */
	path: string | null;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The 1-based line a package is declared on, found in the text as it is now
 * (earlier steps of the import may have moved it): each segment of its
 * qualified name in turn, comments left out.
 */
export function packageLine(text: string, qualifiedName: string): number | null {
	const plain = withoutComments(text);
	let from = 0;
	let at = -1;
	for (const segment of splitQualified(qualifiedName)) {
		const pattern = new RegExp(String.raw`\bpackage\s+${escapeRegExp(segment)}\s*\{`, 'g');
		pattern.lastIndex = from;
		const m = pattern.exec(plain);
		if (!m) return null;
		at = m.index;
		from = m.index + m[0].length;
	}
	if (at < 0) return null;
	return text.slice(0, at).split(lineBreakOf(text)).length;
}

/** Add imports to the package `qualifiedName` in `path`, where it is now. */
function addImports(
	workspace: ImportWorkspace,
	path: string,
	qualifiedName: string,
	fallbackLine: number,
	imports: string[]
): string | null {
	if (!imports.length) return null;
	const text = workspace.text(path);
	if (text === undefined) return `${path} is not in the project.`;
	const line = packageLine(text, qualifiedName) ?? fallbackLine;
	workspace.setText(path, withImports(text, line, imports));
	return null;
}

async function insert(
	workspace: ImportWorkspace,
	path: string,
	parent: string,
	members: string
): Promise<string | null> {
	const source = workspace.text(path);
	if (source === undefined) return `${path} is not in the project.`;
	return workspace.edit(path, { op: 'insertMember', path, source, parent, text: `\n${members}` });
}

/** Apply the plan. Returns an error message, or the result. */
export async function applyReqif(
	workspace: ImportWorkspace,
	plan: ReqifPlan,
	options: ReqifOptions,
	doc: string
): Promise<ReqifImportResult | string> {
	const failed = await applyUpdates(workspace, plan);
	if (failed) return failed;

	if (plan.library && workspace.text(REQIF_LIBRARY_PATH) === undefined)
		workspace.setText(REQIF_LIBRARY_PATH, REQIF_LIBRARY);

	// Into packages an earlier import made.
	for (const anchor of plan.anchored) {
		const members = [nodesText(anchor.nodes), ...anchor.relations].filter(Boolean).join('\n\n');
		if (!members) continue;
		const { file, qualifiedName, line } = anchor.package;
		const error =
			addImports(workspace, file, qualifiedName, line, anchor.imports) ??
			(await insert(workspace, file, qualifiedName, members));
		if (error) return `Could not add to ${qualifiedName}: ${error}`;
	}

	// Into the destination.
	const members = [
		...(plan.rootReqif ? [reqifAnnotation(plan.rootReqif)] : []),
		nodesText(plan.root),
		...plan.rootRelations
	]
		.filter(Boolean)
		.join('\n\n');
	const created = plan.create.length;
	const updated = plan.update.length;
	const hasRoot = plan.root.length > 0 || plan.rootRelations.length > 0;
	if (!hasRoot) {
		const first = plan.anchored.find((a) => a.nodes.length)?.package.file ?? null;
		return { created, updated, path: first };
	}
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
		parent = destination.package.qualifiedName;
		const error = addImports(workspace, path, parent, destination.package.line, plan.imports);
		if (error) return error;
	}
	const error = await insert(workspace, path, parent, members);
	if (error) return error;
	return { created, updated, path };
}
