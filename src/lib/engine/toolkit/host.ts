/**
 * The toolkit engine's state and the `EngineApi` methods ported to it. Kept
 * free of worker globals so the same code runs in the worker
 * (`toolkit.worker.ts`) and in unit tests under Node.
 *
 * One session is kept for the latest project text: every ported call that
 * passes the project's files reuses it while the texts are unchanged, and a
 * rebuild starts from the previous build's settled outcomes (the toolkit's
 * incremental path).
 */
import { compareSnapshots } from '#lib/review/semantic.ts';
import { referencesOf, type ElementJson } from '#lib/exchange/elements.ts';
import type {
	InterchangeExport,
	InterchangeExportOptions,
	InterchangeImport,
	MergeInputs,
	WeaveResult
} from '#lib/exchange/types.ts';
import type { ModelComparison, ModelSnapshot } from '#lib/review/types.ts';
import type { SourceFile } from '../protocol';
import type {
	Analysis,
	CheckReport,
	CodeAction,
	Completion,
	ElementFeatures,
	FeatureValue,
	DefinitionTarget,
	Diagnostic,
	DiagramGraph,
	RelatedElement,
	DiagramView,
	EditRequest,
	EditResult,
	ElementDetails,
	Evaluated,
	FileChange,
	FileRange,
	Highlights,
	Hover,
	OutlineItem,
	RenderedTable,
	DependencyMatrix,
	RiskPolicy,
	FmeaLineInfo,
	StateMachine,
	TradeStudy,
	ViewInfo
} from '../types';
import type {
	TkDropped,
	TkFinding,
	TkLenient,
	TkLibrary,
	TkSession,
	TkSettledOutcomes,
	TkSource,
	Toolkit
} from './api';
import { filesWithoutBom, withBomOf, withoutBom } from './bom';
import { toProblems } from './diagnostics';
import { diffTexts, type TextChange } from './diff';
import { buildDiagram } from './diagrams';
import { DiagramContext } from './diagrams/context';
import { Relations } from './diagrams/related';
import { ModelEditing } from './edits';
import { Evaluation } from './evaluation';
import { LanguageServices, SyntaxServices } from './language';
import { extractMachines } from './machines';
import { detailsOf, extractModel, findElement, type ExtractedModel, type UnitInfo } from './model';
import { TextIndexCache } from './offsets';
import { RepairMap } from './repair';
import { canonicalModel, exportModel, importModel } from './interchange';
import { weaveModel } from './weave';
import { buildSnapshot } from './snapshot';
import * as views from './views';

/** A session over `files`, with how its units map to them; not analysed yet. */
interface Prepared {
	files: SourceFile[];
	/** The files and the view libraries the project lacks: what the session holds. */
	all: SourceFile[];
	session: TkSession;
	units: Map<string, UnitInfo>;
	/** Parse errors (the session holds the repaired texts of the files that have them). */
	parse: TkFinding[];
	lenient: boolean;
}

interface Built {
	files: SourceFile[];
	session: TkSession | null;
	units: Map<string, UnitInfo>;
	analyses: Analysis[];
	extracted: ExtractedModel | null;
	/** The tables' index of the model, made on the first view call. */
	views?: views.ViewContext;
	/** The state machines, read on first ask. */
	machines?: StateMachine[];
	/** Values and verdicts (`evaluation.ts`), on first ask. */
	evaluation?: Evaluation;
	/** The model as the semantic diff reads it (`snapshot.ts`), on first ask. */
	snapshot?: ModelSnapshot;
	/** Files with syntax errors. */
	broken?: string[];
	/** How elements are related, on first ask. */
	relations?: Relations;
}

export class ToolkitHost {
	readonly tk: Toolkit;
	readonly library: TkLibrary;
	private built: Built | null = null;
	/**
	 * A session for `files` not analysed yet: the one an edit left, holding the
	 * edited texts, or one opened for an edit. The next build or edit of those
	 * texts starts from it.
	 */
	private pending: Prepared | null = null;
	private settled: TkSettledOutcomes | undefined;
	private readonly texts = new TextIndexCache();
	/** Each file's latest text that parsed, as analysed (`fromLastParsed`), as the toolkit is given it. */
	private readonly lastParsed = new Map<string, string>();
	/** Snapshots of versions other than the analysed one (a base to compare with), newest first. */
	private apart: { files: SourceFile[]; snapshot: ModelSnapshot }[] = [];
	/** Timings of the latest version analysed apart, for measurements. */
	lastApart = { ms: 0 };
	/**
	 * Timings of the latest build, for the status line and measurements: the
	 * session (parse, resolve), the toolkit's `check`, the model adapter.
	 */
	lastBuild = { ms: 0, lenient: false, findings: 0, sessionMs: 0, checkMs: 0, adapterMs: 0 };
	/** The editor's language services (the toolkit's language server), started on first use. */
	private readonly language: LanguageServices;
	readonly syntax: SyntaxServices;

