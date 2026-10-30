<script lang="ts">
	/**
	 * The project's baselines, in the GitHub sheet: versions frozen under a
	 * name at design reviews (SRR, PDR, CDR, …). Lists them newest first,
	 * compares the model with one (the review opens), marks the version the
	 * project is at as a new one, and removes one after asking. On GitHub a
	 * baseline is a tag; otherwise a copy of the files kept in this browser.
	 */
	import { onMount } from 'svelte';
	import {
		CircleAlert,
		Flag,
		GitCompareArrows,
		LoaderCircle,
		RefreshCw,
		Trash2
	} from '@lucide/svelte';
	import { SAVE_FIRST } from '#lib/project/baselines.svelte.ts';
	import { longDay, tagName, today, type Baseline } from '#lib/project/baselines.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { messageOf } from './errors.ts';

	let {
		session,
		reachable,
		oncompare
	}: {
		session: ProjectSession;
		/** GitHub can be reached as the project's account (signed in and online). */
		reachable: boolean;
		/** Opens the review of the changes since a baseline (shown when the host can). */
		oncompare?: (baseline: Baseline) => void;
	} = $props();

	const uid = $props.id();
	const baselines = $derived(session.baselines);
	const git = $derived(session.record?.git ?? null);
	const folder = $derived(session.record?.origin === 'folder');
	const status = $derived(baselines.status);
	/** Model changes not on GitHub yet: a tag can only name a version that is there. */
	const unsaved = $derived(baselines.unsaved);

	let name = $state('');
	let date = $state(today());
	let description = $state('');
	let error = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	let marking = $state(false);

	onMount(() => {
		if (git && reachable) void baselines.load();
	});

	async function mark(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		marking = true;
		try {
			const made = await baselines.mark({ name, date, description });
			name = '';
			description = '';
			date = today();
			toasts.show(
				made.where === 'github'
					? `Baseline ${made.name} marked: tagged ${made.tag} on GitHub.`
					: `Baseline ${made.name} marked.`,
				{ tone: 'success' }
			);
		} catch (e) {
			error = messageOf(e);
		} finally {
			marking = false;
		}
	}

	async function remove(baseline: Baseline) {
		error = null;
		try {
			await baselines.remove(baseline);
			confirming = null;
			toasts.show(`Baseline ${baseline.name} removed.`, { tone: 'success' });
		} catch (e) {
			error = messageOf(e);
		}
	}
</script>

