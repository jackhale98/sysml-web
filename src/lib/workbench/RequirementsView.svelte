<script lang="ts">
	import { Search } from '@lucide/svelte';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { RequirementRow } from '#lib/project/requirements.ts';
	import { humanize, statusLabel } from '#lib/project/status.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	type View = 'all' | 'gaps' | 'issues';
	let view = $state<View>('all');
	let query = $state('');
	const selectedKey = $derived(ui.selection?.key ?? null);

	const byId = (a: RequirementRow, b: RequirementRow) =>
		(a.id ?? '￿').localeCompare(b.id ?? '￿', undefined, { numeric: true });

	const isGap = (r: RequirementRow) => r.satisfiedBy.length === 0 || r.verifiedBy.length === 0;

	const counts = $derived({
		all: workspace.requirements.length,
		gaps: workspace.requirements.filter(isGap).length,
		issues: workspace.requirements.filter((r) => r.issues.length > 0).length
	});

	const rows = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return workspace.requirements
			.filter((r) => view === 'all' || (view === 'gaps' ? isGap(r) : r.issues.length > 0))
			.filter(
				(r) =>
					!needle ||
					[r.id, r.title, r.text, r.owner, r.kind].some((v) => v?.toLowerCase().includes(needle))
			)
			.sort(byId);
	});

	function select(row: RequirementRow) {
		ui.select(row.key, 'table');
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const target = event.target as HTMLElement;
		if (!target.closest('table')) return;
		event.preventDefault();
		const index = rows.findIndex((r) => r.key === selectedKey);
		const next =
			rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
		if (next) {
			ui.select(next.key, 'table');
			document.getElementById(`row-${next.key}`)?.focus();
		}
	}

	const views: { id: View; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'gaps', label: 'With gaps' },
		{ id: 'issues', label: 'With open issues' }
	];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="page" {onkeydown}>
	<div class="list">
		<header>
			<div>
				<h1>Requirements</h1>
				<p>
					{counts.all} requirements · {workspace.coverage.verified} covered by a test · {counts.gaps}
					with gaps
				</p>
			</div>
		</header>

		<div class="toolbar">
			<div class="segmented" role="group" aria-label="Show">
				{#each views as v (v.id)}
					<button type="button" aria-pressed={view === v.id} onclick={() => (view = v.id)}>
						{v.label}
						<span class="n">{counts[v.id]}</span>
					</button>
				{/each}
			</div>
			<label class="search">
				<Search size={15} />
				<span class="visually-hidden">Search requirements</span>
				<input type="search" placeholder="Search ID, title, text or owner" bind:value={query} />
			</label>
		</div>

		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col" class="c-id">ID</th>
						<th scope="col">Requirement</th>
						<th scope="col" class="c-kind">Kind</th>
						<th scope="col" class="c-prio">Priority</th>
						<th scope="col" class="c-status">Status</th>
						<th scope="col" class="c-trace">Allocated to</th>
						<th scope="col" class="c-trace">Verified by</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.key)}
						{@const status = statusLabel(r.status)}
						<tr class:selected={r.key === selectedKey}>
							<td class="c-id mono">{r.id ?? '—'}</td>
							<td class="c-main">
								<button
									id="row-{r.key}"
									type="button"
									class="row-button"
									aria-current={r.key === selectedKey ? 'true' : undefined}
									onclick={() => select(r)}
								>
									<span class="title">{r.title}</span>
									{#if r.text}<span class="text">{r.text}</span>{/if}
								</button>
							</td>
							<td class="c-kind">{r.kind ? humanize(r.kind) : ''}</td>
							<td class="c-prio">
								{#if r.priority}<span class="prio {r.priority}">{humanize(r.priority)}</span>{/if}
							</td>
							<td class="c-status"><Pill tone={status.tone}>{status.label}</Pill></td>
							<td class="c-trace">
								{#if r.satisfiedBy.length}
									<span class="trace" title={r.satisfiedBy.join('\n')}
										>{r.satisfiedBy[0]}{#if r.satisfiedBy.length > 1}<span class="more"
												>+{r.satisfiedBy.length - 1}</span
											>{/if}</span
									>
								{:else}
									<Pill tone="warn">Gap</Pill>
								{/if}
							</td>
							<td class="c-trace">
								{#if r.verifiedBy.length}
									<span class="trace" title={r.verifiedBy.join('\n')}
										>{r.verifiedBy[0]}{#if r.verifiedBy.length > 1}<span class="more"
												>+{r.verifiedBy.length - 1}</span
											>{/if}</span
									>
								{:else}
									<Pill tone="warn">Gap</Pill>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="empty">
								{#if workspace.state.phase !== 'ready'}
									Analysing the model…
								{:else if query}
									No requirements match “{query}”.
								{:else}
									Nothing to show here.
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<style>
	.page {
		height: 100%;
		overflow-y: auto;
		padding: var(--space-5);
	}
	header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}
	h1 {
		font-size: var(--text-2xl);
	}
	header p {
		color: var(--text-2);
		margin-top: var(--space-1);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-3);
	}
	.segmented {
		display: inline-flex;
		max-width: 100%;
		overflow-x: auto;
		padding: 3px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	.segmented button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 1.875rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: calc(var(--radius-md) - 3px);
		background: transparent;
		color: var(--text-2);
		font-weight: 520;
		white-space: nowrap;
		cursor: pointer;
	}
	.segmented button[aria-pressed='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.segmented .n {
		color: var(--text-3);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.search {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.25rem;
		padding: 0 var(--space-3);
		min-width: min(22rem, 100%);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text-3);
	}
	.search:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	.search input {
		flex: 1;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
	}
	.list {
		container-type: inline-size;
		min-width: 0;
	}
	.table-wrap {
		overflow-x: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-md);
	}
	th {
		position: sticky;
		top: 0;
		text-align: left;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-3);
		background: var(--surface);
		padding: var(--space-3) var(--space-3);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}
	td {
		padding: var(--space-3);
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	tbody tr:hover td {
		background: var(--surface-hover);
	}
	tr.selected td {
		background: var(--accent-weak);
	}
	tr.selected:hover td {
		background: var(--accent-weak);
	}
	.c-id {
		width: 5.75rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.c-kind,
	.c-prio {
		width: 7rem;
		color: var(--text-2);
		white-space: nowrap;
	}
	.c-status {
		width: 8rem;
	}
	.c-trace {
		width: 9rem;
		max-width: 9rem;
	}
	.c-main {
		min-width: 13rem;
	}
	/* Narrow lists (small screens, or with the detail panel open) keep the
	   columns people scan most. */
	@container (max-width: 860px) {
		.c-kind,
		.c-prio {
			display: none;
		}
	}
	@container (max-width: 620px) {
		.c-status,
		.c-trace {
			display: none;
		}
	}
	.row-button {
		display: grid;
		gap: 2px;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.row-button:focus-visible {
		outline-offset: 4px;
	}
	.title {
		font-weight: 580;
	}
	.text {
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.prio::before {
		content: '';
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.4rem;
		border-radius: 2px;
		background: var(--border-strong);
		vertical-align: 0.05em;
	}
	.prio.high::before {
		background: var(--danger);
	}
	.prio.medium::before {
		background: var(--warn);
	}
	.trace {
		display: block;
		color: var(--text-2);
		font-size: var(--text-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.more {
		margin-left: var(--space-1);
		color: var(--text-3);
	}
	.empty {
		padding: var(--space-6);
		text-align: center;
		color: var(--text-3);
	}
</style>
