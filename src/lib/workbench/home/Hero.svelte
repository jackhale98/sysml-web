<script lang="ts">
	import { onMount } from 'svelte';
	import { Compass, FileCode, Network, Search, Shapes, Timer } from '@lucide/svelte';
	import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '../ui.svelte.ts';
	import HeroModel from './HeroModel.svelte';
	import { duration } from './model.ts';

	let {
		workspace,
		ui,
		tourPath,
		architecture,
		showcase,
		ownElements
	}: {
		workspace: Workspace;
		ui: WorkbenchUi;
		tourPath: string | null;
		architecture: ModelElement | null;
		showcase: TreeNode | null;
		ownElements: number;
	} = $props();

	const ready = $derived(workspace.state.phase === 'ready');
	const description = $derived(
		workspace.info?.description ??
			'A SysML v2 model. The text is the model: every diagram and table here is drawn from it, and editing a diagram edits the text.'
	);
	/** The first sentence leads; the rest reads as detail. */
	const lead = $derived(description.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? description);
	const rest = $derived(description.slice(lead.length).trim());

	let shortcut = $state('Ctrl K');
	onMount(() => {
		if (/Mac|iPhone|iPad/.test(navigator.userAgent)) shortcut = '⌘K';
	});

	function openArchitecture() {
		if (!architecture) return;
		ui.open({
			kind: 'diagram',
			view: 'general',
			scope: architecture.name,
			title: architecture.label
		});
	}
</script>

