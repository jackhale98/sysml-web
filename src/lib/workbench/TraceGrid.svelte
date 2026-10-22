<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		ArrowDownWideNarrow,
		ArrowUpNarrowWide,
		Check,
		ChevronLeft,
		ChevronRight,
		ChevronsUpDown,
		FileCode,
		TriangleAlert
	} from '@lucide/svelte';
	import type { TraceMatrix } from '#lib/engine/types.ts';
	import { byteToUtf16, type ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import {
		RELATION_WORDS,
		elementLabel,
		elementText,
		groupEdges,
		marksByRow,
		requirementText
	} from './traceGrid.ts';

	/**
	 * A traceability matrix (satisfy or verify): requirements down the side,
	 * what satisfies or verifies them across the top, a ✓ where a link is.
	 * Every requirement in scope has a row, so the ones with nothing are
	 * flagged as gaps; each row and column is counted. The requirements stay
	 * put while the columns scroll sideways, with the number of columns out
	 * of sight on either side. On a phone, a card per requirement lists what
	 * satisfies or verifies it.
	 */
	let {
		matrix,
		visible,
		workspace,
		ui,
		name,
		flash = null
	}: {
		matrix: TraceMatrix;
		/** The requirements the view's search leaves, by index, in order. */
		visible: number[];
		workspace: Workspace;
		ui: WorkbenchUi;
		/** The view, for `data-table` (search reveals rows by it). */
		name: string;
		/** A row search just jumped to. */
		flash?: number | null;
	} = $props();

	const words = $derived(RELATION_WORDS[matrix.relation]);
	const marks = $derived(marksByRow(matrix));
	/** The link (or links) behind each mark, by `row:column`. */
	const linksAt = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built whole in a derived, never mutated after
		const map = new Map<string, TraceMatrix['links']>();
		for (const link of matrix.links) {
			const key = `${link.row}:${link.column}`;
			map.set(key, [...(map.get(key) ?? []), link]);
		}
		return map;
	});
	const total = $derived(matrix.requirements.length);
	const covered = $derived(marks.filter((m) => m.length).length);

	let gapsOnly = $state(false);
	let hideEmpty = $state(false);
	let sort = $state<{ by: 'requirement' | 'total'; descending: boolean }>({
		by: 'requirement',
		descending: false
	});

	/** The rows shown: the search's, then only the gaps when asked, in the chosen order. */
	const rows = $derived.by(() => {
		let out = gapsOnly ? visible.filter((i) => !marks[i]?.length) : [...visible];
		if (sort.by === 'total')
			out = out.toSorted((a, b) => (marks[a]?.length ?? 0) - (marks[b]?.length ?? 0) || a - b);
		return sort.descending ? out.toReversed() : out;
	});
	/** Marks per column among the rows shown. */
	const columnCounts = $derived.by(() => {
		const counts = matrix.elements.map(() => 0);
		for (const i of rows) for (const c of marks[i] ?? []) counts[c]! += 1;
		return counts;
	});
	const columns = $derived(
		matrix.elements.map((_, c) => c).filter((c) => !hideEmpty || columnCounts[c]! > 0)
	);
	const edges = $derived(groupEdges(matrix.elements, columns));

	function sortBy(by: 'requirement' | 'total') {
		sort =
			sort.by === by ? { by, descending: !sort.descending } : { by, descending: by === 'total' };
	}
	const ariaSort = (by: 'requirement' | 'total') =>
		sort.by === by ? (sort.descending ? 'descending' : 'ascending') : undefined;

	// --- The model elements behind rows, columns and marks ----------------------------

	const byId = $derived(
		new Map(workspace.elements.flatMap((e) => (e.id ? [[e.id, e] as const] : [])))
	);
	const elementOf = (id: string | null): ModelElement | undefined =>
		id ? byId.get(id) : undefined;
	const requirementElement = (i: number) => elementOf(matrix.requirements[i]?.elementId ?? null);
	const columnElement = (c: number) => elementOf(matrix.elements[c]?.elementId ?? null);
	const selectedKey = $derived(ui.selection?.key ?? null);

	function select(element: ModelElement | undefined) {
		if (element) ui.select(element.key, 'table');
	}

	/** The link chosen in the grid: its requirement is what the inspector shows. */
	let picked = $state<{ row: number; column: number } | null>(null);
	const pickedShown = $derived(
		picked && requirementElement(picked.row)?.key === selectedKey ? picked : null
	);

	function pick(row: number, column: number) {
		picked = { row, column };
		select(requirementElement(row));
	}

	/** Show the `satisfy` or `verify` itself in the text. */
	function showLink(row: number, column: number) {
		const link = linksAt.get(`${row}:${column}`)?.[0];
		const text = link ? workspace.text(link.file) : undefined;
		if (!link || text === undefined) return;
		ui.revealText(link.file, byteToUtf16(text, link.start), byteToUtf16(text, link.end));
	}

	const markLabel = (row: number, column: number) =>
		`${requirementText(matrix.requirements[row]!)} ${words.verb} ${matrix.elements[column]!.written}`;

	// --- Crosshair: the row and column of the cell under the pointer or focus -----------

	let hot = $state<{ row: number | null; column: number | null }>({ row: null, column: null });

	function track(event: Event) {
		const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-r], [data-c]');
		const r = cell?.dataset.r;
		const c = cell?.dataset.c;
		hot = {
			row: r === undefined ? null : Number(r),
			column: c === undefined ? null : Number(c)
		};
	}
	const cool = () => (hot = { row: null, column: null });

	// --- Sideways scrolling: what is out of sight on each side -------------------------

	let scroller = $state<HTMLElement | null>(null);
	let width = $state(0);
	let hiddenLeft = $state(0);
	let hiddenRight = $state(0);
	/** Narrow columns with upright names once the names written across would not fit. */
	const upright = $derived(columns.length * 8.5 * 16 > width - 26 * 16);

	function measure() {
		const box = scroller?.getBoundingClientRect();
		if (!scroller || !box) return;
		const first = scroller.querySelector<HTMLElement>('thead th.corner');
		const last = scroller.querySelector<HTMLElement>('thead th.total');
		const left = box.left + (first?.offsetWidth ?? 0);
		const right = box.right - (last?.offsetWidth ?? 0);
		let l = 0;
		let r = 0;
		for (const th of scroller.querySelectorAll<HTMLElement>('thead th[data-c]')) {
			const rect = th.getBoundingClientRect();
			const middle = rect.left + rect.width / 2;
			if (middle < left) l++;
			else if (middle > right) r++;
		}
		hiddenLeft = l;
		hiddenRight = r;
		// What moves into view (a focused mark) stops clear of the parts that stay put.
		const head = scroller.querySelector<HTMLElement>('thead')?.offsetHeight ?? 0;
		const foot = scroller.querySelector<HTMLElement>('tfoot')?.offsetHeight ?? 0;
		scroller.style.scrollPadding = `${head}px ${last?.offsetWidth ?? 0}px ${foot}px ${first?.offsetWidth ?? 0}px`;
	}

	let frame = 0;
	function onScroll() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(measure);
	}

	$effect(() => {
		const node = scroller;
		if (!node) return;
		const observer = new ResizeObserver(() => onScroll());
		observer.observe(node);
		const table = node.querySelector('table');
		if (table) observer.observe(table);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});
	$effect(() => {
		void columns;
		void rows;
		void upright;
		void tick().then(() => untrack(measure));
	});

	function page(direction: 1 | -1) {
		if (!scroller) return;
		const first = scroller.querySelector<HTMLElement>('thead th.corner')?.offsetWidth ?? 0;
		const last = scroller.querySelector<HTMLElement>('thead th.total')?.offsetWidth ?? 0;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		scroller.scrollBy({
			left: direction * Math.max(80, (scroller.clientWidth - first - last) * 0.8),
			behavior: reduce ? 'auto' : 'smooth'
		});
	}
