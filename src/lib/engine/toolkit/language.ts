/**
 * Editor language services from the toolkit's in-wasm language server
 * (`LspServer`, LSP over strings, UTF-16 positions), answered in the shapes
 * of the app's `EngineApi` so `src/lib/editor/language.ts` stays as it is:
 * completion, hover, definition, references, rename, outline and code
 * actions from the server that sees the project and the standard library;
 * highlighting from a second, syntax-only server; formatting from
 * `formatSource`. Whole-document answers become minimal changes (`diff.ts`).
 */
import type { SourceFile } from '../protocol';
import type {
	CodeAction,
	Completion,
	DefinitionTarget,
	Diagnostic,
	FileChange,
	FileRange,
	Highlights,
	Hover,
	OutlineItem
} from '../types';
import type { TkLibrary, TkLspServer, Toolkit } from './api';
import { diffTexts } from './diff';
import { TextIndex, type Position } from './offsets';

interface LspRange {
	start: Position;
	end: Position;
}
interface LspTextEdit {
	range: LspRange;
	newText: string;
}
interface LspLocation {
	uri: string;
	range: LspRange;
}
interface LspWorkspaceEdit {
	changes?: Record<string, LspTextEdit[]>;
	documentChanges?: { textDocument: { uri: string }; edits: LspTextEdit[] }[];
}
interface LspCompletionItem {
	label: string;
	kind?: number;
	detail?: string;
	documentation?: string | { value: string };
	insertText?: string;
	insertTextFormat?: number;
	textEdit?: LspTextEdit | { newText: string; insert: LspRange; replace: LspRange };
	sortText?: string;
}
interface LspSymbol {
	name: string;
	kind: number;
	detail?: string;
	range: LspRange;
	selectionRange: LspRange;
	children?: LspSymbol[];
}
interface LspCodeAction {
	title: string;
	kind?: string;
	diagnostics?: { code?: string | number }[];
	edit?: LspWorkspaceEdit;
}
interface LspResponse {
	id?: number;
	result?: unknown;
	error?: { message: string };
}

const ROOT = 'file:///project/';
const LIBRARY = 'sysmlv2-lib:/';
const uriOf = (path: string) => ROOT + path.split('/').map(encodeURIComponent).join('/');
const pathOf = (uri: string) =>
	uri.startsWith(ROOT) ? uri.slice(ROOT.length).split('/').map(decodeURIComponent).join('/') : null;
const libraryPathOf = (uri: string) =>
	uri.startsWith(LIBRARY) ? decodeURIComponent(uri.slice(LIBRARY.length)) : null;

/** A language server and the requests it answers. */
class Server {
	private readonly lsp: TkLspServer;
	private nextId = 1;

	constructor(lsp: TkLspServer) {
		this.lsp = lsp;
		this.request('initialize', {
			processId: null,
			rootUri: ROOT,
			capabilities: {
				general: { positionEncodings: ['utf-16'] },
				textDocument: {
					completion: { completionItem: { snippetSupport: true } },
					semanticTokens: {
						requests: { full: true },
						tokenTypes: [],
						tokenModifiers: [],
						formats: ['relative']
					}
				}
			}
		});
		this.notify('initialized', {});
	}

	request<T>(method: string, params: unknown): T | null {
		const id = this.nextId++;
		const replies = this.lsp
			.handle(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
			.map((m) => JSON.parse(m) as LspResponse);
		const reply = replies.find((r) => r.id === id);
		if (reply?.error) throw new Error(reply.error.message);
		return (reply?.result as T | undefined) ?? null;
	}

	notify(method: string, params: unknown) {
		this.lsp.handle(JSON.stringify({ jsonrpc: '2.0', method, params }));
	}

	setWorkspace(files: SourceFile[]) {
		this.lsp.setWorkspace(
			JSON.stringify(files.map((f) => ({ name: uriOf(f.path), text: f.text })))
		);
	}

	free() {
		this.lsp.free();
	}
}

export class LanguageServices {
	private readonly tk: Toolkit;
	private readonly library: TkLibrary;
	private server: Server | null = null;
	/** What the server was last given: the workspace, and the documents opened in it. */
	private workspace = new Map<string, string>();
	private readonly open = new Map<string, { text: string; version: number }>();

	constructor(tk: Toolkit, library: TkLibrary) {
		this.tk = tk;
		this.library = library;
	}

