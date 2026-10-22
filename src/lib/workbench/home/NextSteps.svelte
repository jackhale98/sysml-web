<script lang="ts">
	import { Circle, CircleCheck, Footprints, X } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { runGuideAction, type GuideAction } from '../guide.ts';
	import type { WorkbenchUi } from '../ui.svelte.ts';
	import {
		countModel,
		doneSteps,
		readNextSteps,
		STEP_ORDER,
		writeNextSteps,
		type NextStepsState,
		type StepId
	} from './nextSteps.ts';

	/**
	 * A new project's first steps, each ticked by the model itself as it is
	 * done, with a button that opens the form or place for it. Put away with
	 * the close button (remembered for the project); not shown for the demo,
	 * or for projects opened from GitHub, a folder or a file.
	 */
	let {
		workspace,
		ui,
		engine,
		session
	}: { workspace: Workspace; ui: WorkbenchUi; engine: Engine; session: ProjectSession } = $props();

	const record = $derived(session.record);
	const projectId = $derived(record?.origin === 'new' ? record.id : null);

	let remembered = $state<NextStepsState>({});
	$effect(() => {
		const id = projectId;
		if (!id) return;
		remembered = readNextSteps(id);
		// A copy downloaded from the project menu ticks "Keep a copy".
		const reread = () => (remembered = readNextSteps(id));
		window.addEventListener('fairtide:next-steps', reread);
		return () => window.removeEventListener('fairtide:next-steps', reread);
	});

	/** What the model has now, once it is read and checked. */
	const counts = $derived(
		projectId && workspace.state.phase === 'ready' && workspace.checks
			? countModel(workspace)
			: null
	);
	// What the project started with: taken the first time the steps can be counted.
	$effect(() => {
		if (projectId && counts && !remembered.start && workspace.settled)
			remembered = writeNextSteps(projectId, { start: counts });
	});

	const done = $derived(
		counts && remembered.start
			? doneSteps(counts, remembered.start, {
					github: !!record?.git,
					downloaded: !!remembered.downloaded
				})
			: null
	);
	const doneCount = $derived(done ? STEP_ORDER.filter((s) => done[s]).length : 0);
	const shown = $derived(!!projectId && !!done && !remembered.dismissed);
	/** The first step not done yet: its button stands out, and on a phone only it is explained. */
	const current = $derived(done ? STEP_ORDER.find((s) => !done[s]) : undefined);

	const requirementsFirst = $derived(record?.template === 'requirements');

	interface Step {
		id: StepId;
		title: string;
		hint: string;
		actions: { label: string; action: GuideAction; primary?: boolean }[];
	}
	const steps = $derived.by((): Step[] => [
		requirementsFirst
			? {
					id: 'requirement',
					title: 'Bring in your requirements',
					hint: 'From an Excel or CSV file, or one at a time.',
					actions: [
						{ label: 'Import from a spreadsheet', action: 'import-requirements', primary: true },
						{ label: 'Add one', action: 'add-requirement' }
					]
				}
			: {
					id: 'requirement',
					title: 'Write a requirement',
					hint: 'What must it do? A “shall” sentence with an ID.',
					actions: [
						{ label: 'Add', action: 'add-requirement', primary: true },
						{ label: 'Import', action: 'import-requirements' }
					]
				},
		{
			id: 'part',
			title: 'Add a part',
			hint: 'What is it made of? A battery, a frame, a circuit board.',
			actions: [{ label: 'Add', action: 'add-part', primary: true }]
		},
		{
			id: 'link',
			title: 'Link a part to a requirement',
			hint: 'Say which part meets it (a “satisfy” link).',
			actions: [{ label: 'Show me', action: 'link', primary: true }]
		},
		{
			id: 'view',
			title: 'Make a view',
			hint: 'A table, diagram, budget or report, saved in the model.',
			actions: [{ label: 'New view', action: 'new-view', primary: true }]
		},
		{
			id: 'numbers',
			title: 'Add up a value or set a limit',
			hint: 'Sum a mass over the parts, or check it against a maximum.',
			actions: [
				{ label: 'Add up', action: 'rollup', primary: true },
				{ label: 'Set a limit', action: 'limit' }
			]
		},
		{
			id: 'keep',
			title: 'Keep a copy',
			hint: 'Save it to GitHub to share it, or download a .kpar file.',
			actions: [
				{ label: 'Save to GitHub', action: 'save-github', primary: true },
				{ label: 'Download', action: 'download' }
			]
		}
	]);

	function dismiss() {
		if (projectId) remembered = writeNextSteps(projectId, { dismissed: true });
	}

	function run(action: GuideAction) {
		void runGuideAction(action, { ui, workspace, engine, session });
	}
