/**
 * A report view → a document. The report's subviews are its chapters, in
 * order; each is drawn by what its view def says it is (a requirements
 * table becomes the requirements chapter, a general view filtered to port
 * definitions becomes the port definitions chapter …). Any other table
 * view is included as the table the engine renders.
 */
import type { RenderedTable } from '#lib/engine/types.ts';
import { viewTitle } from '#lib/workbench/views.ts';
import type { Chapter, ReportContext } from './context.ts';
import {
	cleanDoc,
	longDate,
	numberSections,
	slug,
	t,
	type Block,
	type ReportDocument,
	type Section,
	type Text
} from './document.ts';
import {
	connectionsChapter,
	icdSummary,
	interconnectionChapter,
	interfacesChapter,
	itemsChapter,
	portDefinitionsChapter,
	portUsageChapter
} from './icd.ts';
import type { ReportKind } from './kinds.ts';
import {
	coverageChapter,
	gapsChapter,
	requirementsChapter,
	specificationSummary,
	traceabilityChapter
} from './specification.ts';

export type ChapterKind =
	| 'requirements'
	| 'traceability'
	| 'coverage'
	| 'gaps'
	| 'interconnection'
	| 'connections'
	| 'interfaces'
	| 'portDefinitions'
	| 'items'
	| 'portUsage'
	| 'table'
	| 'unsupported';

/** What a subview shows, from its view def (and `filter`, for general views). */
export function chapterKind(chapter: Chapter): ChapterKind {
	switch (chapter.definition) {
		case 'RequirementsTable':
			return 'requirements';
		case 'TraceMatrix':
		case 'VerificationMatrix':
			return 'traceability';
		case 'RequirementsTraceMatrix':
			return 'coverage';
		case 'RequirementGaps':
			return 'gaps';
		case 'InterconnectionView':
			return 'interconnection';
		case 'ConnectionTable':
			return 'connections';
		case 'InterfaceTable':
		case 'PortTable':
			return 'portUsage';
		case 'GeneralView': {
			const filter = chapter.filters.join(' ');
			if (/InterfaceDefinition/.test(filter)) return 'interfaces';
			if (/PortDefinition/.test(filter)) return 'portDefinitions';
			if (/ItemDefinition/.test(filter)) return 'items';
			return 'unsupported';
		}
		default:
			return chapter.hasTable ? 'table' : 'unsupported';
	}
}

/** The chapters of the standard reports, as `ModelViews.sysml` defines them. */
export const STANDARD_CHAPTERS: Record<'specification' | 'icd', Chapter[]> = {
	specification: [
		chapter(
			'requirementsChapter',
			'RequirementsTable',
			'The requirements, by package, each with its attributes and trace.'
		),
		chapter(
			'traceabilityChapter',
			'TraceMatrix',
			'What satisfies and what verifies each requirement, at a glance.'
		),
		chapter(
			'coverageChapter',
			'RequirementsTraceMatrix',
			'How many requirements are satisfied and verified.'
		),
		chapter('gapsChapter', 'RequirementGaps', 'Requirements not yet satisfied or not yet verified.')
	],
	icd: [
		chapter(
			'interconnectionChapter',
			'InterconnectionView',
			'The parts and the connections between them.'
		),
		chapter(
			'connectionsChapter',
			'ConnectionTable',
			'Every connection: which ports it joins and through which interface.'
		),
		chapter(
			'interfacesChapter',
			'GeneralView',
			'The interface definitions: their ends and what flows between them.',
			['@SysML::InterfaceDefinition']
		),
		chapter(
			'portsChapter',
			'GeneralView',
			'The port definitions: what goes in and what comes out.',
			['@SysML::PortDefinition']
		),
		chapter('itemsChapter', 'GeneralView', 'The items that flow through the ports.', [
			'@SysML::ItemDefinition'
		]),
		chapter(
			'portUsageChapter',
			'InterfaceTable',
			"Each part's ports, and what they are connected to."
		)
	]
};

function chapter(name: string, definition: string, doc: string, filters: string[] = []): Chapter {
	return {
		name,
		qualifiedName: name,
		definition,
		doc,
		filters,
		hasTable: !['InterconnectionView', 'GeneralView'].includes(definition)
	};
}

function tableChapter(ctx: ReportContext, chapter: Chapter): Section {
	const rendered = ctx.tables[chapter.qualifiedName];
	const blocks: Block[] = cleanDoc(chapter.doc).map((p) => ({
		type: 'paragraph',
		text: [t(p)],
		muted: true
	}));
	if (!rendered) {
		blocks.push({ type: 'paragraph', text: [t('This table has not been rendered.')] });
	} else if ('error' in rendered) {
		blocks.push({
			type: 'note',
			label: 'Could not render',
			text: [t(rendered.error)],
			tone: 'bad'
		});
	} else {
		blocks.push(renderedTable(ctx, rendered));
	}
	return { id: slug(chapter.name), number: '', title: chapterTitle(chapter), blocks, sections: [] };
}