	/** Bring the server up to date with the project, with `path` open in it. */
	private sync(files: SourceFile[], path: string): { server: Server; text: TextIndex } {
		this.server ??= new Server(this.tk.LspServer.withPreparedLibrary(this.library));
		const server = this.server;
		const stale =
			files.length !== this.workspace.size ||
			files.some((f) => !this.open.has(f.path) && this.workspace.get(f.path) !== f.text);
		if (stale) {
			server.setWorkspace(files);
			this.workspace = new Map(files.map((f) => [f.path, f.text]));
		}
		for (const [openPath, doc] of this.open) {
			const file = files.find((f) => f.path === openPath);
			if (!file) {
				server.notify('textDocument/didClose', { textDocument: { uri: uriOf(openPath) } });
				this.open.delete(openPath);
			} else if (file.text !== doc.text) {
				doc.text = file.text;
				doc.version++;
				server.notify('textDocument/didChange', {
					textDocument: { uri: uriOf(openPath), version: doc.version },
					contentChanges: [{ text: file.text }]
				});
			}
		}
		const file = files.find((f) => f.path === path);
		if (!file) throw new Error(`${path} is not in the project`);
		if (!this.open.has(path)) {
			this.open.set(path, { text: file.text, version: 1 });
			server.notify('textDocument/didOpen', {
				textDocument: {
					uri: uriOf(path),
					languageId: path.endsWith('.kerml') ? 'kerml' : 'sysml',
					version: 1,
					text: file.text
				}
			});
		}
		return { server, text: new TextIndex(file.text) };
	}

	complete(files: SourceFile[], path: string, offset: number): Completion {
		const { server, text } = this.sync(files, path);
		const result = server.request<LspCompletionItem[] | { items: LspCompletionItem[] }>(
			'textDocument/completion',
			{ textDocument: { uri: uriOf(path) }, position: text.offsetToPosition(offset) }
		);
		const items = (Array.isArray(result) ? result : (result?.items ?? [])).slice();
		// The word being typed is what a completion replaces.
		let from = offset - (/[\w']*$/.exec(text.text.slice(0, offset))?.[0].length ?? 0);
		let to = offset;
		const edit = items.find((i) => i.textEdit)?.textEdit;
		if (edit) {
			const range = 'range' in edit ? edit.range : edit.replace;
			from = text.positionToOffset(range.start);
			to = Math.max(offset, text.positionToOffset(range.end));
		}
		items.sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label));
		return {
			from,
			to,
			items: items.map((item) => {
				const insert = item.textEdit?.newText ?? item.insertText;
				const doc =
					typeof item.documentation === 'string' ? item.documentation : item.documentation?.value;
				return {
					label: item.label,
					kind: completionKind(item.kind),
					...(item.detail ? { detail: item.detail } : {}),
					...(doc ? { documentation: doc } : {}),
					...(insert && insert !== item.label ? { insertText: insert } : {}),
					...(item.insertTextFormat === 2 ? { isSnippet: true } : {})
				};
			})
		};
	}

	hover(files: SourceFile[], path: string, offset: number): Hover | null {
		const { server, text } = this.sync(files, path);
		const result = server.request<{
			contents: string | { value: string } | (string | { value: string })[];
			range?: LspRange;
		}>('textDocument/hover', {
			textDocument: { uri: uriOf(path) },
			position: text.offsetToPosition(offset)
		});
		if (!result) return null;
		const parts = Array.isArray(result.contents) ? result.contents : [result.contents];
		const markdown = parts.map((p) => (typeof p === 'string' ? p : p.value)).join('\n\n');
		if (!markdown.trim()) return null;
		return {
			from: result.range ? text.positionToOffset(result.range.start) : offset,
			to: result.range ? text.positionToOffset(result.range.end) : offset,
			markdown
		};
	}

	definition(files: SourceFile[], path: string, offset: number): DefinitionTarget | null {
		const { server, text } = this.sync(files, path);
		const result = server.request<
			LspLocation | LspLocation[] | { targetUri: string; targetSelectionRange: LspRange }[]
		>('textDocument/definition', {
			textDocument: { uri: uriOf(path) },
			position: text.offsetToPosition(offset)
		});
		const first = Array.isArray(result) ? result[0] : result;
		if (!first) return null;
		const location: LspLocation =
			'targetUri' in first ? { uri: first.targetUri, range: first.targetSelectionRange } : first;
		const library = libraryPathOf(location.uri);
		if (library) return { library: { path: library, line: location.range.start.line + 1 } };
		const target = pathOf(location.uri);
		const file = target ? files.find((f) => f.path === target) : undefined;
		if (!target || !file) return null;
		const index = new TextIndex(file.text);
		return {
			path: target,
			from: index.positionToOffset(location.range.start),
			to: index.positionToOffset(location.range.end)
		};
	}

