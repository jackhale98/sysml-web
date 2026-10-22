<script lang="ts">
	/**
	 * Add up this value: an attribute of a part (or part def) becomes the sum
	 * of the same value of its parts (`mass = body.mass + sum(wheels.mass)`),
	 * as the demo writes its mass roll-ups; optionally with a budget table of
	 * it, which opens when done.
	 */
	import type { Engine } from '#lib/engine/client.ts';
	import type { ElementFeatures, FeatureInfo } from '#lib/engine/types.ts';
	import { convert, formatQuantity, readable } from '#lib/engine/quantity.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { openView, write } from './apply';
	import CreateDialog from './CreateDialog.svelte';
	import { librariesWrite, partsOf, planRollup, viewNameOf, viewNames } from './plans';
	import { rollupProblem } from './rollup';
	import { words } from './sysml';

	let {
		open = $bindable(false),
		workspace,
		ui,
		engine,
		element: key,
		attribute: attributeName
	}: {
		open?: boolean;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		element: string;
		attribute: string;
	} = $props();

	const element = $derived(workspace.elements.find((e) => e.key === key));
	let features = $state.raw<ElementFeatures | null>(null);
	let theirs = $state.raw<Record<string, ElementFeatures>>({});
	let loading = $state(true);
	let each = $state('');
	let budget = $state(true);
	let budgetTitle = $state('');

	$effect(() => {
		const id = element?.id;
		if (!id) return;
		void (async () => {
			const files = workspace.sourceFiles();
			const own = (await engine.elementFeatures(files, [id]))[id] ?? null;
			const parts = own ? partsOf(own) : [];
			const children = parts.length
				? await engine.elementFeatures(
						files,
						parts.map((p) => p.id)
					)
				: {};
			features = own;
			theirs = children;
			loading = false;
		})();
	});

	const attribute: FeatureInfo | undefined = $derived(
		features?.features.find((f) => f.name === attributeName)
	);
	const parts = $derived(features ? partsOf(features) : []);
	/** The numbers the parts have, the attribute's own name first. */
	const choices = $derived.by(() => {
		const names: string[] = [];
		for (const p of parts)
			for (const f of theirs[p.id]?.features ?? [])
				if (f.kind === 'attribute' && f.numeric && !names.includes(f.name)) names.push(f.name);
		const same = names.filter((n) => n === attributeName);
		const alike = attribute?.valueType
			? names.filter(
					(n) =>
						n !== attributeName &&
						parts.some(
							(p) =>
								theirs[p.id]?.features.find((f) => f.name === n)?.valueType === attribute.valueType
						)
				)
			: [];
		return [...same, ...alike, ...names.filter((n) => !same.includes(n) && !alike.includes(n))];
	});
	$effect(() => {
		if (!each && choices.length) each = choices[0]!;
	});
	$effect(() => {
		if (element && !budgetTitle) {
			let t = `${element.label} ${words(each || attributeName)} budget`;
			const taken = viewNames(workspace);
			for (let i = 2; taken.has(viewNameOf(t)); i++)
				t = `${element.label} ${words(each)} budget ${i}`;
			budgetTitle = t[0]!.toUpperCase() + t.slice(1);
		}
	});

	const plan = $derived(
		element && features && attribute && each
			? planRollup(workspace, {
					element,
					features,
					attribute,
					each,
					parts: parts.map((p) => ({ feature: p, features: theirs[p.id] })),
					budget: budget && !element.isDefinition ? { title: budgetTitle } : null
				})
			: null
	);

	/** What the sum comes to with today's values (a rough guide, before the engine works it out). */
	const estimate = $derived.by(() => {
		if (!plan) return null;
		let total = 0;
		let unit: string | null = null;
		for (const term of plan.rollup.terms) {
			const p = parts.find((x) => x.written === term.part);
			const v = p ? theirs[p.id]?.features.find((f) => f.name === each)?.evaluated : null;
			if (v?.kind !== 'number' || term.count === null) return null;
			unit ??= v.unit;
			const value = unit && v.unit ? convert(v.value, v.unit, unit) : v.value;
			if (value === null) return null;
			total += value * term.count;
		}
		return formatQuantity(readable({ value: total, unit }));
	});

	function valueOf(part: string): string {
		const p = parts.find((x) => x.written === part);
		const v = p ? theirs[p.id]?.features.find((f) => f.name === each)?.evaluated : null;
		return v?.kind === 'number' ? formatQuantity(readable({ value: v.value, unit: v.unit })) : '';
	}

	function check(): string | null {
		if (loading) return 'Reading the parts…';
		if (!attribute) return `${element?.label ?? 'It'} has no ${attributeName}.`;
		if (!attribute.numeric)
			return `${words(attributeName)} is not a number, so it can’t be added up.`;
		if (!choices.length)
			return `None of the parts of ${element?.label} has a number to add up. Give its parts a ${words(attributeName)} first.`;
		if (plan) {
			const problem = rollupProblem(plan.rollup, words(each));
			if (problem) return problem;
		}
		if (budget && !element?.isDefinition && !budgetTitle.trim())
			return 'Give the budget table a name.';
		return null;
	}

	async function finish(): Promise<string | null> {
		if (!element || !features || !attribute) return check();
		const libraries =
			budget && !element.isDefinition ? await librariesWrite(workspace, engine) : {};
		const p = planRollup(
			workspace,
			{
				element,
				features,
				attribute,
				each,
				parts: parts.map((x) => ({ feature: x, features: theirs[x.id] })),
				budget: budget && !element.isDefinition ? { title: budgetTitle } : null
			},
			libraries
		);
		const error = await write(workspace, p.label, p.write);
		if (error) return error;
		if (p.open) void openView(workspace, ui, p.open);
		open = false;
		return null;
	}

	const steps = $derived([
		{
			id: 'rollup',
			label: 'Add up',
			question: `Add up ${words(attributeName)} over the parts of ${element?.label ?? 'it'}?`
		}
	]);
