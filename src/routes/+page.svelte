<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ArrowLeftRight,
		ArrowRight,
		BookOpen,
		Crosshair,
		FileCode,
		FileSpreadsheet,
		FolderOpen,
		GitBranch,
		Keyboard,
		ListPlus,
		MonitorSmartphone,
		PenLine,
		Plus,
		ServerOff,
		WandSparkles
	} from '@lucide/svelte';
	import ConceptDemo from '#lib/landing/ConceptDemo.svelte';
	import DiffCard from '#lib/landing/DiffCard.svelte';
	import HeroStage from '#lib/landing/HeroStage.svelte';
	import Practices from '#lib/landing/Practices.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import ThemeToggle from '#lib/ui/ThemeToggle.svelte';

	const demo = resolve('/p/[project]', { project: 'demo' });

	const steps = [
		{
			icon: Keyboard,
			title: 'Type, and the diagram redraws',
			text: 'Write SysML with completion and plain-language hints. Boxes and edges follow every keystroke.'
		},
		{
			icon: PenLine,
			title: 'Draw, and the text is written',
			text: 'Add parts, ports and connections on the canvas. Each becomes a minimal, idiomatic line of SysML.'
		},
		{
			icon: Crosshair,
			title: 'Select either, see both',
			text: 'Pick an element in the text or on the diagram: the other side follows, with the inspector beside it.'
		}
	];

	const guidance = [
		{
			icon: BookOpen,
			title: 'Every keyword, explained',
			text: 'Hover any word for a one-line meaning, an example and the concepts around it.'
		},
		{
			icon: WandSparkles,
			title: 'Problems come with a fix',
			text: '“Battery is used but never defined — create it?” One click writes the SysML.'
		},
		{
			icon: ListPlus,
			title: 'Add what fits, where you are',
			text: 'A port on a part, a transition from a state, satisfy on a requirement: offered in context.'
		}
	];

	const yours = [
		{
			icon: FileCode,
			title: 'Conformant SysML v2',
			text: 'Plain .sysml text, tested against the OMG specification. Any conformant tool can read it.'
		},
		{
			icon: GitBranch,
			title: 'In your git repository',
			text: 'Branches, history and reviews like the rest of your engineering. Every edit is a small, readable diff.'
		},
		{
			icon: ServerOff,
			title: 'No server holds your data',
			text: 'The app runs entirely in your browser and talks straight to your git host.'
		},
		{
			icon: MonitorSmartphone,
			title: 'At your desk or on your phone',
			text: 'Full authoring on desktop; reading, reviewing and quick edits on the go.'
		}
	];

	const families = [
		['requirement', 'Requirements'],
		['structure', 'Architecture'],
		['interface', 'Interfaces'],
		['behavior', 'Behaviour'],
		['analysis', 'FMEA']
	];

	const projects = resolve('/projects');
	const newProject = resolve('/projects#new');
	const soon: { icon: typeof GitBranch; title: string; text: string; href?: string }[] = [
		{
			icon: Plus,
			title: 'Start a new project',
			text: 'A starter model with a first requirement, the system and saved views.',
			href: newProject
		},
		{
			icon: FolderOpen,
			title: 'Open a folder or a .kpar',
			text: 'Work on .sysml files from your computer or another SysML v2 tool.',
			href: projects
		},
		{
			icon: GitBranch,
			title: 'Open a repository',
			text: 'Work on a branch in GitHub, GitLab or Bitbucket and open a pull request.'
		},
		{
			icon: FileSpreadsheet,
			title: 'Start from a spreadsheet',
			text: 'Turn an Excel or CSV requirements list into SysML, column by column.'
		}
	];
</script>

<svelte:head>
	<title>SysML Web — SysML v2 in text and diagrams</title>
	<meta
		name="description"
		content="A web workbench for SysML v2: build models in text or diagrams, live-synced, with every element explained in plain language. Standard SysML in your own git repository; no server holds your data."
	/>
</svelte:head>

<header class="bar">
	<div class="wrap bar-inner">
		<a class="brand" href={resolve('/')}><Logo size={28} /> <span>SysML Web</span></a>
		<nav aria-label="Site">
			<a class="nav-link" href="#how">How it works</a>
			<a class="nav-link" href="#standard">Standard</a>
			<a class="nav-link" href="#start">Get started</a>
			<ThemeToggle />
			<a class="button ghost small" href={demo}>Open the demo</a>
		</nav>
	</div>
</header>

