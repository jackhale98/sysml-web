<script lang="ts" module>
	export type Section = 'home' | 'model' | 'views';
</script>

<script lang="ts">
	import { House, ListTree, PanelBottomOpen, Shapes } from '@lucide/svelte';

	/**
	 * The phone's bottom navigation: three places (overview, model, views) and
	 * the element details sheet. The current place is marked as the page.
	 */
	let {
		current,
		detailsOpen,
		hasSelection,
		viewCount,
		onnavigate,
		ondetails
	}: {
		current: Section | null;
		detailsOpen: boolean;
		hasSelection: boolean;
		viewCount: number;
		onnavigate: (section: Section) => void;
		ondetails: () => void;
	} = $props();

	const items = [
		{ id: 'home', label: 'Home', icon: House },
		{ id: 'model', label: 'Model', icon: ListTree },
		{ id: 'views', label: 'Views', icon: Shapes }
	] as const;
</script>

<nav class="mobile-nav" aria-label="Sections">
	{#each items as item (item.id)}
		{@const active = current === item.id && !detailsOpen}
		<button
			type="button"
			class:active
			aria-current={current === item.id ? 'page' : undefined}
			onclick={() => onnavigate(item.id)}
		>
			<span class="pill">
				<item.icon size={20} strokeWidth={active ? 2.3 : 1.9} />
				{#if item.id === 'views' && viewCount > 0}<span class="badge" aria-hidden="true"
						>{viewCount}</span
					>{/if}
			</span>
			<span class="label">{item.label}</span>
		</button>
	{/each}
	<button type="button" class:active={detailsOpen} aria-expanded={detailsOpen} onclick={ondetails}>
		<span class="pill">
			<PanelBottomOpen size={20} strokeWidth={detailsOpen ? 2.3 : 1.9} />
			{#if hasSelection && !detailsOpen}<span class="dot" aria-hidden="true"></span>{/if}
		</span>
		<span class="label">Details</span>
	</button>
</nav>

<style>
	.mobile-nav {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		padding: 0 max(var(--space-1), env(safe-area-inset-right)) env(safe-area-inset-bottom)
			max(var(--space-1), env(safe-area-inset-left));
		border-top: 1px solid var(--border);
		background: color-mix(in oklab, var(--surface) 92%, transparent);
		backdrop-filter: saturate(1.4) blur(12px);
	}
	button {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 2px;
		height: 3.75rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.pill {
		position: relative;
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 1.875rem;
		border-radius: 999px;
		transition:
			background 200ms var(--ease),
			color 200ms var(--ease),
			transform 200ms var(--ease);
	}
	button:active .pill {
		transform: scale(0.92);
	}
	.label {
		font-size: var(--text-xs);
		font-weight: 560;
		letter-spacing: 0.01em;
	}
	.active {
		color: var(--text);
	}
	.active .pill {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.active .label {
		font-weight: 700;
	}
	.badge {
		position: absolute;
		top: -2px;
		right: 6px;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--text-2);
		color: var(--surface);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.1rem;
		text-align: center;
	}
	.dot {
		position: absolute;
		top: 3px;
		right: 14px;
		width: 0.5rem;
		height: 0.5rem;
		border: 2px solid var(--surface);
		border-radius: 50%;
		background: var(--accent);
		box-sizing: content-box;
	}
</style>
