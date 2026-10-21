<!--
	The overview's illustration: one element of this project as SysML text and
	as the block it draws, side by side, to say "the text and the diagram are
	the same model". Decorative (aria-hidden); the same facts are in the explorer.
-->
<script lang="ts">
	import { ArrowLeftRight } from '@lucide/svelte';
	import type { TreeNode } from '#lib/project/elements.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { multiplicityText } from './model.ts';

	let { node, ready }: { node: TreeNode | null; ready: boolean } = $props();

	interface Line {
		name: string;
		type: string;
		multiplicity: string;
	}

	const SAMPLE = {
		keyword: 'part def',
		name: 'Vehicle',
		type: '',
		isDefinition: true,
		file: 'Vehicle.sysml',
		parts: [
			{ name: 'engine', type: 'Engine', multiplicity: '' },
			{ name: 'wheels', type: 'Wheel', multiplicity: '[4]' },
			{ name: 'battery', type: 'Battery', multiplicity: '' }
		] as Line[],
		more: 0
	};

	const shown = $derived.by(() => {
		if (!node) return SAMPLE;
		const parts = node.children.filter((c) => c.element.kind === 'part');
		const e = node.element;
		return {
			keyword: e.isDefinition ? 'part def' : 'part',
			name: e.label,
			type: e.isDefinition ? '' : (e.typeRef ?? ''),
			isDefinition: e.isDefinition,
			file: e.file.split('/').pop() ?? e.file,
			parts: parts.slice(0, 3).map((c) => ({
				name: c.element.label,
				type: c.element.typeRef ?? '',
				multiplicity: multiplicityText(c.element.multiplicity)
			})),
			more: Math.max(0, parts.length - 3)
		};
	});

	type Token = [cls: string, text: string];
	const lines = $derived.by(() => {
		const head: Token[] = [
			['k', shown.keyword],
			['', ' '],
			['d', shown.name]
		];
		if (shown.type) head.push(['o', ' : '], ['t', shown.type]);
		head.push(['o', ' {']);
		const body = shown.parts.map((p): Token[] => [
			['', '    '],
			['k', 'part'],
			['', ' '],
			['n', p.name],
			...(p.type
				? ([
						['o', ' : '],
						['t', p.type]
					] as Token[])
				: []),
			['m', p.multiplicity],
			['o', ';']
		]);
		const more: Token[][] = shown.more
			? [
					[
						['', '    '],
						['c', `// ${shown.more} more parts`]
					]
				]
			: [];
		return [head, ...body, ...more, [['o', '}']] as Token[]];
	});
</script>

<div class="stage" aria-hidden="true">
	<div class="code card">
		<div class="chrome">
			<span class="dot"></span><span class="dot"></span><span class="dot"></span>
			<span class="tab">{shown.file}</span>
		</div>
		{#if ready}
			<div class="source">
				{#each lines as line, i (i)}
					<div class="line">
						{#each line as [cls, text], j (j)}<span class={cls}>{text}</span>{/each}
					</div>
				{/each}
			</div>
		{:else}
			<div class="lines">
				{#each [62, 78, 70, 84, 30] as width, i (i)}
					<span
						class="skeleton"
						style:width="{width}%"
						style:margin-left={i && i < 4 ? '1.5rem' : 0}
					></span>
				{/each}
			</div>
		{/if}
	</div>

	<span class="sync"><ArrowLeftRight size={13} strokeWidth={2.4} /> Same model</span>

	<div class="diagram card">
		<div class="block" class:definition={shown.isDefinition}>
			<div class="block-head">
				<span class="stereo">«{shown.keyword}»</span>
				{#if ready}
					<strong
						>{shown.name}{#if shown.type}<span class="type"> : {shown.type}</span>{/if}</strong
					>
				{:else}
					<span class="skeleton title"></span>
				{/if}
			</div>
			<div class="compartment">
				<span class="compartment-name">parts</span>
				{#if ready}
					{#each shown.parts as p (p.name)}
						<span class="child">
							<KindGlyph kind="part" isDefinition={false} size={16} />
							<span class="child-name"
								>{p.name}{#if p.type}<span class="type">
										: {p.type}{p.multiplicity}</span
									>{/if}</span
							>
						</span>
					{/each}
				{:else}
					{#each [70, 55, 80] as width, i (i)}
						<span class="child"><span class="skeleton" style:width="{width}%"></span></span>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.stage {
		position: relative;
		display: grid;
		min-width: 0;
	}
	.card {
		position: relative;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--surface) 94%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(6px);
	}
	.code {
		height: 11rem;
		margin-right: 2.25rem;
		padding: var(--space-3) var(--space-4);
		overflow: hidden;
	}
	.chrome {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-bottom: var(--space-2);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--border-strong);
	}
	.tab {
		margin-left: var(--space-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.source {
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.75;
		color: var(--syntax-name);
	}
	.line {
		overflow: hidden;
		white-space: pre;
		text-overflow: ellipsis;
	}
	.k {
		color: var(--syntax-keyword);
		font-weight: 600;
	}
	.d {
		color: var(--syntax-definition);
		font-weight: 600;
	}
	.t {
		color: var(--syntax-type);
	}
	.n {
		color: var(--syntax-name);
	}
	.m {
		color: var(--syntax-number);
	}
	.o {
		color: var(--syntax-operator);
	}
	.c {
		color: var(--syntax-comment);
		font-style: italic;
	}
	.lines {
		display: grid;
		gap: 0.7rem;
		padding: 0.35rem 0;
	}
	.diagram {
		z-index: 1;
		margin: -1.75rem 0 0 2.25rem;
		padding: var(--space-3);
		background-color: color-mix(in oklab, var(--surface) 96%, transparent);
		background-image: radial-gradient(
			color-mix(in oklab, var(--text-3) 24%, transparent) 1px,
			transparent 1px
		);
		background-size: 14px 14px;
	}
	.block {
		border: 1.5px solid var(--kind-structure);
		border-radius: 12px;
		background: var(--surface);
		overflow: hidden;
		box-shadow: 0 8px 20px -12px color-mix(in oklab, var(--kind-structure) 60%, transparent);
	}
	.block.definition {
		border-radius: 4px;
	}
	.block-head {
		display: grid;
		justify-items: center;
		gap: 1px;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid color-mix(in oklab, var(--kind-structure) 30%, transparent);
		background: color-mix(in oklab, var(--kind-structure) 12%, var(--surface));
		text-align: center;
	}
	.stereo {
		font-size: 11px;
		color: var(--text-2);
	}
	.block-head strong {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}
	.type {
		font-weight: 400;
		color: var(--text-2);
	}
	.compartment {
		display: grid;
		gap: 4px;
		padding: var(--space-2) var(--space-3) var(--space-3);
	}
	.compartment-name {
		justify-self: center;
		color: var(--text-3);
		font-size: 11px;
		font-style: italic;
	}
	.child {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		height: 1.5rem;
		font-size: var(--text-xs);
	}
	.child-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 550;
	}
	.sync {
		position: absolute;
		z-index: 2;
		top: 8.4rem;
		right: 0;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-size: 11px;
		font-weight: 650;
		box-shadow: 0 6px 18px -6px color-mix(in oklab, var(--accent) 80%, transparent);
	}
	.skeleton {
		display: block;
		height: 0.6rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.skeleton.title {
		width: 8rem;
		height: 0.8rem;
		margin-top: 3px;
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
	}
</style>
