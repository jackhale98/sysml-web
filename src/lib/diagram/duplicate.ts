/**
 * Duplicate an element: its declaration copied as written, body and all,
 * under a free name (`battery` → `battery2`), right after the original. Its
 * short name is left out, since two elements cannot share one.
 *
 * Pure, like the other planners: the edit comes back as a text patch for
 * `applySteps`, one undoable step.
 */
import { readHeader } from '#lib/engine/toolkit/header.ts';
import { byteToUtf16, type ModelElement } from '#lib/project/elements.ts';
import { formatName } from '#lib/workbench/templates.ts';
import type { ModelContext, Plan } from './relationships.ts';

/**
 * The first free name like `name`: a number added (`battery2`, `'Flight
 * endurance 2'`), or the one it ends with counted on (`motor2` → `motor3`).
 */
export function freeName(name: string, taken: ReadonlySet<string>): string {
	const numbered = /^(.*?)(\s?)(\d+)$/.exec(name);
	const base = numbered ? numbered[1]! : name;
	const gap = numbered ? numbered[2]! : /\s/.test(name) ? ' ' : '';
	let n = numbered ? Number(numbered[3]) + 1 : 2;
	while (taken.has(`${base}${gap}${n}`)) n++;
	return `${base}${gap}${n}`;
}

export interface Duplicate extends Plan {
	/** The copy's name (unquoted), to find it once the model has it. */
	name: string;
}

export function planDuplicate(element: ModelElement, ctx: ModelContext): Duplicate | string {
	const text = ctx.textOf(element.file);
	if (text === undefined) return `${element.file} is not in the project.`;
	const from = byteToUtf16(text, element.span.start_byte);
	const to = byteToUtf16(text, element.span.end_byte);
	const source = text.slice(from, to);
	const header = readHeader(text, from);
	const named = header?.parts.find((p) => p.slot === 'name');
	if (!header || !named || !/[;}]\s*$/.test(source)) {
		return `${element.label} has no name of its own to copy (it redefines another), so it can’t be duplicated.`;
	}
	// Siblings' names: the copy's has to differ from all of them.
	const owner = ctx.owners.get(element.key);
	const taken = new Set(
		ctx.elements
			.filter((e) => ctx.owners.get(e.key)?.key === owner?.key && (owner || !e.parent))
			.map((e) => e.label)
	);
	const name = freeName(element.label, taken);
	// The copy: the new name in place of the old, without the short name.
	const cuts = [{ start: named.start, end: named.end, insert: formatName(name) }];
	const short = header.parts.find((p) => p.slot === 'shortName');
	if (short) {
		let end = short.end;
		while (/[ \t]/.test(text[end] ?? '')) end++;
		cuts.push({ start: short.start, end, insert: '' });
	}
	let copy = source;
	for (const cut of cuts.sort((a, b) => b.start - a.start)) {
		copy = copy.slice(0, cut.start - from) + cut.insert + copy.slice(cut.end - from);
	}
	// On a line of its own after the original, indented the same; else beside it.
	const lineStart = text.lastIndexOf('\n', from - 1) + 1;
	const lineEnd = text.indexOf('\n', to) < 0 ? text.length : text.indexOf('\n', to);
	const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
	const ownLine = !text.slice(lineStart, from).trim() && !text.slice(to, lineEnd).trim();
	const after = ownLine
		? `${text.slice(0, lineEnd)}\n${indent}${copy}${text.slice(lineEnd)}`
		: `${text.slice(0, to)} ${copy}${text.slice(to)}`;
	return {
		label: `Duplicated ${element.label} as ${name}`,
		statement: copy.split('\n')[0]!,
		steps: [{ kind: 'patch', path: element.file, before: text, after }],
		name
	};
}