	/** The instance's WebAssembly memory in MiB (0 when unknown). */
	private readonly memoryMiB: () => number;
	/** The standard library's sources (JSON `[{name, text}]`), for exporting it. */
	private readonly librarySources: string | undefined;

	constructor(
		tk: Toolkit,
		library: TkLibrary,
		syntax = new SyntaxServices(tk),
		memoryMiB: () => number = () => 0,
		librarySources?: string
	) {
		this.tk = tk;
		this.library = library;
		this.librarySources = librarySources;
		this.language = new LanguageServices(tk, library);
		this.syntax = syntax;
		this.memoryMiB = memoryMiB;
	}

	highlight(source: string): Highlights {
		return this.syntax.highlight(withoutBom(source));
	}

	format(source: string): { changes: { from: number; to: number; insert: string }[] } {
		const given = withoutBom(source);
		const { changes } = this.syntax.format(given);
		if (given === source || !changes.length) return { changes };
		// The byte-order mark stays where it is.
		return { changes: diffTexts(source, withBomOf(source, applyChanges(given, changes))) };
	}

	// The language server is given byte-order marks as spaces (`bom.ts`): offsets are the same.

	complete(files: SourceFile[], path: string, offset: number): Completion {
		return this.language.complete(filesWithoutBom(files), path, offset);
	}

	hover(files: SourceFile[], path: string, offset: number): Hover | null {
		return this.language.hover(filesWithoutBom(files), path, offset);
	}

	definition(files: SourceFile[], path: string, offset: number): DefinitionTarget | null {
		return this.language.definition(filesWithoutBom(files), path, offset);
	}

	references(files: SourceFile[], path: string, offset: number): FileRange[] {
		return this.language.references(filesWithoutBom(files), path, offset);
	}

	renameSymbol(
		files: SourceFile[],
		path: string,
		offset: number,
		newName: string
	): { changes: FileChange[] } | { error: string } {
		return this.language.rename(filesWithoutBom(files), path, offset, newName);
	}

	outline(files: SourceFile[], path: string): OutlineItem[] {
		return this.language.outline(filesWithoutBom(files), path);
	}

	/** Quick fixes, for the problems the analysis found where the selection is. */
	codeActions(files: SourceFile[], path: string, from: number, to: number): CodeAction[] {
		// Fixes need the project's problems; analysing is cheap when the text is unchanged.
		const analysis = this.build(files.filter((f) => isModel(f.path))).analyses.find(
			(a) => a.model.file === path
		);
		const problems: Diagnostic[] = analysis
			? [
					...analysis.model.syntax_errors.map((e): Diagnostic => ({
						file: path,
						span: e.span,
						severity: 'error',
						code: 'syntax',
						message: e.message
					})),
					...analysis.diagnostics
				]
			: [];
		return this.language.codeActions(filesWithoutBom(files), path, from, to, problems);
	}

	version(): string {
		return `toolkit ${this.tk.version()}`;
	}

	analyzeProject(files: SourceFile[]): Analysis[] {
		const built = this.build(files);
		// The project's texts that parse, for repairing them while someone types (`fromLastParsed`).
		// Only from here: an edit's or a check's texts (with elements blanked out) are not the files.
		const paths = new Set(files.map((f) => f.path));
		for (const path of this.lastParsed.keys()) if (!paths.has(path)) this.lastParsed.delete(path);
		const broken = new Set(
			built.analyses.filter((a) => a.model.syntax_errors.length).map((a) => a.model.file)
		);
		for (const file of files)
			if (!broken.has(file.path)) this.lastParsed.set(file.path, withoutBom(file.text));
		return built.analyses;
	}

	/** One file on its own (names in other files don't resolve). */
	analyze(path: string, source: string): Analysis {
		// A separate host state would cost a second session; this one is cheap and thrown away.
		const previous = this.built;
		const settled = this.settled;
		const pending = this.pending;
		this.built = null;
		this.settled = undefined;
		this.pending = null;
		try {
			const single = this.build([{ path, text: source }], false);
			single.evaluation?.free();
			single.session?.free();
			return single.analyses[0]!;
		} finally {
			// The one-file build's outcomes are no start for the project's next build.
			const fresh = this.settled as TkSettledOutcomes | undefined;
			if (fresh !== settled) fresh?.free();
			this.built = previous;
			this.settled = settled;
			this.pending = pending;
		}
	}

