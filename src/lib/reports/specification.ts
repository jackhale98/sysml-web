/**
 * The chapters of a requirements specification: the requirements by
 * package (with their derivation tree when derivation links exist), the
 * traceability table, coverage figures and the gaps.
 */
import { coverageRule, passedRule, type Covered } from '#lib/project/coverage.ts';
import { derivationEnds, derivationLinks as linksBetween } from '#lib/project/derivations.ts';
import type { RequirementRow } from '#lib/project/requirements.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import {
	freshness,
	OUTCOME_LABEL,
	outcomeOf,
	resultLabel,
	shortCommit,
	type Outcome
} from '#lib/project/verification.ts';
import type { Chapter, ReportContext } from './context.ts';
import {
	cleanDoc,
	count,
	joined,
	percent,
	slug,
	t,
	type Block,
	type Run,
	type Section,
	type Text,
	type Tone,
	type TreeItem
} from './document.ts';
import { inScope, packageOf, resolveReference } from './model.ts';

export interface RequirementTrace {
	row: RequirementRow;
	element: ModelElement | undefined;
	package: ModelElement | null;
	satisfiedBy: Run[];
	verifiedBy: Run[];
	derivedFrom: RequirementRow[];
	derives: RequirementRow[];
	/** Satisfied directly, or through the requirements derived from it (all of them): the coverage rule. */
	satisfied: Covered;
	verified: Covered;
	/** Its verification cases all passed, and the results still hold (directly or through derived requirements). */
	passed: Covered;
	/** How its own verification went, from its cases' recorded results (null: nothing verifies it). */
	outcome: Outcome | null;
}

const traced = new WeakMap<ReportContext, RequirementTrace[]>();

/** The requirements in the report's scope, with their trace resolved to elements. */
export function requirementsInScope(ctx: ReportContext): RequirementTrace[] {
	let traces = traced.get(ctx);
	if (!traces) traced.set(ctx, (traces = trace(ctx)));
	return traces;
}

function trace(ctx: ReportContext): RequirementTrace[] {
	const { index } = ctx;
	const rows = ctx.requirements.filter((row) => {
		const element = index.byKey.get(row.key);
		return element ? inScope(index, element, ctx.scope) : !ctx.scope.length;
	});
	const links = derivationLinks(ctx);
	// The one coverage rule (#lib/project/coverage.ts), over every requirement of the model;
	// a derived end that doesn't resolve (null) is never covered.
	const children = new Map<RequirementRow, (RequirementRow | null)[]>();
	for (const l of derivationEnds(ctx.requirements, ctx.derivations))
		children.set(l.original, [...(children.get(l.original) ?? []), l.derived]);
	const into = (row: RequirementRow) => children.get(row) ?? [];
	const satisfied = coverageRule(ctx.requirements, (r) => r.satisfiedBy.length > 0, into);
	const verified = coverageRule(ctx.requirements, (r) => r.verifiedBy.length > 0, into);
	const passed = passedRule(
		ctx.requirements.map((r) => ({ ...r, derivedInto: into(r).map((c) => c?.key ?? '?') })),
		ctx.revisionInfo
	);
	const passedByKey = new Map([...passed].map(([r, how]) => [r.key, how]));
	return rows.map((row) => {
		const element = index.byKey.get(row.key);
		// Trace names are written where the satisfy or verify is, not in the requirement.
		const refs = (names: string[]) =>
			names.map((name) => t(name, resolveReference(index, name)?.key));
		return {
			row,
			element,
			package: element ? packageOf(index, element) : null,
			satisfiedBy: refs(row.satisfiedBy),
			verifiedBy: refs(row.verifiedBy),
			derivedFrom: links.filter((l) => l.derived === row).map((l) => l.original),
			derives: links.filter((l) => l.original === row).map((l) => l.derived),
			satisfied: satisfied.get(row) ?? null,
			verified: verified.get(row) ?? null,
			passed: passedByKey.get(row.key) ?? null,
			outcome: outcomeOf(row.results ?? [], ctx.revisionInfo)
		};
	});
}

/** Derivation links between requirement rows (anywhere in the model). */
export function derivationLinks(
	ctx: ReportContext
): { original: RequirementRow; derived: RequirementRow }[] {
	return linksBetween(ctx.requirements, ctx.derivations);
}

export function requirementRef(row: RequirementRow): Run {
	return t(row.id ? `${row.id} ${row.title}` : row.title, row.key);
}

