/**
 * The part of the sysml-toolkit wasm API (`@sysml/wasm`, `static/toolkit/sysmlv2.js`)
 * the app uses, typed by hand from the release's `sysmlv2.d.ts` (the package
 * is fetched at build time, so its declarations are not in the repository).
 * Offsets the toolkit returns are UTF-8 bytes unless noted; see `offsets.ts`.
 */

/** A handle to one element of a session's model; stale once the session is rebuilt. */
export interface TkElement {
	free(): void;
}

export interface TkSettledOutcomes {
	free(): void;
}

export interface TkLibrary {
	free(): void;
}

export interface TkSession {
	free(): void;
	/** Findings, JSON `TkFinding[]` (no parse stage: the session holds only units that parsed). */
	check(): string;
	settledOutcomes(): TkSettledOutcomes | undefined;
	/** JSON `[{unit, name, text}]` for the user units. */
	units(): string;
	roots(): TkElement[];
	members(e: TkElement): TkElement[];
	elementId(e: TkElement): string;
	elementById(id: string): TkElement | undefined;
	elementsOfMetaclass(metaclass: string): TkElement[];
	resolve(qualifiedName: string): TkElement | undefined;
	metaclass(e: TkElement): string;
	name(e: TkElement): string | undefined;
	qualifiedName(e: TkElement): string | undefined;
	isLibraryElement(e: TkElement): boolean;
	/** Per-element reads for many ids at once (see `rows` in the d.ts). */
	rows(idsJson: string, fieldsJson: string): string;
	derived(e: TkElement, name: string): string;
	derivedElements(e: TkElement, name: string): TkElement[];
	annotatedElements(e: TkElement): TkElement[];
	typings(e: TkElement): TkElement[];
	minimalSpelling(context: TkElement, target: TkElement): string | undefined;
	/** The feature `e` stands for through its redefinitions (or `e` itself). */
	redefinitionRoot(e: TkElement): TkElement;
	/** The structured diagram graph of a view, JSON. */
	toGraph(optionsJson?: string | null): string;
	referenceSpelling(e: TkElement): string | undefined;
	unresolvedCount(): number;
	// Edits (`edits.ts`): ops JSON `[{op, target, …}]`; splices are bytes per unit name.
	/** Apply an edit batch; JSON `{idMap, findings, splices}`. Throws the refusal; the session is rebuilt. */
	edit(opsJson: string): string;
	/** Dry-run an edit batch: JSON `{wouldCommit, refusal?, idMap?, findings?, splices?}`. */
	checkEdit(opsJson: string): string;
	/** JSON `TkSite` of the whole member declaration, or undefined. */
	memberExtent(e: TkElement): string | undefined;
	/** JSON `{declaration, references: [{unit, line, col, kind, owner: {id, qualifiedName} | null}]}`. */
	references(selectorJson: string): string;
	/** The abstract-syntax property `name` of `e`, as JSON. */
	property(e: TkElement, name: string): string;
	/** `e`'s bound value, evaluated, as JSON. */
	evaluate(e: TkElement): string;
	/** Whether `e` reaches `general` through its specializations. */
	conforms(e: TkElement, general: TkElement): boolean;
	/** JSON `{qualifiedName, id, rendering, exposed: [{id, qualifiedName, metaclass}], …}` of a view usage. */
	viewInfo(qualifiedName: string): string;
}

export interface TkLspServer {
	free(): void;
	handle(message: string): string[];
	setWorkspace(sourcesJson: string): string[];
}

/** The module's exports (after `default()` has instantiated it). */
export interface Toolkit {
	default(options: { module_or_path: WebAssembly.Module | BufferSource }): Promise<{
		memory: WebAssembly.Memory;
	}>;
	version(): string;
	install_panic_hook?(): void;
	PreparedLibrary: {
		new (bundleJson: string, snapshot?: Uint8Array | null): TkLibrary;
		fromSnapshotStream(
			view: Uint8Array,
			bundleJson: string,
			recording?: Uint8Array | null,
			keepHostParts?: boolean | null
		): TkLibrary;
	};
	Session: {
		fromSourcesWithPreparedLibrary(sourcesJson: string, library: TkLibrary): TkSession;
		fromSourcesSettled(
			sourcesJson: string,
			library: TkLibrary,
			settled: TkSettledOutcomes
		): TkSession;
	};
	LspServer: {
		/** A server for the syntax tier only (no standard library). */
		new (): TkLspServer;
		withPreparedLibrary(library: TkLibrary): TkLspServer;
	};
	/** Parse and context findings only, JSON `TkFinding[]` (byte columns). */
	checkSyntax(sourcesJson: string): string;
	/** JSON `TkLenient`. */
	lenientSources(sourcesJson: string): string;
	/** JSON `{spelling, quoted}`. */
	canonicalName(name: string, dialect?: string | null): string;
	formatSource(text: string, configJson?: string | null): string;
}

/** A source unit as the toolkit takes it. */
export interface TkSource {
	name: string;
	text: string;
}

export interface TkFinding {
	severity: 'error' | 'warning' | 'info' | 'hint' | string;
	stage: 'parse' | 'context' | 'referential' | 'semantic' | string;
	message: string;
	unit: string;
	/** 1-based; columns in bytes; the end is exclusive. */
	line: number;
	col: number;
	endLine: number;
	endCol: number;
}

export interface TkDropped {
	unit: string;
	/** Byte offsets in the original text. */
	start: number;
	end: number;
	line: number;
	col: number;
	endLine: number;
	endCol: number;
	text: string;
	/** Closers appended at the end of the unit (then `text` is empty). */
	inserted: string;
	/** With `wholeLines`, how many whole lines were removed from `line` on. */
	linesRemoved: number;
	wholeLines: boolean;
	message: string;
}

export interface TkLenient {
	sources: TkSource[];
	dropped: TkDropped[];
	unrepaired: { unit: string; line: number; col: number; message: string }[];
}

/** `{unit, start, end}`: a byte range in a user unit (`unit` indexes `units()`). */
export interface TkSite {
	unit: number;
	start: number;
	end: number;
}

/** An element reference in `rows` / `derived` JSON. */
export interface TkRef {
	'@id': string;
}
