<script lang="ts">
	import { Maximize, Minus, Plus } from '@lucide/svelte';
	import { tick, untrack } from 'svelte';
	import {
		fitTransform,
		readableTransform,
		type EdgeGeometry,
		type MachineLayout
	} from './layout.ts';

	interface Props {
		layout: MachineLayout;
		/** Transition names, by index, for accessible labels. */
		names: string[];
		/** Active states, with their ancestors. */
		active: Set<string>;
		/** The innermost active states. */
		leaves: Set<string>;
		/** The state being left while a transition animates. */
		exiting: string | null;
		/** The state just entered, for a brief flourish. */
		arrived: string | null;
		/** Transitions leaving the active states: can they fire now? */
		/** `waiting`: a timer still to come. */
		edgeState: Map<number, 'ready' | 'waiting' | 'blocked'>;
		/** Keyboard shortcut shown on a transition's label. */
		shortcuts: Map<number, number>;
		lastEdge: number | null;
		/** Transitions to emphasise (e.g. those a hovered variable affects). */
		highlight: Set<number>;
		selectedState: string | null;
		selectedEdge: number | null;
		/** The smallest scale fitting may use; below it, centre on `focus` instead. */
		minScale: number;
		/** The state to keep in view when the whole machine does not fit. */
		focus: string | null;
		/** Plain wheel pans (wide layout) rather than scrolling the page. */
		wheelPans: boolean;
		description: string;
		width?: number;
		height?: number;
		onstate: (id: string) => void;
		onedge: (index: number) => void;
	}

	let {
		layout,
		names,
		active,
		leaves,
		exiting,
		arrived,
		edgeState,
		shortcuts,
		lastEdge,
		highlight,
		selectedState,
		selectedEdge,
		minScale,
		focus,
		wheelPans,
		description,
		width = $bindable(0),
		height = $bindable(0),
		onstate,
		onedge
	}: Props = $props();

	const uid = $props.id();

	let viewport = $state<HTMLDivElement>();
	let token = $state<HTMLDivElement>();
	let trail = $state<SVGPathElement>();
	let view = $state({ k: 1, x: 0, y: 0 });
	let userMoved = $state(false);
	let smooth = $state(false);
	let firing = $state<EdgeGeometry | null>(null);

	const reducedMotion = () =>
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Fit whenever the layout or the viewport changes, until the user pans or zooms.
	let fitted: MachineLayout | null = null;
	$effect(() => {
		if (!width || !height) return;
		if (fitted !== layout) userMoved = false;
		fitted = layout;
		if (!userMoved) view = fittedView();
	});

	function fittedView() {
		const box = untrack(() => layout.states.find((s) => s.id === focus));
		return readableTransform(layout, { width, height }, minScale, box);
	}

	/** Show the whole machine, however small (the Fit button and the 0 key). */
	export function fit() {
		glide();
		view = fitTransform(layout, { width, height });
		userMoved = true;
	}

	function glide() {
		if (reducedMotion()) return;
		smooth = true;
		setTimeout(() => (smooth = false), 260);
	}

	function zoomAt(factor: number, px = width / 2, py = height / 2) {
		const k = Math.min(3, Math.max(0.15, view.k * factor));
		const ratio = k / view.k;
		view = { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
		userMoved = true;
	}

	function zoomButton(factor: number) {
		glide();
		zoomAt(factor);
	}

	/** Animate a token along a transition, then resolve. Instant under reduced motion. */
	export async function play(index: number, duration = 420): Promise<void> {
		const edge = layout.edges.find((e) => e.index === index);
		if (!edge || reducedMotion() || duration < 60) return;
		firing = edge;
		await tick();
		if (!token || !trail) return;
		const easing = 'cubic-bezier(0.45, 0, 0.25, 1)';
		const moving = token.animate(
			[
				{ offsetDistance: '0%', opacity: 0, transform: 'scale(0.4)' },
				{ opacity: 1, transform: 'scale(1)', offset: 0.18 },
				{ offsetDistance: '100%', opacity: 1, transform: 'scale(1)' }
			],
			{ duration, easing, fill: 'forwards' }
		);
		trail.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
			duration,
			easing,
			fill: 'forwards'
		});
		await moving.finished.catch(() => undefined);
		firing = null;
	}

	/** Pan so a state is in view (after it becomes active), when it is not. */
	export function reveal(id: string) {
		const s = layout.states.find((b) => b.id === id);
		if (!s || !width) return;
		const left = view.x + s.x * view.k;
		const top = view.y + s.y * view.k;
		const right = left + s.width * view.k;
		const bottom = top + s.height * view.k;
		const m = 12;
		if (left >= m && top >= m && right <= width - m && bottom <= height - m) return;
		glide();
		view = {
			k: view.k,
			x: width / 2 - (s.x + s.width / 2) * view.k,
			y: height / 2 - (s.y + s.height / 2) * view.k
		};
	}

	// Pointer pan and pinch zoom.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- gesture bookkeeping, not state
	const pointers = new Map<number, { x: number; y: number }>();
	let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
	let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;
	let suppressClick = false;

	function local(e: PointerEvent) {
		const r = viewport!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function startPinch() {
		const [a, b] = [...pointers.values()];
		if (!a || !b) return;
		pinch = {
			d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
			k: view.k,
			cx: (a.x + b.x) / 2,
			cy: (a.y + b.y) / 2,
			vx: view.x,
			vy: view.y
		};
	}

	function onpointerdown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pointers.size === 1) drag = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false };
		if (pointers.size === 2) {
			drag = null;
			startPinch();
			viewport?.setPointerCapture(e.pointerId);
		}
	}

	function onpointermove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()];
			const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
			const k = Math.min(3, Math.max(0.15, (pinch.k * d) / pinch.d));
			const cx = (a!.x + b!.x) / 2;
			const cy = (a!.y + b!.y) / 2;
			view = {
				k,
				x: cx - (pinch.cx - pinch.vx) * (k / pinch.k),
				y: cy - (pinch.cy - pinch.vy) * (k / pinch.k)
			};
			userMoved = true;
			suppressClick = true;
			return;
		}
		if (!drag) return;
		const dx = p.x - drag.x;
		const dy = p.y - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) > 4) {
			drag.moved = true;
			viewport?.setPointerCapture(e.pointerId);
		}
		if (drag.moved) {
			view = { k: view.k, x: drag.vx + dx, y: drag.vy + dy };
			userMoved = true;
		}
	}

	function onpointerup(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (drag?.moved) suppressClick = true;
		if (pointers.size < 2) pinch = null;
		if (pointers.size === 0) drag = null;
		setTimeout(() => (suppressClick = false), 0);
	}

	function onclickcapture(e: MouseEvent) {
		if (!suppressClick) return;
		suppressClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	$effect(() => {
		const el = viewport;
		if (!el) return;
		const onwheel = (e: WheelEvent) => {
			const r = el.getBoundingClientRect();
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
			} else if (wheelPans) {
				e.preventDefault();
				view = { k: view.k, x: view.x - e.deltaX, y: view.y - e.deltaY };
				userMoved = true;
			}
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		return () => el.removeEventListener('wheel', onwheel);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.target !== viewport) return;
		const step = 48;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step]
		};
		const move = moves[e.key];
		if (move) {
			view = { k: view.k, x: view.x + move[0], y: view.y + move[1] };
			userMoved = true;
		} else if (e.key === '+' || e.key === '=') zoomButton(1.25);
		else if (e.key === '-' || e.key === '_') zoomButton(0.8);
		else if (e.key === '0') fit();
		else return;
		e.preventDefault();
		e.stopPropagation();
	}

	const composites = $derived(layout.states.filter((s) => s.composite));
	const simples = $derived(layout.states.filter((s) => !s.composite));

	function edgeClass(e: EdgeGeometry) {
		const state = edgeState.get(e.index);
		return [
			'edge',
			state ?? '',
			lastEdge === e.index ? 'last' : '',
			highlight.has(e.index) ? 'highlight' : '',
			selectedEdge === e.index ? 'selected' : ''
		]
			.filter(Boolean)
			.join(' ');
	}

	function edgeSuffix(e: EdgeGeometry) {
		const state = edgeState.get(e.index);
		const status =
			state === 'ready'
				? ', can fire now'
				: state === 'waiting'
					? ', waiting for its time'
					: state === 'blocked'
						? ', blocked'
						: '';
		return `, ${e.from} to ${e.to}${status}`;
	}