const THROUGH_DERIVED = 'Through the requirements derived from it';

const STATUS_TONE: Record<string, Tone> = {
	closed: 'ok',
	done: 'ok',
	approved: 'ok',
	verified: 'ok',
	open: 'plain',
	draft: 'plain',
	tbc: 'warn',
	tbd: 'warn',
	tbr: 'warn',
	rejected: 'bad'
};

const STATUS_LABEL: Record<string, string> = {
	tbc: 'TBC',
	tbd: 'TBD',
	tbr: 'TBR'
};

export function statusBadge(status: string | null): Section['badge'] {
	if (!status) return undefined;
	const key = status.toLowerCase();
	return { text: STATUS_LABEL[key] ?? capitalize(status), tone: STATUS_TONE[key] ?? 'plain' };
}

function capitalize(text: string): string {
	return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function words(values: string[]): string {
	return capitalize(values.join(', '));
}

/** Each verifying case's result: `enduranceFlightTest: Passed on 2026-10-20 at 3f2a9c1`. */
function resultsText(ctx: ReportContext, row: RequirementRow): string {
	return row.verifiedBy
		.map((by, i) => {
			const result = row.results?.[i] ?? null;
			if (!result) return `${by}: not run`;
			const fresh = freshness(result, ctx.revisionInfo);
			const when = result.date ? ` on ${result.date}` : '';
			const at = result.commit ? ` at ${shortCommit(result.commit)}` : ', commit unknown';
			return `${by}: ${resultLabel(result, fresh)}${when}${at}`;
		})
		.join('; ');
}

function entry(ctx: ReportContext, trace: RequirementTrace): Section {
	const { row } = trace;
	const statement = cleanDoc(row.text);
	const facts: { label: string; value: Text }[] = [];
	const add = (label: string, value: string | null | undefined) => {
		if (value) facts.push({ label, value: [t(value)] });
	};
	add('Kind', row.kind && capitalize(row.kind));
	add('Priority', row.priority && capitalize(row.priority));
	add('Verification', row.verificationMethods.length ? words(row.verificationMethods) : null);
	add('Owner', row.owner);
	if (trace.derivedFrom.length)
		facts.push({ label: 'Derived from', value: joined(trace.derivedFrom.map(requirementRef)) });
	if (trace.derives.length)
		facts.push({ label: 'Derived into', value: joined(trace.derives.map(requirementRef)) });
	facts.push({
		label: 'Satisfied by',
		value: trace.satisfiedBy.length
			? joined(trace.satisfiedBy)
			: [t(trace.satisfied ? THROUGH_DERIVED : 'Nothing in the design yet')]
	});
	facts.push({
		label: 'Verified by',
		value: trace.verifiedBy.length
			? joined(trace.verifiedBy)
			: [t(trace.verified ? THROUGH_DERIVED : 'No verification yet')]
	});
	if (trace.outcome)
		facts.push({
			label: 'Result',
			value: [t(`${OUTCOME_LABEL[trace.outcome]}. ${resultsText(ctx, row)}.`)]
		});

	const blocks: Block[] = [];
	if (statement.length) {
		for (const paragraph of statement) blocks.push({ type: 'statement', text: [t(paragraph)] });
	} else {
		blocks.push({ type: 'paragraph', text: [t('No statement written yet.')], muted: true });
	}
	blocks.push({ type: 'facts', facts });
	if (row.rationale)
		blocks.push({ type: 'note', label: 'Rationale', text: [t(row.rationale)], tone: 'plain' });
	for (const issue of row.issues)
		blocks.push({ type: 'note', label: 'Open issue', text: [t(issue)], tone: 'warn' });
	return {
		id: slug(row.id ?? row.title),
		number: '',
		title: row.title,
		tag: row.id ?? undefined,
		ref: row.key,
		badge: statusBadge(row.status),
		blocks,
		sections: []
	};
}

/** Requirements grouped by their package, in model order. */
function byPackage(traces: RequirementTrace[]) {
	const groups = new Map<string, { pkg: ModelElement | null; traces: RequirementTrace[] }>();
	for (const trace of traces) {
		const key = trace.package?.key ?? '';
		if (!groups.has(key)) groups.set(key, { pkg: trace.package, traces: [] });
		groups.get(key)!.traces.push(trace);
	}
	return [...groups.values()];
}

function intro(chapter: Chapter | undefined, fallback: string): Block[] {
	const paragraphs = cleanDoc(chapter?.doc);
	return (paragraphs.length ? paragraphs : [fallback]).map((p) => ({
		type: 'paragraph' as const,
		text: [t(p)],
		muted: true
	}));
}

function derivationTree(traces: RequirementTrace[]): TreeItem[] {
	const inScope = new Set(traces.map((tr) => tr.row));
	const byRow = new Map(traces.map((tr) => [tr.row, tr]));
	const roots = traces.filter(
		(tr) => tr.derives.length && !tr.derivedFrom.some((r) => inScope.has(r))
	);
	const build = (row: RequirementTrace['row'], seen: Set<unknown>): TreeItem => ({
		text: [requirementRef(row)],
		children: (byRow.get(row)?.derives ?? [])
			.filter((d) => inScope.has(d) && !seen.has(d))
			.map((d) => build(d, new Set([...seen, d])))
	});
	return roots.map((r) => build(r.row, new Set([r.row])));
}

export function requirementsChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const traces = requirementsInScope(ctx);
	const groups = byPackage(traces);
	const blocks = intro(
		chapter,
		'Each requirement has an ID, a title and a statement, with its attributes and trace.'
	);
	let sections: Section[];
	if (!traces.length) {
		blocks.push({ type: 'paragraph', text: [t('There are no requirements in scope.')] });
		sections = [];
	} else if (groups.length === 1) {
		const pkgDoc = cleanDoc(groups[0]!.pkg?.doc);
		if (pkgDoc[0]) blocks.push({ type: 'paragraph', text: [t(pkgDoc[0])] });
		sections = traces.map((tr) => entry(ctx, tr));
	} else {
		sections = groups.map(({ pkg, traces: list }) => ({
			id: slug(pkg?.label ?? 'requirements'),
			number: '',
			title: pkg ? spaced(pkg.label) : 'Requirements',
			ref: pkg?.key,
			blocks: cleanDoc(pkg?.doc)
				.slice(0, 1)
				.map((p) => ({ type: 'paragraph' as const, text: [t(p)] })),
			sections: list.map((tr) => entry(ctx, tr))
		}));
	}
	const tree = derivationTree(traces);
	if (tree.length) {
		sections.push({
			id: 'derivation',
			number: '',
			title: 'Derivation',
			blocks: [
				{
					type: 'paragraph',
					text: [
						t('Which requirements are derived from which: each one answers the one above it.')
					],
					muted: true
				},
				{ type: 'tree', items: tree }
			],
			sections: []
		});
	}
	return { id: 'requirements', number: '', title: 'Requirements', blocks, sections };
}