	elementDetails(
		files: SourceFile[],
		path: string,
		line: number,
		element: string | null
	): ElementDetails {
		const { extracted } = this.build(files);
		const record = extracted ? findElement(extracted.elements, path, line, element) : undefined;
		if (!record) throw new Error(`element \`${element ?? `at line ${line}`}\` not found`);
		return detailsOf(record, (s) => s);
	}

	/**
	 * A model edit, computed on the toolkit (`edits.ts`) against the request's
	 * texts. The edited session is kept for the build of the edited texts.
	 */
	edit(request: EditRequest): EditResult {
		const files = (request.files ?? [{ path: request.path, text: request.source }]).map((f) =>
			f.path === request.path ? { path: f.path, text: request.source } : f
		);
		if (!files.some((f) => f.path === request.path))
			files.push({ path: request.path, text: request.source });
		// Changing what an element specializes or is typed by, or removing one, can make a
		// `:>> mass` elsewhere redefine another feature (the library's ISQ::mass) with no
		// reference broken: the toolkit doesn't count redefinitions as references.
		const before = rebindable(request) ? this.redefinitions(files) : null;
		const result = this.editOn(files, request);
		if (!before) return result;
		const rebound = reboundRedefinitions(
			before,
			this.redefinitions(editedFiles(files, request, result))
		);
		if (rebound) result.warning = [result.warning, rebound].filter(Boolean).join(' ');
		return result;
	}

	/** What each redefining feature of the project redefines, by qualified name. */
	private redefinitions(files: SourceFile[]): Map<string, string> {
		const extracted = this.build(files).extracted;
		const map = new Map<string, string>();
		for (const r of extracted?.elements ?? [])
			if (r.qualifiedName && r.redefinesQualified) map.set(r.qualifiedName, r.redefinesQualified);
		return map;
	}

	private editOn(files: SourceFile[], request: EditRequest): EditResult {
		const built = this.built && sameFiles(this.built.files, files) ? this.built : null;
		// An edit needs the session, not the analysis: an analysed build, or a session alone.
		const start: Prepared = built?.session
			? {
					files,
					all: [...built.units.values()].map((u) => ({ path: u.path, text: u.original.text })),
					session: built.session,
					units: built.units,
					parse: [],
					lenient: false
				}
			: this.prepare(files);
		const editing = new ModelEditing({
			tk: this.tk,
			session: start.session,
			units: start.units,
			reopen: (sources) => this.openSession(JSON.stringify(sources))
		});
		try {
			return editing.run(request);
		} finally {
			const session = editing.session;
			if (session === start.session && !editing.editedOriginal) {
				// Nothing changed the session: keep it for these texts.
				if (!built) this.keepPending(start);
			} else {
				if (built && this.built === built) {
					built.evaluation?.free();
					this.built = null;
				}
				if (session !== start.session) start.session.free();
				const repaired = [...start.units.values()].some((u) => u.repair);
				if (editing.inSync && !repaired) {
					// The session holds the edited texts: their analysis starts from it.
					const changed = editing.changedTexts();
					const edit = (f: SourceFile) => ({ path: f.path, text: changed.get(f.path) ?? f.text });
					const all = start.all.map(edit);
					this.keepPending({
						files: files.map(edit),
						all,
						session,
						units: this.unitsOf(all, all),
						parse: [],
						lenient: false
					});
				} else session.free();
			}
		}
	}

	private keepPending(next: Prepared | null) {
		if (this.pending && this.pending.session !== next?.session) this.pending.session.free();
		this.pending = next;
	}

	/** The project's views and the bundled libraries' (phase 3). */
	listViews(files: SourceFile[]): ViewInfo[] {
		return views.listViews(this.viewContext(files));
	}

	/** A view rendered as a table by its `@TableRendering`. */
	renderView(files: SourceFile[], name: string): RenderedTable {
		return views.renderView(this.viewContext(files), name);
	}

	/** A view as a dependency matrix (`views/dsm.ts`), made once per analysis. */
	dependencyMatrix(files: SourceFile[], name: string): DependencyMatrix {
		return views.dependencyMatrix(this.viewContext(files), name);
	}