<main>
	<section class="hero" aria-labelledby="hero-title">
		<div class="backdrop" aria-hidden="true"></div>
		<div class="wrap hero-grid">
			<div class="intro">
				<p class="badge"><span class="pulse"></span> SysML v2 · open source · in your browser</p>
				<h1 id="hero-title">
					<span>Write it.</span> <span>Draw it.</span>
					<span class="gradient">Understand it.</span>
				</h1>
				<p class="lede">
					A workbench where SysML v2 text and diagrams edit the same model, live — and every element
					explains itself in plain language. Standard files, in your own git repository.
				</p>
				<div class="actions">
					<a class="button primary" href={demo}>Try the demo <ArrowRight size={18} /></a>
					<a class="button ghost" href="#how">See how it works</a>
				</div>
				<p class="hint">No sign-up. A delivery-drone model opens right in your browser.</p>
			</div>
			<div class="hero-stage">
				<HeroStage />
			</div>
		</div>
	</section>

	<section id="how" class="section" aria-labelledby="how-title">
		<div class="wrap">
			<header class="heading center">
				<p class="kicker"><span>01</span> Text ⇄ diagrams</p>
				<h2 id="how-title">Two ways in. One model.</h2>
				<p class="intro-text">
					Some ideas are quicker to type, others to draw. Use whichever fits the moment — both write
					the same SysML, so neither is ever out of date.
				</p>
			</header>
			<ol class="steps">
				{#each steps as step, i (step.title)}
					<li>
						<span class="step-icon"><step.icon size={20} /></span>
						<span class="step-n">0{i + 1}</span>
						<h3>{step.title}</h3>
						<p>{step.text}</p>
						<div class="mini" aria-hidden="true">
							{#if i === 0}
								<code class="mini-code"><b>part</b> battery : <i>Battery</i>;</code>
								<ArrowRight size={14} />
								<span class="mini-node">battery</span>
							{:else if i === 1}
								<span class="mini-node def">Drone<span class="mini-port"></span></span>
								<ArrowRight size={14} />
								<code class="mini-code"><b>port</b> power : ~<i>PowerPort</i>;</code>
							{:else}
								<code class="mini-code sel"><b>part</b> battery</code>
								<ArrowLeftRight size={14} />
								<span class="mini-node sel">battery</span>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</div>
	</section>

	<section class="section tinted" aria-labelledby="explain-title">
		<div class="wrap split">
			<div>
				<header class="heading">
					<p class="kicker"><span>02</span> SysML that explains itself</p>
					<h2 id="explain-title">Learn the language by using it.</h2>
					<p class="intro-text">
						New to MBSE? Every keyword, element and relationship can tell you what it is, in plain
						words, with an example. Experts get the full depth of SysML v2, never a simplified
						dialect.
					</p>
				</header>
				<ul class="points">
					{#each guidance as g (g.title)}
						<li>
							<span class="point-icon"><g.icon size={18} /></span>
							<div>
								<h3>{g.title}</h3>
								<p>{g.text}</p>
							</div>
						</li>
					{/each}
				</ul>
			</div>
			<ConceptDemo />
		</div>
	</section>

	<section class="section" aria-labelledby="practice-title">
		<div class="wrap">
			<header class="heading center">
				<p class="kicker"><span>03</span> Your practices, modernised</p>
				<h2 id="practice-title">The work you already do, as live model views.</h2>
				<p class="intro-text">
					Requirements lists, interface tables, test matrices and FMEA worksheets become standard
					SysML views over one model — always current, always traced.
				</p>
			</header>
			<Practices />
		</div>
	</section>

	<section id="standard" class="section tinted" aria-labelledby="standard-title">
		<div class="wrap split reverse">
			<div>
				<header class="heading">
					<p class="kicker"><span>04</span> Standard and yours</p>
					<h2 id="standard-title">Plain SysML v2, in your own repository.</h2>
				</header>
				<ul class="pillars">
					{#each yours as y (y.title)}
						<li>
							<span class="point-icon"><y.icon size={18} /></span>
							<h3>{y.title}</h3>
							<p>{y.text}</p>
						</li>
					{/each}
				</ul>
			</div>
			<DiffCard />
		</div>
	</section>

	<section id="start" class="section start" aria-labelledby="start-title">
		<div class="glow" aria-hidden="true"></div>
		<div class="wrap">
			<header class="heading center">
				<p class="kicker"><span>05</span> Get started</p>
				<h2 id="start-title">Open a model in seconds.</h2>
			</header>
			<div class="start-grid">
				<div class="demo-card">
					<p class="recommended">Start here</p>
					<h3>The delivery drone</h3>
					<p>
						A complete model to explore and change: stakeholder needs and requirements, architecture
						and interfaces, flight behaviour, verification and a design FMEA.
					</p>
					<ul class="families" aria-label="What the demo contains">
						{#each families as [family, label] (family)}
							<li style:--family="var(--kind-{family})">{label}</li>
						{/each}
					</ul>
					<a class="button primary" href={demo}>Open the drone demo <ArrowRight size={18} /></a>
				</div>
				<ul class="soon">
					{#each soon as item (item.title)}
						<li class:available={!!item.href}>
							<span class="soon-icon"><item.icon size={18} /></span>
							<div>
								<h3>
									{#if item.href}<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- hrefs above come from resolve() -->
										<a href={item.href}>{item.title}</a>{:else}{item.title}{/if}
								</h3>
								<p>{item.text}</p>
							</div>
							{#if item.href}<ArrowRight size={18} class="go" />{:else}<span class="tag"
									>Coming soon</span
								>{/if}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</section>
</main>

<footer class="foot">
	<div class="wrap foot-inner">
		<p class="foot-brand"><Logo size={22} /> <span>SysML Web</span></p>
		<p>Open source under Apache-2.0 OR MIT.</p>
		<p>SysML is a registered trademark of the Object Management Group.</p>
	</div>
</footer>

<style>
	/* ── Layout ────────────────────────────────────────────────────────────── */
	.wrap {
		width: 100%;
		max-width: 75rem;
		margin: 0 auto;
		padding: 0 var(--space-5);
	}
	@media (max-width: 30rem) {
		.wrap {
			padding: 0 var(--space-4);
		}
	}
	main {
		overflow-x: clip;
	}

	/* ── Top bar ───────────────────────────────────────────────────────────── */
	.bar {
		position: relative;
		z-index: 2;
	}
	.bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		height: 4.25rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--text);
		font-weight: 680;
		font-size: 1.0625rem;
		letter-spacing: -0.015em;
		white-space: nowrap;
	}
	.brand:hover {
		text-decoration: none;
	}
	nav {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.nav-link {
		padding: 0.4rem 0.7rem;
		border-radius: var(--radius-sm);
		color: var(--text-2);
		font-weight: 520;
	}
	.nav-link:hover {
		color: var(--text);
		background: var(--surface-hover);
		text-decoration: none;
	}
	@media (max-width: 52rem) {
		.nav-link {
			display: none;
		}
	}

	/* ── Buttons ───────────────────────────────────────────────────────────── */
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: 2.875rem;
		padding: 0 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font-weight: 600;
		font-size: var(--text-lg);
		white-space: nowrap;
		transition:
			background var(--duration) var(--ease),
			border-color var(--duration) var(--ease),
			transform var(--duration) var(--ease),
			box-shadow var(--duration) var(--ease);
	}
	.button:hover {
		text-decoration: none;
	}
	.button.small {
		height: 2.25rem;
		padding: 0 0.875rem;
		font-size: var(--text-md);
		margin-left: var(--space-1);
	}
	.primary {
		background: var(--accent);
		color: var(--accent-text);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 8px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent);
	}
	.primary:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 12px 28px -8px color-mix(in srgb, var(--accent) 80%, transparent);
	}
	.ghost {
		color: var(--text);
		border-color: var(--border-strong);
		background: var(--surface);
	}
	.ghost:hover {
		border-color: var(--text-3);
	}

	/* ── Hero ──────────────────────────────────────────────────────────────── */
	.hero {
		position: relative;
		isolation: isolate;
		padding: clamp(2rem, 6vw, 4.5rem) 0 clamp(3.5rem, 8vw, 6.5rem);
	}
	.backdrop {
		position: absolute;
		inset: -4.25rem 0 0;
		z-index: -1;
		pointer-events: none;
		mask-image: linear-gradient(#000 60%, transparent);
		background:
			radial-gradient(
				40rem 24rem at 18% 12%,
				color-mix(in srgb, var(--kind-structure) 16%, transparent),
				transparent 70%
			),
			radial-gradient(
				36rem 26rem at 84% 18%,
				color-mix(in srgb, var(--kind-requirement) 12%, transparent),
				transparent 70%
			),
			radial-gradient(
				56rem 26rem at 50% 78%,
				color-mix(in srgb, var(--kind-view) 13%, transparent),
				transparent 70%
			);
	}
	.backdrop::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px),
			linear-gradient(90deg, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px);
		background-size: 48px 48px;
		background-position: center top;
		mask-image: radial-gradient(75% 60% at 50% 28%, #000 15%, transparent 80%);
	}
	.hero-grid {
		display: grid;
		gap: clamp(2.5rem, 5vw, 3.75rem);
	}
	.intro {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.3rem 0.8rem 0.3rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--surface) 80%, transparent);
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: 550;
		box-shadow: var(--shadow-sm);
	}
	.pulse {
		position: relative;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
	}
	h1 {
		margin-top: var(--space-5);
		font-size: clamp(2.875rem, 6.6vw, 5rem);
		font-weight: 760;
		letter-spacing: -0.045em;
		line-height: 1.02;
		text-wrap: balance;
	}
	h1 span {
		display: inline-block;
		padding-bottom: 0.06em;
	}
	@media (max-width: 40rem) {
		h1 span {
			display: block;
		}
	}
	.gradient {
		background: linear-gradient(
			100deg,
			var(--kind-structure) 5%,
			var(--kind-view) 50%,
			var(--kind-requirement) 95%
		);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.lede {
		margin-top: var(--space-5);
		max-width: 38rem;
		font-size: clamp(1.0625rem, 1.5vw, 1.1875rem);
		line-height: 1.6;
		color: var(--text-2);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
		margin-top: var(--space-6);
	}
	.hint {
		margin-top: var(--space-4);
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.hero-stage {
		min-width: 0;
		width: 100%;
		max-width: 64rem;
		margin: 0 auto;
	}

	/* ── Sections ──────────────────────────────────────────────────────────── */
	.section {
		position: relative;
		padding: clamp(4rem, 9vw, 7rem) 0;
	}
	.tinted {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--surface-2) 70%, var(--bg)),
			var(--bg)
		);
		border-top: 1px solid var(--border);
	}
	.heading {
		max-width: 40rem;
		margin-bottom: clamp(2rem, 5vw, 3.25rem);
	}
	.heading.center {
		margin-inline: auto;
		text-align: center;
	}
	.kicker {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.kicker span {
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		background: var(--accent-weak);
	}
	h2 {
		margin-top: var(--space-3);
		font-size: clamp(1.875rem, 4vw, 2.875rem);
		font-weight: 720;
		letter-spacing: -0.035em;
		line-height: 1.08;
		text-wrap: balance;
	}
	.intro-text {
		margin-top: var(--space-4);
		font-size: clamp(1rem, 1.4vw, 1.125rem);
		line-height: 1.6;
		color: var(--text-2);
		text-wrap: pretty;
	}

	/* 01 — steps */
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
		gap: var(--space-4);
		counter-reset: step;
	}
	.steps li {
		position: relative;
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	.step-icon {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--radius-md);
		background: var(--accent-weak);
		color: var(--accent);
	}
	.step-n {
		position: absolute;
		top: var(--space-5);
		right: var(--space-5);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-3);
	}
	.steps h3 {
		margin-top: var(--space-4);
		font-size: var(--text-xl);
		letter-spacing: -0.02em;
	}
	.steps li {
		display: flex;
		flex-direction: column;
	}
	.steps p {
		margin-top: var(--space-2);
		color: var(--text-2);
		line-height: 1.6;
	}
	.mini {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: auto;
		padding-top: var(--space-5);
		color: var(--text-3);
	}
	.mini-code {
		padding: 0.3rem 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--syntax-name);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.mini-code b {
		font-weight: 550;
		color: var(--syntax-keyword);
	}
	.mini-code i {
		font-style: normal;
		color: var(--syntax-type);
	}
	.mini-node {
		position: relative;
		padding: 0.3rem 0.7rem;
		border: 1.5px solid var(--kind-structure);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
	}
	.mini-node.def {
		border-radius: 2px;
		padding-right: 1rem;
		background: color-mix(in srgb, var(--kind-structure) 7%, var(--surface));
	}
	.mini-port {
		position: absolute;
		top: 50%;
		right: -6px;
		width: 10px;
		height: 10px;
		margin-top: -5px;
		border: 1.5px solid var(--kind-interface);
		background: var(--surface);
	}
	.mini .sel {
		border-color: var(--accent);
		background: var(--accent-weak);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
	}

	/* 02 and 04 — split layouts */
	.split {
		display: grid;
		gap: clamp(2.5rem, 6vw, 4.5rem);
		align-items: center;
	}
	@media (min-width: 60rem) {
		.split {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
		}
		.split.reverse {
			grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		}
		.split.reverse > :first-child {
			order: 2;
		}
	}
	.points,
	.pillars {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.points {
		display: grid;
		gap: var(--space-5);
	}
	.points li {
		display: flex;
		gap: var(--space-4);
	}
	.point-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.375rem;
		height: 2.375rem;
		border-radius: var(--radius-md);
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--accent);
		box-shadow: var(--shadow-sm);
	}
	.points h3,
	.pillars h3 {
		font-size: var(--text-lg);
		letter-spacing: -0.01em;
	}
	.points p,
	.pillars p {
		margin-top: 0.2rem;
		color: var(--text-2);
		line-height: 1.6;
	}
	.pillars {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
		gap: var(--space-6) var(--space-5);
	}
	.pillars h3 {
		margin-top: var(--space-3);
	}

	/* 05 — start */
	.start {
		isolation: isolate;
		overflow: hidden;
	}
	.glow {
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(
				40rem 22rem at 30% 70%,
				color-mix(in srgb, var(--accent) 14%, transparent),
				transparent 70%
			),
			radial-gradient(
				30rem 20rem at 80% 40%,
				color-mix(in srgb, var(--kind-requirement) 10%, transparent),
				transparent 70%
			);
	}
	.start-grid {
		display: grid;
		gap: var(--space-4);
	}
	@media (min-width: 56rem) {
		.start-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		}
	}
	.demo-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		padding: clamp(1.5rem, 4vw, 2.25rem);
		border-radius: calc(var(--radius-lg) + 4px);
		background:
			linear-gradient(var(--surface), var(--surface)) padding-box,
			linear-gradient(
					135deg,
					var(--kind-structure),
					var(--kind-view) 45%,
					var(--kind-requirement) 75%,
					var(--kind-analysis)
				)
				border-box;
		border: 2px solid transparent;
		box-shadow: var(--shadow-lg);
	}
	.recommended {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.demo-card h3 {
		margin-top: calc(-1 * var(--space-3));
		font-size: var(--text-2xl);
		letter-spacing: -0.025em;
	}
	.demo-card > p:not(.recommended) {
		color: var(--text-2);
		line-height: 1.6;
		max-width: 34rem;
	}
	.families {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.families li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.6rem 0.2rem 0.5rem;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--family) 35%, var(--border));
		background: color-mix(in srgb, var(--family) 8%, var(--surface));
		font-size: var(--text-sm);
		font-weight: 550;
	}
	.families li::before {
		content: '';
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 2px;
		background: var(--family);
	}
	.demo-card .button {
		margin-top: var(--space-2);
	}
	.soon {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}
	.soon li {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--surface) 60%, transparent);
	}
	.soon li div {
		flex: 1;
	}
	/* Available options are whole-card links (the title link covers the card). */
	.soon li.available {
		position: relative;
		border-style: solid;
		border-color: color-mix(in oklab, var(--accent) 30%, var(--border));
		background: var(--surface);
		transition:
			border-color var(--duration) var(--ease),
			box-shadow var(--duration) var(--ease);
	}
	.soon li.available:hover {
		border-color: var(--accent);
		box-shadow: var(--shadow-md);
	}
	.soon li.available h3 a {
		color: inherit;
		text-decoration: none;
	}
	.soon li.available h3 a::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.soon li.available :global(.go) {
		align-self: center;
		color: var(--accent);
	}
	.soon-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--text-2);
	}
	.soon h3 {
		font-size: var(--text-lg);
	}
	.soon p {
		margin-top: 0.15rem;
		color: var(--text-2);
		font-size: var(--text-md);
	}
	.tag {
		flex: none;
		padding: 0.1rem 0.55rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
	}
	@media (max-width: 30rem) {
		.soon li {
			flex-wrap: wrap;
		}
		.soon li div {
			flex-basis: calc(100% - 3rem);
		}
		.tag {
			margin-left: 3rem;
		}
	}

	/* ── Footer ────────────────────────────────────────────────────────────── */
	.foot {
		border-top: 1px solid var(--border);
	}
	.foot-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding-block: var(--space-6);
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.foot-brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-right: auto;
		color: var(--text);
		font-weight: 650;
	}

	@media (prefers-reduced-motion: no-preference) {
		.pulse::after {
			content: '';
			position: absolute;
			inset: 0;
			border-radius: 50%;
			background: var(--ok);
			animation: beacon 2.4s var(--ease) infinite;
		}
	}
	@keyframes beacon {
		0% {
			transform: scale(1);
			opacity: 0.6;
		}
		70%,
		100% {
			transform: scale(2.6);
			opacity: 0;
		}
	}
</style>