</script>

<CreateDialog
	bind:open
	title="Add up {words(attributeName)}"
	{steps}
	preview={plan?.preview ?? ''}
	{check}
	finishLabel="Add up"
	onfinish={finish}
>
	{#if loading}
		<p class="note">Reading the parts of {element?.label}…</p>
	{:else if !choices.length}
		<p class="note">
			None of the parts of {element?.label} has a number to add up yet. Give its parts a
			{words(attributeName)} first, then come back.
		</p>
	{:else}
		{#if choices.length > 1}
			<label class="field">
				<span class="name">Each part’s value to add</span>
				<select bind:value={each}>
					{#each choices as c (c)}<option value={c}>{words(c)}</option>{/each}
				</select>
			</label>
		{/if}
		{#if plan}
			<section aria-label="Parts added up">
				<h4>Adds up</h4>
				<ul class="plain">
					{#each plan.rollup.terms as t (t.part)}
						<li class="line">
							<span>{t.count && t.count > 1 ? `${t.count} × ` : ''}{t.part}</span>
							<span class="value">{valueOf(t.part)}</span>
						</li>
					{:else}
						<li class="note">Nothing yet.</li>
					{/each}
				</ul>
				{#if estimate}
					<p class="total">Comes to <strong>{estimate}</strong> with today’s values.</p>
				{/if}
			</section>
			{#if plan.rollup.left.length}
				<section aria-label="Parts left out">
					<h4>Left out</h4>
					<ul class="plain">
						{#each plan.rollup.left as l (l.part)}
							<li class="note">{l.part}: {l.why}</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
		{#if attribute?.own && attribute.value}
			<p class="note">
				This replaces its value now: <code>{attribute.value}</code>.
			</p>
		{/if}
		{#if element && !element.isDefinition}
			<label class="check">
				<input type="checkbox" bind:checked={budget} />
				Also make a budget table of it, part by part
			</label>
			{#if budget}
				<label class="field">
					<span class="name">Budget table name</span>
					<input bind:value={budgetTitle} autocomplete="off" />
				</label>
			{/if}
		{/if}
	{/if}
</CreateDialog>

<style>
	.line {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--border);
	}
	.value {
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}
	.total {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
</style>
