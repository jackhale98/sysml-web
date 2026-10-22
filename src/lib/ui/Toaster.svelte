<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Check, CircleAlert, Info, X } from '@lucide/svelte';
	import { toasts } from './toasts.svelte.ts';

	const reduced =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<!-- Toasts wait while the pointer is on them or focus is in them. -->
<section
	class="toaster"
	aria-label="Notifications"
	aria-live="polite"
	onpointerenter={() => toasts.pause()}
	onpointerleave={() => toasts.resume()}
	onfocusin={() => toasts.pause()}
	onfocusout={(event) => {
		const to = event.relatedTarget as Node | null;
		if (!to || !event.currentTarget.contains(to)) toasts.resume();
	}}
>
	{#each toasts.items as toast (toast.id)}
		<div
			class="toast {toast.tone}"
			transition:fly={{ y: reduced ? 0 : 16, duration: reduced ? 0 : 180 }}
		>
			<span class="icon" aria-hidden="true">
				{#if toast.tone === 'success'}<Check
						size={15}
					/>{:else if toast.tone === 'error'}<CircleAlert size={15} />{:else}<Info size={15} />{/if}
			</span>
			<p>{toast.message}</p>
			{#if toast.action}
				{@const action = toast.action}
				<button
					type="button"
					class="action"
					onclick={() => {
						action.run();
						toasts.dismiss(toast.id);
					}}>{action.label}</button
				>
			{/if}
			<button
				type="button"
				class="dismiss"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(toast.id)}
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</section>

<style>
	.toaster {
		position: fixed;
		right: var(--space-4);
		bottom: calc(var(--space-4) + 1.75rem);
		z-index: 50;
		display: grid;
		gap: var(--space-2);
		width: min(24rem, calc(100vw - 2rem));
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
		color: var(--text);
		font-size: var(--text-sm);
		pointer-events: auto;
	}
	.icon {
		display: grid;
		place-items: center;
		color: var(--accent);
	}
	.success .icon {
		color: var(--ok);
	}
	.error .icon {
		color: var(--danger);
	}
	p {
		flex: 1;
		margin: 0;
		min-width: 0;
	}
	button {
		display: inline-grid;
		place-items: center;
		height: 2rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
	}
	.action {
		padding: 0 var(--space-3);
		color: var(--accent);
		font-weight: 600;
	}
	.action:hover,
	.dismiss:hover {
		background: var(--surface-hover);
	}
	.dismiss {
		width: 2rem;
		color: var(--text-3);
	}
	@media (max-width: 760px) {
		.toaster {
			right: var(--space-3);
			bottom: calc(3.5rem + env(safe-area-inset-bottom));
		}
	}
</style>
