<script lang="ts">
	/**
	 * Before an imported SysML v2 JSON file becomes a project: its name, what
	 * came across and what didn't (`ImportSummary`), then open it or not.
	 */
	import { FileJson } from '@lucide/svelte';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import ImportSummary from './ImportSummary.svelte';
	import type { InterchangeImport } from './types';
	import './exchange.css';

	let {
		open = $bindable(false),
		result,
		source,
		name = $bindable(''),
		busy = false,
		onopen
	}: {
		open?: boolean;
		result: InterchangeImport;
		/** The file (or server project) it came from. */
		source: string;
		/** The new project's name. */
		name?: string;
		busy?: boolean;
		onopen: () => void;
	} = $props();

	const uid = $props.id();
</script>

<SheetDialog
	bind:open
	title="Import {source}"
	description="SysML v2 JSON, turned into SysML text."
	testid="import-report"
>
	{#snippet icon()}<FileJson size={20} aria-hidden="true" />{/snippet}
	<div class="xc-stack">
		<label class="xc-field" for="{uid}-name">
			Project name
			<input id="{uid}-name" bind:value={name} autocomplete="off" />
		</label>
		<ImportSummary {result} {source} />
	</div>
	{#snippet footer()}
		<button type="button" class="xc-button" onclick={() => (open = false)}>Cancel</button>
		<button type="button" class="xc-primary" disabled={busy || !name.trim()} onclick={onopen}>
			{busy ? 'Opening…' : 'Open project'}
		</button>
	{/snippet}
</SheetDialog>
