<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState } from '@codemirror/state';
	import { EditorView, lineNumbers } from '@codemirror/view';
	import { BookLock } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { LibraryLicense } from '#lib/engine/types.ts';
	import { editorTheme, highlightEffect, sysmlHighlighting } from '#lib/editor/sysml.ts';

	/**
	 * A file of the OMG SysML v2 standard library, read-only: the definitions
	 * every model builds on (ISQ quantities, SI units, Parts, Ports, …).
	 */
	let { path, line, engine }: { path: string; line?: number; engine: Engine } = $props();

	let host: HTMLDivElement;
	let license = $state<LibraryLicense | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let view: EditorView | undefined;
		let cancelled = false;
		void (async () => {
			try {
				const [file, terms] = await Promise.all([
					engine.libraryFile(path),
					engine.libraryLicense()
				]);
				if (cancelled) return;
				license = terms;
				view = new EditorView({
					parent: host,
					state: EditorState.create({
						doc: file.text,
						extensions: [
							lineNumbers(),
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
				const highlights = await engine.highlight(file.text);
				if (cancelled || !view) return;
				const effects = [highlightEffect(highlights, file.text.length)];
				if (line && line <= view.state.doc.lines) {
					const at = view.state.doc.line(line).from;
					view.dispatch({
						effects: [...effects, EditorView.scrollIntoView(at, { y: 'start', yMargin: 48 })],
						selection: { anchor: at }
					});
				} else {
					view.dispatch({ effects });
				}
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		})();
		return () => {
			cancelled = true;
			view?.destroy();
		};
	});
</script>

<section class="library-file" aria-label="Standard library: {path}">
	<header>
		<BookLock size={15} aria-hidden="true" />
		<span class="path">{path}</span>
		<span class="badge">OMG standard library · read-only</span>
		{#if license}
			<details class="license">
				<summary>{license.spdx}</summary>
				<p>{license.notice}</p>
			</details>
		{/if}
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
