/**
 * The open project: its files (editable), the engine's analysis of each, and
 * the views derived from them.
 *
 * Text is the source of truth. Every change — typed in an editor or made on
 * a diagram — updates a file's text; the file is then re-analysed. Changes
 * computed by the engine are routed through the file's open editor when
 * there is one, so they join its undo history.
 */
import { SvelteSet } from 'svelte/reactivity';
import type { Engine } from '#lib/engine/client.ts';
import type {
	Analysis,
	CheckReport,
	Diagnostic,
	EditRequest,
	EditResult,
	StateMachine,
	ViewInfo
} from '#lib/engine/types.ts';
import { checkProblems } from './checks';
import { conventionProblems, conventionsOf } from './conventions';
import { coverageFigures } from './coverage';
import { derivationCycleProblems, derivationLinks, projectDerivations } from './derivations';
import { requirementIdProblems } from './requirementIds';
import { satisfyProblems, subjectFirstProblems } from './requirementChecks';
import { revertChanges } from './revert';
import {
	buildTree,
	byteToUtf16,
	collectElements,
	type ModelElement,
	type TreeNode
} from './elements';
import { collectRequirements, type RequirementRow } from './requirements';
import type { ProjectRevision } from './revision.svelte';
import { collectResults, type RecordedResult } from './verification';

export interface ProjectFile {
	/** Path relative to the project root, forward slashes. */
	path: string;
	text: string;
}

/** `.project.json` (KerML 10.3 InterchangeProject); only what the UI shows. */
export interface ProjectInfo {
	name: string;
	description?: string;
	version?: string;
}

export interface ProjectSource {
	id: string;
	info: ProjectInfo;
	files: ProjectFile[];
}

export type LoadState =
	| { phase: 'idle' }
	| { phase: 'loading'; done: number; total: number }
	| { phase: 'ready'; millis: number }
	| { phase: 'error'; message: string };

/** Coverage by the one rule (`coverage.ts`): satisfied, verified and passed, directly or through derived requirements. */
export interface Coverage {
	total: number;
	satisfied: number;
	verified: number;
	passed: number;
}

export type Change = EditResult['changes'][number];

/** An open editor that can apply engine changes to its document. */
export interface EditorHandle {
	apply(changes: Change[]): void;
}

/** Files the engine analyses. */
export function isModelFile(path: string): boolean {
	return path.endsWith('.sysml') || path.endsWith('.kerml');
}

/** Folders whose packages are libraries rather than the user's model. */
export function isLibraryFile(path: string): boolean {
	return path.startsWith('libraries/');
}

const ANALYSIS_DELAY_MS = 250;
/**
 * A model whose analysis takes longer than this (a large one: 10k lines and
 * more on a laptop; not the demo on a phone) waits for a longer pause in
 * typing before it is analysed, and before its checks run: the engine does
 * one thing at a time, so completion asked for while typing would otherwise
 * wait for an analysis to finish.
 */
const SLOW_ANALYSIS_MS = 2000;
const SLOW_DELAY_MS = 1000;
const UNDO_LIMIT = 50;

/**
 * A file a model edit changed: where it was and where it is after the edit
 * (null: the edit created it, or removed it), with its text before and
 * after. Undo takes back only what changed between the two, so later
 * typing stays.
 */
interface FileEdit {
	from: string | null;
	to: string | null;
	before: string;
	after: string;
}

interface UndoEntry {
	/** Which edit it is, for a toast to undo its own one (`undoEdit`). */
	id: number;
	label: string;
	files: FileEdit[];
}

/** What undoing an edit did: its label, or why it couldn't be undone (nothing changed then). */
export type UndoOutcome = { undone: string } | { refused: string };

/** A file went to another path (`to`), or out of the project (`to` null). */
export type FileMoveListener = (from: string, to: string | null) => void;

