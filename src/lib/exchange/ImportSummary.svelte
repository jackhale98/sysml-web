<script lang="ts">
	/**
	 * What an import of SysML v2 JSON brought across, in plain words: one
	 * sentence, the groups of things that didn't come across (each a few
	 * lines, the rest in the downloadable list), and the files it makes.
	 */
	import { CircleCheck, Download, FileText, TriangleAlert } from '@lucide/svelte';
	import { download } from '#lib/project/sources.ts';
	import { importReportText, summarizeImport } from './report';
	import type { InterchangeImport } from './types';
	import './exchange.css';

	let { result, source }: { result: InterchangeImport; source: string } = $props();

	const summary = $derived(summarizeImport(result));
	const SHOWN = 6;
	const problems = $derived(result.problems.filter((p) => p.severity !== 'info'));

	function downloadList() {
		const stem = source.replace(/\.json$/i, '').replace(/[^\w.-]+/g, '-') || 'import';
		download(`${stem}-import-report.txt`, importReportText(result, source), 'text/plain');
	}
</script>

<div class="summary xc-stack" data-testid="import-summary">
	<p class="xc-note {summary.tone === 'success' ? 'ok' : 'warn'}" role="status">
		{#if summary.tone === 'success'}<CircleCheck
				size={16}
				aria-hidden="true"
			/>{:else}<TriangleAlert size={16} aria-hidden="true" />{/if}
		<span>{summary.headline}</span>
	</p>

	{#each summary.groups as group (group.title)}
		<section class="group" aria-label={group.title}>
			<h3>{group.title} <span class="count">{group.notes.length}</span></h3>
			<ul class="xc-list">
				{#each group.notes.slice(0, SHOWN) as note, i (i)}
					<li>
						{#if note.element}<code>{note.element}</code><br />{/if}{note.message}
					</li>
				{/each}
			</ul>
			{#if group.notes.length > SHOWN}
				<p class="xc-muted">And {group.notes.length - SHOWN} more in the list.</p>
			{/if}
		</section>
	{/each}

	{#if problems.length}
		<section class="group" aria-label="Problems in the text">
			<h3>Problems in the text <span class="count">{problems.length}</span></h3>
			<ul class="xc-list">
				{#each problems.slice(0, SHOWN) as p, i (i)}
					<li><code>{p.file}:{p.line}</code><br />{p.message}</li>
				{/each}
			</ul>
			<p class="xc-muted">They show in the Problems panel once the project is open.</p>
		</section>
	{/if}

	<section class="group" aria-label="Files">
		<h3>Files <span class="count">{result.files.length}</span></h3>
		<p class="files">
			{#each result.files as f (f.path)}<span
					><FileText size={13} aria-hidden="true" />{f.path}</span
				>{/each}
		</p>
	</section>

	<div>
		<button type="button" class="xc-button xc-small" onclick={downloadList}>
			<Download size={15} aria-hidden="true" /> Download the full list
		</button>
	</div>
</div>

<style>
	.group {
		display: grid;
		gap: var(--space-1);
	}
	h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.count {
		padding: 0 7px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.files {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		font-size: var(--text-sm);
	}
	.files span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
</style>
