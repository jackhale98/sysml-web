/**
 * Filters on a table's columns, a viewing aid beside the search: numbers
 * by range (severity at least 8, RPN at least 100), levels by value (action
 * priority high, acceptability unacceptable, RPN band high or above) and
 * text that contains words. Phones' cards and exports show the same rows.
 *
 * A filtered table can be saved as a view: its number and level filters
 * become the `where` condition of the view's `@TableRendering`, written in
 * SysML's expression language over the columns' own expressions
 * (`ActionPriority(severity, likelihood, detection) ==
 * ActionPriorityLevel::high`), so the saved view needs nothing the app
 * knows. Text filters stay a viewing aid: the expression language has no
 * "contains".
 */
import type { Levels, RenderedTable } from '#lib/engine/types.ts';
import { sysmlName } from '#lib/project/names.ts';
import { viewTitle } from './views.ts';

export type ColumnFilter =
	| { column: string; kind: 'range'; min: number | null; max: number | null }
	| { column: string; kind: 'levels'; values: string[] }
	| { column: string; kind: 'text'; text: string };

/** How a column can be filtered: by range, by its levels (in order), or by text. */
export type FilterShape =
	| { kind: 'range'; min: number; max: number }
	| { kind: 'levels'; values: string[]; ordered: boolean }
	| { kind: 'text' };

/** Fewer distinct values than this, and short ones, filter by value. */
const FEW = 8;

const numberOf = (value: string): number | null => {
	const t = value.trim();
	if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
	return Number(t);
};

/** The levels a column declares (an enum's literals), if any. */
function levelsAt(table: RenderedTable, index: number): Levels | null {
	return table.columnLevels?.[index] ?? null;
}

/** How a column is filtered, from what the table says of it and its values. */
export function filterShape(table: RenderedTable, index: number): FilterShape {
	const levels = levelsAt(table, index);
	if (levels) return { kind: 'levels', values: levels.values, ordered: true };
	const values = table.rows.map((r) => r[index] ?? '').filter((v) => v !== '');
	const numbers = values.map(numberOf);
	if (values.length && numbers.every((n) => n !== null))
		return {
			kind: 'range',
			min: Math.min(...(numbers as number[])),
			max: Math.max(...(numbers as number[]))
		};
	const distinct = [...new Set(values)];
	if (distinct.length && distinct.length <= FEW && distinct.every((v) => v.length <= 40))
		return { kind: 'levels', values: distinct.sort((a, b) => a.localeCompare(b)), ordered: false };
	return { kind: 'text' };
}

/** A new filter of a column, by its shape: everything still passes until it is narrowed. */
export function newFilter(table: RenderedTable, column: string): ColumnFilter {
	const shape = filterShape(table, table.columns.indexOf(column));
	if (shape.kind === 'range') return { column, kind: 'range', min: null, max: null };
	if (shape.kind === 'levels') return { column, kind: 'levels', values: [] };
	return { column, kind: 'text', text: '' };
}

/** Whether a filter narrows anything yet. */
export function isActive(filter: ColumnFilter): boolean {
	if (filter.kind === 'range') return filter.min !== null || filter.max !== null;
	if (filter.kind === 'levels') return filter.values.length > 0;
	return filter.text.trim() !== '';
}

/** Whether a cell passes a filter. */
export function passes(filter: ColumnFilter, value: string): boolean {
	if (!isActive(filter)) return true;
	if (filter.kind === 'range') {
		const n = numberOf(value);
		if (n === null) return false;
		return (filter.min === null || n >= filter.min) && (filter.max === null || n <= filter.max);
	}
	if (filter.kind === 'levels') return filter.values.includes(value);
	return value.toLowerCase().includes(filter.text.trim().toLowerCase());
}

/** Whether a row (its cells) passes every filter whose column the table has. */
export function rowPasses(table: RenderedTable, filters: ColumnFilter[], cells: string[]): boolean {
	return filters.every((f) => {
		const at = table.columns.indexOf(f.column);
		return at < 0 || passes(f, cells[at] ?? '');
	});
}

/** The filter in words: `Severity ≥ 9`, `Action priority: high`, `Effect contains “fire”`. */
export function describeFilter(table: RenderedTable, filter: ColumnFilter): string {
	const heading = viewTitle(filter.column);
	if (filter.kind === 'range') {
		const { min, max } = filter;
		if (min !== null && max !== null)
			return min === max ? `${heading} = ${min}` : `${heading} ${min} to ${max}`;
		return min !== null ? `${heading} ≥ ${min}` : `${heading} ≤ ${max}`;
	}
	if (filter.kind === 'levels') {
		const shape = filterShape(table, table.columns.indexOf(filter.column));
		// The top levels of an ordered scale: `RPN band ≥ high`.
		if (shape.kind === 'levels' && shape.ordered && filter.values.length > 1) {
			const top = shape.values.slice(shape.values.length - filter.values.length);
			if (top.every((v) => filter.values.includes(v))) return `${heading} ≥ ${levelWord(top[0]!)}`;
		}
		return `${heading}: ${filter.values.map(levelWord).join(' or ')}`;
	}
	return `${heading} contains “${filter.text.trim()}”`;
}

