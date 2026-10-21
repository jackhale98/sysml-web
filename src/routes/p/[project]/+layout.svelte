<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Logo from '#lib/ui/Logo.svelte';

	let { children } = $props();

	const known = $derived(page.params.project === 'demo');
</script>

<svelte:head>
	<meta
		name="description"
		content="Build SysML v2 models in text or diagrams: requirements, structure, interfaces and behaviour, stored as standard SysML."
	/>
</svelte:head>

{#if known}
	{@render children()}
{:else}
	<main class="missing">
		<Logo size={32} />
		<h1>Project not found</h1>
		<p>Only the demo project is available in this preview.</p>
		<a href={resolve('/p/[project]', { project: 'demo' })}>Open the demo project</a>
	</main>
{/if}

<style>
	.missing {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		padding: 20vh var(--space-5);
		text-align: center;
	}
	.missing p {
		color: var(--text-2);
	}
</style>