	references(files: SourceFile[], path: string, offset: number): FileRange[] {
		const { server, text } = this.sync(files, path);
		const result =
			server.request<LspLocation[]>('textDocument/references', {
				textDocument: { uri: uriOf(path) },
				position: text.offsetToPosition(offset),
				context: { includeDeclaration: true }
			}) ?? [];
		const out: FileRange[] = [];
		const indexes = new Map<string, TextIndex>();
		for (const location of result) {
			const target = pathOf(location.uri);
			const file = target ? files.find((f) => f.path === target) : undefined;
			if (!target || !file) continue;
			let index = indexes.get(target);
			if (!index) indexes.set(target, (index = new TextIndex(file.text)));
			const from = index.positionToOffset(location.range.start);
			const to = index.positionToOffset(location.range.end);
			if (!out.some((r) => r.path === target && r.from === from))
				out.push({ path: target, from, to });
		}
		return out;
	}

	rename(
		files: SourceFile[],
		path: string,
		offset: number,
		newName: string
	): { changes: FileChange[] } | { error: string } {
		const { server, text } = this.sync(files, path);
		let result: LspWorkspaceEdit | null;
		try {
			result = server.request<LspWorkspaceEdit>('textDocument/rename', {
				textDocument: { uri: uriOf(path) },
				position: text.offsetToPosition(offset),
				newName
			});
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
		if (!result) return { error: 'There is nothing to rename here.' };
		return { changes: workspaceChanges(result, files) };
	}

	outline(files: SourceFile[], path: string): OutlineItem[] {
		const { server, text } = this.sync(files, path);
		const result =
			server.request<LspSymbol[]>('textDocument/documentSymbol', {
				textDocument: { uri: uriOf(path) }
			}) ?? [];
		const convert = (s: LspSymbol): OutlineItem => ({
			name: s.name,
			kind: SYMBOL_KINDS[s.kind] ?? 'element',
			...(s.detail ? { detail: s.detail } : {}),
			from: text.positionToOffset(s.range.start),
			to: text.positionToOffset(s.range.end),
			selectionFrom: text.positionToOffset(s.selectionRange.start),
			selectionTo: text.positionToOffset(s.selectionRange.end),
			children: (s.children ?? []).map(convert)
		});
		return result.map(convert);
	}

	/** Fixes for the range, given the problems the analysis found in the file. */
	codeActions(
		files: SourceFile[],
		path: string,
		from: number,
		to: number,
		diagnostics: Diagnostic[]
	): CodeAction[] {
		const { server, text } = this.sync(files, path);
		const near = diagnostics.filter(
			(d) => d.span.from !== undefined && d.span.from <= to && (d.span.to ?? d.span.from) >= from
		);
		const range = { start: text.offsetToPosition(from), end: text.offsetToPosition(to) };
		const result =
			server.request<(LspCodeAction | { command: string })[]>('textDocument/codeAction', {
				textDocument: { uri: uriOf(path) },
				range,
				context: {
					diagnostics: near.map((d) => ({
						range: {
							start: text.offsetToPosition(d.span.from!),
							end: text.offsetToPosition(d.span.to ?? d.span.from!)
						},
						severity: d.severity === 'error' ? 1 : d.severity === 'warning' ? 2 : 3,
						code: d.code,
						source: 'sysmlv2',
						message: d.message
					}))
				}
			}) ?? [];
		return result
			.filter((a): a is LspCodeAction => 'title' in a && !!a.edit)
			.map((action) => {
				const code = action.diagnostics?.[0]?.code;
				return {
					title: action.title,
					...(code !== undefined ? { diagnosticCode: String(code) } : {}),
					changes: workspaceChanges(action.edit!, files)
				};
			})
			.filter((a) => a.changes.length);
	}

	free() {
		this.server?.free();
		this.server = null;
		this.open.clear();
		this.workspace.clear();
	}
}

/**
 * What needs no library and no project — highlighting and formatting — so
 * the worker can answer it while the standard library is still loading.
 */
export class SyntaxServices {
	private readonly tk: Toolkit;
	private highlighter: Server | null = null;
	private highlightVersion = 0;

	constructor(tk: Toolkit) {
		this.tk = tk;
	}

