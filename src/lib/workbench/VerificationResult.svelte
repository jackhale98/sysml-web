<script lang="ts">
	/**
	 * A verification case's recorded result, in the inspector: the verdict,
	 * when and by whom it was run, the commit it was run against and whether
	 * it still holds for the model as it is, and the evidence; and **Record a
	 * result**, which writes the case's `@VerificationResult` as one undoable
	 * step (the results library comes with the first one).
	 */
	import { ClipboardCheck } from '@lucide/svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Tone } from '#lib/project/status.ts';
	import {
		freshness,
		shortCommit,
		VERDICT_LABEL,
		VERDICTS,
		type Freshness,
		type Verdict
	} from '#lib/project/verification.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import Pill from '#lib/ui/Pill.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { recordResult } from './results.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';

	let { element, workspace, ui }: { element: ModelElement; workspace: Workspace; ui: WorkbenchUi } =
		$props();

	const uid = $props.id();
	const result = $derived(
		(element.id ? workspace.results.get(element.id) : undefined) ??
			workspace.results.get(element.label) ??
			null
	);
	const fresh = $derived(result ? freshness(result, workspace.revision) : null);
	const revision = $derived(workspace.revision);

	const VERDICT_TONE: Record<Verdict, Tone> = {
		pass: 'ok',
		fail: 'danger',
		inconclusive: 'warn',
		error: 'danger'
	};
	const FRESH_TONE: Record<Freshness['state'], string> = {
		current: 'ok',
		stale: 'warn',
		checking: 'muted',
		unknown: 'muted'
	};

	let open = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let verdict = $state<Verdict>('pass');
	let date = $state('');
	let runBy = $state('');
	let commit = $state('');
	let evidence = $state('');

	/** Today, as the date field writes it. */
	const today = () => {
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	};

	/** What the commit field starts with, and what it says about it. */
	const commitHint = $derived.by(() => {
		if (!revision?.commit)
			return 'Not connected to GitHub: type the commit it was run against, if you know it. Without one, whether the result still holds can’t be told.';
		if (revision.changed)
			return `The model has changed since ${shortCommit(revision.commit)} and isn’t saved to GitHub yet: save it first so the result names the commit it was run against, or type that commit.`;
		return `The model as it is: ${shortCommit(revision.commit)}${revision.branch ? ` on ${revision.branch}` : ''}.`;
	});

	function start() {
		verdict = result?.verdict ?? 'pass';
		date = today();
		runBy = revision?.login ?? result?.runBy ?? '';
		commit = revision?.commit && !revision.changed ? revision.commit : '';
		evidence = '';
		error = null;
		open = true;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		const recorded = element;
		error = await recordResult(workspace, recorded, { verdict, date, runBy, commit, evidence });
		busy = false;
		if (error) {
			toasts.show(error, { tone: 'error' });
			return;
		}
		open = false;
		// An import above it moves the case in its file: keep it selected once it is read again.
		for (let i = 0; i < 100 && !workspace.settled; i++) await new Promise((r) => setTimeout(r, 80));
		const moved = workspace.elements.find(
			(e) => e.id === recorded.id && e.key !== recorded.key && e.kind === recorded.kind
		);
		if (moved && ui.selection?.key === recorded.key) ui.select(moved.key, 'inspector');
	}

	const isLink = (text: string) => /^https?:\/\//i.test(text);
</script>

<section aria-labelledby="{uid}-heading">
	<h3 id="{uid}-heading">Result</h3>
	{#if result}
		<p class="verdict">
			<Pill tone={result.verdict ? VERDICT_TONE[result.verdict] : 'warn'}
				>{result.verdict ? VERDICT_LABEL[result.verdict] : 'Unreadable verdict'}</Pill
			>
			{#if result.date}<span>on {result.date}</span>{/if}
			{#if result.runBy}<span>by {result.runBy}</span>{/if}
		</p>
		{#if fresh}
			<p class="fresh {FRESH_TONE[fresh.state]}" role="status">{fresh.text}</p>
		{/if}
		{#if result.evidence}
			<p class="evidence">
				Evidence:
				{#if isLink(result.evidence)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
					<a href={result.evidence} target="_blank" rel="noopener noreferrer">{result.evidence}</a>
				{:else}{result.evidence}{/if}
			</p>
		{/if}
	{:else}
		<p class="none">Not run yet: no result is recorded.</p>
	{/if}

	{#if !open}
		<button type="button" class="add" onclick={start}>
			<ClipboardCheck size={14} aria-hidden="true" />
			{result ? 'Record a new result' : 'Record a result'}
		</button>
	{:else}
		<form class="form" onsubmit={save} aria-label="Record a result for {element.label}">
			<fieldset>
				<legend>Verdict</legend>
				<div class="verdicts">
					{#each VERDICTS as v (v)}
						<label class="choice">
							<input type="radio" name="{uid}-verdict" value={v} bind:group={verdict} />
							{VERDICT_LABEL[v]}
						</label>
					{/each}
				</div>
			</fieldset>
			<label for="{uid}-date">Date</label>
			<input id="{uid}-date" type="date" required bind:value={date} />
			<label for="{uid}-by">Run by</label>
			<input id="{uid}-by" bind:value={runBy} autocomplete="name" />
			<label for="{uid}-commit">Commit of the model</label>
			<input
				id="{uid}-commit"
				class="mono"
				bind:value={commit}
				spellcheck="false"
				aria-describedby="{uid}-commit-hint"
			/>
			<p id="{uid}-commit-hint" class="hint">{commitHint}</p>
			<label for="{uid}-evidence">Evidence</label>
			<input
				id="{uid}-evidence"
				bind:value={evidence}
				placeholder="A link to the test report, or where it is kept"
			/>
			{#if result}
				<p class="hint">
					It replaces the result recorded now; the earlier one stays in the history.
				</p>
			{/if}
			<div class="buttons">
				<button type="submit" class="primary" disabled={busy}>Record</button>
				<button type="button" class="cancel" onclick={() => (open = false)}>Cancel</button>
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</form>
	{/if}
</section>

<style>
	h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	p {
		margin: 0 0 var(--space-1);
	}
	.verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.fresh {
		font-size: var(--text-xs);
	}
	.fresh.ok {
		color: var(--ok);
	}
	.fresh.warn {
		color: var(--warn);
	}
	.fresh.muted,
	.none,
	.hint {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.evidence {
		overflow-wrap: anywhere;
		color: var(--text-2);
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2.25rem;
		margin-top: var(--space-1);
		padding: 0 var(--space-3);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.add:hover {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.form {
		display: grid;
		gap: var(--space-1);
		margin-top: var(--space-1);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 8px);
		background: var(--surface);
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend,
	label {
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 550;
	}
	.verdicts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}
	.choice {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 2.25rem;
		font-weight: normal;
		font-size: var(--text-sm);
		color: var(--text);
	}
	input:not([type='radio']) {
		width: 100%;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: 16px; /* no zoom on iPhone */
	}
	.mono {
		font-family: var(--font-mono);
	}
	.buttons {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
		margin-top: var(--space-1);
	}
	.buttons button {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-2);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.buttons .primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.error {
		color: var(--danger);
	}
</style>
