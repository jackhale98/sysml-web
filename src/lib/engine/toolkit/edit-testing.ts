/**
 * For unit tests: model edits through the toolkit host, applied to plain
 * texts the way `Workspace.edit` applies them.
 */
import type { EditOperation, EditRequest, EditResult } from '../types';
import type { ToolkitHost } from './host';

/** Apply UTF-16 changes to a text. */
export function applyEditChanges(
	text: string,
	changes: { from: number; to: number; insert: string }[]
): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from))
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}

/**
 * Run `request` against `files` (path → text) and return the edited texts,
 * or the error message the workspace would show.
 */
export function editFiles(
	host: ToolkitHost,
	files: Record<string, string>,
	request: EditOperation & { path: string; source?: string }
): { files: Record<string, string>; result: EditResult } | { error: string } {
	const full = {
		...request,
		source: request.source ?? files[request.path] ?? '',
		files: Object.entries(files).map(([path, text]) => ({ path, text }))
	} as EditRequest;
	let result: EditResult;
	try {
		result = host.edit(full);
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
	if (result.syntaxErrors.length) return { error: result.syntaxErrors[0]! };
	const next = { ...files, [full.path]: applyEditChanges(full.source, result.changes) };
	const byFile = new Map<string, EditResult['changes']>();
	for (const { path, ...c } of result.otherFiles ?? [])
		byFile.set(path, [...(byFile.get(path) ?? []), c]);
	for (const [path, changes] of byFile) next[path] = applyEditChanges(files[path]!, changes);
	return { files: next, result };
}
