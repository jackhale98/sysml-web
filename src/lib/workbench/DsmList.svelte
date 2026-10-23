<script lang="ts">
	import { ChevronDown, Plus, TriangleAlert, Zap } from '@lucide/svelte';
	import type { DependencyKind, DependencyMatrix, MatrixLink } from '#lib/engine/types.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import { KIND_WORDS, itemLabel, itemPathLabel, passes } from './dsm.ts';
	import { humanize } from './traceGrid.ts';

	/**
	 * A dependency matrix on a phone: a card per element, in the matrix's
	 * order, each opening to what it leads to and what leads to it, grouped
	 * by kind, with what links it outside the matrix. From a card: what a
	 * change to it reaches (the cards it reaches are marked) and a new
	 * connection.
	 */
	let {
		matrix,
		order,
		modules,
		kinds,
		impact,
		impactFrom,
		unlinked,
		selectedIndex,
		name,
		canConnect,
		onimpact,
		onselect,
		onshowlink,
		onconnect
	}: {
		matrix: DependencyMatrix;
		order: number[];
		modules: number[][];
		kinds: DependencyKind[];
		impact: Map<number, number> | null;
		impactFrom: number | null;
		unlinked: number[];
		selectedIndex: number | null;
		name: string;
		canConnect: (item: number) => boolean;
		onimpact: (item: number) => void;
		onselect: (item: number) => void;
		onshowlink: (link: MatrixLink) => void;
		onconnect: (item: number) => void;
	} = $props();

	const open = new SvelteSet<number>();
	const moduleOf = $derived.by(() => {
		const out = matrix.items.map(() => -1);
		modules.forEach((m, k) => m.forEach((i) => (out[i] = k)));
		return out;
	});

	type Side = 'both' | 'out' | 'in';
	const SIDES: { side: Side; title: string }[] = [
		{ side: 'both', title: 'Connected with' },
		{ side: 'out', title: 'Leads to' },
		{ side: 'in', title: 'Comes from' }
	];

	/**
	 * An item's links of the counted kinds, grouped by kind in the matrix's
	 * order: those both ways (connections, bindings), those from it, those to it.
	 */
	function groups(item: number, side: Side) {
		const found = matrix.links.filter((l) => {
			if (!kinds.includes(l.kind) || (l.from !== item && l.to !== item)) return false;
			if (side === 'both') return l.mutual;
			return !l.mutual && (side === 'out' ? l.from === item : l.to === item);
		});
		return kinds
			.map((kind) => ({ kind, links: found.filter((l) => l.kind === kind) }))
			.filter((g) => g.links.length);
	}

	function count(item: number, side: Side) {
		return groups(item, side).reduce((n, g) => n + g.links.length, 0);
	}

	/** "2 connected · leads to 1 · a battery". */
	function summary(item: number): string {
		const it = matrix.items[item]!;
		const [both, out, inn] = (['both', 'out', 'in'] as const).map((s) => count(item, s));
		const parts = [
			...(both ? [`${both} connected`] : []),
			...(out ? [`leads to ${out}`] : []),
			...(inn ? [`comes from ${inn}`] : [])
		];
		if (!parts.length) parts.push('no links');
		if (it.type) {
			const type = humanize(it.type).toLowerCase();
			parts.push(`${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`);
		}
		return parts.join(' · ');
	}

	const other = (link: MatrixLink, item: number) => (link.from === item ? link.to : link.from);

	function linkText(link: MatrixLink, item: number): string {
		const what = [
			...(link.name ? [humanize(link.name)] : []),
			...(link.kind === 'connection' && link.definition ? [humanize(link.definition)] : []),
			...(link.from === item || link.mutual
				? passes(link, item)
				: link.item
					? [humanize(link.item)]
					: [])
		];
		return what.join(' · ');
	}
</script>

