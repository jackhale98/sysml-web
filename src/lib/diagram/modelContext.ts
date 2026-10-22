/**
 * The model as the diagram edits read it (`ModelContext`), and the check
 * that refuses a text patch adding syntax errors: shared by the canvas and
 * the inspector.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import { ownersOf } from './model.ts';
import type { ModelContext } from './relationships.ts';

export function modelContext(workspace: Workspace): ModelContext {
	return {
		elements: workspace.elements,
		owners: ownersOf(workspace.tree),
		textOf: (path: string) => workspace.text(path),
		analyses: Object.values(workspace.analyses)
	};
}

/** Refuse a text patch that would add syntax errors. */
export function syntaxCheck(engine: Engine) {
	return async (path: string, before: string, after: string): Promise<string | null> => {
		const [was, now] = await Promise.all([
			engine.analyze(path, before),
			engine.analyze(path, after)
		]);
		if (now.model.syntax_errors.length > was.model.syntax_errors.length) {
			return `That change would make the SysML invalid: ${now.model.syntax_errors[0]?.message ?? 'syntax error'}`;
		}
		return null;
	};
}
