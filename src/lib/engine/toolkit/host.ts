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
import type { SourceFile } from '../protocol';
import type {
	Analysis,
	CodeAction,
	Completion,
	DefinitionTarget,
	Diagnostic,
	EditRequest,
	EditResult,
	ElementDetails,
	FileChange,
	FileRange,
	Highlights,
	Hover,
	OutlineItem,
	StateMachine
} from '../types';
import type {
	TkFinding,
	TkLenient,
	TkLibrary,
	TkSession,
	TkSettledOutcomes,
	TkSource,
	Toolkit
} from './api';
import { toProblems } from './diagnostics';
import { ModelEditing } from './edits';
import { LanguageServices, SyntaxServices } from './language';
import { extractMachines } from './machines';
import { detailsOf, extractModel, findElement, type ExtractedModel, type UnitInfo } from './model';
import { TextIndexCache } from './offsets';
import { RepairMap } from './repair';

/** A session over `files`, with how its units map to them; not analysed yet. */
interface Prepared {
	files: SourceFile[];
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
	/** The state machines, read on first ask. */
	machines?: StateMachine[];
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
	/** Timings of the latest build, for the status line and measurements. */
	lastBuild = { ms: 0, lenient: false, findings: 0 };
	/** The editor's language services (the toolkit's language server), started on first use. */
	private readonly language: LanguageServices;
	readonly syntax: SyntaxServices;

	constructor(tk: Toolkit, library: TkLibrary, syntax = new SyntaxServices(tk)) {
		this.tk = tk;
		this.library = library;
		this.language = new LanguageServices(tk, library);
		this.syntax = syntax;
	}

	highlight(source: string): Highlights {
		return this.syntax.highlight(source);
	}

	format(source: string): { changes: { from: number; to: number; insert: string }[] } {
		return this.syntax.format(source);
	}

	complete(files: SourceFile[], path: string, offset: number): Completion {
		return this.language.complete(files, path, offset);
	}

	hover(files: SourceFile[], path: string, offset: number): Hover | null {
		return this.language.hover(files, path, offset);
	}

	definition(files: SourceFile[], path: string, offset: number): DefinitionTarget | null {
		return this.language.definition(files, path, offset);
	}

	references(files: SourceFile[], path: string, offset: number): FileRange[] {
		return this.language.references(files, path, offset);
	}

	renameSymbol(
		files: SourceFile[],
		path: string,
		offset: number,
		newName: string
	): { changes: FileChange[] } | { error: string } {
		return this.language.rename(files, path, offset, newName);
	}

	outline(files: SourceFile[], path: string): OutlineItem[] {
		return this.language.outline(files, path);
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
		return this.language.codeActions(files, path, from, to, problems);
	}

	version(): string {
		return `toolkit ${this.tk.version()}`;
	}

	analyzeProject(files: SourceFile[]): Analysis[] {
		return this.build(files).analyses;
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
			const single = this.build([{ path, text: source }]);
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
		const built = this.built && sameFiles(this.built.files, files) ? this.built : null;
		// An edit needs the session, not the analysis: an analysed build, or a session alone.
		const start: Prepared = built?.session
			? { files, session: built.session, units: built.units, parse: [], lenient: false }
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
				if (built && this.built === built) this.built = null;
				if (session !== start.session) start.session.free();
				const repaired = [...start.units.values()].some((u) => u.repair);
				if (editing.inSync && !repaired) {
					// The session holds the edited texts: their analysis starts from it.
					const changed = editing.changedTexts();
					const edited = files.map((f) => ({ path: f.path, text: changed.get(f.path) ?? f.text }));
					this.keepPending({
						files: edited,
						session,
						units: this.unitsOf(edited, edited),
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

	private build(files: SourceFile[]): Built {
		if (this.built && sameFiles(this.built.files, files)) return this.built;
		const started = performance.now();
		const previous = this.built;
		this.built = null;
		previous?.session?.free();
		const { session, units, parse, lenient } = this.prepare(files);
		const findings = session ? (JSON.parse(session.check()) as TkFinding[]) : [];

		// The session numbers its units; map them to the app's files.
		const byIndex = new Map<number, UnitInfo>();
		if (session) {
			for (const u of JSON.parse(session.units()) as { unit: number; name: string }[]) {
				const unit = units.get(u.name);
				if (unit) byIndex.set(u.unit, unit);
			}
		}
		const extracted = session ? extractModel(this.tk, session, byIndex) : null;
		const problems = toProblems(parse, findings, units);

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
			findings: findings.length
		};
		this.built = { files, session, units, analyses, extracted };
		return this.built;
	}

	/**
	 * A session for `files`: the pending one when it holds them, else a new
	 * one, over repaired texts where a file doesn't parse.
	 */
	private prepare(files: SourceFile[]): Prepared {
		if (this.pending && sameFiles(this.pending.files, files)) {
			const pending = this.pending;
			this.pending = null;
			this.settle(pending.session);
			return pending;
		}
		this.keepPending(null);
		const sources: TkSource[] = files.map((f) => ({ name: f.path, text: f.text }));
		const json = JSON.stringify(sources);

		// Units that don't parse are repaired first: a session can't be built over them.
		const parse = (JSON.parse(this.tk.checkSyntax(json)) as TkFinding[]).filter(
			(f) => f.stage === 'parse'
		);
		let repaired = sources;
		let lenient: TkLenient | null = null;
		if (parse.length) {
			lenient = JSON.parse(this.tk.lenientSources(json)) as TkLenient;
			const stillBroken = new Set(lenient.unrepaired.map((u) => u.unit));
			repaired = lenient.sources.filter((s) => !stillBroken.has(s.name));
		}
		const units = this.unitsOf(
			files,
			repaired.map((r) => ({ path: r.name, text: r.text })),
			lenient
		);
		const session = this.openSession(JSON.stringify(repaired));
		return { files, session, units, parse, lenient: !!lenient };
	}

	/** How each file maps to the text its session parsed (`repaired`, the same when it parses). */
	private unitsOf(
		files: SourceFile[],
		repaired: SourceFile[],
		lenient: TkLenient | null = null
	): Map<string, UnitInfo> {
		const units = new Map<string, UnitInfo>();
		for (const file of files) {
			const original = this.texts.get(file.path, file.text);
			const fixed = repaired.find((s) => s.path === file.path);
			const unit: UnitInfo = { path: file.path, original, repaired: original };
			if (fixed && fixed.text !== file.text) {
				unit.repaired = this.texts.get(`repaired:${file.path}`, fixed.text);
				unit.repair = RepairMap.build(
					file.text,
					fixed.text,
					lenient?.dropped.filter((d) => d.unit === file.path) ?? []
				);
			}
			units.set(file.path, unit);
		}
		this.texts.retain([...files.map((f) => f.path), ...files.map((f) => `repaired:${f.path}`)]);
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

const isModel = (path: string) => path.endsWith('.sysml') || path.endsWith('.kerml');

function sameFiles(a: SourceFile[], b: SourceFile[]): boolean {
	return a.length === b.length && a.every((f, i) => f.path === b[i]!.path && f.text === b[i]!.text);
}
