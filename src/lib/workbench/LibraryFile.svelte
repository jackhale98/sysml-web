<script lang="ts">
	import { onMount } from 'svelte';
	import { Compartment, EditorState } from '@codemirror/state';
	import { EditorView, highlightActiveLine, lineNumbers } from '@codemirror/view';
	import { BookLock } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { isStandardFile, relocate } from '#lib/library/catalog.ts';
	import { libraryFile, licenseFor } from '#lib/library/library.ts';
	import { editorTheme, highlightEffect, sysmlHighlighting } from '#lib/editor/sysml.ts';

	/**
	 * A file of the OMG SysML v2 standard library, read-only: the definitions
	 * every model builds on (ISQ quantities, SI units, Parts, Ports, …). It
	 * opens at `line`, or at the nearest declaration of `name` when the line
	 * comes from another release of the library.
	 */
	let { path, line, name, engine }: { path: string; line?: number; name?: string; engine: Engine } =
		$props();

	let host: HTMLDivElement;
	/** Marks the line navigated to (none until a line is asked for). */
	const mark = new Compartment();
	let view = $state.raw<EditorView | undefined>();
	let error = $state<string | null>(null);
	const license = $derived(licenseFor(path));
	const standard = $derived(isStandardFile(path));

	onMount(() => {
		let cancelled = false;
		let editor: EditorView | undefined;
		void (async () => {
			try {
				const file = await libraryFile(path);
				if (cancelled) return;
				editor = new EditorView({
					parent: host,
					state: EditorState.create({
						doc: file.text,
						extensions: [
							lineNumbers(),
							mark.of([]),
							EditorState.readOnly.of(true),
							EditorView.editable.of(false),
							sysmlHighlighting(),
							editorTheme,
							EditorView.contentAttributes.of({
								'aria-label': `Standard library file ${path} (read-only)`,
								tabindex: '0'
							})
						]
					})
				});
				view = editor;
				const highlights = await engine.highlight(file.text);
				if (cancelled) return;
				editor.dispatch({ effects: highlightEffect(highlights, file.text.length) });
			} catch (e) {
				if (!cancelled) error = e instanceof Error ? e.message : String(e);
			}
		})();
		return () => {
			cancelled = true;
			editor?.destroy();
		};
	});

	// Go to the line once the file is open, and again when another line is asked for.
	$effect(() => {
		if (!view || !line) return;
		const doc = view.state.doc;
		const target = relocate(doc.toString(), line, name);
		if (target > doc.lines) return;
		const at = doc.line(target).from;
		view.dispatch({
			effects: [
				mark.reconfigure(highlightActiveLine()),
				EditorView.scrollIntoView(at, { y: 'start', yMargin: 48 })
			],
			selection: { anchor: at }
		});
	});
</script>

<section class="library-file" aria-label="Standard library: {path}">
	<header>
		<BookLock size={15} aria-hidden="true" />
		<span class="path">{path}</span>
		<span class="badge"
			>{standard ? 'OMG standard library' : 'sysml-toolkit package'} · read-only</span
		>
		<details class="license">
			<summary>{license.spdx}</summary>
			<p>{license.notice}</p>
		</details>
	</header>
	{#if error}<p class="error" role="alert">This file could not be opened: {error}</p>{/if}
	<div class="code" bind:this={host}></div>
</section>

<style>
	.library-file {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	header {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.path {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.badge {
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
	}
	.license {
		margin-left: auto;
	}
	.license summary {
		cursor: pointer;
	}
	.license p {
		position: absolute;
		right: var(--space-3);
		z-index: 5;
		width: min(32rem, 90vw);
		max-height: 50vh;
		overflow: auto;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
		white-space: pre-wrap;
	}
	.error {
		padding: var(--space-4);
		color: var(--danger);
	}
	.code {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.code :global(.cm-editor) {
		height: 100%;
	}
</style>
