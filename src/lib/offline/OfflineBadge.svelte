<script lang="ts">
	import { WifiOff } from '@lucide/svelte';
	import { pwa } from './pwa.svelte.ts';

	/** "Offline", shown only while there is no connection. `compact` shows just the icon. */
	let { compact = false }: { compact?: boolean } = $props();
</script>

<span class="offline-status" role="status">
	{#if !pwa.online}
		<span
			class="badge"
			class:compact
			title="No internet connection. Your work is saved in this browser; GitHub needs a connection."
		>
			<WifiOff size={13} aria-hidden="true" />
			<span class:visually-hidden={compact}>Offline</span>
		</span>
	{/if}
</span>

<style>
	.offline-status {
		display: contents;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 1.375rem;
		padding: 0 var(--space-2);
		border: 1px solid color-mix(in oklab, var(--warn) 45%, var(--border));
		border-radius: 999px;
		background: var(--warn-weak);
		color: var(--text);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.compact {
		width: 1.75rem;
		height: 1.75rem;
		justify-content: center;
		padding: 0;
	}
</style>