</script>

{#if shown && done}
	<section class="card next-steps" aria-labelledby="next-steps-heading">
		<header class="head">
			<span class="badge" aria-hidden="true"><Footprints size={16} /></span>
			<div class="heading">
				<h3 id="next-steps-heading">Next steps</h3>
				<p class="sub">
					{doneCount === STEP_ORDER.length
						? 'All done. You know your way around.'
						: `${doneCount} of ${STEP_ORDER.length} done`}
				</p>
			</div>
			<button
				type="button"
				class="close"
				aria-label="Hide next steps"
				title="Hide next steps"
				onclick={dismiss}
			>
				<X size={18} />
			</button>
		</header>
		<div
			class="meter"
			role="progressbar"
			aria-label="Next steps done"
			aria-valuemin={0}
			aria-valuemax={STEP_ORDER.length}
			aria-valuenow={doneCount}
		>
			<span style:width="{(doneCount / STEP_ORDER.length) * 100}%"></span>
		</div>
		<ol class="steps">
			{#each steps as step (step.id)}
				{@const ticked = done[step.id]}
				<li class:ticked class:current={current === step.id} data-step={step.id}>
					<span class="mark" aria-hidden="true">
						{#if ticked}<CircleCheck size={20} />{:else}<Circle size={20} />{/if}
					</span>
					<span class="text">
						<strong
							>{step.title}<span class="visually-hidden">{ticked ? ', done' : ''}</span></strong
						>
						<span class="hint">{step.hint}</span>
					</span>
					{#if !ticked}
						<span class="actions">
							{#each step.actions as a (a.action)}
								<button
									type="button"
									class="action"
									class:primary={a.primary && current === step.id}
									onclick={() => run(a.action)}>{a.label}</button
								>
							{/each}
						</span>
					{/if}
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
		border-radius: var(--radius-lg);
		background: linear-gradient(160deg, var(--accent-weak), var(--surface) 45%);
		box-shadow: var(--shadow-sm);
	}
	@container (min-width: 40rem) {
		.card {
			padding: var(--space-5);
		}
	}
	.head {
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
		border-radius: var(--radius-md);
		background: var(--accent);
		color: var(--accent-text);
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
	.sub {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.close {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) 0 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.meter {
		height: 0.375rem;
		overflow: hidden;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
	}
	.meter span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--ok);
		transition: width 300ms var(--ease, ease);
	}
	.steps {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border);
	}
	li:first-child {
		border-top: 0;
	}
	.mark {
		display: grid;
		flex: none;
		place-items: center;
		color: var(--text-3);
	}
	.ticked .mark {
		color: var(--ok);
	}
	.current .mark {
		color: var(--accent);
	}
	.text {
		display: grid;
		flex: 1 1 11rem;
		gap: 1px;
		min-width: 0;
	}
	.text strong {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.ticked .text strong {
		color: var(--text-2);
		font-weight: 500;
	}
	.hint {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.ticked .hint {
		display: none;
	}
	/* Narrow: one line a step, and only the next step explained. */
	@container (max-width: 40rem) {
		li:not(.current) .hint {
			display: none;
		}
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-left: auto;
	}
	.action {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.action:hover {
		background: var(--surface-hover);
	}
	.action.primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--accent-text);
	}
	.action.primary:hover {
		filter: brightness(1.05);
	}
</style>
