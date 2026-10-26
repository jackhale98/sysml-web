<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
	import {
		defaultKeymap,
		history,
		historyKeymap,
		indentWithTab,
		redo,
		redoDepth,
		undo,
		undoDepth
	} from '@codemirror/commands';
	import { bracketMatching, indentUnit } from '@codemirror/language';
	import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { Compartment, EditorState } from '@codemirror/state';
	import {
		EditorView,
		drawSelection,
		highlightActiveLine,
		highlightActiveLineGutter,
		keymap,
		lineNumbers
	} from '@codemirror/view';
	import { Check, PencilLine, Redo2, Undo2 } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { DefinitionTarget } from '#lib/engine/types.ts';
	import { sysmlLanguage } from '#lib/editor/language.ts';
	import { fileLineBreaks, fileText, toDoc, toFile } from '#lib/editor/lineBreaks.ts';
	import { lineBreakOf } from '#lib/project/lineBreaks.ts';
	import { editorTheme, highlightEffect, sysmlHighlighting } from '#lib/editor/sysml.ts';
	import { editorFontSizeHere, settings } from '#lib/settings/settings.svelte.ts';
	import { byteToUtf16, elementAt, utf16ToByte } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let {
		path,
		workspace,
		ui,
		engine
	}: { path: string; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	let host: HTMLDivElement;
	let view: EditorView | undefined;
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;
	let selectTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set while applying our own selection, to avoid echoing it back. */
	let revealing = false;

	/**
	 * On phones the text is for reading first: read-only and soft-wrapped.
	 * "Edit text" turns typing on.
	 */
	const phone = $derived(ui.phone);
	const editable = $derived(!phone || ui.editingText);
	const editing = new Compartment();
	const look = new Compartment();
	const gutter = new Compartment();
	/** The file's line endings, which the editor keeps. */
	const lineBreaks = new Compartment();
	/** The person's editor settings: font size, wrapping, line numbers. */
	const prefs = new Compartment();
	let canUndo = $state(false);
	let canRedo = $state(false);

	const phoneTheme = EditorView.theme({
		'.cm-content': { padding: '10px 0 96px' },
		'.cm-line': { padding: '0 12px 0 8px' },
		'.cm-gutters': { fontSize: '11px', minWidth: '0' },
		'.cm-lineNumbers .cm-gutterElement': { minWidth: '22px', padding: '0 4px 0 6px' }
	});
	function editingExtensions(on: boolean) {
		return [EditorState.readOnly.of(!on), EditorView.editable.of(on)];
	}
	function lookExtensions(small: boolean) {
		return small ? [EditorView.lineWrapping, phoneTheme] : [];
	}
	function prefExtensions(small: boolean, size: number, wrap: boolean, numbers: boolean) {
		return [
			...(numbers ? [lineNumbers()] : []),
			...(!small && wrap ? [EditorView.lineWrapping] : []),
			EditorView.theme({ '&': { fontSize: `${editorFontSizeHere(size)}px` } })
		];
	}
	$effect(() => {
		const extensions = prefExtensions(
			phone,
			settings.editorFontSize,
			settings.lineWrapping,
			settings.lineNumbers
		);
		view?.dispatch({ effects: prefs.reconfigure(extensions) });
	});

	/** Where a definition lives: open the file and select the element there. */
	function goto(target: DefinitionTarget) {
		if ('library' in target) {
			ui.open({ kind: 'library', path: target.library.path, line: target.library.line });
			return;
		}
		ui.open({ kind: 'file', path: target.path });
		const text = workspace.text(target.path) ?? '';
		const element = elementAt(workspace.elements, target.path, utf16ToByte(text, target.from));
		if (element) ui.select(element.key, 'inspector');
	}

	function gutterExtensions(small: boolean) {
		return small ? [] : [lintGutter()];
	}

	/** Start typing: turn editing on and focus within the same tap, so the keyboard opens. */
	function startEditing() {
		if (!view) return;
		ui.editingText = true;
		view.dispatch({ effects: editing.reconfigure(editingExtensions(true)) });
		// Keep the caret where the reader is looking rather than jumping to the top.
		const scroller = view.scrollDOM.getBoundingClientRect();
		const head = view.coordsAtPos(view.state.selection.main.head);
		if (!head || head.top < scroller.top || head.bottom > scroller.bottom) {
			const pos = view.posAtCoords({ x: scroller.left + 48, y: scroller.top + 24 });
			if (pos !== null) view.dispatch({ selection: { anchor: pos } });
		}
		view.focus();
	}

	/**
	 * A tap on the text while it is for reading: say how to type, by the
	 * button that does it (the keyboard doesn't open, and nothing else says why).
	 */
	let readHint = $state(false);
	let readHintTimer: ReturnType<typeof setTimeout> | undefined;
	function onreadtap() {
		if (!phone || ui.editingText) return;
		readHint = true;
		clearTimeout(readHintTimer);
		readHintTimer = setTimeout(() => (readHint = false), 5000);
	}
	$effect(() => () => clearTimeout(readHintTimer));

	function stopEditing() {
		ui.editingText = false;
		view?.contentDOM.blur();
	}

	function insert(text: string) {
		if (!view) return;
		view.dispatch({
			...view.state.replaceSelection(text),
			scrollIntoView: true,
			userEvent: 'input.type'
		});
	}

	const SYMBOLS = ['{', '}', ':', ';', '~', '[', ']', '=', '>'];

	async function refreshHighlights() {
		if (!view) return;
		const text = view.state.doc.toString();
		const highlights = await engine.highlight(text);
		if (!view || view.state.doc.toString() !== text) return;
		view.dispatch({ effects: highlightEffect(highlights, text.length) });
	}

	function scheduleHighlights(delay: number) {
		clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => void refreshHighlights(), delay);
	}

	function selectAtCursor(state: EditorState) {
		clearTimeout(selectTimer);
		selectTimer = setTimeout(() => {
			const text = fileText(state);
			const byte = utf16ToByte(text, toFile(state, state.selection.main.head));
			const element = elementAt(workspace.elements, path, byte);
			if (element && element.key !== ui.selection?.key) ui.select(element.key, 'text');
		}, 120);
	}

	onMount(() => {
		const initial = workspace.text(path) ?? '';
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: initial,
				extensions: [
					lineBreaks.of(fileLineBreaks(lineBreakOf(initial))),
					editing.of(editingExtensions(editable)),
					look.of(lookExtensions(phone)),
					prefs.of(
						prefExtensions(
							phone,
							settings.editorFontSize,
							settings.lineWrapping,
							settings.lineNumbers
						)
					),
					sysmlLanguage({
						engine,
						path,
						files: () => workspace.sourceFiles(),
						goto,
						applyChanges: (label, changes) => workspace.applyFileChanges(label, changes)
					}),
					highlightActiveLineGutter(),
					highlightActiveLine(),
					drawSelection(),
					history(),
					bracketMatching(),
					closeBrackets(),
					highlightSelectionMatches(),
					indentUnit.of('    '),
					EditorState.tabSize.of(4),
					gutter.of(gutterExtensions(phone)),
					keymap.of([
						...closeBracketsKeymap,
						...defaultKeymap,
						...searchKeymap,
						...historyKeymap,
						indentWithTab
					]),
					sysmlHighlighting(),
					editorTheme,
					EditorView.contentAttributes.of({
						'aria-label': `SysML source of ${path}`,
						tabindex: '0'
					}),
					EditorView.updateListener.of((update) => {
						canUndo = undoDepth(update.state) > 0;
						canRedo = redoDepth(update.state) > 0;
						if (update.docChanged) {
							workspace.setText(path, fileText(update.state));
							scheduleHighlights(150);
						}
						if (update.selectionSet && !revealing && update.view.hasFocus) {
							selectAtCursor(update.state);
						}
					})
				]
			})
		});
		scheduleHighlights(0);
		const detach = workspace.attachEditor(path, {
			// Show the SysML a diagram or inspector action wrote: select it and
			// scroll to it, so every gesture teaches the text it produces.
			apply: (changes) => {
				if (!view || changes.length === 0) return;
				const state = view.state;
				const at = changes.map((c) => ({
					from: toDoc(state, c.from),
					to: toDoc(state, c.to),
					insert: c.insert
				}));
				const set = state.changes(at);
				const first = at[0]!;
				const from = set.mapPos(first.from, -1);
				const to = set.mapPos(first.to, 1);
				revealing = true;
				view.dispatch({
					changes: set,
					selection: { anchor: from, head: to },
					effects: EditorView.scrollIntoView(from, { y: 'center' })
				});
				revealing = false;
			}
		});
		return () => {
			detach();
			clearTimeout(highlightTimer);
			clearTimeout(selectTimer);
			view?.destroy();
			view = undefined;
		};
	});

	// Follow the phone layout and the edit mode (e.g. when the window is resized).
	$effect(() => {
		const on = editable;
		const small = phone;
		if (!view) return;
		view.dispatch({
			effects: [
				editing.reconfigure(editingExtensions(on)),
				look.reconfigure(lookExtensions(small)),
				gutter.reconfigure(gutterExtensions(small))
			]
		});
		if (!on && view.hasFocus) view.contentDOM.blur();
	});

	// Leaving the file stops typing.
	$effect(() => () => {
		if (ui.editingText) ui.editingText = false;
	});

	// Keep in step with changes made elsewhere while this editor is not the
	// one applying them (e.g. a diagram edit applied before it was opened).
	$effect(() => {
		const text = workspace.files[path];
		if (!view || text === undefined || text === fileText(view.state)) return;
		const lineBreak = lineBreakOf(text);
		if (lineBreak !== view.state.lineBreak)
			view.dispatch({ effects: lineBreaks.reconfigure(fileLineBreaks(lineBreak)) });
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
	});

	// Engine diagnostics for this file.
	$effect(() => {
		const analysis = workspace.analyses[path];
		if (!view || !analysis) return;
		const state = view.state;
		const text = fileText(state);
		if (text !== workspace.files[path]) return;
		const diagnostics: CmDiagnostic[] = workspace.problems
			.filter((p) => p.file === path)
			.map((p) => ({
				from: toDoc(state, p.span.from ?? byteToUtf16(text, p.span.start_byte)),
				to: toDoc(state, p.span.to ?? byteToUtf16(text, p.span.end_byte)),
				severity: p.severity === 'note' ? 'info' : p.severity,
				message: p.suggestion ? `${p.message}. ${p.suggestion}` : p.message,
				source: p.code
			}));
		view.dispatch(setDiagnostics(view.state, diagnostics));
	});

	// Show a range asked for elsewhere (a check's claim), after the element it is in.
	$effect(() => {
		const request = ui.textRequest;
		if (!view || !request || request.path !== path) return;
		untrack(() => {
			if (!view) return;
			const from = toDoc(view.state, request.from);
			const to = Math.max(toDoc(view.state, request.to), from);
			revealing = true;
			view.dispatch({
				selection: { anchor: from, head: to },
				effects: EditorView.scrollIntoView(from, { y: 'center' })
			});
			revealing = false;
		});
	});

	// Reveal the selected element when it was chosen somewhere else.
	$effect(() => {
		const selection = ui.selection;
		if (!view || !selection || selection.source === 'text') return;
		const element = workspace.elements.find((e) => e.key === selection.key);
		if (!element || element.file !== path) return;
		const text = fileText(view.state);
		const anchor = toDoc(
			view.state,
			element.span.from ?? byteToUtf16(text, element.span.start_byte)
		);
		revealing = true;
		view.dispatch({
			selection: { anchor },
			effects: EditorView.scrollIntoView(anchor, { y: 'center' })
		});
		revealing = false;
	});
