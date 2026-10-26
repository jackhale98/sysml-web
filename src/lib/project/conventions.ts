/**
 * Modelling conventions as model content: a saved table view marked
 * `@Convention` lists what breaks a rule, so each of its rows is a problem.
 *
 *   view requirementsWithoutOwner : RequirementsTable {
 *       @TableRendering { where = "owner == \"\""; }
 *       @Convention { rule = "Every requirement names its owner."; }
 *   }
 *
 * The view's `rows`, `expose` and `where` say what to look at and what
 * breaks the rule (any table the app can show); `rule` says the rule,
 * `severity` how much it matters (warning unless it says error or note).
 * Problems lists each row at the element it is about; a view that can't be
 * shown is a problem of its own.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { Analysis, Diagnostic, ViewInfo } from '#lib/engine/types.ts';
import type { ProjectFile } from './workspace.svelte';
import { lastSegment, stringValue } from './names';
import { spanOf } from './derivations';

export const CONVENTION_METADATA = 'Convention';
/** At most this many problems from one convention (the view lists the rest). */
const LIMIT = 100;

export interface Convention {
	/** The view, by qualified name. */
	view: string;
	/** Its name, for the message. */
	name: string;
	rule: string | null;
	severity: Diagnostic['severity'];
	/** Where the `@Convention` is written. */
	file: string;
	span: Diagnostic['span'];
}

/** The views of the project marked as conventions. */
export function conventionsOf(
	analyses: Iterable<Analysis>,
	views: readonly ViewInfo[]
): Convention[] {
	const out: Convention[] = [];
	for (const { model } of analyses)
		for (const a of model.annotations ?? []) {
			if (lastSegment(a.metadata_type) !== CONVENTION_METADATA) continue;
			const view = views.find(
				(v) => v.isUsage && v.file === model.file && lastSegment(a.target) === lastSegment(v.name)
			);
			if (!view) continue;
			const field = (name: string) => {
				const value = a.values.find(([k]) => k === name)?.[1];
				return value === undefined ? null : stringValue(value).trim() || null;
			};
			const severity = lastSegment(field('severity') ?? 'warning');
			out.push({
				view: view.qualifiedName ?? view.name,
				name: lastSegment(view.name),
				rule: field('rule'),
				severity: severity === 'error' || severity === 'note' ? severity : 'warning',
				file: model.file,
				span: a.span
			});
		}
	return out;
}

/** Each row of each convention's table, as a problem at the element it is about. */
export async function conventionProblems(
	engine: Engine,
	files: ProjectFile[],
	conventions: readonly Convention[]
): Promise<Diagnostic[]> {
	const texts = new Map(files.map((f) => [f.path, f.text]));
	const problems: Diagnostic[] = [];
	for (const c of conventions) {
		const rule = c.rule ?? `Breaks the convention ${c.name}.`;
		let table;
		try {
			table = await engine.renderView(files, c.view);
		} catch (error) {
			problems.push({
				file: c.file,
				span: c.span,
				severity: 'warning',
				code: 'convention',
				message: `The convention ${c.name} can’t be checked: ${error instanceof Error ? error.message : String(error)}`
			});
			continue;
		}
		table.rows.slice(0, LIMIT).forEach((row, i) => {
			const source = table.sources[i];
			const text = source ? texts.get(source.file) : undefined;
			const what = row[0] ? `: ${row[0]}` : '';
			if (!source || text === undefined) {
				problems.push({
					file: c.file,
					span: c.span,
					severity: c.severity,
					code: 'convention',
					message: `${rule} (convention ${c.name})${what}`
				});
				return;
			}
			problems.push({
				file: source.file,
				span: lineSpan(text, source.line),
				severity: c.severity,
				code: 'convention',
				message: `${rule} (convention ${c.name})${what}`,
				explanation: `The view ${c.name} is marked @Convention: every row it lists breaks the rule.`
			});
		});
		if (table.rows.length > LIMIT)
			problems.push({
				file: c.file,
				span: c.span,
				severity: c.severity,
				code: 'convention',
				message: `${rule} (convention ${c.name}): ${table.rows.length - LIMIT} more; open the view for all of them.`
			});
	}
	return problems;
}

/** The span of a line's text (1-based), without its indentation. */
function lineSpan(text: string, line: number) {
	let from = 0;
	for (let i = 1; i < line; i++) {
		const next = text.indexOf('\n', from);
		if (next < 0) break;
		from = next + 1;
	}
	const end = text.indexOf('\n', from);
	const to = end < 0 ? text.length : end;
	const indent = /^[ \t]*/.exec(text.slice(from, to))![0].length;
	return spanOf(text, from + indent, to);
}
