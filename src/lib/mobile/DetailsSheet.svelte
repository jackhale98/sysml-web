<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronUp, X } from '@lucide/svelte';
	import type { SheetSnap } from '#lib/workbench/ui.svelte.ts';
	import { reducedMotion, verticalDrag } from './drag.ts';

	/**
	 * A non-modal bottom sheet over the current view, with three resting
	 * heights: peek (just the header), half and full. It follows the finger
	 * and settles at the nearest height, taking the flick's speed into account.
	 * Content marked `data-sheet-peek` sets how much a peek shows.
	 */
	let {
		snap = $bindable('closed'),
		label,
		children
	}: { snap: SheetSnap; label: string; children: Snippet } = $props();

	let layerHeight = $state(0);
	let panel = $state<HTMLDivElement>();
	let peekHeight = $state(96);
	let drag = $state<number | null>(null);
	let dragFrom = 0;

	const GAP = 8;
	function offsetOf(s: SheetSnap): number {
		const full = layerHeight - GAP;
		switch (s) {
			case 'full':
				return 0;
			case 'half':
				return Math.max(0, full - Math.round(layerHeight * 0.55));
			case 'peek':
				return Math.max(0, full - peekHeight);
			case 'closed':
				return full + 24;
		}
	}
	const rest = $derived(offsetOf(snap));
	/** Hidden once it has slid away, so it leaves the tab order and the accessibility tree. */
	let gone = $state(true);
	$effect(() => {
		if (snap !== 'closed') gone = false;
		else if (reducedMotion()) gone = true;
	});
	function ontransitionend(event: TransitionEvent) {
		if (event.target === panel && snap === 'closed' && drag === null) gone = true;
	}
	const offset = $derived(drag ?? rest);
	/** How much of the panel is below the fold, so the content can be scrolled into view. */
	const hidden = $derived(snap === 'closed' ? 0 : rest);

	// Measure the peek from the content's marked header.
	$effect(() => {
		if (!panel || snap === 'closed') return;
		const measure = () => {
			const mark = panel?.querySelector<HTMLElement>('[data-sheet-peek]');
			if (!mark || !panel) return;
			const bottom = mark.getBoundingClientRect().bottom - panel.getBoundingClientRect().top;
			if (bottom > 40) peekHeight = Math.min(Math.round(bottom), 180);
		};
		measure();
		const observer = new ResizeObserver(measure);
		const mark = panel.querySelector('[data-sheet-peek]');
		if (mark) observer.observe(mark);
		return () => observer.disconnect();
	});

	const dragging = verticalDrag({
		start: () => (dragFrom = rest),
		move: (dy) => {
			const next = dragFrom + dy;
			// Past the top it resists.
			drag = next < 0 ? -Math.sqrt(-next) * 2 : next;
		},
		end: (dy, velocity) => {
			const projected = dragFrom + dy + velocity * 180;
			const snaps: SheetSnap[] = ['full', 'half', 'peek', 'closed'];
			let best: SheetSnap = 'half';
			let distance = Infinity;
			for (const s of snaps) {
				const d = Math.abs(offsetOf(s) - projected);
				if (d < distance) {
					distance = d;
					best = s;
				}
			}
			drag = null;
			snap = best;
		}
	});

	function cycle() {
		snap = snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half';
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && snap !== 'closed') {
			event.stopPropagation();
			snap = snap === 'full' || snap === 'half' ? 'peek' : 'closed';
		}
	}
</script>

<div class="layer" bind:clientHeight={layerHeight}>
	<!-- Escape lowers the sheet; its buttons are the keyboard way to resize it. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="panel"
		class:dragging={drag !== null}
		class:open={snap !== 'closed'}
		data-snap={snap}
		role="region"
		aria-label={label}
		class:gone
		bind:this={panel}
		style:transform="translateY({offset}px)"
		style:--sheet-hidden="{hidden}px"
		{onkeydown}
		{ontransitionend}
		{@attach dragging}
	>
		<div class="grip" data-sheet-drag>
			<button
				type="button"
				class="grab"
				data-sheet-grip
				aria-label={snap === 'full' ? 'Shrink details' : 'Expand details'}
				onclick={cycle}
			>
				<span class="bar"></span>
				<ChevronUp size={14} class="chev {snap === 'full' ? 'down' : ''}" />
			</button>
			<button
				type="button"
				class="close"
				aria-label="Close details"
				onclick={() => (snap = 'closed')}
			>
				<X size={18} />
			</button>
		</div>
		<div class="content">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.layer {
		position: relative;
		height: 100%;
		overflow: hidden;
		pointer-events: none;
	}
	.panel {
		position: absolute;
		inset: 8px 0 0;
		display: flex;
		flex-direction: column;
		border-radius: 20px 20px 0 0;
		background: var(--surface);
		box-shadow:
			0 -1px 0 var(--border),
			0 -10px 36px rgb(0 0 0 / 0.16);
		pointer-events: auto;
		transition: transform 300ms cubic-bezier(0.2, 0.9, 0.25, 1);
		will-change: transform;
	}
	.panel.gone {
		visibility: hidden;
	}
	.panel.dragging {
		transition: none;
	}
	.grip {
		position: relative;
		display: flex;
		justify-content: center;
		flex: none;
		height: 1.75rem;
		touch-action: none;
		cursor: grab;
	}
	.grab {
		display: grid;
		place-items: center;
		width: 6rem;
		height: 1.75rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-3);
		cursor: grab;
		touch-action: none;
	}
	.bar {
		width: 2.5rem;
		height: 0.3rem;
		border-radius: 999px;
		background: var(--border-strong);
	}
	.grab :global(.chev) {
		display: none;
	}
	.grab:focus-visible :global(.chev) {
		display: block;
	}
	.grab :global(.chev.down) {
		transform: rotate(180deg);
	}
	.close {
		position: absolute;
		top: 0.375rem;
		right: 0.5rem;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		cursor: pointer;
	}
	.content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	@media (prefers-reduced-motion: reduce) {
		.panel {
			transition: none;
		}
	}
</style>
