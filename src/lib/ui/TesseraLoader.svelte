<!--
  Tessera loader. Startup (1.7 s, once): the three faces of the cube lock
  together, the slate tiles set one by one, and the sea-glass tile drops in
  last. Loop (6 s, seamless): the sea-glass tile lifts and resets, then the
  cube turns a third of a revolution; three turns return it to the start.

  Light and dark: the cube is drawn in currentColor (the side face at 62% and
  the slate tiles at 38% opacity), so it follows the app theme. The accent is
  light-dark(#2F8A78, #5FB3A1), chosen by the page's color-scheme.
  Override with --tx-accent. Honours prefers-reduced-motion (still cube).
-->
<script lang="ts">
	let {
		size = 96,
		intro = true,
		label = 'Loading'
	}: {
		/** Rendered width and height in px. */
		size?: number;
		/** Play the 1.7 s assembly before looping. Set false to start in the loop. */
		intro?: boolean;
		/** Accessible name for the graphic. */
		label?: string;
	} = $props();
</script>

<svg
	class="tx-loader"
	class:no-intro={!intro}
	viewBox="0 0 64 64"
	width={size}
	height={size}
	role="img"
	aria-label={label}
>
	<g class="tx-spin"
		><g class="tx-it"
			><polygon
				points="32.00,7.30 52.27,19.00 32.00,30.70 11.73,19.00"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linejoin="round"
			/></g
		><g class="tx-il"
			><polygon
				points="10.61,20.95 30.87,32.65 30.87,56.05 10.61,44.35"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linejoin="round"
				opacity="0.62"
			/></g
		><g class="tx-ir"
			><g class="tx-pop q1"
				><polygon
					points="34.04,33.18 42.35,28.38 42.35,37.97 34.04,42.77"
					fill="currentColor"
					stroke="currentColor"
					stroke-width="0.9"
					stroke-linejoin="round"
					opacity="0.38"
				/></g
			><g class="tx-pop q2"
				><polygon
					points="34.04,44.88 42.35,40.08 42.35,49.67 34.04,54.47"
					fill="currentColor"
					stroke="currentColor"
					stroke-width="0.9"
					stroke-linejoin="round"
					opacity="0.38"
				/></g
			><g class="tx-pop q3"
				><polygon
					points="44.17,39.03 52.48,34.23 52.48,43.82 44.17,48.62"
					fill="currentColor"
					stroke="currentColor"
					stroke-width="0.9"
					stroke-linejoin="round"
					opacity="0.38"
				/></g
			><g class="tx-drop"
				><g class="tx-hop"
					><polygon
						points="44.17,27.33 52.48,22.53 52.48,32.12 44.17,36.92"
						style="fill:var(--tx-accent);stroke:var(--tx-accent)"
						stroke-width="0.9"
						stroke-linejoin="round"
					/></g
				></g
			></g
		></g
	>
</svg>

<style>
	.tx-loader {
		--tx-accent: light-dark(#2f8a78, #5fb3a1);
		display: inline-block;
		vertical-align: middle;
		overflow: visible;
	}

	.tx-it {
		animation: tx-it 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.tx-il {
		animation: tx-il 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.12s both;
	}
	.tx-ir {
		animation: tx-ir 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.24s both;
	}
	.tx-pop {
		transform-box: fill-box;
		transform-origin: center;
		animation: tx-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.tx-pop.q1 {
		animation-delay: 0.6s;
	}
	.tx-pop.q2 {
		animation-delay: 0.72s;
	}
	.tx-pop.q3 {
		animation-delay: 0.84s;
	}
	.tx-drop {
		animation: tx-drop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 1.05s both;
	}
	.tx-spin {
		transform-box: view-box;
		transform-origin: 32px 32px;
		animation: tx-spin 6s cubic-bezier(0.65, 0, 0.35, 1) 1.7s infinite both;
	}
	.tx-hop {
		animation: tx-hop 6s ease-in-out 1.7s infinite both;
	}
	@keyframes tx-it {
		from {
			transform: translate(0, -12px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes tx-il {
		from {
			transform: translate(-11px, 7px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes tx-ir {
		from {
			transform: translate(11px, 7px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes tx-pop {
		from {
			transform: scale(0);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes tx-drop {
		from {
			transform: translate(8.07px, 4.65px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes tx-spin {
		0%,
		18.33% {
			transform: rotate(0deg);
		}
		31.67%,
		51.67% {
			transform: rotate(120deg);
		}
		65%,
		85% {
			transform: rotate(240deg);
		}
		98.33%,
		100% {
			transform: rotate(360deg);
		}
	}
	@keyframes tx-hop {
		0%,
		1.67%,
		11.67%,
		35%,
		45%,
		68.33%,
		78.33%,
		100% {
			transform: none;
		}
		5.5%,
		38.83%,
		72.17% {
			transform: translate(4.14px, 2.38px);
		}
		9.5%,
		42.83%,
		76.17% {
			transform: translate(-0.46px, -0.26px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tx-it,
		.tx-il,
		.tx-ir,
		.tx-pop,
		.tx-drop,
		.tx-spin,
		.tx-hop {
			animation: none;
		}
	}

	.no-intro .tx-it,
	.no-intro .tx-il,
	.no-intro .tx-ir,
	.no-intro .tx-pop,
	.no-intro .tx-drop {
		animation: none;
	}
	.no-intro .tx-spin,
	.no-intro .tx-hop {
		animation-delay: 0s;
	}
</style>
