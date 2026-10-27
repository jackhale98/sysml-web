<script lang="ts" module>
	/** Where each document was scrolled to, so coming back to it returns there. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read on mount only, never rendered
	const scrolled = new Map<string, number>();

	/** Whether the reader has got some way into a document (to offer to continue it). */
	export function startedReading(path: string): boolean {
		return (scrolled.get(path) ?? 0) > 200;
	}
</script>

<script lang="ts">
	import { ArrowUpRight, Pencil } from '@lucide/svelte';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { viewTitle } from '#lib/workbench/views.ts';
	import { parseBlocks, type Inline } from './markdown.ts';
	import { resolveReference, type Reference } from './references.ts';
	import { isGuideAction, runGuideAction, type GuideAction } from '#lib/workbench/guide.ts';

	/**
	 * A project document (README, TOUR) as a page to read. Model references
	 * in code spans — `Package::element` or a view name — become links that
	 * select the element or open the view, so a written tour walks the model.
	 */
	let { path, workspace, ui }: { path: string; workspace: Workspace; ui: WorkbenchUi } = $props();

	const blocks = $derived(parseBlocks(workspace.text(path) ?? ''));

	// Back where the reader left it (the page is rebuilt when they come back to it).
	function remember(page: HTMLElement) {
		const at = scrolled.get(path);
		if (at) requestAnimationFrame(() => page.scrollTo({ top: at }));
		const save = () => scrolled.set(path, page.scrollTop);
		page.addEventListener('scroll', save, { passive: true });
		return () => page.removeEventListener('scroll', save);
	}

	function resolve(code: string): Reference | null {
		return resolveReference(code, workspace).reference;
	}

	function follow(reference: Reference) {
		if (reference.kind === 'view') {
			ui.open({ kind: 'view', name: reference.name, title: viewTitle(reference.name) });
		} else if (reference.kind === 'file') {
			ui.open({ kind: 'file', path: reference.path });
		} else {
			ui.open({ kind: 'file', path: reference.element.file });
			ui.select(reference.element.key, 'explorer');
		}
	}

	const external = (href: string) => /^https?:\/\//.test(href);

	/** `[Import a spreadsheet](#do:import-requirements)`: a link that does it here. */
	function actionOf(href: string): GuideAction | null {
		const id = /^#do:([\w-]+)$/.exec(href)?.[1];
		return id && isGuideAction(id) ? id : null;
	}
</script>

{#snippet inline(nodes: Inline[])}
	{#each nodes as node, i (i)}
		{#if node.type === 'text'}{node.text}{:else if node.type === 'strong'}<strong
				>{@render inline(node.children)}</strong
			>{:else if node.type === 'em'}<em>{@render inline(node.children)}</em
			>{:else if node.type === 'link'}{#if external(node.href)}<!-- External links leave the app; resolve() is for app routes. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve --><a
					href={node.href}
					target="_blank"
					rel="noopener noreferrer">{@render inline(node.children)}</a
				>{:else if actionOf(node.href)}{@const action = actionOf(node.href)!}<button
					type="button"
					class="do"
					onclick={() => void runGuideAction(action, { ui, workspace })}
					>{@render inline(node.children)}</button
				>{:else}{@render inline(node.children)}{/if}{:else}
			{@const reference = resolve(node.text)}
			{#if reference}
				<button type="button" class="ref" onclick={() => follow(reference)}>
					{#if reference.kind === 'element'}
						<KindGlyph
							kind={reference.element.kind}
							isDefinition={reference.element.isDefinition}
							size={15}
						/>
					{:else}
						<ArrowUpRight size={13} aria-hidden="true" />
					{/if}
					<code>{node.text}</code>
				</button>
			{:else}
				<code>{node.text}</code>
			{/if}
		{/if}
	{/each}
{/snippet}

<article class="document" {@attach remember}>
	<div class="bar">
		<span class="path">{path}</span>
		<button type="button" class="edit" onclick={() => ui.open({ kind: 'file', path, raw: true })}>
			<Pencil size={14} /> Edit
		</button>
	</div>
	<div class="page">
		{#each blocks as block, i (i)}
			{#if block.type === 'heading'}
				{#if block.level === 1}<h2>{@render inline(block.children)}</h2>
				{:else if block.level === 2}<h3>{@render inline(block.children)}</h3>
				{:else}<h4>{@render inline(block.children)}</h4>{/if}
			{:else if block.type === 'paragraph'}
				<p>{@render inline(block.children)}</p>
			{:else if block.type === 'quote'}
				<blockquote>{@render inline(block.children)}</blockquote>
			{:else if block.type === 'list'}
				{#if block.ordered}
					<ol>
						{#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
					</ol>
				{:else}
					<ul>
						{#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
					</ul>
				{/if}
			{:else if block.type === 'code'}
				<!-- Focusable so keyboard users can scroll wide code. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<pre tabindex="0"><code>{block.text}</code></pre>
			{:else}
				<hr />
			{/if}
		{/each}
	</div>
</article>

<style>
	/* A page that scrolls down only: nothing in it makes it pan sideways. */
	.document {
		height: 100%;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior-x: none;
		background: var(--bg);
	}
	.bar {
		position: sticky;
		top: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg) 88%, transparent);
		backdrop-filter: blur(8px);
	}
	.path {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.edit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 1.875rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.page {
		max-width: 46rem;
		margin: 0 auto;
		padding: var(--space-6) var(--space-5) var(--space-8, 4rem);
		min-width: 0;
		color: var(--text);
		font-size: 1rem;
		line-height: 1.7;
		/* Long names (qualified names, paths, URLs) break rather than overflow. */
		overflow-wrap: anywhere;
	}
	.page :global(img) {
		max-width: 100%;
		height: auto;
	}
	h2 {
		margin: 0 0 var(--space-4);
		font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);
		letter-spacing: -0.02em;
		line-height: 1.2;
	}
	h3 {
		margin: var(--space-6) 0 var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
		font-size: 1.15rem;
		line-height: 1.4;
	}
	h4 {
		margin: var(--space-4) 0 var(--space-2);
		font-size: 1rem;
	}
	p,
	ul,
	ol,
	blockquote {
		margin: 0 0 var(--space-3);
	}
	ul,
	ol {
		padding-left: 1.25rem;
	}
	blockquote {
		padding: var(--space-2) var(--space-4);
		border-left: 3px solid var(--accent);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: var(--accent-weak);
	}
	code {
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.88em;
	}
	pre {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		line-height: 1.55;
	}
	pre code {
		padding: 0;
		background: none;
		overflow-wrap: normal;
	}
	a {
		color: var(--accent);
	}
	.ref {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding: 0 4px 0 2px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		color: var(--accent);
		font: inherit;
		vertical-align: baseline;
		cursor: pointer;
		transition:
			border-color var(--duration) var(--ease),
			box-shadow var(--duration) var(--ease);
	}
	/* A tour's "do it" link: looks like a link, does the thing here. */
	.do {
		display: inline;
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.do:hover {
		text-decoration-thickness: 2px;
	}
	.ref:hover {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	.ref code {
		min-width: 0;
		padding: 0;
		background: none;
		color: inherit;
		text-align: left;
	}
	@media (max-width: 760px) {
		.page {
			padding: var(--space-4) var(--space-4) var(--space-6);
		}
	}
</style>
