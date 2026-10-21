<script lang="ts">
	import {
		Box,
		Boxes,
		ChevronRight,
		CircleDot,
		FileCode,
		Folder,
		LayoutDashboard,
		ListChecks,
		Network,
		Package,
		Search,
		Workflow
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { TreeNode } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	let mode = $state<'model' | 'files'>('model');
	let query = $state('');
	let expanded = $state<Record<string, boolean>>({});
	let librariesOpen = $state(false);
	const ready = $derived(workspace.state.phase === 'ready');

	const userRoots = $derived(workspace.tree.filter((n) => !isLibraryFile(n.element.file)));
	const libraryRoots = $derived(workspace.tree.filter((n) => isLibraryFile(n.element.file)));
	const packages = $derived(userRoots.filter((n) => n.element.kind === 'package'));

	const needle = $derived(query.trim().toLowerCase());
	function matches(node: TreeNode): boolean {
		if (!needle) return true;
		const e = node.element;
		return (
			e.label.toLowerCase().includes(needle) ||
			(e.shortName?.toLowerCase().includes(needle) ?? false) ||
			node.children.some(matches)
		);
	}

	function isOpen(node: TreeNode, depth: number): boolean {
		return needle ? true : (expanded[node.element.key] ?? depth < 1);
	}

	function iconFor(node: TreeNode): Component {
		const e = node.element;
		if (e.kind === 'package') return Package;
		if (e.kind === 'requirement') return ListChecks;
		if (e.kind === 'port') return CircleDot;
		if (e.kind === 'action' || e.kind === 'state') return Workflow;
		return e.isDefinition ? Boxes : Box;
	}

	const folders = $derived.by(() => {
		const byFolder: Record<string, string[]> = {};
		for (const path of workspace.modelPaths) {
			const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			(byFolder[folder] ??= []).push(path);
		}
		return Object.entries(byFolder);
	});
</script>

{#snippet tree(nodes: TreeNode[], depth: number)}
	<ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Model' : undefined}>
		{#each nodes.filter(matches) as node (node.element.key)}
			{@const Icon = iconFor(node)}
			{@const open = isOpen(node, depth)}
			{@const hasChildren = node.children.length > 0}
			<li
				role="treeitem"
				aria-expanded={hasChildren ? open : undefined}
				aria-selected={ui.selection?.key === node.element.key}
			>
				<div class="row" style:padding-left="{0.375 + depth * 0.875}rem">
					{#if hasChildren}
						<button
							type="button"
							class="twisty"
							class:open
							aria-label="{open ? 'Collapse' : 'Expand'} {node.element.label}"
							onclick={() => (expanded[node.element.key] = !open)}
						>
							<ChevronRight size={14} />
						</button>
					{:else}
						<span class="twisty" aria-hidden="true"></span>
					{/if}
					<button
						type="button"
						class="item"
						class:selected={ui.selection?.key === node.element.key}
						onclick={() => ui.select(node.element.key, 'explorer')}
						ondblclick={() => ui.open({ kind: 'file', path: node.element.file })}
						title="{node.element.isDefinition
							? `${node.element.kind} def`
							: node.element.kind} {node.element.label}"
					>
						<Icon size={14} />
						{#if node.element.shortName}<span class="id">{node.element.shortName}</span>{/if}
						<span class="label">{node.element.label}</span>
					</button>
				</div>
				{#if hasChildren && open}
					{@render tree(node.children, depth + 1)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<nav class="explorer" aria-label="Explorer">
	<div class="tabs" role="tablist" aria-label="Explorer mode">
		<button role="tab" aria-selected={mode === 'model'} onclick={() => (mode = 'model')}
			>Model</button
		>
		<button role="tab" aria-selected={mode === 'files'} onclick={() => (mode = 'files')}
			>Files</button
		>
	</div>

	{#if mode === 'model'}
		<label class="search">
			<Search size={14} />
			<span class="visually-hidden">Filter the model</span>
			<input type="search" placeholder="Filter elements" bind:value={query} />
		</label>
		{#if !ready}
			<p class="empty">Reading the model…</p>
		{:else}
			<section aria-labelledby="views-heading">
				<h2 id="views-heading">Views</h2>
				<ul class="flat">
					<li>
						<button type="button" class="item" onclick={() => ui.open({ kind: 'home' })}>
							<LayoutDashboard size={14} /> <span class="label">Overview</span>
						</button>
					</li>
					<li>
						<button type="button" class="item" onclick={() => ui.open({ kind: 'requirements' })}>
							<ListChecks size={14} /> <span class="label">Requirements</span>
							<span class="count">{workspace.requirements.length}</span>
						</button>
					</li>
					{#each packages as p (p.element.key)}
						<li>
							<button
								type="button"
								class="item"
								onclick={() =>
									ui.open({
										kind: 'diagram',
										view: 'general',
										scope: p.element.name,
										title: p.element.label
									})}
							>
								<Network size={14} /> <span class="label">{p.element.label}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
			<section aria-labelledby="model-heading">
				<h2 id="model-heading">Model</h2>
				{@render tree(userRoots, 0)}
			</section>
			{#if libraryRoots.length}
				<details class="libraries" bind:open={librariesOpen}>
					<summary>Libraries</summary>
					{#if librariesOpen}{@render tree(libraryRoots, 0)}{/if}
				</details>
			{/if}
		{/if}
	{:else}
		<ul class="flat files">
			{#each folders as [folder, paths] (folder)}
				{#if folder}
					<li class="folder"><Folder size={14} /> {folder}</li>
				{/if}
				{#each paths as path (path)}
					<li>
						<button
							type="button"
							class="item"
							style:padding-left={folder ? '1.5rem' : undefined}
							onclick={() => ui.open({ kind: 'file', path })}
						>
							<FileCode size={14} />
							<span class="label">{path.slice(folder ? folder.length + 1 : 0)}</span>
							{#if workspace.dirty.has(path)}<span class="dot" title="Edited"></span>{/if}
						</button>
					</li>
				{/each}
			{/each}
		</ul>
	{/if}
</nav>

<style>
	.explorer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: 100%;
		overflow-y: auto;
		padding: var(--space-2);
		font-size: var(--text-sm);
	}
	.tabs {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.tabs button {
		flex: 1;
		height: 1.875rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-2);
		font-weight: 550;
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.search {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-3);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
	}
	h2 {
		margin: var(--space-2) var(--space-2) var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
	}
	.twisty {
		display: grid;
		place-items: center;
		flex: none;
		width: 1.5rem;
		height: 1.75rem;
		border: 0;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
		transition: transform var(--duration) var(--ease);
	}
	.twisty.open {
		transform: rotate(90deg);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		min-height: 1.875rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.item.selected {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.count {
		min-width: 1.5rem;
		text-align: right;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		padding: var(--space-2);
		color: var(--text-3);
	}
	.libraries summary {
		margin: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.folder {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-1);
		color: var(--text-3);
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--warn);
	}
	@media (pointer: coarse) {
		.item,
		.twisty {
			min-height: 2.75rem;
		}
	}
</style>