</script>

<!-- A pannable canvas: focusable so arrow keys pan and +/− zoom, like a scrollable region. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="viewport"
	class:smooth
	bind:this={viewport}
	bind:clientWidth={width}
	bind:clientHeight={height}
	role="group"
	aria-roledescription="state machine diagram"
	aria-label={description}
	tabindex="0"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{onclickcapture}
	{onkeydown}
>
	<div
		class="world"
		style:width="{layout.width}px"
		style:height="{layout.height}px"
		style:transform="translate({view.x}px, {view.y}px) scale({view.k})"
	>
		{#each composites as s (s.id)}
			<div
				class="composite"
				class:region={s.kind === 'region'}
				class:active={active.has(s.id)}
				class:exiting={exiting !== null && s.id === exiting}
				class:selected={selectedState === s.id}
				style:left="{s.x}px"
				style:top="{s.y}px"
				style:width="{s.width}px"
				style:height="{s.height}px"
			>
				{#if s.kind === 'region'}
					<span class="region-name">{s.label}</span>
				{:else}
					<button type="button" class="composite-head" title={s.doc} onclick={() => onstate(s.id)}>
						<span class="visually-hidden">State</span>
						<span class="name">{s.label}</span>
						{#if s.parallel}<span class="keyword">«parallel»</span>{/if}
						{#if active.has(s.id)}<span class="visually-hidden">, active</span>{/if}
					</button>
					{#if s.rows.length}
						<ul class="rows">
							{#each s.rows as r (r.keyword)}
								<li><span class="kw">{r.keyword}</span> {r.text}</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/each}

		<svg class="edges" width={layout.width} height={layout.height} aria-hidden="true">
			<defs>
				<marker
					id="{uid}-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M 0 0.5 L 10 5 L 0 9.5 z" fill="context-stroke" />
				</marker>
			</defs>
			{#each layout.separators as sep, i (i)}
				<line class="separator" x1={sep.x1} y1={sep.y1} x2={sep.x2} y2={sep.y2} />
			{/each}
			{#each layout.edges as e (e.index)}
				<path class={edgeClass(e)} d={e.path} marker-end="url(#{uid}-arrow)" />
			{/each}
			{#if firing}
				<path class="trail" bind:this={trail} d={firing.path} pathLength="1" />
			{/if}
		</svg>

		{#each simples as s (s.id)}
			{#if s.kind === 'initial'}
				<div
					class="initial"
					class:active={active.has(s.id)}
					title="initial pseudostate"
					style:left="{s.x}px"
					style:top="{s.y}px"
					style:width="{s.width}px"
					style:height="{s.height}px"
				></div>
			{:else}
				<button
					type="button"
					class={s.kind === 'final' ? 'final' : 'state'}
					class:active={active.has(s.id)}
					class:leaf={leaves.has(s.id)}
					class:exiting={exiting !== null && s.id === exiting}
					class:arrived={arrived === s.id}
					class:selected={selectedState === s.id}
					style:left="{s.x}px"
					style:top="{s.y}px"
					style:width="{s.width}px"
					style:height="{s.height}px"
					title={s.doc}
					onclick={() => onstate(s.id)}
				>
					{#if s.kind === 'final'}
						<span class="visually-hidden"
							>Final state {s.label}{leaves.has(s.id) ? ', reached' : ''}</span
						>
					{:else}
						<span class="head"
							><span class="visually-hidden">State</span>
							<span class="name">{s.label}</span></span
						>
						{#if s.rows.length}
							<span class="rows">
								{#each s.rows as r (r.keyword)}
									<span class="row"><span class="kw">{r.keyword}</span> {r.text}</span>
								{/each}
							</span>
						{/if}
						{#if leaves.has(s.id)}<span class="now" aria-hidden="true">now</span><span
								class="visually-hidden">, current state</span
							>{/if}
					{/if}
				</button>
			{/if}
		{/each}

		{#each layout.edges as e (e.index)}
			{#if e.label}
				{@const key = shortcuts.get(e.index)}
				<button
					type="button"
					class="label {edgeState.get(e.index) ?? ''}"
					class:last={lastEdge === e.index}
					class:highlight={highlight.has(e.index)}
					class:selected={selectedEdge === e.index}
					style:left="{e.label.x}px"
					style:top="{e.label.y}px"
					style:width="{e.label.width}px"
					style:height="{e.label.height}px"
					onclick={() => onedge(e.index)}
				>
					<span class="visually-hidden">Transition {names[e.index] ?? ''}:</span>
					{#each e.label.lines as line, i (i)}
						<span class="line">
							{#each line as part, j (j)}<span class={part.part} class:spaced={j > 0}
									>{part.text}</span
								>{/each}
						</span>
					{/each}
					<span class="visually-hidden">{edgeSuffix(e)}</span>
					{#if key}<kbd aria-hidden="true">{key}</kbd>{/if}
				</button>
			{/if}
		{/each}

		{#if firing}
			<div class="token" bind:this={token} style:offset-path="path('{firing.path}')"></div>
		{/if}
	</div>

	<div class="zoom" role="toolbar" aria-label="Zoom">
		<button type="button" onclick={() => zoomButton(1.25)} aria-label="Zoom in" title="Zoom in (+)">
			<Plus size={16} aria-hidden="true" />
		</button>
		<button
			type="button"
			onclick={() => zoomButton(0.8)}
			aria-label="Zoom out"
			title="Zoom out (−)"
		>
			<Minus size={16} aria-hidden="true" />
		</button>
		<button type="button" onclick={fit} aria-label="Fit to view" title="Fit to view (0)">
			<Maximize size={15} aria-hidden="true" />
		</button>
	</div>
</div>

<style>
	.viewport {
		--fam: var(--kind-behavior);
		--line: color-mix(in oklab, var(--fam) 55%, var(--text-2));
		--tint: color-mix(in oklab, var(--fam) 11%, var(--surface));
		--glow: color-mix(in oklab, var(--fam) 32%, transparent);
		--edge: color-mix(in oklab, var(--text-2) 80%, transparent);
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		touch-action: none;
		cursor: grab;
		background-color: var(--bg);
		background-image: radial-gradient(
			circle,
			color-mix(in oklab, var(--text-3) 22%, transparent) 1px,
			transparent 1.2px
		);
		background-size: 20px 20px;
		user-select: none;
		-webkit-user-select: none;
	}
	.viewport:active {
		cursor: grabbing;
	}
	.viewport:focus-visible {
		outline-offset: -2px;
	}
	.world {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}
	.smooth .world {
		transition: transform 240ms var(--ease);
	}
	.edges {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}

	/* States: SysML v2 state usages are rounded boxes. */
	.state,
	.composite {
		position: absolute;
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		color: var(--text);
		background: var(--surface);
		border: 1.5px solid var(--line);
		border-radius: 14px;
		box-shadow: var(--shadow-sm);
		transition:
			border-color 300ms var(--ease),
			box-shadow 300ms var(--ease),
			background-color 300ms var(--ease);
	}
	.composite {
		background: color-mix(in oklab, var(--fam) 3%, var(--surface));
	}
	.state {
		cursor: pointer;
		text-align: center;
		font: inherit;
	}
	.state:hover {
		box-shadow: var(--shadow-md);
	}
	.head,
	.composite-head {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		flex: none;
		width: 100%;
		height: 34px;
		padding: 0 10px;
		background: var(--tint);
		border-radius: 12.5px 12.5px 0 0;
		transition: background-color 300ms var(--ease);
	}
	.state:not(:has(.rows)) .head {
		height: 100%;
		border-radius: 12.5px;
	}
	.composite-head {
		margin: 0;
		color: inherit;
		font: inherit;
		border: 0;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
	}
	.composite:not(:has(.rows)) .composite-head {
		border-bottom-color: var(--line);
	}
	.name {
		overflow: hidden;
		font-weight: 650;
		font-size: 13px;
		line-height: 17px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.keyword {
		color: var(--text-2);
		font-size: 11px;
	}
	.rows {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 4px 10px 5px;
		list-style: none;
		border-top: 1px solid var(--line);
	}
	.composite .rows {
		border-top: 0;
		border-bottom: 1px dashed color-mix(in oklab, var(--line) 60%, transparent);
	}
	.row,
	.rows li {
		height: 18px;
		overflow: hidden;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 18px;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kw {
		color: var(--syntax-keyword);
		font-style: italic;
	}

	/* Parallel regions: compartments without a border, divided by dashed lines. */
	.composite.region {
		background: transparent;
		border-color: transparent;
		box-shadow: none;
	}
	.region-name {
		position: absolute;
		top: 4px;
		left: 10px;
		color: var(--text-2);
		font-size: 11.5px;
		font-style: italic;
	}
	.separator {
		stroke: var(--line);
		stroke-width: 1.5;
		stroke-dasharray: 6 5;
	}

	/* Active: the current state glows and breathes. */
	.state.active,
	.final.active {
		border-color: var(--fam);
	}
	.composite.active:not(.region) {
		border-color: var(--fam);
		box-shadow:
			0 0 0 3px color-mix(in oklab, var(--fam) 14%, transparent),
			var(--shadow-sm);
	}
	.state.leaf {
		border-width: 2px;
		box-shadow:
			0 0 0 4px var(--glow),
			0 8px 28px color-mix(in oklab, var(--fam) 28%, transparent);
	}
	.state.leaf .head {
		background: color-mix(in oklab, var(--fam) 24%, var(--surface));
	}
	.state.leaf::after {
		content: '';
		position: absolute;
		inset: -3px;
		border: 2px solid var(--fam);
		border-radius: 16px;
		opacity: 0;
		pointer-events: none;
		animation: breathe 2.4s var(--ease) infinite;
	}
	@keyframes breathe {
		0% {
			opacity: 0.55;
			transform: scale(1);
		}
		70%,
		100% {
			opacity: 0;
			transform: scale(1.09, 1.18);
		}
	}
	.state.arrived {
		animation: land 520ms var(--ease);
	}
	@keyframes land {
		0% {
			transform: scale(0.94);
		}
		55% {
			transform: scale(1.04);
		}
		100% {
			transform: scale(1);
		}
	}
	.state.exiting {
		border-color: var(--line);
		box-shadow: var(--shadow-sm);
	}
	.now {
		position: absolute;
		top: -9px;
		right: 10px;
		padding: 0 6px;
		color: var(--surface);
		background: var(--ok);
		border-radius: var(--radius-pill);
		font-size: 10px;
		font-weight: 650;
		line-height: 16px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	/* Pseudostates. */
	.initial {
		position: absolute;
		background: var(--text);
		border-radius: 50%;
	}
	.final {
		position: absolute;
		margin: 0;
		padding: 0;
		border: 2px solid var(--text);
		border-radius: 50%;
		background: radial-gradient(circle, var(--text) 0 42%, var(--surface) 46%);
		cursor: pointer;
	}
	.final.leaf {
		box-shadow: 0 0 0 5px var(--glow);
	}

	.selected {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	/* Transitions. */
	.edge {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.5;
		transition:
			stroke 300ms var(--ease),
			stroke-width 300ms var(--ease);
	}
	.edge.ready {
		stroke: var(--fam);
		stroke-width: 2.25;
	}
	.edge.blocked {
		stroke: var(--text-3);
		stroke-dasharray: 4 4;
	}
	.edge.waiting {
		stroke: color-mix(in oklab, var(--fam) 70%, var(--edge));
		stroke-dasharray: 7 3;
	}
	.edge.last {
		stroke: color-mix(in oklab, var(--fam) 60%, var(--edge));
		stroke-width: 2.25;
	}
	.edge.highlight,
	.edge.selected {
		stroke: var(--accent);
		stroke-width: 2.25;
	}
	.trail {
		fill: none;
		stroke: var(--fam);
		stroke-width: 3.5;
		stroke-linecap: round;
		stroke-dasharray: 1 1;
		stroke-dashoffset: 1;
		filter: drop-shadow(0 0 4px var(--fam));
	}
	.token {
		position: absolute;
		top: 0;
		left: 0;
		width: 14px;
		height: 14px;
		offset-anchor: center;
		offset-rotate: 0deg;
		background: radial-gradient(circle at 35% 35%, var(--surface) 0 18%, var(--fam) 40%);
		border-radius: 50%;
		box-shadow:
			0 0 0 4px var(--glow),
			0 0 18px 4px var(--fam);
		opacity: 0;
		pointer-events: none;
	}

	.label {
		position: absolute;
		display: flex;
		flex-direction: column;
		justify-content: center;
		margin: 0;
		padding: 0 7px;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 15px;
		text-align: center;
		white-space: nowrap;
		cursor: pointer;
		transition:
			border-color 300ms var(--ease),
			background-color 300ms var(--ease);
	}
	.label:hover {
		border-color: var(--border-strong);
		box-shadow: var(--shadow-sm);
	}
	.label .spaced {
		margin-left: 0.6em;
	}
	.label .trigger {
		color: var(--text);
		font-weight: 600;
	}
	.label .effect {
		font-style: italic;
	}
	.label.ready {
		border-color: var(--fam);
		background: color-mix(in oklab, var(--fam) 10%, var(--surface));
	}
	.label.blocked {
		border-style: dashed;
		border-color: var(--text-3);
	}
	.label.waiting {
		border-style: dashed;
		border-color: var(--fam);
	}
	.label.highlight,
	.label.selected {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.label kbd {
		position: absolute;
		top: -9px;
		left: -9px;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		color: var(--surface);
		background: var(--ok);
		border-radius: 50%;
		font-family: var(--font-ui);
		font-size: 10.5px;
		font-weight: 700;
		line-height: 1;
	}

	.zoom {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}
	.zoom button {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		margin: 0;
		padding: 0;
		color: var(--text-2);
		background: none;
		border: 0;
		cursor: pointer;
	}
	.zoom button + button {
		border-top: 1px solid var(--border);
	}
	.zoom button:hover {
		color: var(--text);
		background: var(--surface-hover);
	}

	@media (pointer: coarse) {
		.zoom button {
			width: 44px;
			height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.state.leaf::after,
		.state.arrived {
			animation: none;
		}
		.state,
		.composite,
		.edge,
		.label,
		.head {
			transition: none;
		}
	}
</style>