</script>

{#snippet columnName(c: number)}
	{@const e = matrix.elements[c]!}
	{@const label = elementLabel(e)}
	{#if label.owner}
		<span class="owner" aria-hidden="true">{label.owner}<span class="sep">›</span></span>
	{/if}<span class="name">{label.name}</span>{#if label.owner}<span class="visually-hidden">
			({label.owner})</span
		>{/if}
{/snippet}

<div class="trace" class:phone={ui.phone}>
	<div class="bar">
		<p class="summary" aria-live="polite">
			<strong>{covered} of {total}</strong>
			{total === 1 ? 'requirement' : 'requirements'}
			{words.done}{#if covered < total}<span class="gaps"
					><TriangleAlert size={13} aria-hidden="true" />{total - covered}
					{words.gap.toLowerCase()}</span
				>{/if}
		</p>
		<div class="toggles">
			<label class="toggle">
				<input type="checkbox" bind:checked={gapsOnly} />
				Show only gaps
			</label>
			{#if !ui.phone}
				<label class="toggle">
					<input type="checkbox" bind:checked={hideEmpty} />
					Hide empty columns
				</label>
			{/if}
		</div>
	</div>

	{#if !ui.phone}
		<p class="picked" aria-live="polite">
			{#if pickedShown}
				{@const r = matrix.requirements[pickedShown.row]!}
				{@const e = matrix.elements[pickedShown.column]!}
				<Check size={14} aria-hidden="true" class="tick" />
				<button
					type="button"
					class="link"
					onclick={() => select(requirementElement(pickedShown.row))}
					><span class="mono">{r.id}</span> {r.title}</button
				>
				<span class="verb">{words.verb}</span>
				{#if columnElement(pickedShown.column)}
					<button
						type="button"
						class="link mono"
						onclick={() => select(columnElement(pickedShown.column))}>{e.written}</button
					>
				{:else}<span class="mono">{e.written}</span>{/if}
				<button
					type="button"
					class="show"
					onclick={() => showLink(pickedShown.row, pickedShown.column)}
					><FileCode size={13} aria-hidden="true" /> Show in SysML</button
				>
			{:else}
				<span class="hint"
					>Select a <span class="tick-text">✓</span> to see the link; select a name to open it.</span
				>
			{/if}
		</p>
	{/if}

	{#if total === 0}
		<p class="state">There are no requirements in scope.</p>
	{:else if rows.length === 0}
		<p class="state">
			{gapsOnly
				? `Every requirement shown is ${words.done}.`
				: 'No requirement matches the search.'}
		</p>
	{:else if ui.phone}
		<!-- Phones: a card per requirement, what satisfies or verifies it as chips. -->
		<div class="cards-scroll" data-table={name}>
			<ul class="cards" aria-label="Requirements and what they are {words.by.toLowerCase()}">
				{#each rows as i (i)}
					{@const r = matrix.requirements[i]!}
					{@const marked = marks[i] ?? []}
					{@const element = requirementElement(i)}
					<li
						class="card"
						class:gap={!marked.length}
						class:flash={flash === i}
						class:selected={!!element && element.key === selectedKey}
						data-row={i}
					>
						<div class="card-head">
							{#if element}
								<button type="button" class="req-card" onclick={() => select(element)}>
									{#if r.id}<span class="id">{r.id}</span>{/if}
									<span class="title">{r.title}</span>
								</button>
							{:else}
								<span class="req-card">
									{#if r.id}<span class="id">{r.id}</span>{/if}
									<span class="title">{r.title}</span>
								</span>
							{/if}
						</div>
						{#if marked.length}
							<p class="by-label">{words.by}</p>
							<ul class="chips">
								{#each marked as c (c)}
									{@const e = matrix.elements[c]!}
									{@const label = elementLabel(e)}
									{@const target = columnElement(c)}
									<li>
										{#if target}
											<button
												type="button"
												class="chip"
												aria-label="{elementText(e)}, select"
												onclick={() => select(target)}
											>
												<Check size={13} aria-hidden="true" class="tick" />
												{#if label.owner}<span class="owner">{label.owner} ›</span>{/if}
												<span>{label.name}</span>
											</button>
										{:else}
											<span class="chip">
												<Check size={13} aria-hidden="true" class="tick" />
												{#if label.owner}<span class="owner">{label.owner} ›</span>{/if}
												<span>{label.name}</span>
											</span>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="flag"><TriangleAlert size={13} aria-hidden="true" /> {words.gap}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<div
			class="frame"
			class:left={hiddenLeft > 0}
			class:right={hiddenRight > 0}
			bind:clientWidth={width}
		>
			<div class="scroll" data-table={name} bind:this={scroller} onscroll={onScroll}>
				<table
					class:upright
					onpointerover={track}
					onpointerleave={cool}
					onfocusin={track}
					onfocusout={cool}
				>
					<caption class="visually-hidden">
						Requirements down the side, the {words.what} that they are {words.by.toLowerCase()}
						across the top; ✓ marks a link.
					</caption>
					<thead>
						<tr>
							<th scope="col" class="corner" aria-sort={ariaSort('requirement')}>
								<span class="axis across" aria-hidden="true">{words.by} →</span>
								<button type="button" class="sort" onclick={() => sortBy('requirement')}>
									Requirement <span class="axis-arrow" aria-hidden="true">↓</span>
									{#if sort.by === 'requirement'}
										{#if sort.descending}<ArrowDownWideNarrow size={13} />{:else}<ArrowUpNarrowWide
												size={13}
											/>{/if}
									{:else}<ChevronsUpDown size={12} class="idle" />{/if}
								</button>
							</th>
							{#each columns as c, k (c)}
								{@const e = matrix.elements[c]!}
								{@const target = columnElement(c)}
								<th
									scope="col"
									class="col"
									class:hot={hot.column === c}
									class:selected={!!target && target.key === selectedKey}
									class:group-first={edges[k]?.first}
									class:group-last={edges[k]?.last}
									data-c={c}
									title={e.qualifiedName || e.written}
								>
									{#if target}
										<button type="button" class="head" onclick={() => select(target)}>
											<span class="label">{@render columnName(c)}</span>
										</button>
									{:else}
										<span class="head"><span class="label">{@render columnName(c)}</span></span>
									{/if}
								</th>
							{/each}
							<th scope="col" class="total" aria-sort={ariaSort('total')}>
								<button type="button" class="sort" onclick={() => sortBy('total')}>
									Total
									{#if sort.by === 'total'}
										{#if sort.descending}<ArrowDownWideNarrow size={13} />{:else}<ArrowUpNarrowWide
												size={13}
											/>{/if}
									{:else}<ChevronsUpDown size={12} class="idle" />{/if}
								</button>
							</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as i (i)}
							{@const r = matrix.requirements[i]!}
							{@const marked = marks[i] ?? []}
							{@const element = requirementElement(i)}
							<tr
								data-row={i}
								class:gap={!marked.length}
								class:hot={hot.row === i}
								class:flash={flash === i}
								class:selected={!!element && element.key === selectedKey}
							>
								<th scope="row" class="req" data-r={i} title={requirementText(r)}>
									<span class="req-line">
										{#if element}
											<button type="button" class="req-name" onclick={() => select(element)}>
												{#if r.id}<span class="id">{r.id}</span>{/if}<span class="title"
													>{r.title}</span
												>
											</button>
										{:else}
											<span class="req-name">
												{#if r.id}<span class="id">{r.id}</span>{/if}<span class="title"
													>{r.title}</span
												>
											</span>
										{/if}
										{#if !marked.length}<span class="flag">{words.gap}</span>{/if}
									</span>
								</th>
								{#each columns as c, k (c)}
									{@const on = marked.includes(c)}
									{@const chosen = pickedShown?.row === i && pickedShown.column === c}
									<td
										class="cell"
										class:hot={hot.column === c}
										class:selected={!!columnElement(c) && columnElement(c)!.key === selectedKey}
										class:group-first={edges[k]?.first}
										class:group-last={edges[k]?.last}
										data-r={i}
										data-c={c}
									>
										{#if on}
											<button
												type="button"
												class="mark"
												class:chosen
												aria-label={markLabel(i, c)}
												title={markLabel(i, c)}
												onclick={() => pick(i, c)}
												><Check size={15} strokeWidth={3} aria-hidden="true" /></button
											>
										{/if}
									</td>
								{/each}
								<td class="total" class:zero={!marked.length} data-r={i}>{marked.length}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<th scope="row" class="req foot-label">Total</th>
							{#each columns as c, k (c)}
								<td
									class="cell count"
									class:hot={hot.column === c}
									class:group-first={edges[k]?.first}
									class:group-last={edges[k]?.last}
									data-c={c}>{columnCounts[c]}</td
								>
							{/each}
							<td class="total">{rows.filter((i) => marks[i]?.length).length}</td>
						</tr>
					</tfoot>
				</table>
			</div>
			{#if hiddenLeft > 0}
				<button
					type="button"
					class="more before"
					aria-label="Scroll left: {hiddenLeft} more {hiddenLeft === 1 ? 'column' : 'columns'}"
					onclick={() => page(-1)}><ChevronLeft size={14} aria-hidden="true" />{hiddenLeft}</button
				>
			{/if}
			{#if hiddenRight > 0}
				<button
					type="button"
					class="more after"
					aria-label="Scroll right: {hiddenRight} more {hiddenRight === 1 ? 'column' : 'columns'}"
					onclick={() => page(1)}
					>{hiddenRight} more<ChevronRight size={14} aria-hidden="true" /></button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.trace {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-2);
		min-height: 0;
		padding: 0 var(--space-5) var(--space-5);
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.35em;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.summary strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.gaps {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: var(--space-2);
		padding: 1px 8px;
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.toggle:has(input:checked) {
		border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
		background: var(--accent-weak);
	}
	.toggle input {
		margin: 0;
		accent-color: var(--accent);
	}
	.picked {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 0.4em;
		min-height: 1.75rem;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.picked :global(.tick) {
		color: var(--ok);
	}
	.hint {
		color: var(--text-3);
	}
	.tick-text {
		color: var(--ok);
		font-weight: 700;
	}
	.verb {
		color: var(--text-2);
	}
	.link {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.mono,
	.id {
		font-family: var(--font-mono);
	}
	.link.mono {
		font-size: var(--text-xs);
	}
	.show {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 1.75rem;
		margin-left: var(--space-2);
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.show:hover {
		border-color: var(--border-strong);
	}
	.state {
		padding: var(--space-4) 0;
		color: var(--text-2);
	}

	/* --- The grid -------------------------------------------------------------------- */
	.frame {
		--req-width: clamp(13rem, 38cqw, 26rem);
		position: relative;
		display: flex;
		flex: 0 1 auto;
		min-height: 0;
		container-type: inline-size;
	}
	/* As wide as the table, up to the pane: a short matrix doesn't stretch. */
	.scroll {
		flex: 0 1 auto;
		min-width: 0;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	table {
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}
	th,
	td {
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	thead th {
		position: sticky;
		top: 0;
		z-index: 2;
		padding: 0;
		background: var(--surface-2);
		vertical-align: bottom;
		text-align: left;
		font-weight: 400;
	}
	tfoot > tr > * {
		position: sticky;
		bottom: 0;
		z-index: 2;
		border-top: 1px solid var(--border-strong);
		border-bottom: 0;
		background: var(--surface-2);
	}
	tbody tr:last-child > * {
		border-bottom: 0;
	}

	/* The requirements stay put on the left, the totals on the right. */
	.corner,
	.req {
		position: sticky;
		left: 0;
		z-index: 1;
		box-shadow: inset -1px 0 0 var(--border);
		transition: box-shadow var(--duration) var(--ease);
	}
	thead .corner,
	tfoot .req {
		z-index: 3;
	}
	th.total,
	td.total {
		position: sticky;
		right: 0;
		z-index: 1;
		width: 4rem;
		min-width: 4rem;
		box-shadow: inset 1px 0 0 var(--border);
		transition: box-shadow var(--duration) var(--ease);
	}
	thead th.total,
	tfoot td.total {
		z-index: 3;
	}
	/* Something is out of sight beneath: an edge shadow on that side. */
	.frame.left .corner,
	.frame.left .req {
		box-shadow:
			inset -1px 0 0 var(--border-strong),
			10px 0 12px -10px rgb(0 0 0 / 0.35);
	}
	.frame.right th.total,
	.frame.right td.total {
		box-shadow:
			inset 1px 0 0 var(--border-strong),
			-10px 0 12px -10px rgb(0 0 0 / 0.35);
	}

	.corner {
		width: calc(var(--req-width) + 2 * var(--space-3));
		padding: var(--space-2) var(--space-3);
	}
	.axis {
		display: block;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		text-align: right;
	}
	.sort {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.75rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		cursor: pointer;
	}
	.sort:hover {
		color: var(--text);
	}
	.sort :global(.idle) {
		opacity: 0.45;
	}
	th.total .sort {
		width: 100%;
		justify-content: center;
		padding: 0 var(--space-2);
	}

	/* Column heads: the element's name in words, the owner it is written under before it. */
	th.col {
		width: 8.5rem;
		min-width: 7rem;
	}
	.head {
		display: block;
		width: 100%;
		padding: var(--space-2);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-xs);
		text-align: left;
	}
	button.head {
		cursor: pointer;
	}
	button.head:hover .name {
		color: var(--accent);
		text-decoration: underline;
	}
	.label {
		display: block;
	}
	.owner {
		display: block;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
	}
	.sep {
		margin-left: 0.25em;
	}
	.name {
		font-weight: 600;
	}
	/* Many columns: narrow ones, the names read upwards. */
	.upright th.col {
		width: 2.75rem;
		min-width: 2.75rem;
		max-width: 2.75rem;
	}
	.upright .head {
		display: flex;
		justify-content: center;
		padding: var(--space-2) 0;
	}
	.upright .label {
		display: block;
		max-height: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
	}
	.upright .owner {
		display: inline;
	}
	.upright .sep {
		margin: 0.25em 0.3em 0.25em 0.15em;
	}

	/* Requirement rows: the ID, then the title, cut short with the whole in a tooltip. */
	th.req {
		padding: 0 var(--space-3);
		text-align: left;
		font-weight: 400;
	}
	.req-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: var(--req-width);
		min-height: 2.5rem;
	}
	.req-name {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
	}
	button.req-name {
		cursor: pointer;
	}
	.req-name .id {
		flex: none;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.req-name .title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button.req-name:hover .title {
		color: var(--accent);
		text-decoration: underline;
	}
	.flag {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 4px;
		padding: 0 7px;
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1.6;
		white-space: nowrap;
	}
	.foot-label {
		padding: var(--space-2) var(--space-3);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		text-align: left;
	}

	/* Cells: a ✓ where a link is. */
	td.cell {
		height: 2.5rem;
		padding: 0 var(--space-1);
		text-align: center;
		vertical-align: middle;
	}
	td.count,
	td.total {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-align: center;
		vertical-align: middle;
	}
	tbody td.total {
		color: var(--text);
		font-weight: 600;
	}
	td.total.zero {
		color: var(--warn);
	}
	.mark {
		display: inline-grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 1px solid color-mix(in oklab, var(--ok) 35%, transparent);
		border-radius: var(--radius-sm);
		background: var(--ok-weak);
		color: var(--ok);
		cursor: pointer;
		transition:
			background var(--duration) var(--ease),
			transform var(--duration) var(--ease);
	}
	.mark:hover {
		border-color: var(--ok);
	}
	.mark.chosen {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	/* Column groups (`drone`, `drone.battery`, …): a firmer line around them. */
	.group-first {
		border-left: 1px solid var(--border-strong);
	}
	.group-last {
		border-right: 1px solid var(--border-strong);
	}

	/* Gaps: a row with nothing, tinted. */
	tbody tr.gap > td {
		background: color-mix(in oklab, var(--warn-weak) 40%, var(--surface));
	}
	/* The crosshair: the row and column of the cell under the pointer or focus. */
	tbody tr.hot > *,
	td.hot,
	th.col.hot {
		background: color-mix(in oklab, var(--accent-weak) 45%, var(--surface));
	}
	thead th.col.hot,
	tfoot td.hot {
		background: color-mix(in oklab, var(--accent-weak) 60%, var(--surface-2));
	}
	tbody tr.hot > td.hot {
		background: color-mix(in oklab, var(--accent-weak) 85%, var(--surface));
	}
	/* What the inspector shows: its row or its column. */
	tbody tr.selected > *,
	td.selected,
	thead th.col.selected {
		background: var(--accent-weak);
	}
	tbody tr.selected > th.req {
		box-shadow:
			inset 3px 0 0 var(--accent),
			inset -1px 0 0 var(--border);
	}

	/* What is out of sight: a button that pages there, at the header's height. */
	.more {
		position: absolute;
		top: var(--space-2);
		z-index: 4;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 1.75rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 600;
		box-shadow: var(--shadow-md);
		cursor: pointer;
	}
	.more:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.more.before {
		left: calc(var(--req-width) + 2 * var(--space-3) + var(--space-2));
	}
	.more.after {
		right: calc(4rem + var(--space-2));
	}

	/* A row search jumped to: a brief glow that fades. */
	.flash > :global(*),
	.card.flash {
		animation: found 2.6s var(--ease);
	}
	@keyframes found {
		0%,
		55% {
			background: color-mix(in oklab, var(--accent) 22%, var(--surface));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flash > :global(*),
		.card.flash {
			animation: none;
		}
		.mark {
			transition: none;
		}
	}

	/* --- Phones: a card per requirement ------------------------------------------------ */
	.phone {
		padding: 0;
	}
	.phone .bar {
		padding: 0 var(--space-3);
	}
	.cards-scroll {
		flex: 1;
		min-height: 0;
		padding: var(--space-1) var(--space-3) calc(6rem + var(--sheet-cover, 0px));
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.phone .state {
		padding: var(--space-4) var(--space-3);
	}
	.cards {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		min-width: 0;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.card.gap {
		border-color: color-mix(in oklab, var(--warn) 35%, var(--border));
		box-shadow: inset 3px 0 0 var(--warn);
	}
	.card.selected {
		border-color: color-mix(in oklab, var(--accent) 55%, var(--border));
		background: color-mix(in oklab, var(--accent-weak) 45%, var(--surface));
	}
	.card-head .req-card {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px var(--space-2);
		width: 100%;
		min-height: 2.75rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
	}
	.card-head button.req-card {
		cursor: pointer;
	}
	.card-head .id {
		color: var(--accent);
		font-size: var(--text-md);
		font-weight: 600;
	}
	.card-head .title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.by-label {
		margin: 0 0 var(--space-1);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
	}
	button.chip {
		cursor: pointer;
	}
	.chip :global(.tick) {
		color: var(--ok);
	}
	.chip .owner {
		display: inline;
	}
	.card > .flag {
		font-size: var(--text-xs);
		line-height: 1.8;
	}
</style>
