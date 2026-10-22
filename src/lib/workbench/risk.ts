/**
 * What the views read about risk tables: an FMEA worksheet (its rows are
 * `@Fmea` lines), the hazard log, the levels their cells show (action
 * priority, harm severity) and the risk matrix of a worksheet's lines.
 */
import type { RenderedTable, ViewInfo } from '#lib/engine/types.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import type { ModelElement } from '#lib/project/elements.ts';

/** Whether a table lists FMEA lines (rows of `@Fmea` annotations). */
export function isFmeaTable(table: RenderedTable): boolean {
	return table.annotations?.metadata.split('::').pop() === 'Fmea';
}

/** Whether a view is a hazard log (typed by `HazardLog`, or that view def itself). */
export function isHazardLog(info: ViewInfo | undefined): boolean {
	const definition = (info?.isUsage ? info.definition : info?.name) ?? '';
	return definition.split('::').pop() === 'HazardLog';
}

/** How a level reads: an action priority, a harm's severity class. */
const LEVEL_TONE: Record<string, 'bad' | 'warn' | 'ok'> = {
	high: 'bad',
	medium: 'warn',
	low: 'ok',
	catastrophic: 'bad',
	critical: 'bad',
	serious: 'warn',
	minor: 'ok',
	negligible: 'ok'
};

/** The risk tables' level columns: the action priority (now and before), a hazard's severity. */
const LEVEL_COLUMNS = new Set(['actionPriority', 'priorityBefore', 'severity']);

/** The tone of a level cell (`actionPriority`, a hazard's `severity`), or null when it isn't one. */
export function levelTone(column: string, value: string): 'bad' | 'warn' | 'ok' | null {
	if (!LEVEL_COLUMNS.has(column)) return null;
	return LEVEL_TONE[value.toLowerCase()] ?? null;
}

/** Columns whose cells name elements of the model, each a link that selects it. */
export const ELEMENT_LIST_COLUMNS = new Set(['controls', 'harms', 'situations']);

/** The element a hazard log cell names: a requirement by `ID title`, else an element by name. */
export function elementNamed(workspace: Workspace, text: string): ModelElement | undefined {
	const own = workspace.elements.filter((e) => !isLibraryFile(e.file) && !e.isDefinition);
	return (
		own.find((e) => e.shortName && `${e.shortName} ${e.label}` === text) ??
		own.find((e) => e.label === text)
	);
}

/** A saved risk matrix of a package's lines, if the project has one. */
export function matrixOf(workspace: Workspace, pkg: string): ViewInfo | undefined {
	const simple = pkg.split('::').pop()!;
	return workspace.views.find(
		(v) =>
			v.isUsage &&
			!v.builtin &&
			(v.definition ?? '').split('::').pop() === 'RiskMatrix' &&
			(v.exposes ?? []).some((e) => {
				const base = e.replace(/::\*(::\*\*)?$|::\*\*$/, '');
				return base === pkg || base.split('::').pop() === simple;
			})
	);
}
