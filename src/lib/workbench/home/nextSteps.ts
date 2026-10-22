/**
 * The "Next steps" of a new project: a few plain steps, each ticked by what
 * the model now has beyond what the project started with (a requirement, a
 * part, a satisfy link, a saved view, a sum or a limit), and by a copy kept
 * on GitHub or downloaded. What it started with, whether it was put away and
 * whether a copy was downloaded are remembered per project in this browser.
 */
import type { CheckReport, ViewInfo } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import type { RequirementRow } from '#lib/project/requirements.ts';
import { isLibraryFile } from '#lib/project/workspace.svelte.ts';

/** What the model has, counted for the steps. */
export interface Counts {
	requirements: number;
	parts: number;
	satisfies: number;
	views: number;
	/** Values added up from parts, and limits the app checks. */
	numbers: number;
}

export interface Measured {
	elements: readonly ModelElement[];
	requirements: readonly RequirementRow[];
	views: readonly ViewInfo[];
	checks: CheckReport | null;
}

/** A value that adds up other values: `a.mass + b.mass`, `sum(wheels.mass)`. */
const ROLLUP = /\bsum\s*\(|[\w']\.[\w']+\s*\+\s*[\w']+\./;

export function countModel(m: Measured): Counts {
	const own = m.elements.filter((e) => !isLibraryFile(e.file));
	const rollups = own.filter(
		(e) => e.kind === 'attribute' && e.value !== null && ROLLUP.test(e.value)
	).length;
	const limits = (m.checks?.checks ?? []).filter(
		(c) => c.checkable && c.kind !== 'assert' && !isLibraryFile(c.constraintAt?.file ?? '')
	).length;
	return {
		requirements: m.requirements.length,
		parts: own.filter((e) => e.kind === 'part').length,
		satisfies: m.requirements.reduce((sum, r) => sum + r.satisfiedBy.length, 0),
		views: m.views.filter((v) => v.isUsage && !v.builtin && !isLibraryFile(v.file)).length,
		numbers: rollups + limits
	};
}

export type StepId = 'requirement' | 'part' | 'link' | 'view' | 'numbers' | 'keep';

export const STEP_ORDER: readonly StepId[] = [
	'requirement',
	'part',
	'link',
	'view',
	'numbers',
	'keep'
];

/** Which steps are done: the model has more than it started with, or a copy is kept. */
export function doneSteps(
	now: Counts,
	start: Counts,
	kept: { github: boolean; downloaded: boolean }
): Record<StepId, boolean> {
	return {
		requirement: now.requirements > start.requirements,
		part: now.parts > start.parts,
		link: now.satisfies > start.satisfies,
		view: now.views > start.views,
		numbers: now.numbers > start.numbers,
		keep: kept.github || kept.downloaded
	};
}

// ── Remembered per project ────────────────────────────────────────────────

export interface NextStepsState {
	/** Put away by the person. */
	dismissed?: boolean;
	/** What the model had when the steps were first shown. */
	start?: Counts;
	/** A `.kpar` copy was downloaded. */
	downloaded?: boolean;
}

const key = (project: string) => `fairtide.next-steps.${project}`;

export function readNextSteps(project: string): NextStepsState {
	try {
		const raw = localStorage.getItem(key(project));
		return raw ? (JSON.parse(raw) as NextStepsState) : {};
	} catch {
		return {};
	}
}

export function writeNextSteps(project: string, change: Partial<NextStepsState>): NextStepsState {
	const next = { ...readNextSteps(project), ...change };
	try {
		localStorage.setItem(key(project), JSON.stringify(next));
	} catch {
		// Private browsing or storage full: the steps just aren't remembered.
	}
	return next;
}

/** Remember that a copy of the project was downloaded (ticks "Keep a copy"). */
export function noteDownloaded(project: string): void {
	writeNextSteps(project, { downloaded: true });
	if (typeof window !== 'undefined') window.dispatchEvent(new Event('fairtide:next-steps'));
}
