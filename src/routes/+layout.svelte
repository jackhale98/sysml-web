<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '#lib/styles/global.css';
	import { theme } from '#lib/ui/theme.svelte.ts';

	let { children } = $props();

	$effect(() => theme.init());
</script>

{@render children()}
