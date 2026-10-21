<script lang="ts">
	import { onMount, untrack, type Component, type ComponentProps } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getEngine } from '#lib/engine/instance.ts';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import { demoProject } from '#lib/project/demo.ts';
	import { ProjectSession } from '#lib/project/session.svelte.ts';
	import { Workspace } from '#lib/project/workspace.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import ProjectSplash from '#lib/workbench/ProjectSplash.svelte';
	import { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import type WorkbenchComponent from '#lib/workbench/Workbench.svelte';

	const workspace = new Workspace();
	const ui = new WorkbenchUi();
	const engine = getEngine();
	const session = new ProjectSession(workspace);
	let missing = $state(false);
	/**
	 * The workbench needs the browser and is a large download, so it loads on
	 * its own; until then (and in the prerendered HTML) a light splash shows.
	 */
	// (Left out of the server build, so its stylesheet doesn't block the splash.)
	const loading = import.meta.env.SSR ? null : import('#lib/workbench/Workbench.svelte');
	let Workbench = $state<Component<ComponentProps<typeof WorkbenchComponent>> | null>(null);
	/** The files as opened; changes after that are saved. */
	let opened: Record<string, string> | null = null;

	// The bundled demo can be shown at once; a stored copy (with edits) replaces it.
	if (page.params.project === 'demo') workspace.preview(demoProject());

	onMount(() => {
		void loading?.then((module) => (Workbench = module.default));
		void (async () => {
			const source = await session.load(page.params.project ?? '');
			if (!source) {
				missing = true;
				return;
			}
			// Let the first frame paint before the engine starts downloading.
			await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
			await workspace.open(source, engine);
			opened = workspace.files;
			performance.mark('sysml:workspace-ready', { detail: { ...workspace.state } });
		})();
	});

	// Before reloading for a new version: save what's pending, and ask before losing anything.
	onMount(() =>
		pwa.guardReload(async () => {
			await session.flush();
			if (session.saveState === 'error')
				return confirm('Your latest changes could not be saved in this browser. Reload anyway?');
			const unsaved = session.unsavedToFolder.length;
			if (unsaved)
				return confirm(
					`${unsaved} ${unsaved === 1 ? 'file is' : 'files are'} not saved to the folder yet. Reload anyway?`
				);
			return true;
		})
	);

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
{:else if Workbench}
	<Workbench {workspace} {ui} {engine} {session} />
{:else}
	<ProjectSplash
		name={workspace.info?.name ?? 'Project'}
		description={workspace.info?.description}
	/>
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
