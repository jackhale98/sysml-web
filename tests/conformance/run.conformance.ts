/**
 * The conformance runner (`npm run assess:conformance`; corpora from
 * `scripts/fetch-conformance.sh`). It runs the toolkit engine and Tessera's
 * layer over it on:
 *
 * 1. the OMG SysML v2 Release corpus (every file is meant to be valid: the
 *    corpus has no files marked invalid; its "this should fail" lines are
 *    commented out), each file alone and each folder as one project —
 *    parse, reference resolution and validation findings, measured
 *    separately; then, per project, what Tessera makes of it: diagnostics
 *    shown (and where), the model adapter's elements and kinds, and the
 *    standard diagrams;
 * 2. the OMG pilot implementation's Xpect suites: the errors, `noErrors`
 *    and `linkedName` expectations its implementers declared;
 * 3. OpenSysML's negative corpus, when present: models that must be
 *    rejected, with the pilot's recorded verdicts.
 *
 * Writes `results.json` (machine-readable, per file and per folder) and
 * `summary.md` to `CONFORMANCE_OUT` (default `.cache/conformance/out/`).
 * Asserts nothing about the numbers: it measures.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { SourceFile } from '#lib/engine/protocol.ts';
import type { TkFinding, TkLenient, TkSession, TkSite } from '#lib/engine/toolkit/api.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { extractModel, type UnitInfo } from '#lib/engine/toolkit/model.ts';
import { demoFiles, loadHost, toolkitMemoryMiB } from '#lib/engine/toolkit/testing.ts';
import type { DiagramGraph, DiagramView } from '#lib/engine/types.ts';
import {
	negativeCases,
	paths,
	releaseProjects,
	revision,
	xpectCases,
	type CorpusProject,
	type XpectCase
} from './corpus';

/** Reference-valued properties of the compact interchange that a name written in the text fills. */
const REFERENCE_PROPERTIES = new Set([
	'type',
	'superclassifier',
	'general',
	'subsettedFeature',
	'redefinedFeature',
	'referencedFeature',
	'chainingFeature',
	'crossedFeature',
	'memberElement',
	'importedMembership',
	'importedNamespace',
	'annotatedElement',
	'client',
	'supplier',
	'featuringType',
	'disjoiningType',
	'unioningType',
	'intersectingType',
	'differencingType',
	'invertingFeature'
]);

/** Metaclasses the walk counts but the adapter reads as text (values, bounds). */
const EXPRESSION = /(Expression|^Literal\w*|^MultiplicityRange|^Multiplicity)$/;
/** Metaclasses the adapter leaves out on purpose (`model.ts`). */
const ADAPTER_SKIPS = new Set(['ConjugatedPortDefinition', 'Documentation', 'Comment']);

interface EngineResult {
	parseErrors: { unit: string; line: number; message: string }[];
	findings: TkFinding[];
	references: { total: number; unresolved: number; unresolvedByProperty: Record<string, number> };
	/** The toolkit's own count (`unresolvedCount()`; it counts more than written names). */
	unresolvedCount: number;
	repaired: boolean;
	ms: number;
}

const tally = (list: TkFinding[]) => {
	const out: Record<string, number> = {};
	for (const f of list)
		out[`${f.stage}/${f.severity}`] = (out[`${f.stage}/${f.severity}`] ?? 0) + 1;
	return out;
};