	/** The project's risk policy, as its risk library states it (`views/riskLines.ts`). */
	riskPolicy(files: SourceFile[]): RiskPolicy {
		return views.riskPolicy(this.viewContext(files));
	}

	/** The FMEA lines about an element (by its id), for its details. */
	fmeaLines(files: SourceFile[], id: string): FmeaLineInfo[] {
		return views.fmeaLines(this.viewContext(files), id);
	}

	/** A usage's attribute values, for the inspector. */
	featureValues(files: SourceFile[], id: string): FeatureValue[] {
		return views.featureValues(this.viewContext(files), id);
	}

	/** What the guided forms read about elements: their kinds, references and features (`views/features.ts`). */
	elementFeatures(files: SourceFile[], ids: string[]): Record<string, ElementFeatures> {
		return views.elementFeatures(this.viewContext(files), ids);
	}

	/** The view libraries every project has (`Reporting`, `ModelViews`). */
	viewLibraries(): SourceFile[] {
		return views.viewLibraries();
	}

	private viewContext(files: SourceFile[]): views.ViewContext {
		return this.viewContextOf(this.build(files), files);
	}

	private viewContextOf(built: Built, files: SourceFile[]): views.ViewContext {
		built.views ??= new views.ViewContext({
			session: built.session,
			extracted: built.extracted,
			content: new Set(files.map((f) => f.path)),
			texts: new Map([...built.units.values()].map((u) => [u.path, u.original.text])),
			evaluation: () => this.evaluationOf(built)
		});
		return built.views;
	}

	/**
	 * Every constraint and `satisfy` claim of the project, decided by the
	 * toolkit's `verify` (`evaluation.ts`); cached per analysis.
	 */
	checks(files: SourceFile[]): CheckReport {
		const evaluation = this.evaluationOf(this.build(files));
		if (!evaluation)
			return { checks: [], summary: { satisfied: 0, violated: 0, undecided: 0 }, ms: 0 };
		const report = evaluation.checks();
		// A large model's second session costs hundreds of MB: free it until values are asked for.
		if (this.memoryMiB() > RELEASE_EVALUATION_AT_MIB) evaluation.release();
		return report;
	}

	/** Elements' bound values, evaluated, by element id; cached per analysis. */
	evaluate(files: SourceFile[], ids: string[]): Record<string, Evaluated> {
		return this.evaluationOf(this.build(files))?.evaluate(ids) ?? {};
	}

	/** The project's trade studies, evaluated (`trade.ts`); cached per analysis. */
	tradeStudies(files: SourceFile[]): TradeStudy[] {
		return this.viewContext(files).tradeStudies();
	}

	private evaluationOf(built: Built): Evaluation | null {
		if (!built.session || !built.extracted) return null;
		built.evaluation ??= new Evaluation({
			tk: this.tk,
			library: this.library,
			session: built.session,
			units: built.units,
			extracted: built.extracted,
			more: () => views.annotationChecks(this.viewContextOf(built, built.files))
		});
		return built.evaluation;
	}

	/**
	 * What changed from one version of the project to another, at model
	 * level (`#lib/review/semantic.ts`). The current version is usually the
	 * analysed one; another version (the base) is analysed in a session of
	 * its own, which is freed once its snapshot is taken (the snapshot is
	 * kept for the next comparison with the same base).
	 */
	compareModels(base: SourceFile[], current: SourceFile[]): ModelComparison {
		const started = performance.now();
		const before = this.snapshotApart(base);
		const baseMs = performance.now() - started;
		const now =
			this.built && sameFiles(this.built.files, current)
				? this.snapshotOf(this.built)
				: this.snapshotApart(current);
		const currentMs = performance.now() - started - baseMs;
		const diff = compareSnapshots(before.snapshot, now.snapshot);
		return {
			diff,
			ms: {
				base: before.cached ? 0 : Math.round(baseMs),
				current: now.cached ? 0 : Math.round(currentMs),
				diff: Math.round(performance.now() - started - baseMs - currentMs)
			}
		};
	}

	/**
	 * The project as SysML v2 JSON (`interchange.ts`), from the analysed
	 * session: its ids are the ones the semantic diff compares by.
	 */
	exportInterchange(
		files: SourceFile[],
		options: InterchangeExportOptions = {}
	): InterchangeExport {
		const built = this.build(files);
		if (!built.session)
			throw new Error('The model could not be read, so there is nothing to export.');
		return exportModel(this.tk, built.session, {
			...options,
			files: files.map((f) => f.path),
			broken: built.analyses.filter((a) => a.model.syntax_errors.length).map((a) => a.model.file),
			librarySources: this.librarySources,
			prepared: options.library ? this.library : undefined
		});
	}

