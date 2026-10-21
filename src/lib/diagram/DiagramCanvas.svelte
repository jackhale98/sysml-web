<script lang="ts">
	import {
		Background,
		Controls,
		Panel,
		SvelteFlow,
		type Edge,
		type Node,
		type NodeTypes,
		type EdgeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import { Pencil, Plus, Trash2 } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { DiagramGraph, DiagramView } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import { addElement, deleteElement, renameElement } from '#lib/workbench/actions.ts';
	import AddForm from '#lib/workbench/AddForm.svelte';
	import { canOwnMembers, type AddKind } from '#lib/workbench/templates.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { layout, nodeSize, type Direction } from './layout.ts';
	import SysmlEdge from './SysmlEdge.svelte';
	import SysmlNode from './SysmlNode.svelte';
	import type { SysmlEdgeData, SysmlNodeData } from './types.ts';

	let {
		view,
		scope,
		workspace,
		ui,
		engine,
		label
	}: {
		view: DiagramView;
		scope: string | null;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		label: string;
	} = $props();

	const nodeTypes: NodeTypes = { sysml: SysmlNode };
	const edgeTypes: EdgeTypes = { sysml: SysmlEdge };

	let nodes = $state.raw<Node<SysmlNodeData>[]>([]);
	let edges = $state.raw<Edge<SysmlEdgeData>[]>([]);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let message = $state('');
	let popover = $state<'add' | 'rename' | 'delete' | null>(null);
	let renameTo = $state('');
	let actionError = $state<string | null>(null);
	let fitNonce = $state(0);
	/** The diagram frame's name, as SysML writes it: "gv [Scope]". */
	let frameTitle = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;

	const selected: ModelElement | undefined = $derived(
		workspace.elements.find((e) => e.key === ui.selection?.key)
	);
	/** The element the diagram is about (its scope), when it is in the model. */
	const scopeElement = $derived(
		scope ? workspace.elements.find((e) => e.name === scope && e.isDefinition) : undefined
	);
	/** Where "Add" puts new elements: the selection if it can own them, else the scope. */
	const owner = $derived(
		selected && canOwnMembers(selected.kind, selected.isDefinition) ? selected : scopeElement
	);
	const ownerKinds: AddKind[] = $derived(
		owner?.kind === 'package'
			? ['part def', 'port def', 'item def', 'requirement', 'action def', 'state def', 'package']
			: ['part', 'port', 'attribute', 'action', 'requirement']
	);

	/** Node ids are names, or dotted paths (`drone.battery`) for nested usages. */
	const nameOf = (id: string) => id.slice(id.lastIndexOf('.') + 1);

	function elementFor(id: string): ModelElement | undefined {
		const name = nameOf(id);
		const usage = id.includes('.');
		return (
			workspace.elements.find((e) => e.name === name && e.isDefinition !== usage) ??
			workspace.elements.find((e) => e.name === name)
		);
	}

	/**
	 * Interconnection views read left to right. Trees go top-down unless a
	 * node has many children, which would make one very wide row.
	 */
	function directionFor(graph: DiagramGraph): Direction {
		if (view === 'interconnection') return 'RIGHT';
		const children: Record<string, number> = {};
		for (const e of graph.edges) {
			if (e.kind === 'composition' || e.kind === 'containment') {
				children[e.source] = (children[e.source] ?? 0) + 1;
			}
		}
		return Math.max(0, ...Object.values(children)) > 5 ? 'RIGHT' : 'DOWN';
	}

	async function refresh() {
		const current = ++generation;
		try {
			const graph = await engine.diagram(view, workspace.sourceFiles(), scope);
			if (current !== generation) return;
			const direction = directionFor(graph);
			const sameNodes =
				graph.nodes.length === nodes.length &&
				graph.nodes.every((n) => nodes.some((m) => m.id === n.id));
			const positions = new Map(nodes.map((n) => [n.id, n.position]));
			const placed = sameNodes
				? graph.nodes.map((node) => ({ node, x: 0, y: 0 }))
				: await layout(graph, direction, view);
			if (current !== generation) return;
			nodes = placed.map(({ node, x, y }) => ({
				id: node.id,
				type: 'sysml',
				position: (sameNodes && positions.get(node.id)) || { x, y },
				...nodeSize(node, view),
				data: { node, selected: nameOf(node.id) === selected?.name, direction, view },
				ariaLabel: `${node.stereotype ?? node.kind} ${node.label}`
			}));
			const ids = new Set(graph.nodes.map((n) => n.id));
			edges = graph.edges
				.filter((e) => ids.has(e.source) && ids.has(e.target))
				.map((e, i) => ({
					id: `${e.kind}:${e.source}:${e.target}:${i}`,
					source: e.source,
					target: e.target,
					type: 'sysml',
					data: { kind: e.kind, label: e.label }
				}));
			frameTitle = graph.title;
			status = 'ready';
			if (!sameNodes) fitNonce++;
		} catch (error) {
			if (current !== generation) return;
			status = 'error';
			message = error instanceof Error ? error.message : String(error);
		}
	}

	// Fit the drawing again when the pane changes size a lot (layout switch,
	// window resize), so it never sits tiny in a corner.
	let host: HTMLDivElement;
	$effect(() => {
		let width = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(([entry]) => {
			const next = entry?.contentRect.width ?? 0;
			if (width && Math.abs(next - width) / width > 0.2) {
				clearTimeout(timer);
				timer = setTimeout(() => fitNonce++, 120);
			}
			width = next;
		});
		observer.observe(host);
		return () => {
			observer.disconnect();
			clearTimeout(timer);
		};
	});

	// Redraw shortly after the model text changes.
	$effect(() => {
		void workspace.files;
		void view;
		void scope;
		const delay = untrack(() => nodes.length) ? 300 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
		return () => clearTimeout(timer);
	});

	// Reflect the selection without relaying out.
	$effect(() => {
		const name = selected?.name;
		const current = untrack(() => nodes);
		const isSelected = (id: string) => nameOf(id) === name;
		if (current.every((n) => n.data.selected === isSelected(n.id))) return;
		nodes = current.map((n) =>
			n.data.selected === isSelected(n.id)
				? n
				: { ...n, data: { ...n.data, selected: isSelected(n.id) } }
		);
	});

	async function act(run: () => Promise<string | null>) {
		actionError = await run();
		if (!actionError) popover = null;
	}

	function openRename() {
		renameTo = selected?.label ?? '';
		actionError = null;
		popover = popover === 'rename' ? null : 'rename';
	}
</script>

<div class="canvas" aria-label={label} role="region" bind:this={host}>
	<svg class="markers" aria-hidden="true">
		<defs>
			<marker
				id="sysml-specialization"
				viewBox="0 0 12 12"
				refX="11"
				refY="6"
				markerWidth="14"
				markerHeight="14"
				orient="auto-start-reverse"
			>
				<path
					d="M1 1 L11 6 L1 11 Z"
					fill="var(--surface)"
					stroke="var(--text-2)"
					stroke-width="1.2"
				/>
			</marker>
			<marker
				id="sysml-composition"
				viewBox="0 0 16 10"
				refX="15"
				refY="5"
				markerWidth="16"
				markerHeight="10"
				orient="auto-start-reverse"
			>
				<path d="M1 5 L8 1 L15 5 L8 9 Z" fill="var(--text-2)" />
			</marker>
			<marker
				id="sysml-membership"
				viewBox="0 0 14 14"
				refX="12.6"
				refY="7"
				markerWidth="14"
				markerHeight="14"
				orient="auto-start-reverse"
			>
				<circle
					cx="7"
					cy="7"
					r="5.6"
					fill="var(--surface)"
					stroke="var(--text-2)"
					stroke-width="1.2"
				/>
				<path d="M7 3.6 V10.4 M3.6 7 H10.4" stroke="var(--text-2)" stroke-width="1.2" />
			</marker>
			<marker
				id="sysml-open-arrow"
				viewBox="0 0 12 12"
				refX="11"
				refY="6"
				markerWidth="12"
				markerHeight="12"
				orient="auto-start-reverse"
			>
				<path d="M1 1 L11 6 L1 11" fill="none" stroke="var(--text-2)" stroke-width="1.3" />
			</marker>
			<marker
				id="sysml-arrow"
				viewBox="0 0 12 12"
				refX="11"
				refY="6"
				markerWidth="11"
				markerHeight="11"
				orient="auto-start-reverse"
			>
				<path d="M1 1 L11 6 L1 11 Z" fill="var(--text-2)" />
			</marker>
		</defs>
	</svg>

	{#if status === 'error'}
		<p class="state" role="alert">This view could not be drawn: {message}</p>
	{:else if status === 'ready' && nodes.length === 0}
		<p class="state">Nothing to show in this view yet. Add an element to get started.</p>
	{/if}

	{#key fitNonce}
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			{edgeTypes}
			fitView
			fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
			minZoom={0.15}
			colorMode={theme.choice}
			nodesConnectable={false}
			onnodeclick={({ node }) => {
				const element = elementFor(node.id);
				if (element) ui.select(element.key, 'diagram');
			}}
			onpaneclick={() => (popover = null)}
		>
			<Background gap={20} />
			<Controls showLock={false} />
			{#if frameTitle}
				<Panel position="top-left">
					<p class="frame" title="Diagram frame">{frameTitle}</p>
				</Panel>
			{/if}
			<Panel position="top-right">
				<div class="toolbar" role="toolbar" aria-label="Diagram tools">
					<button
						type="button"
						onclick={() => {
							actionError = null;
							popover = popover === 'add' ? null : 'add';
						}}
						disabled={!owner}
						aria-expanded={popover === 'add'}
						title={owner ? `Add to ${owner.label}` : 'Select a package or definition first'}
					>
						<Plus size={15} /> <span>Add</span>
					</button>
					<button
						type="button"
						onclick={openRename}
						disabled={!selected}
						aria-expanded={popover === 'rename'}
					>
						<Pencil size={14} /> <span>Rename</span>
					</button>
					<button
						type="button"
						onclick={() => {
							actionError = null;
							popover = popover === 'delete' ? null : 'delete';
						}}
						disabled={!selected}
						aria-expanded={popover === 'delete'}
					>
						<Trash2 size={14} /> <span>Delete</span>
					</button>
				</div>
				{#if popover === 'add' && owner}
					<div class="popover">
						<AddForm
							ownerLabel={owner.label}
							kinds={ownerKinds}
							onadd={async (kind, name, type) => {
								const error = await addElement(workspace, owner, kind, name, type);
								if (!error) popover = null;
								return error;
							}}
							oncancel={() => (popover = null)}
						/>
					</div>
				{:else if popover === 'rename' && selected}
					<form
						class="popover small"
						onsubmit={(e) => {
							e.preventDefault();
							void act(() => renameElement(workspace, selected, renameTo));
						}}
					>
						<label>
							<span>Rename {selected.label}</span>
							<!-- svelte-ignore a11y_autofocus -->
							<input bind:value={renameTo} autofocus />
						</label>
						<p class="hint">References in every file are updated.</p>
						{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
						<button type="submit" class="primary">Rename</button>
					</form>
				{:else if popover === 'delete' && selected}
					<div class="popover small" role="dialog" aria-label="Delete {selected.label}">
						<p>Delete <strong>{selected.label}</strong> from <code>{selected.file}</code>?</p>
						<p class="hint">References to it elsewhere will show as problems.</p>
						{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
						<button
							type="button"
							class="danger"
							onclick={() => act(() => deleteElement(workspace, selected))}
						>
							Delete
						</button>
					</div>
				{/if}
			</Panel>
		</SvelteFlow>
	{/key}
</div>

<style>
	.canvas {
		container-type: size;
		position: relative;
		height: 100%;
		min-height: 18rem;
		background: var(--bg);
	}
	.markers {
		position: absolute;
		width: 0;
		height: 0;
	}
	.state {
		position: absolute;
		inset: 40% 0 auto;
		z-index: 4;
		text-align: center;
		color: var(--text-2);
		pointer-events: none;
	}
	.toolbar {
		display: flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font-weight: 520;
		cursor: pointer;
	}
	.toolbar button:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	@container (max-width: 34rem) {
		.toolbar button span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.toolbar button {
			padding: 0 var(--space-2);
		}
	}
	.toolbar button:disabled {
		color: var(--text-3);
		cursor: default;
	}
	.popover {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-2);
	}
	/* The SysML diagram frame label: name in a box with a cut corner. */
	.frame {
		margin: 0;
		padding: 3px 18px 4px 10px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		clip-path: polygon(0 0, 100% 0, 100% 55%, calc(100% - 10px) 100%, 0 100%);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.popover.small {
		display: grid;
		gap: var(--space-2);
		width: min(18rem, 80vw);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}
	.popover label {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.popover input {
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.error {
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.popover button {
		justify-self: end;
		height: 2.125rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		font-weight: 560;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		color: var(--accent-text);
	}
	.danger {
		background: var(--danger);
		color: #fff;
	}
	.canvas :global(.svelte-flow) {
		--xy-background-color: var(--bg);
		--xy-background-pattern-color: var(--border);
		--xy-controls-button-background-color: var(--surface);
		--xy-controls-button-color: var(--text-2);
		--xy-controls-button-border-color: var(--border);
		--xy-node-border-radius: 0;
	}
	.canvas :global(.svelte-flow__attribution) {
		background: transparent;
	}
	.canvas :global(.svelte-flow__attribution a) {
		color: var(--text-3);
	}
	.canvas :global(.svelte-flow__node-sysml) {
		padding: 0;
		border: 0;
		background: transparent;
	}
</style>
