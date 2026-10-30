<script lang="ts">
	import { ArrowRight, Search } from '@lucide/svelte';
	import { tick } from 'svelte';
	import type { GuideAction } from '#lib/workbench/guide.ts';
	import { HELP, inlineParts, searchHelp, type Block, type HelpTopic } from './content.ts';

	/**
	 * The help guide: searchable, in sections, each topic with a button that
	 * does what it describes when the host can (`onaction`). Shown in the
	 * workbench's help sheet and on the /help page.
	 */
	let {
		topic = null,
		onaction,
		canRun = () => !!onaction,
		headingLevel = 2,
		focusSearch = false
	}: {
		/** A topic to show first (scrolled to). */
		topic?: string | null;
		onaction?: (action: GuideAction) => void;
		/** Whether a topic's action can be offered here. */
		canRun?: (action: GuideAction) => boolean;
		/** The level of the section headings (topics are one below). */
		headingLevel?: 2 | 3;
		/** Start in the search box (in a dialog, where focus goes first). */
		focusSearch?: boolean;
	} = $props();

	const uid = $props.id();
	let query = $state('');
	let root = $state<HTMLElement>();
	const results = $derived(query.trim() ? searchHelp(query) : null);
	const topicId = (id: string) => `${uid}-${id}`;

	// Show the topic asked for.
	$effect(() => {
		const id = topic;
		if (!id || !root) return;
		query = '';
		void tick().then(() => {
			const target = document.getElementById(topicId(id));
			target?.scrollIntoView({ block: 'start' });
			target?.focus({ preventScroll: true });
		});
	});

	function jump(event: MouseEvent, id: string) {
		event.preventDefault();
		const target = document.getElementById(id);
		target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		target?.focus({ preventScroll: true });
	}
</script>

{#snippet text(line: string)}
	{#each inlineParts(line) as part, i (i)}
		{#if part.kind === 'bold'}<strong>{part.text}</strong>{:else if part.kind === 'code'}<code
				>{part.text}</code
			>{:else}{part.text}{/if}
	{/each}
{/snippet}

{#snippet block(b: Block)}
	{#if typeof b === 'string'}
		<p>{@render text(b)}</p>
	{:else if 'list' in b}
		<ul>
			{#each b.list as item, i (i)}<li>{@render text(item)}</li>{/each}
		</ul>
	{:else if 'steps' in b}
		<ol>
			{#each b.steps as item, i (i)}<li>{@render text(item)}</li>{/each}
		</ol>
	{:else if 'code' in b}
		<!-- Focusable so keyboard users can scroll wide code. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<pre tabindex="0"><code>{b.code}</code></pre>
	{:else if 'keys' in b}
		<table class="keys">
			<tbody>
				{#each b.keys as [keys, does] (keys)}
					<tr>
						<th scope="row"><kbd>{keys}</kbd></th>
						<td>{does}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<div class="concept">
			<p class="concept-label">{b.label}</p>
			<p>{b.summary}</p>
			{#if b.analogy}<p class="analogy">{b.analogy}</p>{/if}
		</div>
	{/if}
{/snippet}

{#snippet topicBody(t: HelpTopic, level: number)}
	<section class="topic" id={topicId(t.id)} tabindex="-1" aria-labelledby="{topicId(t.id)}-title">
		<svelte:element this={`h${level}`} id="{topicId(t.id)}-title" class="topic-title"
			>{t.title}</svelte:element
		>
		{#each t.blocks as b, i (i)}{@render block(b)}{/each}
		{#if t.action && onaction && canRun(t.action.action)}
			{@const action = t.action.action}
			<button type="button" class="do" onclick={() => onaction(action)}>
				{t.action.label}
				<ArrowRight size={16} aria-hidden="true" />
			</button>
		{/if}
	</section>
{/snippet}

<div class="guide" bind:this={root}>
	<label class="search">
		<Search size={16} aria-hidden="true" />
		<span class="visually-hidden">Search the help</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="search"
			autofocus={focusSearch}
			bind:value={query}
			placeholder="Search the help"
			enterkeyhint="search"
		/>
	</label>

	{#if results}
		<p class="count" role="status">
			{results.length
				? `${results.length} topic${results.length === 1 ? '' : 's'} about “${query.trim()}”`
				: `Nothing about “${query.trim()}”. Try another word.`}
		</p>
		{#each results as t (t.id)}{@render topicBody(t, headingLevel)}{/each}
	{:else}
		<nav class="contents" aria-label="Help contents">
			<ul>
				{#each HELP as section (section.id)}
					<li>
						<a href="#{topicId(section.id)}" onclick={(e) => jump(e, topicId(section.id))}
							>{section.title}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
		{#each HELP as section (section.id)}
			<section
				class="section"
				id={topicId(section.id)}
				tabindex="-1"
				aria-labelledby="{topicId(section.id)}-title"
			>
				<svelte:element this={`h${headingLevel}`} id="{topicId(section.id)}-title"
					>{section.title}</svelte:element
				>
				<p class="intro">{section.intro}</p>
				{#each section.topics as t (t.id)}{@render topicBody(t, headingLevel + 1)}{/each}
			</section>
		{/each}
	{/if}
</div>

<style>
	.guide {
		display: grid;
		gap: var(--space-4);
		max-width: 46rem;
		margin: 0 auto;
		color: var(--text);
		line-height: 1.55;
	}
	.search {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text-2);
		box-shadow: 0 6px 12px -10px rgb(0 0 0 / 0.3);
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: 2.625rem;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: max(1rem, var(--text-md, 1rem));
		outline: none;
	}
	.search:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	.count {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.contents ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.contents a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
	}
	.contents a:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.section {
		display: grid;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
		scroll-margin-top: 3.5rem;
	}
	.section:focus,
	.topic:focus {
		outline: none;
	}
	.section > :global(h2),
	.section > :global(h3) {
		font-size: 1.35rem;
		letter-spacing: -0.015em;
	}
	.intro {
		color: var(--text-2);
	}
	.topic {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		scroll-margin-top: 3.5rem;
	}
	.topic-title {
		font-size: 1.05rem;
		font-weight: 650;
	}
	.topic p,
	.topic ul,
	.topic ol {
		margin: 0;
	}
	.topic ul,
	.topic ol {
		display: grid;
		gap: var(--space-1);
		padding-left: 1.25rem;
	}
	code {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.88em;
		overflow-wrap: anywhere;
	}
	pre {
		margin: 0;
		padding: var(--space-3);
		overflow-x: auto;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.45;
	}
	pre code {
		padding: 0;
		background: none;
		font-size: inherit;
	}
	.concept {
		display: grid;
		gap: 2px;
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--accent);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: var(--accent-weak);
	}
	.concept p {
		margin: 0;
	}
	.concept-label {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.analogy {
		color: var(--text-2);
		font-style: italic;
	}
	.keys {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.keys th,
	.keys td {
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border);
		text-align: left;
		vertical-align: top;
	}
	.keys tr:first-child th,
	.keys tr:first-child td {
		border-top: 0;
	}
	.keys th {
		width: 40%;
		padding-right: var(--space-3);
		font-weight: 400;
	}
	kbd {
		padding: 1px 6px;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
	.do {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: var(--space-2);
		min-height: 2.75rem;
		margin-top: var(--space-1);
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.do:hover {
		filter: brightness(1.05);
	}
</style>