/** `SystemRequirements` → `System requirements`. */
export function spaced(name: string): string {
	const text = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
	return text[0]!.toUpperCase() + text.slice(1).toLowerCase();
}

export function traceabilityChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const traces = requirementsInScope(ctx);
	const derived = traces.some((tr) => tr.derivedFrom.length);
	const columns = [
		'ID',
		'Requirement',
		...(derived ? ['Derived from'] : []),
		'Satisfied by',
		'Verified by'
	];
	const rows = traces.map((tr): Text[] => [
		[t(tr.row.id ?? '')],
		[t(tr.row.title, tr.row.key)],
		...(derived ? [joined(tr.derivedFrom.map((r) => t(r.id ?? r.title, r.key)))] : []),
		tr.satisfiedBy.length
			? joined(tr.satisfiedBy)
			: [t(tr.satisfied ? 'Derived requirements' : '—')],
		tr.verifiedBy.length ? joined(tr.verifiedBy) : [t(tr.verified ? 'Derived requirements' : '—')]
	]);
	return {
		id: 'traceability',
		number: '',
		title: 'Traceability',
		blocks: [
			...intro(chapter, 'What satisfies and what verifies each requirement.'),
			rows.length
				? { type: 'table', columns, rows }
				: { type: 'paragraph', text: [t('There are no requirements in scope.')] }
		],
		sections: []
	};
}

export interface Coverage {
	/** How a requirement is covered: directly, through all it is derived into, or not. */
	how: Covered;
	total: number;
	satisfied: number;
	verified: number;
	/** Verified, and every result passed and still holds. */
	passed: number;
	both: number;
	gaps: number;
}

export function coverageOf(traces: RequirementTrace[]): Omit<Coverage, 'how'> {
	const satisfied = traces.filter((tr) => tr.satisfied).length;
	const verified = traces.filter((tr) => tr.verified).length;
	const passed = traces.filter((tr) => tr.passed).length;
	const both = traces.filter((tr) => tr.satisfied && tr.verified).length;
	return { total: traces.length, satisfied, verified, passed, both, gaps: traces.length - both };
}

