<script lang="ts">
	/**
	 * A small card on the projects page for phone and tablet visitors who
	 * haven't added Fairtide to their Home Screen yet. Dismissed once, it
	 * stays away on this device.
	 */
	import { onMount } from 'svelte';
	import { X } from '@lucide/svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import { showInstallCard } from './install.ts';
	import { pwa } from './pwa.svelte.ts';

	const KEY = 'sysml-web:install-card-dismissed';

	let dismissed = $state(true);
	let facts = $state.raw<{ userAgent: string; maxTouchPoints: number } | null>(null);

	onMount(() => {
		pwa.init();
		try {
			dismissed = localStorage.getItem(KEY) === '1';
		} catch {
			dismissed = false;
		}
		facts = { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
	});

	const shown = $derived(
		!!facts &&
			!pwa.installed &&
			showInstallCard({ ...facts, standalone: pwa.installed }, pwa.canInstall, dismissed)
	);

	function dismiss() {
		dismissed = true;
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			// Blocked: it stays away for this visit.
		}
	}
</script>

{#if shown}
	<aside class="install-card" aria-labelledby="install-card-title">
		<Logo size={44} variant="tile" />
		<div class="text">
			<h2 id="install-card-title">Keep Fairtide on your Home Screen</h2>
			<p>Open your projects in one tap, like any app. It works offline too.</p>
			<button type="button" class="show" onclick={() => pwa.offerInstall()}>
				{pwa.canInstall ? 'Install app' : 'Show me how'}
			</button>
		</div>
		<button type="button" class="dismiss" aria-label="Not now" title="Not now" onclick={dismiss}>
			<X size={18} />
		</button>
	</aside>
{/if}

<style>
	.install-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
		border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
		border-radius: var(--radius-lg);
		background: linear-gradient(150deg, var(--accent-weak), var(--surface) 70%);
	}
	.install-card :global(.ft-logo) {
		flex: none;
		border-radius: 10px;
	}
	.text {
		display: grid;
		flex: 1;
		gap: var(--space-1);
		justify-items: start;
		min-width: 0;
	}
	h2 {
		font-size: var(--text-lg);
	}
	p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.show {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		margin-top: var(--space-1);
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.dismiss {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.dismiss:hover {
		background: var(--surface-hover);
	}
</style>
