/**
 * Which views are reports. A report is an ordinary SysML view rendered
 * `asDocument` (see `ModelViews.sysml`): the standard ones are typed by
 * `SpecificationDocument` or `InterfaceControlDocument`. This module is small
 * on purpose: the explorer imports it, the report code itself loads lazily.
 */
import type { ViewInfo } from '#lib/engine/types.ts';
import { viewTitle } from '#lib/workbench/views.ts';

export type ReportKind = 'specification' | 'icd' | 'document';

export interface StandardReport {
	/** The view def in `ModelViews`. */
	definition: string;
	kind: ReportKind;
	title: string;
	description: string;
}

export const STANDARD_REPORTS: readonly StandardReport[] = [
	{
		definition: 'SpecificationDocument',
		kind: 'specification',
		title: 'Requirements specification',
		description:
			'Every requirement with its statement, attributes and trace, then the coverage and the gaps.'
	},
	{
		definition: 'InterfaceControlDocument',
		kind: 'icd',
		title: 'Interface control document',
		description: 'How the parts connect: connections, interfaces, ports and the items that flow.'
	}
];

/** The kind of report a view is, or null when it is not a report. */
export function reportKindOf(view: ViewInfo): ReportKind | null {
	const definition = view.isUsage ? view.definition : view.name;
	const standard = STANDARD_REPORTS.find((r) => r.definition === definition);
	if (standard) return standard.kind;
	return view.renderAs === 'asDocument' ? 'document' : null;
}

/** A standard report by its view def name (whether or not the project has the def). */
export function standardReport(name: string): StandardReport | undefined {
	return STANDARD_REPORTS.find((r) => r.definition === name);
}

export interface ReportEntry {
	/** The view to open: a saved report usage, or a standard report's def. */
	name: string;
	title: string;
	kind: ReportKind;
	doc?: string;
	saved: boolean;
}

/** The reports to offer: the ones saved in the project's model, then the standard ones. */
export function reportEntries(
	views: readonly ViewInfo[],
	isLibraryFile: (path: string) => boolean
): ReportEntry[] {
	const saved = views
		.filter((v) => v.isUsage && !v.builtin && !isLibraryFile(v.file))
		.flatMap((v): ReportEntry[] => {
			const kind = reportKindOf(v);
			return kind
				? [{ name: v.name, title: viewTitle(v.name), kind, doc: v.doc, saved: true }]
				: [];
		});
	const standard = STANDARD_REPORTS.map((r): ReportEntry => ({
		name: r.definition,
		title: r.title,
		kind: r.kind,
		doc: r.description,
		saved: false
	}));
	return [...saved, ...standard];
}
