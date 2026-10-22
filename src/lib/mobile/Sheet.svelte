<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';
	import { reducedMotion, verticalDrag } from './drag.ts';

	/**
	 * A modal bottom sheet on a native dialog (focus is kept inside, Escape and
	 * the backdrop close it). It follows the finger when dragged by its grabber
	 * or header, and a swipe down dismisses it.
	 */
	let {
		open = $bindable(false),
		label,
		title,
		actions,
		children,
		onclose
	}: {
		open: boolean;
		/** The dialog's accessible name. */
		label: string;
		/** A visible heading; defaults to the label. */
		title?: string;
		/** Extra buttons beside the close button. */
		actions?: Snippet;
		children: Snippet;
		onclose?: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let panel = $state<HTMLDivElement>();
	let offset = $state(0);
	let dragging = $state(false);
	let closing = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			clearTimeout(closeTimer);
			closing = false;
			offset = 0;
			dialog.showModal();
		} else if (!open && dialog.open && !closing) {
			dismiss();
		}
	});

	/** Slide out, then close the dialog. */
	function dismiss() {
		if (!dialog?.open) return;
		closing = true;
		closeTimer = setTimeout(
			() => {
				dialog?.close();
				closing = false;
				offset = 0;
			},
			reducedMotion() ? 0 : 200
		);
	}

	function close() {
		open = false;
	}

	function onDialogClose() {
		// The close event comes a moment after the dialog closed: a sheet opened again in that
		// moment (Views tapped right after choosing a view) stays open.
		if (dialog?.open) return;
		clearTimeout(closeTimer);
		closing = false;
		offset = 0;
		if (open) open = false;
		onclose?.();
	}

	function oncancel(event: Event) {
		// Escape: animate out like every other way of closing.
		event.preventDefault();
		close();
	}

	// A click on the backdrop lands on the dialog itself; the panel fills the rest.
	function onclick(event: MouseEvent) {
		if (event.target === dialog) close();
	}

	const drag = verticalDrag({
		start: () => (dragging = true),
		// Upwards resists; downwards follows the finger.
		move: (dy) => (offset = dy < 0 ? -Math.sqrt(-dy) * 2 : dy),
		end: (dy, velocity) => {
			dragging = false;
			const height = panel?.offsetHeight ?? 400;
			if (dy > height * 0.3 || velocity > 0.6) {
				offset = height;
				close();
			} else {
				offset = 0;
			}
		}
	});
</script>

<!-- The backdrop click is a pointer shortcut; Escape and the close button do the same. -->
<dialog
	bind:this={dialog}
	class="sheet"
	class:closing
	aria-label={label}
	onclose={onDialogClose}
	{oncancel}
	{onclick}
>
	{#if open || closing}
		<div
			class="panel"
			class:dragging
			bind:this={panel}
			style:transform={offset ? `translateY(${offset}px)` : undefined}
			{@attach drag}
		>
			<div class="grip" data-sheet-drag aria-hidden="true"><span></span></div>
			<header data-sheet-drag>
				<h2>{title ?? label}</h2>
				{@render actions?.()}
				<button type="button" class="close" aria-label="Close" onclick={close}>
					<X size={20} />
				</button>
			</header>
			<div class="body">
				{@render children()}
			</div>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		position: fixed;
		inset: auto 0 var(--keyboard-inset, 0px) 0;
		width: 100%;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		overflow: visible;
		border: 0;
		background: transparent;
		color: var(--text);
	}
	.sheet::backdrop {
		background: rgb(14 16 20 / 0.42);
		animation: fade 220ms var(--ease);
	}
	.sheet.closing::backdrop {
		opacity: 0;
		transition: opacity 200ms var(--ease);
	}
	.panel {
		display: flex;
		flex-direction: column;
		max-height: calc(var(--app-height, 100dvh) - env(safe-area-inset-top) - 2.5rem);
		padding-bottom: env(safe-area-inset-bottom);
		border-radius: 20px 20px 0 0;
		background: var(--surface);
		box-shadow: 0 -8px 40px rgb(0 0 0 / 0.18);
		animation: rise 280ms cubic-bezier(0.2, 0.9, 0.25, 1);
		transition: transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1);
		will-change: transform;
	}
	.panel.dragging {
		transition: none;
	}
	.closing .panel {
		transform: translateY(105%) !important;
		transition: transform 200ms cubic-bezier(0.4, 0, 1, 1);
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.grip {
		display: grid;
		place-items: center;
		flex: none;
		height: 1.25rem;
		touch-action: none;
		cursor: grab;
	}
	.grip span {
		width: 2.5rem;
		height: 0.3rem;
		border-radius: 999px;
		background: var(--border-strong);
	}
	header {
		display: flex;
		align-items: center;
		flex: none;
		gap: var(--space-2);
		padding: 0 var(--space-2) var(--space-2) var(--space-4);
		touch-action: none;
	}
	h2 {
		flex: 1;
		min-width: 0;
		font-size: var(--text-lg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.close {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		cursor: pointer;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 var(--space-3) var(--space-4);
	}
	/* On a wide screen (where the guides open it), a panel of reading width. */
	@media (min-width: 761px) {
		.panel {
			width: min(34rem, calc(100% - 2rem));
			margin: 0 auto;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.panel,
		.sheet::backdrop {
			animation: none;
			transition: none;
		}
	}
</style>
