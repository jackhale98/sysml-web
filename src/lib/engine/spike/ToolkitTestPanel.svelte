<script lang="ts">
	import { onMount } from 'svelte';
	import { report, stress, type Stats } from './bench.ts';

	/**
	 * TEST BUILD: the toolkit engine's numbers on screen, for trying it on a
	 * phone where there is no console. Shown only with `?toolkit`.
	 */
	let { stats }: { stats: Stats } = $props();

	let view = $state<Stats>({ params: {}, longTasks: [], done: false });
	let open = $state(true);
	let copied = $state(false);

	onMount(() => {
		const update = () => (view = { ...stats, stress: stats.stress && { ...stats.stress } });
		update();
		window.addEventListener('toolkit-stats', update);
		return () => window.removeEventListener('toolkit-stats', update);
	});

	const variants = [
		['none', 'No snapshot (default)'],
		['prepared', 'Prepared snapshot'],
		['libcache', 'Library cache'],
		['subset', 'Demo packages only'],
		['ours', 'Our engine, for comparison']
	] as const;
	const current = $derived(view.boot?.variant ?? (view.params.toolkit || 'none'));
	const seconds = (ms: number | undefined) =>
		ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`;
	const mb = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)} MB`);
	const step = (name: string) => view.boot?.steps[name]?.ms;
	const first = $derived(
		view.firstAnalysis as
			| { ms?: number; findings?: number; errors?: number; unresolved?: number; mem?: number }
			| undefined
	);
	const runs = $derived(view.stress?.runs ?? []);
	const median = $derived(
		runs.length
			? [...runs].map((r) => r.ms).sort((a, b) => a - b)[Math.floor(runs.length / 2)]
			: undefined
	);
	const nav = $derived(
		view.stress?.navigate as
			{ hoverMs?: number; definitionMs?: number; lspInitMs?: number } | undefined
	);

	const analysisText = $derived(
		[
			seconds(first?.ms),
			first?.findings === undefined ? '' : `${first.findings} findings`,
			first?.unresolved === undefined ? '' : `${first.unresolved} unresolved`
		]
			.filter(Boolean)
			.join(' · ')
	);
	const navText = $derived(
		nav
			? `${nav.hoverMs ?? '—'} ms, ${nav.definitionMs ?? '—'} ms` +
					(nav.lspInitMs ? ` (start ${nav.lspInitMs} ms)` : '')
			: ''
	);

	function href(variant: string) {
		return location.pathname + (variant === 'none' ? '?toolkit' : `?toolkit=${variant}`);
	}

	async function copy() {
		const text = report(stats);
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard refused: show the text so it can be selected by hand.
			prompt('Copy these results', text);
		}
	}
</script>

<section class="panel" class:closed={!open} aria-labelledby="tk-title">
	<button type="button" class="head" aria-expanded={open} onclick={() => (open = !open)}>
		<strong id="tk-title">Toolkit engine test</strong>
		<span class="status {view.status ?? 'waiting'}">
			{view.status === 'ready'
				? `Ready in ${seconds(view.timeToReadyMs)}`
				: view.status === 'error'
					? 'Failed'
					: view.status === 'loading'
						? 'Loading…'
						: 'Waiting for the model'}
		</span>
	</button>

	{#if open}
		<div class="body">
			{#if view.unfinished}
				<p class="warn">
					The last test ({view.unfinished.variant}, {view.unfinished.step}) didn't finish. If the
					page reloaded by itself, the browser probably closed it for using too much memory.
				</p>
			{/if}
			{#if view.error}<p class="warn">{view.error}</p>{/if}

			<dl>
				<dt>Engine</dt>
				<dd>{view.boot ? `${view.boot.engine} ${view.boot.version}` : '—'} · {current}</dd>
				<dt>Download + compile</dt>
				<dd>{seconds(step('wasmDownloadAndCompile'))}</dd>
				<dt>Library</dt>
				<dd>
					{seconds(
						Math.max(
							step('bundleDownload') ?? 0,
							step('libcacheDownload') ?? 0,
							step('preparedDownload') ?? 0
						) || undefined
					)} download · {seconds(step('libraryLoad'))} load
				</dd>
				<dt>First analysis</dt>
				<dd>
					{analysisText}
				</dd>
				<dt>Memory</dt>
				<dd>
					{mb(view.boot?.memAfterLibrary)} after library · {mb(first?.mem)} after analysis
				</dd>
				{#if runs.length}
					<dt>Re-analysis</dt>
					<dd>
						{runs.length} edits, median {seconds(median)} · memory {mb(view.stress?.memBefore)} → {mb(
							runs[runs.length - 1]?.mem
						)}
					</dd>
				{/if}
				{#if nav}
					<dt>Hover, definition</dt>
					<dd>
						{navText}
					</dd>
				{/if}
			</dl>

			<div class="actions">
				<button
					type="button"
					disabled={view.status !== 'ready' || view.stressing}
					onclick={() => void stress(stats)}
				>
					{view.stressing ? `Editing… ${runs.length}/20` : 'Stress: 20 edits'}
				</button>
				<button type="button" disabled={!view.done} onclick={copy}>
					{copied ? 'Copied' : 'Copy results'}
				</button>
			</div>

			<nav aria-label="Try another setup">
				{#each variants as [variant, label] (variant)}
					<!-- A full reload, so each setup starts from a fresh worker and memory. -->
					<button
						type="button"
						aria-pressed={variant === current}
						onclick={() => location.assign(href(variant))}>{label}</button
					>
				{/each}
			</nav>
		</div>
	{/if}
</section>

<style>
	.panel {
		position: fixed;
		z-index: 60;
		top: calc(env(safe-area-inset-top, 0px) + 3.5rem);
		right: max(0.5rem, env(safe-area-inset-right, 0px));
		width: min(22rem, calc(100vw - 1rem));
		max-height: calc(100dvh - 9rem);
		overflow: auto;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		font-size: var(--text-sm);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.status {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.status.ready {
		color: var(--success, var(--accent));
	}
	.status.error {
		color: var(--danger);
	}
	.body {
		display: grid;
		gap: var(--space-3);
		padding: 0 var(--space-3) var(--space-3);
	}
	.warn {
		margin: 0;
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--danger) 12%, var(--surface));
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px var(--space-3);
		margin: 0;
	}
	dt {
		color: var(--text-2);
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.actions button {
		flex: 1;
		min-height: 2.75rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
	}
	.actions button:disabled {
		opacity: 0.55;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	nav button {
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: transparent;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	nav button[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-weak);
		color: var(--accent);
	}
</style>
