<!--
  Fairtide loader. Draws the mark in once (1.5 s), then loops seamlessly (3.6 s):
  a node steps between the three stations (diamond, right circle, left circle),
  dips under the tide on the low pass while a glint runs along the wave,
  and the moon runs one full cycle of phases per orbit.

  Colours inherit from CSS custom properties so it works on any theme:
    --ft-moon   moon and tide line      (default: currentColor)
    --ft-line   orbit and stations      (default: currentColor at 55%)
    --ft-accent travelling node, glints (default: sea glass, #2F8A78 in light
                and #5FB3A1 in dark, chosen by the page's color-scheme)
  Works in light and dark themes with no extra wiring.
  Honours prefers-reduced-motion: shows a still crescent with no motion.
-->
<script lang="ts">
	let {
		size = 96,
		intro = true,
		label = 'Loading'
	}: {
		/** Rendered width and height in px. Below 48 px a heavier stroke set is used. */
		size?: number;
		/** Play the 1.5 s draw-in before looping. Set false to start straight in the loop. */
		intro?: boolean;
		/** Accessible name announced for the graphic; empty when status text beside it says what's happening. */
		label?: string;
	} = $props();

	const uid = $props.id();
	const DISPLAY = {
		ring: 1.2,
		wave: 1.5,
		sr: 2.0,
		sw: 1.2,
		dia: 2.7,
		out: 0.7,
		outo: 0.35,
		node: 2.8,
		trail: 1.8,
		ping: 0.6,
		cut: 2.6,
		diaPts: '32,5.30 34.70,8 32,10.70 29.30,8'
	};
	const STANDARD = {
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
	const w = $derived(size < 48 ? STANDARD : DISPLAY);
</script>

<svg
	class="ft-loader"
	class:no-intro={!intro}
	viewBox="0 0 64 64"
	width={size}
	height={size}
	role={label ? 'img' : undefined}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
>
	<defs>
		<mask id="{uid}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"
			><rect width="64" height="64" fill="#fff" /><circle
				cx="52.78"
				cy="44"
				r={w.cut}
				fill="#000"
			/><circle cx="11.22" cy="44" r={w.cut} fill="#000" /></mask
		>
		<mask id="{uid}-phase" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"
			><circle cx="32" cy="29" r="10.5" fill="#fff" /><g class="ot-shadows"
				><circle cx="32" cy="29" r="10.9" fill="#000" /><circle
					cx="80"
					cy="29"
					r="10.9"
					fill="#000"
				/><circle cx="128" cy="29" r="10.9" fill="#000" /></g
			></mask
		>
		<linearGradient
			id="{uid}-trail"
			gradientUnits="userSpaceOnUse"
			x1="20.7"
			y1="10.8"
			x2="32"
			y2="8"
			><stop offset="0" stop-opacity="0" style="stop-color:var(--ft-accent)" /><stop
				offset="1"
				style="stop-color:var(--ft-accent)"
			/></linearGradient
		>
	</defs>
	<g mask="url(#{uid}-cut)" fill="none" stroke-linecap="round">
		<path
			class="ot-draw ot-up"
			pathLength="100"
			d="M11.22 44 A24 24 0 1 1 52.78 44"
			stroke-width={w.ring}
			stroke-opacity="0.8"
			style="stroke:var(--ft-line)"
		/>
		<path
			class="ot-draw ot-low"
			pathLength="100"
			d="M52.78 44 A24 24 0 0 1 11.22 44"
			stroke-width={w.ring}
			stroke-opacity="0.28"
			style="stroke:var(--ft-line)"
		/>
	</g>
	<g class="ot-disc">
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
	</g>
	<g class="ot-orbit"
		><g class="ot-dim">
			<path
				class="ot-trail"
				d="M20.73 10.81 A24 24 0 0 1 32 8"
				fill="none"
				stroke="url(#{uid}-trail)"
				stroke-width={w.trail}
				stroke-linecap="round"
			/>
			<circle class="ot-pop ot-node" cx="32" cy="8" r={w.node} style="fill:var(--ft-accent)" />
		</g></g
	>
	<g mask="url(#{uid}-cut)" fill="none" stroke-linecap="round" stroke-linejoin="round">
		<path
			class="ot-draw ot-water"
			pathLength="100"
			d="M11.22 44 C14.12 41.8 15.22 41.8 18.15 44 C19.55 45.8 23.65 45.8 25.07 44 C27.97 41.8 29.07 41.8 32 44 C33.4 45.8 37.5 45.8 38.93 44 C41.83 41.8 42.93 41.8 45.85 44 C47.25 45.8 51.35 45.8 52.78 44"
			stroke-width={w.wave}
			stroke-opacity="0.9"
			style="stroke:var(--ft-moon)"
		/>
		<path
			class="ot-shim"
			pathLength="100"
			d="M11.22 44 C14.12 41.8 15.22 41.8 18.15 44 C19.55 45.8 23.65 45.8 25.07 44 C27.97 41.8 29.07 41.8 32 44 C33.4 45.8 37.5 45.8 38.93 44 C41.83 41.8 42.93 41.8 45.85 44 C47.25 45.8 51.35 45.8 52.78 44"
			stroke-width={w.wave + 0.2}
			style="stroke:var(--ft-accent)"
		/>
	</g>
	<polygon
		class="ot-ping ot-p1"
		points="32,5.30 34.70,8 32,10.70 29.30,8"
		fill="none"
		stroke-width={w.ping}
		stroke-linejoin="round"
		style="stroke:var(--ft-accent)"
	/>
	<circle
		class="ot-ping ot-p2"
		cx="52.78"
		cy="44"
		r={w.sr}
		fill="none"
		stroke-width={w.ping}
		style="stroke:var(--ft-accent)"
	/>
	<circle
		class="ot-ping ot-p3"
		cx="11.22"
		cy="44"
		r={w.sr}
		fill="none"
		stroke-width={w.ping}
		style="stroke:var(--ft-accent)"
	/>
	<polygon
		class="ot-pop ot-s1"
		points={w.diaPts}
		stroke-width="0.8"
		stroke-linejoin="round"
		style="fill:var(--ft-line);stroke:var(--ft-line)"
	/>
	<circle
		class="ot-pop ot-s2"
		cx="52.78"
		cy="44"
		r={w.sr}
		fill="transparent"
		stroke-width={w.sw}
		style="stroke:var(--ft-line)"
	/>
	<circle
		class="ot-pop ot-s3"
		cx="11.22"
		cy="44"
		r={w.sr}
		fill="transparent"
		stroke-width={w.sw}
		style="stroke:var(--ft-line)"
	/>
</svg>

<style>
	.ft-loader {
		--ft-moon: currentColor;
		--ft-line: color-mix(in srgb, currentColor 55%, transparent);
		/* follows the app theme via color-scheme: deeper sea glass on light, brighter on dark */
		--ft-accent: light-dark(#2f8a78, #5fb3a1);
		display: inline-block;
		vertical-align: middle;
	}

	.ft-loader {
		overflow: visible;
	}
	.ot-draw {
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
	}
	.ot-up {
		animation: ot-i-up 1.5s cubic-bezier(0.65, 0, 0.35, 1) both;
	}
	.ot-low {
		animation: ot-i-low 1.5s cubic-bezier(0.65, 0, 0.35, 1) both;
	}
	.ot-water {
		animation: ot-i-water 1.5s cubic-bezier(0.65, 0, 0.35, 1) both;
	}
	.ot-disc {
		transform-box: fill-box;
		transform-origin: center;
		animation: ot-i-disc 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.ot-pop {
		transform-box: fill-box;
		transform-origin: center;
	}
	.ot-s1 {
		animation:
			ot-i-s1 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) both,
			ot-l-s1 3.6s ease-out 1.5s infinite;
	}
	.ot-s2 {
		animation:
			ot-i-s2 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) both,
			ot-l-s2 3.6s ease-out 1.5s infinite;
	}
	.ot-s3 {
		animation:
			ot-i-s3 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) both,
			ot-l-s3 3.6s ease-out 1.5s infinite;
	}
	.ot-node {
		animation: ot-i-node 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.ot-orbit {
		transform-box: view-box;
		transform-origin: 32px 32px;
		animation: ot-l-orbit 3.6s 1.5s infinite;
	}
	.ot-dim {
		animation: ot-l-dim 3.6s ease-in-out 1.5s infinite;
	}
	.ot-trail {
		opacity: 0;
		animation: ot-l-trail 3.6s linear 1.5s infinite;
	}
	.ot-shim {
		stroke-dasharray: 18 140;
		stroke-dashoffset: -100;
		opacity: 0;
		animation: ot-l-shim 3.6s cubic-bezier(0.65, 0, 0.35, 1) 1.5s infinite;
	}
	.ot-ping {
		transform-box: fill-box;
		transform-origin: center;
		opacity: 0;
	}
	.ot-p1 {
		animation: ot-l-p1 3.6s ease-out 1.5s infinite;
	}
	.ot-p2 {
		animation: ot-l-p2 3.6s ease-out 1.5s infinite;
	}
	.ot-p3 {
		animation: ot-l-p3 3.6s ease-out 1.5s infinite;
	}
	.ot-shadows {
		transform: translateX(-24px);
		animation: ot-l-phase 3.6s linear 1.5s infinite;
	}
	@keyframes ot-i-up {
		0% {
			stroke-dashoffset: 100;
		}
		48%,
		100% {
			stroke-dashoffset: 0;
		}
	}
	@keyframes ot-i-low {
		0%,
		14% {
			stroke-dashoffset: 100;
		}
		52%,
		100% {
			stroke-dashoffset: 0;
		}
	}
	@keyframes ot-i-water {
		0%,
		30% {
			stroke-dashoffset: 100;
		}
		70%,
		100% {
			stroke-dashoffset: 0;
		}
	}
	@keyframes ot-i-disc {
		0%,
		16% {
			transform: scale(0);
		}
		54%,
		100% {
			transform: scale(1);
		}
	}
	@keyframes ot-i-s1 {
		0%,
		40% {
			transform: scale(0);
		}
		58%,
		100% {
			transform: scale(1);
		}
	}
	@keyframes ot-i-s2 {
		0%,
		50% {
			transform: scale(0);
		}
		68%,
		100% {
			transform: scale(1);
		}
	}
	@keyframes ot-i-s3 {
		0%,
		58% {
			transform: scale(0);
		}
		76%,
		100% {
			transform: scale(1);
		}
	}
	@keyframes ot-i-node {
		0%,
		72% {
			transform: translateY(-7px) scale(0.2);
			opacity: 0;
		}
		100% {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
	}
	@keyframes ot-l-orbit {
		0% {
			transform: rotate(0deg);
			animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
		}
		26% {
			transform: rotate(120deg);
		}
		33.333% {
			transform: rotate(120deg);
			animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
		}
		59.333% {
			transform: rotate(240deg);
		}
		66.667% {
			transform: rotate(240deg);
			animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
		}
		92.667% {
			transform: rotate(360deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
	@keyframes ot-l-dim {
		0%,
		34% {
			opacity: 1;
		}
		41%,
		52% {
			opacity: 0.35;
		}
		59.333%,
		100% {
			opacity: 1;
		}
	}
	@keyframes ot-l-trail {
		0% {
			opacity: 0;
		}
		7% {
			opacity: 0.85;
		}
		20% {
			opacity: 0.85;
		}
		27% {
			opacity: 0;
		}
		33.333% {
			opacity: 0;
		}
		40.333% {
			opacity: 0.85;
		}
		53.333% {
			opacity: 0.85;
		}
		60.333% {
			opacity: 0;
		}
		66.667% {
			opacity: 0;
		}
		73.667% {
			opacity: 0.85;
		}
		86.667% {
			opacity: 0.85;
		}
		93.667% {
			opacity: 0;
		}
		100% {
			opacity: 0;
		}
	}
	@keyframes ot-l-shim {
		0%,
		33.333% {
			stroke-dashoffset: -100;
			opacity: 1;
		}
		59.333% {
			stroke-dashoffset: 18;
			opacity: 1;
		}
		60%,
		100% {
			stroke-dashoffset: 18;
			opacity: 0;
		}
	}
	@keyframes ot-l-s1 {
		0% {
			fill: var(--ft-accent);
			stroke: var(--ft-accent);
		}
		7%,
		91.6% {
			fill: var(--ft-line);
			stroke: var(--ft-line);
		}
		93.1%,
		100% {
			fill: var(--ft-accent);
			stroke: var(--ft-accent);
		}
	}
	@keyframes ot-l-s2 {
		0%,
		25% {
			fill: transparent;
			stroke: var(--ft-line);
		}
		26.5% {
			fill: var(--ft-accent);
			stroke: var(--ft-accent);
		}
		40%,
		100% {
			fill: transparent;
			stroke: var(--ft-line);
		}
	}
	@keyframes ot-l-s3 {
		0%,
		58.3% {
			fill: transparent;
			stroke: var(--ft-line);
		}
		59.8% {
			fill: var(--ft-accent);
			stroke: var(--ft-accent);
		}
		73%,
		100% {
			fill: transparent;
			stroke: var(--ft-line);
		}
	}
	@keyframes ot-l-p1 {
		0%,
		92.5% {
			transform: scale(1);
			opacity: 0;
		}
		93.1% {
			opacity: 0.8;
		}
		100% {
			transform: scale(2.8);
			opacity: 0;
		}
	}
	@keyframes ot-l-p2 {
		0%,
		25.9% {
			transform: scale(1);
			opacity: 0;
		}
		26.5% {
			opacity: 0.8;
		}
		40%,
		100% {
			transform: scale(3.4);
			opacity: 0;
		}
	}
	@keyframes ot-l-p3 {
		0%,
		59.2% {
			transform: scale(1);
			opacity: 0;
		}
		59.8% {
			opacity: 0.8;
		}
		73%,
		100% {
			transform: scale(3.4);
			opacity: 0;
		}
	}
	@keyframes ot-l-phase {
		from {
			transform: translateX(-24px);
		}
		to {
			transform: translateX(-72px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ot-up,
		.ot-low,
		.ot-water,
		.ot-disc,
		.ot-s1,
		.ot-s2,
		.ot-s3,
		.ot-node,
		.ot-orbit,
		.ot-dim {
			animation: none;
			stroke-dashoffset: 0;
			opacity: 1;
			transform: none;
		}
		.ot-trail,
		.ot-ping,
		.ot-shim {
			animation: none;
			opacity: 0;
		}
		.ot-shadows {
			animation: none;
			transform: translateX(-19px);
		}
	}

	.no-intro .ot-up,
	.no-intro .ot-low,
	.no-intro .ot-water {
		animation: none;
		stroke-dashoffset: 0;
	}
	.no-intro .ot-disc,
	.no-intro .ot-node {
		animation: none;
		transform: none;
		opacity: 1;
	}
	.no-intro .ot-s1 {
		animation: ot-l-s1 3.6s ease-out infinite;
	}
	.no-intro .ot-s2 {
		animation: ot-l-s2 3.6s ease-out infinite;
	}
	.no-intro .ot-s3 {
		animation: ot-l-s3 3.6s ease-out infinite;
	}
	.no-intro .ot-orbit {
		animation-delay: 0s;
	}
	.no-intro .ot-dim {
		animation-delay: 0s;
	}
	.no-intro .ot-trail {
		animation-delay: 0s;
	}
	.no-intro .ot-shim {
		animation-delay: 0s;
	}
	.no-intro .ot-p1,
	.no-intro .ot-p2,
	.no-intro .ot-p3 {
		animation-delay: 0s;
	}
	.no-intro .ot-shadows {
		animation-delay: 0s;
	}
</style>
