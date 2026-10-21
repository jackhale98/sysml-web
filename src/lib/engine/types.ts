/**
 * JSON shapes returned by the SysML engine (`sysml-wasm`).
 *
 * These mirror `sysml-core`'s serialized `Model` and `Diagnostic`. Only the
 * fields the app reads are typed; the engine may send more.
 */

export interface Span {
	/** 1-based line of the first character. */
	start_row: number;
	/** 1-based column of the first character. */
	start_col: number;
	end_row: number;
	end_col: number;
	start_byte: number;
	end_byte: number;
}

export interface Definition {
	kind: string;
	name: string;
	super_type: string | null;
	span: Span;
	parent_def?: string;
	short_name?: string;
	doc?: string;
}

export interface Usage {
	kind: string;
	name: string;
	type_ref: string | null;
	span: Span;
	parent_def?: string;
	short_name?: string;
	doc?: string;
	value_expr?: string;
	redefinition?: string;
	multiplicity?: string;
}

/** A `satisfy … by …` or a `verify` inside a verification case. */
export interface TraceLink {
	requirement: string;
	by: string;
	span: Span;
}

export interface MetadataAnnotation {
	metadata_type: string;
	/** `[field, value expression]` pairs, values as written in the source. */
	values: [string, string][];
	target: string;
	span: Span;
}

export interface SyntaxError {
	message: string;
	span: Span;
}

export interface Model {
	file: string;
	definitions: Definition[];
	usages: Usage[];
	satisfactions: TraceLink[];
	verifications: TraceLink[];
	annotations?: MetadataAnnotation[];
	syntax_errors: SyntaxError[];
}

export type Severity = 'error' | 'warning' | 'note';

export interface Diagnostic {
	file: string;
	span: Span;
	severity: Severity;
	code: string;
	message: string;
	explanation?: string;
	suggestion?: string;
}

/** Result of `analyze(path, source)`. */
export interface Analysis {
	model: Model;
	diagnostics: Diagnostic[];
}
