<!--
	The hero illustration: SysML text beside the General View it draws, linked element by element.
	On load (unless reduced motion is requested) two lines are typed and their diagram elements
	appear; hovering a line or a box highlights its counterpart. The final, static state is the
	default, so the picture is complete without any animation.
-->
<script lang="ts">
	import { ArrowLeftRight, FileCode, RotateCcw, Shapes } from '@lucide/svelte';

	type Token = [cls: string, text: string];
	interface Line {
		ref?: string;
		indent?: boolean;
		typed?: 1 | 2;
		tokens: Token[];
	}

	const lines: Line[] = [
		{
			ref: 'drone',
			tokens: [
				['k', 'part def'],
				['', ' '],
				['d', 'Drone'],
				['o', ' {']
			]
		},
		{
			indent: true,
			tokens: [
				['k', 'doc'],
				['c', ' /* Delivers parcels. */']
			]
		},
		{
			ref: 'rotors',
			indent: true,
			tokens: [
				['k', 'part'],
				['', ' '],
				['n', 'rotors'],
				['o', ' : '],
				['t', 'Rotor'],
				['o', '['],
				['m', '4'],
				['o', '];']
			]
		},
		{
			ref: 'battery',
			indent: true,
			typed: 1,
			tokens: [
				['k', 'part'],
				['', ' '],
				['n', 'battery'],
				['o', ' : '],
				['t', 'Battery'],
				['o', ';']
			]
		},
		{
			ref: 'power',
			indent: true,
			typed: 2,
			tokens: [
				['k', 'port'],
				['', ' '],
				['n', 'power'],
				['o', ' : ~'],
				['t', 'PowerPort'],
				['o', ';']
			]
		},
		{ tokens: [['o', '}']] },
		{
			tokens: [
				['k', 'part def'],
				['', ' '],
				['d', 'Rotor'],
				['o', ';']
			]
		},
		{
			tokens: [
				['k', 'part def'],
				['', ' '],
				['d', 'Battery'],
				['o', ';']
			]
		},
		{
			tokens: [
				['k', 'port def'],
				['', ' '],
				['d', 'PowerPort'],
				['o', ';']
			]
		}
	];

	const length = (line: Line) => line.tokens.reduce((n, [, text]) => n + text.length, 0);

	/** Bumped by "Replay" to re-mount the illustration and restart its animation. */
	let run = $state(0);
</script>