	/** SysML v2 JSON as project files, with what didn't carry over (`interchange.ts`). */
	importInterchange(json: string): InterchangeImport {
		return importModel(this.tk, this.library, json);
	}

	/**
	 * What a merge with a server's versions works from (`#lib/exchange/merge.ts`):
	 * the project exported, the base and the head in the same form, and the
	 * names of what they refer to outside themselves (the standard library).
	 */
	mergeInputs(files: SourceFile[], base: ElementJson[], theirs: ElementJson[]): MergeInputs {
		const exported = this.exportInterchange(files, {});
		const ours = JSON.parse(exported.json) as ElementJson[];
		const canonicalBase = canonicalModel(this.tk, base);
		const canonicalTheirs = canonicalModel(this.tk, theirs);
		const known = new Set([...ours, ...canonicalBase, ...canonicalTheirs].map((e) => e['@id']));
		const names: Record<string, string> = {};
		const session = this.build(files).session;
		for (const e of [...canonicalBase, ...canonicalTheirs, ...ours])
			for (const { id } of referencesOf(e)) {
				if (known.has(id) || id in names || !session) continue;
				const h = session.elementById(id);
				names[id] = (h && session.qualifiedName(h)) || '';
				h?.free();
			}
		return {
			ours,
			base: canonicalBase,
			theirs: canonicalTheirs,
			names,
			broken: exported.broken
		};
	}

	/** The project's files changed to hold a merged model (`weave.ts`). */
	weaveInterchange(files: SourceFile[], merged: ElementJson[]): WeaveResult {
		const ours = JSON.parse(this.exportInterchange(files, {}).json) as ElementJson[];
		const session = this.build(files).session;
		if (!session) throw new Error('The model could not be read, so nothing can be merged into it.');
		const rename = (path: string, offset: number, name: string) => {
			const result = this.language.rename(filesWithoutBom(files), path, offset, name);
			return 'changes' in result ? result.changes : null;
		};
		return weaveModel(this.tk, this.library, session, files, ours, merged, rename);
	}

	/** The snapshot of an analysed build, made on first ask. */
	private snapshotOf(built: Built): { snapshot: ModelSnapshot; cached: boolean } {
		if (built.snapshot) return { snapshot: built.snapshot, cached: true };
		built.snapshot = this.takeSnapshot(built);
		return { snapshot: built.snapshot, cached: false };
	}

	private takeSnapshot(built: Built): ModelSnapshot {
		const empty: ModelSnapshot = {
			elements: [],
			relations: [],
			checks: [],
			budgets: [],
			values: {},
			brokenFiles: built.broken ?? []
		};
		if (!built.extracted) return empty;
		return buildSnapshot({
			extracted: built.extracted,
			units: built.units,
			content: new Set(built.files.map((f) => f.path)),
			evaluation: this.evaluationOf(built),
			views: this.viewContextOf(built, built.files),
			broken:
				built.broken ??
				built.analyses.filter((a) => a.model.syntax_errors.length).map((a) => a.model.file)
		});
	}

	/**
	 * A snapshot of a version that is not the analysed one, from a session
	 * of its own (the prepared library is shared); cached for the two latest.
	 */
	private snapshotApart(files: SourceFile[]): { snapshot: ModelSnapshot; cached: boolean } {
		const known = this.apart.find((a) => sameFiles(a.files, files));
		if (known) return { snapshot: known.snapshot, cached: true };
		if (this.built && sameFiles(this.built.files, files)) return this.snapshotOf(this.built);
		const started = performance.now();
		const all = [...files, ...views.missingViewLibraries(files)];
		// Its own text indexes: the analysed project's stay cached.
		const { repaired, units, parse } = this.repair(all, new TextIndexCache(), false);
		const json = JSON.stringify(repaired);
		// Settled outcomes of the analysed project are a head start (most of the text is the same).
		let session: TkSession | null = null;
		if (this.settled)
			try {
				session = this.tk.Session.fromSourcesSettled(json, this.library, this.settled);
			} catch {
				session = null;
			}
		session ??= this.tk.Session.fromSourcesWithPreparedLibrary(json, this.library);
		const built: Built = { files, session, units, analyses: [], extracted: null };
		try {
			// No `check()`: the model reads the same without it, in half the time.
			const byIndex = new Map<number, UnitInfo>();
			for (const u of JSON.parse(session.units()) as { unit: number; name: string }[]) {
				const unit = units.get(u.name);
				if (unit) byIndex.set(u.unit, unit);
			}
			built.extracted = extractModel(this.tk, session, byIndex);
			built.broken = [...new Set(parse.map((f) => f.unit ?? ''))].filter((p) =>
				files.some((f) => f.path === p)
			);
			const snapshot = this.takeSnapshot(built);
			this.apart = [{ files, snapshot }, ...this.apart].slice(0, 2);
			this.lastApart = { ms: Math.round(performance.now() - started) };
			return { snapshot, cached: false };
		} finally {
			built.evaluation?.free();
			session.free();
		}
	}

