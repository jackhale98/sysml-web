/// <reference lib="webworker" />
/**
 * TEST BUILD (temporary, for trying the toolkit engine with ?toolkit): loads one SysML engine —
 * the Open-MBEE sysml-toolkit (`@sysml/wasm`, from `static/toolkit/`) or our
 * own (`static/engine/`) — in its own worker, and times every step the same
 * way for both, so the two can be compared in a real browser.
 *
 * Every reply carries absolute times (`performance.timeOrigin + now()`), so
 * the page can line them up with its own clock, and the size of the worker's
 * WebAssembly memory.
 */
import type { BenchBoot, BenchReply, BenchRequest, BootStats, FileText, StepStats } from './bench';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const scriptStart = abs();

function abs(): number {
	return performance.timeOrigin + performance.now();
}
const mib = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

/* ---------------- toolkit types (subset of sysmlv2.d.ts) ---------------- */
interface TkElement {
	free(): void;
}
interface TkSettled {
	free(): void;
}
interface TkSession {
	free(): void;
	check(): string;
	settledOutcomes(): TkSettled | undefined;
	outline(opts?: string | null): string;
	rows(ids: string, fields: string): string;
	unresolvedCount(): number;
	resolve(q: string): TkElement | undefined;
}
interface TkLibrary {
	free(): void;
}
interface TkLsp {
	handle(msg: string): string[];
	setWorkspace(sources: string): string[];
}
interface Toolkit {
	default(options: { module_or_path: WebAssembly.Module }): Promise<{ memory: WebAssembly.Memory }>;
	version(): string;
	PreparedLibrary: {
		new (bundle: string, snapshot?: Uint8Array | null): TkLibrary;
		fromSnapshot(
			s: Uint8Array,
			bundle: string,
			rec?: Uint8Array | null,
			keep?: boolean | null
		): TkLibrary;
		fromSnapshotStream(
			s: Uint8Array,
			bundle: string,
			rec?: Uint8Array | null,
			keep?: boolean | null
		): TkLibrary;
	};
	Session: {
		fromSourcesWithPreparedLibrary(sources: string, lib: TkLibrary): TkSession;
		fromSourcesSettled(sources: string, lib: TkLibrary, settled: TkSettled): TkSession;
	};
	LspServer: { withPreparedLibrary(lib: TkLibrary): TkLsp };
	lenientSources(sources: string): string;
}
/* ---------------- our engine (subset of engine.worker.ts) ---------------- */
interface Ours {
	default(options: { module_or_path: WebAssembly.Module }): Promise<{ memory: WebAssembly.Memory }>;
	version(): string;
	analyzeProject(files: string): string;
	listViews(files: string): string;
	stateMachines(files: string): string;
	hover(files: string, path: string, offset: number): string;
	definition(files: string, path: string, offset: number): string;
}

let memory: WebAssembly.Memory | undefined;
let boot: BenchBoot | undefined;
let tk: Toolkit | undefined;
let ours: Ours | undefined;
let library: TkLibrary | undefined;
let session: TkSession | undefined;
let settled: TkSettled | undefined;
let lsp: TkLsp | undefined;
let lspId = 1;
let files: FileText[] = [];

const memNow = () => (memory ? mib(memory.buffer.byteLength) : 0);

async function fetchBytes(url: string): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}
/** Undo gzip when the server sent the `.gz` file as it is (GitHub Pages);
 * `vite preview` sends it with `Content-Encoding: gzip`, so it arrives inflated. */
