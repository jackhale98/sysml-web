<script lang="ts">
	import type { Engine } from '#lib/engine/client.ts';
	import type { FeatureValue } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { setField } from './actions.ts';
	import CellEditor from './CellEditor.svelte';
	import type { WorkbenchUi } from './ui.svelte.ts';

	/**
	 * A usage's attribute values — those it sets itself (`:>> description =
	 * "…"`) and those its definition declares — each edited in place like a
	 * table cell. An expression opens its attribute, where it is edited whole.
	 */
	let {
		element,
		workspace,
		engine,
		ui,
		oncount
	}: {
		element: ModelElement;
		workspace: Workspace;
		engine: Engine;
		ui: WorkbenchUi;
		/** Told how many values there are (the inspector hides the section when none). */
		oncount?: (count: number) => void;
	} = $props();

	let values = $state<FeatureValue[]>([]);
	$effect(() => {
		oncount?.(values.length);
	});
	let editing = $state<string | null>(null);
	let generation = 0;

	$effect(() => {
		const current = ++generation;
		const id = element.id;
		void workspace.files;
		if (!id || element.isDefinition) {
			values = [];
			return;
		}
		void engine
			.featureValues(workspace.sourceFiles(), id)
			.then((v) => {
				if (current === generation) values = v;
			})
			.catch(() => {
				if (current === generation) values = [];
			});
	});

	/** A value as people read it: a string without its quotes, an enum literal by its name. */
	function shown(v: FeatureValue): string {
		const text = v.value?.trim() ?? '';
		if (!text) return '';
		if (/^".*"$/s.test(text)) return text.slice(1, -1).replace(/\\(["\\])/g, '$1');
		const literal = (t: string) => (t.split('::').pop() ?? t).trim().replace(/^'|'$/g, '');
		if (v.edit?.kind === 'enum') return literal(text);
		if (v.edit?.kind === 'enumList')
			return text
				.replace(/^\(|\)$/g, '')
				.split(',')
				.map(literal)
				.filter(Boolean)
				.join(', ');
		return text.replace(/\s+/g, ' ');
	}

	async function save(v: FeatureValue, next: string) {
		editing = null;
		const error = await setField(
			workspace,
			{ element: element.name, file: element.file, line: element.span.start_row, id: element.id },
			v.edit!.field,
			next,
			next
				? `Set ${v.name} of ${element.label} to ${next}`
				: `Cleared ${v.name} of ${element.label}`
		);
		if (error) toasts.show(error, { tone: 'error' });
	}

	function open(v: FeatureValue) {
		const own = v.elementId ? workspace.elements.find((e) => e.id === v.elementId) : undefined;
		if (own) ui.select(own.key, 'inspector');
	}
</script>

{#if values.length}
	<dl class="values">
		{#each values as v (v.name)}
			{@const text = shown(v)}
			<div class="row" class:inherited={!v.own}>
				<dt>
					{v.name}
					{#if !v.own && v.declaredBy}<small>from {v.declaredBy}</small>{/if}
				</dt>
				<dd>
					{#if editing === v.name && v.edit}
						<CellEditor
							edit={v.edit}
							value={text}
							label="{v.name} of {element.label}"
							onsave={(next) => void save(v, next)}
							oncancel={() => (editing = null)}
						/>
					{:else if v.edit}
						<button
							type="button"
							class="value"
							class:empty={!text}
							aria-label="{v.name}: {text || 'not set'}. Edit"
							onclick={() => (editing = v.name)}>{text || 'Not set'}</button
						>
					{:else if v.elementId}
						<button
							type="button"
							class="value expression"
							title="Open {v.name} to edit its expression"
							onclick={() => open(v)}>{text}</button
						>
					{:else}
						<span class="value expression">{text || '—'}</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
{/if}

<style>
	.values {
		display: grid;
		gap: var(--space-2);
		margin: 0;
	}
	.row {
		display: grid;
		gap: 4px;
	}
	dt {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	dt small {
		margin-left: var(--space-1);
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	dd {
		margin: 0;
	}
	.value {
		display: block;
		width: 100%;
		min-height: 2.25rem;
		padding: 0.45rem var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	button.value {
		cursor: text;
	}
	button.value:hover {
		border-color: var(--accent);
	}
	.value.empty {
		color: var(--text-3);
	}
	.value.expression {
		border-style: dashed;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	button.value.expression {
		cursor: pointer;
	}
	.inherited .value:not(:hover) {
		background: var(--surface-2);
	}
</style>