	/** A standard view of the project as a diagram graph (`diagrams/`). */
	diagram(
		view: DiagramView,
		files: SourceFile[],
		scope: string | null,
		added: string[] = []
	): DiagramGraph {
		const built = this.build(files);
		if (!built.session || !built.extracted) {
			return { title: '', nodes: [], edges: [], subgraphs: [], direction: 'top_bottom' };
		}
		return buildDiagram(
			{ tk: this.tk, session: built.session, model: built.extracted, units: built.units },
			view,
			scope,
			added
		);
	}

	/** What an element is related to, both ways (`diagrams/related.ts`); indexed once per analysis. */
	related(files: SourceFile[], id: string): RelatedElement[] {
		const built = this.build(files);
		if (!built.session || !built.extracted) return [];
		built.relations ??= new Relations(
			new DiagramContext({
				tk: this.tk,
				session: built.session,
				model: built.extracted,
				units: built.units
			})
		);
		return built.relations.of(id);
	}

	/** The project's state machines (`machines.ts`), for the emulator. */
	stateMachines(files: SourceFile[]): StateMachine[] {
		const built = this.build(files);
		built.machines ??=
			built.session && built.extracted
				? extractMachines(built.session, built.extracted, built.units)
				: [];
		return built.machines;
	}

	/** The current session, built for `files` (for language services). */
	session(files: SourceFile[]): { session: TkSession | null; units: Map<string, UnitInfo> } {
		const built = this.build(files);
		return { session: built.session, units: built.units };
	}

	private build(files: SourceFile[], withViewLibraries = true): Built {
		if (this.built && sameFiles(this.built.files, files)) return this.built;
		const started = performance.now();
		const previous = this.built;
		this.built = null;
		previous?.evaluation?.free();
		previous?.session?.free();
		if (withViewLibraries) this.language.textsChanged(filesWithoutBom(files));
		const { session, units, parse, lenient } = this.prepare(files, withViewLibraries);
		const prepared = performance.now();
		const findings = session ? (JSON.parse(session.check()) as TkFinding[]) : [];
		const checked = performance.now();

		// The session numbers its units; map them to the app's files.
		const byIndex = new Map<number, UnitInfo>();
		if (session) {
			for (const u of JSON.parse(session.units()) as { unit: number; name: string }[]) {
				const unit = units.get(u.name);
				if (unit) byIndex.set(u.unit, unit);
			}
		}
		const extracted = session ? extractModel(this.tk, session, byIndex) : null;
		const adapted = performance.now();
		const problems = toProblems(parse, findings, units, (id) => {
			// An element a message names by its id: by its qualified name, or as it is referred to.
			const element = session?.elementById(id);
			if (!element) return null;
			try {
				return session!.qualifiedName(element) ?? session!.referenceSpelling(element) ?? null;
			} finally {
				element.free();
			}
		});

		const analyses = files.map((file): Analysis => {
			const model = extracted?.models.get(file.path) ?? {
				file: file.path,
				definitions: [],
				usages: [],
				satisfactions: [],
				verifications: [],
				connections: [],
				views: [],
				annotations: [],
				syntax_errors: []
			};
			model.syntax_errors = problems.syntaxErrors.get(file.path) ?? [];
			const diagnostics: Diagnostic[] = problems.diagnostics.get(file.path) ?? [];
			return { model, diagnostics };
		});
		this.lastBuild = {
			ms: Math.round(performance.now() - started),
			lenient: !!lenient,
			findings: findings.length,
			sessionMs: Math.round(prepared - started),
			checkMs: Math.round(checked - prepared),
			adapterMs: Math.round(adapted - checked)
		};
		this.built = { files, session, units, analyses, extracted };
		return this.built;
	}

