/**
 * SysML language services in the text editor, answered by the engine (the
 * same logic as the SysML language server): completion with snippets,
 * hover documentation, go to definition, find references, rename, format
 * and quick fixes. Offsets are UTF-16, like CodeMirror's.
 */
import {
	autocompletion,
	snippet,
	type Completion as CmCompletion,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
	EditorView,
	hoverTooltip,
	keymap,
	showPanel,
	showTooltip,
	type Panel,
	type Tooltip
} from '@codemirror/view';
import type { Engine } from '#lib/engine/client.ts';
import type { CodeAction, DefinitionTarget, FileChange, FileRange } from '#lib/engine/types.ts';
import { parseBlocks, type Inline } from '#lib/markdown/markdown.ts';

export interface LanguageContext {
	engine: Engine;
	/** The file this editor shows. */
	path: string;
	/** The whole project, as the engine expects it. */
	files(): { path: string; text: string }[];
	/** Open a definition: a project file range, or a library line. */
	goto(target: DefinitionTarget): void;
	/** Apply changes across files as one undoable step. */
	applyChanges(label: string, changes: FileChange[]): Promise<void>;
}

// --- Completion -------------------------------------------------------------

const KIND_TYPE: Record<string, string> = {
	keyword: 'keyword',
	definition: 'class',
	usage: 'property',
	package: 'namespace',
	library: 'type',
	snippet: 'text'
};

