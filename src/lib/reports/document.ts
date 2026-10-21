/**
 * A report as a document: a title page, then numbered chapters of blocks.
 * Built from the model by pure functions (specification.ts, icd.ts) and
 * shown on screen, printed, or exported as HTML or Markdown from the same
 * structure, so all of them say the same thing.
 */
import type { ReportKind } from './kinds.ts';

/** A run of text; `ref` names the model element it stands for (a `ModelElement.key`). */
export interface Run {
	text: string;
	ref?: string;
	code?: boolean;
}

export type Text = Run[];

export type Tone = 'ok' | 'warn' | 'bad' | 'plain';

export interface TreeItem {
	text: Text;
	children: TreeItem[];
}

export type Block =
	| { type: 'paragraph'; text: Text; muted?: boolean }
	/** A requirement's statement: the "shall" text. */
	| { type: 'statement'; text: Text }
	| { type: 'facts'; facts: { label: string; value: Text }[] }
	| {
			type: 'table';
			caption?: string;
			columns: string[];
			rows: Text[][];
			/** Columns holding numbers, right-aligned. */
			numeric?: boolean[];
	  }
	| { type: 'metrics'; items: { label: string; value: string; detail?: string; tone?: Tone }[] }
	| { type: 'tree'; items: TreeItem[] }
	| { type: 'note'; label: string; text: Text; tone: Tone }
	| { type: 'diagram'; svg: string; caption: string; alt: string };

export interface Section {
	/** Anchor, unique in the document. */
	id: string;
	/** `2`, `2.1`, `2.1.3`; set by `numberSections`. */
	number: string;
	title: string;
	/** Shown before the title, e.g. a requirement's ID. */
	tag?: string;
	/** The element the section is about. */
	ref?: string;
	/** A word shown with the title, e.g. a requirement's status. */
	badge?: { text: string; tone: Tone };
	blocks: Block[];
	sections: Section[];
}

export interface ReportDocument {
	kind: ReportKind;
	/** The view the report renders. */
	view: string;
	title: string;
	/** What kind of document it is, e.g. "Requirements specification". */
	kindLabel: string;
	project: string;
	description: string | null;
	number: string | null;
	version: string | null;
	status: string | null;
	author: string | null;
	/** The date it was generated, for people ("21 October 2026"). */
	date: string;
	/** What the report covers: the view's `expose` targets; empty for the whole model. */
	scope: string[];
	/** Key figures for the title page. */
	summary: { label: string; value: string }[];
	sections: Section[];
}

/** Plain text of a run list. */
export function plain(text: Text): string {
	return text.map((r) => r.text).join('');
}

export function t(text: string, ref?: string): Run {
	return ref ? { text, ref } : { text };
}

/** Runs separated by commas. */
export function joined(runs: Run[], separator = ', '): Text {
	return runs.flatMap((run, i) => (i ? [{ text: separator }, run] : [run]));
}

/** An anchor from a title: lower case, words joined by hyphens. */
export function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.trim()
			.replace(/[\s_]+/g, '-')
			.replace(/-+/g, '-') || 'section'
	);
}

/** Number sections 1, 1.1, 1.1.1 … and make their ids unique. */
export function numberSections(sections: Section[]): Section[] {
	const used = new Set<string>();
	const visit = (list: Section[], prefix: string): Section[] =>
		list.map((section, i) => {
			const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
			let id = section.id || slug(section.title);
			if (used.has(id)) id = `${id}-${number.replace(/\./g, '-')}`;
			used.add(id);
			return { ...section, id, number, sections: visit(section.sections, number) };
		});
	return visit(sections, '');
}

/** Every section, depth first. */
export function flatten(sections: Section[]): Section[] {
	return sections.flatMap((s) => [s, ...flatten(s.sections)]);
}

/** A doc comment as prose: continuation stars removed, paragraphs kept apart. */
export function cleanDoc(doc: string | null | undefined): string[] {
	if (!doc) return [];
	const lines = doc
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/^\s*\*(?!\/)\s?/, '').trimEnd());
	const paragraphs: string[] = [];
	let current: string[] = [];
	for (const line of lines) {
		if (!line.trim()) {
			if (current.length) paragraphs.push(current.join(' '));
			current = [];
		} else {
			current.push(line.trim());
		}
	}
	if (current.length) paragraphs.push(current.join(' '));
	return paragraphs.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** "21 October 2026". */
export function longDate(date: Date): string {
	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function percent(part: number, whole: number): string {
	return whole ? `${Math.round((part / whole) * 100)} %` : '–';
}

/** `n thing` / `n things`. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
	return `${n} ${n === 1 ? singular : plural}`;
}