	/**
	 * A session for `files`: the pending one when it holds them, else a new
	 * one, over repaired texts where a file doesn't parse.
	 */
	private prepare(files: SourceFile[], withViewLibraries = true): Prepared {
		// The view libraries a project lacks are resolution context, like the standard library.
		const all = withViewLibraries ? [...files, ...views.missingViewLibraries(files)] : files;
		if (this.pending && sameFiles(this.pending.all, all)) {
			const pending = this.pending;
			this.pending = null;
			this.settle(pending.session);
			return { ...pending, files };
		}
		this.keepPending(null);
		const { repaired, units, parse, lenient } = this.repair(all);
		const session = this.openSession(JSON.stringify(repaired));
		return { files, all, session, units, parse, lenient };
	}

	/**
	 * Units that don't parse are repaired first: a session can't be built over
	 * them. For the project being edited (`current`), a unit is repaired from
	 * its latest text that parsed where it can be (`fromLastParsed`), else by
	 * the toolkit (`lenientSources`).
	 */
	private repair(
		all: SourceFile[],
		texts = this.texts,
		current = true
	): {
		repaired: TkSource[];
		units: Map<string, UnitInfo>;
		parse: TkFinding[];
		lenient: boolean;
	} {
		const sources: TkSource[] = all.map((f) => ({ name: f.path, text: withoutBom(f.text) }));
		const json = JSON.stringify(sources);
		const parse = (JSON.parse(this.tk.checkSyntax(json)) as TkFinding[]).filter(
			(f) => f.stage === 'parse'
		);
		let repaired = sources;
		let lenient: TkLenient | null = null;
		const broken = new Set(parse.map((f) => f.unit));
		if (parse.length) {
			lenient = JSON.parse(this.tk.lenientSources(json)) as TkLenient;
			if (current)
				for (const source of sources) {
					if (!broken.has(source.name)) continue;
					const better = this.fromLastParsed(source.name, source.text);
					if (!better) continue;
					const at = lenient.sources.findIndex((s) => s.name === source.name);
					const fixed = { name: source.name, text: better.text };
					if (at >= 0) lenient.sources[at] = fixed;
					else lenient.sources.push(fixed);
					lenient.dropped = [
						...lenient.dropped.filter((d) => d.unit !== source.name),
						...better.dropped
					];
					lenient.unrepaired = lenient.unrepaired.filter((u) => u.unit !== source.name);
				}
			const stillBroken = new Set(lenient.unrepaired.map((u) => u.unit));
			repaired = lenient.sources.filter((s) => !stillBroken.has(s.name));
		}
		const units = this.unitsOf(
			all,
			repaired.map((r) => ({ path: r.name, text: r.text })),
			lenient,
			texts
		);
		return { repaired, units, parse, lenient: !!lenient };
	}

	/**
	 * A unit that doesn't parse, repaired from its latest text that parsed:
	 * the changes since then are undone, the fewest that make it parse (one
	 * of them, else all). Typing an unclosed `{` then keeps the file's model
	 * as it was (the toolkit's repair cuts out the element the brace is in),
	 * and no finding comes from a half-repaired text. Null when there is no
	 * such text, or when it differs too much from this one to stand in for
	 * it (another file of the same name, or most of it rewritten).
	 */
	private fromLastParsed(
		path: string,
		text: string
	): { text: string; dropped: TkDropped[] } | null {
		const last = this.lastParsed.get(path);
		if (last === undefined || last === text) return null;
		const changes = diffTexts(text, last);
		if (!changes.length) return null;
		const parses = (candidate: string) =>
			!(
				JSON.parse(
					this.tk.checkSyntax(JSON.stringify([{ name: path, text: candidate }]))
				) as TkFinding[]
			).some((f) => f.stage === 'parse');
		let undone: TextChange[] = changes;
		if (changes.length > 1)
			for (const change of changes)
				if (parses(applyChanges(text, [change]))) {
					undone = [change];
					break;
				}
		const kept = text.length - undone.reduce((n, c) => n + c.to - c.from, 0);
		const taken = undone.reduce((n, c) => n + c.insert.length, 0);
		if (taken > LAST_PARSED_MAX_TAKEN || kept < text.length / 2) return null;
		const repaired = applyChanges(text, undone);
		const index = this.texts.get(path, text);
		const dropped = undone.map((c) => {
			const start = index.utf16ToByte(c.from);
			const end = index.utf16ToByte(c.to);
			return { unit: path, start, end, text: text.slice(c.from, c.to), inserted: c.insert };
		}) as TkDropped[];
		return { text: repaired, dropped };
	}

