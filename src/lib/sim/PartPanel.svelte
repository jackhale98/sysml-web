<script lang="ts">
	import { Activity } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import type { StateMachine, StateSession } from '#lib/engine/types.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import { bestFit, layoutMachine, type MachineLayout } from './layout.ts';
	import MachineDiagram from './MachineDiagram.svelte';
	import { activeSet, statusText, transitionOf } from './model.ts';

	/** One part's machine, as the system emulator shows it beside the others. */
	interface Props {
		path: string;
		machine: StateMachine;
		session: StateSession | null;
		selected: boolean;
		/** Plain wheel pans (wide layout) rather than scrolling the page. */
		wide: boolean;
		onselect: () => void;
		onstate: (id: string) => void;
		onedge: (index: number) => void;
	}

	let { path, machine, session, selected, wide, onselect, onstate, onedge }: Props = $props();

	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
	let layouts = $state.raw<MachineLayout[]>([]);
	let layoutError = $state<string | null>(null);
	let viewWidth = $state(0);
	let viewHeight = $state(0);
	$effect(() => {
		void machine;
		const m = untrack(() => machine);
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
		bestFit(layouts, { width: viewWidth || 400, height: viewHeight || 300 }) ?? null
	);

	const current = $derived(session?.current ?? []);
	const active = $derived(activeSet(machine, current));
	const leaves = $derived(new Set(current));
	const edgeState = $derived(
		new Map(
			(session?.enabled ?? []).map((e) => [
				e.index,
				e.ready
					? ('ready' as const)
					: e.due !== undefined && e.due > (session?.time ?? 0)
						? ('waiting' as const)
						: ('blocked' as const)
			])
		)
	);
	const lastEdge = $derived.by(() => {
		const last = session?.trace.at(-1);
		return last ? transitionOf(machine, last) : null;
	});
	const names = $derived(machine.transitions.map((t) => t.name ?? `${t.from} to ${t.to}`));
	const labelOf = (state: string) => machine.states.find((s) => s.name === state)?.label ?? state;
	const waiting = $derived(session?.queue?.length ?? 0);
	const tone = $derived(
		!session
			? 'muted'
			: session.status === 'running'
				? 'ok'
				: session.status === 'completed'
					? 'info'
					: 'warn'
	);
</script>

<section class="panel" class:selected aria-label="{path}: {machine.name}">
	<!-- On a phone the part's tab above names it and its state. -->
	<button
		type="button"
		class="panel-head"
		class:visually-hidden={!wide}
		aria-pressed={selected}
		onclick={onselect}
	>
		<Activity size={14} aria-hidden="true" />
		<span class="part">{path}</span>
		<span class="machine">{machine.name}</span>
		<span class="now" data-part-state={path}>{current.map(labelOf).join(' and ') || '—'}</span>
		{#if waiting}<span class="waiting" title="Signals waiting to be taken">{waiting} waiting</span
			>{/if}
		{#if session}<Pill {tone}>{statusText(session.status)}</Pill>{/if}
	</button>
	<div class="view">
		{#if layout}
			<MachineDiagram
				bind:width={viewWidth}
				bind:height={viewHeight}
				{layout}
				{names}
				{active}
				{leaves}
				exiting={null}
				arrived={null}
				{edgeState}
				shortcuts={new Map()}
				{lastEdge}
				highlight={new Set()}
				selectedState={null}
				selectedEdge={null}
				wheelPans={wide}
				minScale={0.5}
				focus={current[0] ?? null}
				description="{path} runs {machine.name}. Current: {current.map(labelOf).join(' and ') ||
					'none'}."
				{onstate}
				{onedge}
			/>
		{:else}
			<div class="placeholder" bind:clientWidth={viewWidth} bind:clientHeight={viewHeight}>
				<p>
					{layoutError
						? `The diagram could not be laid out: ${layoutError}`
						: `Drawing ${machine.name}…`}
				</p>
			</div>
		{/if}
	</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.panel.selected {
		border-color: var(--kind-behavior);
		box-shadow: 0 0 0 1px var(--kind-behavior);
	}
	.panel-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--space-2);
		min-height: 44px;
		padding: 6px var(--space-3);
		color: var(--text);
		background: var(--surface);
		border: 0;
		border-bottom: 1px solid var(--border);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.panel-head :global(svg) {
		flex: none;
		color: var(--kind-behavior);
	}
	.part {
		font-weight: 650;
	}
	.machine {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.now {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text-2);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.waiting {
		padding: 0 6px;
		color: var(--warn);
		background: var(--warn-weak);
		border-radius: var(--radius-pill);
		font-size: 11px;
	}
	.view {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.placeholder {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-2);
	}
</style>
