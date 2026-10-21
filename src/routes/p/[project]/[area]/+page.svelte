<script lang="ts">
	import { page } from '$app/state';
	import { CircleCheck } from '@lucide/svelte';
	import { areaFor } from '#lib/project/areas.ts';

	const area = $derived(areaFor(page.params.area ?? ''));
</script>

{#if area?.planned}
	<div class="planned">
		<div class="icon"><area.icon size={26} /></div>
		<h1>{area.label}</h1>
		<p class="summary">{area.planned.summary}</p>
		<ul>
			{#each area.planned.points as point (point)}
				<li><CircleCheck size={16} /> {point}</li>
			{/each}
		</ul>
		<p class="when">Planned for phase {area.planned.phase} of the roadmap.</p>
	</div>
{:else}
	<div class="planned">
		<h1>Page not found</h1>
		<p class="summary">This project has no area called “{page.params.area}”.</p>
	</div>
{/if}

<style>
	.planned {
		max-width: 38rem;
		margin: 8vh auto 0;
		text-align: center;
		display: grid;
		justify-items: center;
		gap: var(--space-3);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--radius-lg);
		background: var(--accent-weak);
		color: var(--accent);
	}
	h1 {
		font-size: var(--text-2xl);
	}
	.summary {
		color: var(--text-2);
		font-size: var(--text-lg);
	}
	ul {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: var(--space-4) var(--space-5);
		display: grid;
		gap: var(--space-2);
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	li {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		color: var(--text-2);
	}
	li :global(svg) {
		flex: none;
		margin-top: 0.2rem;
		color: var(--ok);
	}
	.when {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
