<script lang="ts">
	/**
	 * The Sequence View: lifeline heads along the top (pinned while the
	 * messages scroll under them), dashed lifelines, and the messages as
	 * arrows in time order. Drawn as SVG and buttons over a pannable,
	 * zoomable world (drag, pinch, Ctrl/⌘+wheel, arrow keys, + − 0); no
	 * automatic layout library is needed. A lifeline or message selects its
	 * element, and a selection elsewhere is highlighted here.
	 */
	import { FileCode, Maximize, Minus, Plus } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { DiagramGraph, DiagramView } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { iconOf } from '#lib/ui/kinds.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import {
		SEQUENCE,
		estimate,
		fitView,
		layoutSequence,
		readableView,
		type LifelineBox,
		type Measure,
		type MessageArrow,
		type SequenceLayout,
		type TextStyle,
		type View
	} from './sequenceLayout.ts';

	let {
		view: diagramView = 'sequence',
		scope,
		workspace,
		ui,
		engine,
		label
	}: {
		view?: DiagramView;
		scope: string | null;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		label: string;
	} = $props();

	const uid = $props.id();
	const reducedMotion = () =>
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	let graph = $state.raw<DiagramGraph | null>(null);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let message = $state('');
	let fontsReady = $state(false);
	let generation = 0;

	// ---- Text measurement, in the fonts the diagram draws with ----

	const FONTS: Record<TextStyle, string> = {
		name: '650 13px "Inter Variable", Inter, system-ui, sans-serif',
		keyword: '11px "Inter Variable", Inter, system-ui, sans-serif',
		label: '600 12.5px "Inter Variable", Inter, system-ui, sans-serif',
		payload: '11.5px "JetBrains Mono Variable", ui-monospace, monospace',
		number: '650 10.5px "Inter Variable", Inter, system-ui, sans-serif'
	};
	let context: CanvasRenderingContext2D | null | undefined;
	const measure: Measure = (text, style) => {
		context ??=
			typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
		if (!context) return estimate(text, style);
		context.font = FONTS[style];
		return context.measureText(text).width;
	};
	$effect(() => {
		void document.fonts?.ready.then(() => (fontsReady = true));
	});

	const layout: SequenceLayout | null = $derived.by(() => {
		void fontsReady;
		return graph ? layoutSequence(graph, measure) : null;
	});

	// ---- The model behind what is drawn ----

	const byKey = $derived(new Map(workspace.elements.map((e) => [e.key, e])));
	function elementOf(at: {
		element?: { file: string; start_byte: number };
	}): ModelElement | undefined {
		return at.element ? byKey.get(`${at.element.file}@${at.element.start_byte}`) : undefined;
	}
	const keyOf = (at: { element?: { file: string; start_byte: number } }) =>
		at.element ? `${at.element.file}@${at.element.start_byte}` : null;

	const selected = $derived(ui.selection?.key ?? null);
	/** The selection a click on the empty canvas dismissed the highlight for (it stays selected). */
	let dismissed = $state<string | null>(null);
	const lit = $derived(selected && selected !== dismissed ? selected : null);
	const litLifeline = $derived(layout?.lifelines.find((l) => keyOf(l.node) === lit) ?? null);
	const litMessage = $derived(layout?.messages.find((m) => keyOf(m.edge) === lit) ?? null);
	const selectedElement = $derived(selected ? byKey.get(selected) : undefined);

	function lifelineState(l: LifelineBox): 'selected' | 'linked' | null {
		if (litLifeline === l) return 'selected';
		if (litMessage && (litMessage.from === l.index || litMessage.to === l.index)) return 'linked';
		return null;
	}
	function messageState(m: MessageArrow): 'selected' | 'linked' | null {
		if (litMessage === m) return 'selected';
		if (litLifeline && (m.from === litLifeline.index || m.to === litLifeline.index))
			return 'linked';
		return null;
	}

	function select(at: { element?: { file: string; start_byte: number } }) {
		const element = elementOf(at);
		dismissed = null;
		if (element) ui.select(element.key, 'diagram');
	}

	function showInText() {
		if (!selectedElement) return;
		ui.open({ kind: 'file', path: selectedElement.file });
		ui.select(selectedElement.key, 'diagram');
	}

	// ---- Loading ----

	async function refresh() {
		const current = ++generation;
		try {
			const next = await engine.diagram(diagramView, workspace.sourceFiles(), scope);
			if (current !== generation) return;
			graph = next;
			status = 'ready';
		} catch (error) {
			if (current !== generation) return;
			status = 'error';
			message = error instanceof Error ? error.message : String(error);
		}
	}

	// Redraw shortly after the model text changes.
	let lastTexts: string[] | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const texts = workspace.modelPaths.map((p) => workspace.files[p] ?? '');
		void scope;
		const same =
			lastTexts !== null &&
			lastTexts.length === texts.length &&
			lastTexts.every((t, i) => t === texts[i]);
		if (same) return;
		lastTexts = texts;
		const delay = untrack(() => graph) ? 300 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
		return () => clearTimeout(timer);
	});

	// ---- Pan and zoom ----

	let viewport = $state<HTMLDivElement>();
	let width = $state(0);
	let height = $state(0);
	let view = $state<View>({ k: 1, x: 0, y: 0 });
	let userMoved = $state(false);
	let smooth = $state(false);
	/** Readable on a phone: below this scale the diagram scrolls instead. */
	const minScale = $derived(width < 560 ? 0.8 : 0.6);

	// Fit to the viewport (readably) until the person pans or zooms.
	$effect(() => {
		if (!width || !height || !layout) return;
		const size = { width: layout.width, height: layout.height };
		if (!untrack(() => userMoved)) view = readableView(size, { width, height }, minScale);
	});

	function glide() {
		if (reducedMotion()) return;
		smooth = true;
		setTimeout(() => (smooth = false), 260);
	}

	/** Show the whole sequence, however small (the Fit button and the 0 key). */
	function fit() {
		if (!layout) return;
		glide();
		view = fitView(layout, { width, height });
		userMoved = true;
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

	/** Keep a box (world coordinates) in view, panning as little as possible. */
	function reveal(box: { x: number; y: number; width: number; height: number }) {
		if (!width || !layout) return;
		const m = 16;
		const headRoom = 6 + SEQUENCE.headHeight * view.k + 8;
		const left = view.x + box.x * view.k;
		const right = left + box.width * view.k;
		const top = view.y + box.y * view.k;
		const bottom = top + box.height * view.k;
		let { x, y } = view;
		if (right > width - m) x -= right - (width - m);
		if (left + (x - view.x) < m) x += m - (left + (x - view.x));
		if (box.y > SEQUENCE.headTop + SEQUENCE.headHeight) {
			if (bottom > height - m) y -= bottom - (height - m);
			if (top + (y - view.y) < headRoom) y += headRoom - (top + (y - view.y));
		}
		if (x === view.x && y === view.y) return;
		glide();
		view = { k: view.k, x, y };
		userMoved = true;
	}

	// A selection made elsewhere (text, explorer) brings its message or lifeline into view.
	$effect(() => {
		const source = ui.selection?.source;
		const m = litMessage;
		const l = litLifeline;
		if (source === 'diagram') return;
		untrack(() => {
			if (m) reveal(m.label);
			else if (l) reveal(l.head);
		});
	});

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
		if ((e.target as HTMLElement).closest('.zoom')) return;
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

	function onclick(e: MouseEvent) {
		// A click on the empty canvas dismisses the highlight (the element stays selected).
		if (!(e.target as HTMLElement).closest('button, .hit')) dismissed = selected;
	}

	$effect(() => {
		const el = viewport;
		if (!el) return;
		const onwheel = (e: WheelEvent) => {
			const r = el.getBoundingClientRect();
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
			} else {
				const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
				const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
				view = { k: view.k, x: view.x - dx, y: view.y - dy };
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

	/** Lifeline heads stay at the top while the messages scroll under them. */
	const headsY = $derived(Math.max(view.y, 6 - SEQUENCE.headTop * view.k));
	const stuck = $derived(view.y < 6 - SEQUENCE.headTop * view.k);

	function messageName(m: MessageArrow) {
		const what = [m.name, m.payload ? `of ${m.payload}` : null].filter(Boolean).join(' ');
		const from = layout?.lifelines[m.from]?.name ?? '';
		const to = layout?.lifelines[m.to]?.name ?? '';
		const ends = m.self ? `, from ${from} to itself` : `, from ${from} to ${to}`;
		return `Message ${m.index + 1}: ${what || 'unnamed'}${ends}`;
	}
	function messageTitle(m: MessageArrow) {
		const parts = [m.edge.message?.doc];
		if (m.edge.message?.sourceEvent) parts.push(`sent at ${m.edge.message.sourceEvent}`);
		if (m.edge.message?.targetEvent) parts.push(`received at ${m.edge.message.targetEvent}`);
		return parts.filter(Boolean).join(' · ') || undefined;
	}
	const docOf = (l: LifelineBox) => l.node.attributes.find(([k]) => k === 'doc')?.[1];
</script>

<!-- A pannable canvas: focusable so arrow keys pan and +/− zoom, like a scrollable region. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<div
	class="viewport"
	class:smooth
	bind:this={viewport}
	bind:clientWidth={width}
	bind:clientHeight={height}
	role="group"
	aria-roledescription="sequence diagram"
	aria-label={label}
	tabindex="0"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{onclickcapture}
	{onclick}
	{onkeydown}
>
	{#if status === 'error'}
		<p class="state" role="alert">This view could not be drawn: {message}</p>
	{:else if status === 'loading'}
		<p class="state">Drawing the sequence…</p>
	{:else if layout && !layout.messages.length}
		<p class="state">
			No messages to show yet. Write one in the interaction: <code
				>message name of Item from sender to receiver;</code
			>
		</p>
	{/if}

	{#if layout}
		<div
			class="world"
			style:width="{layout.width}px"
			style:height="{layout.height}px"
			style:transform="translate({view.x}px, {view.y}px) scale({view.k})"
		>
			<svg class="lines" width={layout.width} height={layout.height} aria-hidden="true">
				<defs>
					{#each ['', 'lit', 'linked'] as tone (tone)}
						<marker
							id="{uid}-arrow{tone}"
							viewBox="0 0 12 12"
							refX="11"
							refY="6"
							markerWidth="11"
							markerHeight="11"
							markerUnits="userSpaceOnUse"
							orient="auto-start-reverse"
						>
							<path class="tip {tone}" d="M 1 1.5 L 11 6 L 1 10.5" />
						</marker>
					{/each}
				</defs>
				<rect
					class="frame"
					x={layout.frame.x}
					y={layout.frame.y}
					width={layout.frame.width}
					height={layout.frame.height}
				/>
				<path class="tag" d={layout.tag.path} />
				<text
					class="tag-text"
					x={layout.frame.x + 10}
					y={layout.frame.y + SEQUENCE.tagHeight / 2}
					dominant-baseline="central">{layout.tag.text}</text
				>
				{#each layout.lifelines as l (l.node.id)}
					<line
						class="lifeline {lifelineState(l) ?? ''}"
						style:--fam="var(--kind-{l.family})"
						x1={l.x}
						x2={l.x}
						y1={layout.lineTop}
						y2={layout.lineBottom}
					/>
				{/each}
				{#each layout.messages as m (m.index)}
					{@const state = messageState(m)}
					<!-- The arrow is easier to hit than its label; the label is the keyboard's way. -->
					<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
					<path class="hit" d={m.path} onclick={() => select(m.edge)} />
					<path
						class="arrow {state ?? ''}"
						d={m.path}
						marker-end="url(#{uid}-arrow{state === 'selected'
							? 'lit'
							: state === 'linked'
								? 'linked'
								: ''})"
					/>
					{#if m.edge.message?.sourceEvent}
						<circle class="event {state ?? ''}" cx={m.x1} cy={m.y} r="3.5" />
					{/if}
					{#if m.edge.message?.targetEvent}
						<circle
							class="event {state ?? ''}"
							cx={m.x2}
							cy={m.self ? m.y + SEQUENCE.selfHeight : m.y}
							r="3.5"
						/>
					{/if}
				{/each}
			</svg>

			<ol class="messages" aria-label="Messages, in time order">
				{#each layout.messages as m (m.index)}
					{@const state = messageState(m)}
					<li>
						<button
							type="button"
							class="message {state ?? ''}"
							class:self={m.self}
							style:left="{m.label.x}px"
							style:top="{m.label.y}px"
							style:width="{m.label.width}px"
							style:height="{m.label.height}px"
							aria-label={messageName(m)}
							aria-pressed={state === 'selected'}
							title={messageTitle(m)}
							onclick={() => select(m.edge)}
							onfocus={() => reveal(m.label)}
						>
							<span class="number" aria-hidden="true">{m.index + 1}</span>
							{#if m.name}<span class="name">{m.name}</span>{/if}
							{#if m.payload}<span class="payload"><span class="of">of</span> {m.payload}</span
								>{/if}
						</button>
					</li>
				{/each}
			</ol>
		</div>

		<div
			class="heads"
			class:stuck
			style:width="{layout.width}px"
			style:transform="translate({view.x}px, {headsY}px) scale({view.k})"
		>
			<ul aria-label="Lifelines">
				{#each layout.lifelines as l (l.node.id)}
					{@const Icon = iconOf(l.keyword.replace(/^ref\s+/, '').replace(/ /g, '_'))}
					{@const state = lifelineState(l)}
					<li>
						<button
							type="button"
							class="head {state ?? ''}"
							style:--fam="var(--kind-{l.family})"
							style:left="{l.head.x}px"
							style:top="{l.head.y}px"
							style:width="{l.head.width}px"
							style:height="{l.head.height}px"
							aria-pressed={state === 'selected'}
							title={docOf(l)}
							onclick={() => select(l.node)}
							onfocus={() => reveal({ ...l.head, y: 0 })}
						>
							<span class="visually-hidden">Lifeline</span>
							<span class="keyword">
								<Icon size={12} strokeWidth={2.25} aria-hidden="true" />«{l.keyword}»
							</span>
							<span class="title">
								<span class="name">{l.name}</span>{#if l.type}<span class="type"
										>{` : ${l.type}`}</span
									>{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="zoom" role="toolbar" aria-label="Diagram tools">
		<button
			type="button"
			onclick={showInText}
			disabled={!selectedElement}
			aria-label="Show in text"
			title={selectedElement
				? `Show ${selectedElement.label} in the text`
				: 'Select a lifeline or message, then show it in the text'}
		>
			<FileCode size={15} aria-hidden="true" />
		</button>
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
		--edge: color-mix(in oklab, var(--text-2) 85%, transparent);
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 18rem;
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
		container-type: size;
	}
	.viewport:active {
		cursor: grabbing;
	}
	.viewport:focus-visible {
		outline-offset: -2px;
	}
	.state {
		position: absolute;
		inset: 42% 16px auto;
		z-index: 4;
		margin: 0;
		color: var(--text-2);
		text-align: center;
		pointer-events: none;
	}
	.state code {
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.world,
	.heads {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}
	.heads {
		z-index: 2;
		height: 0;
	}
	.smooth .world,
	.smooth .heads {
		transition: transform 240ms var(--ease);
	}
	.lines {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	ol,
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Lifelines: dashed, in the colour of what they stand for. */
	.lifeline {
		stroke: color-mix(in oklab, var(--fam) 30%, var(--text-3));
		stroke-width: 1.5;
		stroke-dasharray: 6 5;
	}
	.lifeline.selected,
	.lifeline.linked {
		stroke: var(--accent);
	}

	/* Messages: asynchronous, so an open arrowhead (SysML v2 messages are flows). */
	.arrow {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.5;
		transition: stroke var(--duration) var(--ease);
	}
	.tip {
		fill: none;
		stroke: var(--edge);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tip.lit,
	.arrow.selected {
		stroke: var(--accent);
		stroke-width: 2.25;
	}
	.tip.linked,
	.arrow.linked {
		stroke: color-mix(in oklab, var(--accent) 65%, var(--edge));
		stroke-width: 2;
	}
	.hit {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		cursor: pointer;
		pointer-events: stroke;
	}
	.event {
		fill: var(--surface);
		stroke: var(--edge);
		stroke-width: 1.5;
	}
	.event.selected,
	.event.linked {
		stroke: var(--accent);
	}

	.message {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		margin: 0;
		padding: 0 10px;
		color: var(--text);
		background: color-mix(in oklab, var(--bg) 82%, transparent);
		border: 1px solid transparent;
		border-radius: 7px;
		font: inherit;
		white-space: nowrap;
		cursor: pointer;
		transition:
			border-color var(--duration) var(--ease),
			background-color var(--duration) var(--ease);
	}
	.message.self {
		justify-content: flex-start;
	}
	.message:hover {
		background: var(--surface);
		border-color: var(--border-strong);
		box-shadow: var(--shadow-sm);
	}
	.message.selected {
		background: var(--accent-weak);
		border-color: var(--accent);
	}
	.message.linked {
		border-color: color-mix(in oklab, var(--accent) 45%, transparent);
	}
	.number {
		display: inline-grid;
		place-items: center;
		min-width: 15px;
		height: 15px;
		margin-right: 3px;
		padding: 0 3px;
		color: var(--text-2);
		background: var(--surface-hover);
		border-radius: var(--radius-pill);
		font-size: 10.5px;
		font-weight: 650;
		line-height: 1;
	}
	.message .name {
		font-size: 12.5px;
		font-weight: 600;
		line-height: 16px;
	}
	.payload {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 16px;
	}
	.of {
		color: var(--syntax-keyword);
		font-style: italic;
	}

	/* Lifeline heads: usages, so rounded boxes, tinted by kind like other diagrams. */
	.heads .head {
		--line: color-mix(in oklab, var(--fam) 55%, var(--text-2));
		--tint: color-mix(in oklab, var(--fam) 11%, var(--surface));
		position: absolute;
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 2px;
		margin: 0;
		padding: 0 12px;
		color: var(--text);
		background: linear-gradient(var(--tint), var(--tint)), var(--surface);
		border: 1.5px solid var(--line);
		border-radius: 14px;
		box-shadow: var(--shadow-sm);
		font: inherit;
		text-align: center;
		cursor: pointer;
		transition:
			box-shadow var(--duration) var(--ease),
			border-color var(--duration) var(--ease);
	}
	.heads .head:hover {
		box-shadow: var(--shadow-md);
	}
	.stuck .head {
		box-shadow: var(--shadow-md);
	}
	.heads .head.linked {
		border-color: var(--accent);
		outline: 2px solid color-mix(in oklab, var(--accent) 35%, transparent);
		outline-offset: 2px;
	}
	.heads .head.selected {
		border-color: var(--accent);
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		box-shadow: var(--shadow-md);
	}
	.keyword {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-2);
		font-size: 11px;
		line-height: 14px;
	}
	.keyword :global(svg) {
		flex: none;
		color: var(--fam);
	}
	.title {
		display: flex;
		max-width: 100%;
		overflow: hidden;
		font-size: 13px;
		line-height: 17px;
		white-space: nowrap;
	}
	.title .name {
		flex: none;
		max-width: 100%;
		overflow: hidden;
		font-weight: 650;
		text-overflow: ellipsis;
	}
	.title .type {
		overflow: hidden;
		white-space: pre;
		color: var(--text-2);
		text-overflow: ellipsis;
	}

	/* The SysML diagram frame, named in its top-left corner. */
	.frame {
		fill: none;
		stroke: var(--border-strong);
		stroke-width: 1;
	}
	.tag {
		fill: var(--surface);
		stroke: var(--border-strong);
		stroke-width: 1;
	}
	.tag-text {
		fill: var(--text-2);
		font-family: var(--font-mono);
		font-size: 12px;
	}

	/* Bottom left, where Svelte Flow puts its controls in the other diagrams. */
	.zoom {
		position: absolute;
		left: 12px;
		bottom: 12px;
		z-index: 3;
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
	.zoom button:hover:not(:disabled) {
		color: var(--text);
		background: var(--surface-hover);
	}
	.zoom button:disabled {
		color: var(--text-3);
		cursor: default;
	}
	@media (pointer: coarse) {
		.zoom button {
			width: 44px;
			height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.arrow,
		.message,
		.heads .head {
			transition: none;
		}
	}
</style>
