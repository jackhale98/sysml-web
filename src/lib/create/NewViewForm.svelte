<script lang="ts">
	/**
	 * New view: what kind (a table, a diagram, a budget, checks or a
	 * report), what it covers, and its name. It writes a view of the model
	 * (`view massBudget : MassBudget { expose …; }`) next to the project's
	 * other views and opens it.
	 */
	import {
		ArrowRightLeft,
		BadgeCheck,
		Boxes,
		Cable,
		FileCog,
		FileText,
		Grid3x3,
		ListChecks,
		ListX,
		Network,
		Plug,
		Scale,
		ShieldAlert,
		ShieldCheck,
		Sigma,
		ToggleRight,
		TriangleAlert,
		Workflow
	} from '@lucide/svelte';
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import ColumnChooser from '#lib/workbench/ColumnChooser.svelte';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { viewTitle } from '#lib/workbench/views.ts';
	import { openView, write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import { flatten, qualifiedName } from './model';
	import ModelPicker from './ModelPicker.svelte';
	import { librariesWrite, partsOf, planView, viewNameOf, viewNames } from './plans';
	import { sentenceCase, words } from './sysml';
	import {
		GROUP_TITLES,
		VIEW_KINDS,
		canCover,
		coverPrompt,
		viewKind,
		viewProblem,
		type Target,
		type ViewGroup
	} from './view';

	let {
		open = $bindable(false),
		workspace,
		ui,
		engine,
		viewKind: initialKind,
		target
	}: {
		open?: boolean;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		viewKind?: string | undefined;
		/** An element (key) to start from. */
		target?: string | undefined;
	} = $props();

	const ICONS: Record<string, typeof Network> = {
		requirements: ListChecks,
		gaps: ListX,
		bom: Boxes,
		interfaces: Plug,
		trace: Grid3x3,
		verification: BadgeCheck,
		general: Network,
		interconnection: Cable,
		states: ToggleRight,
		actions: Workflow,
		sequence: ArrowRightLeft,
		budget: Sigma,
		checks: ShieldCheck,
		specification: FileText,
		icd: FileCog
	};

	// The choices, starting from what was asked for.
	const asked = untrack(() => (initialKind && viewKind(initialKind) ? initialKind : ''));
	let kindId = $state(asked);
	let step = $state(asked ? 1 : 0);
	let selected = $state<string[]>([]);
	let title = $state('');
	let titleEdited = $state(false);
	let doc = $state('');
	let budgetOf = $state('mass');
	let budgetChoices = $state<string[]>([]);
	let columns = $state<{ field: string; shown: boolean }[]>([]);
	let defaultColumns = $state<string[]>([]);

	const kind = $derived(viewKind(kindId));
	const taken = $derived(viewNames(workspace));
	const name = $derived(viewNameOf(title));

	const nodes = $derived(flatten(workspace.tree));
	const targets: Target[] = $derived(
		selected.flatMap((q) => {
			const r = nodes.find((n) => n.qualifiedName === q);
			return r
				? [
						{
							qualifiedName: q,
							kind: r.node.element.kind,
							isDefinition: r.node.element.isDefinition
						}
					]
				: [];
		})
	);

	// A fresh name for the kind, until the person types one.
	$effect(() => {
		if (!kind || titleEdited) return;
		const base = kind.budget ? sentenceCase(`${words(budgetOf)} budget`) : kind.title;
		let candidate = base;
		for (let i = 2; taken.has(viewNameOf(candidate)); i++) candidate = `${base} ${i}`;
		title = candidate;
	});

	// Start from the element asked for, when the kind can show it.
	let seeded = false;
	$effect(() => {
		if (seeded || !kind || !target) return;
		seeded = true;
		const e = workspace.elements.find((x) => x.key === target);
		if (!e) return;
		const q = qualifiedName(workspace.tree, e.key);
		if (canCover(kind, { qualifiedName: q, kind: e.kind, isDefinition: e.isDefinition }))
			selected = [q];
	});

	const steps: Step[] = $derived([
		{ id: 'kind', label: 'Kind', question: 'What kind of view?' },
		...(kind?.covers === 'everything'
			? []
			: [
					{
						id: 'covers',
						label: 'Covers',
						question: kind ? `What does it cover? ${coverPrompt(kind)}` : 'What does it cover?'
					}
				]),
		{ id: 'name', label: 'Name', question: 'What is it called?' }
	]);
	const stepId = $derived(steps[step]?.id);

	// The values a budget can add up: the numbers the chosen part's parts have.
	$effect(() => {
		const q = kind?.budget ? selected[0] : undefined;
		const e = q ? nodes.find((n) => n.qualifiedName === q)?.node.element : undefined;
		if (!e?.id) {
			budgetChoices = [];
			return;
		}
		void (async () => {
			const files = workspace.sourceFiles();
			const own = (await engine.elementFeatures(files, [e.id!]))[e.id!];
			if (!own) return;
			const parts = partsOf(own);
			const theirs = await engine.elementFeatures(
				files,
				parts.map((p) => p.id)
			);
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, not state
			const names = new Set<string>();
			for (const p of Object.values(theirs))
				for (const f of p.features) if (f.kind === 'attribute' && f.numeric) names.add(f.name);
			budgetChoices = [...names];
			if (!names.has(budgetOf)) budgetOf = names.has('mass') ? 'mass' : ([...names][0] ?? 'mass');
		})();
	});

	// A table's columns, to choose from.
	$effect(() => {
		const definition = kind?.table ? kind.definition : null;
		columns = [];
		defaultColumns = [];
		if (!definition) return;
		void engine
			.renderView(workspace.sourceFiles(), definition)
			.then((t) => {
				defaultColumns = t.columns;
				const rest = (t.availableFields ?? []).filter((f) => !t.columns.includes(f));
				columns = [
					...t.columns.map((field) => ({ field, shown: true })),
					...rest.map((field) => ({ field, shown: false }))
				];
			})
			.catch(() => {});
	});
	const chosenColumns = $derived(columns.filter((c) => c.shown).map((c) => c.field));
	const columnsChanged = $derived(
		columns.length > 0 && chosenColumns.join(';') !== defaultColumns.join(';')
	);

	const input = $derived(
		kind
			? {
					kind,
					title,
					doc,
					targets,
					...(columnsChanged && chosenColumns.length ? { columns: chosenColumns } : {}),
					...(kind.budget ? { budgetOf } : {})
				}
			: null
	);
	const preview = $derived(input && title.trim() ? planView(workspace, input).preview : '');

	function check(index: number): string | null {
		const id = steps[index]?.id;
		const problem = viewProblem({ kind, title, targets, taken, name });
		if (id === 'kind') return kind ? null : 'Choose what kind of view to make.';
		if (id === 'covers')
			return problem && !/name|already/.test(problem) && kind?.covers !== 'everything'
				? problem
				: null;
		if (id === 'name') {
			if (columnsChanged && !chosenColumns.length) return 'Choose at least one column.';
			return problem;
		}
		return null;
	}

	async function finish(): Promise<string | null> {
		if (!input) return 'Choose what kind of view to make.';
		const libraries = await librariesWrite(workspace, engine);
		const plan = planView(workspace, input, libraries);
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		void openView(workspace, ui, plan.open!);
		open = false;
		return null;
	}

	const groups = $derived(
		(Object.keys(GROUP_TITLES) as ViewGroup[]).map((g) => ({
			id: g,
			title: GROUP_TITLES[g],
			kinds: VIEW_KINDS.filter((k) => k.group === g)
		}))
	);
	const uid = $props.id();
</script>

<CreateDialog bind:open title="New view" {steps} bind:step {preview} {check} onfinish={finish}>
	{#if stepId === 'kind'}
		{#each groups as g (g.id)}
			<fieldset>
				<legend><h4>{g.title}</h4></legend>
				<div class="cards">
					{#each g.kinds as k (k.id)}
						{@const Icon = ICONS[k.id] ?? Network}
						<label class="card">
							<input type="radio" name="{uid}-kind" value={k.id} bind:group={kindId} />
							<span class="glyph"><Icon size={18} aria-hidden="true" /></span>
							<strong>{k.label}</strong>
							<small>{k.description}</small>
						</label>
					{/each}
					{#if g.id === 'tables'}
						<button type="button" class="card trade" onclick={() => (ui.create = { kind: 'dsm' })}>
							<span class="glyph"><Grid3x3 size={18} aria-hidden="true" /></span>
							<strong>Dependency matrix (DSM)</strong>
							<small>Parts, steps or requirements against each other: what links to what.</small>
						</button>
					{/if}
					{#if g.id === 'analysis'}
						<button
							type="button"
							class="card trade"
							onclick={() => (ui.create = { kind: 'trade' })}
						>
							<span class="glyph"><Scale size={18} aria-hidden="true" /></span>
							<strong>Trade study</strong>
							<small>Compare alternatives on weighted criteria and rank them.</small>
						</button>
						<button type="button" class="card trade" onclick={() => (ui.create = { kind: 'fmea' })}>
							<span class="glyph"><ShieldAlert size={18} aria-hidden="true" /></span>
							<strong>FMEA worksheet</strong>
							<small
								>What can fail, what follows, and how serious, likely and detectable it is.</small
							>
						</button>
						<button
							type="button"
							class="card trade"
							onclick={() => (ui.create = { kind: 'hazard' })}
						>
							<span class="glyph"><TriangleAlert size={18} aria-hidden="true" /></span>
							<strong>Hazard log</strong>
							<small>Hazards, the harms they can cause and the risk controls on them.</small>
						</button>
					{/if}
				</div>
			</fieldset>
		{/each}
	{:else if stepId === 'covers' && kind}
		<ModelPicker
			tree={workspace.tree}
			bind:selected
			single={kind.single}
			label={coverPrompt(kind)}
			selectable={(e, q) =>
				canCover(kind, { qualifiedName: q, kind: e.kind, isDefinition: e.isDefinition })}
			empty="The model has nothing this view can show yet: add it first, in a diagram or the text."
		/>
		{#if kind.optional}
			<p class="hint">Choose nothing to cover the whole model.</p>
		{/if}
		{#if kind.budget && budgetChoices.length}
			<label class="field">
				<span class="name">Add up which value?</span>
				<select bind:value={budgetOf}>
					{#each budgetChoices as b (b)}<option value={b}>{words(b)}</option>{/each}
				</select>
			</label>
		{/if}
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
				>{#if title.trim()}Saved as <code>{name}</code>, shown as “{viewTitle(name)}”.{/if}</small
			>
		</div>
		<label class="field">
			<span class="name">Description <small class="hint">(optional)</small></span>
			<textarea bind:value={doc} rows="2" placeholder="What it shows, and for whom."></textarea>
		</label>
		{#if kind.table && columns.length}
			<details class="columns">
				<summary>Choose columns <small class="hint">(optional)</small></summary>
				<ColumnChooser bind:choice={columns} heading={viewTitle} />
			</details>
		{/if}
	{/if}
</CreateDialog>

<style>
	legend {
		width: 100%;
	}
	.trade {
		border-style: dashed;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
	}
	.trade:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.columns summary {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
</style>