</script>

<div class="text-editor" class:phone>
	<!-- A tap on read-only text only explains; the keyboard has its own way in (Edit text). -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="editor" bind:this={host} onclick={onreadtap}></div>
	{#if phone && !ui.editingText}
		<p class="read-hint" role="status">
			{#if readHint}The text is for reading here. Tap <strong>Edit text</strong> to type.{/if}
		</p>
		<button type="button" class="edit" onclick={startEditing}>
			<PencilLine size={17} /> Edit text
		</button>
	{:else if phone}
		<!-- Buttons keep the editor's focus (and the keyboard) by not taking it on press. -->
		<div class="accessory" role="toolbar" aria-label="Typing">
			<button
				type="button"
				class="done"
				onmousedown={(e) => e.preventDefault()}
				onclick={stopEditing}
			>
				<Check size={16} /> Done
			</button>
			<button
				type="button"
				class="key"
				aria-label="Undo"
				disabled={!canUndo}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => view && undo(view)}
			>
				<Undo2 size={17} />
			</button>
			<button
				type="button"
				class="key"
				aria-label="Redo"
				disabled={!canRedo}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => view && redo(view)}
			>
				<Redo2 size={17} />
			</button>
			<span class="symbols">
				{#each SYMBOLS as symbol (symbol)}
					<button
						type="button"
						class="key sym"
						aria-label="Type {symbol}"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => insert(symbol)}>{symbol}</button
					>
				{/each}
			</span>
		</div>
	{/if}