async function gunzipMaybe(bytes: Uint8Array): Promise<Uint8Array> {
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function resources(): BootStats['resources'] {
	return (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({
		name: r.name.replace(location.origin, ''),
		transferSize: r.transferSize,
		encodedBodySize: r.encodedBodySize,
		decodedBodySize: r.decodedBodySize,
		start: performance.timeOrigin + r.startTime,
		end: performance.timeOrigin + r.responseEnd
	}));
}

async function bootToolkit(b: BenchBoot): Promise<BootStats> {
	const steps: Record<string, StepStats> = {};
	const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
		const start = abs();
		const value = await fn();
		steps[name] = { start, end: abs(), ms: Math.round(abs() - start) };
		return value;
	};
	const variant = b.variant;
	// Everything downloads in parallel; the wasm compiles while it streams in.
	const wasmCompiled = step('wasmDownloadAndCompile', () =>
		WebAssembly.compileStreaming(fetch(b.wasmUrl))
	);
	const glue = step('glueImport', () => import(/* @vite-ignore */ b.glueUrl) as Promise<Toolkit>);
	const bundleBytes = step('bundleDownload', () => fetchBytes(b.lib.bundleUrl));
	const recording =
		variant === 'none' || variant === 'subset'
			? Promise.resolve(undefined)
			: step('libcacheDownload', () => fetchBytes(b.lib.libcacheUrl));
	const prepared = variant.startsWith('prepared')
		? step('preparedDownload', () => fetchBytes(b.lib.preparedUrl))
		: Promise.resolve(undefined);
	const module = await wasmCompiled;
	tk = await glue;
	const toolkit = tk;
	const out = await step('instantiate', () => toolkit.default({ module_or_path: module }));
	memory = out.memory;
	const memAfterInstantiate = memNow();
	const [bundleRaw, recRaw, prepRaw] = await Promise.all([bundleBytes, recording, prepared]);
	const decoded = await step('decompress', async () => ({
		bundle: new TextDecoder().decode(await gunzipMaybe(bundleRaw)),
		rec: recRaw ? await gunzipMaybe(recRaw) : undefined,
		prep: prepRaw ? await gunzipMaybe(prepRaw) : undefined
	}));
	let bundle = decoded.bundle;
	if (variant === 'subset' && b.lib.subset) {
		const keep = new Set(b.lib.subset);
		bundle = JSON.stringify(
			(JSON.parse(bundle) as { name: string; text: string }[]).filter((u) => keep.has(u.name))
		);
	}
	library = await step('libraryLoad', () => {
		if (variant === 'prepared')
			return toolkit.PreparedLibrary.fromSnapshot(decoded.prep!, bundle, decoded.rec);
		if (variant === 'prepared-stream')
			return toolkit.PreparedLibrary.fromSnapshotStream(decoded.prep!, bundle, decoded.rec);
		return new toolkit.PreparedLibrary(bundle, decoded.rec ?? null);
	});
	return {
		engine: 'toolkit',
		version: toolkit.version(),
		variant,
		scriptStart,
		steps,
		memAfterInstantiate,
		memAfterLibrary: memNow(),
		resources: resources()
	};
}

async function bootOurs(b: BenchBoot): Promise<BootStats> {
	const steps: Record<string, StepStats> = {};
	const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
		const start = abs();
		const value = await fn();
		steps[name] = { start, end: abs(), ms: Math.round(abs() - start) };
		return value;
	};
	const wasmCompiled = step('wasmDownloadAndCompile', () =>
		WebAssembly.compileStreaming(fetch(b.wasmUrl))
	);
	const glue = step('glueImport', () => import(/* @vite-ignore */ b.glueUrl) as Promise<Ours>);
	const module = await wasmCompiled;
	ours = await glue;
	const engine = ours;
	const out = await step('instantiate', () => engine.default({ module_or_path: module }));
	memory = out.memory;
	return {
		engine: 'ours',
		version: engine.version(),
		variant: 'embedded',
		scriptStart,
		steps,
		memAfterInstantiate: memNow(),
		memAfterLibrary: memNow(),
		resources: resources()
	};
}

const asSources = (list: FileText[]) =>
	JSON.stringify(list.map((f) => ({ name: f.path, text: f.text })));

/** One analysis of `files`, the way the app would run it on each change. */
function analyse(kind: 'first' | 'again'): Record<string, unknown> {
	const start = abs();
	if (tk && library) {
		const toolkit = tk;
		const lib = library;
		let src = asSources(files);
		// A unit that does not parse makes the session build throw: repair first.
		let lenientMs = 0;
		const build = (): TkSession => {
			const prev = settled;
			if (session) session.free();
			session = undefined;
			try {
				return prev
					? toolkit.Session.fromSourcesSettled(src, lib, prev)
					: toolkit.Session.fromSourcesWithPreparedLibrary(src, lib);
			} catch (error) {
				const t = abs();
				src = JSON.stringify(
					(JSON.parse(toolkit.lenientSources(src)) as { sources: unknown }).sources
				);
				lenientMs = Math.round(abs() - t);
				void error;
				return toolkit.Session.fromSourcesWithPreparedLibrary(src, lib);
			}
		};
		session = build();
		const built = abs();
		const findings = JSON.parse(session.check()) as { severity: string }[];
		const checked = abs();
		const next = session.settledOutcomes();
		settled?.free();
		settled = next;
		return {
			kind,
			ms: Math.round(checked - start),
			buildMs: Math.round(built - start),
			checkMs: Math.round(checked - built),
			lenientMs,
			findings: findings.length,
			errors: findings.filter((f) => f.severity === 'error').length,
			unresolved: session.unresolvedCount(),
			settled: !!settled,
			mem: memNow(),
			end: checked
		};
	}
	if (ours) {
		const json = JSON.stringify(files);
		const analyses = ours.analyzeProject(json);
		const analysed = abs();
		// The app also asks for the views and state machines after each analysis.
		ours.listViews(json);
		ours.stateMachines(json);
		const done = abs();
		const parsed = JSON.parse(analyses) as { diagnostics?: unknown[] }[];
		return {
			kind,
			ms: Math.round(analysed - start),
			withViewsAndMachinesMs: Math.round(done - start),
			findings: parsed.reduce((n, a) => n + (a.diagnostics?.length ?? 0), 0),
			modelJsonBytes: analyses.length,
			mem: memNow(),
			end: done
		};
	}
	throw new Error('not booted');
}