{#snippet term(text: string)}<small class="term">{text}</small>{/snippet}

<section class="card baselines" aria-labelledby="{uid}-title">
	<div class="head">
		<h3 id="{uid}-title">
			<Flag size={17} aria-hidden="true" /> Baselines
			{#if git}{@render term('tags')}{/if}
		</h3>
		{#if git}
			<button
				type="button"
				class="icon"
				aria-label="List the baselines on GitHub again"
				title="List again"
				disabled={baselines.busy || !reachable}
				onclick={() => void baselines.load()}
			>
				<RefreshCw size={14} />
			</button>
		{/if}
	</div>
	<p class="muted">
		A baseline freezes the model under a name at a design review (SRR, PDR, CDR…), so you can see
		what changed since.
	</p>

	{#if error}
		<p class="alert" role="alert"><CircleAlert size={16} aria-hidden="true" /> {error}</p>
	{/if}
	{#if git && baselines.error}
		<!-- Quiet: it was asked for in passing, not by the person (and the sheet has its own alerts). -->
		<p class="muted">The baselines on GitHub couldn't be listed: {baselines.error}</p>
	{/if}

	{#if baselines.list.length}
		<ul class="list" aria-label="Baselines">
			{#each baselines.list as b (b.key)}
				{@const current = status?.baseline.key === b.key}
				<li data-baseline={b.name}>
					<div class="line">
						<strong>{b.name}</strong>
						{#if b.date}<span class="date">{longDay(b.date)}</span>{/if}
						{#if current && status?.exact}
							<span class="pill ok">The model is this baseline</span>
						{:else if current}
							<span class="pill">Changed since</span>
						{/if}
					</div>
					{#if b.description}<p class="description">{b.description}</p>{/if}
					<p class="where">
						{#if b.where === 'github'}Tag <code>{b.tag}</code> on GitHub · version
							<code>{b.commit?.slice(0, 7)}</code>
						{:else}Kept in this browser{/if}
					</p>
					{#if confirming === b.key}
						<div class="confirm" role="group" aria-label="Remove baseline {b.name}?">
							<p>
								{#if b.where === 'github'}
									Remove baseline <strong>{b.name}</strong>? This deletes the tag
									<code>{b.tag}</code> from {git?.owner}/{git?.repo} on GitHub, for everyone. The version
									itself stays in the history.
								{:else}
									Remove baseline <strong>{b.name}</strong>? Its copy of the files, kept in this
									browser, is deleted.
								{/if}
							</p>
							<div class="actions">
								<button type="button" class="danger" onclick={() => void remove(b)}>
									Remove
								</button>
								<button type="button" onclick={() => (confirming = null)}>Keep</button>
							</div>
						</div>
					{:else}
						<div class="actions">
							{#if oncompare}
								<button
									type="button"
									disabled={b.where === 'github' && !reachable}
									onclick={() => oncompare(b)}
								>
									<GitCompareArrows size={14} aria-hidden="true" /> Changes since {b.name}
								</button>
							{/if}
							<button
								type="button"
								aria-label="Remove baseline {b.name}"
								disabled={baselines.busy || (b.where === 'github' && !reachable)}
								onclick={() => (confirming = b.key)}
							>
								<Trash2 size={14} aria-hidden="true" /> Remove
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if git && baselines.busy}
		<p class="muted" role="status">
			<LoaderCircle size={14} class="spin" aria-hidden="true" /> Listing the baselines on GitHub…
		</p>
	{:else}
		<p class="muted calm">No baselines yet.</p>
	{/if}

	<details class="fold">
		<summary><strong>Mark a baseline</strong></summary>
		<form class="stack" onsubmit={mark}>
			<label>
				<span>Name</span>
				<input
					bind:value={name}
					placeholder="e.g. PDR"
					autocomplete="off"
					required
					maxlength="60"
				/>
			</label>
			<label>
				<span>Date</span>
				<input type="date" bind:value={date} required />
			</label>
			<label>
				<span>Description <small>(optional)</small></span>
				<textarea bind:value={description} rows="2" placeholder="e.g. As presented at the review"
				></textarea>
			</label>
			{#if unsaved}
				<p class="warn-note">
					<CircleAlert size={14} aria-hidden="true" />
					{SAVE_FIRST}
				</p>
			{/if}
			<button
				type="submit"
				class="primary"
				disabled={marking || !name.trim() || unsaved || (!!git && !reachable)}
			>
				{#if marking}<LoaderCircle size={16} class="spin" aria-hidden="true" />{:else}<Flag
						size={16}
						aria-hidden="true"
					/>{/if}
				Mark baseline
			</button>
			<p class="muted small">
				{#if git}
					Tags the version on GitHub you're at (<code>{git.base.slice(0, 7)}</code>){name.trim()
						? ` as ${tagName(name)}`
						: ''}, for everyone with the repository.
				{:else if folder}
					Keeps a copy of the files as they are now with the project in this browser. Nothing is
					written to the folder. To share baselines with your team, save the project to GitHub.
				{:else}
					Keeps a copy of the files as they are now with the project in this browser. To share
					baselines with your team, save the project to GitHub.
				{/if}
			</p>
		</form>
	</details>
</section>

<style>
	.card {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-lg);
	}
	h3 :global(svg) {
		color: var(--accent);
	}
	.term {
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 400;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	.muted {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.small {
		display: block;
		font-size: var(--text-xs);
	}
	.calm {
		padding: var(--space-3);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}
	.alert,
	.warn-note {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}
	.alert {
		background: var(--danger-weak);
	}
	.alert :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--danger);
	}
	.warn-note {
		background: var(--warn-weak);
	}
	.warn-note :global(svg) {
		flex: none;
		margin-top: 3px;
	}
	.list {
		display: grid;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		list-style: none;
	}
	.list li {
		display: grid;
		gap: 4px;
		padding: var(--space-3);
	}
	.list li + li {
		border-top: 1px solid var(--border);
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-2);
	}
	.date,
	.where {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.where {
		font-size: var(--text-xs);
	}
	.description {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.pill {
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--warn-weak);
		color: var(--warn);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.pill.ok {
		background: var(--ok-weak);
		color: var(--ok);
	}
	.confirm {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: 2px;
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.actions .danger {
		border-color: transparent;
		background: var(--danger);
		color: var(--surface);
	}
	.fold summary {
		display: flex;
		align-items: center;
		min-height: 2.5rem;
		cursor: pointer;
	}
	.stack {
		display: grid;
		gap: var(--space-3);
		padding-top: var(--space-2);
	}
	.stack label {
		display: grid;
		gap: 4px;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	label small {
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 400;
	}
	input,
	textarea {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		resize: vertical;
	}
	input {
		height: 2.5rem;
		padding-block: 0;
	}
	input:focus,
	textarea:focus {
		border-color: var(--accent);
		outline: 0;
		box-shadow: 0 0 0 3px var(--accent-weak);
	}
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		justify-self: start;
		gap: var(--space-2);
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	code {
		padding: 0 4px;
		border-radius: 4px;
		background: var(--surface-2);
	}
</style>