export class Workspace {
	info = $state.raw<ProjectInfo | null>(null);
	/** File texts by path. */
	files = $state.raw<Record<string, string>>({});
	analyses = $state.raw<Record<string, Analysis>>({});
	/** The texts `analyses` were made from, to tell when they describe the files as they are. */
	analysedTexts = $state.raw<Record<string, string>>({});
	state = $state.raw<LoadState>({ phase: 'idle' });
	/** The project's views (and the standard ones the engine bundles). */
	views = $state.raw<ViewInfo[]>([]);
	/** The project's state machines, for the emulator. */
	machines = $state.raw<StateMachine[]>([]);
	/** Constraint checks of the latest analysis (after it: they take a moment longer). */
	checks = $state.raw<CheckReport | null>(null);
	/** What breaks the project's conventions (views marked `@Convention`), found with the checks. */
	conventions = $state.raw<Diagnostic[]>([]);
	/** Paths edited since the project was opened. */
	readonly dirty = new SvelteSet<string>();
	/** Model edits made through `transact`, newest last. */
	undoStack = $state.raw<UndoEntry[]>([]);

	paths: string[] = $derived(Object.keys(this.files).sort());
	modelPaths: string[] = $derived(this.paths.filter(isModelFile));

	elements: ModelElement[] = $derived(collectElements(Object.values(this.analyses)));
	tree: TreeNode[] = $derived(buildTree(this.elements));

	requirements: RequirementRow[] = $derived(
		collectRequirements(Object.values(this.analyses), this.analysedTexts)
	);

	/** Each verification case's recorded result, by its element id (and name). */
	results: Map<string, RecordedResult> = $derived(collectResults(Object.values(this.analyses)));

	/**
	 * The project's version, as recorded verification results are compared
	 * with it (set by the project's session; null for a workspace without one).
	 */
	revision: ProjectRevision | null = null;

	coverage: Coverage = $derived(coverageFigures(this.requirements, this.revision));

	/** Why the latest analysis failed (the engine stopped, or refused the model). */
	engineError = $state<string | null>(null);

	/** Syntax errors and checks, errors first. */
	problems: Diagnostic[] = $derived(
		[
			...(this.engineError ? [engineProblem(this.engineError)] : []),
			...Object.values(this.analyses).flatMap((a) => [
				...a.model.syntax_errors.map((e): Diagnostic => ({
					file: a.model.file,
					span: e.span,
					severity: 'error',
					code: 'syntax',
					message: e.message
				})),
				...a.diagnostics
			]),
			// Requirements sharing an ID, or (as notes) without one.
			...requirementIdProblems(Object.values(this.analyses)),
			// A satisfy whose part has the name of the requirement's subject.
			...satisfyProblems(Object.values(this.analyses), (path) => this.files[path]),
			// A stakeholder or actor declared before the requirement's subject.
			...subjectFirstProblems(Object.values(this.analyses)),
			// Requirements derived, through others, from themselves.
			...derivationCycleProblems(
				derivationLinks(this.requirements, projectDerivations(this.analysedTexts)),
				(path) => this.analysedTexts[path]
			),
			// A requirement the design doesn't meet; undecided checks are not problems.
			...checkProblems(this.checks?.checks ?? []),
			// Rows of the views marked as conventions.
			...this.conventions
		].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
	);

	private engine: Engine | null = null;
	// Bookkeeping, deliberately not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private editors = new Map<string, EditorHandle>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;

	/**
	 * Show a project's name, description and files before the engine reads
	 * it, so the first paint is already the project (no layout shift when
	 * analysis starts). `open` follows with the same or newer files.
	 */
	preview(source: ProjectSource) {
		if (this.state.phase !== 'idle') return;
		this.info = source.info;
		this.files = Object.fromEntries(source.files.map((f) => [f.path, f.text]));
	}

	async open(source: ProjectSource, engine: Engine) {
		const generation = ++this.generation;
		this.engine = engine;
		this.info = source.info;
		this.files = Object.fromEntries(source.files.map((f) => [f.path, f.text]));
		this.analyses = {};
		this.checks = null;
		this.dirty.clear();
		this.state = { phase: 'loading', done: 0, total: this.modelPaths.length };
		const started = performance.now();
		try {
			// Waits for the engine to have started.
			await engine.version();
			await this.analyse(true);
			if (generation !== this.generation) return;
			this.state = { phase: 'ready', millis: performance.now() - started };
		} catch (error) {
			this.failed(error);
		}
	}

	/** The analysis the engine is working on, and whether the text changed since it started. */
	private inFlight: Promise<void> | null = null;
	private queued = false;

