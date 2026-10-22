<script lang="ts">
	import {
		Activity,
		ChevronDown,
		CircleAlert,
		FileCode,
		History as HistoryIcon,
		Info,
		RefreshCw,
		SlidersHorizontal,
		TriangleAlert
	} from '@lucide/svelte';
	import { onMount, tick, untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { SimStep, StateMachine, StateSession } from '#lib/engine/types.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { start as startMachine, step as stepMachine, withVariables } from './emulator.ts';
	import EventPad from './EventPad.svelte';
	import { recall, remember } from './memory.ts';
	import { bestFit, layoutMachine, type MachineLayout } from './layout.ts';
	import MachineDiagram from './MachineDiagram.svelte';
	import {
		activeSet,
		announcement,
		autoMove,
		eventOptions,
		findMachine,
		record,
		sessionAt,
		statusText,
		stepOption,
		stepsSince,
		structureKey,
		timeText,
		transitionOf,
		within,
		type History
	} from './model.ts';
	import TracePanel from './TracePanel.svelte';
	import VariablesPanel from './VariablesPanel.svelte';

	let {
		machine,
		workspace,
		ui,
		engine
	}: { machine: string; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	const SPEEDS = [0.5, 1, 2, 4];
	/** A run stops after this many steps, so auto-run cannot go on forever. */
	const LIMITS = { maxSteps: 1000 };
	const BASE_DELAY = 1100;

	// The machine, kept current as the model is edited.
	let fetched = $state.raw<StateMachine[] | null>(null);
	const machines = $derived(workspace.machines.length ? workspace.machines : (fetched ?? []));
	const def = $derived(findMachine(machines, machine) ?? null);
	const ready = $derived(workspace.machines.length > 0 || fetched !== null);

	onMount(() => {
		if (!workspace.machines.length) {
			engine
				.stateMachines(workspace.sourceFiles())
				.then((list) => (fetched = list))
				.catch((error: unknown) => {
					fetched = [];
					stepError = message(error);
				});
		}
		root?.focus({ preventScroll: true });
	});

	// Sessions, with a cursor for Back / Forward / scrubbing.
	// A run this tab had before it was closed or hidden resumes.
	const memoryKey = () => `${workspace.info?.name ?? ''}\u0000${machine}`;
	const saved = recall(memoryKey());
	let history = $state.raw<History>(saved?.history ?? { sessions: [], cursor: 0 });
	const session: StateSession | null = $derived(history.sessions[history.cursor] ?? null);
	const latest = $derived(history.sessions.at(-1) ?? null);
	let startedKey = $state<string | null>(saved?.startedKey ?? null);
	const changed = $derived(!!def && startedKey !== null && structureKey(def) !== startedKey);
	let starting = false;

	let busy = $state(false);
	let stepError = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let announce = $state(
		saved?.history.sessions.length
			? `Resumed at step ${saved.history.sessions[saved.history.cursor]?.step ?? 0}`
			: ''
	);

	// What the diagram shows while a transition animates.
	let override = $state<string[] | null>(null);
	let exiting = $state<string | null>(null);
	let arrived = $state<string | null>(null);
	let firingEdge = $state<number | null>(null);

	// Variables changed since the last step, and the guards they would give.
	let pending = $state.raw<Record<string, unknown>>(saved?.pending ?? {});
	const preview: StateSession | null = $derived.by(() => {
		if (!def || !session || !Object.keys(pending).length) return null;
		try {
			return withVariables(def, session, pending, LIMITS);
		} catch {
			return null;
		}
	});

	let auto = $state(false);
	let speed = $state(saved?.speed ?? 1);

	$effect(() => {
		remember(memoryKey(), { history, startedKey, pending, speed });
	});

	let root = $state<HTMLElement>();
	let stage = $state<HTMLElement>();
	let diagram = $state<MachineDiagram>();
	let pad = $state<EventPad>();
	let variables = $state<VariablesPanel>();
	let width = $state(0);
	let rootHeight = $state(0);
	let headerHeight = $state(0);
	let noticesHeight = $state(0);
	let dockHeight = $state(0);

	let viewWidth = $state(0);
	let viewHeight = $state(0);
	let varsOpen = $state(true);
	let traceOpen = $state(true);
	const wide = $derived(width === 0 || width >= 760);
	let highlight = $state<number[]>([]);

	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

	// Start once the machine is known.
	$effect(() => {
		if (def && !untrack(() => history.sessions.length)) void start();
	});

	// Layout in both directions; show the one that fits the viewport best.
	const layoutKey = $derived(
		def
			? JSON.stringify([
					def.states.map((s) => [
						s.name,
						s.label,
						s.kind,
						s.parent,
						s.parallel,
						s.entry,
						s.do,
						s.exit
					]),
					def.transitions.map((t) => [t.from, t.to, t.trigger, t.guard, t.effect])
				])
			: ''
	);
	let layouts = $state.raw<MachineLayout[]>([]);
	let layoutError = $state<string | null>(null);
	$effect(() => {
		const m = untrack(() => def);
		if (!layoutKey || !m) return;
		let cancelled = false;
		Promise.all([layoutMachine(m, 'DOWN'), layoutMachine(m, 'RIGHT')])
			.then((result) => {
				if (!cancelled) {
					layouts = result;
					layoutError = null;
				}
			})
			.catch((error: unknown) => (layoutError = message(error)));
		return () => {
			cancelled = true;
		};
	});
	const layout = $derived(
		bestFit(layouts, { width: viewWidth || 800, height: viewHeight || 600 }) ?? null
	);

	// What the controls offer: from the preview when variables changed.
	const view = $derived(preview ?? session);
	const enabled = $derived(view?.enabled ?? []);
	const events = $derived(eventOptions(enabled));
	const step = $derived(stepOption(enabled));
	const running = $derived(!session || session.status === 'running');
	const current = $derived(override ?? session?.current ?? []);
	const active = $derived(activeSet(def, current));
	const leaves = $derived(new Set(current));
	const edgeState = $derived(
		new Map(
			enabled.map((e) => [
				e.index,
				e.ready
					? ('ready' as const)
					: e.due !== undefined && e.due > (view?.time ?? 0)
						? ('waiting' as const)
						: ('blocked' as const)
			])
		)
	);
	const shortcuts = $derived(
		new Map(
			events.flatMap((o, i) =>
				i < 9 && o.ready ? o.transitions.filter((t) => t.ready).map((t) => [t.index, i + 1]) : []
			)
		)
	);
	const lastEdge = $derived.by(() => {
		if (firingEdge !== null) return firingEdge;
		const last = session?.trace.at(-1);
		return def && last ? transitionOf(def, last) : null;
	});
	const names = $derived(def?.transitions.map((t) => t.name ?? `${t.from} to ${t.to}`) ?? []);

	const labelOf = (path: string) => def?.states.find((s) => s.name === path)?.label ?? path;

	// Selection, both ways: diagram → model element, and the model's selection → diagram.
	const fileElements = $derived(def ? workspace.elements.filter((e) => e.file === def.file) : []);
	function stateElement(id: string) {
		const s = def?.states.find((x) => x.name === id);
		if (!s) return undefined;
		return (
			fileElements.find((e) => e.span.start_row === s.line && e.label === s.label) ??
			fileElements.find((e) => e.label === s.label && e.kind.includes('state'))
		);
	}
	function transitionElement(index: number) {
		const t = def?.transitions[index];
		if (!t) return undefined;
		return fileElements.find(
			(e) =>
				e.kind === 'transition' && e.span.start_row === t.line && (!t.name || e.label === t.name)
		);
	}
	const machineElement = $derived(
		def
			? fileElements.find((e) => e.span.start_row === def.line && e.label === def.name)
			: undefined
	);
	const selectedState = $derived.by(() => {
		const key = ui.selection?.key;
		const el = key ? fileElements.find((e) => e.key === key) : undefined;
		if (!el || !def) return null;
		return (
			def.states.find((s) => s.line === el.span.start_row && s.label === el.label)?.name ?? null
		);
	});
	const selectedEdge = $derived.by(() => {
		const key = ui.selection?.key;
		const el = key ? fileElements.find((e) => e.key === key) : undefined;
		if (!el || el.kind !== 'transition' || !def) return null;
		const i = def.transitions.findIndex((t) => t.line === el.span.start_row);
		return i >= 0 ? i : null;
	});

	function selectState(id: string) {
		const el = stateElement(id);
		if (el) ui.select(el.key, 'diagram');
		else if (machineElement) ui.select(machineElement.key, 'diagram');
	}
	function selectTransition(index: number) {
		const el = transitionElement(index);
		if (el) ui.select(el.key, 'diagram');
		else if (machineElement) {
			ui.select(machineElement.key, 'diagram');
			flash('This transition has no name, so the inspector shows its state machine.');
		}
	}
	function showSysml() {
		if (!def) return;
		const selected = fileElements.find((e) => e.key === ui.selection?.key);
		const target = selected ?? machineElement;
		if (target) ui.select(target.key, 'diagram');
		ui.open({ kind: 'file', path: def.file });
	}

	function flash(text: string) {
		notice = text;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 6000);
	}

	function duration() {
		return auto ? Math.min(420, (BASE_DELAY / speed) * 0.55) : 420;
	}

	/** Play the steps a session took: the source dims, a token travels, the target lights up. */
	async function animate(from: string[], steps: SimStep[], next: StateSession) {
		let shown = [...from];
		for (const s of steps) {
			const index = def ? transitionOf(def, s) : -1;
			shown = shown.filter((c) => !within(c, s.from_state));
			override = shown;
			exiting = s.from_state;
			firingEdge = index >= 0 ? index : null;
			if (index >= 0) await diagram?.play(index, duration());
			exiting = null;
			shown = [...shown, s.to_state];
		}
		firingEdge = null;
		override = null;
		const entered = steps.at(-1)?.to_state;
		const leaf = entered ? next.current.find((c) => within(c, entered)) : undefined;
		if (leaf) {
			arrived = leaf;
			diagram?.reveal(leaf);
			setTimeout(() => {
				if (arrived === leaf) arrived = null;
			}, 600);
		}
	}

	async function start() {
		if (!def || starting) return;
		starting = true;
		busy = true;
		stepError = null;
		notice = null;
		try {
			const first = startMachine(def, null, LIMITS);
			startedKey = structureKey(def);
			pending = {};
			override = [];
			history = { sessions: [first], cursor: 0 };
			const steps = stepsSince(null, first);
			await tick();
			await animate([], steps, first);
			announce = announcement(first, steps);
		} catch (error) {
			stepError = message(error);
			override = null;
		} finally {
			starting = false;
			busy = false;
		}
	}

	function restart() {
		auto = false;
		history = { sessions: [], cursor: 0 };
		void start();
	}

	const fire = (event: string | null) => run({ event });
	const wait = (amount: number | 'next') => run({ wait: amount });

	/** Send an event, Step (`event: null`) or let time pass. */
	async function run(choice: { event: string | null } | { wait: number | 'next' }) {
		const before = session;
		if (!before || busy || !def) return;
		if (before.status !== 'running') {
			flash('The machine has stopped. Restart to run it again.');
			return;
		}
		busy = true;
		stepError = null;
		const changes = Object.keys(pending).length ? pending : null;
		try {
			const next = stepMachine(def, before, { ...choice, variables: changes ?? undefined }, LIMITS);
			pending = {};
			const steps = stepsSince(before, next);
			if (steps.length) override = [...before.current];
			history = record(history, next);
			if (!steps.length) {
				const waited = (next.time ?? 0) > (before.time ?? 0);
				const text = next.messages?.length
					? next.messages.join(' ')
					: waited
						? `Time ${timeText(next.time)}: still in ${next.current.join(' and ')}`
						: 'Nothing happened.';
				if (next.messages?.length || !waited) flash(text.replace(/`/g, ''));
				announce = text.replace(/`/g, '');
				return;
			}
			showStage();
			await animate(before.current, steps, next);
			announce = announcement(next, steps);
			if (next.messages?.length) flash(next.messages.join(' ').replace(/`/g, ''));
		} catch (error) {
			stepError = message(error);
			override = null;
			auto = false;
		} finally {
			busy = false;
		}
	}

	/** On phones, bring the diagram back when an event fires from further down. */
	function showStage() {
		if (wide || !stage || !root) return;
		if (stage.getBoundingClientRect().bottom > root.getBoundingClientRect().top + 160) return;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		root.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
	}

	function goTo(position: number) {
		if (busy || position < 0 || position >= history.sessions.length) return;
		history = { ...history, cursor: position };
		pending = {};
		override = null;
		const s = history.sessions[position]!;
		announce = `Step ${s.step}: in ${s.current.join(' and ')}`;
	}

	// Auto-run: fire what is ready, at the chosen speed, until nothing can happen.
	$effect(() => {
		if (!auto) return;
		let stopped = false;
		const loop = async () => {
			while (!stopped) {
				await new Promise((resolve) => setTimeout(resolve, BASE_DELAY / speed));
				if (stopped) return;
				if (busy) continue;
				const s = untrack(() => session);
				const move =
					s?.status === 'running'
						? autoMove(
								untrack(() => enabled),
								s.trace
							)
						: null;
				if (!move) {
					auto = false;
					flash(
						s?.status === 'running'
							? `Auto-run paused: nothing can fire from ${s.current.join(' and ')}.`
							: 'Auto-run paused: the machine has stopped.'
					);
					return;
				}
				await fire(move.event);
			}
		};
		void loop();
		return () => {
			stopped = true;
		};
	});

	function toggleAuto() {
		if (!auto && history.cursor < history.sessions.length - 1) {
			history = { ...history, sessions: history.sessions.slice(0, history.cursor + 1) };
		}
		auto = !auto;
	}

	async function setVariable(name: string) {
		varsOpen = true;
		await tick();
		variables?.focus(name);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (/^[1-9]$/.test(e.key)) {
			const option = events[Number(e.key) - 1];
			if (!option) return;
			e.preventDefault();
			if (option.ready) void fire(option.trigger);
			else pad?.nudge(option.trigger);
		} else if (e.key === 's' || e.key === 'S') {
			e.preventDefault();
			void fire(null);
		} else if (e.key === 'w' || e.key === 'W') {
			e.preventDefault();
			pad?.wait();
		} else if (e.key === 'b' || e.key === 'B') {
			e.preventDefault();
			goTo(history.cursor - 1);
		} else if (e.key === 'p' || e.key === 'P') {
			e.preventDefault();
			toggleAuto();
		}
	}

	// On phones, start with the sections folded so the diagram and the events fit.
	let sized = false;
	$effect(() => {
		if (sized || !width) return;
		sized = true;
		if (width < 760) {
			varsOpen = false;
			traceOpen = false;
		}
	});

	const tone = $derived(
		!session
			? 'muted'
			: session.status === 'running'
				? 'ok'
				: session.status === 'completed'
					? 'info'
					: 'warn'
	);
	const pkg = $derived(def?.qualifiedName?.split('::').slice(0, -1).join('::') ?? '');
	const description = $derived(
		def
			? `${def.name}: ${def.states.filter((s) => s.kind === 'state').length} states and ${def.transitions.length} transitions. Current: ${current.map(labelOf).join(' and ') || 'none'}.`
			: ''
	);
	const changedCount = $derived(Object.keys(pending).length);
	const hasNotices = $derived(changed || !!stepError || !!def?.warnings?.length || !!layoutError);
	/** On phones the diagram fills the space above the bottom sheet. */
	const stageHeight = $derived(
		wide || !rootHeight
			? undefined
			: `${Math.max(260, rootHeight - headerHeight - (hasNotices ? noticesHeight : 0) - dockHeight)}px`
	);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="emulator"
	class:wide
	class:empty={!def}
	bind:this={root}
	bind:clientWidth={width}
	bind:clientHeight={rootHeight}
	style:scroll-padding-bottom={wide ? undefined : `${dockHeight + 8}px`}
	tabindex="-1"
	aria-label="Emulator for {def?.name ?? machine}"
	{onkeydown}
>
	{#if !ready}
		<div class="message">
			<Activity size={28} aria-hidden="true" />
			<p>Reading the state machines…</p>
		</div>
	{:else if !def}
		<div class="message">
			<span class="badge"><Info size={22} aria-hidden="true" /></span>
			<h2>No state machine called <code>{machine}</code></h2>
			<p>
				It may have been renamed or removed. Check the model, or pick one of the machines this
				project has.
			</p>
			{#if machines.length}
				<ul class="choices">
					{#each machines as m (m.qualifiedName ?? m.name)}
						<li>
							<button
								type="button"
								onclick={() =>
									ui.open({ kind: 'emulator', machine: m.qualifiedName ?? m.name, title: m.name })}
							>
								<Activity size={14} aria-hidden="true" />
								{m.qualifiedName ?? m.name}
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">This project has no <code>state def</code> yet.</p>
			{/if}
			{#if stepError}<p class="error">{stepError}</p>{/if}
		</div>
	{:else}
		<header class="header" bind:clientHeight={headerHeight}>
			<div class="ident">
				<span class="glyph" aria-hidden="true"><Activity size={18} /></span>
				<div class="titles">
					<h2>{def.name}</h2>
					<p class="sub">
						<span class="kw">«state def»</span>
						{#if pkg}in {pkg}{/if}
						{#if def.doc}<span class="doc"> · {def.doc}</span>{/if}
					</p>
				</div>
			</div>
			<div class="meta">
				{#if session}
					<Pill {tone}>{statusText(session.status)}</Pill>
					<span class="count">Step {session.step}</span>
				{/if}
				<button type="button" class="ghost" onclick={showSysml}>
					<FileCode size={15} aria-hidden="true" />
					<span>Show SysML</span>
				</button>
			</div>
		</header>

		{#if hasNotices}
			<div class="notices" bind:clientHeight={noticesHeight}>
				{#if changed}
					<div class="callout info" role="status">
						<RefreshCw size={16} aria-hidden="true" />
						<p>The model changed since this run started. Restart to emulate the new version.</p>
						<button type="button" class="callout-action" onclick={restart}>Restart</button>
					</div>
				{/if}
				{#if stepError}
					<div class="callout danger" role="alert">
						<CircleAlert size={16} aria-hidden="true" />
						<p>
							<strong>The emulator could not take that step.</strong>
							{stepError}
						</p>
						<button type="button" class="callout-action" onclick={restart}>Restart</button>
					</div>
				{/if}
				{#if def.warnings?.length}
					<details class="callout warn">
						<summary>
							<TriangleAlert size={16} aria-hidden="true" />
							<span
								>The engine has {def.warnings.length} note{def.warnings.length > 1 ? 's' : ''} on this
								machine; it may not run as written.</span
							>
							<ChevronDown size={14} aria-hidden="true" />
						</summary>
						<ul>
							{#each def.warnings as w, i (i)}<li>{w.replace(/`/g, '')}</li>{/each}
						</ul>
					</details>
				{/if}
				{#if layoutError}
					<div class="callout danger" role="alert">
						<CircleAlert size={16} aria-hidden="true" />
						<p>The diagram could not be laid out: {layoutError}</p>
					</div>
				{/if}
			</div>
		{/if}

		<div class="stage" bind:this={stage} style:height={stageHeight}>
			{#if layout}
				<MachineDiagram
					bind:this={diagram}
					bind:width={viewWidth}
					bind:height={viewHeight}
					{layout}
					{names}
					{active}
					{leaves}
					{exiting}
					{arrived}
					{edgeState}
					{shortcuts}
					{lastEdge}
					highlight={new Set(highlight)}
					{selectedState}
					{selectedEdge}
					wheelPans={wide}
					minScale={wide ? 0.55 : 0.7}
					focus={current[0] ?? null}
					{description}
					onstate={selectState}
					onedge={selectTransition}
				/>
			{:else}
				<div class="placeholder" bind:clientWidth={viewWidth} bind:clientHeight={viewHeight}>
					<p>Drawing {def.name}…</p>
				</div>
			{/if}
			<p class="now-chip" aria-live="polite" aria-atomic="true">
				<span class="pulse" aria-hidden="true"></span>
				<span>{announce || 'Starting…'}</span>
			</p>
			{#if notice}
				<p class="toast" role="status">
					<Info size={14} aria-hidden="true" />
					<span>{notice}</span>
				</p>
			{/if}
		</div>

		<div class="side">
			<details class="section" bind:open={varsOpen}>
				<summary>
					<SlidersHorizontal size={14} aria-hidden="true" />
					<span class="section-title">Variables</span>
					<span class="count-badge">{def.variables.length}</span>
					<ChevronDown size={15} class="chev" aria-hidden="true" />
				</summary>
				<div class="section-body">
					<VariablesPanel
						bind:this={variables}
						machine={def}
						values={session?.variables ?? {}}
						{pending}
						readiness={edgeState}
						onchange={(name, value) => (pending = { ...pending, [name]: value })}
						onreset={(name) =>
							(pending = Object.fromEntries(Object.entries(pending).filter(([k]) => k !== name)))}
						onhover={(indices) => (highlight = indices)}
						ontransition={selectTransition}
					/>
				</div>
			</details>
			<details class="section" bind:open={traceOpen}>
				<summary>
					<HistoryIcon size={14} aria-hidden="true" />
					<span class="section-title">Timeline</span>
					<span class="count-badge">{latest?.trace.length ?? 0}</span>
					<ChevronDown size={15} class="chev" aria-hidden="true" />
				</summary>
				<div class="section-body">
					<TracePanel
						trace={latest?.trace ?? []}
						current={session?.step ?? 0}
						{labelOf}
						positions={history.sessions.length}
						cursor={history.cursor}
						onstep={(s) => goTo(sessionAt(history, s))}
						onscrub={goTo}
					/>
				</div>
			</details>
		</div>

		<div class="dock" bind:clientHeight={dockHeight}>
			<EventPad
				bind:this={pad}
				{events}
				{step}
				{labelOf}
				{busy}
				{running}
				canBack={history.cursor > 0}
				canForward={history.cursor < history.sessions.length - 1}
				{auto}
				{speed}
				pendingCount={changedCount}
				time={view?.time ?? 0}
				onfire={(event) => void fire(event)}
				onwait={(amount) => void wait(amount)}
				onback={() => goTo(history.cursor - 1)}
				onforward={() => goTo(history.cursor + 1)}
				onrestart={restart}
				onauto={toggleAuto}
				onspeed={() => (speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
				onvariable={(name) => void setVariable(name)}
			/>
		</div>
	{/if}
</section>

<style>
	.emulator {
		container: emulator / inline-size;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: repeat(5, max-content);
		grid-template-areas: 'header' 'notices' 'stage' 'side' 'dock';
		align-content: start;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--bg);
	}
	.emulator.empty {
		display: block;
	}
	.emulator:focus {
		outline: none;
	}
	.emulator.wide {
		grid-template-columns: minmax(0, 1fr) clamp(290px, 32%, 380px);
		grid-template-rows: auto auto minmax(0, 1fr) auto;
		grid-template-areas:
			'header header'
			'notices notices'
			'stage side'
			'dock side';
		align-content: stretch;
		overflow: hidden;
	}

	.header {
		grid-area: header;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.ident {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.glyph {
		display: grid;
		place-items: center;
		flex: none;
		width: 34px;
		height: 34px;
		color: var(--kind-behavior);
		background: color-mix(in oklab, var(--kind-behavior) 13%, var(--surface));
		border-radius: var(--radius-md);
	}
	.titles {
		min-width: 0;
	}
	h2 {
		font-size: var(--text-lg);
	}
	.sub {
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kw {
		color: var(--syntax-keyword);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.count {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 0 12px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 550;
		cursor: pointer;
	}
	.ghost:hover {
		background: var(--surface-hover);
	}

	.notices {
		grid-area: notices;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4) 0;
	}
	.callout {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		color: var(--text);
		background: var(--tone-weak);
		border: 1px solid color-mix(in oklab, var(--tone) 35%, transparent);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}
	.callout > :global(svg),
	.callout summary > :global(svg:first-child) {
		flex: none;
		color: var(--tone);
	}
	.callout p {
		flex: 1;
	}
	.callout.info {
		--tone: var(--info);
		--tone-weak: var(--info-weak);
	}
	.callout.warn {
		--tone: var(--warn);
		--tone-weak: var(--warn-weak);
		display: block;
	}
	.callout.danger {
		--tone: var(--danger);
		--tone-weak: var(--danger-weak);
	}
	.callout summary {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 28px;
		cursor: pointer;
		list-style: none;
	}
	.callout summary::-webkit-details-marker {
		display: none;
	}
	.callout summary span {
		flex: 1;
	}
	.callout ul {
		margin: var(--space-2) 0 0;
		padding-left: 2.6rem;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.callout-action {
		flex: none;
		min-height: 32px;
		padding: 0 12px;
		color: var(--accent-text);
		background: var(--accent);
		border: 0;
		border-radius: var(--radius-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.stage {
		grid-area: stage;
		position: relative;
		height: clamp(300px, 56svh, 560px);
		min-height: 0;
		border-bottom: 1px solid var(--border);
	}
	.wide .stage {
		height: auto;
		border-bottom: 0;
	}
	.placeholder {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-2);
	}
	.now-chip {
		position: absolute;
		top: 12px;
		left: 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: calc(100% - 24px);
		padding: 5px 12px 5px 10px;
		color: var(--text);
		background: color-mix(in oklab, var(--surface) 88%, transparent);
		backdrop-filter: blur(8px);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-sm);
		font-weight: 550;
		pointer-events: none;
	}
	.now-chip span:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pulse {
		flex: none;
		width: 8px;
		height: 8px;
		background: var(--ok);
		border-radius: 50%;
		box-shadow: 0 0 0 0 color-mix(in oklab, var(--ok) 60%, transparent);
		animation: ping 2s var(--ease) infinite;
	}
	@keyframes ping {
		0% {
			box-shadow: 0 0 0 0 color-mix(in oklab, var(--ok) 55%, transparent);
		}
		80%,
		100% {
			box-shadow: 0 0 0 8px transparent;
		}
	}
	.toast {
		position: absolute;
		left: 12px;
		bottom: 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: calc(100% - 80px);
		padding: 7px 12px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		font-size: var(--text-sm);
		animation: rise 220ms var(--ease);
	}
	.toast :global(svg) {
		flex: none;
		color: var(--info);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.side {
		grid-area: side;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--surface-2);
	}
	.wide .side {
		overflow-y: auto;
		border-left: 1px solid var(--border);
	}
	.section + .section {
		border-top: 1px solid var(--border);
	}
	.section summary {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-4);
		color: var(--text-2);
		background: var(--surface-2);
		cursor: pointer;
		list-style: none;
	}
	.section summary::-webkit-details-marker {
		display: none;
	}
	.section summary:hover {
		color: var(--text);
	}
	.section-title {
		flex: 1;
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.count-badge {
		min-width: 20px;
		padding: 0 6px;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-size: 11px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.section :global(.chev) {
		transition: rotate 160ms var(--ease);
	}
	.section:not([open]) :global(.chev) {
		rotate: -90deg;
	}
	.section-body {
		padding: 0 var(--space-3) var(--space-4);
	}

	.dock {
		grid-area: dock;
		position: sticky;
		bottom: 0;
		z-index: 2;
		box-shadow: 0 -8px 24px rgb(0 0 0 / 0.08);
	}
	.emulator:not(.wide) .dock :global(.pad) {
		border-radius: 16px 16px 0 0;
		max-height: 52svh;
		overflow-y: auto;
	}
	.wide .dock {
		position: static;
		box-shadow: none;
	}

	.message {
		grid-column: 1 / -1;
		grid-row: 1 / -1;
		display: grid;
		justify-items: center;
		align-content: center;
		gap: var(--space-3);
		min-height: 100%;
		padding: var(--space-6) var(--space-4);
		color: var(--text-2);
		text-align: center;
	}
	.message h2 {
		color: var(--text);
	}
	.message p {
		max-width: 46ch;
	}
	.badge {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		color: var(--info);
		background: var(--info-weak);
		border-radius: 50%;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.choices button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 14px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.choices button:hover {
		border-color: var(--kind-behavior);
	}
	.hint {
		font-size: var(--text-sm);
	}
	.error {
		color: var(--danger);
		font-size: var(--text-sm);
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse,
		.toast {
			animation: none;
		}
	}
</style>
