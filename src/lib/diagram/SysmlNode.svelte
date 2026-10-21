<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { SysmlNodeData } from './types.ts';

	let { data }: { data: SysmlNodeData } = $props();

	const node = $derived(data.node);
	const stereotype = $derived(
		node.stereotype?.replace(/^<<|>>$/g, '').trim() ??
			(node.is_definition ? `${node.kind} def` : node.kind)
	);
	const vertical = $derived(data.direction === 'DOWN');
	const rows = $derived(node.attributes.slice(0, 8));
</script>

<Handle type="target" position={vertical ? Position.Top : Position.Left} class="handle" />
{#if node.kind === 'port'}
	<div class="port" title="port {node.label}" class:selected={data.selected}></div>
{:else}
	<div
		class="box {node.kind}"
		class:definition={node.is_definition}
		class:usage={!node.is_definition}
		class:selected={data.selected}
	>
		<div class="head">
			<span class="stereotype">«{stereotype}»</span>
			<span class="name">{node.label}</span>
		</div>
		{#if rows.length}
			<ul class="compartment">
				{#each rows as [keyword, text], i (i)}
					<li><span class="kw">{keyword}</span> {text}</li>
				{/each}
				{#if node.attributes.length > rows.length}
					<li class="more">+{node.attributes.length - rows.length} more</li>
				{/if}
			</ul>
		{/if}
	</div>
{/if}
<Handle type="source" position={vertical ? Position.Bottom : Position.Right} class="handle" />

<style>
	.box {
		min-width: 132px;
		height: 100%;
		background: var(--surface);
		border: 1.5px solid var(--node-border, var(--text-2));
		color: var(--text);
		font-size: 12.5px;
		box-shadow: var(--shadow-sm);
		transition:
			box-shadow var(--duration) var(--ease),
			border-color var(--duration) var(--ease);
	}
	/* SysML v2 notation: definitions have square corners, usages rounded. */
	.definition {
		border-radius: 2px;
	}
	.usage {
		border-radius: 12px;
	}
	.requirement {
		--node-border: var(--syntax-attribute);
	}
	.package {
		border-style: solid;
		background: var(--surface-2);
	}
	.selected {
		border-color: var(--accent);
		box-shadow:
			0 0 0 3px var(--accent-weak),
			var(--shadow-md);
	}
	.head {
		display: grid;
		justify-items: center;
		gap: 1px;
		padding: 7px 12px 8px;
		text-align: center;
	}
	.stereotype {
		color: var(--text-3);
		font-size: 11px;
	}
	.name {
		font-weight: 650;
		font-size: 13px;
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.compartment {
		list-style: none;
		margin: 0;
		padding: 6px 12px 8px;
		border-top: 1px solid var(--border-strong);
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 19px;
		color: var(--text-2);
	}
	.compartment li {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kw {
		color: var(--syntax-keyword);
	}
	.more {
		color: var(--text-3);
		font-family: var(--font-ui);
	}
	.port {
		width: 22px;
		height: 22px;
		background: var(--surface);
		border: 1.5px solid var(--text-2);
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