/** `${1:Name}` and `$0` (LSP) as CodeMirror snippet fields. */
export function toSnippet(text: string): string {
	return text.replace(/\$0/g, '${}').replace(/\$(\d+)(?!\{)/g, '${$1}');
}

function completionSource(ctx: LanguageContext) {
	return async (context: CompletionContext): Promise<CompletionResult | null> => {
		const word = context.matchBefore(/[\w']*$/);
		const after = context.state.sliceDoc(Math.max(0, context.pos - 2), context.pos);
		// Ask while typing a name, after `:`/`:>`/`::`/`.`, or when explicitly asked.
		if (!context.explicit && !word?.text && !/[:.>]\s?$/.test(after)) return null;
		const files = ctx
			.files()
			.map((f) => (f.path === ctx.path ? { path: f.path, text: context.state.doc.toString() } : f));
		const result = await ctx.engine.complete(files, ctx.path, context.pos);
		if (context.aborted || !result.items.length) return null;
		const options: CmCompletion[] = result.items.map((item) => {
			const base: CmCompletion = {
				label: item.label,
				type: KIND_TYPE[item.kind] ?? 'variable',
				detail: item.detail,
				info: item.documentation,
				boost: item.kind === 'keyword' ? -1 : item.kind === 'library' ? -2 : 0
			};
			if (item.isSnippet && item.insertText) {
				return { ...base, apply: snippet(toSnippet(item.insertText)) };
			}
			return item.insertText ? { ...base, apply: item.insertText } : base;
		});
		return { from: result.from, to: result.to, options, validFor: /^[\w']*$/ };
	};
}

// --- Hover ------------------------------------------------------------------

function renderInline(nodes: Inline[], into: HTMLElement) {
	for (const node of nodes) {
		if (node.type === 'text') into.append(node.text);
		else if (node.type === 'code') {
			const code = document.createElement('code');
			code.textContent = node.text;
			into.append(code);
		} else {
			const el = document.createElement(
				node.type === 'strong' ? 'strong' : node.type === 'em' ? 'em' : 'span'
			);
			renderInline(node.children, el);
			into.append(el);
		}
	}
}

/** Markdown from the engine as DOM, built from tokens (never as HTML). */
export function renderMarkdown(markdown: string): HTMLElement {
	const root = document.createElement('div');
	root.className = 'sysml-hover';
	for (const block of parseBlocks(markdown)) {
		if (block.type === 'code') {
			const pre = document.createElement('pre');
			pre.textContent = block.text;
			root.append(pre);
		} else if (block.type === 'list') {
			const list = document.createElement(block.ordered ? 'ol' : 'ul');
			for (const item of block.items) {
				const li = document.createElement('li');
				renderInline(item, li);
				list.append(li);
			}
			root.append(list);
		} else if (block.type === 'rule') {
			root.append(document.createElement('hr'));
		} else {
			const p = document.createElement(block.type === 'heading' ? 'strong' : 'p');
			renderInline(block.children, p);
			root.append(p);
		}
	}
	return root;
}

function hover(ctx: LanguageContext) {
	return hoverTooltip(
		async (view, pos): Promise<Tooltip | null> => {
			const files = ctx
				.files()
				.map((f) => (f.path === ctx.path ? { path: f.path, text: view.state.doc.toString() } : f));
			const info = await ctx.engine.hover(files, ctx.path, pos);
			if (!info) return null;
			return {
				pos: info.from,
				end: info.to,
				above: true,
				create: () => ({ dom: renderMarkdown(info.markdown) })
			};
		},
		{ hoverTime: 350 }
	);
}

// --- Panels: references and rename -----------------------------------------

type PanelState =
	| { kind: 'references'; name: string; items: (FileRange & { line: number; preview: string })[] }
	| { kind: 'rename'; from: string; offset: number }
	| null;

const setPanel = StateEffect.define<PanelState>();

function panelField(ctx: LanguageContext) {
	return StateField.define<PanelState>({
		create: () => null,
		update(value, tr) {
			for (const effect of tr.effects) if (effect.is(setPanel)) return effect.value;
			return value;
		},
		provide: (field) =>
			showPanel.from(field, (state) => (state ? (view) => makePanel(view, state, ctx) : null))
	});
}

function makePanel(view: EditorView, state: NonNullable<PanelState>, ctx: LanguageContext): Panel {
	const dom = document.createElement('div');
	dom.className = 'sysml-panel';
	const close = () => view.dispatch({ effects: setPanel.of(null) });
	const closeButton = document.createElement('button');
	closeButton.type = 'button';
	closeButton.className = 'close';
	closeButton.textContent = 'Close';
	closeButton.onclick = () => {
		close();
		view.focus();
	};

	if (state.kind === 'references') {
		const title = document.createElement('strong');
		title.textContent = `${state.items.length} reference${state.items.length === 1 ? '' : 's'} to ${state.name}`;
		const list = document.createElement('ul');
		for (const item of state.items) {
			const li = document.createElement('li');
			const button = document.createElement('button');
			button.type = 'button';
			const where = document.createElement('span');
			where.className = 'where';
			where.textContent = `${item.path}:${item.line}`;
			button.append(where, ' ', item.preview);
			button.onclick = () => ctx.goto(item);
			li.append(button);
			list.append(li);
		}
		dom.append(title, closeButton, list);
		return { dom, top: false };
	}

	const form = document.createElement('form');
	const label = document.createElement('label');
	label.textContent = `Rename ${state.from} to `;
	const input = document.createElement('input');
	input.value = state.from;
	input.setAttribute('aria-label', `New name for ${state.from}`);
	label.append(input);
	const hint = document.createElement('span');
	hint.className = 'hint';
	hint.textContent = 'Enter to rename everywhere · Esc to cancel';
	const error = document.createElement('span');
	error.className = 'error';
	error.setAttribute('role', 'alert');
	form.append(label, hint, error, closeButton);
	form.onsubmit = async (event) => {
		event.preventDefault();
		const to = input.value.trim();
		if (!to || to === state.from) return close();
		const result = await ctx.engine.renameSymbol(ctx.files(), ctx.path, state.offset, to);
		if ('error' in result) {
			error.textContent = result.error;
			return;
		}
		close();
		await ctx.applyChanges(`Renamed ${state.from} to ${to}`, result.changes);
		view.focus();
	};
	input.onkeydown = (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			view.focus();
		}
	};
	dom.append(form);
	return {
		dom,
		top: true,
		mount: () => {
			input.focus();
			input.select();
		}
	};
}

function wordAt(view: EditorView, pos: number): string {
	const line = view.state.doc.lineAt(pos);
	const offset = pos - line.from;
	const before = /[\w']*$/.exec(line.text.slice(0, offset))?.[0] ?? '';
	const after = /^[\w']*/.exec(line.text.slice(offset))?.[0] ?? '';
	return (before + after).replace(/^'|'$/g, '');
}

// --- Quick fixes ------------------------------------------------------------

const setFixes = StateEffect.define<{ pos: number; actions: CodeAction[] } | null>();

function fixesField(ctx: LanguageContext) {
	return StateField.define<{ pos: number; actions: CodeAction[] } | null>({
		create: () => null,
		update(value, tr) {
			for (const effect of tr.effects) if (effect.is(setFixes)) return effect.value;
			return tr.docChanged || tr.selection ? null : value;
		},
		provide: (field) =>
			showTooltip.from(field, (fixes) =>
				fixes
					? {
							pos: fixes.pos,
							above: false,
							create: (view) => {
								const dom = document.createElement('div');
								dom.className = 'sysml-fixes';
								dom.setAttribute('role', 'menu');
								if (!fixes.actions.length) {
									dom.textContent = 'No quick fixes here.';
								}
								for (const action of fixes.actions) {
									const button = document.createElement('button');
									button.type = 'button';
									button.setAttribute('role', 'menuitem');
									button.textContent = action.title;
									button.onclick = async () => {
										view.dispatch({ effects: setFixes.of(null) });
										await ctx.applyChanges(action.title, action.changes);
										view.focus();
									};
									dom.append(button);
								}
								queueMicrotask(() => dom.querySelector('button')?.focus());
								return { dom };
							}
						}
					: null
			)
	});
}

// --- Commands ---------------------------------------------------------------

function commands(ctx: LanguageContext, open: (state: EditorView['state']) => boolean) {
	const definition = (view: EditorView, pos = view.state.selection.main.head) => {
		void ctx.engine.definition(ctx.files(), ctx.path, pos).then((target) => {
			if (target) ctx.goto(target);
		});
		return true;
	};
	const references = (view: EditorView) => {
		const pos = view.state.selection.main.head;
		const name = wordAt(view, pos);
		void ctx.engine.references(ctx.files(), ctx.path, pos).then((ranges) => {
			const files = Object.fromEntries(ctx.files().map((f) => [f.path, f.text]));
			const items = ranges.map((r) => {
				const text = files[r.path] ?? '';
				const line = text.slice(0, r.from).split('\n').length;
				return { ...r, line, preview: text.split('\n')[line - 1]?.trim().slice(0, 80) ?? '' };
			});
			view.dispatch({ effects: setPanel.of({ kind: 'references', name, items }) });
		});
		return true;
	};
	const rename = (view: EditorView) => {
		const pos = view.state.selection.main.head;
		const from = wordAt(view, pos);
		if (!from) return false;
		view.dispatch({ effects: setPanel.of({ kind: 'rename', from, offset: pos }) });
		return true;
	};
	const format = (view: EditorView) => {
		const text = view.state.doc.toString();
		void ctx.engine.format(text).then(({ changes }) => {
			if (view.state.doc.toString() === text && changes.length) view.dispatch({ changes });
		});
		return true;
	};
	const quickFix = (view: EditorView) => {
		const { from, to } = view.state.selection.main;
		void ctx.engine.codeActions(ctx.files(), ctx.path, from, to).then((actions) => {
			view.dispatch({ effects: setFixes.of({ pos: from, actions }) });
		});
		return true;
	};
	return {
		definition,
		keymap: keymap.of([
			{ key: 'F12', run: (v) => definition(v) },
			{ key: 'Shift-F12', run: references },
			{ key: 'F2', run: rename },
			{ key: 'Shift-Alt-f', run: format },
			{ key: 'Mod-.', run: quickFix },
			{
				key: 'Escape',
				run: (view) => {
					if (!open(view.state)) return false;
					view.dispatch({ effects: [setFixes.of(null), setPanel.of(null)] });
					return true;
				}
			}
		])
	};
}

/** Everything above, for one editor. */
export function sysmlLanguage(ctx: LanguageContext): Extension {
	const fixes = fixesField(ctx);
	const panel = panelField(ctx);
	const cmds = commands(ctx, (state) => !!state.field(fixes, false) || !!state.field(panel, false));
	return [
		autocompletion({ override: [completionSource(ctx)], activateOnTypingDelay: 80 }),
		hover(ctx),
		panel,
		fixes,
		cmds.keymap,
		// Ctrl/⌘-click goes to the definition.
		EditorView.domEventHandlers({
			mousedown(event, view) {
				if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
				const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
				if (pos === null) return false;
				event.preventDefault();
				return cmds.definition(view, pos);
			}
		}),
		languageTheme
	];
}

const languageTheme = EditorView.theme({
	'.sysml-hover': {
		maxWidth: '28rem',
		maxHeight: '18rem',
		overflow: 'auto',
		padding: '8px 10px',
		fontFamily: 'var(--font-ui)',
		fontSize: '13px',
		lineHeight: '1.5',
		color: 'var(--text)'
	},
	'.sysml-hover pre': {
		margin: '0 0 6px',
		padding: '4px 6px',
		borderRadius: '4px',
		background: 'var(--surface-2)',
		fontFamily: 'var(--font-mono)',
		fontSize: '12px',
		whiteSpace: 'pre-wrap'
	},
	'.sysml-hover p': { margin: '0 0 6px' },
	'.sysml-hover code': { fontFamily: 'var(--font-mono)', fontSize: '12px' },
	'.cm-tooltip': {
		border: '1px solid var(--border)',
		borderRadius: '8px',
		background: 'var(--surface)',
		boxShadow: 'var(--shadow-lg)'
	},
	'.sysml-panel': {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '8px',
		padding: '8px 12px',
		background: 'var(--surface)',
		borderTop: '1px solid var(--border)',
		fontFamily: 'var(--font-ui)',
		fontSize: '13px',
		color: 'var(--text)'
	},
	'.sysml-panel ul': {
		flexBasis: '100%',
		maxHeight: '10rem',
		overflow: 'auto',
		margin: '0',
		padding: '0',
		listStyle: 'none'
	},
	'.sysml-panel li button': {
		width: '100%',
		padding: '3px 6px',
		border: '0',
		borderRadius: '4px',
		background: 'transparent',
		color: 'var(--text)',
		textAlign: 'left',
		fontFamily: 'var(--font-mono)',
		fontSize: '12px',
		cursor: 'pointer'
	},
	'.sysml-panel li button:hover': { background: 'var(--surface-hover)' },
	'.sysml-panel .where': { color: 'var(--accent)' },
	'.sysml-panel form': {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '8px',
		flex: '1'
	},
	'.sysml-panel input': {
		height: '28px',
		padding: '0 8px',
		border: '1px solid var(--accent)',
		borderRadius: '6px',
		background: 'var(--surface)',
		color: 'var(--text)',
		fontFamily: 'var(--font-mono)',
		fontSize: '16px'
	},
	'.sysml-panel .hint': { color: 'var(--text-2)', fontSize: '12px' },
	'.sysml-panel .error': { color: 'var(--danger)' },
	'.sysml-panel .close': {
		marginLeft: 'auto',
		padding: '2px 10px',
		border: '1px solid var(--border)',
		borderRadius: '6px',
		background: 'var(--surface)',
		color: 'var(--text)',
		cursor: 'pointer'
	},
	'.sysml-fixes': { display: 'grid', padding: '4px', minWidth: '14rem' },
	'.sysml-fixes button': {
		padding: '6px 10px',
		border: '0',
		borderRadius: '6px',
		background: 'transparent',
		color: 'var(--text)',
		textAlign: 'left',
		fontFamily: 'var(--font-ui)',
		fontSize: '13px',
		cursor: 'pointer'
	},
	'.sysml-fixes button:hover, .sysml-fixes button:focus': {
		background: 'var(--accent-weak)',
		outline: 'none'
	}
});
