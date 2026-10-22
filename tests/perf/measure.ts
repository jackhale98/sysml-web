/**
 * The engine's side of the benchmark, in Node: the same calls the workspace
 * and the views make, through `ToolkitHost` (what the worker runs), plus
 * the page's own model building (`elements.ts`, `requirements.ts`).
 */
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import type { SourceFile } from '#lib/engine/protocol.ts';
import { buildTree, collectElements } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import type { Analysis } from '#lib/engine/types.ts';
import type { Timings } from './stats';

export { medians, type Timings } from './stats';

const now = () => performance.now();

const verbose = !!process.env.BENCH_VERBOSE;

function time<T>(timings: Timings, key: string, run: () => T): T {
	if (verbose) console.log(`  ${key}…`);
	const started = now();
	timings[key] = NaN;
	const result = run();
	timings[key] = now() - started;
	return result;
}

/** The page's work on a new analysis: elements, the explorer's tree, requirements. */
export function pageModel(timings: Timings, analyses: Analysis[], prefix: string) {
	const elements = time(timings, `${prefix}.elements`, () => collectElements(analyses));
	time(timings, `${prefix}.tree`, () => buildTree(elements));
	time(timings, `${prefix}.requirements`, () => collectRequirements(analyses));
	timings[`${prefix}.page`] =
		timings[`${prefix}.elements`]! +
		timings[`${prefix}.tree`]! +
		timings[`${prefix}.requirements`]!;
	return elements;
}

/** What `Workspace.analyse` asks the engine for after every change. */
export function analyse(host: ToolkitHost, files: SourceFile[], timings: Timings, prefix: string) {
	const analyses = time(timings, `${prefix}.analysis`, () => host.analyzeProject(files));
	timings[`${prefix}.build`] = host.lastBuild.ms;
	timings[`${prefix}.build.session`] = host.lastBuild.sessionMs;
	timings[`${prefix}.build.check`] = host.lastBuild.checkMs;
	timings[`${prefix}.build.adapter`] = host.lastBuild.adapterMs;
	time(timings, `${prefix}.views`, () => host.listViews(files));
	time(timings, `${prefix}.machines`, () => host.stateMachines(files));
	time(timings, `${prefix}.checks`, () => host.checks(files));
	timings[`${prefix}.engine`] =
		timings[`${prefix}.analysis`]! +
		timings[`${prefix}.views`]! +
		timings[`${prefix}.machines`]! +
		timings[`${prefix}.checks`]!;
	// What the worker posts back: the analyses go through a structured clone.
	time(timings, `${prefix}.clone`, () => structuredClone(analyses));
	return analyses;
}

/** A one-character edit inside a doc comment of `path`. */
export function typeOneCharacter(files: SourceFile[], path: string, round: number): SourceFile[] {
	return files.map((f) => {
		if (f.path !== path) return f;
		const at = f.text.indexOf('doc /*') + 'doc /* '.length;
		const char = round % 2 ? 'x' : 'y';
		return { path: f.path, text: f.text.slice(0, at) + char + f.text.slice(at + 1) };
	});
}

export interface Scenario {
	/** The file edited and completed in (the largest). */
	largest: string;
	/** A table over the whole project, and one over a subsystem. */
	tables: string[];
	/** Diagrams: [view, scope]. */
	diagrams: [Parameters<ToolkitHost['diagram']>[0], string | null][];
}

/** Every measurement of one project, once. */
export function measureOnce(
	host: ToolkitHost,
	files: SourceFile[],
	scenario: Scenario,
	round: number,
	timings: Timings = {}
): Timings {
	// A cold open: the host's previous outcomes are another project's.
	host.analyzeProject([{ path: 'Empty.sysml', text: `package Empty${round} {}` }]);
	const opened = analyse(host, files, timings, 'open');
	pageModel(timings, opened, 'open');

	// A keystroke: one character in a doc comment, then the same work again.
	const edited = typeOneCharacter(files, scenario.largest, round);
	const analyses = analyse(host, edited, timings, 'edit');
	pageModel(timings, analyses, 'edit');

	// Language services in the edited file (the first call after an edit syncs the server).
	const text = edited.find((f) => f.path === scenario.largest)!.text;
	const typeAt = text.indexOf(': ', text.indexOf('part def ')) + 2;
	time(timings, 'complete', () => host.complete(edited, scenario.largest, typeAt + 1));
	time(timings, 'complete.again', () => host.complete(edited, scenario.largest, typeAt + 1));
	time(timings, 'hover', () => host.hover(edited, scenario.largest, typeAt + 1));

	for (const name of scenario.tables)
		time(timings, `table:${name}`, () => host.renderView(edited, name));
	for (const [view, scope] of scenario.diagrams)
		time(timings, `diagram:${view}:${scope ?? '*'}`, () => host.diagram(view, edited, scope));
	return timings;
}
