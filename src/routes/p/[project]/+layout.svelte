<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<meta
		name="description"
		content="Build SysML v2 models in text or diagrams: requirements, structure, interfaces, behaviour, analysis and risk, stored as standard SysML."
	/>
</svelte:head>

{@render children()}