	/** How each file maps to the text its session parsed (`repaired`, the same when it parses). */
	private unitsOf(
		files: SourceFile[],
		repaired: SourceFile[],
		lenient: TkLenient | null = null,
		texts = this.texts
	): Map<string, UnitInfo> {
		const units = new Map<string, UnitInfo>();
		for (const file of files) {
			const original = texts.get(file.path, file.text);
			const fixed = repaired.find((s) => s.path === file.path);
			const unit: UnitInfo = { path: file.path, original, repaired: original };
			// What the toolkit was given: a byte-order mark as a space (`bom.ts`).
			const given = withoutBom(file.text);
			if (given !== file.text) unit.bom = true;
			if (fixed && fixed.text !== file.text) {
				unit.repaired = texts.get(`repaired:${file.path}`, fixed.text);
				if (fixed.text !== given)
					unit.repair = RepairMap.build(
						given,
						fixed.text,
						lenient?.dropped.filter((d) => d.unit === file.path) ?? []
					);
			}
			units.set(file.path, unit);
		}
		texts.retain([...files.map((f) => f.path), ...files.map((f) => `repaired:${f.path}`)]);
		return units;
	}

	/** A session over sources that parse, from the previous build's outcomes when there are any. */
	private openSession(sourcesJson: string): TkSession {
		const { Session } = this.tk;
		let session: TkSession | null = null;
		if (this.settled) {
			try {
				session = Session.fromSourcesSettled(sourcesJson, this.library, this.settled);
			} catch {
				session = null;
			}
		}
		session ??= Session.fromSourcesWithPreparedLibrary(sourcesJson, this.library);
		return this.settle(session);
	}

	/** Keep a session's settled outcomes for the next build to start from. */
	private settle(session: TkSession): TkSession {
		const next = session.settledOutcomes();
		if (next) {
			this.settled?.free();
			this.settled = next;
		}
		return session;
	}
}

/**
 * WebAssembly memory (MiB) from which the evaluation session is freed after
 * the checks. The toolkit's instance can't grow past 2 GiB; a model of 50k
 * lines passes 1 GiB (the demo takes about 300 MiB).
 */
const RELEASE_EVALUATION_AT_MIB = 1024;

const isModel = (path: string) => path.endsWith('.sysml') || path.endsWith('.kerml');

function sameFiles(a: SourceFile[], b: SourceFile[]): boolean {
	return a.length === b.length && a.every((f, i) => f.path === b[i]!.path && f.text === b[i]!.text);
}

/** Edits that can change what an untouched redefinition redefines (`edit`). */
function rebindable(request: EditRequest): boolean {
	if (request.op === 'remove') return true;
	if (request.op !== 'setDeclaration') return false;
	const set = request.set;
	return 'specializes' in set || 'type' in set || 'conjugated' in set || 'redefines' in set;
}

/** The project's texts after an edit's changes. */
function editedFiles(files: SourceFile[], request: EditRequest, result: EditResult): SourceFile[] {
	const byPath = new Map<string, { from: number; to: number; insert: string }[]>();
	byPath.set(request.path, [...result.changes]);
	for (const { path, ...change } of result.otherFiles ?? [])
		byPath.set(path, [...(byPath.get(path) ?? []), change]);
	return files.map((f) => {
		const changes = byPath.get(f.path);
		if (!changes?.length) return f;
		let text = f.text;
		for (const c of [...changes].sort((a, b) => b.from - a.from))
			text = text.slice(0, c.from) + c.insert + text.slice(c.to);
		return { path: f.path, text };
	});
}

/** "Engine::mass now redefines ISQ::mass instead of Base::mass." — or null when none moved. */
function reboundRedefinitions(before: Map<string, string>, after: Map<string, string>) {
	const moved = [...after]
		.filter(([feature, target]) => before.has(feature) && before.get(feature) !== target)
		.map(
			([feature, target]) => `${feature} now redefines ${target} instead of ${before.get(feature)}`
		);
	if (!moved.length) return null;
	const shown = moved.slice(0, 3).join('; ');
	return `${shown}${moved.length > 3 ? `; and ${moved.length - 3} more` : ''}.`;
}

/** Text taken back from a file's latest text that parsed, at most (`fromLastParsed`). */
const LAST_PARSED_MAX_TAKEN = 4000;

/** Non-overlapping changes (UTF-16 offsets) applied to a text. */
function applyChanges(text: string, changes: TextChange[]): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from))
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}