/** An engine-rendered table as a document table; the first column links to each row's element. */
export function renderedTable(ctx: ReportContext, table: RenderedTable): Block {
	const keyOf = (i: number) => {
		const source = table.sources[i];
		if (!source) return undefined;
		const name = source.element.split('::').pop()?.replace(/^'|'$/g, '') ?? '';
		return ctx.index.elements.find(
			(e) => e.file === source.file && (e.label === name || e.span.start_row === source.line)
		)?.key;
	};
	if (!table.rows.length) return { type: 'paragraph', text: [t('Nothing in scope.')] };
	return {
		type: 'table',
		columns: table.columns.map(viewTitle),
		numeric: table.columns.map((_, c) =>
			table.rows.every((r) => r[c] === '' || !Number.isNaN(Number(r[c])))
		),
		rows: table.rows.map((cells, i): Text[] =>
			cells.map((cell, c) => [c === 0 ? t(cell, keyOf(i)) : t(cell)])
		)
	};
}

/** `requirementsChapter` → `Requirements`; `fmeaWorksheet` → `Fmea worksheet`. */
export function chapterTitle(chapter: Chapter): string {
	return viewTitle(chapter.name.replace(/(Chapter|Section)$/, '') || chapter.name);
}

function unsupported(chapter: Chapter): Section {
	return {
		id: slug(chapter.name),
		number: '',
		title: chapterTitle(chapter),
		blocks: [
			{
				type: 'note',
				label: 'Not shown',
				text: [
					t(
						`${chapter.name} is a ${chapter.definition} view, which reports cannot show yet. Open it from the explorer instead.`
					)
				],
				tone: 'plain'
			}
		],
		sections: []
	};
}

export function chapterSection(ctx: ReportContext, chapter: Chapter): Section {
	switch (chapterKind(chapter)) {
		case 'requirements':
			return requirementsChapter(ctx, chapter);
		case 'traceability':
			return traceabilityChapter(ctx, chapter);
		case 'coverage':
			return coverageChapter(ctx, chapter);
		case 'gaps':
			return gapsChapter(ctx, chapter);
		case 'interconnection':
			return interconnectionChapter(ctx, chapter);
		case 'connections':
			return connectionsChapter(ctx, chapter);
		case 'interfaces':
			return interfacesChapter(ctx, chapter);
		case 'portDefinitions':
			return portDefinitionsChapter(ctx, chapter);
		case 'items':
			return itemsChapter(ctx, chapter);
		case 'portUsage':
			return portUsageChapter(ctx, chapter);
		case 'table':
			return tableChapter(ctx, chapter);
		default:
			return unsupported(chapter);
	}
}

const HOW_TO_READ: Partial<Record<ReportKind, string>> = {
	specification:
		'Each requirement has an ID, a short title and a statement of what shall be true. "Satisfied by" names the part of the design that meets it; "Verified by" names the test, analysis or inspection that checks it. A requirement with neither is a gap.',
	icd: 'Parts connect through ports. A port definition says what goes in and what comes out; an interface definition is a reusable kind of connection between two matching ports, and says what flows across it. Each connection joins two ports of the parts in scope.'
};

function introduction(ctx: ReportContext): Section {
	const blocks: Block[] = [];
	if (ctx.exposes.length) {
		blocks.push({
			type: 'facts',
			facts: [
				{
					label: 'Covers',
					value: ctx.exposes.flatMap((e, i): Text => [
						...(i ? [t(', ')] : []),
						{ text: e, code: true }
					])
				}
			]
		});
	} else {
		blocks.push({ type: 'facts', facts: [{ label: 'Covers', value: [t('The whole model')] }] });
	}
	const reading = HOW_TO_READ[ctx.kind];
	if (reading) blocks.push({ type: 'paragraph', text: [t(reading)] });
	blocks.push({
		type: 'paragraph',
		text: [
			t(
				`Generated from the SysML model of ${ctx.project.name} on ${longDate(ctx.date)} (${lowerFirst(ctx.revision)}).${baselineSentence(ctx)} The model is the reference: where this document and the model differ, the model is right.`
			)
		],
		muted: true
	});
	return { id: 'introduction', number: '', title: 'Introduction', blocks, sections: [] };
}

/** ` It is baseline CDR.`, ` It has changed since baseline CDR.`, or nothing. */
function baselineSentence(ctx: ReportContext): string {
	if (!ctx.baseline) return '';
	return ctx.baseline.exact
		? ` The model is baseline ${ctx.baseline.name}.`
		: ` The model has changed since baseline ${ctx.baseline.name}.`;
}

/** `Commit 3f2a9c1 …` → `commit 3f2a9c1 …`, `Not committed` → `not committed`. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function buildReport(ctx: ReportContext): ReportDocument {
	const sections = [
		introduction(ctx),
		...ctx.chapters.map((c) => ({
			...chapterSection(ctx, c),
			source: { name: c.name, definition: c.definition, ...(c.file ? { file: c.file } : {}) }
		}))
	];
	const summary =
		ctx.kind === 'specification'
			? specificationSummary(ctx)
			: ctx.kind === 'icd'
				? icdSummary(ctx)
				: [];
	return {
		kind: ctx.kind,
		view: ctx.view,
		title: ctx.meta.title || ctx.defaultTitle,
		kindLabel: ctx.kindLabel,
		project: ctx.project.name,
		description: cleanDoc(ctx.doc).join(' ') || null,
		number: ctx.meta.number ?? null,
		version: ctx.meta.version ?? ctx.project.version ?? null,
		status: ctx.meta.status ?? null,
		author: ctx.meta.author ?? null,
		date: longDate(ctx.date),
		revision: ctx.revision,
		baseline: ctx.baseline,
		scope: ctx.exposes,
		summary,
		sections: numberSections(sections)
	};
}
