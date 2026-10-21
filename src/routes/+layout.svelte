<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '#lib/styles/global.css';
	import { page } from '$app/state';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import { settings } from '#lib/settings/settings.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';

	let { children } = $props();

	$effect(() => theme.init());
	$effect(() => settings.init());
	$effect(() => pwa.init());

	// The workbench shows its own notices; other pages load the toaster only for "new version".
	const ownToaster = $derived(page.route.id?.startsWith('/p/') ?? false);
</script>

<svelte:head>
	<link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{@render children()}

{#if pwa.updateReady && !ownToaster}
	{#await import('#lib/ui/Toaster.svelte') then { default: Toaster }}
		<Toaster />
	{/await}
{/if}
