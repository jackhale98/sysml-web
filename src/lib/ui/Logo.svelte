<script lang="ts">
	/**
	 * Fairtide mark. Same API as the previous Logo (`size`), plus `variant`:
	 *   'mark' (default) - transparent mark that inherits the text colour
	 *   'tile'           - the app-icon tile (night square, light mark)
	 * Below 40 px it switches to a simplified drawing (orbit, moon, tide) that
	 * stays legible at favicon sizes.
	 * Colours: --ft-moon (default currentColor), --ft-line (currentColor at 55%).
	 */
	let { size = 24, variant = 'mark' }: { size?: number; variant?: 'mark' | 'tile' } = $props();

	const uid = $props.id();
	const small = $derived(size < 40);
	const w = {
		ring: 2.0,
		wave: 2.2,
		sr: 2.6,
		sw: 1.8,
		dia: 3.4,
		out: 1.0,
		outo: 0.3,
		node: 3.6,
		trail: 2.6,
		ping: 0.9,
		cut: 3.5,
		diaPts: '32,4.60 35.40,8 32,11.40 28.60,8'
	};
</script>

<svg
	class="ft-logo"
	class:tile={variant === 'tile'}
	width={size}
	height={size}
	viewBox="0 0 64 64"
	aria-hidden="true"
>
	{#if variant === 'tile'}<rect width="64" height="64" rx="14" fill="#0F2231" />{/if}
	<g transform={variant === 'tile' ? 'translate(6 6) scale(0.8125)' : undefined}>
		{#if small}
			<defs>
				<mask id="{uid}-phase" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
					<circle cx="32" cy="26" r="13" fill="#fff" /><circle
						cx="25.5"
						cy="26"
						r="13.4"
						fill="#000"
					/>
				</mask>
			</defs>
			<path
				d="M9 46 A25 25 0 1 1 55 46"
				fill="none"
				stroke-width="4.5"
				stroke-linecap="round"
				style="stroke:var(--ft-line)"
			/>
			<circle cx="32" cy="26" r="13" mask="url(#{uid}-phase)" style="fill:var(--ft-moon)" />
			<path
				d="M8 47 C13 43.5 15 43.5 20 47 C22.5 49.5 29.5 49.5 32 47 C37 43.5 39 43.5 44 47 C46.5 49.5 53.5 49.5 56 47"
				fill="none"
				stroke-width="5"
				stroke-linecap="round"
				stroke-linejoin="round"
				style="stroke:var(--ft-moon)"
			/>
		{:else}
			<defs>
				<mask id="{uid}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
					<rect width="64" height="64" fill="#fff" /><circle
						cx="52.78"
						cy="44"
						r={w.cut}
						fill="#000"
					/><circle cx="11.22" cy="44" r={w.cut} fill="#000" />
				</mask>
				<mask id="{uid}-phase" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
					<circle cx="32" cy="29" r="10.5" fill="#fff" /><circle
						cx="27"
						cy="29"
						r="10.9"
						fill="#000"
					/>
				</mask>
			</defs>
			<g mask="url(#{uid}-cut)" fill="none" stroke-linecap="round" stroke-linejoin="round">
				<path
					d="M11.22 44 A24 24 0 1 1 52.78 44"
					stroke-width={w.ring}
					stroke-opacity="0.8"
					style="stroke:var(--ft-line)"
				/>
				<path
					d="M52.78 44 A24 24 0 0 1 11.22 44"
					stroke-width={w.ring}
					stroke-opacity="0.3"
					style="stroke:var(--ft-line)"
				/>
				<path
					d="M11.22 44 C14.12 41.8 15.22 41.8 18.15 44 C19.55 45.8 23.65 45.8 25.07 44 C27.97 41.8 29.07 41.8 32 44 C33.4 45.8 37.5 45.8 38.93 44 C41.83 41.8 42.93 41.8 45.85 44 C47.25 45.8 51.35 45.8 52.78 44"
					stroke-width={w.wave}
					stroke-opacity="0.9"
					style="stroke:var(--ft-moon)"
				/>
			</g>
			<circle cx="32" cy="29" r="10.5" mask="url(#{uid}-phase)" style="fill:var(--ft-moon)" />
			<circle
				cx="32"
				cy="29"
				r="10.5"
				fill="none"
				stroke-width={w.out}
				stroke-opacity={w.outo}
				style="stroke:var(--ft-moon)"
			/>
			<circle
				cx="52.78"
				cy="44"
				r={w.sr}
				fill="none"
				stroke-width={w.sw}
				style="stroke:var(--ft-line)"
			/>
			<circle
				cx="11.22"
				cy="44"
				r={w.sr}
				fill="none"
				stroke-width={w.sw}
				style="stroke:var(--ft-line)"
			/>
			<polygon
				points={w.diaPts}
				stroke-width="0.8"
				stroke-linejoin="round"
				style="fill:var(--ft-line);stroke:var(--ft-line)"
			/>
		{/if}
	</g>
</svg>

<style>
	.ft-logo {
		--ft-moon: currentColor;
		--ft-line: color-mix(in srgb, currentColor 55%, transparent);
		flex-shrink: 0;
	}
	.ft-logo.tile {
		--ft-moon: #eef3f1;
		--ft-line: #8fa9b4;
	}
</style>