<div class="list-scroll" data-table={name}>
	<ul
		class="cards"
		aria-label="Each {matrix.elements === 'actions'
			? 'step'
			: matrix.elements === 'requirements'
				? 'requirement'
				: 'part'} and its links"
	>
		{#each order as item, k (item)}
			{@const expanded = open.has(item)}
			{@const sides = SIDES.map((x) => ({ ...x, list: groups(item, x.side) }))}
			{@const outside = matrix.outside.filter((o) => o.item === item && kinds.includes(o.kind))}
			{@const reached = impact?.get(item)}
			{#if moduleOf[item]! >= 0 && moduleOf[order[k - 1] ?? -1] !== moduleOf[item]}
				<li class="module-head" aria-hidden="true">Suggested module {moduleOf[item]! + 1}</li>
			{/if}
			<li
				class="card"
				class:selected={selectedIndex === item}
				class:in-module={moduleOf[item]! >= 0}
				class:reach-start={impactFrom === item}
				class:reached={reached !== undefined}
			>
				<button
					type="button"
					class="card-head"
					aria-expanded={expanded}
					onclick={() => (expanded ? open.delete(item) : open.add(item))}
				>
					<span class="num">{k + 1}</span>
					<span class="title">
						<span class="name">{itemPathLabel(matrix, item)}</span>
						<span class="counts">{summary(item)}</span>
					</span>
					{#if unlinked.includes(item)}<span class="flag">No links</span>{/if}
					{#if impactFrom === item}<span class="reach">changed</span>{:else if reached === 1}<span
							class="reach">affected directly</span
						>{:else if reached !== undefined}<span class="reach">affected through others</span>{/if}
					<ChevronDown size={18} class="chevron" aria-hidden="true" />
				</button>
				{#if expanded}
					<div class="card-body">
						{#each sides as side (side.side)}
							{#if side.list.length}
								<h3>{side.title}</h3>
								{#each side.list as g (g.kind)}
									<p class="kind">
										<span class="mark k-{g.kind}" aria-hidden="true">{KIND_WORDS[g.kind].mark}</span
										>
										{KIND_WORDS[g.kind].label}
									</p>
									<ul class="links">
										{#each g.links as link (link)}
											{@const to = other(link, item)}
											{@const text = linkText(link, item)}
											<li>
												<button type="button" class="link" onclick={() => onshowlink(link)}>
													<span class="to">{itemLabel(matrix.items[to]!)}</span>
													{#if text}<span class="via">{text}</span>{/if}
													{#if link.kind === 'connection' && !link.definition}
														<span class="flag"
															><TriangleAlert size={12} aria-hidden="true" /> No interface definition</span
														>
													{/if}
													<span class="visually-hidden">, show in SysML</span>
												</button>
											</li>
										{/each}
									</ul>
								{/each}
							{/if}
						{/each}
						{#if sides.every((x) => !x.list.length)}
							<p class="none">Nothing in this matrix links to it, among the kinds counted.</p>
						{/if}
						{#if outside.length}
							<h3>Outside this matrix</h3>
							<p class="outside">
								{outside
									.map((o) =>
										o.direction === 'out'
											? `${KIND_WORDS[o.kind].legend} ${o.name}`
											: `${o.name} ${KIND_WORDS[o.kind].legend} it`
									)
									.join('; ')}
							</p>
						{/if}
						{#if impactFrom === item && impact}
							{@const direct = [...impact.values()].filter((d) => d === 1).length}
							<p class="impact-line">
								A change to it may affect <strong>{impact.size} of {matrix.items.length - 1}</strong
								>:
								{direct} directly, {impact.size - direct} through others. They are marked below and above.
							</p>
						{/if}
						<div class="actions">
							<button
								type="button"
								class="action"
								aria-pressed={impactFrom === item}
								onclick={() => onimpact(item)}
								><Zap size={16} aria-hidden="true" /> What a change affects</button
							>
							{#if canConnect(item)}
								<button type="button" class="action" onclick={() => onconnect(item)}
									><Plus size={16} aria-hidden="true" /> Add a connection</button
								>
							{/if}
							<button type="button" class="action" onclick={() => onselect(item)}>Details</button>
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.list-scroll {
		padding: var(--space-1) var(--space-3) calc(6rem + var(--sheet-cover, 0px));
	}
	.cards {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.module-head {
		margin-top: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.card {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.card.in-module {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.card.selected {
		border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
	}
	.card.reach-start {
		border-color: var(--warn);
		background: color-mix(in oklab, var(--warn) 18%, var(--surface));
	}
	.card.reached {
		border-color: color-mix(in oklab, var(--warn) 50%, var(--border));
		background: var(--warn-weak);
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 3.25rem;
		padding: var(--space-2) var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.card-head :global(.chevron) {
		flex: none;
		color: var(--text-2);
		transition: transform var(--duration) var(--ease);
	}
	.card-head[aria-expanded='true'] :global(.chevron) {
		transform: rotate(180deg);
	}
	.num {
		flex: none;
		min-width: 1.5em;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-align: right;
	}
	.title {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.counts {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.flag,
	.reach {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 4px;
		padding: 0 7px;
		border-radius: var(--radius-pill);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1.6;
	}
	.flag {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.reach {
		border: 1px solid var(--warn);
		color: var(--text);
	}
	.card-body {
		display: grid;
		gap: var(--space-1);
		padding: 0 var(--space-3) var(--space-3);
	}
	h3 {
		margin-top: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.kind {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.links {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.link {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px var(--space-2);
		width: 100%;
		min-height: 2.75rem;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.to {
		font-weight: 600;
	}
	.via {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.none,
	.outside {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.impact-line {
		margin-top: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.action[aria-pressed='true'] {
		border-color: var(--warn);
		background: var(--warn-weak);
		font-weight: 600;
	}
	.mark {
		display: inline-grid;
		place-items: center;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 3px;
		border: 1px solid var(--k);
		border-radius: 4px;
		background: color-mix(in oklab, var(--k) 16%, var(--surface));
		color: var(--text);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1;
	}
	.k-connection {
		--k: var(--kind-interface);
	}
	.k-flow {
		--k: var(--info);
	}
	.k-binding {
		--k: var(--kind-structure);
	}
	.k-allocation {
		--k: var(--kind-behavior);
	}
	.k-typing {
		--k: var(--kind-package);
	}
	.k-satisfy {
		--k: var(--kind-requirement);
	}
	.k-succession {
		--k: var(--kind-behavior);
	}
	.k-derivation {
		--k: var(--kind-requirement);
	}
	.k-refinement {
		--k: var(--kind-analysis);
	}
</style>
