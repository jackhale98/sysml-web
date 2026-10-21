<script lang="ts">
	import { onMount } from 'svelte';
	import { getEngine } from '#lib/engine/instance.ts';
	import { demoProject } from '#lib/project/demo.ts';
	import { Workspace } from '#lib/project/workspace.svelte.ts';
	import { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import Workbench from '#lib/workbench/Workbench.svelte';

	const workspace = new Workspace();
	const ui = new WorkbenchUi();
	const engine = getEngine();

	onMount(() => {
		void workspace.open(demoProject(), engine);
	});
</script>

<svelte:head>
	<title>{workspace.info?.name ?? 'Project'} · SysML Web</title>
</svelte:head>

<Workbench {workspace} {ui} {engine} />