/** The engine alone: parse, then a session over the library, its findings and references. */
function engine(host: ToolkitHost, files: SourceFile[]): EngineResult {
	const started = performance.now();
	const { tk, library } = host;
	const sources = files.map((f) => ({ name: f.path, text: f.text }));
	const syntax = JSON.parse(tk.checkSyntax(JSON.stringify(sources))) as TkFinding[];
	const parse = syntax.filter((f) => f.stage === 'parse');
	let session: TkSession | null = null;
	let parsed = sources;
	if (parse.length) {
		const lenient = JSON.parse(tk.lenientSources(JSON.stringify(sources))) as TkLenient;
		const broken = new Set(lenient.unrepaired.map((u) => u.unit));
		parsed = lenient.sources.filter((s) => !broken.has(s.name));
	}
	const result: EngineResult = {
		parseErrors: parse.map((f) => ({ unit: f.unit, line: f.line, message: f.message })),
		findings: syntax.filter((f) => f.stage !== 'parse'),
		references: { total: 0, unresolved: 0, unresolvedByProperty: {} },
		unresolvedCount: 0,
		repaired: parse.length > 0,
		ms: 0
	};
	try {
		session = tk.Session.fromSourcesWithPreparedLibrary(JSON.stringify(parsed), library);
		const seen = new Set(result.findings.map(key));
		for (const f of JSON.parse(session.check()) as TkFinding[])
			if (!seen.has(key(f))) result.findings.push(f);
		result.unresolvedCount = session.unresolvedCount();
		for (const element of JSON.parse(session.toCompactJson()) as Record<string, unknown>[]) {
			for (const [property, value] of Object.entries(element)) {
				if (!REFERENCE_PROPERTIES.has(property)) continue;
				for (const v of Array.isArray(value) ? value : [value]) {
					if (!v || typeof v !== 'object') continue;
					result.references.total++;
					if ('@ref' in v) {
						result.references.unresolved++;
						result.references.unresolvedByProperty[property] =
							(result.references.unresolvedByProperty[property] ?? 0) + 1;
					}
				}
			}
		}
	} finally {
		session?.free();
	}
	result.ms = Math.round(performance.now() - started);
	return result;
}

const key = (f: TkFinding) => `${f.unit}:${f.line}:${f.col}:${f.message}`;

/** UTF-8 byte offset of a 1-based line and byte column. */
function byteOffset(bytes: Buffer, line: number, col: number): number {
	let at = 0;
	for (let l = 1; l < line; l++) {
		const nl = bytes.indexOf(10, at);
		if (nl < 0) return bytes.length;
		at = nl + 1;
	}
	return at + col - 1;
}

interface TesseraResult {
	diagnostics: {
		/** Engine findings (files that parse) shown with the same message on the same line. */
		matched: number;
		/** … whose highlighted text is exactly the engine's byte range. */
		exactRange: number;
		missing: { file: string; line: number; message: string }[];
		extra: { file: string; line: number; message: string }[];
		wrongRange: { file: string; line: number; message: string; engine: string; shown: string }[];
	};
	adapter: {
		/** User elements the toolkit's tree holds (expressions excepted). */
		walked: number;
		/** … with a place in the text (`memberExtent`). */
		located: number;
		/** Located elements the adapter dropped (other than comments and docs, on purpose). */
		lost: { metaclass: string; qualifiedName: string | null }[];
		/** Named elements without a place in the text: the app can't show or edit them. */
		unlocated: Record<string, number>;
		/** Named records the app's `Model` (explorer, tables) has no definition or usage for. */
		notInModel: { metaclass: string; qualifiedName: string | null }[];
		/** metaclass → app kind → count. */
		kinds: Record<string, Record<string, number>>;
	};
	diagrams: {
		/** Named, located elements drawn as a node or an edge, or listed in a compartment of their owner's node. */
		shown: Record<string, { total: number; shown: number }>;
		errors: { view: string; scope: string | null; message: string }[];
		built: number;
	};
	ms: number;
}

