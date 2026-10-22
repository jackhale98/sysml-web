<script lang="ts">
	/**
	 * New trade study: the alternatives (parts or part defs of one kind), the
	 * criteria they share (which way is better, how much each counts, an
	 * optional cut-off), then a name and the question it answers. It writes
	 * the study in the demo's form and its comparison table, and opens it.
	 */
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ElementFeatures } from '#lib/engine/types.ts';
	import { convert, formatMagnitude, readable } from '#lib/engine/quantity.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { openView, takenNames, write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import { parseNumber } from './limit';
	import { flatten, kindChain } from './model';
	import ModelPicker from './ModelPicker.svelte';
	import { commonKind, librariesWrite, planTrade, sharedCriteria } from './plans';
	import { pascalName, readableUnit, words } from './sysml';
	import {
		guessBetter,
		normaliseWeights,
		rangeOf,
		tradeProblem,
		type Better,
		type CriterionSpec
	} from './trade';
	import { isQuantity, unitChoices } from './units';

	let {
		open = $bindable(false),
		workspace,
		ui,
		engine,
		alternatives: initial = []
	}: {
		open?: boolean;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		/** Elements (keys) to start from. */
		alternatives?: string[];
	} = $props();

	const uid = $props.id();
	let step = $state(0);
	const nodes = $derived(flatten(workspace.tree));
	const qualifiedOf = (key: string) => nodes.find((n) => n.node.element.key === key)?.qualifiedName;
	let selected = $state<string[]>(
		untrack(() => initial.map((k) => qualifiedOf(k)).filter((q): q is string => !!q))
	);
	const elementOf = (q: string) => nodes.find((n) => n.qualifiedName === q)?.node.element;

	/** A part or a part def, not a collection of alternatives itself. */
	const isCandidate = (e: ModelElement) => e.kind === 'part' && !/::/.test(e.name);
	const firstKinds = $derived.by(() => {
		const first = selected[0] ? elementOf(selected[0]) : undefined;
		return first ? new Set(kindChain(workspace.elements, first)) : null;
	});
	function selectable(e: ModelElement): boolean {
		if (!isCandidate(e)) return false;
		if (!firstKinds) return true;
		return kindChain(workspace.elements, e).some((k) => firstKinds.has(k));
	}

	// What the engine says about the chosen alternatives.
	let described = $state.raw<Record<string, ElementFeatures>>({});
	$effect(() => {
		const ids = selected.map((q) => elementOf(q)?.id).filter((x): x is string => !!x);
		if (!ids.length) {
			described = {};
			return;
		}
		void engine.elementFeatures(workspace.sourceFiles(), ids).then((r) => (described = r));
	});
	const alternatives = $derived(
		selected
			.map((q) => elementOf(q)?.id)
			.flatMap((id) => (id && described[id] ? [described[id]!] : []))
	);
	const kind = $derived(commonKind(alternatives));
	const shared = $derived(alternatives.length >= 2 ? sharedCriteria(alternatives) : []);

	interface Choice {
		include: boolean;
		better: Better;
		weight: number;
		unit: string | null;
		worst: string;
		best: string;
		cutoff: 'none' | 'atMost' | 'atLeast';
		cutoffValue: string;
		cutoffUnit: string;
		/** The person changed the range: keep it when the alternatives change. */
		rangeEdited: boolean;
	}
	let choices = $state<Record<string, Choice>>({});

	/** Each alternative's value of a criterion, in one unit. */
	function valuesOf(name: string, unit: string | null): (number | null)[] {
		return alternatives.map((a) => {
			const v = a.features.find((f) => f.name === name)?.evaluated;
			if (v?.kind !== 'number') return null;
			return unit && v.unit ? convert(v.value, v.unit, unit) : v.value;
		});
	}
	function unitOf(name: string): string | null {
		for (const a of alternatives) {
			const v = a.features.find((f) => f.name === name)?.evaluated;
			if (v?.kind === 'number' && v.unit) return readable({ value: v.value, unit: v.unit }).unit;
		}
		return null;
	}
	function setRange(name: string) {
		const c = choices[name]!;
		const range = rangeOf(valuesOf(name, c.unit), c.better);
		c.worst = range ? formatMagnitude(range.worst) : '';
		c.best = range ? formatMagnitude(range.best) : '';
	}

	// New criteria start included, with a guessed direction, equal weights and the alternatives' range.
	$effect(() => {
		void alternatives;
		const next: Record<string, Choice> = {};
		for (const f of shared) {
			const kept = untrack(() => choices[f.name]);
			if (kept) {
				if (!kept.rangeEdited) {
					const range = rangeOf(valuesOf(f.name, kept.unit), kept.better);
					kept.worst = range ? formatMagnitude(range.worst) : '';
					kept.best = range ? formatMagnitude(range.best) : '';
				}
				next[f.name] = kept;
				continue;
			}
			const unit = unitOf(f.name);
			const better = guessBetter(f.name);
			const range = rangeOf(valuesOf(f.name, unit), better);
			next[f.name] = {
				include: !!range && shared.length <= 4,
				better,
				weight: 50,
				unit,
				worst: range ? formatMagnitude(range.worst) : '',
				best: range ? formatMagnitude(range.best) : '',
				cutoff: 'none',
				cutoffValue: '',
				cutoffUnit: unit ?? '',
				rangeEdited: false
			};
		}
		choices = next;
	});

	const included = $derived(shared.filter((f) => choices[f.name]?.include));
	const shares = $derived(normaliseWeights(included.map((f) => choices[f.name]!.weight)));
	const share = (name: string) => {
		const i = included.findIndex((f) => f.name === name);
		return i < 0 ? 0 : Math.round(shares[i]! * 100);
	};

	const criteria: CriterionSpec[] = $derived(
		included.map((f) => {
			const c = choices[f.name]!;
			const cutoffValue = parseNumber(c.cutoffValue);
			return {
				attribute: f.name,
				valueType: f.valueType,
				better: c.better,
				weight: c.weight,
				worst: parseNumber(c.worst),
				best: parseNumber(c.best),
				unit: c.unit,
				cutoff:
					c.cutoff !== 'none' && Number.isFinite(cutoffValue)
						? { kind: c.cutoff, value: cutoffValue, unit: c.unit ? c.cutoffUnit || c.unit : null }
						: null
			};
		})
	);

	let title = $state('');
	let titleEdited = $state(false);
	let question = $state('');
	let questionEdited = $state(false);
	$effect(() => {
		const k = kind?.split('::').pop()?.replace(/^'|'$/g, '');
		if (!k) return;
		if (!titleEdited) title = `${words(k)[0]!.toUpperCase()}${words(k).slice(1)} choice`;
		if (!questionEdited) question = `Which ${words(k)} should we use?`;
	});

	const input = $derived(
		kind && criteria.length && alternatives.length >= 2
			? { title, question, alternatives, kind, criteria }
			: null
	);
	const preview = $derived.by(() => {
		if (!input || !title.trim()) return '';
		if (
			criteria.some(
				(c) => !Number.isFinite(c.worst) || !Number.isFinite(c.best) || c.worst === c.best
			)
		)
			return '';
		return planTrade(workspace, input).preview;
	});

	const steps: Step[] = [
		{
			id: 'alternatives',
			label: 'Alternatives',
			question: 'Which alternatives do you want to compare?'
		},
		{ id: 'criteria', label: 'Criteria', question: 'What do you compare them on?' },
		{ id: 'name', label: 'Name', question: 'What is the study called?' }
	];

	function check(index: number): string | null {
		const id = steps[index]?.id;
		if (id === 'alternatives') {
			if (selected.length < 2) return 'Choose at least two alternatives to compare.';
			if (alternatives.length < selected.length) return 'Reading the alternatives…';
			if (!kind)
				return 'These are not the same kind of thing, so they can’t be compared. Choose parts of one kind (all batteries, all motors).';
			if (!shared.length)
				return 'They have no values that are numbers in common to compare them on.';
			return null;
		}
		const problem = tradeProblem({
			alternatives: alternatives.length,
			criteria,
			name: title,
			taken: takenNames(workspace).has(pascalName(title))
		});
		if (id === 'criteria') return problem && !/name|already/.test(problem) ? problem : null;
		return problem;
	}

	async function finish(): Promise<string | null> {
		if (!input) return check(1);
		const libraries = await librariesWrite(workspace, engine);
		const plan = planTrade(workspace, input, libraries);
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		void openView(workspace, ui, { name: plan.name, title: plan.open!.title });
		open = false;
		return null;
	}

	function valueText(a: ElementFeatures, name: string, unit: string | null): string {
		const v = a.features.find((f) => f.name === name)?.evaluated;
		if (v?.kind !== 'number') return '—';
		const n = unit && v.unit ? convert(v.value, v.unit, unit) : v.value;
		return n === null ? '—' : formatMagnitude(n);
	}
	const altName = (a: ElementFeatures) => a.reference?.text ?? a.name;
