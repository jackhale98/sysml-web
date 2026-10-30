<script lang="ts">
	/**
	 * A fault tree diagram (`FaultTreeAnalysis::FaultTreeDiagram`): each top
	 * event the view exposes, top-down, with the standard symbols (gates
	 * under the events they belong to, circles for basic events, diamonds
	 * for undeveloped ones, ovals for conditions) and every event's
	 * probability. Drawn as SVG with the events as buttons over it, on a
	 * pannable, zoomable world (drag, Ctrl/⌘+wheel, arrow keys, + − 0), as
	 * the sequence diagram is; no layout library is needed. An event selects
	 * its element, and a selection elsewhere is highlighted here.
	 */
	import { FileCode, Maximize, Minus, Plus } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { FaultTreeDrawing, FaultTreeEvent } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { STATUS_LABEL } from '#lib/project/checks.ts';
	import {
		FAULT_TREE,
		gateWords,
		layoutFaultTrees,
		symbolPath,
		type PlacedEvent
	} from './faultTreeLayout.ts';

	let {
		view: viewName,
		workspace,
		ui,
		engine,
		label
	}: {
		/** The view's name: it decides which top events are drawn. */
		view: string;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		label: string;
	} = $props();

	let drawings = $state.raw<FaultTreeDrawing[] | null>(null);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let message = $state('');
	let generation = 0;

	const layout = $derived(drawings ? layoutFaultTrees(drawings) : null);
	const names = $derived(
		new Map((drawings ?? []).flatMap((d) => d.events.map((e) => [e.id, e.name])))
	);

	// ---- The model behind what is drawn ----

	const byKey = $derived(new Map(workspace.elements.map((e) => [e.key, e])));
	const keyOf = (e: FaultTreeEvent) =>
		e.element ? `${e.element.file}@${e.element.start_byte}` : null;
	const elementOf = (e: FaultTreeEvent): ModelElement | undefined => {
		const key = keyOf(e);
		return key ? byKey.get(key) : undefined;
	};
	const selected = $derived(ui.selection?.key ?? null);
	const selectedElement = $derived(selected ? byKey.get(selected) : undefined);

	function select(e: FaultTreeEvent) {
		const element = elementOf(e);
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
			const next = await engine.faultTrees(workspace.sourceFiles(), viewName);
			if (current !== generation) return;
			drawings = next;
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
		void viewName;
		const same =
			lastTexts !== null &&
			lastTexts.length === texts.length &&
			lastTexts.every((t, i) => t === texts[i]);
		if (same) return;
		lastTexts = texts;
		const delay = untrack(() => drawings) ? 300 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
		return () => clearTimeout(timer);
	});

	// ---- Words ----

	/** `8.5E-6`: three significant digits, in exponent form below 0.001. */
	function probability(p: number | null): string {
		if (p === null || !Number.isFinite(p)) return '—';
		if (p === 0) return '0';
		if (p >= 0.001) return String(Number(p.toPrecision(3)));
		const [m, e] = p.toExponential(2).split('e');
		return `${Number(m)}E${Number(e)}`;
	}

	const KIND_WORDS: Record<FaultTreeEvent['kind'], string> = {
		top: 'Top event',
		intermediate: 'Event',
		basic: 'Basic event',
		undeveloped: 'Undeveloped event',
		conditioning: 'Condition'
	};

	function eventName(p: PlacedEvent): string {
		const e = p.event;
		const gate = e.gate
			? `, ${gateWords(e)} gate over ${e.inputs.map((i) => names.get(i) ?? i).join(', ')}`
			: '';
		const repeated = p.repeated ? ', repeated elsewhere in the tree' : '';
		return `${KIND_WORDS[e.kind]} ${e.name}${gate}, probability ${probability(e.probability)}${repeated}`;
	}

	function eventTitle(e: FaultTreeEvent): string | undefined {
		const parts = [
			e.description,
			e.source && e.source !== 'given' ? `Probability from ${e.source}` : null,
			e.component ? `Part: ${e.component}` : null,
			e.failureMode ? `Failure mode: ${e.failureMode}` : null
		];
		return parts.filter(Boolean).join('\n') || undefined;
	}

	function summary(d: FaultTreeDrawing): string {
		const top = d.events.find((e) => e.id === d.top);
		if (d.probability === null) return `${top?.name ?? 'Top event'}: not worked out`;
		const most = d.tolerable ? `, at most ${probability(d.tolerable.value)}` : '';
		const sets = `${d.cutSets} minimal cut set${d.cutSets === 1 ? '' : 's'}`;
		return `${top?.name ?? 'Top event'}: probability ${probability(d.probability)}${most} · ${sets}`;
	}

	// ---- Pan and zoom ----

	let viewport = $state<HTMLDivElement>();
	let width = $state(0);
	let height = $state(0);
	let view = $state({ k: 1, x: 0, y: 0 });
	let userMoved = $state(false);
	/** The toolbar's band at the top, with a line per tree's summary: the drawing starts below it. */
	const TOP = $derived(52 + 30 * Math.max(0, (drawings?.length ?? 1) - 1));

	function fitted(): { k: number; x: number; y: number } {
		if (!layout || !width || !height) return view;
		const k = Math.min(1, (width - 16) / layout.width, (height - TOP - 16) / layout.height);
		const readable = Math.max(k, width < 560 ? 0.55 : 0.45);
		return {
			k: readable,
			x: Math.max(8, (width - layout.width * readable) / 2),
			y: TOP
		};
	}

	// Fit to the viewport (readably) until the person pans or zooms.
	$effect(() => {
		void layout;
		void width;
		void height;
		if (!untrack(() => userMoved)) view = fitted();
	});

	function fit() {
		view = fitted();
		userMoved = true;
	}

	function zoomAt(factor: number, px = width / 2, py = height / 2) {
		const k = Math.min(3, Math.max(0.15, view.k * factor));
		const ratio = k / view.k;
		view = { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
		userMoved = true;
	}

	/** Keep an event's box in view, panning as little as possible. */
	function reveal(p: PlacedEvent) {
		if (!width) return;
		const m = 16;
		const left = view.x + p.x * view.k;
		const right = left + FAULT_TREE.boxWidth * view.k;
		const top = view.y + p.y * view.k;
		const bottom = top + FAULT_TREE.boxHeight * view.k;
		let { x, y } = view;
		if (right > width - m) x -= right - (width - m);
		if (left + (x - view.x) < m) x += m - (left + (x - view.x));
		if (bottom > height - m) y -= bottom - (height - m);
		if (top + (y - view.y) < TOP + m) y += TOP + m - (top + (y - view.y));
		if (x !== view.x || y !== view.y) {
			view = { k: view.k, x, y };
			userMoved = true;
		}
	}

	let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
	let suppressClick = false;

	function onpointerdown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if ((e.target as HTMLElement).closest('.zoom, .toolbar, .summaries')) return;
		drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
	}

	function onpointermove(e: PointerEvent) {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) > 4) {
			drag.moved = true;
			viewport?.setPointerCapture(e.pointerId);
		}
		if (drag.moved) {
			view = { k: view.k, x: drag.vx + dx, y: drag.vy + dy };
			userMoved = true;
		}
	}

	function onpointerup() {
		if (drag?.moved) suppressClick = true;
		drag = null;
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
			e.preventDefault();
			if (e.ctrlKey || e.metaKey)
				zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
			else {
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
		} else if (e.key === '+' || e.key === '=') zoomAt(1.25);
		else if (e.key === '-' || e.key === '_') zoomAt(0.8);
		else if (e.key === '0') fit();
		else return;
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<!-- A pannable canvas: focusable so arrow keys pan and +/− zoom, like a scrollable region. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="viewport"
	bind:this={viewport}
	bind:clientWidth={width}
	bind:clientHeight={height}
	role="group"
	aria-roledescription="fault tree diagram"
	aria-label={label}
	tabindex="0"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{onclickcapture}
	{onkeydown}
>
	{#if status === 'error'}
		<p class="state" role="alert">This view could not be drawn: {message}</p>
	{:else if status === 'loading'}
		<p class="state">Drawing the fault tree…</p>
	{:else if layout && !layout.trees.length}
		<p class="state">
			No top event to show. Expose one (<code>expose lossOfLift;</code>) or a package with one: an
			occurrence typed by <code>TopEvent</code>, its causes connected to it by
			<code>Causation</code>.
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
				{#each layout.trees as tree (tree.drawing.top)}
					{#each tree.links as d, i (i)}
						<path class="link" {d} />
					{/each}
					{#each tree.events as p (p.key)}
						<path
							class="symbol {p.event.gate ? 'gate' : p.event.kind}"
							class:lit={keyOf(p.event) === selected}
							d={symbolPath(p.event, p.cx, p.symbolTop)}
						/>
						{#if p.event.gate === 'atLeast'}
							<text
								class="vote"
								x={p.cx}
								y={p.symbolTop + FAULT_TREE.symbolHeight - 9}
								text-anchor="middle">{p.event.k ?? '?'}/{p.event.inputs.length}</text
							>
						{/if}
					{/each}
				{/each}
			</svg>
			{#each layout.trees as tree (tree.drawing.top)}
				<ul class="events" aria-label="Fault tree of {names.get(tree.drawing.top) ?? ''}">
					{#each tree.events as p (p.key)}
						<li>
							<button
								type="button"
								class="event {p.event.kind}"
								class:selected={keyOf(p.event) === selected}
								class:repeated={p.repeated}
								class:over={p.event.kind === 'top' && tree.drawing.status === 'violated'}
								style:left="{p.x}px"
								style:top="{p.y}px"
								style:width="{FAULT_TREE.boxWidth}px"
								style:height="{FAULT_TREE.boxHeight}px"
								aria-label={eventName(p)}
								aria-current={keyOf(p.event) === selected ? 'true' : undefined}
								title={eventTitle(p.event)}
								onclick={() => select(p.event)}
								onfocus={() => reveal(p)}
							>
								<span class="name">{p.event.name}</span>
								{#if p.event.description}<span class="description">{p.event.description}</span>{/if}
								<span class="figures">
									{#if p.event.gate}<span class="gate-word">{gateWords(p.event)}</span>{/if}
									<span class="p">P = {probability(p.event.probability)}</span>
									{#if p.repeated}<span class="repeat">repeated</span>{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/each}
		</div>
	{/if}

	{#if drawings?.length}
		<ul class="summaries" aria-label="Top events">
			{#each drawings as d (d.top)}
				<li class={d.status ?? ''}>
					<span>{summary(d)}</span>
					{#if d.status}<span class="verdict">{STATUS_LABEL[d.status]}</span>{/if}
					{#each d.problems as problem, i (i)}<span class="problem">{problem}</span>{/each}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="toolbar" role="toolbar" aria-label="Diagram tools">
		<button
			type="button"
			onclick={showInText}
			disabled={!selectedElement}
			title={selectedElement
				? `Show ${selectedElement.label} in the text`
				: 'Select an event, then show it in the text'}
		>
			<FileCode size={14} aria-hidden="true" /> <span>Show in text</span>
		</button>
	</div>

	<div class="zoom" role="toolbar" aria-label="Zoom">
		<button type="button" onclick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in (+)">
			<Plus size={16} aria-hidden="true" />
		</button>
		<button type="button" onclick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out (−)">
			<Minus size={16} aria-hidden="true" />
		</button>
		<button type="button" onclick={fit} aria-label="Fit to view" title="Fit to view (0)">
			<Maximize size={15} aria-hidden="true" />
		</button>
	</div>
</div>

<style>
	.viewport {
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
	.world {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}
	.lines {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.link {
		fill: none;
		stroke: color-mix(in oklab, var(--text-2) 85%, transparent);
		stroke-width: 1.5;
	}
	.symbol {
		fill: var(--surface);
		stroke: var(--text-2);
		stroke-width: 1.5;
	}
	.symbol.gate {
		fill: color-mix(in oklab, var(--kind-analysis) 14%, var(--surface));
		stroke: color-mix(in oklab, var(--kind-analysis) 60%, var(--text-2));
	}
	.symbol.lit {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.vote {
		fill: var(--text);
		font-size: 10px;
		font-weight: 650;
	}
	.events {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.event {
		position: absolute;
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 1px;
		margin: 0;
		padding: 4px 10px;
		color: var(--text);
		background: var(--surface);
		border: 1.5px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
		font: inherit;
		text-align: center;
		cursor: pointer;
	}
	.event.top {
		border-color: var(--text-2);
		border-width: 2px;
	}
	.event.top.over {
		border-color: var(--danger);
		background: linear-gradient(var(--danger-weak), var(--danger-weak)), var(--surface);
	}
	.event.repeated {
		border-style: dashed;
	}
	.event:hover {
		box-shadow: var(--shadow-md);
	}
	.event.selected {
		border-color: var(--accent);
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.name {
		max-width: 100%;
		overflow: hidden;
		font-size: 12.5px;
		font-weight: 650;
		line-height: 16px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.description {
		display: -webkit-box;
		max-width: 100%;
		overflow: hidden;
		color: var(--text-2);
		font-size: 10.5px;
		line-height: 13px;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.figures {
		display: flex;
		gap: 6px;
		font-size: 10.5px;
		line-height: 14px;
	}
	.p {
		font-family: var(--font-mono);
	}
	.gate-word,
	.repeat {
		color: var(--text-2);
		font-weight: 650;
	}

	.summaries {
		position: absolute;
		top: 10px;
		left: 10px;
		right: 12rem;
		z-index: 3;
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		pointer-events: none;
	}
	.summaries li {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 8px;
		width: fit-content;
		max-width: 100%;
		padding: 5px 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-sm);
		pointer-events: auto;
	}
	.verdict {
		font-weight: 650;
	}
	.satisfied .verdict {
		color: var(--ok);
	}
	.violated .verdict {
		color: var(--danger);
	}
	.problem {
		flex-basis: 100%;
		color: var(--warn);
	}

	.toolbar {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 3;
		display: flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
	}
	.toolbar > button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: 520;
		cursor: pointer;
	}
	.toolbar > button:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	.toolbar > button:disabled {
		color: var(--text-3);
		cursor: default;
	}
	@container (max-width: 34rem) {
		.toolbar > button span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.toolbar > button {
			padding: 0 var(--space-2);
		}
		.summaries {
			right: 4rem;
		}
	}
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
</style>
