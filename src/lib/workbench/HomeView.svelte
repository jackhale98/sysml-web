<script lang="ts">
	import {
		ArrowRight,
		CircleAlert,
		CircleCheck,
		FileCode,
		Flag,
		ListChecks,
		PencilLine,
		TriangleAlert
	} from '@lucide/svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import { statusLabel, type Tone } from '#lib/project/status.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import CoverageRing from './home/CoverageRing.svelte';
	import Glance from './home/Glance.svelte';
	import Hero from './home/Hero.svelte';
	import {
		architecturePackage,
		countFamilies,
		groupProblems,
		showcaseElement
	} from './home/model.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();
	const ready = $derived(workspace.state.phase === 'ready');

	const tourPath = $derived(workspace.paths.find((p) => /(^|\/)tour\.md$/i.test(p)) ?? null);
	const architecture = $derived(architecturePackage(workspace.tree));
	const showcase = $derived(showcaseElement(workspace.tree));
	const families = $derived(countFamilies(workspace.elements));
	const ownElements = $derived(families.reduce((sum, f) => sum + f.total, 0));

	// ── Requirements ──────────────────────────────────────────────────────────
	const coverage = $derived(workspace.coverage);
	const traced = $derived(
		workspace.requirements.filter((r) => r.satisfiedBy.length > 0 && r.verifiedBy.length > 0).length
	);
	const gaps = $derived(
		workspace.requirements.filter((r) => r.satisfiedBy.length === 0 || r.verifiedBy.length === 0)
	);
	const GAP_LIMIT = 6;

	const TONE_ORDER: Tone[] = ['ok', 'info', 'warn', 'danger', 'muted'];
	const byStatus = $derived.by(() => {
		const counts: Record<string, { label: string; tone: Tone; count: number }> = {};
		for (const r of workspace.requirements) {
			const key = r.status ?? '';
			counts[key] ??= { ...statusLabel(r.status), count: 0 };
			counts[key].count += 1;
		}
		return Object.values(counts).sort(
			(a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone) || b.count - a.count
		);
	});

	// ── Problems ──────────────────────────────────────────────────────────────
	const errors = $derived(workspace.problems.filter((p) => p.severity === 'error').length);
	const warnings = $derived(workspace.problems.filter((p) => p.severity === 'warning').length);
	const problemGroups = $derived(groupProblems(workspace.problems));

	// ── Files: edited, then recently opened, then the richest ────────────────
	const elementsPerFile = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const e of workspace.elements) counts[e.file] = (counts[e.file] ?? 0) + 1;
		return counts;
	});
	const opened = $derived(ui.tabs.flatMap((t) => (t.kind === 'file' ? [t.path] : [])).reverse());
	const files = $derived.by(() => {
		const own = workspace.modelPaths.filter((p) => !isLibraryFile(p));
		const richest = [...own].sort(
			(a, b) => (elementsPerFile[b] ?? 0) - (elementsPerFile[a] ?? 0) || a.localeCompare(b)
		);
		const ordered = [...workspace.dirty, ...opened, ...richest];
		return [...new Set(ordered)].filter((p) => workspace.paths.includes(p)).slice(0, 6);
	});

	function fileName(path: string) {
		return path.split('/').pop() ?? path;
	}
	function fileMeta(path: string) {
		const folder = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : 'Project root';
		return ready ? `${folder} · ${elementsPerFile[path] ?? 0} elements` : folder;
	}

	// ── Navigation ────────────────────────────────────────────────────────────
	function showRequirement(key: string) {
		ui.select(key, 'table');
		ui.inspectorOpen = true;
		ui.mobilePane = 'inspector';
	}
	function showElement(element: ModelElement) {
		ui.open({ kind: 'file', path: element.file });
		ui.select(element.key, 'explorer');
	}
	function showProblems() {
		ui.problemsOpen = true;
		ui.mobilePane = 'problems';
	}
</script>

