<script lang="ts">
	/**
	 * Tessera mark. Same API as the previous Logo (`size`), plus `variant`:
	 *   'mark' (default) - transparent mark in currentColor, follows the theme
	 *   'tile'           - the app-icon tile (night square, light mark)
	 * Below 32 px it uses a simplified drawing (solid tiled face with the
	 * sea-glass corner) that stays crisp at favicon sizes.
	 * Accent: light-dark(#2F8A78, #5FB3A1) via color-scheme; override with --tx-accent.
	 */
	let { size = 24, variant = 'mark' }: { size?: number; variant?: 'mark' | 'tile' } = $props();

	const small = $derived(size < 32);
</script>

<svg
	class="tx-logo"
	class:tile={variant === 'tile'}
	width={size}
	height={size}
	viewBox="0 0 64 64"
	aria-hidden="true"
>
	{#if variant === 'tile'}<rect width="64" height="64" rx="14" fill="#0F2231" />{/if}
	<g transform={variant === 'tile' ? 'translate(5 5) scale(0.84375)' : undefined}>
		{#if small}
			<polygon
				points="32.00,7.04 52.72,19.00 32.00,30.96 11.28,19.00"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
			/><polygon
				points="10.38,20.56 31.10,32.52 31.10,56.44 10.38,44.48"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
				opacity="0.62"
			/><polygon
				points="32.90,32.52 53.62,20.56 53.62,44.48 32.90,56.44"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
				opacity="0.38"
			/><polygon
				points="43.26,26.54 53.62,20.56 53.62,32.52 43.26,38.50"
				style="fill:var(--tx-accent);stroke:var(--tx-accent)"
				stroke-width="1.6"
				stroke-linejoin="round"
			/>
		{:else}
			<polygon
				points="32.00,7.30 52.27,19.00 32.00,30.70 11.73,19.00"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linejoin="round"
			/><polygon
				points="10.61,20.95 30.87,32.65 30.87,56.05 10.61,44.35"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linejoin="round"
				opacity="0.62"
			/><polygon
				points="34.04,33.18 42.35,28.38 42.35,37.97 34.04,42.77"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="0.9"
				stroke-linejoin="round"
				opacity="0.38"
			/><polygon
				points="34.04,44.88 42.35,40.08 42.35,49.67 34.04,54.47"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="0.9"
				stroke-linejoin="round"
				opacity="0.38"
			/><polygon
				points="44.17,39.03 52.48,34.23 52.48,43.82 44.17,48.62"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="0.9"
				stroke-linejoin="round"
				opacity="0.38"
			/><polygon
				points="44.17,27.33 52.48,22.53 52.48,32.12 44.17,36.92"
				style="fill:var(--tx-accent);stroke:var(--tx-accent)"
				stroke-width="0.9"
				stroke-linejoin="round"
			/>
		{/if}
	</g>
</svg>

<style>
	.tx-logo {
		--tx-accent: light-dark(#2f8a78, #5fb3a1);
		flex-shrink: 0;
	}
	.tx-logo.tile {
		color: #eef3f1;
		--tx-accent: #5fb3a1;
	}
</style>
