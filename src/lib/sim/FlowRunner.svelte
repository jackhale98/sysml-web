<script lang="ts">
	import {
		Activity,
		ChevronDown,
		CircleAlert,
		FileCode,
		GitFork,
		History as HistoryIcon,
		Info,
		Pause,
		Play,
		Redo2,
		RefreshCw,
		RotateCcw,
		Send,
		SlidersHorizontal,
		StepForward,
		TriangleAlert,
		Undo2
	} from '@lucide/svelte';
	import { onMount, tick, untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ActionFlow } from '#lib/engine/types.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { graphAt, placed, splitPath, type FlowEvent } from './flow.ts';
	import { layoutFlow, type FlowLayout } from './flow-layout.ts';
	import {
		autoMove,
		findFlow,
		runnerFor,
		type FlowMove,
		type FlowSession,
		type FlowTraceStep
	} from './flow-run.ts';
	import FlowDiagram, { type NodeStatus } from './FlowDiagram.svelte';
	import { bestFit } from './layout.ts';
	import { coerce, formatValue, parseLiteral, timeText, type InputKind } from './model.ts';

	let {
		action,
		workspace,
		ui,
		engine
	}: {
		/** The action's (qualified) name. */
		action: string;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
	} = $props();

	const SPEEDS = [0.5, 1, 2, 4];
	const BASE_DELAY = 1100;

	// The action, kept current as the model is edited.
	let fetched = $state.raw<ActionFlow[] | null>(null);
	const flows = $derived(workspace.flows.length ? workspace.flows : (fetched ?? []));
	const def = $derived(findFlow(flows, action) ?? null);
	const runner = $derived(def ? runnerFor(def, flows) : null);
	const ready = $derived(workspace.flows.length > 0 || fetched !== null);

	let stepError = $state<string | null>(null);
	onMount(() => {
		if (!workspace.flows.length) {
			engine
				.actionFlows(workspace.sourceFiles())
				.then((list) => (fetched = list))
				.catch((error: unknown) => {
					fetched = [];
					stepError = message(error);
				});
		}
		root?.focus({ preventScroll: true });
	});

	// Runs, with a cursor for Back / Forward.
	let history = $state.raw<{ sessions: FlowSession[]; cursor: number }>({
		sessions: [],
		cursor: 0
	});
	const session = $derived(history.sessions[history.cursor] ?? null);
	const latest = $derived(history.sessions.at(-1) ?? null);
	let startedBody = $state<string | null>(null);
	const changed = $derived(!!def && startedBody !== null && startedBody !== def.body);

	let busy = $state(false);
	let auto = $state(false);
	let speed = $state(1);
	let notice = $state<string | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let announce = $state('');
	/** Values changed since the last move, applied with the next one. */
	let pending = $state.raw<Record<string, unknown>>({});

	let root = $state<HTMLElement>();
	let stage = $state<HTMLElement>();
	let diagram = $state<FlowDiagram>();
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

	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

	$effect(() => {
		if (runner && !untrack(() => history.sessions.length)) start();
	});

	function start() {
		if (!runner || !def) return;
		stepError = null;
		try {
			const first = runner.start();
			startedBody = def.body;
			pending = {};
			history = { sessions: [first], cursor: 0 };
			announce = `Started ${def.name}`;
		} catch (error) {
			stepError = message(error);
		}
	}

	function restart() {
		auto = false;
		follow = true;
		showing = '';
		history = { sessions: [], cursor: 0 };
		start();
	}

	// What the run waits for, and what it can do.
	const outlook = $derived(runner && session ? runner.outlook(session) : null);
	const unsupported = $derived(runner?.unsupported() ?? []);
	const variables = $derived(runner ? runner.variables(session) : []);

	// Which body the diagram shows: the action's own, or a performed action's while it runs.
	let showing = $state('');
	let follow = $state(true);
	/** Running frames with a flow worth drawing, outermost first: path and label. */
	const frames = $derived.by(() => {
		if (!runner || !session) return [] as { path: string; label: string }[];
		const out = [{ path: '', label: def?.name ?? '' }];
		for (const p of placed(runner.graph, session.state.root, runner.host)) {
			if (!p.run?.child || (p.node.kind !== 'perform' && p.node.kind !== 'action')) continue;
			const at = graphAt(runner.graph, session.state.root, p.path, runner.host);
			if (at && at.graph.nodes.length > 1)
				out.push({ path: p.path, label: runner.label(p.path, runner.graph, session.state.root) });
		}
		return out;
	});
	$effect(() => {
		const list = frames;
		if (follow) showing = list.at(-1)?.path ?? '';
		else if (!list.some((f) => f.path === showing)) showing = '';
	});
	const shown = $derived(
		runner && session ? graphAt(runner.graph, session.state.root, showing, runner.host) : null
	);
	const shownGraph = $derived(shown?.graph ?? runner?.graph ?? null);
	const prefix = $derived(showing ? `${showing}.` : '');

	// Layout in both directions; show the one that fits best.
	let layouts = $state.raw<FlowLayout[]>([]);
	let layoutError = $state<string | null>(null);
	$effect(() => {
		const graph = shownGraph;
		if (!graph) return;
		let cancelled = false;
		Promise.all([layoutFlow(graph, 'DOWN'), layoutFlow(graph, 'RIGHT')])
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

	// What each node of the shown body is doing.
	const statuses = $derived.by(() => {
		const map = new Map<string, NodeStatus>();
		const frame = shown?.frame;
		if (!frame || !shownGraph || !outlook) return map;
		for (const [id, count] of Object.entries(frame.ended ?? {})) if (count) map.set(id, 'done');
		if (frame.done) map.set('done', 'done');
		for (const n of shownGraph.nodes) {
			if (n.kind === 'start' && session && session.state.step >= 0) map.set(n.id, 'done');
			if (frame.running[n.id]) {
				const waiting = outlook.running.find((r) => r.path === prefix + n.id);
				map.set(n.id, waiting?.waits && waiting.waits !== 'its own steps' ? 'waiting' : 'running');
			}
			const held = frame.held?.[n.id];
			if (held) map.set(n.id, held.choices ? 'choice' : 'held');
		}
		return map;
	});
	const notes = $derived.by(() => {
		const map = new Map<string, string>();
		const frame = shown?.frame;
		if (!frame || !outlook) return map;
		for (const r of outlook.running) {
			if (r.waits && r.path.startsWith(prefix) && !r.path.slice(prefix.length).includes('.'))
				map.set(r.path.slice(prefix.length), `waits for ${r.waits}`);
		}
		for (const [id, held] of Object.entries(frame.held ?? {})) map.set(id, held.reason);
		return map;
	});
	const joins = $derived.by(() => {
		const map = new Map<string, string>();
		const frame = shown?.frame;
		if (!frame || !shownGraph) return map;
		for (const [id, arrived] of Object.entries(frame.joins ?? {})) {
			const needed = shownGraph.edges.filter((e) => e.to === id && e.orders).length;
			map.set(id, `${arrived.length} of ${needed}`);
		}
		return map;
	});
	/** Edges of the shown body that the step on show went along. */
	const lastEdges = $derived.by(() => {
		const step = session?.trace.at(-1);
		return new Set(edgesOf(step?.events ?? []));
	});
	function edgesOf(events: FlowEvent[]): number[] {
		const out: number[] = [];
		for (const e of events) {
			if (!e.edge) continue;
			const at = e.edge.lastIndexOf('#');
			if (e.edge.slice(0, at) === prefix) out.push(Number(e.edge.slice(at + 1)));
		}
		return out;
	}
	const focus = $derived(
		[...statuses].find(([, s]) => s === 'running' || s === 'waiting' || s === 'choice')?.[0] ?? null
	);

	const running = $derived(
		!!session && (session.status === 'running' || session.status === 'waiting')
	);
	const tone = $derived(
		!session
			? 'muted'
			: session.status === 'running'
				? 'ok'
				: session.status === 'completed'
					? 'info'
					: 'warn'
	);
	const STATUS: Record<string, string> = {
		running: 'Running',
		waiting: 'Waiting',
		completed: 'Completed',
		stuck: 'Stuck',
		stopped: 'Stopped',
		'max steps reached': 'Step limit reached'
	};

	function flash(text: string) {
		notice = text;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 6000);
	}

	/** Take a move, show where the tokens went. */
	async function take(move: FlowMove) {
		const before = session;
		if (!before || busy || !runner) return;
		if (!running) {
			flash('The run has ended. Restart to run it again.');
			return;
		}
		busy = true;
		stepError = null;
		try {
			const next = runner.move(before, move, pending);
			pending = {};
			if (next.trace.length === before.trace.length) {
				const text = (next.messages ?? []).join(' ').replace(/`/g, '') || 'Nothing happened.';
				flash(text);
				announce = text;
				history = {
					sessions: [...history.sessions.slice(0, history.cursor), next],
					cursor: history.cursor
				};
				return;
			}
			history = {
				sessions: [...history.sessions.slice(0, history.cursor + 1), next],
				cursor: history.cursor + 1
			};
			const step = next.trace.at(-1)!;
			announce = summary(step, next);
			await tick();
			if (diagram)
				await diagram.play(
					edgesOf(step.events),
					auto ? Math.min(420, (BASE_DELAY / speed) * 0.55) : 420
				);
			if (focus) diagram?.reveal(focus);
			if (step.notes?.length) flash(step.notes.join(' ').replace(/`/g, ''));
		} catch (error) {
			stepError = message(error);
			auto = false;
		} finally {
			busy = false;
		}
	}

	function labelAt(path: string, s: FlowSession | null = session): string {
		if (!runner) return path;
		const after = s ? runner.label(path, runner.graph, s.state.root) : path;
		return after || splitPath(path).join(' › ');
	}

	/** A step said as a sentence: "takeOff ended; flyToDropPoint started". */
	function summary(step: FlowTraceStep, s: FlowSession): string {
		const ended = step.events.filter((e) => e.what === 'ended').map((e) => labelAt(e.node, s));
		const started = step.events.filter((e) => e.what === 'started').map((e) => labelAt(e.node, s));
		const parts = [
			...(ended.length ? [`${list(ended)} ended`] : []),
			...(started.length ? [`${list(started)} started`] : [])
		];
		const end =
			s.status === 'completed'
				? '. The action completed'
				: s.status === 'stuck'
					? '. Nothing more can happen'
					: '';
		return `${parts.join('; ') || step.cause}${end}`;
	}

	function list(names: string[]): string {
		if (names.length <= 1) return names[0] ?? '';
		return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
	}

	function goTo(position: number) {
		if (busy || position < 0 || position >= history.sessions.length) return;
		history = { ...history, cursor: position };
		pending = {};
		announce = `Step ${history.sessions[position]!.state.step}`;
	}

	// Auto-run: step at the chosen speed while something can happen.
	$effect(() => {
		if (!auto) return;
		let stopped = false;
		const loop = async () => {
			while (!stopped) {
				await new Promise((resolve) => setTimeout(resolve, BASE_DELAY / speed));
				if (stopped) return;
				if (busy) continue;
				const o = untrack(() => outlook);
				const s = untrack(() => session);
				const move =
					s && (s.status === 'running' || s.status === 'waiting') && o ? autoMove(o) : null;
				if (!move) {
					auto = false;
					flash(
						s?.status === 'completed'
							? 'Auto-run paused: the action completed.'
							: o?.signals.length
								? `Auto-run paused: waiting for ${o.signals.join(' or ')}. Send it below.`
								: 'Auto-run paused: nothing more can happen.'
					);
					return;
				}
				await take(move);
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

	// Selection: a node selects its element in the model; a performed action that runs opens its flow.
	const fileElements = $derived(def ? workspace.elements.filter((e) => e.file === def.file) : []);
	function selectNode(id: string) {
		const path = prefix + id;
		if (frames.some((f) => f.path === path)) {
			follow = false;
			showing = path;
			return;
		}
		const node = shownGraph?.nodes.find((n) => n.id === id);
		const name = node?.label || id;
		const el =
			fileElements.find((e) => e.label === name && e.kind.includes('action')) ??
			fileElements.find((e) => e.label === name);
		if (el) ui.select(el.key, 'diagram');
	}
	function showSysml() {
		if (!def) return;
		const el = fileElements.find((e) => e.span.start_row === def.line && e.label === def.name);
		if (el) ui.select(el.key, 'diagram');
		ui.open({ kind: 'file', path: def.file });
	}

	// Variables: the action's parameters and attributes and its steps'.
	function kindOf(type: string | null, value: unknown): InputKind {
		const t = type?.split('::').pop() ?? '';
		if (t === 'Boolean' || typeof value === 'boolean') return 'boolean';
		if (/^(Integer|Natural|Positive)$/.test(t)) return 'integer';
		if (/^(Real|Rational|Number)$/.test(t) || typeof value === 'number') return 'real';
		return 'text';
	}
	function shownValue(path: string, value: unknown): unknown {
		return path in pending ? pending[path] : value;
	}
	function setValue(path: string, kind: InputKind, raw: string | boolean) {
		pending = { ...pending, [path]: coerce(kind, raw) };
	}
	function display(value: unknown): string {
		if (value && typeof value === 'object' && 'value' in value && 'unit' in value)
			return `${formatValue((value as { value: number }).value)} [${(value as { unit: string }).unit}]`;
		if (value && typeof value === 'object' && 'literal' in value)
			return String((value as { literal: string }).literal);
		return formatValue(value);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (e.key === 's' || e.key === 'S') {
			e.preventDefault();
			void take({ step: true });
		} else if (e.key === 'b' || e.key === 'B') {
			e.preventDefault();
			goTo(history.cursor - 1);
		} else if (e.key === 'p' || e.key === 'P') {
			e.preventDefault();
			toggleAuto();
		}
	}

	let sized = false;
	$effect(() => {
		if (sized || !width) return;
		sized = true;
		if (width < 760) {
			varsOpen = false;
			traceOpen = false;
		}
	});

	const pkg = $derived(def?.qualifiedName?.split('::').slice(0, -1).join('::') ?? '');
	const description = $derived(
		def && shownGraph
			? `${def.name}: ${shownGraph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'done').length} steps. Running: ${
					[...statuses]
						.filter(([, s]) => s === 'running' || s === 'waiting')
						.map(([id]) => id)
						.join(', ') || 'none'
				}.`
			: ''
	);
	const hasNotices = $derived(changed || !!stepError || unsupported.length > 0 || !!layoutError);
	const stageHeight = $derived(
		wide || !rootHeight
			? undefined
			: `${Math.max(200, rootHeight - headerHeight - (hasNotices ? noticesHeight : 0) - dockHeight)}px`
	);
	const pendingCount = $derived(Object.keys(pending).length);

	/** The events of a step, in words. */
	function lines(step: FlowTraceStep, at: number): { text: string; tone: string }[] {
		const s = history.sessions.find((x) => x.state.step === step.step) ?? latest;
		const before = history.sessions[Math.max(0, at - 1)] ?? s;
		const name = (path: string) => {
			const after = labelAt(path, s);
			return after.includes('#') ? labelAt(path, before) : after;
		};
		const out: { text: string; tone: string }[] = [];
		for (const e of step.events) {
			if (e.what === 'ended')
				out.push({ text: `${name(e.node)} ended${e.text ? `: ${e.text}` : ''}`, tone: 'ended' });
			else if (e.what === 'started') out.push({ text: `${name(e.node)} started`, tone: 'started' });
			else if (e.what === 'waits')
				out.push({ text: `${name(e.node)} waits: ${e.text ?? ''}`, tone: 'waits' });
			else if (e.what === 'took' && e.text)
				out.push({ text: `${name(e.node)}: ${e.text}`, tone: 'took' });
		}
		return out;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="runner"
	class:wide
	class:empty={!def}
	bind:this={root}
	bind:clientWidth={width}
	bind:clientHeight={rootHeight}
	tabindex="-1"
	aria-label="Action flow run of {def?.name ?? action}"
	{onkeydown}
>
	{#if !ready}
		<div class="message">
			<Activity size={28} aria-hidden="true" />
			<p>Reading the actions…</p>
		</div>
	{:else if !def || !runner}
		<div class="message">
			<span class="badge"><Info size={22} aria-hidden="true" /></span>
			<h2>No action called <code>{action}</code></h2>
			<p>It may have been renamed or removed. Pick one of the actions this project can run.</p>
			{#if flows.some((f) => f.runnable)}
				<ul class="choices">
					{#each flows.filter((f) => f.runnable) as f (f.qualifiedName ?? f.name)}
						<li>
							<button
								type="button"
								onclick={() =>
									ui.open({ kind: 'flow', action: f.qualifiedName ?? f.name, title: f.name })}
							>
								<Play size={14} aria-hidden="true" />
								{f.qualifiedName ?? f.name}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if stepError}<p class="error">{stepError}</p>{/if}
		</div>
	{:else}
		<header class="header" bind:clientHeight={headerHeight}>
			<div class="ident" class:visually-hidden={!wide}>
				<span class="glyph" aria-hidden="true"><GitFork size={18} /></span>
				<div class="titles">
					<h2>{def.name}</h2>
					<p class="sub">
						<span class="kw">«{def.keyword}»</span>
						{#if pkg}in {pkg}{/if}
						{#if def.doc}<span class="doc"> · {def.doc}</span>{/if}
					</p>
				</div>
			</div>
			<div class="meta">
				{#if session}
					<Pill {tone}>{STATUS[session.status] ?? session.status}</Pill>
					<span class="count">Step {session.state.step}</span>
					{#if session.state.time}<span class="count">{timeText(session.state.time)}</span>{/if}
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
						<p><strong>The run could not take that step.</strong> {stepError}</p>
						<button type="button" class="callout-action" onclick={restart}>Restart</button>
					</div>
				{/if}
				{#if unsupported.length}
					<details class="callout warn unsupported">
						<summary>
							<TriangleAlert size={16} aria-hidden="true" />
							<span
								>The simulator has {unsupported.length} note{unsupported.length > 1 ? 's' : ''} on this
								action; it may not run as written.</span
							>
							<ChevronDown size={14} aria-hidden="true" />
						</summary>
						<ul>
							{#each unsupported as u, i (i)}<li>{u.replace(/`/g, '')}</li>{/each}
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
			{#if frames.length > 1}
				<nav class="crumbs" aria-label="Performed actions">
					{#each frames as f, i (f.path)}
						{#if i}<span aria-hidden="true">›</span>{/if}
						<button
							type="button"
							aria-current={f.path === showing ? 'true' : undefined}
							onclick={() => {
								follow = i === frames.length - 1;
								showing = f.path;
							}}>{i ? f.label.split(' › ').pop() : f.label}</button
						>
					{/each}
				</nav>
			{/if}
			{#if layout}
				<FlowDiagram
					bind:this={diagram}
					bind:width={viewWidth}
					bind:height={viewHeight}
					{layout}
					{statuses}
					{notes}
					{joins}
					{lastEdges}
					{focus}
					{description}
					wheelPans={wide}
					minScale={wide ? 0.55 : 0.7}
					onnode={selectNode}
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
					<span class="section-title">Values</span>
					<span class="count-badge">{variables.length}</span>
					<ChevronDown size={15} class="chev" aria-hidden="true" />
				</summary>
				<div class="section-body">
					{#if variables.length}
						<ul class="vars">
							{#each variables as v (v.path)}
								{@const value = shownValue(v.path, v.value)}
								{@const kind = kindOf(v.type, parseLiteral(value))}
								<li class:changed={v.path in pending}>
									<label for="var-{v.path}">
										<span class="var-name">{v.path}</span>
										<span class="var-type"
											>{v.direction ? `${v.direction} ` : ''}{v.type?.split('::').pop() ?? ''}</span
										>
									</label>
									{#if kind === 'boolean'}
										<select
											id="var-{v.path}"
											value={value === null || value === undefined ? '' : String(value)}
											onchange={(e) =>
												e.currentTarget.value === ''
													? (pending = { ...pending, [v.path]: null })
													: setValue(v.path, 'boolean', e.currentTarget.value === 'true')}
										>
											<option value="">unset</option>
											<option value="true">true</option>
											<option value="false">false</option>
										</select>
									{:else if kind === 'text' && value && typeof value === 'object'}
										<span class="var-value">{display(value)}</span>
									{:else}
										<input
											id="var-{v.path}"
											type={kind === 'text' ? 'text' : 'number'}
											step={kind === 'integer' ? 1 : 'any'}
											placeholder="unset"
											value={value === null || value === undefined
												? ''
												: typeof value === 'object'
													? String((value as { value?: unknown }).value ?? '')
													: String(value)}
											onchange={(e) => setValue(v.path, kind, e.currentTarget.value)}
										/>
									{/if}
								</li>
							{/each}
						</ul>
						{#if pendingCount}
							<p class="hint">
								{pendingCount} value{pendingCount > 1 ? 's' : ''} change{pendingCount > 1
									? ''
									: 's'} with the next step.
							</p>
						{/if}
					{:else}
						<p class="hint">This action has no parameters or attributes.</p>
					{/if}
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
					<ol class="trace">
						{#each latest?.trace ?? [] as s, i (s.step)}
							<li class:future={s.step > (session?.state.step ?? 0)}>
								<button
									type="button"
									class="step"
									aria-current={s.step === session?.state.step ? 'step' : undefined}
									onclick={() => goTo(history.sessions.findIndex((x) => x.state.step === s.step))}
								>
									<span class="num" aria-hidden="true">{s.step}</span>
									<span class="body">
										<span class="head"
											><span class="cause">{s.cause}</span>{#if s.time}<span class="when"
													>{timeText(s.time)}</span
												>{/if}</span
										>
										{#each lines(s, i) as l, j (j)}
											<span class="ev {l.tone}">{l.text.replace(/`/g, '')}</span>
										{/each}
										{#each s.notes ?? [] as n, j (j)}
											<span class="note"
												><TriangleAlert size={12} aria-hidden="true" />{n.replace(/`/g, '')}</span
											>
										{/each}
									</span>
								</button>
							</li>
						{/each}
					</ol>
				</div>
			</details>
		</div>

		<div class="dock" bind:clientHeight={dockHeight}>
			<section class="pad" class:compact={!wide} aria-label="Run controls">
				{#if outlook && (outlook.signals.length || outlook.choices.length || outlook.blocked.length || outlook.next !== null)}
					<div class="waits">
						{#each outlook.signals as signal (signal)}
							<button
								type="button"
								class="signal"
								disabled={busy || !running}
								onclick={() => void take({ signal })}
							>
								<Send size={14} aria-hidden="true" />
								<span>Send <code>{signal}</code></span>
							</button>
						{/each}
						{#each outlook.choices as c (c.path)}
							<div class="choice" role="group" aria-label="Choose a branch at {c.label}">
								<p><strong>{c.label}</strong>: {c.reason.replace(/`/g, '')}</p>
								<div class="options">
									{#each c.options as o (o.edge)}
										<button
											type="button"
											disabled={busy}
											onclick={() => void take({ choose: c.path, edge: o.edge })}
											>Take <code>{o.text}</code></button
										>
									{/each}
								</div>
							</div>
						{/each}
						{#each outlook.blocked as b (b.path)}
							<p class="blocked">
								<TriangleAlert size={13} aria-hidden="true" />
								<span><strong>{b.label}</strong>: {b.reason.replace(/`/g, '')}</span>
							</p>
						{/each}
						{#if outlook.next !== null && !outlook.signals.length}
							<p class="next">
								Next: a timed accept is due at {timeText(outlook.next)}. Step lets the time pass.
							</p>
						{/if}
					</div>
				{/if}
				<div class="controls" role="toolbar" aria-label="Run">
					<button
						type="button"
						class="primary"
						disabled={busy || !running || !outlook?.canStep}
						onclick={() => void take({ step: true })}
						title="Step (S)"
					>
						<StepForward size={16} aria-hidden="true" />
						<span>Step</span>
					</button>
					<button type="button" onclick={toggleAuto} disabled={!running} title="Auto-run (P)">
						{#if auto}<Pause size={15} aria-hidden="true" /><span class:visually-hidden={!wide}
								>Pause</span
							>{:else}<Play size={15} aria-hidden="true" /><span class:visually-hidden={!wide}
								>Auto-run</span
							>{/if}
					</button>
					<button
						type="button"
						class="speed"
						onclick={() => (speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
						aria-label="Speed {speed}×"
						title="Auto-run speed">{speed}×</button
					>
					<button
						type="button"
						onclick={() => goTo(history.cursor - 1)}
						disabled={busy || history.cursor === 0}
						title="Back (B)"
						aria-label="Back"
					>
						<Undo2 size={15} aria-hidden="true" />
					</button>
					<button
						type="button"
						onclick={() => goTo(history.cursor + 1)}
						disabled={busy || history.cursor >= history.sessions.length - 1}
						title="Forward"
						aria-label="Forward"
					>
						<Redo2 size={15} aria-hidden="true" />
					</button>
					<button type="button" onclick={restart} title="Restart" aria-label="Restart">
						<RotateCcw size={15} aria-hidden="true" />
					</button>
				</div>
			</section>
		</div>
	{/if}
</section>

<style>
	.runner {
		container: runner / inline-size;
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
	.runner.empty {
		display: block;
	}
	.runner:focus {
		outline: none;
	}
	.runner.wide {
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
	.runner:not(.wide) .header {
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
	.runner:not(.wide) .meta {
		flex: 1;
	}
	.runner:not(.wide) .meta .ghost {
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
	.crumbs {
		position: absolute;
		top: 52px;
		left: 12px;
		z-index: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		max-width: calc(100% - 24px);
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.crumbs button {
		min-height: 28px;
		padding: 0 10px;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font: inherit;
		cursor: pointer;
	}
	.crumbs button[aria-current='true'] {
		color: var(--text);
		border-color: var(--kind-behavior);
		font-weight: 600;
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

	.vars {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.vars li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(90px, 40%);
		align-items: center;
		gap: var(--space-2);
		padding: 6px 8px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.vars li.changed {
		border-color: var(--accent);
	}
	.vars label {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.var-name {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.var-type {
		color: var(--text-3);
		font-size: 11px;
	}
	.vars input,
	.vars select {
		width: 100%;
		min-height: 32px;
		padding: 0 6px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
	}
	.var-value {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.hint {
		margin-top: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}

	.trace {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.trace li.future {
		opacity: 0.5;
	}
	.step {
		display: flex;
		gap: var(--space-2);
		width: 100%;
		padding: 6px 8px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.step[aria-current='step'] {
		border-color: var(--kind-behavior);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--kind-behavior) 20%, transparent);
	}
	.num {
		flex: none;
		min-width: 20px;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.when {
		color: var(--text-2);
		font-weight: 400;
	}
	.ev,
	.note {
		overflow-wrap: anywhere;
		color: var(--text-2);
		font-size: 11.5px;
	}
	.ev.started {
		color: var(--text);
	}
	.ev.waits,
	.note {
		color: var(--warn);
	}
	.note {
		display: flex;
		gap: 4px;
		align-items: flex-start;
	}

	.dock {
		grid-area: dock;
		position: sticky;
		bottom: 0;
		z-index: 2;
		box-shadow: 0 -8px 24px rgb(0 0 0 / 0.08);
	}
	.wide .dock {
		position: static;
		box-shadow: none;
	}
	.pad {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border-top: 1px solid var(--border);
	}
	.pad.compact {
		max-height: 52svh;
		overflow-y: auto;
		border-radius: 16px 16px 0 0;
	}
	.waits {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.signal,
	.options button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		min-height: 40px;
		padding: 0 14px;
		color: var(--text);
		background: color-mix(in oklab, var(--kind-behavior) 10%, var(--surface));
		border: 1.5px solid var(--kind-behavior);
		border-radius: var(--radius-md);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 550;
		cursor: pointer;
	}
	.choice p,
	.blocked,
	.next {
		margin: 0;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.blocked {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		color: var(--warn);
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: 4px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.controls button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 44px;
		min-height: 44px;
		padding: 0 12px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 550;
		cursor: pointer;
	}
	.controls button.primary {
		color: var(--accent-text);
		background: var(--accent);
		border-color: var(--accent);
	}
	.controls button:disabled,
	.signal:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.speed {
		font-variant-numeric: tabular-nums;
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
	.error {
		color: var(--danger);
		font-size: var(--text-sm);
	}
</style>
