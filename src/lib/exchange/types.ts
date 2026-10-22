/** What the engine answers for model exchange (`#lib/engine/toolkit/interchange.ts`). */
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
