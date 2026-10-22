/** What the engine answers for model exchange (`#lib/engine/toolkit/interchange.ts`). */
import type { ElementJson } from './elements';
import type { SourceFile } from '#lib/engine/protocol.ts';

export interface InterchangeExportOptions {
	/** Every property, derived ones too, and implied relationships (the OMG schema's full form). */
	derived?: boolean;
	/** The standard library's elements too, so every reference resolves within the file. */
	library?: boolean;
}

export interface InterchangeExport {
	/** The element array, as JSON text. */
	json: string;
	/** Elements of the model. */
	elements: number;
	/** Standard library elements included (with `library`). */
	libraryElements: number;
	/** References from the model to standard library elements. */
	libraryReferences: number;
	/** References that resolve to nothing in the text, left out of the file. */
	leftOut: { element: string; reference: string }[];
	/** Files with syntax errors: what parsed of them is in the file. */
	broken: string[];
	/** References still unresolved after the export (0 unless something is wrong). */
	dangling: number;
}

/** Something an import could not carry over into the text, or changed. */
export interface ImportNote {
	kind: 'left-out' | 'library' | 'implied' | 'changed' | 'added' | 'warning' | 'repaired';
	/** Plain words. */
	message: string;
	/** What it is about: a qualified name, or the element's type and id. */
	element?: string;
}

/** A problem the imported text has, as the engine reports it. */
export interface ImportProblem {
	file: string;
	line: number;
	severity: 'error' | 'warning' | 'info';
	message: string;
}

export interface InterchangeImport {
	files: SourceFile[];
	/** Elements in the file (all of them). */
	elements: number;
	/** Elements now in the text. */
	carried: number;
	notes: ImportNote[];
	problems: ImportProblem[];
}

/** A file as a merge from the server leaves it. */
export interface WovenFile {
	path: string;
	/** The new text ('' for a removed file). */
	text: string;
	status: 'changed' | 'added' | 'removed';
}

/** The project's files with a merged model brought in (`#lib/engine/toolkit/weave.ts`). */
export interface WeaveResult {
	files: WovenFile[];
	/**
	 * Declarations written again from the merged model (`element` null: the
	 * whole file), with how many notes (`//`) they had: those are not kept.
	 */
	rewritten: { path: string; element: string | null; notes: number }[];
	/** What the files still say differently from the merged model, in words (empty: nothing). */
	differences: string[];
}

/** What a merge with a server works from, in one form (`#lib/exchange/merge.ts`). */
export interface MergeInputs {
	/** The project, exported. */
	ours: ElementJson[];
	/** The server's version the project was opened from or last saved to. */
	base: ElementJson[];
	/** The branch's head. */
	theirs: ElementJson[];
	/** Qualified names of what they refer to outside themselves, by id (the standard library). */
	names: Record<string, string>;
	/** Files with syntax errors. */
	broken: string[];
}
