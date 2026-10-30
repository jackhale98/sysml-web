<script lang="ts" module>
	import type { PartVariables, SystemSession } from './system.ts';

	/** Runs outlive their tab, as the single-machine emulator's do (`memory.ts`). */
	interface SavedSystemRun {
		sessions: SystemSession[];
		cursor: number;
		startedKey: string | null;
		pending: PartVariables;
		selected: string | null;
		speed: number;
	}
	const runs = new Map<string, SavedSystemRun>();
</script>

<script lang="ts">
	import {
		Boxes,
		ChevronDown,
		CircleAlert,
		FileCode,
		History as HistoryIcon,
		Info,
		RefreshCw,
		SlidersHorizontal,
		TriangleAlert
	} from '@lucide/svelte';
	import { onMount, untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { MachineSystem } from '#lib/engine/types.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import EventPad from './EventPad.svelte';
	import {
		eventOptions,
		isEventTrigger,
		signalFields,
		statusText,
		structureKey,
		timeText,
		type StepOption
	} from './model.ts';
	import PartPanel from './PartPanel.svelte';
	import { readyNow, start, step, withPartVariables, type SystemChoice } from './system.ts';
	import SystemTimeline from './SystemTimeline.svelte';
	import VariablesPanel from './VariablesPanel.svelte';

	let {
		system: name,
		workspace,
		ui,
		engine
	}: {
		/** The context's qualified name. */
		system: string;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
	} = $props();

	const SPEEDS = [0.5, 1, 2, 4];
	const LIMITS = { maxSteps: 1000 };
	const BASE_DELAY = 1100;

	let fetched = $state.raw<MachineSystem[] | null>(null);
	const systems = $derived(workspace.systems.length ? workspace.systems : (fetched ?? []));
	const sys = $derived(
		systems.find((s) => s.qualifiedName === name) ?? systems.find((s) => s.name === name) ?? null
	);
	const ready = $derived(workspace.systems.length > 0 || fetched !== null);
	let stepError = $state<string | null>(null);

	onMount(() => {
		if (!workspace.systems.length) {
			engine
				.machineSystems(workspace.sourceFiles())
				.then((list) => (fetched = list))
				.catch((error: unknown) => {
					fetched = [];
					stepError = message(error);
				});
		}
		root?.focus({ preventScroll: true });
	});

	const memoryKey = () => `${workspace.info?.name ?? ''}\u0000system\u0000${name}`;
	const saved = runs.get(memoryKey());
	let sessions = $state.raw<SystemSession[]>(saved?.sessions ?? []);
	let cursor = $state(saved?.cursor ?? 0);
	let startedKey = $state<string | null>(saved?.startedKey ?? null);
	let pending = $state.raw<PartVariables>(saved?.pending ?? {});
	let selected = $state<string | null>(saved?.selected ?? null);
	let speed = $state(saved?.speed ?? 1);
	let auto = $state(false);
	let busy = $state(false);
	let notice = $state<string | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let announce = $state('');

	$effect(() => {
		runs.set(memoryKey(), { sessions, cursor, startedKey, pending, selected, speed });
	});

	const keyOf = (s: MachineSystem) =>
		JSON.stringify([s.parts.map((p) => [p.path, structureKey(p.machine)]), s.links]);
	const session = $derived(sessions[cursor] ?? null);
	const latest = $derived(sessions.at(-1) ?? null);
	const changed = $derived(!!sys && startedKey !== null && keyOf(sys) !== startedKey);
	const part = $derived(sys?.parts.find((p) => p.path === selected) ?? sys?.parts[0] ?? null);

	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
	function flash(text: string) {
		notice = text.replace(/`/g, '');
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 6000);
	}

	// Start once the system is known.
	$effect(() => {
		if (sys && !untrack(() => sessions.length)) restart();
	});

	function restart() {
		if (!sys) return;
		auto = false;
		stepError = null;
		try {
			sessions = [start(sys, LIMITS)];
			cursor = 0;
			startedKey = keyOf(sys);
			pending = {};
			announce = `Started: ${sys.parts.map((p) => p.path).join(', ')}`;
		} catch (error) {
			stepError = message(error);
		}
	}

	// What the controls offer: with the variables changed since the last step.
	const preview = $derived.by(() => {
		if (!sys || !session || !Object.keys(pending).length) return null;
		try {
			return withPartVariables(sys, session, pending, LIMITS);
		} catch {
			return null;
		}
	});
	const view = $derived(preview ?? session);
	const partSession = $derived(part && view ? (view.parts[part.path] ?? null) : null);
	const events = $derived(eventOptions(partSession?.enabled ?? []));
	const readyParts = $derived(
		sys && view ? sys.parts.filter((p) => view.parts[p.path] && readyNow(view.parts[p.path]!)) : []
	);
	const nextDue = $derived.by(() => {
		const dues = Object.values(view?.parts ?? {}).flatMap((s) =>
			s.status === 'running' && s.nextDue !== undefined ? [s.nextDue] : []
		);
		return dues.length ? Math.min(...dues) : null;
	});
	/** The Step of the whole system: every part with something ready, else time passes. */
	const stepOption = $derived.by((): StepOption => {
		const transitions = Object.values(view?.parts ?? {}).flatMap((s) =>
			s.enabled.filter((e) => !isEventTrigger(e.trigger) || e.queued)
		);
		return {
			ready: readyParts.length > 0,
			transitions,
			reasons: [],
			...(nextDue !== null && !readyParts.length ? { next: { due: nextDue, transitions: [] } } : {})
		};
	});
	const stepHint = $derived(
		readyParts.length
			? `${readyParts.map((p) => p.path).join(' and ')} ${readyParts.length > 1 ? 'take' : 'takes'} a step`
			: nextDue !== null
				? `time passes ${timeText(nextDue - (view?.time ?? 0))}, to what comes due`
				: 'nothing to take'
	);
	const running = $derived(!session || session.status === 'running');
	const pendingCount = $derived(
		Object.values(pending).reduce((n, v) => n + Object.keys(v).length, 0)
	);

	async function run(choice: SystemChoice) {
		const before = session;
		if (!before || !sys || busy) return;
		if (before.status !== 'running') {
			flash('The parts have stopped. Restart to run them again.');
			return;
		}
		busy = true;
		stepError = null;
		try {
			const variables = pendingCount ? pending : undefined;
			const next = step(sys, before, { ...choice, ...(variables ? { variables } : {}) }, LIMITS);
			pending = {};
			const added = next.timeline.length - before.timeline.length;
			sessions = [...sessions.slice(0, cursor + 1), next];
			cursor = sessions.length - 1;
			if (next.messages?.length) flash(next.messages.join(' '));
			announce = added
				? `Time ${timeText(next.time)}: ${sys.parts.map((p) => `${p.path} in ${next.parts[p.path]!.current.join(' and ')}`).join('; ')}`
				: next.messages?.join(' ').replace(/`/g, '') || 'Nothing happened.';
			return added > 0 || next.time > before.time;
		} catch (error) {
			stepError = message(error);
			auto = false;
		} finally {
			busy = false;
		}
	}

	const fire = (event: string | null, payload?: Record<string, unknown>) =>
		event === null || !part
			? run({ step: true })
			: run({ part: part.path, event, ...(payload ? { payload } : {}) });

	function goTo(position: number) {
		if (busy || position < 0 || position >= sessions.length) return;
		cursor = position;
		pending = {};
		announce = `Time ${timeText(sessions[position]!.time)}`;
	}

	// Auto-run: Step at the chosen speed until nothing more happens.
	$effect(() => {
		if (!auto) return;
		let stopped = false;
		const loop = async () => {
			while (!stopped) {
				await new Promise((resolve) => setTimeout(resolve, BASE_DELAY / speed));
				if (stopped) return;
				if (busy) continue;
				const moved = await run({ step: true });
				if (!moved || untrack(() => session?.status) !== 'running') {
					auto = false;
					return;
				}
			}
		};
		void loop();
		return () => {
			stopped = true;
		};
	});

	let root = $state<HTMLElement>();
	let pad = $state<EventPad>();
	let variablesPanel = $state<VariablesPanel>();
	let width = $state(0);
	let rootHeight = $state(0);
	let headerHeight = $state(0);
	let noticesHeight = $state(0);
	let tabsHeight = $state(0);
	let dockHeight = $state(0);
	let varsOpen = $state(true);
	let traceOpen = $state(true);
	const wide = $derived(width === 0 || width >= 760);
	let sized = false;
	$effect(() => {
		if (sized || !width) return;
		sized = true;
		if (width < 760) {
			varsOpen = false;
			traceOpen = false;
		}
	});

	// The notes on the machines, less those about sends the parts deliver here.
	const warnings = $derived([
		...(sys?.warnings ?? []),
		...(sys?.parts.flatMap((p) =>
			(p.machine.warnings ?? [])
				.filter((w) => !/only signals sent to the machine itself are$/.test(w))
				.map((w) => `${p.path}: ${w}`)
		) ?? [])
	]);
	const hasNotices = $derived(changed || !!stepError || warnings.length > 0);
	const stageHeight = $derived(
		wide || !rootHeight
			? undefined
			: `${Math.max(220, rootHeight - headerHeight - (hasNotices ? noticesHeight : 0) - tabsHeight - dockHeight)}px`
	);

	const labelOf = (path: string, state: string) =>
		sys?.parts.find((p) => p.path === path)?.machine.states.find((s) => s.name === state)?.label ??
		state;

	/** The model element of a state or transition of a part's machine, by its line. */
	function selectLine(path: string, line: number | undefined) {
		const machine = sys?.parts.find((p) => p.path === path)?.machine;
		if (!machine) return;
		const el = workspace.elements.find(
			(e) => e.file === machine.file && e.span.start_row === (line ?? machine.line)
		);
		if (el) ui.select(el.key, 'diagram');
	}
	function showSysml() {
		if (!sys) return;
		const el = workspace.elements.find(
			(e) => e.file === sys!.file && e.span.start_row === sys!.line
		);
		if (el) ui.select(el.key, 'diagram');
		ui.open({ kind: 'file', path: sys.file });
	}

	function select(path: string) {
		selected = path;
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
			goTo(cursor - 1);
		} else if (e.key === 'p' || e.key === 'P') {
			e.preventDefault();
			auto = !auto;
		}
	}

	const tone = $derived(
		!session
			? 'muted'
			: session.status === 'running'
				? 'ok'
				: session.status === 'completed'
					? 'info'
					: 'warn'
	);
	const pkg = $derived(sys?.qualifiedName.split('::').slice(0, -1).join('::') ?? '');
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="emulator system"
	class:wide
	class:empty={!sys}
	bind:this={root}
	bind:clientWidth={width}
	bind:clientHeight={rootHeight}
	tabindex="-1"
	aria-label="Emulator for {sys?.name ?? name}"
	{onkeydown}
