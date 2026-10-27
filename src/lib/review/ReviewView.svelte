<script lang="ts">
	import TesseraLoader from '#lib/ui/TesseraLoader.svelte';
	/**
	 * Review changes: what changed in the model between two versions, in
	 * plain language and grouped as an engineer reads a change — what it
	 * does to the requirement checks and budgets first, then Requirements,
	 * Design, Behaviour, Verification, Risk and Other. Each change selects
	 * its element, opens it in the text or a diagram, and shows the text
	 * that changed. Diagrams and tables mark what is new or changed while
	 * the review is open.
	 */
	import { onMount } from 'svelte';
	import {
		CircleCheck,
		Code,
		FileDiff,
		GitCompareArrows,
		Network,
		RefreshCw,
		Stamp,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { accounts } from '#lib/git/account.svelte.ts';
	import DiffView from '#lib/git/DiffView.svelte';
	import type { CommitSummary, PullRequestSummary } from '#lib/git/types.ts';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { MARK_WORDS, reviewMarks } from './marks.svelte.ts';
	import { review, type ReviewSource } from './review.svelte.ts';
	import type { ReviewItem } from './summary.ts';
	import type { Location } from './types.ts';

	let {
		workspace,
		ui,
		engine,
		session
	}: { workspace: Workspace; ui: WorkbenchUi; engine: Engine; session?: ProjectSession } = $props();

	const uid = $props.id();
	const git = $derived(session?.record?.git ?? null);
	const summary = $derived(review.summary);
	const reachable = $derived(!!accounts.accountFor(git?.account) && pwa.online);

	let open = $state<string | null>(null);
	let pulls = $state.raw<PullRequestSummary[] | null>(null);
	let commits = $state.raw<CommitSummary[] | null>(null);
	let choicesError = $state<string | null>(null);

	onMount(() => {
		if (review.status === 'idle' || review.status === 'error')
			void review.start({ workspace, session, engine });
		// What else there is to compare with: proposals and earlier versions.
		void loadChoices();
	});

	/** The choice in the "Compare" menu. */
	const choice = $derived.by(() => {
		const s = review.source;
		return s.kind === 'commit'
			? `commit:${s.commit.sha}`
			: s.kind === 'pull'
				? `pull:${s.pr.number}`
				: s.kind;
	});

	async function loadChoices() {
		if (!git || !reachable || (pulls && commits)) return;
		choicesError = null;
		try {
			const provider = accounts.provider(git.account);
			const ref = { owner: git.owner, repo: git.repo };
			[pulls, commits] = await Promise.all([
				provider.listPullRequests(ref),
				provider.listCommits(ref, git.branch, 15)
			]);
		} catch (error) {
			choicesError = error instanceof Error ? error.message : String(error);
			pulls ??= [];
			commits ??= [];
		}
	}

	function choose(value: string) {
		let source: ReviewSource = { kind: 'local' };
		if (value === 'branch') source = { kind: 'branch' };
		else if (value.startsWith('commit:')) {
			const commit = commits?.find((c) => `commit:${c.sha}` === value);
			if (commit) source = { kind: 'commit', commit };
		} else if (value.startsWith('pull:')) {
			const pr = pulls?.find((p) => `pull:${p.number}` === value);
			if (pr) source = { kind: 'pull', pr };
		}
		open = null;
		void review.start({ workspace, session, engine }, source);
	}

	const elementById = (id: string | null): ModelElement | undefined =>
		id ? workspace.elements.find((e) => e.id === id) : undefined;

	/** Select the change's element: the inspector shows it, diagrams and the text highlight it. */
	function select(item: ReviewItem) {
		const element = elementById(item.target);
		if (element) ui.select(element.key, 'explorer');
		else if (item.after && review.currentFiles === null) showText(item.after);
	}

	function showText(at: Location) {
		ui.revealText(at.path, at.from, at.to);
	}

	/** The package diagram an element is drawn in. */
	function diagramOf(item: ReviewItem): { scope: string; title: string } | null {
		if (review.currentFiles !== null) return null;
		const element = elementById(item.target);
		if (!element) return null;
		const root = workspace.tree.find(
			(n) => n.element.file === element.file && n.element.kind === 'package'
		);
		return root ? { scope: root.element.name, title: root.element.label } : null;
	}

	function showDiagram(item: ReviewItem) {
		const target = diagramOf(item);
		if (!target) return;
		ui.open({ kind: 'diagram', view: 'general', scope: target.scope, title: target.title });
		const element = elementById(item.target);
		if (element) ui.select(element.key, 'diagram');
	}

	/** The whole lines a location covers, and the number of the first. */
	function excerpt(text: string | undefined, at: Location | null): { text: string; line: number } {
		if (!text || !at) return { text: '', line: 1 };
		const start = text.lastIndexOf('\n', Math.max(0, at.from - 1)) + 1;
		const endAt = text.indexOf('\n', Math.max(at.to - 1, start));
		return { text: text.slice(start, endAt < 0 ? text.length : endAt + 1), line: at.line };
	}

	async function markReviewed() {
		await review.markReviewed();
		toasts.show('Marked as reviewed. Later changes are compared with this version.', {
			tone: 'success'
		});
	}

	function close() {
		reviewMarks.end();
		const index = ui.tabs.findIndex((t) => t.kind === 'review');
		if (index >= 0) ui.close(index);
	}

	const TONE_LABEL: Record<ReviewItem['tone'], string> = {
		added: 'added',
		removed: 'removed',
		changed: 'changed',
		renamed: 'changed',
		moved: 'changed',
		fails: 'fails',
		meets: 'meets',
		impact: 'impact'
	};

	const counts = $derived(summary?.counts ?? { added: 0, removed: 0, changed: 0, failing: 0 });
	const total = $derived(counts.added + counts.removed + counts.changed);
</script>

{#snippet rich(text: string)}{#each text.split('`') as part, i (i)}{#if i % 2}<code>{part}</code
			>{:else}{part}{/if}{/each}{/snippet}

{#snippet change(item: ReviewItem)}
	{@const diagram = diagramOf(item)}
	{@const isOpen = open === item.key}
	{@const target = elementById(item.target)}
	<!-- A check, value or total changed because of other changes: its own text didn't. -->
	{@const textual = /^(element|relation):/.test(item.key)}
	<li class="item {TONE_LABEL[item.tone]}" data-change={item.key}>
		<div class="line">
			<span class="badge {TONE_LABEL[item.tone]}">{item.badge}</span>
			{#if target || (item.after && review.currentFiles === null)}
				<button
					type="button"
					class="sentence"
					class:selected={!!target && ui.selection?.key === target.key}
					onclick={() => select(item)}
					title={target ? `Select ${target.label}` : 'Show it in the text'}
					>{@render rich(item.text)}</button
				>
			{:else}
				<span class="sentence">{@render rich(item.text)}</span>
			{/if}
		</div>
		{#if item.details.length}
			<ul class="details">
				{#each item.details as detail, i (i)}<li>{@render rich(detail)}</li>{/each}
			</ul>
		{/if}
		{#if item.before || item.after}
			<div class="actions">
				{#if textual}
					<button
						type="button"
						aria-expanded={isOpen}
						aria-controls="{uid}-snippet-{item.key}"
						onclick={() => (open = isOpen ? null : item.key)}
					>
						<FileDiff size={14} aria-hidden="true" />
						{isOpen ? 'Hide' : 'Show'} the text change
					</button>
				{/if}
				{#if item.after && review.currentFiles === null}
					<button type="button" onclick={() => showText(item.after!)}>
						<Code size={14} aria-hidden="true" /> Open in text
					</button>
				{/if}
				{#if diagram}
					<button type="button" onclick={() => showDiagram(item)}>
						<Network size={14} aria-hidden="true" /> Show in diagram
					</button>
				{/if}
			</div>
		{/if}
		{#if isOpen && textual}
			{@const before = excerpt(
				item.before ? review.baseFiles[item.before.path] : undefined,
				item.before
			)}
			{@const after = excerpt(
				item.after ? review.currentText(item.after.path) : undefined,
				item.after
			)}
			<div class="snippet" id="{uid}-snippet-{item.key}">
				<DiffView
					before={before.text || null}
					after={after.text || null}
					oldStart={before.line}
					newStart={after.line}
					oldLabel="Before"
					newLabel="Now"
				/>
			</div>
		{/if}
	</li>
{/snippet}

<section class="review" aria-labelledby="{uid}-title">
	<header class="head">
		<div class="title-row">
			<span class="mark" aria-hidden="true"><GitCompareArrows size={18} /></span>
			<h2 id="{uid}-title">Review changes</h2>
			<button
				type="button"
				class="icon"
				aria-label="Compare again"
				title="Compare again"
				disabled={review.status === 'loading'}
				onclick={() => void review.start({ workspace, session, engine }, review.source)}
			>
				<RefreshCw size={16} />
			</button>
			<button
				type="button"
				class="icon"
				aria-label="End the review"
				title="End the review"
				onclick={close}
			>
				<X size={17} />
			</button>
		</div>
		<p class="comparing">
			Comparing <strong>{review.subject}</strong> with
			<strong>{review.against || '…'}</strong>.
		</p>
		{#if git}
			<label class="compare">
				<span>Compare</span>
				<select
					value={choice}
					onfocus={loadChoices}
					onpointerdown={loadChoices}
					onchange={(e) => choose(e.currentTarget.value)}
				>
					<option value="local">Your changes, not yet on GitHub</option>
					{#if git.branch !== git.defaultBranch}
						<option value="branch" disabled={!reachable}
							>Everything on “{git.branch}”, with {git.defaultBranch}</option
						>
					{/if}
					{#if review.source.kind === 'commit'}
						<option value={choice}>Since “{review.source.commit.title}”</option>
					{/if}
					{#if review.source.kind === 'pull'}
						<option value={choice}>Proposal #{review.source.pr.number}</option>
					{/if}
					{#if commits?.length}
						<optgroup label="Since an earlier version">
							{#each commits.filter((c) => `commit:${c.sha}` !== choice) as c (c.sha)}
								<option value="commit:{c.sha}">{c.title} · {c.sha.slice(0, 7)}</option>
							{/each}
						</optgroup>
					{/if}
					{#if pulls?.length}
						<optgroup label="A proposal (pull request)">
							{#each pulls.filter((p) => `pull:${p.number}` !== choice) as p (p.number)}
								<option value="pull:{p.number}">#{p.number} {p.title}</option>
							{/each}
						</optgroup>
					{/if}
				</select>
			</label>
			{#if !reachable}
				<p class="hint">Connect to GitHub (and be online) to compare branches and proposals.</p>
			{:else if choicesError}
				<p class="hint">{choicesError}</p>
			{/if}
		{/if}
		{#if review.status === 'ready' && summary && !summary.empty}
			<div class="toolbar">
				<p class="counts" aria-label="{total} changes">
					{#if counts.added}<span class="count added">{counts.added} added</span>{/if}
					{#if counts.removed}<span class="count removed">{counts.removed} removed</span>{/if}
					{#if counts.changed}<span class="count changed">{counts.changed} changed</span>{/if}
				</p>
				<button
					type="button"
					class="switch"
					aria-pressed={reviewMarks.visible}
					onclick={() => (reviewMarks.visible = !reviewMarks.visible)}
				>
					<span class="track" aria-hidden="true"><span class="thumb"></span></span>
					Mark changes in diagrams and tables
				</button>
			</div>
			{#if reviewMarks.visible}
				<p class="legend">
					<span class="key added">{MARK_WORDS.added.badge}</span> added
					<span class="key changed">{MARK_WORDS.changed.badge}</span> changed or has changes inside
					<span class="sep" aria-hidden="true">·</span> removed elements are listed, not drawn
				</p>
			{/if}
		{/if}
	</header>

	<div class="body">
		{#if review.status === 'loading' || review.status === 'idle'}
			<div class="state" role="status">
				<TesseraLoader size={40} label="" />
				<span>
					{#if review.progress}Getting the other version from GitHub… {review.progress.done}/{review
							.progress.total}
					{:else}Comparing the two versions of the model…{/if}
				</span>
			</div>
			<div class="skeleton" aria-hidden="true">
				{#each [0, 1, 2, 3] as i (i)}<div></div>{/each}
			</div>
		{:else if review.status === 'error'}
			<div class="alert" role="alert">
				<TriangleAlert size={16} aria-hidden="true" />
				<p>The versions couldn't be compared: {review.error}</p>
			</div>
		{:else if summary?.empty}
			<div class="empty">
				<span class="art" aria-hidden="true"><CircleCheck size={28} /></span>
				<h3>No changes to the model</h3>
				<p>
					The model is the same as {review.against}. Changes to comments or layout alone don't
					change it.
				</p>
			</div>
		{:else if summary}
			{#if summary.impact.length}
				<section class="group impact" aria-labelledby="{uid}-impact">
					<h3 id="{uid}-impact">What it changes</h3>
					<ul class="items">
						{#each summary.impact as item (item.key)}{@render change(item)}{/each}
					</ul>
				</section>
			{/if}
			{#each summary.groups as group (group.category)}
				<section class="group" aria-labelledby="{uid}-{group.category}">
					<h3 id="{uid}-{group.category}">
						{group.title} <span class="n">{group.items.length}</span>
					</h3>
					<ul class="items">
						{#each group.items as item (item.key)}{@render change(item)}{/each}
					</ul>
				</section>
			{/each}
			{#if review.comparison?.diff.brokenFiles.length}
				<p class="note">
					<TriangleAlert size={14} aria-hidden="true" />
					{review.comparison.diff.brokenFiles.join(', ')}
					{review.comparison.diff.brokenFiles.length === 1 ? 'has' : 'have'} a syntax error; the broken
					part is left out of the comparison.
				</p>
			{/if}
		{/if}
		{#if review.canMarkReviewed && review.status === 'ready' && !summary?.empty}
			<div class="reviewed">
				<button type="button" onclick={markReviewed}>
					<Stamp size={15} aria-hidden="true" /> Mark as reviewed
				</button>
				<span>Later changes will be compared with the version you have now.</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.review {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg);
	}
	.head {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5) var(--space-3);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.mark {
		display: grid;
		flex: none;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		background: var(--accent-weak);
		color: var(--accent);
	}
	h2 {
		flex: 1;
		font-size: var(--text-xl);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--text);
	}
	.icon:disabled {
		opacity: 0.45;
	}
	.comparing {
		color: var(--text-2);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.comparing strong {
		color: var(--text);
		font-weight: 600;
	}
	.compare {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.compare span {
		color: var(--text-2);
	}
	.compare select {
		flex: 1 1 14rem;
		min-width: 0;
		max-width: 100%;
		min-height: 2.25rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.count {
		padding: 1px var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.count.added {
		background: var(--ok-weak);
		color: var(--ok);
	}
	.count.removed {
		background: var(--danger-weak);
		color: var(--danger);
	}
	.count.changed {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.25rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.track {
		position: relative;
		flex: none;
		width: 2rem;
		height: 1.125rem;
		border-radius: var(--radius-pill);
		background: var(--border-strong);
		transition: background var(--duration) var(--ease);
	}
	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: calc(1.125rem - 4px);
		height: calc(1.125rem - 4px);
		border-radius: 50%;
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		transition: transform var(--duration) var(--ease);
	}
	.switch[aria-pressed='true'] .track {
		background: var(--accent);
	}
	.switch[aria-pressed='true'] .thumb {
		transform: translateX(0.875rem);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.key {
		padding: 0 6px;
		border: 1.5px solid;
		border-radius: var(--radius-pill);
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.key.added {
		border-color: var(--ok);
		color: var(--ok);
	}
	.key.changed {
		border-color: var(--warn);
		color: var(--warn);
	}
	.legend .sep {
		margin: 0 2px;
	}
	.body {
		display: grid;
		flex: 1;
		align-content: start;
		gap: var(--space-5);
		min-height: 0;
		padding: var(--space-4) var(--space-5) var(--space-7);
		overflow: auto;
		overscroll-behavior: contain;
	}
	.state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.skeleton {
		display: grid;
		gap: var(--space-2);
	}
	.skeleton div {
		height: 3rem;
		border-radius: var(--radius-md);
		background: linear-gradient(90deg, var(--surface-2), var(--surface), var(--surface-2));
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	.alert {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--danger-weak);
		font-size: var(--text-sm);
	}
	.alert :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--danger);
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		padding: var(--space-7) var(--space-4);
		text-align: center;
	}
	.empty p {
		max-width: 40ch;
		color: var(--text-2);
	}
	.art {
		display: grid;
		place-items: center;
		width: 4rem;
		height: 4rem;
		border-radius: 1.25rem;
		background: linear-gradient(145deg, var(--ok-weak), var(--surface));
		color: var(--ok);
		box-shadow: var(--shadow-md);
	}
	.group h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.n {
		display: inline-grid;
		place-items: center;
		min-width: 1.4rem;
		height: 1.15rem;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: 11px;
		letter-spacing: 0;
	}
	.items {
		display: grid;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		list-style: none;
	}
	.impact .items {
		border-color: color-mix(in oklab, var(--accent) 30%, var(--border));
	}
	.item {
		display: grid;
		gap: 6px;
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		border-left: 3px solid transparent;
	}
	.item + .item {
		border-top: 1px solid var(--border);
	}
	.item.added {
		border-left-color: var(--ok);
	}
	.item.removed,
	.item.fails {
		border-left-color: var(--danger);
	}
	.item.changed {
		border-left-color: var(--warn);
	}
	.item.meets {
		border-left-color: var(--ok);
	}
	.item.impact {
		border-left-color: var(--accent);
	}
	.line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}
	.badge {
		flex: none;
		padding: 1px 7px;
		border-radius: var(--radius-pill);
		font-size: 11px;
		font-weight: 700;
		white-space: nowrap;
	}
	.badge.added,
	.badge.meets {
		background: var(--ok-weak);
		color: var(--ok);
	}
	.badge.removed,
	.badge.fails {
		background: var(--danger-weak);
		color: var(--danger);
	}
	.badge.changed {
		background: var(--warn-weak);
		color: var(--warn);
	}
	.badge.impact {
		background: var(--accent-weak);
		color: var(--accent);
	}
	.sentence {
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
		line-height: 1.5;
		text-align: left;
		overflow-wrap: anywhere;
	}
	button.sentence {
		cursor: pointer;
	}
	button.sentence:hover {
		color: var(--accent);
	}
	button.sentence.selected {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.sentence code,
	.details code {
		padding: 0 3px;
		border-radius: 4px;
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 0.92em;
	}
	.details {
		display: grid;
		gap: 2px;
		margin: 0 0 0 var(--space-2);
		padding-left: var(--space-4);
		color: var(--text-2);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 2px var(--space-3);
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.75rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.actions button:hover {
		color: var(--accent);
	}
	.snippet {
		min-width: 0;
	}
	.note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.reviewed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding-top: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.reviewed button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.reviewed button:hover {
		background: var(--surface-hover);
	}
	@media (max-width: 640px) {
		/* One scroll for the whole review, so the list gets the screen. */
		.review {
			overflow: auto;
			overscroll-behavior: contain;
		}
		.body {
			flex: none;
			overflow: visible;
		}
		.head {
			padding: var(--space-3) var(--space-4);
		}
		.body {
			padding: var(--space-3) var(--space-4) var(--space-7);
		}
		.item {
			padding: var(--space-3);
		}
	}
</style>
