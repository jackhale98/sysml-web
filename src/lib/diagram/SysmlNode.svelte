<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { iconOf } from '#lib/ui/kinds.ts';
	import { MARK_WORDS } from '#lib/review/marks.svelte.ts';
	import { useEditing } from './editing.svelte.ts';
	import { MAX_ROWS, notationOf } from './notation.ts';
	import type { SysmlNodeData } from './types.ts';

	let { id, data }: { id: string; data: SysmlNodeData } = $props();

	const node = $derived(data.node);
	const n = $derived(notationOf(node, data.view));
	const Icon = $derived(iconOf(n.base.replace(/ /g, '_')));
	const vertical = $derived(data.direction === 'DOWN');
	const left = $derived(n.ports.filter((p) => p.side === 'left'));
	const right = $derived(n.ports.filter((p) => p.side === 'right'));

	const editing = useEditing();
	const renaming = $derived(editing?.renaming === id);
	const editable = $derived(!!editing && data.editable);
	let draft = $state('');
	let saving = false;

	function startRename(event: MouseEvent) {
		if (!editable || !editing) return;
		event.stopPropagation();
		editing.startRename(id);
	}

	function focusInput(input: HTMLInputElement) {
		draft = data.name ?? node.label;
		input.focus();
		input.select();
	}

	async function save() {
		if (!editing || saving) return;
		if (draft.trim() === (data.name ?? node.label)) {
			editing.cancelRename();
			return;
		}
		saving = true;
		await editing.commitRename(id, draft);
		saving = false;
	}

	function onkeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			void save();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			editing?.cancelRename();
			// Back to the node, so the keyboard keeps its place.
			(event.currentTarget as HTMLElement).closest<HTMLElement>('.svelte-flow__node')?.focus();
		}
	}
</script>

<!-- Edge anchors first: edges without a handle id attach to the first ones. -->
<Handle
	type="target"
	position={vertical ? Position.Top : Position.Left}
	class="handle"
	isConnectable={false}
/>
<Handle
	type="source"
	position={vertical ? Position.Bottom : Position.Right}
	class="handle"
	isConnectable={false}
/>
<div
	class="node"
	style:--fam="var(--kind-{n.family})"
	class:selected={data.selected}
	class:linked={!!editing?.linked.has(id)}
	class:source={editing?.connectingFrom === id}
	class:pickable={!!editing?.connectingFrom && editing.connectingFrom !== id}
	class:review-added={data.review === 'added'}
	class:review-changed={data.review === 'changed'}
