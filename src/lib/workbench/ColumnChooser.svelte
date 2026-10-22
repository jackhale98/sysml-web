<script lang="ts">
	/**
	 * Which columns a table shows, and in what order: a check box per field
	 * the table's rows offer, with buttons to move it up or down. Used by the
	 * table's Columns menu and by the "New view" form.
	 */
	import { ArrowDown, ArrowUp } from '@lucide/svelte';

	let {
		choice = $bindable([]),
		heading
	}: {
		choice?: { field: string; shown: boolean }[];
		/** A field as people read it. */
		heading: (field: string) => string;
	} = $props();

	function move(index: number, by: number) {
		const next = [...choice];
		const [item] = next.splice(index, 1);
		next.splice(index + by, 0, item!);
		choice = next;
	}
</script>

<ul class="columns">
	{#each choice as c, i (c.field)}
		<li>
			<label>
				<input type="checkbox" bind:checked={c.shown} />
				{heading(c.field)}
			</label>
			<button
				type="button"
				class="move"
				aria-label="Move {heading(c.field)} up"
				disabled={i === 0}
				onclick={() => move(i, -1)}><ArrowUp size={13} /></button
			>
			<button
				type="button"
				class="move"
				aria-label="Move {heading(c.field)} down"
				disabled={i === choice.length - 1}
				onclick={() => move(i, 1)}><ArrowDown size={13} /></button
			>
		</li>
	{/each}
</ul>

<style>
	.columns {
		display: grid;
		gap: 2px;
		max-height: 18rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	label {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--space-2);
		min-height: 1.75rem;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.move {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.move:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	.move:disabled {
		opacity: 0.35;
		cursor: default;
	}
	@media (pointer: coarse) {
		label {
			min-height: 2.75rem;
		}
		.move {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
