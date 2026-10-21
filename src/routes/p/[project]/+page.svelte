<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ArrowRight } from '@lucide/svelte';
	import { useWorkspace } from '#lib/project/context.ts';
	import { statusLabel, type Tone } from '#lib/project/status.ts';
	import Meter from '#lib/ui/Meter.svelte';
	import Pill from '#lib/ui/Pill.svelte';

	const workspace = useWorkspace();
	const ready = $derived(workspace.state.phase === 'ready');
	const requirementsHref = $derived(
		resolve('/p/[project]/requirements', { project: page.params.project ?? '' })
	);
	const modelHref = $derived(resolve('/p/[project]/model', { project: page.params.project ?? '' }));

	const gaps = $derived(
		workspace.requirements.filter((r) => r.satisfiedBy.length === 0 || r.verifiedBy.length === 0)
	);

	const byStatus = $derived.by(() => {
		const counts: Record<string, { label: string; tone: Tone; count: number }> = {};
		for (const r of workspace.requirements) {
			const key = r.status ?? '';
			counts[key] ??= { ...statusLabel(r.status), count: 0 };
			counts[key].count += 1;
		}
		return Object.values(counts).sort((a, b) => b.count - a.count);
	});

	const errors = $derived(workspace.problems.filter((p) => p.severity === 'error').length);
	const warnings = $derived(workspace.problems.filter((p) => p.severity === 'warning').length);
</script>

<div class="page">
	<header>
		<h1>{workspace.source?.info.name ?? 'Project'}</h1>
		{#if workspace.source?.info.description}
			<p>{workspace.source.info.description}</p>
		{/if}
	</header>

	<div class="grid" aria-busy={!ready}>
		<section class="card stat">
			<h2>Requirements</h2>
			<p class="big">{ready ? workspace.coverage.total : '–'}</p>
			<a href={requirementsHref}>Open requirements <ArrowRight size={14} /></a>
		</section>

		<section class="card">
			<h2>Coverage</h2>
			<div class="meters">
				<Meter
					label="Allocated to the design"
					value={workspace.coverage.satisfied}
					total={workspace.coverage.total}
					tone="info"
				/>
				<Meter
					label="Covered by a test"
					value={workspace.coverage.verified}
					total={workspace.coverage.total}
				/>
			</div>
		</section>

		<section class="card stat">
			<h2>Model health</h2>
			<p class="big" class:bad={errors > 0}>{ready ? errors : '–'}</p>
			<p class="muted">
				{errors === 1 ? 'error' : 'errors'} · {warnings}
				{warnings === 1 ? 'warning' : 'warnings'}
			</p>
			<a href={modelHref}>Review the model <ArrowRight size={14} /></a>
		</section>

		<section class="card wide">
			<h2>Needs attention</h2>
			{#if !ready}
				<p class="muted">Analysing…</p>
			{:else if gaps.length === 0}
				<p class="muted">Every requirement is allocated and covered by a test.</p>
			{:else}
				<ul class="gaps">
					{#each gaps.slice(0, 8) as r (r.key)}
						<li>
							<a href="{requirementsHref}?selected={encodeURIComponent(r.key)}">
								<span class="id mono">{r.id ?? '—'}</span>
								<span class="title">{r.title}</span>
								<span class="tags">
									{#if r.satisfiedBy.length === 0}<Pill tone="warn">Not allocated</Pill>{/if}
									{#if r.verifiedBy.length === 0}<Pill tone="warn">No test</Pill>{/if}
								</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if gaps.length > 8}
					<a class="more" href="{requirementsHref}?view=gaps">
						All {gaps.length} requirements with gaps <ArrowRight size={14} />
					</a>
				{/if}
			{/if}
		</section>

		<section class="card">
			<h2>Requirement status</h2>
			{#if ready && workspace.requirements.length > 0}
				<div class="stack" aria-hidden="true">
					{#each byStatus as s (s.label)}
						<span class="segment {s.tone}" style:flex-grow={s.count}></span>
					{/each}
				</div>
				<ul class="legend">
					{#each byStatus as s (s.label)}
						<li><Pill tone={s.tone}>{s.label}</Pill> <span class="n">{s.count}</span></li>
					{/each}
				</ul>
			{:else}
				<p class="muted">{ready ? 'No requirements yet.' : 'Analysing…'}</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		max-width: 76rem;
	}
	header {
		margin-bottom: var(--space-5);
	}
	h1 {
		font-size: var(--text-2xl);
	}
	header p {
		margin-top: var(--space-1);
		color: var(--text-2);
		max-width: 48rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: var(--space-4);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	.wide {
		grid-column: span 2;
	}
	@media (max-width: 760px) {
		.wide {
			grid-column: auto;
		}
	}
	h2 {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-2);
	}
	.big {
		font-size: var(--text-3xl);
		font-weight: 650;
		letter-spacing: -0.03em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.big.bad {
		color: var(--danger);
	}
	.stat a,
	.more {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		margin-top: auto;
		font-weight: 550;
	}
	.muted {
		color: var(--text-3);
	}
	.meters {
		display: grid;
		gap: var(--space-4);
	}
	.gaps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}
	.gaps a {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-2);
		margin: 0 calc(-1 * var(--space-2));
		border-radius: var(--radius-sm);
		color: var(--text);
	}
	.gaps a:hover {
		background: var(--surface-hover);
		text-decoration: none;
	}
	.id {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tags {
		display: flex;
		gap: var(--space-1);
	}
	.stack {
		display: flex;
		gap: 3px;
		height: 0.625rem;
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.segment {
		flex-basis: 0;
	}
	.segment.ok {
		background: var(--ok);
	}
	.segment.warn {
		background: var(--warn);
	}
	.segment.info {
		background: var(--info);
	}
	.segment.danger {
		background: var(--danger);
	}
	.segment.muted {
		background: var(--border-strong);
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.legend li {
		display: flex;
		justify-content: space-between;
	}
	.n {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
</style>
