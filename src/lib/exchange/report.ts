/**
 * What an import says to the person: a few plain sentences, and the full list
 * as a text file to download.
 */
import type { ImportNote, InterchangeImport } from './types';

export interface ImportSummary {
	/** One sentence: did everything come across? */
	headline: string;
	tone: 'success' | 'warn';
	/** Groups of notes, most important first. */
	groups: { title: string; tone: 'warn' | 'info'; notes: ImportNote[] }[];
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export function summarizeImport(result: InterchangeImport): ImportSummary {
	const of = (...kinds: ImportNote['kind'][]) => result.notes.filter((n) => kinds.includes(n.kind));
	const lost = of('left-out', 'warning');
	const changed = of('changed', 'added');
	const errors = result.problems.filter((p) => p.severity === 'error').length;
	const groups: ImportSummary['groups'] = [];
	if (lost.length) groups.push({ title: 'Not carried over', tone: 'warn', notes: lost });
	if (changed.length)
		groups.push({ title: 'Reads differently in the text', tone: 'warn', notes: changed });
	const info = of('library', 'implied', 'repaired');
	if (info.length) groups.push({ title: 'Good to know', tone: 'info', notes: info });

	const files = plural(result.files.length, 'file');
	const elements = plural(result.carried, 'element');
	let headline: string;
	if (!lost.length && !changed.length && !errors)
		headline = `Everything came across: ${elements} in ${files}, with no problems.`;
	else {
		const parts: string[] = [];
		if (lost.length) parts.push(`${plural(lost.length, 'thing')} couldn’t be carried over`);
		if (changed.length)
			parts.push(
				`${plural(changed.length, 'element')} ${changed.length === 1 ? 'reads' : 'read'} differently`
			);
		if (errors) parts.push(`the text has ${plural(errors, 'problem')} to fix`);
		headline = `${elements} in ${files}. ${capital(parts.join('; '))}.`;
	}
	return { headline, tone: lost.length || changed.length || errors ? 'warn' : 'success', groups };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The whole report as plain text: what was read, what didn't come across, the problems. */
export function importReportText(
	result: InterchangeImport,
	source: string,
	at = new Date()
): string {
	const lines = [
		`Import of ${source}`,
		`Made ${at.toISOString()}`,
		'',
		`Elements in the file: ${result.elements}`,
		`Elements in the text: ${result.carried}`,
		`Files: ${result.files.map((f) => f.path).join(', ')}`
	];
	const section = (title: string, notes: ImportNote[]) => {
		if (!notes.length) return;
		lines.push('', `${title} (${notes.length})`);
		for (const n of notes) lines.push(`- ${n.element ? `${n.element}: ` : ''}${n.message}`);
	};
	const of = (...kinds: ImportNote['kind'][]) => result.notes.filter((n) => kinds.includes(n.kind));
	section('Not carried over', of('left-out', 'warning'));
	section('Reads differently in the text', of('changed', 'added'));
	section('Good to know', of('library', 'implied', 'repaired'));
	lines.push('', `Problems in the imported text (${result.problems.length})`);
	for (const p of result.problems) lines.push(`- ${p.file}:${p.line} ${p.severity}: ${p.message}`);
	return `${lines.join('\n')}\n`;
}
