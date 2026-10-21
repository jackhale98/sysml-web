<script lang="ts">
	import { page } from '$app/state';
	import { CircleAlert, FileCode, Info, TriangleAlert } from '@lucide/svelte';
	import { useWorkspace } from '#lib/project/context.ts';

	const workspace = useWorkspace();
	let selectedPath = $state<string | null>(page.url.searchParams.get('file'));

	const files = $derived(workspace.modelFiles);
	const current = $derived(files.find((f) => f.path === selectedPath) ?? files[0]);
	const lines = $derived(current ? current.text.split('\n') : []);
	const problems = $derived(workspace.problems.filter((p) => p.file === current?.path));
	const problemLines = $derived(new Set(problems.map((p) => p.span.start_row)));

	function problemCount(path: string) {
		return workspace.problems.filter((p) => p.file === path && p.severity !== 'note').length;
	}

	/** Group files by folder for the file list. */
	const groups = $derived.by(() => {
		const byFolder: Record<string, typeof files> = {};
		for (const f of files) {
			const folder = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
			(byFolder[folder] ??= []).push(f);
		}
		return Object.entries(byFolder);
	});
</script>

<div class="page">
	<header>
		<h1>Model</h1>
		<p>
			The SysML v2 files behind this project. Everything you see elsewhere is read from these files.
			{#if workspace.engineVersion}<span class="engine">Engine {workspace.engineVersion}</span>{/if}
		</p>
	</header>

	<div class="layout">
		<nav class="files" aria-label="Files">
			{#each groups as [folder, items] (folder)}
				{#if folder}<h2>{folder}</h2>{/if}
				<ul>
					{#each items as f (f.path)}
						{@const n = problemCount(f.path)}
						<li>
							<button
								type="button"
								aria-current={f.path === current?.path ? 'true' : undefined}
								onclick={() => (selectedPath = f.path)}
							>
								<FileCode size={15} />
								<span class="name">{f.path.slice(folder ? folder.length + 1 : 0)}</span>
								{#if n}<span class="badge">{n}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/each}
		</nav>

		<section class="source" aria-label={current?.path ?? 'Source'}>
			{#if current}
				<div class="source-head mono">{current.path}</div>
				{#if problems.length}
					<ul class="problems">
						{#each problems as p, i (i)}
							<li class={p.severity}>
								{#if p.severity === 'error'}<CircleAlert
										size={15}
									/>{:else if p.severity === 'warning'}<TriangleAlert size={15} />{:else}<Info
										size={15}
									/>{/if}
								<span class="loc mono">{p.span.start_row}:{p.span.start_col}</span>
								<span>{p.message}</span>
							</li>
						{/each}
					</ul>
				{/if}
				<!-- Scrollable code must be reachable by keyboard (WCAG 2.1.1). -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<pre class="code" tabindex="0" aria-label="Source of {current.path}"><code
						>{#each lines as line, i (i)}<span class="line" class:flag={problemLines.has(i + 1)}
								><span class="ln" aria-hidden="true">{i + 1}</span>{line}
</span>{/each}</code
					></pre>
			{:else}
				<p class="empty">No SysML files in this project.</p>
			{/if}
		</section>
	</div>
</div>

<style>
	header {
		margin-bottom: var(--space-4);
	}
	h1 {
		font-size: var(--text-2xl);
	}
	header p {
		color: var(--text-2);
		margin-top: var(--space-1);
	}
	.engine {
		margin-left: var(--space-2);
		padding: 0.05rem 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.layout {
		display: grid;
		grid-template-columns: 16rem minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
	.files {
		position: sticky;
		top: calc(var(--topbar-height) + var(--space-5));
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.files h2 {
		margin: var(--space-3) var(--space-2) var(--space-1);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	.files h2:first-child {
		margin-top: var(--space-1);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.files button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		text-align: left;
		cursor: pointer;
	}
	.files button:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.files button[aria-current='true'] {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		font-size: var(--text-xs);
		padding: 0 0.4rem;
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
	}
	.source {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.source-head {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.problems {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		font-size: var(--text-sm);
	}
	.problems li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.problems .error {
		color: var(--danger);
	}
	.problems .warning {
		color: var(--warn);
	}
	.problems .note {
		color: var(--text-2);
	}
	.loc {
		color: var(--text-3);
		min-width: 3.5rem;
	}
	.code {
		margin: 0;
		padding: var(--space-3) 0;
		overflow-x: auto;
		font-size: var(--text-sm);
		line-height: 1.65;
	}
	.line {
		display: block;
		padding-right: var(--space-4);
	}
	.line.flag {
		background: var(--warn-weak);
	}
	.ln {
		display: inline-block;
		width: 3.5rem;
		padding-right: var(--space-4);
		text-align: right;
		color: var(--text-3);
		user-select: none;
	}
	.empty {
		padding: var(--space-6);
		color: var(--text-3);
	}
</style>
