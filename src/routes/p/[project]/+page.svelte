<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getEngine } from '#lib/engine/instance.ts';
	import { ProjectSession } from '#lib/project/session.svelte.ts';
	import { Workspace } from '#lib/project/workspace.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import Workbench from '#lib/workbench/Workbench.svelte';

	const workspace = new Workspace();
	const ui = new WorkbenchUi();
	const engine = getEngine();
	const session = new ProjectSession(workspace);
	let missing = $state(false);
	/** The files as opened; changes after that are saved. */
	let opened: Record<string, string> | null = null;

	onMount(() => {
		void (async () => {
			const source = await session.load(page.params.project ?? '');
			if (!source) {
				missing = true;
				return;
			}
			await workspace.open(source, engine);
			opened = workspace.files;
		})();
	});

	// Save every change to this browser shortly after it is made.
	$effect(() => {
		const files = workspace.files;
		if (opened && files !== opened) untrack(() => session.changed());
	});
</script>

<svelte:head>
	<title>{workspace.info?.name ?? 'Project'} · SysML Web</title>
</svelte:head>

{#if missing}
	<main class="missing">
		<Logo size={32} />
		<h1>Project not found</h1>
		<p>It isn't stored in this browser. Projects live where you open them.</p>
		<a href={resolve('/projects')}>See your projects</a>
	</main>
{:else}
	<Workbench {workspace} {ui} {engine} {session} />
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
