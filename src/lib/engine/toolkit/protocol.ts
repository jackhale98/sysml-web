/**
 * Messages between the page and the toolkit worker. Calls reuse the app's
 * engine protocol (`{id, method, params}` for an `EngineApi` method the
 * toolkit implements); the rest are the worker's own.
 */
import type { EngineApi } from '../protocol';

/** The `EngineApi` methods the toolkit implements (the composite routes them here). */
export const TOOLKIT_METHODS = [
	'version',
	'analyze',
	'analyzeProject',
	'elementDetails'
] as const satisfies readonly (keyof EngineApi)[];

export type ToolkitMethod = (typeof TOOLKIT_METHODS)[number];

/** First message: where the toolkit's files are. */
export interface ToolkitInit {
	type: 'init';
	glueUrl: string;
	wasmUrl: string;
	/** The standard library sources (`sysml-library.json.gz`). */
	bundleUrl: string;
	/** The prepared library snapshot, used once it is in `snapshotCache`. */
	preparedUrl: string;
	/** The release, so a snapshot of another release is never used. */
	version: string;
	/** Cache Storage name for the snapshot. */
	snapshotCache: string;
}

/** Fetch the prepared snapshot into Cache Storage for later starts (sent when the page is idle). */
export interface ToolkitPrefetch {
	type: 'prefetch';
}

export interface ToolkitCall<M extends ToolkitMethod = ToolkitMethod> {
	type: 'call';
	id: number;
	method: M;
	params: Parameters<EngineApi[M]>;
}

export type ToolkitInbound = ToolkitInit | ToolkitPrefetch | ToolkitCall;

export interface ToolkitStats {
	version: string;
	/** Worker start → library loaded, ms. */
	bootMs: number;
	/** Library from the prepared snapshot (a later visit) or from source (first visit). */
	library: 'snapshot' | 'source';
	libraryMs: number;
	/** WebAssembly memory, MiB. */
	memoryMiB: number;
}

export type ToolkitOutbound =
	| { type: 'ready'; stats: ToolkitStats }
	/** Booting failed, or the instance trapped: the worker can't be used again. */
	| { type: 'fatal'; error: string }
	| { type: 'result'; id: number; ok: true; result: unknown }
	| { type: 'result'; id: number; ok: false; error: string; fatal?: boolean }
	| { type: 'prefetched'; cached: boolean; error?: string };
