<script lang="ts">
	import { Maximize, Minus, Plus } from '@lucide/svelte';
	import { tick, untrack } from 'svelte';
	import type { FlowEdgeGeometry, FlowLayout } from './flow-layout.ts';
	import { fitTransform, readableTransform } from './layout.ts';

	/** What a node is doing in the run. */
	export type NodeStatus = 'running' | 'waiting' | 'done' | 'held' | 'choice';

	interface Props {
		layout: FlowLayout;
		/** Each node's part in the run; nodes not listed have not run. */
		statuses: Map<string, NodeStatus>;
		/** What a running node waits for, or why a decision holds its token (for its title and badge). */
		notes: Map<string, string>;
		/** Tokens waiting at a join: `1 of 2`. */
		joins: Map<string, string>;
		/** Successions and flows the last step went along. */
		lastEdges: Set<number>;
		/** The node to keep in view when the whole flow does not fit. */
		focus: string | null;
		minScale: number;
		wheelPans: boolean;
		description: string;
		width?: number;
		height?: number;
		onnode: (id: string) => void;
	}

	let {
		layout,
		statuses,
		notes,
		joins,
		lastEdges,
		focus,
		minScale,
		wheelPans,
		description,
		width = $bindable(0),
		height = $bindable(0),
		onnode
	}: Props = $props();

	const uid = $props.id();

	let viewport = $state<HTMLDivElement>();
	let view = $state({ k: 1, x: 0, y: 0 });
	let userMoved = $state(false);
	let smooth = $state(false);
	let moving = $state<FlowEdgeGeometry[]>([]);

	const reducedMotion = () =>
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	let fitted: FlowLayout | null = null;
	$effect(() => {
		if (!width || !height) return;
		if (fitted !== layout) userMoved = false;
		fitted = layout;
		if (!userMoved) {
			const box = untrack(() => layout.nodes.find((n) => n.id === focus));
			view = readableTransform(layout, { width, height }, minScale, box);
		}
	});

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

	/** Move a token along each of these edges at once, then resolve. Instant under reduced motion. */
	export async function play(indices: number[], duration = 420): Promise<void> {
		const edges = layout.edges.filter((e) => indices.includes(e.index));
		if (!edges.length || reducedMotion() || duration < 60) return;
		moving = edges;
		await tick();
		const tokens = viewport?.querySelectorAll<HTMLElement>('.token') ?? [];
		const runs = [...tokens].map((t) =>
			t.animate(
				[
					{ offsetDistance: '0%', opacity: 0, transform: 'scale(0.4)' },
					{ opacity: 1, transform: 'scale(1)', offset: 0.18 },
					{ offsetDistance: '100%', opacity: 1, transform: 'scale(1)' }
				],
				{ duration, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' }
			)
		);
		await Promise.all(runs.map((r) => r.finished.catch(() => undefined)));
		moving = [];
	}

	/** Pan so a node is in view, when it is not. */
	export function reveal(id: string) {
		const n = layout.nodes.find((b) => b.id === id);
		if (!n || !width) return;
		const left = view.x + n.x * view.k;
		const top = view.y + n.y * view.k;
		const m = 12;
		if (
			left >= m &&
			top >= m &&
			left + n.width * view.k <= width - m &&
			top + n.height * view.k <= height - m
		)
			return;
		glide();
		view = {
			k: view.k,
			x: width / 2 - (n.x + n.width / 2) * view.k,
			y: height / 2 - (n.y + n.height / 2) * view.k
		};
	}

	// Pointer pan and pinch zoom, as on the state machine diagram.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- gesture bookkeeping, not state
	const pointers = new Map<number, { x: number; y: number }>();
	let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
	let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;
	let suppressClick = false;

	function local(e: PointerEvent) {
		const r = viewport!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onpointerdown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pointers.size === 1) drag = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false };
		if (pointers.size === 2) {
			drag = null;
			const [a, b] = [...pointers.values()];
			pinch = {
				d: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1,
				k: view.k,
				cx: (a!.x + b!.x) / 2,
				cy: (a!.y + b!.y) / 2,
				vx: view.x,
				vy: view.y
			};
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

	const STATUS_TEXT: Record<NodeStatus, string> = {
		running: 'running',
		waiting: 'waiting',
		done: 'done',
		held: 'stuck',
		choice: 'choose'
	};
	const KIND_TEXT: Record<string, string> = {
		start: 'Start',
		done: 'Done',
		fork: 'Fork',
		join: 'Join',
		decide: 'Decision',
		merge: 'Merge'
	};
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
	aria-roledescription="action flow diagram"
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
			{#each layout.edges as e (e.index)}
				<path
					class="edge"
					class:flow={e.kind === 'flow'}
					class:last={lastEdges.has(e.index)}
					d={e.path}
					marker-end="url(#{uid}-arrow)"
				/>
			{/each}
		</svg>

		{#each layout.nodes as n (n.id)}
			{@const status = statuses.get(n.id)}
			{@const note = notes.get(n.id)}
			{#if n.kind === 'start' || n.kind === 'done' || n.kind === 'fork' || n.kind === 'join' || n.kind === 'decide' || n.kind === 'merge'}
				<div
					class="control {n.kind} {status ? `is-${status}` : ''}"
					data-node={n.id}
					title={[KIND_TEXT[n.kind], n.label, note].filter(Boolean).join(': ')}
					style:left="{n.x}px"
					style:top="{n.y}px"
					style:width="{n.width}px"
					style:height="{n.height}px"
				>
					<span class="visually-hidden"
						>{KIND_TEXT[n.kind]}
						{n.label}{status ? `, ${STATUS_TEXT[status]}` : ''}{note ? `: ${note}` : ''}</span
					>
					{#if n.label && (n.kind === 'merge' || n.kind === 'join' || n.kind === 'decide')}
						<span class="caption" aria-hidden="true">{n.label}</span>
					{/if}
					{#if joins.get(n.id)}<span class="badge" aria-hidden="true">{joins.get(n.id)}</span>{/if}
					{#if status === 'held' || status === 'choice'}<span class="badge alert" aria-hidden="true"
							>{status === 'choice' ? 'choose' : '!'}</span
						>{/if}
				</div>
			{:else}
				<button
					type="button"
					class="action {status ? `is-${status}` : ''}"
					class:step={!!n.keyword}
					data-node={n.id}
					title={note ?? undefined}
					style:left="{n.x}px"
					style:top="{n.y}px"
					style:width="{n.width}px"
					style:height="{n.height}px"
					onclick={() => onnode(n.id)}
				>
					{#if n.keyword}<span class="keyword">{n.keyword}</span>{/if}
					<span class="name">{n.label}</span>
					{#if status}
						<span class="status" aria-hidden="true">{STATUS_TEXT[status]}</span>
						<span class="visually-hidden">, {STATUS_TEXT[status]}{note ? `: ${note}` : ''}</span>
					{/if}
				</button>
			{/if}
		{/each}

		{#each layout.edges as e (e.index)}
			{#if e.label}
				<span
					class="label"
					class:flow={e.kind === 'flow'}
					class:last={lastEdges.has(e.index)}
					style:left="{e.label.x}px"
					style:top="{e.label.y}px"
					style:width="{e.label.width}px"
					style:height="{e.label.height}px">{e.label.text}</span
				>
			{/if}
		{/each}

		{#each moving as e (e.index)}
			<div class="token" style:offset-path="path('{e.path}')"></div>
		{/each}
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

	/* Actions: rounded boxes, as SysML v2 draws action usages. */
	.action {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		margin: 0;
		padding: 0 10px;
		color: var(--text);
		background: var(--surface);
		border: 1.5px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow-sm);
		font: inherit;
		cursor: pointer;
		transition:
			border-color 300ms var(--ease),
			box-shadow 300ms var(--ease),
			background-color 300ms var(--ease),
			opacity 300ms var(--ease);
	}
	.action:hover {
		box-shadow: var(--shadow-md);
	}
	.name {
		max-width: 100%;
		overflow: hidden;
		font-size: 13px;
		font-weight: 650;
		line-height: 17px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.action.step .name {
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-weight: 500;
	}
	.keyword {
		color: var(--syntax-keyword);
		font-size: 11px;
		font-style: italic;
		line-height: 14px;
	}
	.status {
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

	.action.is-running {
		border-width: 2px;
		border-color: var(--fam);
		background: color-mix(in oklab, var(--fam) 18%, var(--surface));
		box-shadow:
			0 0 0 4px var(--glow),
			0 8px 28px color-mix(in oklab, var(--fam) 28%, transparent);
	}
	.action.is-running::after {
		content: '';
		position: absolute;
		inset: -3px;
		border: 2px solid var(--fam);
		border-radius: 14px;
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
	.action.is-waiting {
		border-width: 2px;
		border-style: dashed;
		border-color: var(--warn);
		background: color-mix(in oklab, var(--warn) 12%, var(--surface));
	}
	.action.is-waiting .status {
		background: var(--warn);
	}
	.action.is-done {
		border-color: color-mix(in oklab, var(--line) 50%, transparent);
		background: color-mix(in oklab, var(--surface-2) 70%, var(--surface));
	}
	.action.is-done .name {
		color: var(--text-2);
	}
	.action.is-done .status {
		color: var(--text-2);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	/* Control nodes. */
	.control {
		position: absolute;
	}
	.control.start {
		background: var(--text);
		border-radius: 50%;
	}
	.control.done {
		border: 2px solid var(--text);
		border-radius: 50%;
		background: radial-gradient(circle, var(--text) 0 42%, var(--surface) 46%);
	}
	.control.done.is-done,
	.control.start.is-done {
		box-shadow: 0 0 0 5px var(--glow);
	}
	.control.fork,
	.control.join {
		background: var(--text);
		border-radius: 2px;
	}
	.control.decide,
	.control.merge {
		background: var(--surface);
		border: 1.5px solid var(--line);
		transform: rotate(45deg) scale(0.75);
	}
	.control.decide .caption,
	.control.merge .caption,
	.control.decide .badge,
	.control.merge .badge {
		transform: scale(1.33) rotate(-45deg);
	}
	.control.is-held,
	.control.is-choice {
		border-color: var(--warn);
		background: color-mix(in oklab, var(--warn) 25%, var(--surface));
		box-shadow: 0 0 0 4px color-mix(in oklab, var(--warn) 30%, transparent);
	}
	.control.join.is-held {
		background: var(--warn);
	}
	.caption {
		position: absolute;
		top: 50%;
		left: calc(100% + 8px);
		color: var(--text-2);
		font-size: 11px;
		font-style: italic;
		line-height: 1;
		white-space: nowrap;
		translate: 0 -50%;
		pointer-events: none;
	}
	.badge {
		position: absolute;
		top: -12px;
		right: -14px;
		padding: 0 5px;
		color: var(--surface);
		background: var(--fam);
		border-radius: var(--radius-pill);
		font-size: 10px;
		font-weight: 700;
		line-height: 16px;
		white-space: nowrap;
	}
	.badge.alert {
		background: var(--warn);
	}

	/* Successions and flows. */
	.edge {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.5;
		transition:
			stroke 300ms var(--ease),
			stroke-width 300ms var(--ease);
	}
	.edge.flow {
		stroke-dasharray: 6 4;
	}
	.edge.last {
		stroke: var(--fam);
		stroke-width: 2.5;
	}
	.label {
		position: absolute;
		display: grid;
		place-items: center;
		padding: 0 6px;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 16px;
		white-space: nowrap;
	}
	.label.last {
		color: var(--text);
		border-color: var(--fam);
		background: color-mix(in oklab, var(--fam) 10%, var(--surface));
	}
	.label.flow {
		font-style: italic;
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
		.action.is-running::after {
			animation: none;
		}
		.action,
		.edge {
			transition: none;
		}
	}
</style>