<section class="hero" aria-labelledby="project-title">
	<div class="backdrop" aria-hidden="true"></div>
	<div class="intro">
		<p class="eyebrow">
			<span class="spark" aria-hidden="true"></span>
			SysML v2 project{#if workspace.info?.version}<span class="version"
					>v{workspace.info.version}</span
				>{/if}
		</p>
		<h2 id="project-title" class="title">{workspace.info?.name ?? 'Project'}</h2>
		<p class="lead">{lead}</p>
		{#if rest}<p class="description">{rest}</p>{/if}

		<ul class="facts" aria-label="Project facts">
			<li><FileCode size={14} aria-hidden="true" /> {workspace.modelPaths.length} model files</li>
			<li>
				<Shapes size={14} aria-hidden="true" />
				{#if ready}{ownElements} elements{:else}<span class="skeleton"></span> elements{/if}
			</li>
			<li>
				<Timer size={14} aria-hidden="true" />
				{#if workspace.state.phase === 'ready'}Analysed in {duration(
						workspace.state.millis
					)}{:else}Analysing…{/if}
			</li>
		</ul>
	</div>
	<div class="art">
		<HeroModel node={showcase} {ready} />
	</div>
	<div class="actions">
		{#if tourPath}
			<button
				type="button"
				class="button primary"
				onclick={() => ui.open({ kind: 'file', path: tourPath })}
			>
				<Compass size={18} aria-hidden="true" /> Start the tour
			</button>
		{/if}
		<button
			type="button"
			class="button"
			class:primary={!tourPath}
			class:secondary={!!tourPath}
			disabled={!architecture}
			onclick={openArchitecture}
		>
			<Network size={18} aria-hidden="true" /> Architecture<span class="wide-only"
				>&nbsp;diagram</span
			>
		</button>
		<button
			type="button"
			class="button ghost"
			aria-keyshortcuts="Meta+K Control+K"
			onclick={() => (ui.paletteOpen = true)}
		>
			<Search size={17} aria-hidden="true" /> Search
			<kbd class="wide-only" aria-hidden="true">{shortcut}</kbd>
		</button>
	</div>
</section>

<style>
	.hero {
		position: relative;
		isolation: isolate;
		display: grid;
		gap: var(--space-5);
		padding: clamp(1.5rem, 4cqi, 2.75rem);
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 4px);
		background: var(--surface);
		box-shadow: var(--shadow-md);
	}
	.backdrop {
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		background:
			radial-gradient(
				32rem 20rem at 0% 0%,
				color-mix(in oklab, var(--kind-structure) 15%, transparent),
				transparent 70%
			),
			radial-gradient(
				28rem 22rem at 100% 10%,
				color-mix(in oklab, var(--kind-requirement) 11%, transparent),
				transparent 70%
			),
			radial-gradient(
				40rem 18rem at 70% 110%,
				color-mix(in oklab, var(--kind-interface) 11%, transparent),
				transparent 70%
			);
	}
	.backdrop::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(color-mix(in oklab, var(--text) 6%, transparent) 1px, transparent 1px),
			linear-gradient(90deg, color-mix(in oklab, var(--text) 6%, transparent) 1px, transparent 1px);
		background-size: 32px 32px;
		mask-image: radial-gradient(70% 90% at 85% 40%, #000 10%, transparent 75%);
	}
	.intro {
		align-self: center;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0.2rem 0.7rem 0.2rem 0.55rem;
		border: 1px solid color-mix(in oklab, var(--accent) 25%, var(--border));
		border-radius: var(--radius-pill);
		background: color-mix(in oklab, var(--accent-weak) 70%, var(--surface));
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.spark {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 2px;
		background: linear-gradient(135deg, var(--kind-structure), var(--kind-requirement));
		transform: rotate(45deg);
	}
	.version {
		padding-left: var(--space-2);
		border-left: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
		font-weight: 500;
	}
	.title {
		margin-top: var(--space-4);
		font-size: clamp(1.875rem, 1.3rem + 2.6cqi, 3rem);
		font-weight: 720;
		letter-spacing: -0.035em;
		line-height: 1.05;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.lead {
		margin-top: var(--space-3);
		max-width: 44ch;
		color: var(--text);
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.01em;
		line-height: 1.4;
		text-wrap: balance;
	}
	.description {
		margin-top: var(--space-2);
		max-width: 62ch;
		color: var(--text-2);
		line-height: 1.6;
		text-wrap: pretty;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		color: var(--text-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.facts li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 1.25rem;
	}
	.facts :global(svg) {
		color: var(--text-3);
	}
	.skeleton {
		display: inline-block;
		width: 1.75rem;
		height: 0.7rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		min-width: 0;
	}
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: 2.75rem;
		padding: 0 1.1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--duration) var(--ease),
			border-color var(--duration) var(--ease),
			transform var(--duration) var(--ease),
			box-shadow var(--duration) var(--ease);
	}
	.button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.primary {
		background: var(--accent);
		color: var(--accent-text);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 8px 22px -8px color-mix(in oklab, var(--accent) 75%, transparent);
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 12px 26px -8px color-mix(in oklab, var(--accent) 85%, transparent);
	}
	.secondary {
		border-color: color-mix(in oklab, var(--accent) 30%, var(--border));
		background: color-mix(in oklab, var(--accent-weak) 60%, var(--surface));
		color: var(--accent);
	}
	.secondary:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.ghost {
		border-color: var(--border-strong);
		background: var(--surface);
		color: var(--text);
	}
	.ghost:hover {
		border-color: var(--text-3);
	}
	kbd {
		margin-left: var(--space-1);
		padding: 0.05rem 0.4rem;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		font-weight: 600;
	}
	.art {
		display: none;
		min-width: 0;
	}

	@container (max-width: 34rem) {
		.button {
			flex: 1 1 40%;
			padding: 0 0.75rem;
		}
		.button.primary:first-child {
			flex-basis: 100%;
		}
		.wide-only {
			display: none;
		}
		.lead {
			font-size: var(--text-lg);
		}
		.description {
			font-size: var(--text-sm);
		}
	}
	@container (min-width: 50rem) {
		.hero {
			grid-template-columns: minmax(0, 1fr) 17.5rem;
			column-gap: var(--space-6);
		}
		.art {
			display: block;
			align-self: center;
		}
		.actions {
			grid-column: 1 / -1;
		}
	}
	@container (min-width: 64rem) {
		.hero {
			grid-template-columns: minmax(0, 1fr) 21rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
		.button:hover:not(:disabled) {
			transform: none;
		}
	}
</style>
