<script lang="ts">
	import TesseraLoader from '#lib/ui/TesseraLoader.svelte';
	import Logo from '#lib/ui/Logo.svelte';

	/**
	 * What a project page shows before the workbench's scripts have run: its
	 * name and description, so a phone has something to read at once. It is
	 * rendered to HTML at build time for the bundled demo.
	 */
	let { name, description }: { name: string; description?: string } = $props();

	const text = $derived(
		description ??
			'A SysML v2 model. The text is the model: every diagram and table here is drawn from it.'
	);
	const lead = $derived(text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text);
	const rest = $derived(text.slice(lead.length).trim());
</script>

<div class="splash" aria-busy="true">
	<header>
		<Logo size={22} />
		<span class="name">{name}</span>
	</header>
	<main>
		<section aria-labelledby="splash-title">
			<p class="eyebrow">SysML v2 project</p>
			<h1 id="splash-title">{name}</h1>
			<p class="lead">{lead}</p>
			{#if rest}<p class="rest">{rest}</p>{/if}
			<div class="loading">
				<TesseraLoader size={72} label="" />
				<p class="status" role="status">Opening the workbench…</p>
			</div>
		</section>
	</main>
</div>

<style>
	.splash {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100dvh;
		overflow: hidden;
		background: var(--bg);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 3rem;
		padding: 0 var(--space-4);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.name {
		font-weight: 650;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	main {
		padding: var(--space-4);
		overflow: hidden;
	}
	section {
		max-width: 60rem;
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 2.75rem);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 4px);
		background: var(--surface);
		box-shadow: var(--shadow-md);
	}
	.eyebrow {
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	h1 {
		margin-top: var(--space-4);
		font-size: clamp(1.875rem, 1.3rem + 2.6vw, 3rem);
		font-weight: 720;
		letter-spacing: -0.035em;
		line-height: 1.05;
		overflow-wrap: anywhere;
	}
	.lead {
		margin-top: var(--space-3);
		max-width: 44ch;
		font-size: var(--text-xl);
		font-weight: 500;
		line-height: 1.4;
		text-wrap: balance;
	}
	.rest {
		margin-top: var(--space-2);
		max-width: 62ch;
		color: var(--text-2);
		line-height: 1.6;
	}
	.loading {
		display: grid;
		justify-items: start;
		gap: var(--space-2);
		margin-top: var(--space-5);
		color: var(--text);
	}
	.status {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
