<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft } from '@lucide/svelte';
	import HelpGuide from '#lib/help/HelpGuide.svelte';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
	import Wordmark from '#lib/ui/Wordmark.svelte';
	import type { GuideAction } from '#lib/workbench/guide.ts';

	/** Without a project open, only what needs no project is offered. */
	const HERE: GuideAction[] = ['new-project', 'switch-project', 'install'];

	function run(action: GuideAction) {
		if (action === 'install') pwa.offerInstall();
		else void goto(resolve(action === 'new-project' ? '/projects?new' : '/projects'));
	}

	const topic = typeof location !== 'undefined' ? location.hash.slice(1) || null : null;
</script>

<svelte:head>
	<title>Help · Fairtide</title>
	<meta
		name="description"
		content="How to use Fairtide: projects, SysML ideas in plain words, how-tos, shortcuts and where your data is kept."
	/>
</svelte:head>

<div class="page">
	<header class="top">
		<a class="brand" href={resolve('/')}><Logo size={26} /> <Wordmark height={19} /></a>
		<span class="tools">
			<a class="back" href={resolve('/projects')}
				><ArrowLeft size={16} aria-hidden="true" /> Your projects</a
			>
			<ThemeToggle />
		</span>
	</header>
	<main>
		<h1>Help</h1>
		<p class="lede">
			Fairtide is a workbench for SysML v2 models. Here is how it works, in plain words.
		</p>
		<HelpGuide {topic} onaction={run} canRun={(a) => HERE.includes(a)} />
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
		background: var(--bg);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-4);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text);
		text-decoration: none;
	}
	.tools {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		color: var(--text-2);
		font-weight: 600;
		text-decoration: none;
	}
	.back:hover {
		color: var(--accent);
	}
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-2) var(--space-4) var(--space-8, 4rem);
	}
	h1 {
		font-size: clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem);
		letter-spacing: -0.02em;
	}
	.lede {
		margin: var(--space-2) 0 var(--space-5);
		color: var(--text-2);
	}
</style>
