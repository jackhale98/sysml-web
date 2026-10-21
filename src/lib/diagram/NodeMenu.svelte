<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface MenuItem {
		label: string;
		icon: Component<{ size?: number }>;
		/** Keyboard shortcut shown beside the label. */
		shortcut?: string;
		danger?: boolean;
		run: () => void;
	}
</script>

<script lang="ts">
	/** The actions of a node or line: right-click, long-press, or Shift+F10 / the Menu key. */
	let {
		title,
		items,
		x,
		y,
		onclose
	}: {
		title: string;
		items: MenuItem[];
		/** Position inside the canvas, px. */
		x: number;
		y: number;
		onclose: (restoreFocus: boolean) => void;
	} = $props();

	let menu: HTMLDivElement;

	function buttons(): HTMLButtonElement[] {
		return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
	}

	function focusFirst(node: HTMLDivElement) {
		node.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
	}

	function onkeydown(event: KeyboardEvent) {
		const list = buttons();
		const index = list.indexOf(document.activeElement as HTMLButtonElement);
		const move = (to: number) => {
			event.preventDefault();
			list[(to + list.length) % list.length]?.focus();
		};
		if (event.key === 'ArrowDown') move(index + 1);
		else if (event.key === 'ArrowUp') move(index - 1);
		else if (event.key === 'Home') move(0);
		else if (event.key === 'End') move(list.length - 1);
		else if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			onclose(true);
		}
	}

	// Close on a press anywhere else.
	$effect(() => {
		const away = (event: PointerEvent) => {
			if (!menu.contains(event.target as Node)) onclose(false);
		};
		const id = setTimeout(() => window.addEventListener('pointerdown', away, true));
		return () => {
			clearTimeout(id);
			window.removeEventListener('pointerdown', away, true);
		};
	});
</script>

<div
	class="menu"
	role="menu"
	tabindex="-1"
	aria-label={title}
	style:left="{x}px"
	style:top="{y}px"
	bind:this={menu}
	{@attach focusFirst}
	{onkeydown}
>
	<p class="title" aria-hidden="true">{title}</p>
	{#each items as item (item.label)}
		<button
			type="button"
			role="menuitem"
			class:danger={item.danger}
			onclick={() => {
				onclose(false);
				item.run();
			}}
		>
			<item.icon size={15} />
			<span>{item.label}</span>
			{#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
		</button>
	{/each}
</div>

<style>
	.menu {
		position: absolute;
		z-index: 20;
		display: grid;
		min-width: 13.5rem;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		animation: appear var(--duration) var(--ease);
		transform-origin: top left;
	}
	.title {
		margin: 0;
		padding: 6px 10px 4px;
		overflow: hidden;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 2.25rem;
		padding: 0 10px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
	}
	button :global(svg) {
		flex: none;
		color: var(--text-2);
	}
	button span {
		flex: 1;
	}
	button:hover,
	button:focus-visible {
		background: var(--surface-hover);
		outline: none;
	}
	button:focus-visible {
		box-shadow: inset 0 0 0 2px var(--focus);
	}
	.danger,
	.danger :global(svg) {
		color: var(--danger);
	}
	kbd {
		color: var(--text-3);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
	}
	@keyframes appear {
		from {
			opacity: 0;
			scale: 0.96;
		}
	}
	@media (pointer: coarse) {
		button {
			min-height: 2.75rem;
		}
	}
</style>
