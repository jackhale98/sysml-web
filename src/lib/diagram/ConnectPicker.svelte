<script lang="ts" module>
	import type { ModelElement } from '#lib/project/elements.ts';

	export interface ConnectTarget {
		/** Node id when the element is on this diagram. */
		id?: string;
		element: ModelElement;
		/** "On this diagram", "Requirements", … */
		group: string;
		/** What the relationship options are, e.g. "satisfies". */
		detail: string;
	}
</script>

<script lang="ts">
	/**
	 * "Connect from here": tap or click a node on the canvas, or pick any
	 * fitting element from the list (keyboard and screen readers, and for
	 * elements this diagram does not show).
	 */
	import { X } from '@lucide/svelte';

	let {
		source,
		targets,
		touch = false,
		onpick,
		oncancel
	}: {
		source: string;
		targets: ConnectTarget[];
		touch?: boolean;
		onpick: (target: ConnectTarget) => void;
		oncancel: () => void;
	} = $props();

	const LIMIT = 60;
	let query = $state('');
	let list: HTMLUListElement | undefined = $state();

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const found = q
			? targets.filter((t) =>
					`${t.element.label} ${t.id ?? ''} ${t.element.kind}`.toLowerCase().includes(q)
				)
			: targets;
		return found.slice(0, LIMIT);
	});
	const groups = $derived(
		[...new Set(matches.map((t) => t.group))].map((g) => ({
			name: g,
			items: matches.filter((t) => t.group === g)
		}))
	);

	function onkeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			oncancel();
			return;
		}
		const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (index <= 0) (event.currentTarget as HTMLElement).querySelector('input')?.focus();
			else buttons[index - 1]?.focus();
		} else if (event.key === 'Enter' && index < 0 && matches[0]) {
			event.preventDefault();
			onpick(matches[0]);
		}
	}

	function focusInput(node: HTMLInputElement) {
		// On phones, keep the canvas visible: no keyboard until asked for.
		if (!touch) node.focus();
	}
</script>

<div class="picker" role="dialog" tabindex="-1" aria-label="Connect from {source}" {onkeydown}>
	<header>
		<p>
			Connect from <strong>{source}</strong>
			<span class="hint">{touch ? 'Tap' : 'Click'} a node, or choose below.</span>
		</p>
		<button type="button" class="close" aria-label="Cancel connecting" onclick={oncancel}>
			<X size={16} />
		</button>
	</header>
	<input
		type="search"
		bind:value={query}
		placeholder="Find an element"
		aria-label="Find an element to connect to"
		{@attach focusInput}
	/>
	<ul bind:this={list} aria-label="Elements to connect to">
		{#each groups as g (g.name)}
			<li class="group" aria-hidden="true">{g.name}</li>
			{#each g.items as t (t.element.key)}
				<li>
					<button type="button" onclick={() => onpick(t)}>
						<span class="label">{t.element.label}</span>
						<span class="detail">{t.detail}</span>
					</button>
				</li>
			{/each}
		{:else}
			<li class="none">Nothing fits.</li>
		{/each}
	</ul>
</div>

<style>
	.picker {
		position: absolute;
		top: 56px;
		left: 50%;
		z-index: 15;
		translate: -50% 0;
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		gap: var(--space-2);
		width: min(22rem, calc(100% - 24px));
		max-height: min(26rem, calc(100% - 72px));
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		animation: appear var(--duration) var(--ease);
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}
	header p {
		display: grid;
		margin: 0;
		font-size: var(--text-md);
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.close {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		flex: none;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
	}
	input {
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	ul {
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.group {
		padding: 8px 8px 2px;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.none {
		padding: 8px;
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	li button {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		width: 100%;
		min-height: 2.25rem;
		padding: 4px 8px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	li button:hover,
	li button:focus-visible {
		background: var(--surface-hover);
		outline: none;
	}
	li button:focus-visible {
		box-shadow: inset 0 0 0 2px var(--focus);
	}
	.label {
		overflow: hidden;
		font-weight: 560;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detail {
		flex: none;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	@keyframes appear {
		from {
			opacity: 0;
			translate: -50% -4px;
		}
	}
	@media (max-width: 34rem) {
		.picker {
			top: auto;
			bottom: 0;
			left: 0;
			translate: none;
			width: 100%;
			max-height: 45%;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			animation-name: rise;
		}
	}
	@keyframes rise {
		from {
			translate: 0 100%;
		}
	}
</style>
