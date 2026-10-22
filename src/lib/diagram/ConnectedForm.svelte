<script lang="ts" module>
	/** An element related to the one the form is for, and which way. */
	export interface Neighbour {
		label: string;
		direction: 'out' | 'in';
	}
</script>

<script lang="ts">
	/**
	 * "Add connected elements": what an element refers to (outgoing), what
	 * refers to it (incoming), or both, put on the diagram in one step. On an
	 * interconnection view (`wired`), the parts it is wired to, shown again.
	 */
	import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from '@lucide/svelte';
	import FormPanel from './FormPanel.svelte';

	let {
		name,
		neighbours,
		mode = 'popover',
		wired = false,
		x = 0,
		y = 0,
		onapply,
		onclose
	}: {
		/** The element's name. */
		name: string;
		/** Those not on the diagram yet. */
		neighbours: Neighbour[];
		mode?: 'popover' | 'sheet';
		/** The neighbours are parts it is wired to (connections, flows, bindings) that the diagram hides. */
		wired?: boolean;
		x?: number;
		y?: number;
		onapply: (direction: 'out' | 'in' | 'both') => Promise<string | null>;
		onclose: () => void;
	} = $props();

	let error = $state<string | null>(null);
	let busy = $state(false);

	const outgoing = $derived(neighbours.filter((n) => n.direction === 'out'));
	const incoming = $derived(neighbours.filter((n) => n.direction === 'in'));

	/** "Battery, Battery protection and 2 more". */
	function some(list: Neighbour[]): string {
		const names = [...new Set(list.map((n) => n.label))];
		if (names.length <= 3) return names.join(', ').replace(/, ([^,]*)$/, ' and $1');
		return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
	}

	async function add(direction: 'out' | 'in' | 'both') {
		busy = true;
		error = await onapply(direction);
		busy = false;
	}
</script>

<FormPanel label="Add connected elements of {name}" {mode} {x} {y} {onclose}>
	<div class="directions">
		<p class="title">Add what is connected to <strong>{name}</strong></p>
		<button
			type="button"
			class="direction"
			disabled={busy || !outgoing.length}
			onclick={() => add('out')}
		>
			<ArrowUpRight size={16} aria-hidden="true" />
			<span>
				<span class="label">Outgoing ({outgoing.length})</span>
				<span class="detail"
					>{outgoing.length
						? `What ${name} ${wired ? 'connects to' : 'refers to'}: ${some(outgoing)}`
						: wired
							? `${name} connects to nothing hidden here`
							: `${name} refers to nothing else that is not here`}</span
				>
			</span>
		</button>
		<button
			type="button"
			class="direction"
			disabled={busy || !incoming.length}
			onclick={() => add('in')}
		>
			<ArrowDownLeft size={16} aria-hidden="true" />
			<span>
				<span class="label">Incoming ({incoming.length})</span>
				<span class="detail"
					>{incoming.length
						? `What ${wired ? 'connects' : 'refers'} to ${name}: ${some(incoming)}`
						: wired
							? `Nothing hidden here connects to ${name}`
							: `Nothing else refers to ${name}`}</span
				>
			</span>
		</button>
		<button
			type="button"
			class="direction"
			disabled={busy || !neighbours.length}
			onclick={() => add('both')}
		>
			<ArrowLeftRight size={16} aria-hidden="true" />
			<span>
				<span class="label">Both ({new Set(neighbours.map((n) => n.label)).size})</span>
				<span class="detail"
					>{wired
						? 'Everything wired to it, either way'
						: 'Everything connected to it, either way'}</span
				>
			</span>
		</button>
		<p class="hint">
			{wired
				? 'They show on this diagram again; the model doesn’t change.'
				: 'They stay where they are in the model; only this diagram changes.'}
		</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="actions">
			<button type="button" class="quiet" onclick={onclose}>Cancel</button>
		</div>
	</div>
</FormPanel>

<style>
	.directions {
		display: grid;
		gap: var(--space-2);
	}
	.title {
		margin: 0;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.title strong {
		color: var(--text);
	}
	.direction {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.direction :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--accent);
	}
	.direction:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.direction:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.direction > span {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.label {
		font-weight: 600;
	}
	.detail {
		overflow-wrap: anywhere;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.hint {
		margin: 0;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
	.quiet {
		min-height: 2.25rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-weight: 580;
		cursor: pointer;
	}
	.quiet:hover {
		background: var(--surface-hover);
	}
</style>
