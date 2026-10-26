/**
 * Recording a verification result: the case's `@VerificationResult` written
 * (or replaced: a case keeps its latest result, the earlier ones are in the
 * history of the files), the imports its package needs, and the results
 * library copied in when the project lacks it, as one undoable change.
 */
import { enclosingPackage } from '#lib/create/model.ts';
import { withImports } from '#lib/create/sysml.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import {
	RESULT_METADATA,
	RESULTS_LIBRARY_PATH,
	RESULTS_PACKAGE,
	VERDICT_LABEL,
	type Verdict
} from '#lib/project/verification.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import library from '/src/lib/project/libraries/VerificationResults.sysml?raw';
import { applySteps, type WriteStep } from './actions';

export interface ResultInput {
	verdict: Verdict;
	/** ISO 8601 date: `2026-10-20`. */
	date: string;
	runBy: string;
	commit: string;
	evidence: string;
}

/** The library's text, as a project gets it. */
export const RESULTS_LIBRARY = library;

const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** `@VerificationResult { verdict = VerdictKind::pass; date = "…"; … }`, empty fields left out. */
export function resultAnnotation(input: ResultInput, indent: string): string {
	const fields = [
		`verdict = VerdictKind::${input.verdict};`,
		`date = ${quote(input.date.trim())};`,
		...(input.runBy.trim() ? [`runBy = ${quote(input.runBy.trim())};`] : []),
		...(input.commit.trim() ? [`commit = ${quote(input.commit.trim())};`] : []),
		...(input.evidence.trim() ? [`evidence = ${quote(input.evidence.trim())};`] : [])
	];
	return [
		`${indent}@${RESULT_METADATA} {`,
		...fields.map((f) => `${indent}    ${f}`),
		`${indent}}`
	].join('\n');
}

/** The indentation of the line `offset` is on. */
function indentAt(text: string, offset: number): string {
	const start = text.lastIndexOf('\n', offset - 1) + 1;
	return /^[ \t]*/.exec(text.slice(start))![0];
}

/** Where an annotation that starts at `from` ends (its `{ … }`, strings skipped). */
function annotationEnd(text: string, from: number): number {
	let depth = 0;
	for (let i = text.indexOf('{', from); i >= 0 && i < text.length; i++) {
		const c = text[i]!;
		if (c === '"') {
			for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
		} else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return i + 1;
	}
	return -1;
}

/** The case's text with the result in it: replacing the one it has, else before its closing brace. */
export function withResult(text: string, from: number, to: number, input: ResultInput): string {
	const own = text.slice(from, to);
	const indent = indentAt(text, from);
	const existing = new RegExp(String.raw`@\s*(?:\w+\s*::\s*)*${RESULT_METADATA}\b`).exec(own);
	if (existing) {
		const start = from + existing.index;
		const end = annotationEnd(text, start);
		if (end > start && end <= to)
			return (
				text.slice(0, start) +
				resultAnnotation(input, indentAt(text, start)).trimStart() +
				text.slice(end)
			);
	}
	const inner = `${indent}    `;
	if (own.trimEnd().endsWith('}')) {
		const close = from + own.trimEnd().length - 1;
		const before = text.slice(0, close).replace(/[ \t]*$/, '');
		const lineBreak = before.endsWith('\n') ? '' : '\n';
		return `${before}${lineBreak}${resultAnnotation(input, inner)}\n${indent}${text.slice(close)}`;
	}
	// `verification x;`: give it a body.
	const semicolon = from + own.lastIndexOf(';');
	return `${text.slice(0, semicolon).trimEnd()} {\n${resultAnnotation(input, inner)}\n${indent}}${text.slice(semicolon + 1)}`;
}

/** The steps of recording a result on a verification case, or why it can't be. */
export function planResult(
	workspace: Workspace,
	element: ModelElement,
	input: ResultInput
): WriteStep[] | string {
	if (element.kind !== 'verification' || element.isDefinition)
		return 'A result is recorded on a verification case.';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date.trim()))
		return 'Give the date as year-month-day, such as 2026-10-20.';
	const before = workspace.text(element.file);
	const { from, to } = element.span;
	if (before === undefined || from === undefined || to === undefined)
		return `${element.file} is not in the project.`;
	let after = withResult(before, from, to, input);
	const pkg = enclosingPackage(workspace.tree, element.key);
	if (pkg?.span.from !== undefined && pkg.span.to !== undefined)
		after = withImports(
			after,
			{
				qualifiedName: pkg.name,
				from: pkg.span.from,
				to: pkg.span.to + after.length - before.length
			},
			[`${RESULTS_PACKAGE}::${RESULT_METADATA}`, 'VerificationCases::VerdictKind']
		);
	const steps: WriteStep[] = [];
	const hasLibrary = workspace.elements.some(
		(e) => e.kind === 'package' && e.name === RESULTS_PACKAGE && !e.isDefinition
	);
	if (!hasLibrary && workspace.text(RESULTS_LIBRARY_PATH) === undefined)
		steps.push({ kind: 'file', path: RESULTS_LIBRARY_PATH, text: RESULTS_LIBRARY });
	steps.push({ kind: 'patch', path: element.file, before, after });
	return steps;
}

/** Record a result on a verification case, as one undoable step with a toast. */
export async function recordResult(
	workspace: Workspace,
	element: ModelElement,
	input: ResultInput
): Promise<string | null> {
	const steps = planResult(workspace, element, input);
	if (typeof steps === 'string') return steps;
	return applySteps(
		workspace,
		`Recorded ${element.label}: ${VERDICT_LABEL[input.verdict].toLowerCase()}`,
		steps
	);
}
