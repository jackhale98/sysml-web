<script lang="ts">
	/**
	 * New DSM: the kind (a part DSM, an N² interface chart, a functional or a
	 * requirement DSM), whose elements it compares, what counts as a link and
	 * how to order them, and a name. It writes a view of the
	 * `DependencyMatrices` library next to the project's other views (bringing
	 * the library the first time) and opens it.
	 */
	import { untrack } from 'svelte';
	import { Boxes, Cable, ListChecks, Workflow } from '@lucide/svelte';
	import type { DependencyKind, MatrixElements } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { KIND_WORDS } from '#lib/workbench/dsm.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { viewTitle } from '#lib/workbench/views.ts';
	import { openView, write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import {
		DSM_KINDS,
		canCompare,
		dsmKind,
		dsmLibraryWrite,
		dsmProblem,
		dsmTitle,
		nameTaken,
		planDsm,
		type DsmTarget
	} from './dsm';
	import { flatten, qualifiedName } from './model';
	import ModelPicker from './ModelPicker.svelte';
	import { viewNameOf, viewNames } from './plans';

	let {
		open = $bindable(false),
		workspace,
		ui,
		elements,
		target
	}: {
		open?: boolean;
		workspace: Workspace;
		ui: WorkbenchUi;
		/** A kind of element to start with. */
		elements?: MatrixElements | undefined;
		/** An element (key) to start from. */
		target?: string | undefined;
	} = $props();

	const uid = $props.id();
	const ICONS = { parts: Boxes, n2: Cable, actions: Workflow, requirements: ListChecks };

	const asked = untrack(() => DSM_KINDS.find((k) => k.elements === elements)?.id ?? '');
	let kindId = $state<string>(asked);
	let step = $state(asked ? 1 : 0);
	const kind = $derived(dsmKind(kindId));
	let selected = $state<string[]>([]);
	let deeper = $state(false);
	let kinds = $state<DependencyKind[]>([]);
	let order = $state<'model' | 'clustered'>('model');
	let title = $state('');
	let titleEdited = $state(false);
	let doc = $state('');
	/** Whether the element asked for has been chosen (once). */
	let seeded = false;

	const nodes = $derived(flatten(workspace.tree));
	const targets: DsmTarget[] = $derived(
		selected.flatMap((q) => {
			const n = nodes.find((x) => x.qualifiedName === q);
			return n
				? [
						{
							qualifiedName: q,
							label: n.node.element.label,
							kind: n.node.element.kind,
							isDefinition: n.node.element.isDefinition
						}
					]
				: [];
		})
	);

	/** Definitions with parts of their own, by name: a usage typed by one has parts too. */
	const withParts = $derived(
		new Set(
			nodes
				.filter((n) => n.node.children.some((c) => c.element.kind === 'part'))
				.map((n) => n.node.element.name)
		)
	);
	/** Whether an element has parts to compare: its own, or its definition's. */
	function hasParts(e: ModelElement, children: number): boolean {
		if (e.kind === 'package') return children > 0;
		const type = e.typeRef?.split('::').pop() ?? '';
		return children > 0 || withParts.has(type);
	}
	const childCount = $derived(
		new Map(
			nodes.map((n) => [
				n.qualifiedName,
				n.node.children.filter((c) =>
					n.node.element.kind === 'package'
						? c.element.kind === 'part' && c.element.isDefinition
						: c.element.kind === 'part'
				).length
			])
		)
	);
	function selectable(e: ModelElement, q: string): boolean {
		if (!kind || !canCompare(kind, e)) return false;
		if (kind.elements !== 'parts') return true;
		return hasParts(e, childCount.get(q) ?? 0);
	}

	// A kind starts with what its view def counts; its choices don't carry over to another kind.
	let chosenFor = '';
	$effect(() => {
		if (kindId === chosenFor || !kind) return;
		chosenFor = kindId;
		untrack(() => {
			kinds = [...kind.kinds];
			if (!seeded) selected = [];
			deeper = false;
		});
	});

	// Start from the element asked for, when the kind can compare its elements.
	$effect(() => {
		if (seeded || !kind || !target) return;
		seeded = true;
		const e = workspace.elements.find((x) => x.key === target);
		if (!e) return;
		const q = qualifiedName(workspace.tree, e.key);
		if (selectable(e, q)) selected = [q];
	});

	$effect(() => {
		if (titleEdited || !kind) return;
		const base = dsmTitle(kind, targets);
		let candidate = base;
		for (let i = 2; nameTaken(taken, viewNameOf(candidate)); i++) candidate = `${base} ${i}`;
		title = candidate;
	});

	const taken = $derived(viewNames(workspace));
	const input = $derived(kind ? { kind, title, doc, targets, deeper, kinds, order } : null);
	const preview = $derived(
		input && !dsmProblem({ ...input, taken }) ? planDsm(workspace, input).preview : ''
	);

	const steps: Step[] = [
		{ id: 'kind', label: 'Kind', question: 'What kind of matrix?' },
		{ id: 'covers', label: 'Compares', question: 'What does it compare?' },
		{ id: 'links', label: 'Links', question: 'What counts as a link, and in what order?' },
		{ id: 'name', label: 'Name', question: 'What is it called?' }
	];
	const stepId = $derived(steps[step]?.id);

	function check(index: number): string | null {
		const id = steps[index]?.id;
		const problem = dsmProblem({ kind, title, targets, kinds, taken });
		if (id === 'kind') return kind ? null : 'Choose what kind of matrix to make.';
		if (id === 'covers')
			return problem && /Choose (the process|whose|one)/.test(problem) ? problem : null;
		if (id === 'links') return kinds.length ? null : 'Choose at least one kind of link to count.';
		return problem;
	}

	async function finish(): Promise<string | null> {
		if (!input) return 'Choose what kind of matrix to make.';
		const plan = planDsm(workspace, input, dsmLibraryWrite(workspace));
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		void openView(workspace, ui, plan.open!);
		open = false;
		return null;
	}

	function toggle(k: DependencyKind, on: boolean) {
		if (!kind) return;
		kinds = kind.available.filter((x) => (x === k ? on : kinds.includes(x)));
	}
</script>

<CreateDialog bind:open title="New DSM" {steps} bind:step {preview} {check} onfinish={finish}>
	{#if stepId === 'kind'}
		<p class="hint">
			A dependency matrix (DSM) lists the same elements down the side and across the top. Each cell
			shows how the row's element leads to the column's, so clusters and loose ends stand out. It is
			read from the model, so it stays up to date.
		</p>
		<fieldset>
			<legend class="visually-hidden">Kind of matrix</legend>
			<div class="cards">
				{#each DSM_KINDS as k (k.id)}
					{@const Icon = ICONS[k.id]}
					<label class="card">
						<input type="radio" name="{uid}-kind" value={k.id} bind:group={kindId} />
						<span class="glyph"><Icon size={18} aria-hidden="true" /></span>
						<strong>{k.label}</strong>
						<small>{k.description}</small>
					</label>
				{/each}
			</div>
		</fieldset>
	{:else if stepId === 'covers' && kind}
		<ModelPicker
			tree={workspace.tree}
			bind:selected
			single={kind.single}
			label={kind.covers}
			{selectable}
			note={(e) => (e.typeRef ? `a ${e.typeRef.split('::').pop()}` : null)}
			empty={kind.elements === 'parts'
				? 'The model has no part with parts yet: add some first, in a diagram or the text.'
				: kind.elements === 'actions'
					? 'The model has no actions yet: add a process first, in a diagram or the text.'
					: 'The model has no requirements yet.'}
		/>
		<p class="hint">{kind.covers}</p>
		{#if kind.elements === 'parts' && targets.some((t) => t.kind !== 'package')}
			<label class="check">
				<input type="checkbox" bind:checked={deeper} />
				Include the parts inside them too, one level deeper
			</label>
		{:else if kind.elements === 'requirements' && !targets.length}
			<p class="hint">Choose nothing to compare every requirement of the model.</p>
		{/if}
	{:else if stepId === 'links' && kind}
		<fieldset>
			<legend class="name">Count as a link</legend>
			{#each kind.available as k (k)}
				<label class="check">
					<input
						type="checkbox"
						checked={kinds.includes(k)}
						onchange={(e) => toggle(k, (e.currentTarget as HTMLInputElement).checked)}
					/>
					<span
						><strong>{KIND_WORDS[k].label}</strong>
						<small class="hint">— {KIND_WORDS[k].legend}</small></span
					>
				</label>
			{/each}
		</fieldset>
		<fieldset>
			<legend class="name">Order</legend>
			<div class="segmented">
				<label>
					<input type="radio" name="{uid}-order" value="model" bind:group={order} />
					<span>Model order</span>
				</label>
				<label>
					<input type="radio" name="{uid}-order" value="clustered" bind:group={order} />
					<span>Suggested modules</span>
				</label>
			</div>
			<p class="hint">
				{order === 'clustered'
					? 'Elements linked to each other are put together and outlined as suggested modules: a suggestion from the links alone.'
					: 'As they are written in the model.'} Both can be changed on the matrix later.
			</p>
		</fieldset>
	{:else if stepId === 'name' && kind}
		<div class="field">
			<label class="name" for="{uid}-name">Name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="{uid}-name"
				bind:value={title}
				oninput={() => (titleEdited = true)}
				aria-describedby="{uid}-saved"
				autocomplete="off"
				autofocus
			/>
			<small class="hint" id="{uid}-saved"
				>{#if title.trim()}Saved as <code>{viewNameOf(title)}</code>, shown as “{viewTitle(
						viewNameOf(title)
					)}”.{/if}</small
			>
		</div>
		<label class="field">
			<span class="name">Description <small class="hint">(optional)</small></span>
			<textarea bind:value={doc} rows="2" placeholder="What it shows, and for whom."></textarea>
		</label>
	{/if}
</CreateDialog>

<style>
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	small.hint {
		font-weight: 400;
	}
</style>