	/**
	 * Analyse every model file together, so references resolve across files.
	 * One analysis at a time: text that changes meanwhile is analysed once
	 * this one is done (on a large model an analysis takes seconds, and the
	 * engine would otherwise queue one per pause in typing).
	 */
	private async analyse(throwing = false): Promise<void> {
		if (this.inFlight) {
			if (!throwing) {
				this.queued = true;
				return;
			}
			await this.inFlight.catch(() => undefined);
			return this.analyse(throwing);
		}
		const run = this.analyseNow(throwing);
		this.inFlight = run;
		try {
			await run;
		} finally {
			this.inFlight = null;
			if (this.queued) {
				this.queued = false;
				void this.analyse();
			}
		}
	}

	/** How long the latest analysis took (ms). */
	private analysisMs = 0;

	private analysisDelay(): number {
		return this.analysisMs > SLOW_ANALYSIS_MS ? SLOW_DELAY_MS : ANALYSIS_DELAY_MS;
	}

	private async analyseNow(throwing: boolean) {
		const engine = this.engine;
		if (!engine) return;
		const files = this.sourceFiles();
		const unchanged = () => !this.queued && files.every((f) => this.files[f.path] === f.text);
		try {
			const started = performance.now();
			const results = await engine.analyzeProject(files);
			this.analysisMs = performance.now() - started;
			// Drop the result if any file changed while the engine was working.
			if (files.some((f) => this.files[f.path] !== f.text)) return;
			this.analyses = Object.fromEntries(files.map((f, i) => [f.path, results[i]!]));
			this.analysedTexts = Object.fromEntries(files.map((f) => [f.path, f.text]));
			// For measurements (tests/perf): when each analysis reached the page.
			performance.mark('sysml:analysed');
			if (this.engineError) {
				this.engineError = null;
				if (this.state.phase === 'error') this.state = { phase: 'ready', millis: 0 };
			}
			// Newer text is waiting: its analysis brings views, machines and checks.
			if (!unchanged()) return;
			const views = await engine.listViews(files);
			const machines = await engine.stateMachines(files);
			if (files.every((f) => this.files[f.path] === f.text)) {
				this.views = views;
				this.machines = machines;
			}
			void this.check(files, performance.now() - started);
		} catch (error) {
			if (throwing) throw error;
			this.failed(error);
		}
	}

	/**
	 * Checks are extra: the model is usable without them, so they follow the
	 * analysis rather than hold it up. They cost about as much as an analysis,
	 * and the engine does one thing at a time, so on a model that takes a
	 * while to analyse they wait for a pause in typing first.
	 */
	private async check(files: ProjectFile[], analysedIn: number) {
		const engine = this.engine;
		if (!engine) return;
		const unchanged = () => !this.queued && files.every((f) => this.files[f.path] === f.text);
		if (analysedIn > SLOW_ANALYSIS_MS) {
			await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
			if (!unchanged() || this.inFlight) return;
		}
		const checks = await engine.checks(files).catch(() => null);
		const marked = conventionsOf(Object.values(this.analyses), this.views);
		const conventions = marked.length
			? await conventionProblems(engine, files, marked).catch(() => [])
			: [];
		if (files.every((f) => this.files[f.path] === f.text)) {
			this.conventions = conventions;
			this.checks = checks;
			performance.mark('sysml:checked');
		}
	}

	/** Show that the engine couldn't analyse the model: status bar and problems. */
	private failed(error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		this.engineError = message;
		this.state = { phase: 'error', message };
	}

	text(path: string): string | undefined {
		return this.files[path];
	}

	/** Whether the analyses (elements and their places in the text) are of the files as they are now. */
	get settled(): boolean {
		return this.modelPaths.every((p) => this.analysedTexts[p] === this.files[p]);
	}

