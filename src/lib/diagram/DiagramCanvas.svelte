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
	import type { DiagramView } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import { addElement, deleteElement, renameElement } from '#lib/workbench/actions.ts';
	import AddForm from '#lib/workbench/AddForm.svelte';
	import { canOwnMembers, type AddKind } from '#lib/workbench/templates.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { layout, type Direction } from './layout.ts';
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
	const direction: Direction = $derived(view === 'interconnection' ? 'RIGHT' : 'DOWN');

	let nodes = $state.raw<Node<SysmlNodeData>[]>([]);
	let edges = $state.raw<Edge<SysmlEdgeData>[]>([]);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let message = $state('');
	let popover = $state<'add' | 'rename' | 'delete' | null>(null);
	let renameTo = $state('');
	let actionError = $state<string | null>(null);
	let fitNonce = $state(0);
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

	function elementFor(id: string): ModelElement | undefined {
		return (
			workspace.elements.find((e) => e.name === id && e.isDefinition) ??
			workspace.elements.find((e) => e.name === id)
		);
	}

	async function refresh() {
		const current = ++generation;
		try {
			const graph = await engine.diagram(view, workspace.sourceFiles(), scope);
			if (current !== generation) return;
			const sameNodes =
				graph.nodes.length === nodes.length &&
				graph.nodes.every((n) => nodes.some((m) => m.id === n.id));
			const positions = new Map(nodes.map((n) => [n.id, n.position]));
			const placed = sameNodes
				? graph.nodes.map((node) => ({ node, x: 0, y: 0 }))
				: await layout(graph, direction);
			if (current !== generation) return;
			nodes = placed.map(({ node, x, y }) => ({
				id: node.id,
				type: 'sysml',
				position: (sameNodes && positions.get(node.id)) || { x, y },
				data: { node, selected: node.id === selected?.name, direction },
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
			status = 'ready';
			if (!sameNodes) fitNonce++;
		} catch (error) {
			if (current !== generation) return;
			status = 'error';
			message = error instanceof Error ? error.message : String(error);
		}
	}

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
		if (current.every((n) => n.data.selected === (n.id === name))) return;
		nodes = current.map((n) =>
			n.data.selected === (n.id === name)
				? n
				: { ...n, data: { ...n.data, selected: n.id === name } }
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

<div class="canvas" aria-label={label} role="region">
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
				refX="1"
				refY="5"
				markerWidth="16"
				markerHeight="10"
				orient="auto-start-reverse"
			>
				<path d="M1 5 L8 1 L15 5 L8 9 Z" fill="var(--text-2)" />
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
			proOptions={{ hideAttribution: true }}
			onnodeclick={({ node }) => {
				const element = elementFor(node.id);
				if (element) ui.select(element.key, 'diagram');
			}}
			onpaneclick={() => (popover = null)}
		>
			<Background gap={20} />
			<Controls showLock={false} />
			<Panel position="top-left">
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
						<Plus size={15} /> Add
					</button>
					<button
						type="button"
						onclick={openRename}
						disabled={!selected}
						aria-expanded={popover === 'rename'}
					>
						<Pencil size={14} /> Rename
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
						<Trash2 size={14} /> Delete
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
	.toolbar button:disabled {
		color: var(--text-3);
		cursor: default;
	}
	.popover {
		margin-top: var(--space-2);
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
	.canvas :global(.svelte-flow__node-sysml) {
		padding: 0;
		border: 0;
		background: transparent;
	}
</style>