	/** Semantic highlighting for any text, from a server without the project. */
	highlight(source: string): Highlights {
		this.highlighter ??= new Server(new this.tk.LspServer());
		const uri = 'file:///scratch/highlight.sysml';
		const version = ++this.highlightVersion;
		if (version === 1)
			this.highlighter.notify('textDocument/didOpen', {
				textDocument: { uri, languageId: 'sysml', version, text: source }
			});
		else
			this.highlighter.notify('textDocument/didChange', {
				textDocument: { uri, version },
				contentChanges: [{ text: source }]
			});
		const result = this.highlighter.request<{ data: number[] }>(
			'textDocument/semanticTokens/full',
			{
				textDocument: { uri }
			}
		);
		return decodeTokens(result?.data ?? [], new TextIndex(source));
	}

	/** Canonical formatting; nothing to change while the text doesn't parse. */
	format(source: string): { changes: { from: number; to: number; insert: string }[] } {
		try {
			return { changes: diffTexts(source, this.tk.formatSource(source, FORMAT_CONFIG)) };
		} catch {
			return { changes: [] };
		}
	}
}

/** The formatter's settings (a `sysmlint.json`): four spaces, as the app writes SysML. */
const FORMAT_CONFIG = JSON.stringify({ rules: { indentation: { style: 'spaces', size: 4 } } });

/** A workspace edit as minimal changes per project file. */
function workspaceChanges(edit: LspWorkspaceEdit, files: SourceFile[]): FileChange[] {
	const byUri: [string, LspTextEdit[]][] = [
		...Object.entries(edit.changes ?? {}),
		...(edit.documentChanges ?? []).map((d): [string, LspTextEdit[]] => [
			d.textDocument.uri,
			d.edits
		])
	];
	const out: FileChange[] = [];
	for (const [uri, edits] of byUri) {
		const path = pathOf(uri);
		const file = path ? files.find((f) => f.path === path) : undefined;
		if (!path || !file) continue;
		const index = new TextIndex(file.text);
		let after = file.text;
		const positioned = edits
			.map((e) => ({
				from: index.positionToOffset(e.range.start),
				to: index.positionToOffset(e.range.end),
				insert: e.newText
			}))
			.sort((a, b) => b.from - a.from);
		for (const e of positioned) after = after.slice(0, e.from) + e.insert + after.slice(e.to);
		for (const change of diffTexts(file.text, after)) out.push({ path, ...change });
	}
	return out;
}

/** LSP completion kinds as the app's. */
function completionKind(kind: number | undefined): string {
	switch (kind) {
		case 14:
			return 'keyword';
		case 15:
			return 'snippet';
		case 9:
		case 19:
			return 'package';
		case 7:
		case 8:
		case 13:
		case 22:
		case 25:
			return 'definition';
		default:
			return 'usage';
	}
}

const SYMBOL_KINDS: Record<number, string> = {
	2: 'package',
	3: 'package',
	4: 'package',
	5: 'definition',
	7: 'usage',
	8: 'usage',
	10: 'enum',
	11: 'interface',
	12: 'action',
	13: 'usage',
	14: 'usage',
	22: 'enum',
	23: 'definition'
};

/** The server's token types (its legend) as the editor's highlight names. */
const TOKEN_NAMES = [
	'module',
	'type',
	'variable',
	'variable',
	'constant.builtin',
	'keyword',
	'comment',
	'string',
	'number'
];
const NAMES = [...new Set([...TOKEN_NAMES, 'type.definition', 'comment.documentation'])];

/** LSP relative tokens → `[from, to, nameIndex, …]` in UTF-16 offsets. */
export function decodeTokens(data: number[], text: TextIndex): Highlights {
	const spans: number[] = [];
	let line = 0;
	let character = 0;
	let documentation = false;
	for (let i = 0; i + 4 < data.length; i += 5) {
		const deltaLine = data[i]!;
		line += deltaLine;
		character = deltaLine ? data[i + 1]! : character + data[i + 1]!;
		const from = text.positionToOffset({ line, character });
		const to = Math.min(from + data[i + 2]!, text.text.length);
		let name = TOKEN_NAMES[data[i + 3]!];
		if (!name) continue;
		const declaration = (data[i + 4]! & 1) === 1;
		if (name === 'type' && declaration) name = 'type.definition';
		// A comment right after `doc` (and the rest of that comment's lines) is documentation.
		if (name === 'comment') {
			const before = text.text.slice(0, from).trimEnd();
			if (/\bdoc$/.test(before) || (documentation && !/\*\/\s*$/.test(before))) {
				name = 'comment.documentation';
				documentation = true;
			} else documentation = false;
		} else documentation = false;
		spans.push(from, to, NAMES.indexOf(name));
	}
	return { names: NAMES, spans };
}