/** The app's model from the toolkit: outline + per-element rows with spans. */
function extract(): Record<string, unknown> {
	if (!session) throw new Error('no session');
	const start = abs();
	const outline = session.outline(
		JSON.stringify({ outlineNodes: 1, shapeNodes: 100000, shapeDepth: 64 })
	);
	const shape = (JSON.parse(outline) as { shape: { nodes: { id: string }[]; truncated: boolean } })
		.shape;
	const ids = JSON.stringify(shape.nodes.map((n) => n.id));
	const rows = session.rows(
		ids,
		JSON.stringify([
			'metaclass',
			'qualifiedName',
			'shortName',
			'owner',
			'declarationSite',
			'memberExtent',
			'valueSource',
			'docs'
		])
	);
	const end = abs();
	return {
		ms: Math.round(end - start),
		elements: shape.nodes.length,
		truncated: shape.truncated,
		bytes: outline.length + rows.length,
		mem: memNow()
	};
}

function lspCall(method: string, params: unknown, notify = false): unknown {
	const message: Record<string, unknown> = { jsonrpc: '2.0', method, params };
	if (!notify) message.id = lspId++;
	const out = lsp!
		.handle(JSON.stringify(message))
		.map((m) => JSON.parse(m) as { id?: number; result?: unknown });
	return notify ? undefined : out.find((m) => m.id === message.id)?.result;
}
const uri = (path: string) =>
	'file:///project/' + path.split('/').map(encodeURIComponent).join('/');
function position(text: string, offset: number) {
	const before = text.slice(0, offset).split('\n');
	return { line: before.length - 1, character: before[before.length - 1]!.length };
}

/** Editor round trips: hover and go-to-definition at one position. */
function navigate(path: string, offset: number): Record<string, unknown> {
	const file = files.find((f) => f.path === path);
	if (!file) throw new Error(`no file ${path}`);
	const result: Record<string, unknown> = {};
	if (tk && library) {
		let t = abs();
		if (!lsp) {
			lsp = tk.LspServer.withPreparedLibrary(library);
			lspCall('initialize', { capabilities: {}, rootUri: 'file:///project' });
			lspCall('initialized', {}, true);
			lsp.setWorkspace(JSON.stringify(files.map((f) => ({ name: uri(f.path), text: f.text }))));
			lspCall(
				'textDocument/didOpen',
				{ textDocument: { uri: uri(path), languageId: 'sysml', version: 1, text: file.text } },
				true
			);
			result.lspInitMs = Math.round(abs() - t);
			result.memAfterLspInit = memNow();
		}
		const at = { textDocument: { uri: uri(path) }, position: position(file.text, offset) };
		t = abs();
		const hover = lspCall('textDocument/hover', at);
		result.hoverMs = Math.round(abs() - t);
		t = abs();
		const definition = lspCall('textDocument/definition', at);
		result.definitionMs = Math.round(abs() - t);
		result.hover = JSON.stringify(hover)?.slice(0, 160);
		result.definition = JSON.stringify(definition)?.slice(0, 200);
	} else if (ours) {
		const json = JSON.stringify(files);
		let t = abs();
		result.hover = ours.hover(json, path, offset).slice(0, 160);
		result.hoverMs = Math.round(abs() - t);
		t = abs();
		result.definition = ours.definition(json, path, offset).slice(0, 200);
		result.definitionMs = Math.round(abs() - t);
	}
	result.mem = memNow();
	return result;
}

/** CPU calibration: a fixed amount of work, to see whether CPU throttling reaches the worker. */
function spin(): Record<string, unknown> {
	const start = performance.now();
	let x = 0;
	for (let i = 0; i < 2e8; i++) x = (x + i * 7) % 1000003;
	return { ms: Math.round(performance.now() - start), x };
}

scope.onmessage = async (event: MessageEvent<BenchRequest>) => {
	const { id, op } = event.data;
	let reply: BenchReply;
	try {
		let result: unknown;
		if (op === 'boot') {
			boot = event.data.boot;
			result = boot.engine === 'toolkit' ? await bootToolkit(boot) : await bootOurs(boot);
		} else if (op === 'analyze') {
			files = event.data.files;
			result = analyse('first');
		} else if (op === 'edit') {
			const { path, text } = event.data;
			files = files.map((f) => (f.path === path ? { path, text } : f));
			result = analyse('again');
		} else if (op === 'extract') result = extract();
		else if (op === 'navigate') result = navigate(event.data.path, event.data.offset);
		else if (op === 'mem') result = { mem: memNow() };
		else if (op === 'spin') result = spin();
		else throw new Error(`unknown op ${String(op)}`);
		reply = { id, ok: true, result, at: abs() };
	} catch (error) {
		reply = { id, ok: false, error: String(error), at: abs() };
	}
	scope.postMessage(reply);
};
