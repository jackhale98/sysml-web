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
	Diagnostic,
	EditRequest,
	EditResult,
	StateMachine,
	ViewInfo
} from '#lib/engine/types.ts';
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
const UNDO_LIMIT = 50;

interface UndoEntry {
	label: string;
	/** Text of each changed file before the edit. */
	before: Record<string, string>;
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

	/** Syntax errors and checks, errors first. */
	problems: Diagnostic[] = $derived(
		Object.values(this.analyses)
			.flatMap((a) => [
				...a.model.syntax_errors.map((e): Diagnostic => ({
					file: a.model.file,
					span: e.span,
					severity: 'error',
					code: 'syntax',
					message: e.message
				})),
				...a.diagnostics
			])
			.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
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
		this.dirty.clear();
		this.state = { phase: 'loading', done: 0, total: this.modelPaths.length };
		const started = performance.now();
		try {
			this.engineVersion = await engine.version();
			await this.analyse();
			if (generation !== this.generation) return;
			this.state = { phase: 'ready', millis: performance.now() - started };
		} catch (error) {
			this.state = { phase: 'error', message: String(error) };
		}
	}

	/** Analyse every model file together, so references resolve across files. */
	private async analyse() {
		const engine = this.engine;
		if (!engine) return;
		const files = this.sourceFiles();
		const results = await engine.analyzeProject(files);
		// Drop the result if any file changed while the engine was working.
		if (files.some((f) => this.files[f.path] !== f.text)) return;
		this.analyses = Object.fromEntries(files.map((f, i) => [f.path, results[i]!]));
		const views = await engine.listViews(files);
		const machines = await engine.stateMachines(files);
		if (files.every((f) => this.files[f.path] === f.text)) {
			this.views = views;
			this.machines = machines;
		}
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
		this.timer = setTimeout(() => void this.analyse(), ANALYSIS_DELAY_MS);
	}

	/** Editors register while open so engine edits go through their history. */
	attachEditor(path: string, handle: EditorHandle): () => void {
		this.editors.set(path, handle);
		return () => {
			if (this.editors.get(path) === handle) this.editors.delete(path);
		};
	}

	/**
	 * Ask the engine for an edit and apply it. Returns an error message when
	 * the engine refuses or the edit would introduce syntax errors.
	 */
	async edit(path: string, request: EditRequest): Promise<string | null> {
		if (!this.engine) return 'The engine is not ready yet.';
		let result: EditResult;
		try {
			result = await this.engine.edit(request);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		if (result.syntaxErrors.length) {
			return `That change would make the SysML invalid: ${result.syntaxErrors[0]}`;
		}
		if (this.files[path] !== request.source) return 'The file changed meanwhile; try again.';
		const editor = this.editors.get(path);
		if (editor) editor.apply(result.changes);
		else this.setText(path, applyChanges(request.source, result.changes));
		return null;
	}

	/**
	 * Run a model edit (one or several engine edits) as one undoable step.
	 * Files it changed are remembered so `undo` can put them back.
	 */
	async transact(label: string, run: () => Promise<string | null>): Promise<string | null> {
		const before = { ...this.files };
		const error = await run();
		const changed = Object.keys(this.files).filter((p) => this.files[p] !== before[p]);
		if (changed.length) {
			this.undoStack = [
				...this.undoStack.slice(-(UNDO_LIMIT - 1)),
				{ label, before: Object.fromEntries(changed.map((p) => [p, before[p] ?? ''])) }
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
		return entry.label;
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

function severityRank(severity: Diagnostic['severity']): number {
	return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}