/** What Tessera makes of a project: diagnostics, the adapter's model, diagrams. */
function fairtide(host: ToolkitHost, files: SourceFile[], engineRun: EngineResult): TesseraResult {
	const started = performance.now();
	const analyses = host.analyzeProject(files);
	const out: TesseraResult = {
		diagnostics: { matched: 0, exactRange: 0, missing: [], extra: [], wrongRange: [] },
		adapter: { walked: 0, located: 0, lost: [], unlocated: {}, notInModel: [], kinds: {} },
		diagrams: { shown: {}, errors: [], built: 0 },
		ms: 0
	};

	// Diagnostics: every engine finding of a file that parses, shown on its line, over its exact text.
	const broken = new Set(engineRun.parseErrors.map((p) => p.unit));
	const shown = analyses.flatMap((a, i) =>
		a.diagnostics.map((d) => ({ ...d, file: files[i]!.path, used: false }))
	);
	for (const f of engineRun.findings) {
		if (broken.has(f.unit)) continue;
		const file = files.find((x) => x.path === f.unit);
		if (!file) continue;
		const d = shown.find(
			(s) => !s.used && s.file === f.unit && s.message === f.message && s.span.start_row === f.line
		);
		if (!d) {
			out.diagnostics.missing.push({ file: f.unit, line: f.line, message: f.message });
			continue;
		}
		d.used = true;
		out.diagnostics.matched++;
		const bytes = Buffer.from(file.text, 'utf8');
		const engineText = bytes
			.subarray(byteOffset(bytes, f.line, f.col), byteOffset(bytes, f.endLine, f.endCol))
			.toString('utf8');
		const shownText = file.text.slice(d.span.from ?? 0, d.span.to ?? 0);
		if (engineText === shownText) out.diagnostics.exactRange++;
		else
			out.diagnostics.wrongRange.push({
				file: f.unit,
				line: f.line,
				message: f.message,
				engine: engineText,
				shown: shownText
			});
	}
	for (const s of shown)
		if (!s.used && !broken.has(s.file))
			out.diagnostics.extra.push({ file: s.file, line: s.span.start_row, message: s.message });

	// The adapter, against an independent walk of the same session.
	const { session, units } = host.session(files);
	if (session) {
		const byIndex = new Map<number, UnitInfo>();
		for (const u of JSON.parse(session.units()) as { unit: number; name: string }[]) {
			const unit = units.get(u.name);
			if (unit) byIndex.set(u.unit, unit);
		}
		const projectUnits = new Set(
			[...byIndex.entries()].filter(([, u]) => files.some((f) => f.path === u.path)).map(([i]) => i)
		);
		const extracted = extractModel(host.tk, session, byIndex);
		const ids: string[] = [];
		const walk = (handles: ReturnType<TkSession['roots']>, depth: number) => {
			for (const h of handles) {
				const metaclass = session.metaclass(h);
				if (!EXPRESSION.test(metaclass)) {
					ids.push(session.elementId(h));
					if (depth < 200) walk(session.members(h), depth + 1);
				}
				h.free();
			}
		};
		walk(session.roots(), 0);
		const rows = JSON.parse(
			session.rows(
				JSON.stringify(ids),
				JSON.stringify(['metaclass', 'name', 'qualifiedName', 'memberExtent', 'isLibraryElement'])
			)
		) as ({
			metaclass: string;
			name: string | null;
			qualifiedName: string | null;
			memberExtent: TkSite | null;
			isLibraryElement: boolean;
		} | null)[];
		const inModel = new Set<string>();
		for (const a of analyses)
			for (const e of [...a.model.definitions, ...a.model.usages]) if (e.id) inModel.add(e.id);
		rows.forEach((row, i) => {
			if (!row || row.isLibraryElement) return;
			const extent = row.memberExtent;
			if (extent && !projectUnits.has(extent.unit)) return; // a view library's element
			out.adapter.walked++;
			if (!extent) {
				if (row.name)
					out.adapter.unlocated[row.metaclass] = (out.adapter.unlocated[row.metaclass] ?? 0) + 1;
				return;
			}
			out.adapter.located++;
			const record = extracted.byId.get(ids[i]!);
			if (!record) {
				if (!ADAPTER_SKIPS.has(row.metaclass))
					out.adapter.lost.push({ metaclass: row.metaclass, qualifiedName: row.qualifiedName });
				return;
			}
			const kinds = (out.adapter.kinds[record.metaclass] ??= {});
			kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
			if (record.name && record.qualifiedName && !inModel.has(record.id))
				out.adapter.notInModel.push({
					metaclass: record.metaclass,
					qualifiedName: record.qualifiedName
				});
		});

		// Diagrams: the whole-model general view, and each machine, action and part's own view.
		const graphs: DiagramGraph[] = [];
		const draw = (view: DiagramView, scope: string | null) => {
			try {
				graphs.push(host.diagram(view, files, scope));
				out.diagrams.built++;
			} catch (error) {
				out.diagrams.errors.push({
					view,
					scope,
					message: String((error as Error).message ?? error)
				});
			}
		};
		draw('general', null);
		draw('requirements', null);
		draw('packages', null);
		const records = extracted.elements.filter((r) =>
			projectUnits.has(unitIndexOf(byIndex, r.path))
		);
		const subjects = (test: (m: string) => boolean) =>
			records.filter((r) => r.qualifiedName && test(r.metaclass)).slice(0, 40);
		for (const r of subjects(
			(m) => m === 'StateDefinition' || m === 'StateUsage' || m === 'ExhibitStateUsage'
		))
			if (!r.ownerId || !/State/.test(extracted.byId.get(r.ownerId)?.metaclass ?? ''))
				draw('states', r.qualifiedName);
		for (const r of subjects((m) => m === 'ActionDefinition')) draw('actions', r.qualifiedName);
		for (const r of subjects((m) => m === 'PartDefinition' || m === 'PartUsage'))
			if (records.some((c) => c.ownerId === r.id && /^(Part|Port)Usage$/.test(c.metaclass)))
				draw('interconnection', r.qualifiedName);
		const drawn = new Set<string>();
		const rowsOf = new Map<string, string[]>();
		for (const g of graphs) {
			for (const n of g.nodes) {
				if (!n.element) continue;
				const k = `${n.element.file}@${n.element.start_byte}`;
				drawn.add(k);
				rowsOf.set(k, [...(rowsOf.get(k) ?? []), ...n.attributes.map(([, text]) => text)]);
			}
			for (const e of g.edges)
				if (e.element) drawn.add(`${e.element.file}@${e.element.start_byte}`);
		}
		for (const r of records) {
			if (!r.name || ADAPTER_SKIPS.has(r.metaclass)) continue;
			const tally = (out.diagrams.shown[r.metaclass] ??= { total: 0, shown: 0 });
			tally.total++;
			const owner = r.ownerId ? extracted.byId.get(r.ownerId) : undefined;
			const ownerRows = owner ? (rowsOf.get(`${owner.path}@${owner.span.start_byte}`) ?? []) : [];
			const word = new RegExp(`(^|[^\\w'])${escape(r.written ?? r.name)}($|[^\\w'])`);
			if (drawn.has(`${r.path}@${r.span.start_byte}`) || ownerRows.some((t) => word.test(t)))
				tally.shown++;
		}
	}
	out.ms = Math.round(performance.now() - started);
	return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function unitIndexOf(byIndex: Map<number, UnitInfo>, path: string): number {
	for (const [i, u] of byIndex) if (u.path === path) return i;
	return -1;
}

// ---- Xpect ----

interface XpectResult {
	path: string;
	suite: string;
	/** `errors` items: an error (or syntax error) shown on the lines of its `at` text. */
	errors: {
		expected: number;
		/** … an error shown there. */
		found: number;
		/** … any problem shown there (the toolkit reports unresolved names as warnings). */
		foundAny: number;
		missed: { line: number; message: string; at: string | null; shown: string | null }[];
	};
	/** Files declaring `noErrors`: errors shown anyway. */
	noErrors: { declared: boolean; errorsShown: { line: number; message: string }[] };
	/** `linkedName`: the reference resolves to the declared element (hover's qualified name). */
	linkedName: {
		expected: number;
		agreed: number;
		disagreed: { line: number; at: string; expected: string; actual: string | null }[];
	};
	/** Errors shown that no `errors` item places on their line. */
	unexpectedErrors: { line: number; message: string }[];
	ms: number;
}

function xpect(host: ToolkitHost, c: XpectCase): XpectResult {
	const started = performance.now();
	const files = [c.file, ...c.setup];
	const analyses = host.analyzeProject(files);
	const analysis = analyses[0]!;
	const errors = [
		...analysis.model.syntax_errors.map((e) => ({ span: e.span, message: e.message })),
		...analysis.diagnostics.filter((d) => d.severity === 'error')
	];
	const problems = [
		...analysis.model.syntax_errors.map((e) => ({ span: e.span, message: e.message })),
		...analysis.diagnostics
	];
	const lineOf = (offset: number) => c.file.text.slice(0, offset).split('\n').length;
	const result: XpectResult = {
		path: c.path,
		suite: c.suite,
		errors: { expected: 0, found: 0, foundAny: 0, missed: [] },
		noErrors: { declared: false, errorsShown: [] },
		linkedName: { expected: 0, agreed: 0, disagreed: [] },
		unexpectedErrors: [],
		ms: 0
	};
	const expectedLines = new Set<number>();
	for (const a of c.assertions) {
		if (a.kind === 'noErrors') result.noErrors.declared = true;
		if (a.kind === 'errors') {
			for (const item of a.items) {
				result.errors.expected++;
				const [from, to] = [lineOf(item.from), lineOf(item.to)];
				for (let l = from; l <= to; l++) expectedLines.add(l);
				const on = (e: { span: { start_row: number; end_row: number } }) =>
					e.span.start_row <= to && e.span.end_row >= from;
				const any = problems.find(on);
				if (any) result.errors.foundAny++;
				if (errors.some(on)) result.errors.found++;
				else
					result.errors.missed.push({
						line: from,
						message: item.message,
						at: item.at,
						shown: any?.message ?? null
					});
			}
		}
		if (a.kind === 'linkedName' && a.reference) {
			result.linkedName.expected++;
			const { at, from, target } = a.reference;
			// Hover on the last segment of the reference (`A::a2` → `a2`).
			const colons = at.lastIndexOf('::');
			const last = Math.max(colons < 0 ? 0 : colons + 2, at.lastIndexOf('.') + 1);
			let actual: string | null;
			try {
				const hover = host.hover(files, c.file.path, from + last);
				actual = hover ? (/\*\*([^*]+)\*\*/.exec(hover.markdown)?.[1] ?? null) : null;
			} catch (error) {
				actual = `(hover failed: ${String((error as Error).message ?? error)})`;
			}
			if (actual && sameElement(host, files, actual, target)) result.linkedName.agreed++;
			else result.linkedName.disagreed.push({ line: lineOf(from), at, expected: target, actual });
		}
	}
	for (const e of errors) {
		if (result.noErrors.declared)
			result.noErrors.errorsShown.push({ line: e.span.start_row, message: e.message });
		let expected = false;
		for (let l = e.span.start_row; l <= e.span.end_row; l++)
			if (expectedLines.has(l)) expected = true;
		if (!expected) result.unexpectedErrors.push({ line: e.span.start_row, message: e.message });
	}
	result.ms = Math.round(performance.now() - started);
	return result;
}

/** Whether two qualified names name the same element (an inherited member spelled through its heir counts). */
function sameElement(host: ToolkitHost, files: SourceFile[], a: string, b: string): boolean {
	const strip = (s: string) => s.replace(/'/g, '');
	if (strip(a) === strip(b)) return true;
	const { session } = host.session(files);
	if (!session) return false;
	const ea = session.resolve(a);
	const eb = session.resolve(b);
	try {
		if (!ea || !eb) return false;
		const ra = session.redefinitionRoot(ea);
		const rb = session.redefinitionRoot(eb);
		const same =
			session.elementId(ea) === session.elementId(eb) ||
			session.elementId(ra) === session.elementId(rb);
		ra.free();
		rb.free();
		return same;
	} finally {
		ea?.free();
		eb?.free();
	}
}

// ---- The run ----

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(2)} %` : 'n/a');

it('measures the toolkit and Tessera over the conformance corpora', async () => {
	const host = await loadHost();
	const projects = releaseProjects();
	expect(
		projects.length,
		`no corpus at ${paths.release}: run scripts/fetch-conformance.sh`
	).toBeGreaterThan(0);

	// 1. The release corpus.
	const perFile: Record<string, unknown>[] = [];
	const perProject: Record<string, unknown>[] = [];
	// The demo too, as one project, to compare with the pilot (`compare-pilot.mjs`).
	const demo: CorpusProject = { name: 'demo', suite: 'demo', files: demoFiles() };
	// CONFORMANCE_SKIP=release skips this part (to run the other corpora alone).
	const releaseRun = process.env.CONFORMANCE_SKIP === 'release' ? [] : [...projects, demo];
	for (const project of releaseRun) {
		for (const file of project === demo ? [] : project.files) {
			const r = engine(host, [file]);
			perFile.push({
				path: file.path,
				project: project.name,
				suite: project.suite,
				lines: file.text.split('\n').length,
				parsed: r.parseErrors.length === 0,
				parseErrors: r.parseErrors,
				findings: tally(r.findings),
				errors: r.findings.filter((f) => f.severity === 'error').map(brief),
				references: r.references,
				unresolvedCount: r.unresolvedCount,
				ms: r.ms
			});
		}
		const r = engine(host, project.files);
		const f = fairtide(host, project.files, r);
		perProject.push({
			project: project.name,
			suite: project.suite,
			files: project.files.length,
			paths: project.files.map((f) => f.path),
			lines: sum(project.files.map((x) => x.text.split('\n').length)),
			filesParsed: project.files.length - new Set(r.parseErrors.map((p) => p.unit)).size,
			parseErrors: r.parseErrors,
			findings: tally(r.findings),
			errors: r.findings.filter((x) => x.severity === 'error').map(brief),
			warnings: r.findings.filter((x) => x.severity === 'warning').map(brief),
			references: r.references,
			unresolvedCount: r.unresolvedCount,
			engineMs: r.ms,
			fairtide: f
		});
	}

	// Each suite as one project (training and validation import across folders).
	const perSuite = [...new Set(releaseRun.filter((p) => p !== demo).map((p) => p.suite))].map(
		(suite) => {
			const files = projects.filter((p) => p.suite === suite).flatMap((p) => p.files);
			const r = engine(host, files);
			return {
				suite,
				files: files.length,
				filesParsed: files.length - new Set(r.parseErrors.map((p) => p.unit)).size,
				findings: tally(r.findings),
				errors: r.findings.filter((x) => x.severity === 'error').map(brief),
				warnings: r.findings.filter((x) => x.severity === 'warning').map(brief),
				references: r.references,
				unresolvedCount: r.unresolvedCount,
				engineMs: r.ms
			};
		}
	);

	// 2. The pilot's Xpect suites.
	const cases = xpectCases();
	const xpects = cases.map((c) => xpect(host, c));

	// 3. The negative corpus.
	const negatives = negativeCases().map((n) => {
		const r = engine(host, [n.file]);
		const errors = r.parseErrors.length + r.findings.filter((f) => f.severity === 'error').length;
		const warnings = r.findings.filter((f) => f.severity === 'warning').length;
		return {
			path: n.path,
			category: n.category,
			rule: n.rule,
			pilotRejects: n.pilotRejects,
			rejected: errors > 0,
			flagged: errors + warnings > 0,
			parseErrors: r.parseErrors.length,
			findings: tally(r.findings),
			first:
				[...r.parseErrors.map((p) => p.message), ...r.findings.map((x) => x.message)][0] ?? null
		};
	});

	const results = {
		meta: {
			date: new Date().toISOString(),
			toolkit: host.tk.version(),
			library: 'OMG SysML v2 Release 2026-05 (de1070ae), as bundled by the toolkit',
			release: { path: paths.release, revision: revision(paths.release) },
			pilot: { path: paths.pilot, revision: revision(paths.pilot) },
			negative: { path: paths.negative, revision: revision(paths.negative) },
			node: process.version,
			memoryMiB: toolkitMemoryMiB(),
			referenceProperties: [...REFERENCE_PROPERTIES]
		},
		release: { perFile, perProject, perSuite },
		xpect: xpects,
		negative: negatives
	};
	mkdirSync(paths.out, { recursive: true });
	writeFileSync(join(paths.out, 'results.json'), JSON.stringify(results, null, 1));
	const summary = summarize(results.meta, perFile, perProject, perSuite, xpects, negatives);
	writeFileSync(join(paths.out, 'summary.md'), summary);
	console.log(summary);
});

const brief = (f: TkFinding) => ({
	unit: f.unit,
	line: f.line,
	stage: f.stage,
	message: f.message
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function summarize(
	meta: Any,
	perFile: Any[],
	perProject: Any[],
	perSuite: Any[],
	xpects: XpectResult[],
	negatives: Any[]
): string {
	const lines: string[] = [];
	const row = (...cells: (string | number)[]) => lines.push(`| ${cells.join(' | ')} |`);
	lines.push(`# Conformance run ${meta.date.slice(0, 10)}`, '');
	lines.push(
		`Toolkit ${meta.toolkit}; library ${meta.library}; corpus ${meta.release.revision ?? meta.release.path}; ` +
			`pilot suites ${meta.pilot.revision ?? 'absent'}; negatives ${meta.negative.revision ?? 'absent'}.`,
		''
	);
	lines.push('## Release corpus, engine (each folder as one project)', '');
	row(
		'Suite',
		'Files',
		'Parsed',
		'References',
		'Unresolved',
		'Resolved',
		'Errors',
		'Warnings',
		'Files with errors'
	);
	row('---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:');
	const suites = [...new Set(perProject.map((p) => p.suite))];
	for (const suite of [...suites, 'all']) {
		const ps = perProject.filter((p) => suite === 'all' || p.suite === suite);
		const refs = sum(ps.map((p) => p.references.total));
		const unres = sum(ps.map((p) => p.references.unresolved));
		row(
			suite,
			sum(ps.map((p) => p.files)),
			sum(ps.map((p) => p.filesParsed)),
			refs,
			unres,
			pct(refs - unres, refs),
			sum(ps.map((p) => p.errors.length)),
			sum(ps.map((p) => p.warnings.length)),
			new Set(ps.flatMap((p) => p.errors.map((e: Any) => e.unit))).size
		);
	}
	lines.push('', '## Release corpus, engine (each suite as one project)', '');
	row(
		'Suite',
		'Files',
		'Parsed',
		'References',
		'Unresolved',
		'Resolved',
		'Errors',
		'Warnings',
		'Files with errors'
	);
	row('---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:');
	for (const p of perSuite)
		row(
			p.suite,
			p.files,
			p.filesParsed,
			p.references.total,
			p.references.unresolved,
			pct(p.references.total - p.references.unresolved, p.references.total),
			p.errors.length,
			p.warnings.length,
			new Set(p.errors.map((e: Any) => e.unit)).size
		);
	lines.push('', '## Release corpus, engine (each file alone)', '');
	row('Suite', 'Files', 'Parsed', 'References', 'Unresolved', 'Resolved', 'Files with errors');
	row('---', '---:', '---:', '---:', '---:', '---:', '---:');
	for (const suite of [...suites, 'all']) {
		const fs = perFile.filter((p) => suite === 'all' || p.suite === suite);
		if (!fs.length) continue;
		const refs = sum(fs.map((p) => p.references.total));
		const unres = sum(fs.map((p) => p.references.unresolved));
		row(
			suite,
			fs.length,
			fs.filter((f) => f.parsed).length,
			refs,
			unres,
			pct(refs - unres, refs),
			fs.filter((f) => f.errors.length).length
		);
	}
	lines.push('', '## Release corpus, Tessera layer', '');
	const ft = perProject.map((p) => p.fairtide);
	const engineFindings = sum(ft.map((f) => f.diagnostics.matched + f.diagnostics.missing.length));
	lines.push(
		`- Diagnostics: ${sum(ft.map((f) => f.diagnostics.matched))} of ${engineFindings} engine findings shown on their line ` +
			`(${sum(ft.map((f) => f.diagnostics.missing.length))} missing, ${sum(ft.map((f) => f.diagnostics.extra.length))} extra); ` +
			`${sum(ft.map((f) => f.diagnostics.exactRange))} over exactly the engine's range.`,
		`- Model adapter: ${sum(ft.map((f) => f.adapter.located))} located elements of ${sum(ft.map((f) => f.adapter.walked))} walked; ` +
			`${sum(ft.map((f) => f.adapter.lost.length))} lost; ${sum(ft.map((f) => Object.values(f.adapter.unlocated as Record<string, number>).reduce((a, b) => a + b, 0)))} named elements have no place in the text; ` +
			`${sum(ft.map((f) => f.adapter.notInModel.length))} named records missing from the app's model.`,
		`- Diagrams: ${sum(ft.map((f) => f.diagrams.built))} built, ${sum(ft.map((f) => f.diagrams.errors.length))} failed.`,
		''
	);
	const shown: Record<string, { total: number; shown: number }> = {};
	for (const f of ft)
		for (const [m, t] of Object.entries(
			f.diagrams.shown as Record<string, { total: number; shown: number }>
		)) {
			const s = (shown[m] ??= { total: 0, shown: 0 });
			s.total += t.total;
			s.shown += t.shown;
		}
	row('Metaclass', 'Named elements', 'In a diagram', 'Share');
	row('---', '---:', '---:', '---:');
	for (const [m, t] of Object.entries(shown).sort((a, b) => b[1].total - a[1].total))
		row(m, t.total, t.shown, pct(t.shown, t.total));

	lines.push('', '## Pilot Xpect suites (as Tessera shows them)', '');
	row(
		'Suite',
		'Files',
		'`errors` items',
		'Error there',
		'Any problem there',
		'`noErrors` files',
		'Held',
		'`linkedName`',
		'Agreed'
	);
	row('---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:');
	const xsuites = [...new Set(xpects.map((x) => x.suite))].sort();
	for (const suite of [...xsuites, 'all']) {
		const xs = xpects.filter((x) => suite === 'all' || x.suite === suite);
		const declared = xs.filter((x) => x.noErrors.declared);
		row(
			suite,
			xs.length,
			sum(xs.map((x) => x.errors.expected)),
			sum(xs.map((x) => x.errors.found)),
			sum(xs.map((x) => x.errors.foundAny)),
			declared.length,
			declared.filter((x) => x.noErrors.errorsShown.length === 0).length,
			sum(xs.map((x) => x.linkedName.expected)),
			sum(xs.map((x) => x.linkedName.agreed))
		);
	}
	if (negatives.length) {
		lines.push('', '## Negative corpus (OpenSysML; every file must be rejected)', '');
		row(
			'Category',
			'Files',
			'Rejected (an error)',
			'Flagged (error or warning)',
			'Pilot rejects (recorded)'
		);
		row('---', '---:', '---:', '---:', '---:');
		for (const cat of [...new Set(negatives.map((n) => n.category)), 'all']) {
			const ns = negatives.filter((n) => cat === 'all' || n.category === cat);
			row(
				cat,
				ns.length,
				ns.filter((n) => n.rejected).length,
				ns.filter((n) => n.flagged).length,
				ns.filter((n) => n.pilotRejects).length
			);
		}
	}
	lines.push('');
	return lines.join('\n');
}