</div>

<style>
	.text-editor {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.editor {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.edit {
		position: absolute;
		right: max(var(--space-4), env(safe-area-inset-right));
		bottom: calc(var(--space-4) + var(--sheet-cover, 0px));
		z-index: 5;
		transition: bottom 300ms cubic-bezier(0.2, 0.9, 0.25, 1);
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 3rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: 999px;
		background: var(--text);
		color: var(--surface);
		box-shadow: var(--shadow-lg);
		font-weight: 650;
		cursor: pointer;
		animation: rise 220ms cubic-bezier(0.2, 0.9, 0.25, 1);
	}
	.edit:active {
		transform: scale(0.96);
	}
	.read-hint {
		position: absolute;
		right: max(var(--space-4), env(safe-area-inset-right));
		bottom: calc(var(--space-4) + 3.5rem + var(--sheet-cover, 0px));
		left: max(var(--space-4), env(safe-area-inset-left));
		z-index: 5;
		max-width: 20rem;
		margin-left: auto;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		font-size: var(--text-sm);
		animation: rise 180ms var(--ease);
	}
	/* Kept in the page while empty, so what it says next is announced. */
	.read-hint:empty {
		padding: 0;
		background: none;
		box-shadow: none;
	}
	.accessory {
		display: flex;
		align-items: center;
		flex: none;
		gap: 4px;
		height: 3rem;
		padding: 0 max(var(--space-2), env(safe-area-inset-right)) 0
			max(var(--space-2), env(safe-area-inset-left));
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		animation: rise 180ms var(--ease);
	}
	.accessory button {
		display: inline-grid;
		place-items: center;
		flex: none;
		height: 2.375rem;
		min-width: 2.375rem;
		border: 0;
		border-radius: 8px;
		background: var(--surface);
		box-shadow: 0 1px 0 var(--border-strong);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 1rem;
		cursor: pointer;
		touch-action: manipulation;
	}
	.accessory button:active {
		background: var(--surface-hover);
	}
	.accessory button:disabled {
		opacity: 0.4;
	}
	.accessory .done {
		display: inline-flex;
		gap: 4px;
		padding: 0 var(--space-3);
		background: var(--accent);
		box-shadow: none;
		color: var(--accent-text);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 650;
	}
	.symbols {
		display: flex;
		flex: 1;
		gap: 4px;
		min-width: 0;
		margin-left: var(--space-1);
		padding-left: var(--space-2);
		overflow-x: auto;
		border-left: 1px solid var(--border-strong);
		scrollbar-width: none;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.edit,
		.accessory {
			animation: none;
		}
	}
	.editor :global(.cm-editor) {
		height: 100%;
	}
	.editor :global(.cm-editor.cm-focused) {
		outline: none;
	}
</style>
