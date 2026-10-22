<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';

	/**
	 * A modal dialog on a native `<dialog>` (focus stays inside; Escape
	 * closes it): a card in the middle of larger screens and a bottom sheet
	 * on phones, with its buttons within thumb reach. `dismissible: false`
	 * keeps it open until one of its own buttons is chosen (Escape and the
	 * backdrop then do what `oncancel` says).
	 */
	let {
		open = $bindable(false),
		title,
		description,
		icon,
		children,
		footer,
		dismissible = true,
		closeLabel = 'Close',
		size = 'md',
		oncancel,
		testid
	}: {
		open?: boolean;
		title: string;
		/** A line under the title, read out with it. */
		description?: string;
		icon?: Snippet;
		children: Snippet;
		footer?: Snippet;
		dismissible?: boolean;
		closeLabel?: string;
		size?: 'sm' | 'md';
		/** Escape, the backdrop or the close button. */
		oncancel?: () => void;
		testid?: string;
	} = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function cancel() {
		if (oncancel) oncancel();
		else open = false;
	}

	function onclick(event: MouseEvent) {
		if (event.target === dialog && dismissible) cancel();
	}
</script>

<!-- A backdrop click is a pointer shortcut; Escape and the close button do the same. -->
<dialog
	bind:this={dialog}
	class="sheet-dialog {size}"
	aria-labelledby="{uid}-title"
	aria-describedby={description ? `${uid}-description` : undefined}
	data-testid={testid}
	onclose={() => (open = false)}
	oncancel={(event) => {
		event.preventDefault();
		cancel();
	}}
	{onclick}
>
	{#if open}
		<div class="panel">
			<header>
				{#if icon}<span class="icon">{@render icon()}</span>{/if}
				<div class="titles">
					<h2 id="{uid}-title">{title}</h2>
					{#if description}<p id="{uid}-description">{description}</p>{/if}
				</div>
				{#if dismissible}
					<button type="button" class="close" aria-label={closeLabel} onclick={cancel}>
						<X size={18} />
					</button>
				{/if}
			</header>
			<div class="body">
				{@render children()}
			</div>
			{#if footer}
				<footer>{@render footer()}</footer>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	.sheet-dialog {
		width: min(32rem, calc(100vw - 2rem));
		max-width: none;
		max-height: min(44rem, calc(100dvh - 4rem));
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 2px);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.sheet-dialog.sm {
		width: min(27rem, calc(100vw - 2rem));
	}
	.sheet-dialog[open] {
		display: flex;
		animation: pop 180ms var(--ease);
	}
	.sheet-dialog::backdrop {
		background: rgb(14 16 20 / 0.45);
		backdrop-filter: blur(4px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	.panel {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-3) var(--space-3) var(--space-5);
	}
	.icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--text);
	}
	.titles {
		display: grid;
		flex: 1;
		gap: 2px;
		min-width: 0;
		padding-top: 2px;
	}
	h2 {
		font-size: var(--text-xl);
		line-height: 1.25;
	}
	.titles p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.close {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		margin-top: -4px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
	}
	.body {
		flex: 1;
		min-height: 0;
		padding: 0 var(--space-5) var(--space-4);
		overflow: auto;
		overscroll-behavior: contain;
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5) var(--space-4);
		border-top: 1px solid var(--border);
		background: var(--surface);
	}
	@media (max-width: 760px) {
		.sheet-dialog,
		.sheet-dialog.sm {
			inset: auto 0 0 0;
			width: 100%;
			max-height: calc(100dvh - env(safe-area-inset-top) - 2.5rem);
			margin: 0;
			border: 0;
			border-radius: 20px 20px 0 0;
			box-shadow: 0 -8px 40px rgb(0 0 0 / 0.18);
		}
		.sheet-dialog[open] {
			animation: rise 260ms cubic-bezier(0.2, 0.9, 0.25, 1);
		}
		@keyframes rise {
			from {
				transform: translateY(100%);
			}
		}
		header {
			padding: var(--space-4) var(--space-2) var(--space-3) var(--space-4);
		}
		.body {
			padding: 0 var(--space-4) var(--space-4);
		}
		footer {
			flex-direction: column-reverse;
			align-items: stretch;
			padding: var(--space-3) var(--space-4) max(var(--space-4), env(safe-area-inset-bottom));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet-dialog[open] {
			animation: none;
		}
	}
</style>
