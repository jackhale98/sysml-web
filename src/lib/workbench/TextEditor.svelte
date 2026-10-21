<script lang="ts">
	import { onMount } from 'svelte';
	import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { bracketMatching, indentUnit } from '@codemirror/language';
	import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
	import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
	import { EditorState } from '@codemirror/state';
	import {
		EditorView,
		drawSelection,
		highlightActiveLine,
		highlightActiveLineGutter,
		keymap,
		lineNumbers
	} from '@codemirror/view';
	import type { Engine } from '#lib/engine/client.ts';
	import { editorTheme, highlightEffect, sysmlHighlighting } from '#lib/editor/sysml.ts';
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
			const text = state.doc.toString();
			const byte = utf16ToByte(text, state.selection.main.head);
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
					lineNumbers(),
					highlightActiveLineGutter(),
					highlightActiveLine(),
					drawSelection(),
					history(),
					bracketMatching(),
					closeBrackets(),
					highlightSelectionMatches(),
					indentUnit.of('    '),
					EditorState.tabSize.of(4),
					lintGutter(),
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
						if (update.docChanged) {
							workspace.setText(path, update.state.doc.toString());
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
				const set = view.state.changes(changes);
				const first = changes[0]!;
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

	// Keep in step with changes made elsewhere while this editor is not the
	// one applying them (e.g. a diagram edit applied before it was opened).
	$effect(() => {
		const text = workspace.files[path];
		if (!view || text === undefined || text === view.state.doc.toString()) return;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
	});

	// Engine diagnostics for this file.
	$effect(() => {
		const analysis = workspace.analyses[path];
		if (!view || !analysis) return;
		const text = view.state.doc.toString();
		if (text !== workspace.files[path]) return;
		const length = view.state.doc.length;
		const diagnostics: CmDiagnostic[] = workspace.problems
			.filter((p) => p.file === path)
			.map((p) => ({
				from: Math.min(byteToUtf16(text, p.span.start_byte), length),
				to: Math.min(byteToUtf16(text, p.span.end_byte), length),
				severity: p.severity === 'note' ? 'info' : p.severity,
				message: p.suggestion ? `${p.message}. ${p.suggestion}` : p.message,
				source: p.code
			}));
		view.dispatch(setDiagnostics(view.state, diagnostics));
	});

	// Reveal the selected element when it was chosen somewhere else.
	$effect(() => {
		const selection = ui.selection;
		if (!view || !selection || selection.source === 'text') return;
		const element = workspace.elements.find((e) => e.key === selection.key);
		if (!element || element.file !== path) return;
		const text = view.state.doc.toString();
		const anchor = Math.min(byteToUtf16(text, element.span.start_byte), view.state.doc.length);
		revealing = true;
		view.dispatch({
			selection: { anchor },
			effects: EditorView.scrollIntoView(anchor, { y: 'center' })
		});
		revealing = false;
	});
</script>

<div class="editor" bind:this={host}></div>

<style>
	.editor {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.editor :global(.cm-editor) {
		height: 100%;
	}
	.editor :global(.cm-editor.cm-focused) {
		outline: none;
	}
</style>
