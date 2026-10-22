<script lang="ts">
	/**
	 * "Download as SysML v2 JSON": the project as the standard element JSON
	 * (KerML 10.4, what the Systems Modeling API exchanges), with or without
	 * the standard library and the derived properties. What was left out is
	 * said in the dialog after the download.
	 */
	import { CircleCheck, Download, FileJson, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { startSpareEngine } from '#lib/engine/instance.ts';
	import { download } from '#lib/project/sources.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import type { InterchangeExport } from './types';
	import './exchange.css';

	let {
		open = $bindable(false),
		workspace,
		engine,
		onhelp
	}: {
		open?: boolean;
		workspace: Workspace;
		engine: Engine;
		onhelp?: () => void;
	} = $props();

	const uid = $props.id();
	let scope = $state<'model' | 'library'>('model');
	let withDerived = $state(false);
	type Done = Omit<InterchangeExport, 'json'> & { file: string; bytes: number };
	let phase = $state<
		| { kind: 'choose' }
		| { kind: 'working' }
		| { kind: 'done'; result: Done }
		| { kind: 'error'; message: string }
	>({ kind: 'choose' });

	$effect(() => {
		if (open) phase = { kind: 'choose' };
	});

	const stem = $derived(
		(workspace.info?.name ?? 'model').trim().replace(/[^\w.-]+/g, '-') || 'model'
	);
	const fmt = (n: number) => n.toLocaleString('en');
	const size = (bytes: number) =>
		bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} kB`;

	async function run() {
		phase = { kind: 'working' };
		const files = workspace.sourceFiles();
		// The library is large: a worker of its own does it, and takes its memory with it.
		const spare = scope === 'library' ? startSpareEngine() : null;
		try {
			const { json, ...result } = await (spare ?? engine).exportInterchange(files, {
				derived: withDerived,
				library: scope === 'library'
			});
			const file = `${stem}.json`;
			download(file, json, 'application/json');
			phase = { kind: 'done', result: { ...result, file, bytes: new Blob([json]).size } };
		} catch (error) {
			phase = {
				kind: 'error',
				message: (error instanceof Error ? error.message : String(error)).replace(/^\w*Error: /, '')
			};
		} finally {
			spare?.terminate();
		}
	}
</script>

<SheetDialog
	bind:open
	title="Download as SysML v2 JSON"
	description="The standard element JSON other SysML v2 tools and API servers read."
	testid="export-json"
>
	{#snippet icon()}<FileJson size={20} aria-hidden="true" />{/snippet}
	{#if phase.kind === 'done'}
		{@const r = phase.result}
		<div class="xc-stack" data-testid="export-result">
			<p class="xc-note ok" role="status">
				<CircleCheck size={16} aria-hidden="true" />
				<span
					>Downloaded <strong>{r.file}</strong> ({size(r.bytes)}): {fmt(r.elements)} elements of your
					model{#if r.libraryElements}, and {fmt(r.libraryElements)} of the standard library{/if}.</span
				>
			</p>
			<ul class="xc-list facts">
				<li>
					{#if r.libraryElements}Every reference resolves within the file.{:else}{fmt(
							r.libraryReferences
						)} references point at the standard library by its standard ids, which every SysML v2 tool
						knows.{/if}
				</li>
				<li>Ids stay the same from one download to the next while names and files stay put.</li>
			</ul>
			{#if r.leftOut.length}
				<div class="xc-note warn">
					<TriangleAlert size={16} aria-hidden="true" />
					<div>
						<p>
							{r.leftOut.length === 1
								? 'One reference resolves to nothing, so it was left out:'
								: `${r.leftOut.length} references resolve to nothing, so they were left out:`}
						</p>
						<ul class="xc-list">
							{#each r.leftOut.slice(0, 8) as l, i (i)}
								<li><code>{l.element}</code> → <code>{l.reference}</code></li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}
			{#if r.broken.length}
				<p class="xc-note warn">
					<TriangleAlert size={16} aria-hidden="true" />
					<span
						>{r.broken.length === 1 ? 'A file has' : `${r.broken.length} files have`} syntax errors: only
						what parses is in the download ({r.broken.join(', ')}).</span
					>
				</p>
			{/if}
		</div>
	{:else if phase.kind === 'error'}
		<p class="xc-note danger" role="alert">
			<TriangleAlert size={16} aria-hidden="true" /><span>{phase.message}</span>
		</p>
	{:else}
		<div class="xc-stack">
			<fieldset class="xc-options" disabled={phase.kind === 'working'}>
				<legend>What to include</legend>
				<label class="xc-option">
					<input type="radio" name="{uid}-scope" value="model" bind:group={scope} />
					<strong>Only my model</strong>
					<span
						>The elements of your files. References to the standard library use its standard ids,
						which other tools know.</span
					>
				</label>
				<label class="xc-option">
					<input type="radio" name="{uid}-scope" value="library" bind:group={scope} />
					<strong>Include the standard library</strong>
					<span
						>About 91,000 more elements (tens of MB), so the file stands on its own. Takes a while;
						best on a computer.</span
					>
				</label>
			</fieldset>
			<label class="xc-option">
				<input type="checkbox" bind:checked={withDerived} disabled={phase.kind === 'working'} />
				<strong>Add derived properties</strong>
				<span
					>Names, owners and the like, worked out, plus implied relationships: every property the
					OMG schema lists. For tools that don't work them out themselves; about twice the size.</span
				>
			</label>
			{#if onhelp}
				<p class="xc-muted">
					What comes across and what doesn't: <button type="button" class="link" onclick={onhelp}
						>Exchange models with other tools</button
					>.
				</p>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		{#if phase.kind === 'done' || phase.kind === 'error'}
			<button type="button" class="xc-button" onclick={() => (phase = { kind: 'choose' })}>
				Back
			</button>
			<button type="button" class="xc-primary" onclick={() => (open = false)}>Done</button>
		{:else}
			<button type="button" class="xc-button" onclick={() => (open = false)}>Cancel</button>
			<button type="button" class="xc-primary" disabled={phase.kind === 'working'} onclick={run}>
				{#if phase.kind === 'working'}
					<LoaderCircle size={16} class="xc-spin" aria-hidden="true" /> Writing…
				{:else}
					<Download size={16} aria-hidden="true" /> Download .json
				{/if}
			</button>
		{/if}
	{/snippet}
</SheetDialog>

<style>
	.facts li {
		color: var(--text-2);
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
