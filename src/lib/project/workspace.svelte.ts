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
import { buildTree, collectElements, type ModelElement, type TreeNode } from './elements';
import { collectRequirements, type RequirementRow } from './requirements';

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

export interface Coverage {
	total: number;
	satisfied: number;
	verified: number;
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

interface UndoEntry {
	label: string;
	/** Text of each changed file before the edit. */
	before: Record<string, string>;
	/** Files the edit created; undo removes them. */
	created?: string[];
}

export class Workspace {
	info = $state.raw<ProjectInfo | null>(null);
	/** File texts by path. */
	files = $state.raw<Record<string, string>>({});
	analyses = $state.raw<Record<string, Analysis>>({});
	state = $state.raw<LoadState>({ phase: 'idle' });
	engineVersion = $state<string | null>(null);
	/** The project's views (and the standard ones the engine bundles). */
	views = $state.raw<ViewInfo[]>([]);
	/** The project's state machines, for the emulator. */
	machines = $state.raw<StateMachine[]>([]);
	/** Constraint checks of the latest analysis (after it: they take a moment longer). */
	checks = $state.raw<CheckReport | null>(null);
	/** Paths edited since the project was opened. */
	readonly dirty = new SvelteSet<string>();
	/** Model edits made through `transact`, newest last. */
	undoStack = $state.raw<UndoEntry[]>([]);

	paths: string[] = $derived(Object.keys(this.files).sort());
	modelPaths: string[] = $derived(this.paths.filter(isModelFile));

	elements: ModelElement[] = $derived(collectElements(Object.values(this.analyses)));
	tree: TreeNode[] = $derived(buildTree(this.elements));

	requirements: RequirementRow[] = $derived(collectRequirements(Object.values(this.analyses)));

	coverage: Coverage = $derived({
		total: this.requirements.length,
		satisfied: this.requirements.filter((r) => r.satisfiedBy.length > 0).length,
		verified: this.requirements.filter((r) => r.verifiedBy.length > 0).length
	});

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
			// A requirement the design doesn't meet; undecided checks are not problems.
			...checkProblems(this.checks?.checks ?? [])
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
			this.engineVersion = await engine.version();
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
		if (files.every((f) => this.files[f.path] === f.text)) {
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
	 * Run a model edit (one or several engine edits) as one undoable step.
	 * Files it changed are remembered so `undo` can put them back; the
	 * engine's warnings about it are in `warnings` afterwards.
	 */
	async transact(label: string, run: () => Promise<string | null>): Promise<string | null> {
		const before = { ...this.files };
		this.warnings = [];
		const error = await run();
		const changed = Object.keys(this.files).filter((p) => this.files[p] !== before[p]);
		if (changed.length) {
			const created = changed.filter((p) => !(p in before));
			const kept = changed.filter((p) => p in before);
			this.undoStack = [
				...this.undoStack.slice(-(UNDO_LIMIT - 1)),
				{
					label,
					before: Object.fromEntries(kept.map((p) => [p, before[p]!])),
					...(created.length ? { created } : {})
				}
			];
		}
		return error;
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

	/** Undo the latest model edit; returns its label, or null when there is none. */
	undo(): string | null {
		const entry = this.undoStack.at(-1);
		if (!entry) return null;
		this.undoStack = this.undoStack.slice(0, -1);
		for (const [path, text] of Object.entries(entry.before)) this.replaceText(path, text);
		for (const path of entry.created ?? []) this.removeFile(path);
		return entry.label;
	}

	/** Take a file out of the project (undoing the edit that created it). */
	private removeFile(path: string) {
		if (!(path in this.files)) return;
		const rest = { ...this.files };
		delete rest[path];
		this.files = rest;
		this.dirty.delete(path);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.analyse(), this.analysisDelay());
	}

	/** Replace a file's text with one minimal change, through its editor when open. */
	private replaceText(path: string, text: string) {
		const current = this.files[path] ?? '';
		const change = minimalChange(current, text);
		if (!change) return;
		const editor = this.editors.get(path);
		if (editor) editor.apply([change]);
		else this.setText(path, text);
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
