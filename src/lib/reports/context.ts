/**
 * Everything a report is built from, gathered once from the workspace; the
 * builders are pure functions of it (and so are tested without an engine).
 */
import type { Analysis, RenderedTable } from '#lib/engine/types.ts';
import type { RequirementRow } from '#lib/project/requirements.ts';
import type { RevisionInfo } from '#lib/project/verification.ts';
import type { ReportKind } from './kinds.ts';
import type { Expose, ModelIndex } from './model.ts';
import type { Derivation } from './text.ts';

/** A subview of the report: one chapter. */
export interface Chapter {
	name: string;
	qualifiedName: string;
	/** The view def it is typed by, e.g. `RequirementsTable`. */
	definition: string;
	doc?: string;
	/** `filter` conditions as written, e.g. `@SysML::PortDefinition`. */
	filters: string[];
	hasTable: boolean;
	/** The file the chapter's view is declared in (absent for a built-in report's chapters). */
	file?: string;
}

export interface DocumentMeta {
	title?: string;
	number?: string;
	version?: string;
	status?: string;
	author?: string;
}

export interface Diagram {
	svg: string;
	/** The part the diagram shows the inside of. */
	scope: string;
}

export interface ReportContext {
	kind: ReportKind;
	/** The view's name. */
	view: string;
	/** The view's doc comment. */
	doc: string | null;
	kindLabel: string;
	/** The title when `@DocumentInfo` gives none. */
	defaultTitle: string;
	project: { name: string; description?: string | null; version?: string | null };
	meta: DocumentMeta;
	exposes: string[];
	scope: Expose[];
	chapters: Chapter[];
	index: ModelIndex;
	requirements: RequirementRow[];
	derivations: Derivation[];
	analyses: Analysis[];
	/** File texts by path. */
	texts: Record<string, string>;
	/** Rendered tables of chapters shown as plain tables, by qualified name. */
	tables: Record<string, RenderedTable | { error: string }>;
	diagram: Diagram | null;
	date: Date;
	/** The version of the model it is made from: `Commit 3f2a9c1 of owner/repo (main)`, or `Not committed`. */
	revision: string;
	/** What recorded verification results are compared with (null: not connected). */
	revisionInfo: RevisionInfo | null;
}
