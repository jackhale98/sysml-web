<script lang="ts">
	/**
	 * The frame of the forms that draw behaviour (a transition, a branch, what
	 * a state does): a popover beside where it was asked for, a bottom sheet
	 * on phones, or part of the inspector. Escape closes it; it opens with
	 * the first field focused.
	 */
	import type { Snippet } from 'svelte';

	let {
		label,
		mode = 'popover',
		x = 0,
		y = 0,
		onclose,
		children
	}: {
		/** The dialog's accessible name. */
		label: string;
		mode?: 'popover' | 'sheet' | 'inline';
		/** Position inside the canvas, px (popover only). */
		x?: number;
		y?: number;
		onclose: () => void;
		children: Snippet;
	} = $props();

	/** Stay inside the canvas, whatever the popover's height turns out to be. */
	function keepInside(node: HTMLElement) {
		if (mode !== 'popover') return;
		const place = () => {
			const parent = node.offsetParent as HTMLElement | null;
			if (!parent) return;
			const top = Math.max(8, Math.min(y, parent.clientHeight - node.offsetHeight - 8));
			const left = Math.max(8, Math.min(x, parent.clientWidth - node.offsetWidth - 8));
			node.style.top = `${top}px`;
			node.style.left = `${left}px`;
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(node);
		return () => observer.disconnect();
	}

	function focusFirst(node: HTMLElement) {
		// On phones the keyboard would cover the sheet: focus the first choice, not a text field.
		const first =
			mode === 'sheet'
				? node.querySelector<HTMLElement>('input:checked, select, button')
				: node.querySelector<HTMLElement>('input:checked, input, select, textarea');
		requestAnimationFrame(() => first?.focus({ preventScroll: true }));
	}
</script>

<div
	class="panel {mode}"
	role={mode === 'inline' ? 'group' : 'dialog'}
	tabindex="-1"
	aria-label={label}
	data-form-sheet={mode === 'sheet' ? '' : undefined}
	onkeydown={(e) => {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}}
	{@attach focusFirst}
	{@attach keepInside}
>
	{@render children()}
</div>

<style>
	.panel {
		display: grid;
		gap: var(--space-3);
	}
	.popover,
	.sheet {
		position: absolute;
		z-index: 20;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-lg);
		animation: appear var(--duration) var(--ease);
	}
	.popover {
		width: min(22rem, calc(100% - 24px));
		max-height: calc(100% - 16px);
		border-radius: var(--radius-lg);
	}
	.sheet {
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 80%;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		padding-bottom: max(var(--space-4), env(safe-area-inset-bottom));
		animation-name: rise;
	}
	.panel:focus {
		outline: none;
	}
	/* Shared by the forms inside. */
	.panel :global(form) {
		display: grid;
		gap: var(--space-3);
	}
	.panel :global(.ends) {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		margin: 0;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.panel :global(.ends strong) {
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.panel :global(fieldset) {
		display: grid;
		gap: 4px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.panel :global(legend),
	.panel :global(.field > span) {
		margin-bottom: 2px;
		padding: 0;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.panel :global(.choices) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.panel :global(.choice) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		padding: 2px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.panel :global(.choice:has(input:checked)) {
		border-color: var(--accent);
		background: var(--accent-weak);
		color: var(--accent);
		font-weight: 600;
	}
	.panel :global(.choice:has(input:focus-visible)) {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	.panel :global(.choice input) {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.panel :global(.field) {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.panel :global(.field input:not([type='checkbox'])),
	.panel :global(.field select) {
		width: 100%;
		min-width: 0;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
	}
	.panel :global(.field input.code) {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.panel :global(.field input:focus),
	.panel :global(.field select:focus) {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	.panel :global(.check) {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 2rem;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.panel :global(.check input) {
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		accent-color: var(--accent);
	}
	.panel :global(.hint) {
		margin: 0;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.panel :global(.note) {
		margin: 0;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.panel :global(.preview) {
		display: grid;
		gap: 4px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.panel :global(.preview span) {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.panel :global(.preview code) {
		overflow-wrap: anywhere;
		white-space: pre-wrap;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.panel :global(.error) {
		margin: 0;
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.panel :global(.actions) {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.panel :global(.actions button) {
		min-height: 2.25rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 580;
		cursor: pointer;
	}
	.panel :global(.actions .primary) {
		background: var(--accent);
		color: var(--accent-text);
	}
	.panel :global(.actions .primary:hover) {
		background: var(--accent-hover);
	}
	.panel :global(.actions .primary:disabled) {
		opacity: 0.6;
	}
	.panel :global(.actions .quiet) {
		background: transparent;
		color: var(--text-2);
	}
	.panel :global(.actions .quiet:hover) {
		background: var(--surface-hover);
	}
	/* On a phone the buttons stay in reach however long the form is. */
	.sheet :global(.actions) {
		position: sticky;
		bottom: calc(-1 * max(var(--space-4), env(safe-area-inset-bottom)));
		margin: 0 calc(-1 * var(--space-4)) calc(-1 * max(var(--space-4), env(safe-area-inset-bottom)));
		padding: var(--space-2) var(--space-4) max(var(--space-3), env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: var(--surface);
	}
	.sheet :global(.choice),
	.sheet :global(.actions button),
	.sheet :global(.field input:not([type='checkbox'])),
	.sheet :global(.field select) {
		min-height: 2.75rem;
	}
	@keyframes appear {
		from {
			opacity: 0;
			translate: 0 4px;
		}
	}
	@keyframes rise {
		from {
			translate: 0 100%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.popover,
		.sheet {
			animation: none;
		}
	}
</style>