<figure class="stage">
	<figcaption class="visually-hidden">
		The same model as SysML text and as a diagram: the part definition Drone owns the parts rotors
		and battery, and has the port power.
	</figcaption>
	{#key run}
		<div class="window">
			<div class="pane text">
				<div class="tabs" aria-hidden="true">
					<span class="tab"><FileCode size={14} /> Drone.sysml</span>
				</div>
				<div class="code">
					{#each lines as line, i (i)}
						<div
							class="line"
							class:sel={line.ref === 'battery'}
							class:t1={line.typed === 1}
							class:t2={line.typed === 2}
							data-ref={line.ref}
						>
							<span class="ln" aria-hidden="true">{i + 1}</span><span class="src"
								>{#if line.indent}<span class="indent"></span>{/if}<span
									class="type"
									style:--n={length(line)}
									>{#each line.tokens as [cls, text], j (j)}<span class={cls}>{text}</span
										>{/each}</span
								>{#if line.typed}<span class="caret" style:--n={length(line)} aria-hidden="true"
									></span>{/if}</span
							>
						</div>
					{/each}
				</div>
			</div>

			<div class="seam" aria-hidden="true">
				<span class="sync"><ArrowLeftRight size={13} /> Live</span>
			</div>

			<div class="pane diagram">
				<div class="tabs">
					<span class="tab" aria-hidden="true"
						><Shapes size={14} /> Drone <span class="view">General view</span></span
					>
					<button class="replay" type="button" onclick={() => run++}>
						<RotateCcw size={13} /> Replay
					</button>
				</div>
				<svg viewBox="0 0 400 252" aria-hidden="true" focusable="false">
					<!-- Composition edges: filled diamond at the owning definition. -->
					<g class="edge" data-ref="rotors">
						<path class="wire" d="M164 106V132H114V168" pathLength="1" />
						<path class="diamond" d="M164 92l6 7-6 7-6-7z" />
					</g>
					<g class="edge appear-1" data-ref="battery">
						<path class="wire draw" d="M220 106V132H290V168" pathLength="1" />
						<path class="diamond" d="M220 92l6 7-6 7-6-7z" />
					</g>

					<!-- Definition: sharp corners. -->
					<g class="node" data-ref="drone">
						<rect class="frame def" x="100" y="24" width="184" height="68" rx="1.5" />
						<text class="stereo" x="192" y="51">«part def»</text>
						<text class="name" x="192" y="73">Drone</text>
					</g>

					<!-- Usages: rounded corners. -->
					<g class="node" data-ref="rotors">
						<rect class="frame" x="36" y="168" width="156" height="60" rx="14" />
						<text class="stereo" x="114" y="192">«part»</text>
						<text class="name small" x="114" y="213">rotors : Rotor[4]</text>
					</g>
					<g class="node appear-1 sel" data-ref="battery">
						<rect class="frame" x="212" y="168" width="156" height="60" rx="14" />
						<text class="stereo" x="290" y="192">«part»</text>
						<text class="name small" x="290" y="213">battery : Battery</text>
					</g>

					<!-- Port: a small square on the owner's border. -->
					<g class="port appear-2" data-ref="power">
						<rect class="frame" x="277" y="51" width="14" height="14" rx="1" />
						<text class="port-name" x="298" y="55">power</text>
						<text class="port-type" x="298" y="71">: ~PowerPort</text>
					</g>
				</svg>
			</div>
		</div>
	{/key}
</figure>

<style>
	.stage {
		margin: 0;
		position: relative;
	}
	.window {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 0 minmax(0, 1.12fr);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow:
			var(--shadow-lg),
			0 0 0 6px color-mix(in srgb, var(--surface) 55%, transparent);
		overflow: hidden;
	}
	.pane {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.tabs {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		height: 2.5rem;
		padding: 0 var(--space-3);
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-xs);
		font-weight: 560;
		color: var(--text-2);
		white-space: nowrap;
	}
	.view {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: 0.25rem;
		color: var(--text-3);
		font-weight: 500;
	}
	.view::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--kind-view);
	}
	.replay {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 1.625rem;
		padding: 0 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 550;
		cursor: pointer;
	}
	.replay:hover {
		color: var(--text);
		border-color: var(--border-strong);
	}

	/* ── Text pane ─────────────────────────────────────────────────────────── */
	.code {
		flex: 1;
		padding: var(--space-3) 0 var(--space-4);
		font-family: var(--font-mono);
		font-size: 14px;
		line-height: 1.9;
		color: var(--syntax-name);
		font-variant-ligatures: none;
	}
	.line {
		display: flex;
		position: relative;
		white-space: pre;
		padding-right: var(--space-3);
		transition: background var(--duration) var(--ease);
	}
	.line::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 2px;
		background: var(--accent);
		opacity: 0;
	}
	.ln {
		flex: none;
		width: 2.75rem;
		padding-right: 1rem;
		text-align: right;
		color: var(--text-3);
		user-select: none;
	}
	.src {
		position: relative;
		min-width: 0;
	}
	.indent {
		display: inline-block;
		width: 4ch;
	}
	.type {
		display: inline-block;
		vertical-align: top;
	}
	.k {
		color: var(--syntax-keyword);
		font-weight: 550;
	}
	.d {
		color: var(--syntax-definition);
		font-weight: 600;
	}
	.t {
		color: var(--syntax-type);
	}
	.n {
		color: var(--syntax-name);
	}
	.m {
		color: var(--syntax-number);
	}
	.c {
		color: var(--syntax-doc);
	}
	.o {
		color: var(--syntax-operator);
	}
	.caret {
		display: none;
	}

	/* ── Seam ──────────────────────────────────────────────────────────────── */
	.seam {
		position: relative;
		z-index: 1;
		border-left: 1px solid var(--border);
	}
	.sync {
		position: absolute;
		top: 50%;
		left: 0;
		translate: -50% -50%;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		box-shadow:
			0 0 0 4px var(--surface),
			var(--shadow-md);
		white-space: nowrap;
	}
	.sync::after {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: inherit;
		border: 2px solid var(--accent);
		opacity: 0;
	}

	/* ── Diagram pane ──────────────────────────────────────────────────────── */
	.diagram {
		background-color: var(--bg);
		background-image: radial-gradient(
			color-mix(in srgb, var(--text-3) 32%, transparent) 1px,
			transparent 1.2px
		);
		background-size: 16px 16px;
	}
	svg {
		display: block;
		width: 100%;
		max-width: 31rem;
		height: auto;
		margin: auto;
		padding: var(--space-4) var(--space-4) var(--space-3);
		font-family: var(--font-ui);
		overflow: visible;
	}
	text {
		text-anchor: middle;
		fill: var(--text);
	}
	.stereo {
		font-size: 11px;
		fill: var(--text-3);
	}
	.name {
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.name.small {
		font-size: 13px;
		font-weight: 600;
	}
	.frame {
		fill: var(--surface);
		stroke: var(--kind-structure);
		stroke-width: 1.5;
		transition:
			stroke var(--duration) var(--ease),
			filter var(--duration) var(--ease);
	}
	.frame.def {
		fill: color-mix(in srgb, var(--kind-structure) 7%, var(--surface));
	}
	.wire {
		fill: none;
		stroke: var(--text-2);
		stroke-width: 1.25;
	}
	.diamond {
		fill: var(--text-2);
	}
	.port .frame {
		stroke: var(--kind-interface);
		stroke-width: 1.75;
	}
	.port text {
		text-anchor: start;
	}
	.port-name {
		font-size: 12px;
		font-weight: 600;
	}
	.port-type {
		font-family: var(--font-mono);
		font-size: 11px;
		fill: var(--kind-interface);
	}

	/* ── Linked highlight: selection and hover, text ⇄ diagram ─────────────── */
	.line.sel,
	.window:has([data-ref='drone']:hover) .line[data-ref='drone'],
	.window:has([data-ref='rotors']:hover) .line[data-ref='rotors'],
	.window:has([data-ref='battery']:hover) .line[data-ref='battery'],
	.window:has([data-ref='power']:hover) .line[data-ref='power'] {
		background: var(--accent-weak);
	}
	.line.sel::before,
	.window:has([data-ref='drone']:hover) .line[data-ref='drone']::before,
	.window:has([data-ref='rotors']:hover) .line[data-ref='rotors']::before,
	.window:has([data-ref='battery']:hover) .line[data-ref='battery']::before,
	.window:has([data-ref='power']:hover) .line[data-ref='power']::before {
		opacity: 1;
	}
	.node.sel .frame,
	.window:has([data-ref='drone']:hover) .node[data-ref='drone'] .frame,
	.window:has([data-ref='rotors']:hover) [data-ref='rotors'] .frame,
	.window:has([data-ref='battery']:hover) [data-ref='battery'] .frame,
	.window:has([data-ref='power']:hover) [data-ref='power'] .frame {
		stroke: var(--accent);
		stroke-width: 2.25;
		filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 45%, transparent));
	}
	.window:has([data-ref='rotors']:hover) .edge[data-ref='rotors'] .wire,
	.window:has([data-ref='battery']:hover) .edge[data-ref='battery'] .wire {
		stroke: var(--accent);
	}
	.window:has([data-ref='rotors']:hover) .edge[data-ref='rotors'] .diamond,
	.window:has([data-ref='battery']:hover) .edge[data-ref='battery'] .diamond {
		fill: var(--accent);
	}
	[data-ref] {
		cursor: default;
	}

	/* ── Phones: stack the panes ───────────────────────────────────────────── */
	@media (max-width: 47.99rem) {
		.window {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto 0 auto;
		}
		.seam {
			border-left: 0;
			border-top: 1px solid var(--border);
		}
		.sync {
			top: 0;
			left: 50%;
		}
		.code {
			font-size: 12.5px;
			padding-bottom: var(--space-5);
		}
		.ln {
			width: 2.25rem;
			padding-right: 0.75rem;
		}
		svg {
			padding-top: var(--space-5);
		}
	}

	/* ── Optional motion: type two lines, draw what they declare ───────────── */
	@media (prefers-reduced-motion: no-preference) {
		.t1 .type,
		.t2 .type {
			animation: type 0.85s steps(var(--n), end) both;
		}
		.t1 .type {
			animation-delay: 0.7s;
		}
		.t2 .type {
			animation-delay: 2.5s;
		}
		.caret {
			display: block;
			position: absolute;
			top: 0.3em;
			bottom: 0.3em;
			left: 4ch;
			width: 2px;
			background: var(--accent);
			opacity: 0;
		}
		.t1 .caret {
			animation:
				caret-move 0.85s steps(var(--n), end) 0.7s both,
				caret-show 1.6s linear 0.3s both;
		}
		.t2 .caret {
			animation:
				caret-move 0.85s steps(var(--n), end) 2.5s both,
				caret-show 1.6s linear 2.1s both;
		}
		/* Typed lines light up as their elements are drawn; the battery stays selected. */
		.t1 {
			animation: select 0.4s var(--ease) 1.55s backwards;
		}
		.t1::before {
			animation:
				reveal 0.4s var(--ease) 1.55s backwards,
				pulse-bar 1.4s var(--ease) 4.2s 2;
		}
		.t2 {
			animation: line-flash 1.6s var(--ease) 3.35s backwards;
		}
		.appear-1 {
			animation: appear 0.5s var(--ease) 1.6s both;
		}
		.appear-1 .draw {
			stroke-dasharray: 1;
			animation: draw 0.5s var(--ease) 1.6s both;
		}
		.appear-2 {
			transform-box: fill-box;
			transform-origin: 7px 12px;
			animation: pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1) 3.4s both;
		}
		.node.sel .frame {
			animation: pulse-node 1.4s var(--ease) 4.2s 2;
		}
		.sync::after {
			animation: ring 3.6s var(--ease) 0.4s both;
		}
	}
	@keyframes type {
		from {
			clip-path: inset(0 100% 0 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
	@keyframes caret-move {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(calc(var(--n) * 1ch));
		}
	}
	@keyframes caret-show {
		0%,
		100% {
			opacity: 0;
		}
		8%,
		88% {
			opacity: 1;
		}
	}
	@keyframes select {
		from {
			background: transparent;
		}
	}
	@keyframes reveal {
		from {
			opacity: 0;
		}
	}
	@keyframes line-flash {
		0% {
			background: transparent;
		}
		15%,
		55% {
			background: var(--accent-weak);
		}
		100% {
			background: transparent;
		}
	}
	@keyframes pulse-bar {
		50% {
			opacity: 0.25;
		}
	}
	@keyframes appear {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes draw {
		from {
			stroke-dashoffset: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.2);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes pulse-node {
		50% {
			filter: drop-shadow(0 0 12px color-mix(in srgb, var(--accent) 70%, transparent));
		}
	}
	/* Two rings, as each typed line reaches the diagram (at 1.6 s and 3.4 s). */
	@keyframes ring {
		0%,
		31% {
			opacity: 0;
			transform: scale(1);
		}
		33% {
			opacity: 0.9;
			transform: scale(1);
		}
		46% {
			opacity: 0;
			transform: scale(1.4);
		}
		47%,
		81% {
			opacity: 0;
			transform: scale(1);
		}
		83% {
			opacity: 0.9;
			transform: scale(1);
		}
		96%,
		100% {
			opacity: 0;
			transform: scale(1.4);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.replay {
			display: none;
		}
	}
</style>