/** A level as it reads (`inProgress` → `in progress`). */
export function levelWord(value: string): string {
	return viewTitle(value).toLowerCase();
}

/** What a column's cells are computed from, in the view's terms: its expression or its field. */
function operandOf(table: RenderedTable, index: number): string | null {
	const spec = table.columnSpecs?.[index] ?? table.columns[index];
	if (!spec) return null;
	const eq = spec.indexOf('=');
	return (eq < 0 ? spec : spec.slice(eq + 1)).trim();
}

/**
 * The filters as a `where` condition (SysML's expression language), and
 * those it leaves out (text filters, and values of columns without levels:
 * a saved view compares levels and numbers only).
 */
export function whereOf(
	table: RenderedTable,
	filters: ColumnFilter[]
): { where: string; left: ColumnFilter[] } {
	const terms: string[] = [];
	const left: ColumnFilter[] = [];
	for (const f of filters.filter(isActive)) {
		const at = table.columns.indexOf(f.column);
		const operand = at < 0 ? null : operandOf(table, at);
		if (!operand) {
			left.push(f);
			continue;
		}
		if (f.kind === 'range') {
			const parts = [
				...(f.min !== null ? [`${operand} >= ${f.min}`] : []),
				...(f.max !== null ? [`${operand} <= ${f.max}`] : [])
			];
			terms.push(parts.join(' and '));
			continue;
		}
		const levels = f.kind === 'levels' ? levelsAt(table, at) : null;
		if (f.kind === 'levels' && levels) {
			const literal = (v: string) =>
				levels.enum ? `${levels.enum}::${sysmlName(v)}` : `"${v.replace(/["\\]/g, '\\$&')}"`;
			const each = f.values.map((v) => `${operand} == ${literal(v)}`);
			terms.push(each.length > 1 ? `(${each.join(' or ')})` : each[0]!);
			continue;
		}
		left.push(f);
	}
	return { where: terms.join(' and '), left };
}

/** A quick review of a risk worksheet: a name and the filters it sets. */
export interface Preset {
	id: string;
	label: string;
	filters: ColumnFilter[];
}

/**
 * The quick reviews a risk worksheet offers, for the columns it has: high
 * action priority, severity 9 or more, an unacceptable risk, and an RPN at
 * the threshold of its high band (or 100) or more.
 */
export function riskPresets(table: RenderedTable, highFrom: number | null): Preset[] {
	const has = (c: string) => table.columns.includes(c);
	const out: Preset[] = [];
	if (has('actionPriority'))
		out.push({
			id: 'priority',
			label: 'High priority',
			filters: [{ column: 'actionPriority', kind: 'levels', values: ['high'] }]
		});
	if (has('severity'))
		out.push({
			id: 'severity',
			label: 'Severity ≥ 9',
			filters: [{ column: 'severity', kind: 'range', min: 9, max: null }]
		});
	if (has('acceptability'))
		out.push({
			id: 'unacceptable',
			label: 'Unacceptable',
			filters: [{ column: 'acceptability', kind: 'levels', values: ['unacceptable'] }]
		});
	if (has('rpn')) {
		const threshold = highFrom ?? 100;
		out.push({
			id: 'rpn',
			label: `RPN ≥ ${threshold}`,
			filters: [{ column: 'rpn', kind: 'range', min: threshold, max: null }]
		});
	}
	return out;
}

/** Whether the filters are exactly a preset's. */
export function isPreset(filters: ColumnFilter[], preset: Preset): boolean {
	const active = filters.filter(isActive);
	return (
		active.length === preset.filters.length &&
		preset.filters.every((p) => active.some((f) => JSON.stringify(f) === JSON.stringify(p)))
	);
}

/** A name for a saved review, from what it keeps: `High priority lines`, `Severity ≥ 9`. */
export function reviewTitle(table: RenderedTable, filters: ColumnFilter[], title: string): string {
	const active = filters.filter(isActive);
	if (!active.length) return title;
	const words = active.map((f) => describeFilter(table, f)).join(', ');
	return `${title}: ${words}`;
}
