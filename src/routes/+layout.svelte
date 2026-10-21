<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '#lib/styles/global.css';
	import { settings } from '#lib/settings/settings.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';

	let { children } = $props();

	$effect(() => theme.init());
	$effect(() => settings.init());
</script>

<svelte:head>
	<link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{@render children()}
