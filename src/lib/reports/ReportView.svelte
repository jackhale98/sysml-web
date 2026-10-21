<script lang="ts">
	import '@fontsource-variable/source-serif-4';
	import '@fontsource-variable/source-serif-4/wght-italic.css';
	import { untrack } from 'svelte';
	import { BookmarkPlus, Code, FileDown, FileText, LoaderCircle, Printer } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { download } from '#lib/project/sources.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { viewTitle } from '#lib/workbench/views.ts';
	import { buildReport } from './build.ts';
	import type { ReportContext } from './context.ts';
	import type { Block, ReportDocument, Section, Text, TreeItem } from './document.ts';
	import { prepareReport, renderParts } from './gather.ts';
	import { standardReport } from './kinds.ts';
	import { fileName, toMarkdown } from './markdown.ts';
	import { APP_PRINT_CSS, pageCss, standaloneHtml } from './print.ts';
	import reportCss from './report.css?raw';

	/**
	 * A report view as a document to read, print and send: built from the
	 * model each time it changes, with names that select their element.
	 */
	let {
		name,
		workspace,
		ui,
		engine
	}: { name: string; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	let doc = $state.raw<ReportDocument | null>(null);
	let context = $state.raw<ReportContext | null>(null);
	let error = $state<string | null>(null);
	let article = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const info = $derived(workspace.views.find((v) => v.name === name || v.qualifiedName === name));
	const standard = $derived(info?.isUsage ? undefined : standardReport(name));

	async function refresh() {
		const current = ++generation;
		try {
			const base = prepareReport(name, {
				views: workspace.views,
				analyses: Object.values(workspace.analyses),
				texts: workspace.files,
				tree: workspace.tree,
				requirements: workspace.requirements,
				project: workspace.info,
				isLibrary: isLibraryFile
			});
			const ctx = await renderParts(base, engine, workspace.sourceFiles());
			if (current !== generation) return;
			context = ctx;
			doc = buildReport(ctx);
			error = null;
		} catch (e) {
			if (current !== generation) return;
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		void workspace.analyses;
		void workspace.views;
		void name;
		if (!Object.keys(workspace.analyses).length) return;
		const delay = untrack(() => doc) ? 400 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
		return () => clearTimeout(timer);
	});

	/** Show an element named in the report, staying in the report. */
	function select(key: string) {
		ui.select(key, 'table');
		if (!ui.phone) ui.inspectorOpen = true;
	}

	/** In-page links scroll the report rather than change the address. */
	function onclick(event: MouseEvent) {
		const link = (event.target as HTMLElement).closest('a[href^="#"]');
		if (!link) return;
		const target = document.getElementById(link.getAttribute('href')!.slice(1));
		if (!target) return;
		event.preventDefault();
		target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		target.querySelector<HTMLElement>('.rd-heading')?.focus({ preventScroll: true });
	}

	// The chapter in view, for the mini contents.
	let current = $state<string | null>(null);
	$effect(() => {
		const root = scroller;
		void doc;
		if (!root || !article) return;
		const chapters = [...article.querySelectorAll<HTMLElement>('.rd-chapter')];
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) if (entry.isIntersecting) current = entry.target.id;
			},
			{ root, rootMargin: '-15% 0px -70% 0px' }
		);
		for (const c of chapters) observer.observe(c);
		return () => observer.disconnect();
	});

	function print() {
		window.print();
	}

	/** The document's markup without the app: names as plain text, headings from h1. */
	function exportMarkup(): string {
		if (!article) return '';
		const clone = article.cloneNode(true) as HTMLElement;
		clone.classList.remove('rd-printable');
		for (const button of clone.querySelectorAll('button.rd-ref')) {
			const span = document.createElement('span');
			span.className = 'rd-ref';
			span.textContent = button.textContent;
			button.replaceWith(span);
		}
		for (const heading of clone.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6')) {
			const level = Number(heading.tagName[1]) - 1;
			const replacement = document.createElement(`h${level}`);
			for (const attribute of heading.attributes)
				replacement.setAttribute(attribute.name, attribute.value);
			replacement.removeAttribute('tabindex');
			replacement.append(...heading.childNodes);
			heading.replaceWith(replacement);
		}
		for (const element of clone.querySelectorAll('[class]')) {
			const classes = [...element.classList].filter((c) => !c.startsWith('svelte-'));
			element.setAttribute('class', classes.join(' '));
			if (!classes.length) element.removeAttribute('class');
		}
		return clone.outerHTML;
	}

	function downloadHtml() {
		if (!doc) return;
		download(
			fileName(doc, 'html'),
			standaloneHtml(doc, exportMarkup(), reportCss),
			'text/html;charset=utf-8'
		);
	}

	function downloadMarkdown() {
		if (!doc) return;
		download(fileName(doc, 'md'), toMarkdown(doc), 'text/markdown;charset=utf-8');
	}

	function showSource() {
		if (!info) return;
		ui.open({ kind: 'file', path: info.file });
		const element = workspace.elements.find((e) => e.file === info.file && e.label === info.name);
		if (element) ui.select(element.key, 'table');
	}

	let saving = $state(false);
	async function save() {
		if (!context || !standard || saving) return;
		saving = true;
		try {
			const { saveReport } = await import('./save.ts');
			const result = await saveReport(workspace, engine, context, standard.definition);
			if ('error' in result) {
				toasts.show(result.error, { tone: 'error' });
				return;
			}
			toasts.show(`Saved as the view ${result.name}; change its expose to change what it covers.`, {
				tone: 'success',
				action: {
					label: 'Undo',
					run: () => {
						const undone = workspace.undo();
						if (undone) toasts.show(`Undid: ${undone}`);
					}
				}
			});
			// Open it once the model has been read again.
			for (let i = 0; i < 40; i++) {
				if (workspace.views.some((v) => v.name === result.name)) {
					ui.open({ kind: 'view', name: result.name, title: viewTitle(result.name) });
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		} finally {
			saving = false;
		}
	}

	// The report's stylesheet and page set-up (headers, page numbers) while it is open.
	$effect(() => {
		const style = document.createElement('style');
		style.dataset.report = '';
		style.textContent = `${reportCss}\n${APP_PRINT_CSS}\n${doc ? pageCss(doc) : ''}`;
		document.head.append(style);
		return () => style.remove();
	});

	/** Text after a name, kept on its line when it starts with punctuation (", "). */
	/** Punctuation right after a link, kept on the link's line ("A, B"). */
	const PUNCTUATION = /^[,;.)]+/;
	function trailing(text: Text, i: number): string {
		const next = text[i + 1];
		return next && !next.ref && !next.code ? (next.text.match(PUNCTUATION)?.[0] ?? '') : '';
	}
	/** A plain run without the punctuation its preceding link already shows. */
	function rest(text: Text, i: number): string {
		const run = text[i]!;
		return i > 0 && text[i - 1]!.ref ? run.text.replace(PUNCTUATION, '') : run.text;
	}

	const tones = new Set(['ok', 'warn', 'bad']);
	const headingTag = (depth: number) => `h${Math.min(6, depth + 2)}`;
	const isEntry = (s: Section, depth: number) =>
		depth >= 2 && !s.sections.length && !!(s.tag || s.ref);
	const anchor = (id: string) => `rd-${id}`;
	const chapters = $derived(doc?.sections ?? []);
	const metaRows = $derived(
		doc
			? ([
					['Document', doc.number],
					['Version', doc.version],
					['Status', doc.status],
					['Author', doc.author],
					['Date', doc.date]
				].filter(([, v]) => v) as [string, string][])
			: []
	);
</script>

{#snippet runs(text: Text)}{#each text as run, i (i)}{#if run.ref}<span class="rd-tie"
				><button type="button" class="rd-ref" onclick={() => select(run.ref!)}>{run.text}</button
				>{trailing(text, i)}</span
			>{:else if run.code}<code>{run.text}</code>{:else}{rest(text, i)}{/if}{/each}{/snippet}

{#snippet tree(items: TreeItem[])}
	{#each items as item, i (i)}
		<li>
			{@render runs(item.text)}
			{#if item.children.length}<ul>{@render tree(item.children)}</ul>{/if}
		</li>
	{/each}
{/snippet}

{#snippet block(b: Block)}
	{#if b.type === 'paragraph'}
		<p class:rd-muted={b.muted}>{@render runs(b.text)}</p>
	{:else if b.type === 'statement'}
		<p class="rd-statement">{@render runs(b.text)}</p>
	{:else if b.type === 'facts'}
		<dl class="rd-facts">
			{#each b.facts as fact, i (i)}
				<dt>{fact.label}</dt>
				<dd>{@render runs(fact.value)}</dd>
			{/each}
		</dl>
	{:else if b.type === 'table'}
		<div class="rd-table-wrap">
			<table class="rd-table">
				{#if b.caption}<caption>{b.caption}</caption>{/if}
				<thead>
					<tr>
						{#each b.columns as column, c (c)}
							<th scope="col" class:num={b.numeric?.[c]}>{column}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each b.rows as row, r (r)}
						<tr>
							{#each row as cell, c (c)}
								<td class:num={b.numeric?.[c]} data-label={b.columns[c]}
									><span>{@render runs(cell)}</span></td
								>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if b.type === 'metrics'}
		<dl class="rd-metrics">
			{#each b.items as m, i (i)}
				<div class="rd-metric {m.tone && tones.has(m.tone) ? m.tone : ''}">
					<dt>{m.label}</dt>
					<dd>
						{m.value}{#if m.detail}<span class="rd-detail">{m.detail}</span>{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{:else if b.type === 'tree'}
		<ul class="rd-tree">{@render tree(b.items)}</ul>
	{:else if b.type === 'note'}
		<p class="rd-note {b.tone}"><strong>{b.label}</strong>{@render runs(b.text)}</p>
	{:else if b.type === 'diagram'}
		<figure class="rd-figure">
			<div class="rd-diagram" role="img" aria-label={b.alt}>
				<!-- Built by diagram.ts with every name escaped. -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html b.svg}
			</div>
			<figcaption>{b.caption}</figcaption>
		</figure>
	{/if}
{/snippet}

{#snippet section(s: Section, depth: number)}
	<section
		id={anchor(s.id)}
		class={depth === 1 ? 'rd-chapter' : isEntry(s, depth) ? 'rd-entry' : 'rd-section'}
	>
		<svelte:element this={headingTag(depth)} class="rd-heading" tabindex="-1">
			<span class="rd-num">{s.number}</span>
			{#if s.tag}<span class="rd-tag">{s.tag}</span>{/if}
			{#if s.ref}<button type="button" class="rd-ref" onclick={() => select(s.ref!)}
					>{s.title}</button
				>{:else}<span>{s.title}</span>{/if}
			{#if s.badge}<span class="rd-badge {tones.has(s.badge.tone) ? s.badge.tone : ''}"
					>{s.badge.text}</span
				>{/if}
		</svelte:element>
		{#each s.blocks as b, i (i)}{@render block(b)}{/each}
		{#each s.sections as child (child.id)}{@render section(child, depth + 1)}{/each}
	</section>
{/snippet}

<div class="report-screen" bind:this={scroller}>
	<div class="toolbar">
		<div class="what">
			<span class="eyebrow">{doc?.kindLabel ?? standard?.title ?? 'Report'}</span>
			<code class="keyword"
				>{info?.isUsage
					? `view ${info.name} : ${info.definition ?? ''}`
					: `view def ${standard?.definition ?? name}`}</code
			>
		</div>
		<div class="actions">
			<button type="button" onclick={print} disabled={!doc} title="Print, or save as PDF">
				<Printer size={16} aria-hidden="true" /><span>Print / PDF</span>
			</button>
			<button
				type="button"
				onclick={downloadHtml}
				disabled={!doc}
				title="Download as one HTML file"
			>
				<FileDown size={16} aria-hidden="true" /><span>HTML</span>
			</button>
			<button type="button" onclick={downloadMarkdown} disabled={!doc} title="Download as Markdown">
				<FileText size={16} aria-hidden="true" /><span>Markdown</span>
			</button>
			{#if info?.isUsage && !info.builtin}
				<button type="button" onclick={showSource} title="Show the view in its SysML file">
					<Code size={16} aria-hidden="true" /><span>SysML</span>
				</button>
			{:else if standard}
				<button
					type="button"
					onclick={save}
					disabled={!doc || saving}
					title="Save this report as a view in the model, to change what it covers"
				>
					<BookmarkPlus size={16} aria-hidden="true" /><span>Save to model</span>
				</button>
			{/if}
		</div>
	</div>

	{#if error}
		<p class="state" role="alert">The report could not be built: {error}</p>
	{:else if !doc}
		<p class="state">
			<LoaderCircle size={16} class="spin" aria-hidden="true" /> Building the report…
		</p>
	{:else}
		<div class="layout">
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<article class="rd rd-printable" bind:this={article} aria-label={doc.title} {onclick}>
				<header class="rd-title-page">
					<p class="rd-kind">{doc.kindLabel}</p>
					<h2 class="rd-title">{doc.title}</h2>
					<p class="rd-project">{doc.project}</p>
					{#if doc.description}<p class="rd-description">{doc.description}</p>{/if}
					<dl class="rd-meta">
						{#each metaRows as [label, value] (label)}
							<div>
								<dt>{label}</dt>
								<dd>{value}</dd>
							</div>
						{/each}
						<div class="rd-wide">
							<dt>Covers</dt>
							<dd>
								{#if doc.scope.length}{#each doc.scope as s, i (i)}{i ? ', ' : ''}<code>{s}</code
										>{/each}{:else}The whole model{/if}
							</dd>
						</div>
					</dl>
					{#if doc.summary.length}
						<dl class="rd-metrics">
							{#each doc.summary as m (m.label)}
								<div class="rd-metric">
									<dt>{m.label}</dt>
									<dd>{m.value}</dd>
								</div>
							{/each}
						</dl>
					{/if}
				</header>

				<nav class="rd-contents" aria-labelledby="rd-contents-label">
					<h3 class="rd-label" id="rd-contents-label">Contents</h3>
					<ol>
						{#each chapters as c (c.id)}
							<li>
								<a href="#{anchor(c.id)}"><span class="rd-num">{c.number}</span>{c.title}</a>
								{#if c.sections.length}
									<ol>
										{#each c.sections as s (s.id)}
											<li>
												<a href="#{anchor(s.id)}"
													><span class="rd-num">{s.number}</span>{s.tag
														? `${s.tag} `
														: ''}{s.title}</a
												>
											</li>
										{/each}
									</ol>
								{/if}
							</li>
						{/each}
					</ol>
				</nav>

				{#each chapters as c (c.id)}{@render section(c, 1)}{/each}

				<footer class="rd-footer">
					Generated by SysML Web from the {doc.project} model on {doc.date}. View
					<code>{doc.view}</code>.
				</footer>
			</article>

			<nav class="mini-toc" aria-label="On this page">
				<p class="mini-title">On this page</p>
				<ol>
					{#each chapters as c (c.id)}
						<li>
							<a
								href="#{anchor(c.id)}"
								class:current={current === anchor(c.id)}
								aria-current={current === anchor(c.id) ? 'location' : undefined}
								onclick={(event) => {
									event.preventDefault();
									document.getElementById(anchor(c.id))?.scrollIntoView({ behavior: 'smooth' });
								}}><span class="n">{c.number}</span>{c.title}</a
							>
						</li>
					{/each}
				</ol>
			</nav>
		</div>
	{/if}
</div>

<style>
	/* A link and the comma after it wrap together; long names still wrap inside the link. */
	.rd-tie {
		white-space: nowrap;
	}
	.rd-tie :global(.rd-ref) {
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.report-screen {
		container: report / inline-size;
		height: 100%;
		overflow-y: auto;
		background: var(--bg);
		scroll-padding-top: 4.5rem;
	}
	.toolbar {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg) 88%, transparent);
		backdrop-filter: blur(8px);
	}
	.what {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		min-width: 0;
	}
	.eyebrow {
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
	}
	.keyword {
		overflow: hidden;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.actions {
		display: flex;
		flex-shrink: 0;
		gap: var(--space-2);
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			border-color var(--duration) var(--ease),
			background var(--duration) var(--ease);
	}
	.actions button:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface-hover);
	}
	.actions button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-6) auto;
		max-width: 46rem;
		padding: 0 var(--space-5);
		color: var(--text-2);
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 50rem) 12.5rem;
		justify-content: center;
		align-items: start;
		gap: var(--space-6);
		padding: var(--space-6) var(--space-5) var(--space-7);
	}

	/* The report on a sheet of paper, in the app's colours. */
	@media screen {
		.layout :global(.rd) {
			--rd-paper: var(--surface);
			--rd-ink: var(--text);
			--rd-ink-2: var(--text-2);
			--rd-ink-3: var(--text-3);
			--rd-rule: var(--border);
			--rd-rule-strong: var(--border-strong);
			--rd-tint: var(--surface-2);
			--rd-accent: var(--accent);
			--rd-accent-weak: var(--accent-weak);
			--rd-ok: var(--ok);
			--rd-ok-weak: var(--ok-weak);
			--rd-warn: var(--warn);
			--rd-warn-weak: var(--warn-weak);
			--rd-bad: var(--danger);
			--rd-bad-weak: var(--danger-weak);
			--rd-structure: var(--kind-structure);
			--rd-interface: var(--kind-interface);
			min-width: 0;
			padding: 3.5rem 4rem 3rem;
			border: 1px solid var(--border);
			border-radius: var(--radius-md);
			box-shadow: var(--shadow-sm);
		}
	}
	.layout :global(.rd-ref) {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		text-align: inherit;
		cursor: pointer;
	}
	.layout :global(button.rd-ref:hover) {
		color: var(--accent);
		text-decoration-color: var(--accent);
	}
	.layout :global(.rd-heading:focus) {
		outline: none;
	}
	.mini-toc {
		position: sticky;
		top: 4.25rem;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
		font-size: var(--text-sm);
	}
	.mini-title {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-3);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.mini-toc ol {
		margin: 0;
		padding: 0;
		list-style: none;
		border-left: 1px solid var(--border);
	}
	.mini-toc a {
		display: flex;
		gap: var(--space-2);
		margin-left: -1px;
		padding: 0.3rem var(--space-3);
		border-left: 2px solid transparent;
		color: var(--text-2);
		text-decoration: none;
		line-height: 1.35;
	}
	.mini-toc a:hover {
		color: var(--text);
	}
	.mini-toc a.current {
		border-left-color: var(--accent);
		color: var(--accent);
		font-weight: 550;
	}
	.mini-toc .n {
		min-width: 1.1rem;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	@container report (max-width: 1080px) {
		.layout {
			grid-template-columns: minmax(0, 50rem);
		}
		.mini-toc {
			display: none;
		}
	}
	@container report (max-width: 900px) {
		.what .keyword {
			display: none;
		}
	}
	@container report (max-width: 640px) {
		.what {
			display: none;
		}
		.actions {
			flex: 1;
			justify-content: space-between;
		}
		.actions button {
			flex: 1;
			justify-content: center;
			height: 2.75rem;
			padding: 0 var(--space-2);
		}
		.layout {
			padding: 0;
		}
	}
	@media screen {
		@container report (max-width: 640px) {
			.layout :global(.rd) {
				padding: var(--space-5) var(--space-4) var(--space-7);
				border: 0;
				border-radius: 0;
				box-shadow: none;
			}
		}
	}
	@container report (max-width: 440px) {
		.actions button {
			flex-direction: column;
			gap: 2px;
			height: 3rem;
			font-size: 0.6875rem;
			white-space: nowrap;
		}
	}
</style>
