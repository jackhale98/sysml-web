/**
 * Collect what a report is built from: the view and its chapters (its
 * subviews, or the standard ones when the project's library has no report
 * defs), `@DocumentInfo`, scope, requirements, derivations; then, from the
 * engine, the tables of plain table chapters and the interconnection
 * diagram.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { Analysis, ViewInfo } from '#lib/engine/types.ts';
import type { TreeNode } from '#lib/project/elements.ts';
import { stringValue } from '#lib/project/names.ts';
import type { RequirementRow } from '#lib/project/requirements.ts';
import type { RevisionInfo } from '#lib/project/verification.ts';
import { describingPackage, docSummary } from '#lib/workbench/home/model.ts';
import { viewTitle } from '#lib/workbench/views.ts';
import { chapterKind, STANDARD_CHAPTERS } from './build.ts';
import type { Chapter, DocumentMeta, ReportContext } from './context.ts';
import { diagramScope } from './icd.ts';
import { reportKindOf, standardReport, STANDARD_REPORTS } from './kinds.ts';
import { indexModel, parseExpose } from './model.ts';
import { projectDerivations } from '#lib/project/derivations.ts';

export interface ReportSource {
	views: ViewInfo[];
	analyses: Analysis[];
	/** File texts by path. */
	texts: Record<string, string>;
	tree: TreeNode[];
	requirements: RequirementRow[];
	project: { name: string; description?: string; version?: string } | null;
	isLibrary: (path: string) => boolean;
	/**
	 * The version of the model: how the report names it (`Commit 3f2a9c1 of
	 * owner/repo (main)`) and what results are compared with. Without one,
	 * the report says it is not committed.
	 */
	revision?: { stamp: string; info: RevisionInfo | null } | null;
}

/** How analysis lists a view (`Model.views`), for its `filter` conditions. */
interface RawView {
	name: string;
	filters?: string[];
	span: { start_row: number };
}

function directChildren(views: ViewInfo[], parent: ViewInfo | undefined): ViewInfo[] {
	const prefix = parent?.qualifiedName ? `${parent.qualifiedName}::` : null;
	if (!prefix) return [];
	return views.filter(
		(v) =>
			v.isUsage &&
			v.qualifiedName?.startsWith(prefix) &&
			!v.qualifiedName.slice(prefix.length).includes('::')
	);
}

function filtersOf(analyses: Analysis[], view: ViewInfo): string[] {
	const model = analyses.find((a) => a.model.file === view.file)?.model;
	const raw = (model as (typeof model & { views?: RawView[] }) | undefined)?.views ?? [];
	return raw.find((v) => v.name === view.name)?.filters ?? [];
}

function toChapter(analyses: Analysis[], view: ViewInfo): Chapter {
	return {
		name: view.name,
		qualifiedName: view.qualifiedName ?? view.name,
		definition: view.definition ?? '',
		doc: view.doc,
		filters: filtersOf(analyses, view),
		hasTable: view.hasTable,
		file: view.file
	};
}

/** `@DocumentInfo { title = "…"; }` on the view. */
function metaOf(analyses: Analysis[], view: ViewInfo | undefined): DocumentMeta {
	if (!view) return {};
	const meta: Record<string, string> = {};
	for (const { model } of analyses) {
		if (model.file !== view.file) continue;
		for (const a of model.annotations ?? []) {
			if (a.target !== view.name || !/(^|::)DocumentInfo$/.test(a.metadata_type)) continue;
			for (const [key, value] of a.values) meta[key] = stringValue(value);
		}
	}
	return meta as DocumentMeta;
}

/** Everything but the engine-rendered parts (tables, diagram). */
export function prepareReport(
	name: string,
	source: ReportSource,
	date = new Date()
): ReportContext {
	const view = source.views.find((v) => v.name === name || v.qualifiedName === name);
	const kind = view
		? (reportKindOf(view) ?? 'document')
		: (standardReport(name)?.kind ?? 'document');
	const definitionName = view?.isUsage ? view.definition : (view?.name ?? name);
	const standard = STANDARD_REPORTS.find((r) => r.definition === definitionName);
	const definition = source.views.find((v) => !v.isUsage && v.name === definitionName);

	// Chapters: the def's subviews, with the usage's own added or put in their place.
	const inherited = directChildren(source.views, definition);
	const own = view?.isUsage ? directChildren(source.views, view) : [];
	let chapters: Chapter[] = [
		...inherited.filter((c) => !own.some((o) => o.name === c.name)),
		...own
	].map((v) => toChapter(source.analyses, v));
	if (!definition && (kind === 'specification' || kind === 'icd')) {
		chapters = [...STANDARD_CHAPTERS[kind], ...own.map((v) => toChapter(source.analyses, v))];
	}

	const projectName = source.project?.name ?? 'Project';
	let description = source.project?.description ?? null;
	if (!description) {
		const pkg = describingPackage(source.tree, projectName);
		description = pkg?.doc ? docSummary(pkg.doc) : null;
	}
	const kindLabel = standard?.title ?? 'Report';
	const exposes = view?.isUsage ? (view.exposes ?? []) : [];
	return {
		kind,
		view: view?.name ?? name,
		doc: view?.isUsage ? (view.doc ?? null) : (standard?.description ?? null),
		kindLabel,
		defaultTitle: standard
			? `${projectName} ${standard.title[0]!.toLowerCase()}${standard.title.slice(1)}`
			: viewTitle(view?.name ?? name),
		project: { name: projectName, description, version: source.project?.version ?? null },
		meta: metaOf(source.analyses, view),
		exposes,
		scope: exposes.map(parseExpose),
		chapters,
		index: indexModel(source.tree, source.isLibrary),
		requirements: source.requirements,
		derivations: projectDerivations(source.texts, (path) => !source.isLibrary(path)),
		analyses: source.analyses,
		texts: source.texts,
		tables: {},
		diagram: null,
		date,
		revision: source.revision?.stamp ?? 'Not committed',
		revisionInfo: source.revision?.info ?? null
	};
}

/** Add what the engine renders: plain table chapters and the interconnection diagram. */
export async function renderParts(
	ctx: ReportContext,
	engine: Engine,
	files: { path: string; text: string }[]
): Promise<ReportContext> {
	const tables: ReportContext['tables'] = {};
	for (const chapter of ctx.chapters) {
		if (chapterKind(chapter) !== 'table') continue;
		try {
			tables[chapter.qualifiedName] = await engine.renderView(files, chapter.qualifiedName);
		} catch (error) {
			tables[chapter.qualifiedName] = {
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	let diagram: ReportContext['diagram'] = null;
	if (ctx.chapters.some((c) => chapterKind(c) === 'interconnection')) {
		const scope = diagramScope(ctx);
		if (scope) {
			try {
				const graph = await engine.diagram('interconnection', files, scope.name);
				const { diagramSvg } = await import('./diagram.ts');
				const svg = await diagramSvg(graph, ctx, scope);
				if (svg) diagram = { svg, scope: scope.label };
			} catch {
				diagram = null;
			}
		}
	}
	return { ...ctx, tables, diagram };
}
