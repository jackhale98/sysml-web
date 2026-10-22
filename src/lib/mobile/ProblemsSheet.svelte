<script lang="ts">
	import { CircleAlert, CircleCheck, Info, TriangleAlert } from '@lucide/svelte';
	import type { Diagnostic } from '#lib/engine/types.ts';
	import { elementAt } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import Sheet from './Sheet.svelte';

	/** The model's problems, each a tap away from the text it is about. */
	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	const shown = $derived(workspace.problems.filter((p) => p.severity !== 'note'));
	const errors = $derived(shown.filter((p) => p.severity === 'error').length);
	const warnings = $derived(shown.length - errors);

	function show(problem: Diagnostic) {
		const { file, span } = problem;
		if (!file) return; // about the engine, not a file
		ui.problemsSheet = false;
		const element = elementAt(workspace.elements, file, span.start_byte);
		// A requirement the design doesn't meet is about a statement (the `satisfy`): show it.
		if (problem.code === 'check' && span.from !== undefined && span.to !== undefined) {
			if (element) ui.select(element.key, 'text');
			ui.revealText(file, span.from, span.to);
			return;
		}
		if (element) ui.select(element.key, 'inspector');
		ui.showText(file);
	}
</script>

<Sheet
	bind:open={ui.problemsSheet}
	label="Problems"
	title="Problems · {errors} errors, {warnings} warnings"
>
	{#if shown.length}
		<ul>
			{#each shown as p, i (i)}
				<li>
					<button type="button" class={p.severity} onclick={() => show(p)}>
						{#if p.severity === 'error'}<CircleAlert
								size={18}
							/>{:else if p.severity === 'warning'}<TriangleAlert size={18} />{:else}<Info
								size={18}
							/>{/if}
						<span class="text">
							<span class="msg">{p.message}</span>
							{#if p.file}<span class="loc">{p.file}:{p.span.start_row}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="none">
			<CircleCheck size={20} /> No problems. The model is consistent. Mistakes in the text show here as
			you type.
		</p>
	{/if}
</Sheet>

<style>
	ul {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	button {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		min-height: 3rem;
		padding: var(--space-2) var(--space-2);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	button:active {
		background: var(--surface-hover);
	}
	button :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.error :global(svg) {
		color: var(--danger);
	}
	.warning :global(svg) {
		color: var(--warn);
	}
	.text {
		display: grid;
		min-width: 0;
	}
	.msg {
		overflow-wrap: anywhere;
	}
	.loc {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}
	.none {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-2);
		color: var(--text-2);
	}
	.none :global(svg) {
		color: var(--ok);
	}
</style>
