<script lang="ts">
	import { ArrowRight, X } from '@lucide/svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { keywordOf, type Family } from '#lib/ui/kinds.ts';
	import type { FamilyCount } from './model.ts';

	let {
		families,
		ready,
		onpick
	}: {
		families: FamilyCount[];
		ready: boolean;
		/** Open an element of the chosen family. */
		onpick: (element: ModelElement) => void;
	} = $props();

	const LIMIT = 16;
	let chosen = $state<Family | null>(null);
	const current = $derived(families.find((f) => f.family === chosen) ?? null);
</script>

<section class="glance" aria-labelledby="glance-heading">
	<div class="head">
		<h3 id="glance-heading">Model at a glance</h3>
		<p class="hint">Choose a family to see what is in it.</p>
	</div>
	<ul class="strip">
		{#each families as f (f.family)}
			<li>
				<button
					type="button"
					class="tile"
					style:--fam="var(--kind-{f.family})"
					aria-pressed={chosen === f.family}
					aria-controls="glance-panel"
					aria-disabled={!ready}
					onclick={() => {
						// Not `disabled`: the strip scrolls, so its tiles stay focusable.
						if (ready) chosen = chosen === f.family ? null : f.family;
					}}
				>
					<KindGlyph kind={f.glyph} isDefinition={true} size={26} />
					<span class="count">
						{#if ready}{f.total}{:else}<span class="skeleton"></span>{/if}
					</span>
					<span class="label">{f.label}</span>
				</button>
			</li>
		{/each}
	</ul>
	<div id="glance-panel" class="panel" aria-live="polite">
		{#if current}
			<div class="panel-inner" style:--fam="var(--kind-{current.family})">
				<div class="panel-head">
					<p>
						<strong>{current.label}.</strong>
						{current.blurb}
						<span class="split"
							>{current.definitions}
							{current.definitions === 1 ? 'definition' : 'definitions'} and {current.usages}
							{current.usages === 1 ? 'usage' : 'usages'} in this project.</span
						>
					</p>
					<button
						type="button"
						class="close"
						aria-label="Close {current.label}"
						onclick={() => (chosen = null)}
					>
						<X size={16} />
					</button>
				</div>
				{#if current.elements.length}
					<ul class="chips">
						{#each current.elements.slice(0, LIMIT) as e (e.key)}
							<li>
								<button type="button" class="chip" onclick={() => onpick(e)}>
									<KindGlyph kind={e.kind} isDefinition={e.isDefinition} size={18} />
									<span class="name">{e.label}</span>
									<span class="kw">{keywordOf(e.kind, e.isDefinition)}</span>
								</button>
							</li>
						{/each}
					</ul>
					{#if current.elements.length > LIMIT}
						<p class="more">
							<ArrowRight size={14} aria-hidden="true" />
							{current.elements.length - LIMIT} more in the explorer
						</p>
					{/if}
				{:else}
					<p class="more">This project has none yet.</p>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.glance {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
	}
	h3 {
		font-size: var(--text-lg);
		font-weight: 650;
		letter-spacing: -0.015em;
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.strip {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 7.25rem;
		gap: var(--space-2);
		margin: 0 calc(-1 * var(--gutter));
		padding: 2px var(--gutter) var(--space-2);
		list-style: none;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scroll-padding-inline: var(--gutter);
		scrollbar-width: none;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.strip li {
		scroll-snap-align: start;
		display: flex;
	}
	.tile {
		position: relative;
		display: grid;
		justify-items: start;
		align-content: start;
		width: 100%;
		padding: var(--space-3) var(--space-3) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background:
			linear-gradient(160deg, color-mix(in oklab, var(--fam) 9%, transparent), transparent 60%),
			var(--surface);
		box-shadow: var(--shadow-sm);
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		transition:
			border-color var(--duration) var(--ease),
			box-shadow var(--duration) var(--ease),
			transform var(--duration) var(--ease);
	}
	.tile::after {
		content: '';
		position: absolute;
		inset: auto 0 0;
		height: 3px;
		background: var(--fam);
		opacity: 0;
		transition: opacity var(--duration) var(--ease);
	}
	.tile:hover:not([aria-disabled='true']) {
		border-color: color-mix(in oklab, var(--fam) 45%, var(--border));
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}
	.tile[aria-pressed='true'] {
		border-color: var(--fam);
		box-shadow:
			0 0 0 1px var(--fam),
			var(--shadow-md);
	}
	.tile[aria-pressed='true']::after {
		opacity: 1;
	}
	.tile[aria-disabled='true'] {
		cursor: default;
	}
	.count {
		display: flex;
		align-items: center;
		height: 2.25rem;
		margin-top: var(--space-2);
		font-size: 1.75rem;
		font-weight: 680;
		letter-spacing: -0.035em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.label {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text);
	}
	.split {
		color: var(--text-3);
	}
	.skeleton {
		display: block;
		width: 2.25rem;
		height: 1.4rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
	.panel:empty {
		display: none;
	}
	.panel-inner {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid color-mix(in oklab, var(--fam) 35%, var(--border));
		border-radius: var(--radius-lg);
		background: linear-gradient(
			180deg,
			color-mix(in oklab, var(--fam) 7%, var(--surface)),
			var(--surface)
		);
		animation: rise 220ms var(--ease);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.panel-head p {
		color: var(--text-2);
	}
	.panel-head strong {
		color: var(--text);
	}
	.close {
		display: grid;
		place-items: center;
		flex: none;
		width: 2rem;
		height: 2rem;
		margin: -0.35rem -0.35rem 0 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		max-width: 100%;
		min-height: 2.25rem;
		padding: 0.25rem 0.75rem 0.25rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		cursor: pointer;
		transition: border-color var(--duration) var(--ease);
	}
	.chip:hover {
		border-color: var(--fam);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 550;
	}
	.kw {
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 11px;
		white-space: nowrap;
	}
	.more {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	@container (min-width: 46rem) {
		.strip {
			grid-auto-flow: row;
			grid-template-columns: repeat(7, minmax(0, 1fr));
			margin: 0;
			padding: 2px 0 0;
			overflow: visible;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton,
		.panel-inner {
			animation: none;
		}
		.tile:hover:not([aria-disabled='true']) {
			transform: none;
		}
	}
</style>