{#snippet skeleton(width: string, height = '0.75rem')}
	<span class="skeleton" style:width style:height></span>
{/snippet}

<div class="home" data-home-scroll>
	<div class="page" aria-busy={!ready}>
		<Hero {workspace} {ui} {tourPath} {architecture} {showcase} {ownElements} />

		<Glance {families} {ready} onpick={showElement} />

		<section class="card requirements" aria-labelledby="req-heading">
			<header class="card-head">
				<span class="badge" style:--fam="var(--kind-requirement)"><ListChecks size={16} /></span>
				<div class="heading">
					<h3 id="req-heading">Requirements</h3>
					<p class="sub">
						{#if ready}{coverage.total} in this project{:else}{@render skeleton('6rem')}{/if}
					</p>
				</div>
				<button type="button" class="link" onclick={() => ui.open({ kind: 'requirements' })}>
					Open table <ArrowRight size={14} aria-hidden="true" />
				</button>
			</header>

			<div class="req-body">
				<div class="rings-wrap">
					<div class="rings">
						<CoverageRing
							label="Allocated to the design"
							hint="A part of the design satisfies it."
							value={coverage.satisfied}
							total={coverage.total}
							color="var(--info)"
							{ready}
						/>
						<CoverageRing
							label="Covered by a test"
							hint="A verification case checks it."
							value={coverage.verified}
							total={coverage.total}
							color="var(--ok)"
							{ready}
						/>
						<CoverageRing
							label="Fully traced"
							hint="Both allocated and covered by a test."
							value={traced}
							total={coverage.total}
							color="var(--kind-view)"
							{ready}
						/>
					</div>
				</div>

				<div class="status">
					<h4>By status</h4>
					{#if !ready}
						<span class="bar">{@render skeleton('100%', '0.75rem')}</span>
						<ul class="legend">
							{#each [0, 1, 2, 3] as i (i)}
								<li>{@render skeleton('6.5rem', '1.25rem')}</li>
							{/each}
						</ul>
					{:else if workspace.requirements.length === 0}
						<p class="empty">No requirements yet. Add one in text or on a diagram.</p>
					{:else}
						<div class="bar" aria-hidden="true">
							{#each byStatus as s (s.label)}
								<span class="segment {s.tone}" style:flex-grow={s.count}></span>
							{/each}
						</div>
						<ul class="legend">
							{#each byStatus as s (s.label)}
								<li>
									<Pill tone={s.tone}>{s.label}</Pill>
									<span class="n">{s.count}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</section>

		<div class="columns">
			<section class="card attention" aria-labelledby="attention-heading">
				<header class="card-head">
					<span class="badge" style:--fam="var(--warn)"><Flag size={16} /></span>
					<div class="heading">
						<h3 id="attention-heading">Needs attention</h3>
						<p class="sub">
							{#if !ready}{@render skeleton('9rem')}{:else if gaps.length}{gaps.length} requirements with
								a gap{:else}Nothing to follow up{/if}
						</p>
					</div>
				</header>
				<div class="gap-list">
					{#if !ready}
						<ul class="rows">
							{#each Array.from({ length: GAP_LIMIT }, (_, i) => i) as i (i)}
								<li class="row-skeleton">
									{@render skeleton('3.5rem')}{@render skeleton(`${50 + ((i * 17) % 35)}%`)}
								</li>
							{/each}
						</ul>
					{:else if gaps.length === 0}
						<p class="all-good">
							<CircleCheck size={18} aria-hidden="true" />
							Every requirement is allocated and covered by a test.
						</p>
					{:else}
						<ul class="rows">
							{#each gaps.slice(0, GAP_LIMIT) as r (r.key)}
								<li>
									<button type="button" class="gap-row" onclick={() => showRequirement(r.key)}>
										<span class="id mono">{r.id ?? '—'}</span>
										<span class="title">{r.title}</span>
										<span class="tags">
											{#if r.satisfiedBy.length === 0}<Pill tone="warn">Not allocated</Pill>{/if}
											{#if r.verifiedBy.length === 0}<Pill tone="warn">No test</Pill>{/if}
										</span>
									</button>
								</li>
							{/each}
						</ul>
						{#if gaps.length > GAP_LIMIT}
							<button
								type="button"
								class="link more"
								onclick={() => ui.open({ kind: 'requirements' })}
							>
								All {gaps.length} requirements with gaps <ArrowRight size={14} aria-hidden="true" />
							</button>
						{/if}
					{/if}
				</div>
			</section>

			<div class="side">
				<section class="card problems" aria-labelledby="problems-heading">
					<header class="card-head">
						<span class="badge" style:--fam={errors ? 'var(--danger)' : 'var(--ok)'}>
							{#if errors}<CircleAlert size={16} />{:else}<CircleCheck size={16} />{/if}
						</span>
						<div class="heading">
							<h3 id="problems-heading">Problems</h3>
							<p class="sub">
								{#if !ready}{@render skeleton('7rem')}{:else if errors}Fix errors first{:else}No
									errors{/if}
							</p>
						</div>
						<button type="button" class="link" onclick={showProblems}>
							Review <ArrowRight size={14} aria-hidden="true" />
						</button>
					</header>
					<div class="tallies">
						<div class="tally" class:bad={ready && errors > 0}>
							<CircleAlert size={16} aria-hidden="true" />
							<span class="tally-n"
								>{#if ready}{errors}{:else}{@render skeleton('1.25rem', '1.25rem')}{/if}</span
							>
							<span class="tally-label">{errors === 1 ? 'error' : 'errors'}</span>
						</div>
						<div class="tally" class:warned={ready && warnings > 0}>
							<TriangleAlert size={16} aria-hidden="true" />
							<span class="tally-n"
								>{#if ready}{warnings}{:else}{@render skeleton('1.25rem', '1.25rem')}{/if}</span
							>
							<span class="tally-label">{warnings === 1 ? 'warning' : 'warnings'}</span>
						</div>
					</div>
					{#if ready && problemGroups.length}
						<ul class="groups">
							{#each problemGroups.slice(0, 3) as g (g.severity + g.code)}
								<li>
									<button type="button" class="group {g.severity}" onclick={showProblems}>
										<span class="group-text">
											<span class="group-label">{g.label}</span>
											<span class="group-example">{g.example}</span>
										</span>
										<span class="group-n">{g.count}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else if ready}
						<p class="all-good">
							<CircleCheck size={18} aria-hidden="true" /> The model is consistent.
						</p>
					{/if}
				</section>

				<section class="card files" aria-labelledby="files-heading">
					<header class="card-head">
						<span class="badge" style:--fam="var(--kind-package)"><FileCode size={16} /></span>
						<div class="heading">
							<h3 id="files-heading">Files</h3>
							<p class="sub">
								{workspace.dirty.size
									? 'Edited and recent first'
									: opened.length
										? 'Recently opened first'
										: 'The largest first'}
							</p>
						</div>
					</header>
					<ul class="rows">
						{#each files as path (path)}
							<li>
								<button
									type="button"
									class="file-row"
									onclick={() => ui.open({ kind: 'file', path })}
								>
									<span class="file-icon" aria-hidden="true">
										{#if workspace.dirty.has(path)}<PencilLine size={15} />{:else}<FileCode
												size={15}
											/>{/if}
									</span>
									<span class="file-text">
										<span class="file-name">{fileName(path)}</span>
										<span class="file-meta">{fileMeta(path)}</span>
									</span>
									{#if workspace.dirty.has(path)}
										<Pill tone="warn">Edited</Pill>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				</section>
			</div>
		</div>
	</div>
</div>

<style>
	.home {
		height: 100%;
		overflow-y: auto;
		container-type: inline-size;
		background:
			radial-gradient(
				60rem 30rem at 50% -10rem,
				color-mix(in oklab, var(--accent) 6%, transparent),
				transparent 70%
			),
			var(--bg);
	}
	.page {
		--gutter: var(--space-4);
		display: grid;
		gap: var(--space-6);
		max-width: 78rem;
		margin: 0 auto;
		padding: var(--gutter) var(--gutter) var(--space-7);
	}
	@container (min-width: 40rem) {
		.page {
			--gutter: var(--space-6);
			gap: var(--space-6);
		}
	}

	/* ── Cards ─────────────────────────────────────────────────────────── */
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	@container (min-width: 40rem) {
		.card {
			padding: var(--space-5);
		}
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.badge {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid color-mix(in oklab, var(--fam) 30%, transparent);
		border-radius: var(--radius-md);
		background: linear-gradient(
			150deg,
			color-mix(in oklab, var(--fam) 20%, var(--surface)),
			color-mix(in oklab, var(--fam) 7%, var(--surface))
		);
		color: var(--fam);
	}
	.heading {
		flex: 1;
		min-width: 0;
	}
	h3 {
		font-size: var(--text-lg);
		font-weight: 650;
		letter-spacing: -0.015em;
	}
	h4 {
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.sub {
		display: flex;
		align-items: center;
		min-height: 1.25rem;
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		min-height: 2.25rem;
		padding: 0 var(--space-2);
		margin-right: calc(-1 * var(--space-2));
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--accent);
		font-weight: 600;
		cursor: pointer;
	}
	.link:hover {
		background: var(--accent-weak);
	}
	.skeleton {
		display: inline-block;
		flex: none;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
	.all-good {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ok);
		font-weight: 550;
	}
	.empty {
		color: var(--text-3);
	}

	/* ── Requirements ──────────────────────────────────────────────────── */
	.req-body {
		display: grid;
		gap: var(--space-5);
	}
	.rings-wrap {
		container-type: inline-size;
		min-width: 0;
	}
	.rings {
		display: grid;
		gap: var(--space-4);
	}
	@container (min-width: 26rem) {
		.rings {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: var(--space-3);
		}
	}
	.status {
		display: grid;
		align-content: start;
		gap: var(--space-3);
		min-height: 9.5rem;
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
	}
	@container (min-width: 52rem) {
		.req-body {
			grid-template-columns: minmax(0, 1.7fr) minmax(15rem, 1fr);
			align-items: start;
		}
		.status {
			padding: 0 0 0 var(--space-5);
			border-top: 0;
			border-left: 1px solid var(--border);
		}
	}
	.bar {
		display: flex;
		gap: 3px;
		height: 0.75rem;
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.segment {
		flex-basis: 0;
		min-width: 6px;
		transition: flex-grow 600ms var(--ease);
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
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.legend li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 1.25rem;
	}
	.n {
		color: var(--text-2);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	/* ── Columns ───────────────────────────────────────────────────────── */
	.columns,
	.side {
		display: grid;
		gap: var(--space-6);
		align-items: start;
		min-width: 0;
	}
	@container (min-width: 52rem) {
		.columns {
			grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
		}
	}
	.rows {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rows > li + li {
		border-top: 1px solid var(--border);
	}

	/* ── Needs attention ───────────────────────────────────────────────── */
	.attention {
		container-type: inline-size;
	}
	.gap-list {
		display: grid;
		gap: var(--space-3);
		min-height: 18rem;
		align-content: start;
	}
	.row-skeleton {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: 3rem;
	}
	.gap-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: var(--space-1) var(--space-3);
		width: calc(100% + 2 * var(--space-2));
		min-height: 3rem;
		margin: 0 calc(-1 * var(--space-2));
		padding: var(--space-2);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: background var(--duration) var(--ease);
	}
	.gap-row:hover {
		background: var(--surface-hover);
	}
	.id {
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--kind-requirement) 10%, var(--surface));
		color: color-mix(in oklab, var(--kind-requirement) 75%, var(--text));
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 550;
	}
	.tags {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	@container (min-width: 34rem) {
		.gap-row {
			grid-template-columns: 5rem minmax(0, 1fr) auto;
		}
		.id {
			justify-self: start;
		}
		.tags {
			grid-column: auto;
			flex-wrap: nowrap;
		}
	}
	.more {
		justify-self: start;
		margin-left: calc(-1 * var(--space-2));
	}

	/* ── Problems ──────────────────────────────────────────────────────── */
	.tallies {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.tally {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		column-gap: var(--space-2);
		align-items: center;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--text-2);
	}
	.tally.bad {
		background: var(--danger-weak);
		color: var(--danger);
	}
	.tally.warned {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.tally-n {
		display: flex;
		align-items: center;
		height: 2rem;
		font-size: 1.625rem;
		font-weight: 680;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
	}
	.tally-label {
		grid-column: 1 / -1;
		font-size: var(--text-sm);
		font-weight: 550;
	}
	.groups {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.group {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: calc(100% + 2 * var(--space-2));
		margin: 0 calc(-1 * var(--space-2));
		padding: var(--space-2);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.group:hover {
		background: var(--surface-hover);
	}
	.group::before {
		content: '';
		flex: none;
		align-self: stretch;
		width: 3px;
		border-radius: 2px;
		background: var(--warn);
	}
	.group.error::before {
		background: var(--danger);
	}
	.group-text {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.group-label {
		font-weight: 600;
		color: var(--text);
	}
	.group-example {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-3);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
	}
	.group-n {
		min-width: 1.75rem;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 650;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	/* ── Files ─────────────────────────────────────────────────────────── */
	.file-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: calc(100% + 2 * var(--space-2));
		min-height: 3rem;
		margin: 0 calc(-1 * var(--space-2));
		padding: var(--space-2);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.file-row:hover {
		background: var(--surface-hover);
	}
	.file-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--text-2);
	}
	.file-text {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.file-name,
	.file-meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file-name {
		font-weight: 550;
	}
	.file-meta {
		color: var(--text-3);
		font-size: var(--text-xs);
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
		.segment {
			transition: none;
		}
	}
</style>
