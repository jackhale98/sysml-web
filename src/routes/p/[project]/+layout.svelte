<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { getEngine } from '#lib/engine/instance.ts';
	import { AREAS, areaFor } from '#lib/project/areas.ts';
	import { provideWorkspace } from '#lib/project/context.ts';
	import { demoProject } from '#lib/project/demo.ts';
	import { Workspace } from '#lib/project/workspace.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';

	let { children } = $props();

	const workspace = provideWorkspace(new Workspace());
	const projectId = $derived(page.params.project ?? '');
	const known = $derived(projectId === 'demo');

	$effect(() => {
		if (!known) return;
		untrack(() => workspace.open(demoProject(), getEngine()));
	});

	const prefix = $derived(resolve('/p/[project]', { project: projectId }));
	const currentSlug = $derived(
		page.url.pathname
			.slice(prefix.length)
			.replace(/^\/|\/$/g, '')
			.split('/')[0] ?? ''
	);
	const current = $derived(areaFor(currentSlug));
	const name = $derived(workspace.source?.info.name ?? 'Project');

	function count(slug: string): number | null {
		if (workspace.state.phase !== 'ready') return null;
		if (slug === 'requirements') return workspace.requirements.length;
		if (slug === 'model') return workspace.modelFiles.length;
		return null;
	}
</script>

<svelte:head>
	<title>{current?.label ?? 'Project'} · {name} · SysML Web</title>
</svelte:head>

{#if !known}
	<main class="missing">
		<Logo size={32} />
		<h1>Project not found</h1>
		<p>Only the demo project is available in this preview.</p>
		<a href={resolve('/p/[project]', { project: 'demo' })}>Open the demo project</a>
	</main>
{:else}
	<div class="shell">
		<nav class="sidebar" aria-label="Project">
			<a class="project" href={resolve('/')} title="Home">
				<Logo size={28} />
				<span>
					<strong>{name}</strong>
					<small
						>{workspace.source?.info.version ? `v${workspace.source.info.version}` : 'Demo'}</small
					>
				</span>
			</a>
			<div class="nav">
				<ul>
					{#each AREAS.filter((a) => !a.secondary) as area (area.slug)}
						{@const n = count(area.slug)}
						<li>
							<a
								href={area.slug
									? resolve('/p/[project]/[area]', { project: projectId, area: area.slug })
									: resolve('/p/[project]', { project: projectId })}
								aria-current={current?.slug === area.slug ? 'page' : undefined}
								class:planned={area.planned}
							>
								<area.icon size={17} />
								<span class="label">{area.label}</span>
								{#if n !== null}<span class="count">{n}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
				<ul class="secondary">
					{#each AREAS.filter((a) => a.secondary) as area (area.slug)}
						{@const n = count(area.slug)}
						<li>
							<a
								href={area.slug
									? resolve('/p/[project]/[area]', { project: projectId, area: area.slug })
									: resolve('/p/[project]', { project: projectId })}
								aria-current={current?.slug === area.slug ? 'page' : undefined}
								class:planned={area.planned}
							>
								<area.icon size={17} />
								<span class="label">{area.label}</span>
								{#if n !== null}<span class="count">{n}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		</nav>

		<div class="main">
			<header class="topbar">
				<div class="crumbs">
					<span class="crumb-project">{name}</span>
					<span aria-hidden="true">/</span>
					<span class="crumb-area">{current?.label ?? ''}</span>
				</div>
				<div class="status" role="status" aria-live="polite">
					{#if workspace.state.phase === 'loading'}
						<LoaderCircle size={15} class="spin" />
						Analysing {workspace.state.done} of {workspace.state.total} files…
					{:else if workspace.state.phase === 'ready'}
						<span class="ok-dot" aria-hidden="true"></span>
						Analysed in {Math.round(workspace.state.millis)} ms
					{:else if workspace.state.phase === 'error'}
						<CircleAlert size={15} />
						Analysis failed
					{/if}
				</div>
				<ThemeToggle />
			</header>
			<main class="content">
				{#if workspace.state.phase === 'error'}
					<div class="failure" role="alert">
						<CircleAlert size={20} />
						<div>
							<strong>The SysML engine could not analyse this project.</strong>
							<p>{workspace.state.message}</p>
						</div>
					</div>
				{/if}
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
		min-height: 100vh;
	}
	.sidebar {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
		border-right: 1px solid var(--border);
		background: var(--surface);
	}
	.project {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		color: var(--text);
	}
	.project:hover {
		background: var(--surface-hover);
		text-decoration: none;
	}
	.project span {
		display: grid;
		line-height: 1.25;
		min-width: 0;
	}
	.project strong {
		font-weight: 620;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.project small {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.nav {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		flex: 1;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.secondary {
		padding-top: var(--space-3);
		border-top: 1px solid var(--border);
	}
	.nav a {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: 2.125rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--text-2);
		font-weight: 500;
	}
	.nav a:hover {
		background: var(--surface-hover);
		color: var(--text);
		text-decoration: none;
	}
	.nav a[aria-current='page'] {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.label {
		flex: 1;
	}
	.count {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.nav a[aria-current='page'] .count {
		color: inherit;
	}
	.main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		height: var(--topbar-height);
		padding: 0 var(--space-5);
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(8px);
	}
	.crumbs {
		flex: 1;
		display: flex;
		gap: var(--space-2);
		color: var(--text-3);
		min-width: 0;
	}
	.crumb-area {
		color: var(--text);
		font-weight: 560;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.ok-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
	}
	.status :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.content {
		padding: var(--space-5) var(--space-5) var(--space-7);
	}
	.failure {
		display: flex;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--danger-weak);
		color: var(--danger);
	}
	.failure p {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
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
	@media (max-width: 860px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.sidebar {
			position: static;
			height: auto;
			flex-direction: row;
			align-items: center;
			overflow-x: auto;
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}
		.project span {
			display: none;
		}
		.nav,
		ul {
			display: flex;
			flex-direction: row;
		}
		.secondary {
			padding-top: 0;
			border-top: 0;
			padding-left: var(--space-2);
			border-left: 1px solid var(--border);
		}
		.nav a {
			white-space: nowrap;
		}
		.status {
			display: none;
		}
	}
</style>