>
	{#if data.review}
		<span class="review-badge {data.review}" aria-hidden="true"
			>{MARK_WORDS[data.review].badge}</span
		>
	{/if}
	{#if n.shape === 'port'}
		<div class="port-node" title="port {node.label}"></div>
		<span class="port-label">{node.label}</span>
	{:else if n.shape === 'initial'}
		<div class="pseudo initial" title="initial state"></div>
	{:else if n.shape === 'final'}
		<div class="pseudo final" title="final state"></div>
	{:else if n.shape === 'decision'}
		<div class="decision" title="decision {node.label}"></div>
	{:else if n.shape === 'bar'}
		<div class="bar" title="{node.kind} {node.label}"></div>
	{:else}
		{#if n.shape === 'package'}<div class="tab" aria-hidden="true"></div>{/if}
		<div
			class="box"
			class:definition={n.isDefinition || n.shape === 'package'}
			class:usage={!n.isDefinition && n.shape !== 'package'}
			class:package={n.shape === 'package'}
		>
			<div class="head">
				<span class="keyword">
					<Icon size={12} strokeWidth={2.25} aria-hidden="true" />
					«{n.isAbstract ? 'abstract ' : ''}{n.keyword}»
				</span>
				{#if renaming}
					<input
						class="name-input nodrag nopan nowheel"
						aria-label="New name for {data.name ?? node.label}"
						bind:value={draft}
						{@attach focusInput}
						{onkeydown}
						onblur={() => void save()}
						ondblclick={(e) => e.stopPropagation()}
					/>
					{#if editing?.renameError}
						<span class="rename-error" role="alert">{editing.renameError}</span>
					{/if}
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="name"
						class:abstract={n.isAbstract}
						title={editable ? 'Double-click to rename' : undefined}
						ondblclick={startRename}>{node.label}</span
					>
				{/if}
			</div>
			{#if n.doc}
				<div class="compartment doc"><p>{n.doc}</p></div>
			{/if}
			{#each n.compartments as c (c.title)}
				<div class="compartment">
					<div class="title">{c.title}</div>
					<ul>
						{#each c.rows.slice(0, MAX_ROWS) as row, i (i)}
							<li>{row}</li>
						{/each}
						{#if c.rows.length > MAX_ROWS}
							<li class="more">+{c.rows.length - MAX_ROWS} more</li>
						{/if}
					</ul>
				</div>
			{/each}
			{#if n.ports.length}
				<div class="ports">
					<!-- Each port's square anchors the lines that connect it. -->
					<ul class="side left">
						{#each left as p, i (i)}<li>
								{p.label}<Handle
									type="target"
									id="port:{p.key}"
									position={Position.Left}
									class="port-handle"
									isConnectable={false}
								/><Handle
									type="source"
									id="port:{p.key}"
									position={Position.Left}
									class="port-handle"
									isConnectable={false}
								/>
							</li>{/each}
					</ul>
					<ul class="side right">
						{#each right as p, i (i)}<li>
								{p.label}<Handle
									type="target"
									id="port:{p.key}"
									position={Position.Right}
									class="port-handle"
									isConnectable={false}
								/><Handle
									type="source"
									id="port:{p.key}"
									position={Position.Right}
									class="port-handle"
									isConnectable={false}
								/>
							</li>{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>
{#if editable}
	<!-- Drag from any of these onto another node to draw a relationship. -->
	{#each [Position.Top, Position.Right, Position.Bottom, Position.Left] as side (side)}
		<Handle type="source" id="connect-{side}" position={side} class="connect" />
	{/each}
{/if}

<style>
	.node {
		--line: color-mix(in oklab, var(--fam) 55%, var(--text-2));
		--tint: color-mix(in oklab, var(--fam) 11%, var(--surface));
		position: relative;
		width: 100%;
		height: 100%;
		color: var(--text);
	}

	/* Boxes. SysML v2: definitions have square corners, usages rounded ones. */
	.box {
		--radius: 2px;
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--surface);
		border: 1.5px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow-sm);
		transition:
			box-shadow var(--duration) var(--ease),
			border-color var(--duration) var(--ease);
	}
	.usage {
		--radius: 14px;
	}
	.node:hover .box {
		box-shadow: var(--shadow-md);
	}
	/* Connected to the selected node. */
	.linked .box,
	.linked .port-node,
	.linked .pseudo,
	.linked .decision {
		border-color: var(--accent);
		outline: 2px solid color-mix(in oklab, var(--accent) 35%, transparent);
		outline-offset: 2px;
	}
	.selected .box,
	.selected .port-node,
	.selected .pseudo,
	.selected .decision {
		border-color: var(--accent);
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		box-shadow: var(--shadow-md);
	}
	/* Review mode: a ring and a badge (the badge says it; the colour only repeats it). */
	.review-added {
		--review: var(--ok);
	}
	.review-changed {
		--review: var(--warn);
	}
	.review-added .box,
	.review-changed .box,
	.review-added .port-node,
	.review-changed .port-node {
		box-shadow:
			0 0 0 3px color-mix(in oklab, var(--review) 55%, transparent),
			var(--shadow-sm);
	}
	.review-added .box,
	.review-changed .box {
		border-color: var(--review);
	}
	.review-badge {
		position: absolute;
		z-index: 2;
		top: -9px;
		right: 8px;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--review);
		color: var(--surface);
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.04em;
		line-height: 16px;
		text-transform: uppercase;
		pointer-events: none;
	}
	.head {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 2px;
		height: 50px;
		flex: none;
		padding: 0 12px;
		background: var(--tint);
		border-radius: calc(var(--radius) - 1.5px) calc(var(--radius) - 1.5px) 0 0;
		text-align: center;
	}
	.box:not(:has(.compartment, .ports)) .head {
		height: 100%;
		border-radius: calc(var(--radius) - 1.5px);
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
		color: var(--fam);
		flex: none;
	}
	.name {
		max-width: 100%;
		overflow: hidden;
		font-weight: 650;
		font-size: 13px;
		line-height: 17px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.abstract {
		font-style: italic;
	}

	/* Compartments: named, separated by a rule, as in the standard. */
	.compartment {
		padding: 6px 12px 6px;
		border-top: 1px solid var(--line);
		min-height: 0;
	}
	.title {
		height: 16px;
		color: var(--text-3);
		font-size: 11px;
		line-height: 16px;
		font-style: italic;
		text-align: center;
	}
	.compartment ul,
	.side {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.compartment li,
	.side li {
		height: 18px;
		overflow: hidden;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 18px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	li.more {
		color: var(--text-3);
		font-family: var(--font-ui);
		font-size: 11px;
	}
	.doc p {
		display: -webkit-box;
		margin: 0;
		overflow: hidden;
		color: var(--text-2);
		font-size: 11.5px;
		line-height: 17px;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}

	/* Ports on the boundary (interconnection view). */
	.ports {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0 8px;
		padding: 6px 0;
		border-top: 1px solid var(--line);
	}
	.side {
		min-width: 0;
	}
	.side li {
		position: relative;
		overflow: visible;
	}
	.side.left li {
		padding-left: 12px;
	}
	.side.right {
		margin-left: auto;
	}
	.side.right li {
		padding-right: 12px;
		text-align: right;
	}
	.side li::before {
		content: '';
		position: absolute;
		top: 4px;
		width: 10px;
		height: 10px;
		background: var(--surface);
		border: 1.5px solid var(--line);
	}
	.side.left li::before {
		left: -6.5px;
	}
	.side.right li::before {
		right: -6.5px;
	}
	/* A line ends on the outer side of the port's square, at its middle. */
	.side li :global(.port-handle) {
		position: absolute;
		top: 9px;
		width: 0;
		min-width: 0;
		height: 0;
		min-height: 0;
		background: none;
		border: 0;
		transform: none;
		pointer-events: none;
	}
	.side.left li :global(.port-handle) {
		right: auto;
		left: -6.5px;
	}
	.side.right li :global(.port-handle) {
		right: -6.5px;
		left: auto;
	}

	/* Package: a folder with a tab. */
	.package {
		height: calc(100% - 16px);
		margin-top: 16px;
		border-top-left-radius: 0;
	}
	.package .head {
		border-top-left-radius: 0;
	}
	.tab {
		position: absolute;
		top: 1px;
		left: 0;
		width: min(45%, 88px);
		height: 16.5px;
		background: color-mix(in oklab, var(--fam) 22%, var(--surface));
		border: 1.5px solid var(--line);
		border-bottom: 0;
		border-radius: 2px 2px 0 0;
	}

	/* Ports drawn as their own nodes: a small square, label alongside. */
	.port-node {
		width: 100%;
		height: 100%;
		background: var(--surface);
		border: 1.5px solid var(--line);
	}
	.port-label {
		position: absolute;
		top: calc(100% + 3px);
		left: 50%;
		translate: -50% 0;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 11px;
		white-space: nowrap;
	}

	/* Behaviour pseudo-nodes. */
	.pseudo {
		width: 100%;
		height: 100%;
		border-radius: 50%;
	}
	.initial {
		background: var(--text);
	}
	.final {
		border: 2px solid var(--text);
		background: radial-gradient(circle, var(--text) 0 45%, var(--surface) 47%);
	}
	.decision {
		width: 70.7%;
		height: 70.7%;
		margin: 14.65%;
		rotate: 45deg;
		background: var(--surface);
		border: 1.5px solid var(--line);
	}
	.bar {
		width: 100%;
		height: 100%;
		border-radius: 1px;
		background: var(--text);
	}

	:global(.svelte-flow .handle) {
		opacity: 0;
		width: 6px;
		height: 6px;
		min-width: 0;
		min-height: 0;
		border: 0;
	}
	/* Inline rename. */
	.name-input {
		width: 100%;
		min-width: 0;
		height: 22px;
		padding: 0 6px;
		border: 1.5px solid var(--accent);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 650;
		font-size: 13px;
		text-align: center;
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent);
	}
	.rename-error {
		position: absolute;
		top: calc(100% + 6px);
		left: 50%;
		z-index: 2;
		translate: -50% 0;
		width: max-content;
		max-width: 260px;
		padding: 4px 8px;
		border-radius: 6px;
		background: var(--danger);
		color: #fff;
		font-size: 11.5px;
		line-height: 16px;
		white-space: normal;
	}

	/* Connecting: the source glows, possible targets answer the pointer. */
	.source .box,
	.source .port-node,
	.source .pseudo,
	.source .decision {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		animation: pulse 1.4s var(--ease) infinite;
	}
	.pickable {
		cursor: crosshair;
	}
	.pickable:hover .box,
	:global(.svelte-flow.connecting) .node:hover .box {
		outline: 2px dashed var(--accent);
		outline-offset: 3px;
		box-shadow: var(--shadow-md);
	}
	@keyframes pulse {
		50% {
			outline-color: color-mix(in oklab, var(--accent) 35%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.source .box,
		.source .port-node,
		.source .pseudo,
		.source .decision {
			animation: none;
		}
	}

	/* Connection handles: hidden until the node is hovered, focused or selected. */
	:global(.svelte-flow .svelte-flow__handle.connect) {
		width: 12px;
		height: 12px;
		min-width: 0;
		min-height: 0;
		border: 2px solid var(--surface);
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
		opacity: 0;
		scale: 0.6;
		cursor: crosshair;
		transition:
			opacity var(--duration) var(--ease),
			scale var(--duration) var(--ease);
	}
	/* A larger, invisible hit area, kinder to fingers. */
	:global(.svelte-flow .svelte-flow__handle.connect::after) {
		content: '';
		position: absolute;
		inset: -10px;
		border-radius: 50%;
	}
	:global(.svelte-flow__node:hover .svelte-flow__handle.connect),
	:global(.svelte-flow__node:focus-visible .svelte-flow__handle.connect),
	:global(.svelte-flow__node.selected .svelte-flow__handle.connect),
	:global(.svelte-flow .svelte-flow__handle.connect.connectingfrom) {
		opacity: 1;
		scale: 1;
	}
	:global(.svelte-flow .svelte-flow__handle.connect:hover) {
		scale: 1.25;
	}
	:global(.svelte-flow.connecting .svelte-flow__handle.connect:not(.connectingfrom)) {
		opacity: 0;
	}
</style>
