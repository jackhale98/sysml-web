<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { iconOf } from '#lib/ui/kinds.ts';
	import { MAX_ROWS, notationOf } from './notation.ts';
	import type { SysmlNodeData } from './types.ts';

	let { data }: { data: SysmlNodeData } = $props();

	const node = $derived(data.node);
	const n = $derived(notationOf(node, data.view));
	const Icon = $derived(iconOf(n.base.replace(/ /g, '_')));
	const vertical = $derived(data.direction === 'DOWN');
	const left = $derived(n.ports.filter((p) => p.side === 'left'));
	const right = $derived(n.ports.filter((p) => p.side === 'right'));
</script>

<Handle type="target" position={vertical ? Position.Top : Position.Left} class="handle" />
<div class="node" style:--fam="var(--kind-{n.family})" class:selected={data.selected}>
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
				<span class="name" class:abstract={n.isAbstract}>{node.label}</span>
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
					<ul class="side left">
						{#each left as p, i (i)}<li>{p.label}</li>{/each}
					</ul>
					<ul class="side right">
						{#each right as p, i (i)}<li>{p.label}</li>{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>
<Handle type="source" position={vertical ? Position.Bottom : Position.Right} class="handle" />

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
	.selected .box,
	.selected .port-node,
	.selected .pseudo,
	.selected .decision {
		border-color: var(--accent);
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		box-shadow: var(--shadow-md);
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
		justify-content: space-between;
		gap: 8px;
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
</style>
