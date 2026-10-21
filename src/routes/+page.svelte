<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ArrowRight,
		FileSpreadsheet,
		FolderOpen,
		GitBranch,
		LayoutGrid,
		Plus,
		ShieldCheck,
		Waypoints
	} from '@lucide/svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';

	const demo = resolve('/p/[project]', { project: 'demo' });

	const soon = [
		{
			icon: FileSpreadsheet,
			title: 'Start from a spreadsheet',
			text: 'Import requirements from Excel or CSV and map your columns.'
		},
		{
			icon: GitBranch,
			title: 'Open a repository',
			text: 'Work on a model in GitHub, GitLab or Bitbucket.'
		},
		{
			icon: FolderOpen,
			title: 'Open a folder',
			text: 'Edit SysML files on your computer in place.'
		},
		{
			icon: Plus,
			title: 'New project',
			text: 'Start from a template for a product or a safety-critical system.'
		}
	];
</script>

<svelte:head>
	<title>SysML Web — systems engineering on SysML v2</title>
	<meta
		name="description"
		content="Requirements, architecture, verification and risk in one place, stored as standard SysML v2 in your own git repository."
	/>
</svelte:head>

<header class="bar">
	<a class="brand" href={resolve('/')}><Logo size={26} /> <span>SysML Web</span></a>
	<nav aria-label="Site">
		<ThemeToggle />
		<a class="button ghost" href={demo}>Open the demo</a>
	</nav>
</header>

<main>
	<section class="hero">
		<p class="eyebrow">Built on the SysML v2 standard</p>
		<h1>Systems engineering,<br />without the overhead.</h1>
		<p class="lede">
			Requirements, architecture, verification and risk in one place — kept as standard SysML v2 in
			your own git repository. Work in tables and forms you already know; no modelling language
			required.
		</p>
		<div class="actions">
			<a class="button primary" href={demo}>Try the demo <ArrowRight size={16} /></a>
			<span class="hint">A drone project with requirements, components, tests and an FMEA.</span>
		</div>
	</section>

	<section class="pillars" aria-label="Why SysML Web">
		<article>
			<LayoutGrid size={22} />
			<h2>Work the way you already do</h2>
			<p>
				Requirements and FMEAs are spreadsheets with superpowers: paste from Excel, link items by
				picking them, and see gaps the moment they appear.
			</p>
		</article>
		<article>
			<Waypoints size={22} />
			<h2>A standard underneath</h2>
			<p>
				Everything is saved as conformant SysML v2 text, so experts get diagrams and full language
				depth, and other SysML tools can read your model.
			</p>
		</article>
		<article>
			<ShieldCheck size={22} />
			<h2>Your data stays yours</h2>
			<p>
				No server holds your model. It lives in your git repository, with history, reviews and
				branches like the rest of your engineering work.
			</p>
		</article>
	</section>

	<section class="start" aria-labelledby="start-heading">
		<h2 id="start-heading">Other ways to start</h2>
		<p class="sub">Coming in the next releases.</p>
		<ul>
			{#each soon as item (item.title)}
				<li>
					<item.icon size={20} />
					<div>
						<h3>{item.title}</h3>
						<p>{item.text}</p>
					</div>
					<span class="soon">Soon</span>
				</li>
			{/each}
		</ul>
	</section>
</main>

<footer>
	<span>SysML Web · Apache-2.0 OR MIT</span>
	<span>SysML is a registered trademark of the Object Management Group.</span>
</footer>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-5);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text);
		font-weight: 650;
		font-size: var(--text-lg);
		letter-spacing: -0.01em;
	}
	.brand:hover {
		text-decoration: none;
	}
	nav {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 0 var(--space-5);
	}
	.hero {
		padding: clamp(3rem, 9vw, 7rem) 0 clamp(2.5rem, 6vw, 4.5rem);
		max-width: 46rem;
	}
	.eyebrow {
		color: var(--accent);
		font-weight: 600;
		font-size: var(--text-sm);
		margin-bottom: var(--space-4);
	}
	h1 {
		font-size: clamp(2.25rem, 5.5vw, 3.75rem);
		letter-spacing: -0.035em;
		line-height: 1.04;
		font-weight: 680;
	}
	.lede {
		margin-top: var(--space-5);
		font-size: clamp(1.05rem, 1.6vw, 1.2rem);
		color: var(--text-2);
		max-width: 38rem;
		line-height: 1.6;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		margin-top: var(--space-6);
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.375rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		font-weight: 560;
		border: 1px solid transparent;
		transition:
			background var(--duration) var(--ease),
			border-color var(--duration) var(--ease);
	}
	.button:hover {
		text-decoration: none;
	}
	.primary {
		background: var(--accent);
		color: var(--accent-text);
		height: 2.75rem;
		padding: 0 var(--space-5);
		font-size: var(--text-lg);
	}
	.primary:hover {
		background: var(--accent-hover);
	}
	.ghost {
		color: var(--text);
		border-color: var(--border);
		background: var(--surface);
	}
	.ghost:hover {
		border-color: var(--border-strong);
	}
	.pillars {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
	}
	.pillars article {
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		color: var(--accent);
	}
	.pillars h2 {
		margin: var(--space-3) 0 var(--space-2);
		font-size: var(--text-lg);
		color: var(--text);
	}
	.pillars p {
		color: var(--text-2);
	}
	.start {
		margin: var(--space-7) 0;
	}
	.start h2 {
		font-size: var(--text-xl);
	}
	.sub {
		color: var(--text-3);
		margin-top: var(--space-1);
	}
	.start ul {
		list-style: none;
		padding: 0;
		margin: var(--space-4) 0 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: var(--space-3);
	}
	.start li {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
		color: var(--text-3);
	}
	.start li div {
		flex: 1;
	}
	.start h3 {
		font-size: var(--text-md);
		color: var(--text);
	}
	.start li p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.soon {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-2);
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-3);
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--space-5);
		border-top: 1px solid var(--border);
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
