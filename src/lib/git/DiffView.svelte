<script lang="ts">
	/** A readable line diff: changed lines with a little context, the rest folded. */
	import { diffStats, hunks, lineDiff } from './diff.ts';

	let {
		before,
		after,
		oldLabel = 'Before',
		newLabel = 'After'
	}: {
		before: string | null;
		after: string | null;
		oldLabel?: string;
		newLabel?: string;
	} = $props();

	const lines = $derived(lineDiff(before ?? '', after ?? ''));
	const shown = $derived(hunks(lines, 3));
	const stats = $derived(diffStats(lines));
	const SIGN = { add: '+', del: '−', equal: ' ' } as const;
	const SAY = { add: 'Added', del: 'Removed', equal: 'Unchanged' } as const;
</script>

<div class="diff">
	{#if !shown.length}
		<p class="same">No differences.</p>
	{:else}
		<table>
			<caption class="visually-hidden">
				{stats.added} lines added, {stats.removed} removed. {oldLabel} and {newLabel} line numbers.
			</caption>
			<thead class="visually-hidden">
				<tr><th>{oldLabel} line</th><th>{newLabel} line</th><th>Change</th><th>Text</th></tr>
			</thead>
			{#each shown as hunk, h (h)}
				<tbody>
					{#if hunk.skipped}
						<tr class="fold">
							<td colspan="4">⋯ {hunk.skipped} unchanged line{hunk.skipped === 1 ? '' : 's'}</td>
						</tr>
					{/if}
					{#each hunk.lines as line, i (i)}
						<tr class={line.op}>
							<td class="num">{line.old ?? ''}</td>
							<td class="num">{line.new ?? ''}</td>
							<td class="sign"
								><span aria-hidden="true">{SIGN[line.op]}</span><span class="visually-hidden"
									>{SAY[line.op]}</span
								></td
							>
							<td class="text">{line.text.replace(/\r?\n$/, '') || ' '}</td>
						</tr>
					{/each}
				</tbody>
			{/each}
		</table>
	{/if}
</div>

<style>
	.diff {
		overflow: auto;
		max-height: 22rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.55;
	}
	.same {
		padding: var(--space-3);
		color: var(--text-2);
		font-family: var(--font-ui);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	td {
		padding: 0 6px;
		vertical-align: top;
	}
	.num {
		width: 1%;
		min-width: 2.5ch;
		color: var(--text-3);
		text-align: right;
		user-select: none;
		white-space: nowrap;
	}
	.sign {
		width: 1%;
		padding: 0 2px;
		user-select: none;
	}
	.text {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.add {
		background: color-mix(in oklab, var(--ok) 13%, var(--surface));
	}
	.add .sign {
		color: var(--ok);
		font-weight: 700;
	}
	.del {
		background: color-mix(in oklab, var(--danger) 12%, var(--surface));
	}
	.del .sign {
		color: var(--danger);
		font-weight: 700;
	}
	.fold td {
		padding: 2px var(--space-3);
		background: var(--surface-2);
		color: var(--text-3);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
	}
</style>