>
	{#if !ready}
		<div class="message"><p>Reading the state machines…</p></div>
	{:else if !sys || !part}
		<div class="message">
			<span class="badge"><Info size={22} aria-hidden="true" /></span>
			<h2>No parts called <code>{name}</code> whose machines run together</h2>
			<p>It may have been renamed, or fewer than two of its parts exhibit a state machine now.</p>
			{#if stepError}<p class="error">{stepError}</p>{/if}
		</div>
	{:else}
		<header class="header" bind:clientHeight={headerHeight}>
			<div class="ident" class:visually-hidden={!wide}>
				<span class="glyph" aria-hidden="true"><Boxes size={18} /></span>
				<div class="titles">
					<h2>{sys.name}</h2>
					<p class="sub">
						<span class="kw">«part»</span>
						{#if pkg}in {pkg}{/if} · {sys.parts.length} machines on one clock
						{#if sys.doc}<span class="doc"> · {sys.doc}</span>{/if}
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
						<p>The model changed since this run started. Restart to run the new version.</p>
						<button type="button" class="callout-action" onclick={restart}>Restart</button>
					</div>
				{/if}
				{#if stepError}
					<div class="callout danger" role="alert">
						<CircleAlert size={16} aria-hidden="true" />
						<p><strong>The emulator could not take that step.</strong> {stepError}</p>
						<button type="button" class="callout-action" onclick={restart}>Restart</button>
					</div>
				{/if}
				{#if warnings.length}
					<details class="callout warn">
						<summary>
							<TriangleAlert size={16} aria-hidden="true" />
							<span
								>The simulator has {warnings.length} note{warnings.length > 1 ? 's' : ''} on these machines;
								they may not run as written.</span
							>
							<ChevronDown size={14} aria-hidden="true" />
						</summary>
						<ul>
							{#each warnings as w, i (i)}<li>{w.replace(/`/g, '')}</li>{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}

		{#if !wide}
			<div class="tabs" role="tablist" aria-label="Parts" bind:clientHeight={tabsHeight}>
				{#each sys.parts as p (p.path)}
					<button
						type="button"
						role="tab"
						aria-selected={p.path === part.path}
						onclick={() => select(p.path)}
					>
						<span>{p.path}</span>
						<small
							>{(view?.parts[p.path]?.current ?? [])
								.map((s) => labelOf(p.path, s))
								.join(', ')}</small
						>
					</button>
				{/each}
			</div>
		{/if}

		<div class="stage" style:height={stageHeight}>
			{#each sys.parts as p (p.path)}
				{#if wide || p.path === part.path}
					<PartPanel
						path={p.path}
						machine={p.machine}
						session={view?.parts[p.path] ?? null}
						selected={p.path === part.path}
						{wide}
						onselect={() => select(p.path)}
						onstate={(id) => selectLine(p.path, p.machine.states.find((s) => s.name === id)?.line)}
						onedge={(i) => selectLine(p.path, p.machine.transitions[i]?.line)}
					/>
				{/if}
			{/each}
			<p class="now-chip" aria-live="polite" aria-atomic="true">
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
					<span class="section-title">Variables of {part.path}</span>
					<span class="count-badge">{part.machine.variables.length}</span>
					<ChevronDown size={15} class="chev" aria-hidden="true" />
				</summary>
				<div class="section-body">
					<VariablesPanel
						bind:this={variablesPanel}
						machine={part.machine}
						values={session?.parts[part.path]?.variables ?? {}}
						pending={pending[part.path] ?? {}}
						readiness={new Map()}
						onchange={(n, value) =>
							(pending = { ...pending, [part.path]: { ...pending[part.path], [n]: value } })}
						onreset={(n) =>
							(pending = {
								...pending,
								[part.path]: Object.fromEntries(
									Object.entries(pending[part.path] ?? {}).filter(([k]) => k !== n)
								)
							})}
						onhover={() => {}}
						ontransition={(i) => selectLine(part.path, part.machine.transitions[i]?.line)}
					/>
				</div>
			</details>
			<details class="section" bind:open={traceOpen}>
				<summary>
					<HistoryIcon size={14} aria-hidden="true" />
					<span class="section-title">Timeline</span>
					<span class="count-badge">{latest?.timeline.length ?? 0}</span>
					<ChevronDown size={15} class="chev" aria-hidden="true" />
				</summary>
				<div class="section-body">
					<SystemTimeline timeline={session?.timeline ?? []} {labelOf} />
				</div>
			</details>
		</div>

		<div class="dock" bind:clientHeight={dockHeight}>
			<p class="dock-part">Events for <strong>{part.path}</strong></p>
			<EventPad
				bind:this={pad}
				compact={!wide}
				{events}
				step={stepOption}
				{stepHint}
				labelOf={(s) => labelOf(part.path, s)}
				{busy}
				{running}
				canBack={cursor > 0}
				canForward={cursor < sessions.length - 1}
				{auto}
				{speed}
				{pendingCount}
				time={view?.time ?? 0}
				onfire={(event, payload) => void fire(event, payload)}
				fields={(trigger) => signalFields(part.machine, trigger)}
				onwait={(amount) => void run({ wait: amount })}
				onback={() => goTo(cursor - 1)}
				onforward={() => goTo(cursor + 1)}
				onrestart={restart}
				onauto={() => (auto = !auto)}
				onspeed={() => (speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
				onvariable={(n) => {
					varsOpen = true;
					variablesPanel?.focus(n);
				}}
			/>
		</div>
	{/if}
</section>

<style>
	.emulator {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: repeat(6, max-content);
		grid-template-areas: 'header' 'notices' 'tabs' 'stage' 'side' 'dock';
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
	.emulator:not(.wide) .header {
		padding: var(--space-2) var(--space-4);
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
	.emulator:not(.wide) .meta {
		flex: 1;
	}
	.emulator:not(.wide) .meta .ghost {
		margin-left: auto;
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

	.tabs {
		grid-area: tabs;
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4) 0;
		overflow-x: auto;
	}
	.tabs button {
		display: grid;
		flex: none;
		justify-items: start;
		min-height: 44px;
		max-width: 60vw;
		padding: 4px 12px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		border-color: var(--kind-behavior);
		box-shadow: 0 0 0 1px var(--kind-behavior);
	}
	.tabs small {
		overflow: hidden;
		max-width: 100%;
		color: var(--text-2);
		font-weight: 400;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stage {
		grid-area: stage;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-auto-rows: minmax(0, 1fr);
		gap: var(--space-3);
		height: clamp(300px, 56svh, 560px);
		min-height: 0;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}
	.wide .stage {
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		grid-auto-rows: minmax(260px, 1fr);
		height: auto;
		overflow-y: auto;
		border-bottom: 0;
	}
	.now-chip {
		position: absolute;
		right: 24px;
		bottom: 20px;
		z-index: 1;
		max-width: calc(100% - 48px);
		padding: 5px 12px;
		overflow: hidden;
		color: var(--text);
		background: color-mix(in oklab, var(--surface) 88%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}
	.toast {
		position: absolute;
		z-index: 1;
		left: 24px;
		bottom: 56px;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: calc(100% - 48px);
		padding: 7px 12px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		font-size: var(--text-sm);
	}
	.toast :global(svg) {
		flex: none;
		color: var(--info);
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
		background: var(--surface);
		box-shadow: 0 -8px 24px rgb(0 0 0 / 0.08);
	}
	.dock-part {
		padding: var(--space-2) var(--space-4) 0;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.emulator:not(.wide) .dock :global(.pad) {
		max-height: 48svh;
		overflow-y: auto;
	}
	.wide .dock {
		position: static;
		box-shadow: none;
	}

	.message {
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
	.badge {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		color: var(--info);
		background: var(--info-weak);
		border-radius: 50%;
	}
	.error {
		color: var(--danger);
	}
</style>