	/** Record new text for a file (typed or applied) and re-analyse shortly. */
	setText(path: string, text: string) {
		if (this.files[path] === text) return;
		this.files = { ...this.files, [path]: text };
		this.dirty.add(path);
		if (!isModelFile(path)) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.analyse(), this.analysisDelay());
	}

	/** Editors register while open so engine edits go through their history. */
	attachEditor(path: string, handle: EditorHandle): () => void {
		this.editors.set(path, handle);
		return () => {
			if (this.editors.get(path) === handle) this.editors.delete(path);
		};
	}

	/**
	 * Ask the engine for an edit and apply it (with the changes it makes in
	 * other files, such as a rename's references). Returns an error message
	 * when the engine refuses or the edit would introduce syntax errors. A
	 * warning the engine gives about an edit it made is kept for the toast of
	 * the transaction it is part of (`warnings`).
	 */
	async edit(path: string, request: EditRequest): Promise<string | null> {
		if (!this.engine) return 'The engine is not ready yet.';
		const files = this.sourceFiles().map((f) =>
			f.path === path ? { path, text: request.source } : f
		);
		let result: EditResult;
		try {
			result = await this.engine.edit({ ...request, files: request.files ?? files });
		} catch (error) {
			return (error instanceof Error ? error.message : String(error)).replace(/^Error: /, '');
		}
		if (result.syntaxErrors.length) {
			return `That change would make the SysML invalid: ${result.syntaxErrors[0]}`;
		}
		const sent = request.files ?? files;
		const others: Record<string, Change[]> = {};
		for (const { path: other, ...change } of result.otherFiles ?? [])
			(others[other] ??= []).push(change);
		const unchanged = (p: string) =>
			this.files[p] === (p === path ? request.source : sent.find((f) => f.path === p)?.text);
		if (![path, ...Object.keys(others)].every(unchanged))
			return 'The file changed meanwhile; try again.';
		this.applyTo(path, request.source, result.changes);
		for (const [other, changes] of Object.entries(others))
			this.applyTo(other, this.files[other]!, changes);
		if (result.warning) this.warnings.push(result.warning);
		return null;
	}

	/** Warnings of the edits in the latest transaction (`transact`). */
	warnings: string[] = [];

	private applyTo(path: string, source: string, changes: Change[]) {
		if (!changes.length) return;
		const editor = this.editors.get(path);
		if (editor) editor.apply(changes);
		else this.setText(path, applyChanges(source, changes));
	}

	/**
	 * Run a model edit (one or several engine edits, or file changes) as one
	 * undoable step. Files it changed, created, removed or renamed are
	 * remembered (their texts before and after) so `undo` can take it back;
	 * the engine's warnings about it are in `warnings` afterwards. A
	 * transaction inside another is part of it.
	 */
	async transact(
		label: string | (() => string),
		run: () => Promise<string | null>
	): Promise<string | null> {
		if (this.depth > 0) return run();
		const before = { ...this.files };
		this.warnings = [];
		this.moves = [];
		this.depth++;
		let error: string | null;
		try {
			error = await run();
		} finally {
			this.depth--;
		}
		const changed = Object.keys(this.files).filter((p) => this.files[p] !== before[p]);
		const removed = Object.keys(before).filter((p) => !(p in this.files));
		if (changed.length || removed.length) {
			const files: FileEdit[] = [];
			// A file renamed (and maybe changed too) is one file that moved, not one removed and one created.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not state
			const moved = new Set<string>();
			for (const [from, to] of this.moves) {
				if (!(from in before) || from in this.files || !(to in this.files) || to in before)
					continue;
				if (moved.has(from) || moved.has(to)) continue;
				moved.add(from).add(to);
				files.push({ from, to, before: before[from]!, after: this.files[to]! });
			}
			for (const p of changed)
				if (!moved.has(p))
					files.push({
						from: p in before ? p : null,
						to: p,
						before: before[p] ?? '',
						after: this.files[p]!
					});
			for (const p of removed)
				if (!moved.has(p)) files.push({ from: p, to: null, before: before[p]!, after: '' });
			this.undoStack = [
				...this.undoStack.slice(-(UNDO_LIMIT - 1)),
				{ id: this.nextEdit++, label: typeof label === 'function' ? label() : label, files }
			];
		}
		this.moves = [];
		return error;
	}

	/** How deep in `transact` calls the current change is. */
	private depth = 0;
	/** The id of the next model edit (`UndoEntry.id`). */
	private nextEdit = 1;
	/** Renames made in the current transaction, [from, to]. */
	private moves: [string, string][] = [];
	// Bookkeeping, deliberately not reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private moveListeners = new Set<FileMoveListener>();

	/**
	 * Hear when a file is renamed or moved, or leaves the project (deleted,
	 * or its creation undone), so open tabs can follow. Returns the unsubscribe.
	 */
	onFileMoved(listener: FileMoveListener): () => void {
		this.moveListeners.add(listener);
		return () => this.moveListeners.delete(listener);
	}

	private moved(from: string, to: string | null) {
		for (const listener of this.moveListeners) listener(from, to);
	}

	/** Add a file to the project, as one undoable step. */
	createFile(path: string, text: string, label = `Created ${path}`): Promise<string | null> {
		return this.transact(label, async () => {
			if (path in this.files) return `${path} exists already.`;
			this.setText(path, text);
			return null;
		});
	}

	/**
	 * Give a file another path (a move is a rename into another folder), as
	 * one undoable step. Only the path changes: SysML finds packages by name,
	 * so references to what the file holds stay as they are.
	 */
	renameFile(from: string, to: string, label = `Renamed ${from} to ${to}`): Promise<string | null> {
		return this.transact(label, async () => {
			const text = this.files[from];
			if (text === undefined) return `${from} is not in the project.`;
			if (from === to) return null;
			if (to in this.files) return `${to} exists already.`;
			const files: Record<string, string> = {};
			// Keep the order of the other files; the renamed one takes its new name in place.
			for (const [path, t] of Object.entries(this.files)) files[path === from ? to : path] = t;
			this.files = files;
			this.dirty.delete(from);
			this.dirty.add(to);
			this.moves.push([from, to]);
			this.moved(from, to);
			this.reanalyse(from, to);
			return null;
		});
	}

	/** Take a file out of the project, as one undoable step. */
	deleteFile(path: string, label = `Deleted ${path}`): Promise<string | null> {
		return this.transact(label, async () => {
			if (!(path in this.files)) return `${path} is not in the project.`;
			this.removeFile(path);
			return null;
		});
	}

	/**
	 * After a value with a unit is written (`3 [kg]`), import the units it
	 * needs where its file can't resolve them: the library the quick fix
	 * names, imported whole (`private import SI::*;`, as the starter projects
	 * do), in the package the quick fix puts it. Part of the caller's
	 * transaction, so the value and its import are undone together. `before`
	 * is the file's text before the value was written; gives back the
	 * libraries imported (`SI`).
	 */
	async importUnits(path: string, before: string): Promise<string[]> {
		const engine = this.engine;
		const after = this.files[path];
		if (!engine || after === undefined || after === before) return [];
		// The written value: what differs between the texts.
		let from = 0;
		while (from < before.length && before[from] === after[from]) from++;
		let end = 0;
		while (
			end < before.length - from &&
			end < after.length - from &&
			before[before.length - 1 - end] === after[after.length - 1 - end]
		)
			end++;
		// Whole lines: `[g]` changed to `[kg]` differs in one letter.
		from = after.lastIndexOf('\n', from - 1) + 1;
		const lineEnd = after.indexOf('\n', after.length - end);
		const to = lineEnd < 0 ? after.length : lineEnd;
		const written = after.slice(from, to);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not state
		const units = new Set(
			[...written.matchAll(/\[([^\]]*)\]/g)].flatMap((m) =>
				[...m[1]!.matchAll(/(?<![\w:'])[A-Za-z_°µμ%][\w°µμ]*(?!\s*::)/g)].map((u) => u[0])
			)
		);
		if (!units.size) return [];
		let actions;
		try {
			actions = await engine.codeActions(this.sourceFiles(), path, from, to);
		} catch {
			return [];
		}
		const libraries: string[] = [];
		const changes: { path: string; from: number; to: number; insert: string }[] = [];
		for (const action of actions) {
			const fix = /^Add import (\w+)::(.+)$/.exec(action.title);
			if (!fix || !units.has(fix[2]!.replace(/^'|'$/g, '')) || libraries.includes(fix[1]!))
				continue;
			const library = fix[1]!;
			const insert = action.changes.filter((c) => c.path === path);
			if (insert.length !== 1 || !/import\s/.test(insert[0]!.insert)) continue;
			// The whole library rather than one unit, unless the file already has it.
			if (new RegExp(`\\bimport\\s+${library}::\\*\\s*;`).test(after)) continue;
			libraries.push(library);
			changes.push({
				...insert[0]!,
				insert: insert[0]!.insert.replace(/import\s+\w+::[^;]+;/, `import ${library}::*;`)
			});
		}
		if (!changes.length) return [];
		const plain = changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert }));
		const editor = this.editors.get(path);
		if (editor) editor.apply(plain);
		else this.setText(path, applyChanges(after, plain));
		return libraries;
	}

	/**
	 * What would stop resolving without this element: the warning its
	 * removal would give, worked out without changing anything ('' when
	 * nothing refers to it, null when it can't be told).
	 */
	async whatBreaksWithoutElement(element: ModelElement): Promise<string | null> {
		const engine = this.engine;
		const source = this.files[element.file];
		if (!engine || source === undefined) return null;
		try {
			const result = await engine.edit({
				op: 'remove',
				path: element.file,
				source,
				name: element.name,
				line: element.span.start_row,
				...(element.id ? { id: element.id } : {}),
				files: this.sourceFiles()
			});
			return result.warning ?? '';
		} catch {
			return null;
		}
	}

	/**
	 * What would stop resolving without this file: the warnings of removing
	 * each of its top-level elements (the check an element's delete makes),
	 * worked out without changing anything. The file's elements all go
	 * together, so only references from elements that stay count: each is
	 * removed from the file with the others blanked out (lines kept).
	 */
	async whatBreaksWithout(path: string): Promise<string[]> {
		const engine = this.engine;
		if (!engine || this.files[path] === undefined || !isModelFile(path)) return [];
		// The file's elements as they are now (it may have just been renamed or typed in).
		if (!this.settled) await this.analyse(true);
		const source = this.files[path];
		if (source === undefined) return [];
		const roots = this.tree.map((n) => n.element).filter((e) => e.file === path);
		const range = (e: ModelElement) =>
			[byteToUtf16(source, e.span.start_byte), byteToUtf16(source, e.span.end_byte)] as const;
		const files = this.sourceFiles();
		const warnings: string[] = [];
		for (const element of roots) {
			let text = source;
			for (const other of roots) {
				if (other === element) continue;
				const [from, to] = range(other);
				text = text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, ' ') + text.slice(to);
			}
			try {
				const result = await engine.edit({
					op: 'remove',
					path,
					source: text,
					name: element.name,
					line: element.span.start_row,
					...(element.id ? { id: element.id } : {}),
					files: files.map((f) => (f.path === path ? { path, text } : f))
				});
				if (result.warning) warnings.push(result.warning);
			} catch {
				// Not one the engine can remove: it says nothing about it, then.
			}
		}
		return warnings;
	}

	/** Analyse again soon, after files came or went. */
	private reanalyse(...paths: string[]) {
		if (!paths.some(isModelFile)) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.analyse(), this.analysisDelay());
	}

	/**
	 * Apply engine changes that may span several files (a rename, a quick
	 * fix) as one undoable step, through open editors where there are any.
	 */
	async applyFileChanges(
		label: string,
		changes: { path: string; from: number; to: number; insert: string }[]
	): Promise<void> {
		await this.transact(label, async () => {
			const byFile: Record<string, Change[]> = {};
			for (const { path, ...change } of changes) (byFile[path] ??= []).push(change);
			for (const [path, fileChanges] of Object.entries(byFile)) {
				const before = this.files[path];
				if (before === undefined) continue;
				const editor = this.editors.get(path);
				if (editor) editor.apply(fileChanges);
				else this.setText(path, applyChanges(before, fileChanges));
			}
			return null;
		});
	}

	/** The latest model edit's id: to tell whether a transaction made one, and for its toast to undo it. */
	get lastEdit(): number | undefined {
		return this.undoStack.at(-1)?.id;
	}

	/**
	 * Undo the latest model edit, or the one `id` names; returns its label,
	 * or null when there is none or it can't be undone (`undoEdit` says why).
	 */
	undo(id?: number): string | null {
		const outcome = this.undoEdit(id);
		return outcome && 'undone' in outcome ? outcome.undone : null;
	}

	/**
	 * Undo a model edit (the one `id` names, else the latest), keeping what
	 * changed after it: only the edit's own changes are taken back, from
	 * where they are now. When that would lose a later change (one inside
	 * what the edit wrote, typing in a file it created, another file where
	 * one it moved or removed was), nothing changes and it says why. Null
	 * when there is no such edit (any more).
	 */
	undoEdit(id?: number): UndoOutcome | null {
		const entry =
			id === undefined ? this.undoStack.at(-1) : this.undoStack.find((e) => e.id === id);
		if (!entry) return null;
		const refused = (why: string): UndoOutcome => ({
			refused: `Can’t undo “${entry.label}”: ${why}`
		});
		// Work out every file first, so an undo that can't be made changes nothing.
		const plan: { file: FileEdit; changes: Change[] }[] = [];
		for (const file of entry.files) {
			const now = file.to === null ? undefined : this.files[file.to];
			if (file.from === null) {
				// A file it created: gone already, or as the edit left it.
				if (now !== undefined && now !== file.after)
					return refused(`${file.to} has been changed since, and undoing would remove it.`);
				plan.push({ file, changes: [] });
				continue;
			}
			if (file.to !== null && now === undefined)
				return refused(`${file.to} has been renamed or removed since.`);
			if (file.from !== file.to && file.from in this.files)
				return refused(`there is another file at ${file.from} now.`);
			const changes = now === undefined ? [] : revertChanges(file.before, file.after, now);
			if (!changes) return refused(`what it changed in ${file.to} has been changed again since.`);
			plan.push({ file, changes });
		}
		this.undoStack = this.undoStack.filter((e) => e !== entry);
		for (const { file, changes } of plan) {
			if (file.from === null) this.removeFile(file.to!, false);
			else if (file.to === null) this.setText(file.from, file.before);
			else if (file.from === file.to) this.applyTo(file.to, this.files[file.to]!, changes);
			else this.moveBack(file.to, file.from, applyChanges(this.files[file.to]!, changes));
		}
		// Open tabs of a moved file go back with it; of a created one, they close.
		for (const { file } of plan) {
			if (file.from === null) this.moved(file.to!, null);
			else if (file.to !== null && file.from !== file.to) this.moved(file.to, file.from);
		}
		return { undone: entry.label };
	}

	/** Put a renamed file back at its old path, in its place, with this text (undoing the rename). */
	private moveBack(path: string, to: string, text: string) {
		const files: Record<string, string> = {};
		for (const [p, t] of Object.entries(this.files)) {
			if (p === path) files[to] = text;
			else files[p] = t;
		}
		this.files = files;
		this.dirty.delete(path);
		this.dirty.add(to);
		this.reanalyse(path, to);
	}

	/** Take a file out of the project (a delete, or undoing the edit that created it). */
	private removeFile(path: string, tell = true) {
		if (!(path in this.files)) return;
		const rest = { ...this.files };
		delete rest[path];
		this.files = rest;
		this.dirty.delete(path);
		if (tell) this.moved(path, null);
		this.reanalyse(path);
	}

	/** Every model file, for project-wide engine calls such as diagrams. */
	sourceFiles(): ProjectFile[] {
		return this.modelPaths.map((path) => ({ path, text: this.files[path] ?? '' }));
	}
}

/** The single change that turns `from` into `to` (common prefix and suffix kept). */
export function minimalChange(from: string, to: string): Change | null {
	if (from === to) return null;
	let start = 0;
	const max = Math.min(from.length, to.length);
	while (start < max && from[start] === to[start]) start++;
	let end = 0;
	while (end < max - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
	return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/** Apply non-overlapping changes (UTF-16 offsets) to a string. */
export function applyChanges(text: string, changes: Change[]): string {
	let result = text;
	for (const change of [...changes].sort((a, b) => b.from - a.from)) {
		result = result.slice(0, change.from) + change.insert + result.slice(change.to);
	}
	return result;
}

/** The engine's failure as a problem, so it shows where problems are listed. */
function engineProblem(message: string): Diagnostic {
	return {
		file: '',
		span: { start_row: 1, start_col: 1, end_row: 1, end_col: 1, start_byte: 0, end_byte: 0 },
		severity: 'error',
		code: 'engine',
		message
	};
}

function severityRank(severity: Diagnostic['severity']): number {
	return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}
