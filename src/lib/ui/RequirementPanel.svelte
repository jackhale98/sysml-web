<script lang="ts">
	import { CircleAlert, FileCode, Link2, X } from '@lucide/svelte';
	import type { RequirementRow } from '#lib/project/requirements.ts';
	import { humanize, statusLabel } from '#lib/project/status.ts';
	import { excerpt, sliceBytes } from '#lib/project/source.ts';
	import type { ProjectFile } from '#lib/project/workspace.svelte.ts';
	import Pill from './Pill.svelte';

	let {
		requirement,
		file,
		onclose
	}: { requirement: RequirementRow; file: ProjectFile | undefined; onclose: () => void } = $props();

	const status = $derived(statusLabel(requirement.status));
	const source = $derived(
		file
			? excerpt(
					sliceBytes(file.text, requirement.span.start_byte, requirement.span.end_byte),
					requirement.span.start_col
				)
			: ''
	);
	const fields = $derived(
		[
			['Kind', requirement.kind && humanize(requirement.kind)],
			['Priority', requirement.priority && humanize(requirement.priority)],
			['Verification', requirement.verificationMethods.map(humanize).join(', ')],
			['Owner', requirement.owner]
		].filter((f): f is [string, string] => Boolean(f[1]))
	);
</script>

<aside class="panel" aria-labelledby="requirement-title">
	<div class="top">
		<span class="id mono">{requirement.id ?? 'No ID'}</span>
		<Pill tone={status.tone}>{status.label}</Pill>
		<button class="close" type="button" onclick={onclose} aria-label="Close details">
			<X size={17} />
		</button>
	</div>
	<h2 id="requirement-title">{requirement.title}</h2>
	{#if requirement.text}
		<p class="text">{requirement.text}</p>
	{:else}
		<p class="text empty">No requirement text yet.</p>
	{/if}

	{#if fields.length}
		<dl>
			{#each fields as [label, value] (label)}
				<dt>{label}</dt>
				<dd>{value}</dd>
			{/each}
		</dl>
	{/if}

	{#if requirement.rationale}
		<section>
			<h3>Rationale</h3>
			<p>{requirement.rationale}</p>
		</section>
	{/if}

	{#if requirement.issues.length}
		<section>
			<h3>Open issues</h3>
			<ul class="issues">
				{#each requirement.issues as issue, i (i)}
					<li><CircleAlert size={15} /> {issue}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		<h3>Allocated to</h3>
		{#if requirement.satisfiedBy.length}
			<ul class="links">
				{#each requirement.satisfiedBy as target (target)}
					<li><Link2 size={14} /> <span class="mono">{target}</span></li>
				{/each}
			</ul>
		{:else}
			<p class="gap">Not allocated to any part of the design yet.</p>
		{/if}
	</section>

	<section>
		<h3>Verified by</h3>
		{#if requirement.verifiedBy.length}
			<ul class="links">
				{#each requirement.verifiedBy as target (target)}
					<li><Link2 size={14} /> <span class="mono">{target}</span></li>
				{/each}
			</ul>
		{:else}
			<p class="gap">No test covers this requirement yet.</p>
		{/if}
	</section>

	<details>
		<summary>
			<FileCode size={15} />
			<span>Show SysML</span>
			<span class="where">{requirement.file}:{requirement.span.start_row}</span>
		</summary>
		<!-- Scrollable code must be reachable by keyboard (WCAG 2.1.1). -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<pre tabindex="0" aria-label="SysML source"><code>{source}</code></pre>
	</details>
</aside>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}
	.top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.id {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	h2 {
		font-size: var(--text-xl);
		margin-top: calc(-1 * var(--space-2));
	}
	.text {
		font-size: var(--text-lg);
		line-height: 1.55;
	}
	.empty,
	.gap {
		color: var(--text-3);
	}
	.gap {
		color: var(--warn);
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	dt {
		color: var(--text-3);
	}
	dd {
		margin: 0;
	}
	h3 {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
		margin-bottom: var(--space-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.links li,
	.issues li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.links li {
		color: var(--text-3);
	}
	.links .mono {
		color: var(--text);
		font-size: var(--text-sm);
	}
	.issues li {
		color: var(--warn);
	}
	details {
		border-top: 1px solid var(--border);
		padding-top: var(--space-3);
	}
	summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		color: var(--text-2);
		font-weight: 550;
	}
	.where {
		margin-left: auto;
		color: var(--text-3);
		font-weight: 400;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	pre {
		margin: var(--space-3) 0 0;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		overflow-x: auto;
		font-size: var(--text-sm);
		line-height: 1.6;
	}
</style>
