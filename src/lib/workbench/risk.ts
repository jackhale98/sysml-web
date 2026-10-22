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

/**
 * How a level reads: an action priority, an RPN band, an acceptability, a
 * harm's severity class, how far a line's controls and mitigations are.
 */
const LEVEL_TONE: Record<string, 'bad' | 'warn' | 'ok'> = {
	high: 'bad',
	medium: 'warn',
	low: 'ok',
	critical: 'bad',
	unacceptable: 'bad',
	reduce: 'warn',
	acceptable: 'ok',
	catastrophic: 'bad',
	serious: 'warn',
	minor: 'ok',
	negligible: 'ok',
	open: 'bad',
	implemented: 'warn',
	verified: 'ok',
	proposed: 'warn',
	inprogress: 'warn',
	completed: 'ok'
};

/** The risk tables' level columns: priorities, bands, acceptability (now and before), a hazard's severity, status. */
const LEVEL_COLUMNS = new Set([
	'actionPriority',
	'priorityBefore',
	'rpnBand',
	'acceptability',
	'acceptabilityBefore',
	'severity',
	'controlStatus',
	'mitigationStatus'
]);

/**
 * The tone of a level cell (`actionPriority`, a hazard's `severity`), `plain`
 * for a level that says nothing good or bad (no controls), or null when it
 * isn't one (an FMEA line's severity is a number).
 */
export function levelTone(column: string, value: string): 'bad' | 'warn' | 'ok' | 'plain' | null {
	if (!LEVEL_COLUMNS.has(column) || !value || /^[\d.]+$/.test(value)) return null;
	return LEVEL_TONE[value.toLowerCase()] ?? (column === 'severity' ? null : 'plain');
}

/** The tone of a risk policy's zone (`acceptable`, `reduce`, `unacceptable`), by its place among the zones. */
export function zoneTone(zone: string, zones: readonly string[]): 'bad' | 'warn' | 'ok' | 'plain' {
	const known = LEVEL_TONE[zone.toLowerCase()];
	if (known) return known;
	const at = zones.indexOf(zone);
	if (at < 0) return 'plain';
	return at === zones.length - 1 ? 'bad' : at === 0 ? 'ok' : 'warn';
}

/** How each zone reads, in plain words. */
export const ZONE_WORDS: Record<string, { label: string; meaning: string }> = {
	acceptable: { label: 'Acceptable', meaning: 'No further reduction needed' },
	reduce: {
		label: 'Reduce as far as possible',
		meaning: 'Lower it as far as you can, then weigh what remains against the benefit'
	},
	unacceptable: { label: 'Unacceptable', meaning: 'Must be reduced before release' }
};

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
