<script lang="ts">
	/**
	 * Save a filtered table as a view: a usage of the same view def, over
	 * what the table showed, with the filters as the `where` of its
	 * `@TableRendering`, so the review is part of the model and opens
	 * filtered for everyone. Text filters can't be said that way, and are
	 * named as left out.
	 */
	import { untrack } from 'svelte';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { CreateRequest, WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { openView, write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import { planSavedReview, viewNames, viewNameOf } from './plans';

	let {
		open = $bindable(false),
		workspace,
		ui,
		request
	}: {
		open?: boolean;
		workspace: Workspace;
		ui: WorkbenchUi;
		request: Extract<CreateRequest, { kind: 'savedReview' }>;
	} = $props();

	let step = $state(0);
	// The form starts from what the table asked for; a new request makes a new form.
	let title = $state(untrack(() => request.title));
	let doc = $state(
		untrack(() => `${request.about}, reviewed: ${request.kept.join(', ') || 'every line'}.`)
	);
	const taken = $derived(viewNames(workspace).has(viewNameOf(title)));
	const plan = $derived(
		title.trim() && request.where
			? planSavedReview(workspace, {
					title,
					definition: request.definition,
					exposes: request.exposes,
					where: request.where,
					doc
				})
			: null
	);
	const steps: Step[] = [{ id: 'name', label: 'Name', question: 'Save this review as a view' }];

	function check(): string | null {
		if (!request.where)
			return 'Only text filters are on, and a view can’t keep those. Filter by a number or a level.';
		if (!title.trim()) return 'Give the view a name.';
		if (taken) return `There is already a view called “${title.trim()}”. Choose another name.`;
		return null;
	}

	async function finish(): Promise<string | null> {
		const problem = check();
		if (problem || !plan) return problem;
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		void openView(workspace, ui, plan.open!);
		open = false;
		return null;
	}
</script>

<CreateDialog
	bind:open
	title="Save as a view"
	{steps}
	bind:step
	preview={plan?.preview ?? ''}
	{check}
	finishLabel="Save view"
	onfinish={finish}
>
	<p class="hint">
		The view shows the rows of {request.about} that pass the filters, for everyone who opens the project.
		It is written in the model, so another SysML tool reads the same condition.
	</p>
	<label class="field">
		<span class="name">Name</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={title} autocomplete="off" autofocus />
	</label>
	<label class="field">
		<span class="name">Description</span>
		<textarea bind:value={doc} rows="2"></textarea>
	</label>
	{#if request.kept.length}
		<div class="field">
			<span class="name">Filters it keeps</span>
			<ul class="kept">
				{#each request.kept as words (words)}<li>{words}</li>{/each}
			</ul>
		</div>
	{/if}
	{#if request.left.length}
		<p class="note">
			Left out: {request.left.join(', ')}. A view keeps number and level filters; text filters stay
			a way of looking.
		</p>
	{/if}
</CreateDialog>

<style>
	.kept {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.kept li {
		padding: 2px 10px;
		border-radius: var(--radius-pill);
		background: var(--accent-weak);
		font-size: var(--text-sm);
	}
</style>