</script>

<CreateDialog
	bind:open
	title="New trade study"
	{steps}
	bind:step
	{preview}
	{check}
	onfinish={finish}
>
	{#if steps[step]?.id === 'alternatives'}
		<ModelPicker
			tree={workspace.tree}
			bind:selected
			label="Alternatives"
			selectable={(e) => selectable(e)}
			note={(e) => (e.isDefinition ? 'a kind of part' : e.typeRef ? `a ${e.typeRef}` : null)}
			empty="The model has no parts to compare yet. Add them first, in a diagram or the text."
		/>
		<p class="hint">
			{#if kind}
				Comparing {selected.length} {words(kind.split('::').pop() ?? '')} alternatives.
			{:else}
				Choose parts, or kinds of part, that do the same job. Once you choose one, only parts of the
				same kind can be added.
			{/if}
		</p>
	{:else if steps[step]?.id === 'criteria'}
		<p class="hint">
			Each criterion scores every alternative from 0 (worst) to 1 (best); the weights say how much
			each counts. The highest total wins.
		</p>
		{#each shared as f (f.name)}
			{@const c = choices[f.name]}
			{#if c}
				<fieldset class="criterion" class:off={!c.include}>
					<legend class="visually-hidden">{words(f.name)}</legend>
					<label class="check head">
						<input type="checkbox" bind:checked={c.include} />
						<strong>{words(f.name)}</strong>
						{#if c.unit}<span class="hint">in {readableUnit(c.unit)}</span>{/if}
						{#if c.include}<span class="share">{share(f.name)} %</span>{/if}
					</label>
					<ul class="values" aria-label="Values of {words(f.name)}">
						{#each alternatives as a (a.id)}
							<li><span>{altName(a)}</span><span>{valueText(a, f.name, c.unit)}</span></li>
						{/each}
					</ul>
					{#if c.include}
						<div class="segmented" role="radiogroup" aria-label="Which is better">
							{#each [['higher', 'Higher is better'], ['lower', 'Lower is better']] as [b, label] (b)}
								<label>
									<input
										type="radio"
										name="{uid}-{f.name}-better"
										value={b}
										bind:group={c.better}
										onchange={() => setRange(f.name)}
									/>
									<span>{label}</span>
								</label>
							{/each}
						</div>
						<label class="field">
							<span class="name">Weight</span>
							<input
								type="range"
								min="0"
								max="100"
								step="5"
								bind:value={c.weight}
								aria-valuetext="{share(f.name)} percent of the score"
							/>
						</label>
						<details class="more">
							<summary>Range and cut-off</summary>
							<div class="row">
								<label class="field">
									<span class="name">Scores 0 at</span>
									<input
										bind:value={c.worst}
										inputmode="decimal"
										oninput={() => (c.rangeEdited = true)}
									/>
								</label>
								<label class="field">
									<span class="name">Scores 1 at</span>
									<input
										bind:value={c.best}
										inputmode="decimal"
										oninput={() => (c.rangeEdited = true)}
									/>
								</label>
							</div>
							<div class="row">
								<label class="field">
									<span class="name">It must be</span>
									<select bind:value={c.cutoff}>
										<option value="none">Anything</option>
										<option value="atMost">At most</option>
										<option value="atLeast">At least</option>
									</select>
								</label>
								{#if c.cutoff !== 'none'}
									<label class="field">
										<span class="name">Cut-off</span>
										<input bind:value={c.cutoffValue} inputmode="decimal" />
									</label>
									{#if isQuantity(f.valueType, c.unit)}
										<label class="field">
											<span class="name">Unit</span>
											<select bind:value={c.cutoffUnit}>
												{#each unitChoices(f.valueType, c.unit) as u (u)}<option value={u}
														>{readableUnit(u)}</option
													>{/each}
											</select>
										</label>
									{/if}
								{/if}
							</div>
							{#if c.cutoff !== 'none'}
								<p class="hint">An alternative outside it scores 0.</p>
							{/if}
						</details>
					{/if}
				</fieldset>
			{/if}
		{/each}
	{:else}
		<label class="field">
			<span class="name">Name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={title} oninput={() => (titleEdited = true)} autocomplete="off" autofocus />
		</label>
		<label class="field">
			<span class="name">The question it answers</span>
			<textarea bind:value={question} rows="2" oninput={() => (questionEdited = true)}></textarea>
		</label>
		<p class="hint">It is saved in its own file, with a table comparing the alternatives.</p>
	{/if}
</CreateDialog>

<style>
	.criterion {
		padding: var(--space-3);
		border: 1px solid var(--border-strong) !important;
		border-radius: var(--radius-md);
	}
	.criterion.off {
		border-style: dashed !important;
	}
	.head {
		flex-wrap: wrap;
		min-height: 2.5rem;
	}
	.share {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		font-weight: 650;
	}
	.values {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-xs);
		color: var(--text-2);
	}
	.values li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.values li span:first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.values li span:last-child {
		font-variant-numeric: tabular-nums;
	}
	.more summary {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.more {
		display: grid;
		gap: var(--space-2);
	}
	input[type='range'] {
		width: 100%;
		min-height: 2.75rem;
	}
</style>