function tone(part: number, whole: number): Tone {
	return !whole || part === whole ? 'ok' : part / whole >= 0.75 ? 'warn' : 'bad';
}

export function coverageChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const traces = requirementsInScope(ctx);
	const c = coverageOf(traces);
	const blocks: Block[] = [
		...intro(chapter, 'How much of the scope is satisfied by the design and verified.'),
		...(traces.some((tr) => tr.satisfied === 'derived' || tr.verified === 'derived')
			? [
					{
						type: 'paragraph' as const,
						text: [
							t(
								'A requirement that has been derived into others counts as satisfied (or verified, or passed) when all of those are.'
							)
						],
						muted: true
					}
				]
			: []),
		{
			type: 'metrics',
			items: [
				{ label: 'Requirements', value: String(c.total) },
				{
					label: 'Satisfied',
					value: percent(c.satisfied, c.total),
					detail: `${c.satisfied} of ${c.total}`,
					tone: tone(c.satisfied, c.total)
				},
				{
					label: 'Verified',
					value: percent(c.verified, c.total),
					detail: `${c.verified} of ${c.total}`,
					tone: tone(c.verified, c.total)
				},
				{
					label: 'Fully traced',
					value: percent(c.both, c.total),
					detail: `${c.both} of ${c.total}`,
					tone: tone(c.both, c.total)
				},
				{
					label: 'Tests passed',
					value: percent(c.passed, c.total),
					detail: `${c.passed} of ${c.total}`,
					tone: tone(c.passed, c.total)
				}
			]
		}
	];
	const groups = byPackage(traces);
	if (groups.length > 1) {
		blocks.push({
			type: 'table',
			caption: 'By package',
			columns: ['Package', 'Requirements', 'Satisfied', 'Verified', 'Passed'],
			numeric: [false, true, true, true, true],
			rows: groups.map(({ pkg, traces: list }) => {
				const g = coverageOf(list);
				return [
					[t(pkg ? spaced(pkg.label) : '—', pkg?.key)],
					[t(String(g.total))],
					[t(`${g.satisfied} (${percent(g.satisfied, g.total)})`)],
					[t(`${g.verified} (${percent(g.verified, g.total)})`)],
					[t(`${g.passed} (${percent(g.passed, g.total)})`)]
				];
			})
		});
	}
	return { id: 'coverage', number: '', title: 'Coverage', blocks, sections: [] };
}

export function gapsChapter(ctx: ReportContext, chapter?: Chapter): Section {
	const traces = requirementsInScope(ctx).filter((tr) => !tr.satisfied || !tr.verified);
	const blocks: Block[] = intro(
		chapter,
		'Requirements that nothing in the design satisfies yet, or that nothing verifies.'
	);
	if (!traces.length) {
		blocks.push({
			type: 'note',
			label: 'No gaps',
			text: [t('Every requirement in scope is satisfied by the design and verified.')],
			tone: 'ok'
		});
	} else {
		blocks.push({
			type: 'paragraph',
			text: [
				t(`${count(traces.length, 'requirement is', 'requirements are')} not yet fully traced.`)
			]
		});
		blocks.push({
			type: 'table',
			columns: ['ID', 'Requirement', 'Missing', 'Owner', 'Status'],
			rows: traces.map((tr) => {
				const missing = [
					...(tr.satisfied ? [] : ['a design element that satisfies it']),
					...(tr.verified ? [] : ['a verification'])
				];
				return [
					[t(tr.row.id ?? '')],
					[t(tr.row.title, tr.row.key)],
					[t(capitalize(missing.join(' and ')))],
					[t(tr.row.owner ?? '—')],
					[t(statusBadge(tr.row.status)?.text ?? '—')]
				];
			})
		});
	}
	return { id: 'gaps', number: '', title: 'Gaps', blocks, sections: [] };
}

/** Title-page figures. */
export function specificationSummary(ctx: ReportContext): { label: string; value: string }[] {
	const c = coverageOf(requirementsInScope(ctx));
	return [
		{ label: 'Requirements', value: String(c.total) },
		{ label: 'Satisfied', value: percent(c.satisfied, c.total) },
		{ label: 'Verified', value: percent(c.verified, c.total) },
		{ label: 'Gaps', value: String(c.gaps) }
	];
}
