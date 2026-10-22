<script lang="ts">
	/**
	 * Add a line to an FMEA worksheet: the element that can fail (a part, a
	 * process step or a user task, as the sheet's kind says), how it fails,
	 * what follows and why, its three ratings with what each means, and the
	 * hazard it can lead to. It writes one `@Fmea` line into the package the
	 * worksheet shows.
	 */
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { RenderedTable } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import { write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import {
		FMEA_KINDS,
		RATINGS,
		canAnalyse,
		fmeaKind,
		fmeaLineProblem,
		kindOfWorksheet,
		type Rating
	} from './fmea';
	import { SEVERITY_CLASSES } from './hazard';
	import { flatten } from './model';
	import ModelPicker from './ModelPicker.svelte';
	import { planFmeaLine, type Chosen } from './plans';

	let {
		open = $bindable(false),
		workspace,
		engine,
		view
	}: {
		open?: boolean;
		workspace: Workspace;
		engine: Engine;
		/** The worksheet's view name. */
		view: string;
	} = $props();

	const uid = $props.id();
	let step = $state(0);
	const info = $derived(workspace.views.find((v) => v.name === view || v.qualifiedName === view));
	const sheetKind = $derived(kindOfWorksheet(info?.definition));
	let chosenKind = $state('design');
	const kind = $derived(sheetKind ?? fmeaKind(chosenKind)!);
	const nodes = $derived(flatten(workspace.tree));

	// Where the lines go: the package the worksheet shows.
	let table = $state.raw<RenderedTable | null>(null);
	let hazardLog = $state.raw<RenderedTable | null>(null);
	$effect(() => {
		const files = untrack(() => workspace.sourceFiles());
		void engine.renderView(files, view).then((t) => (table = t));
		void engine
			.renderView(files, 'HazardLog')
			.then((t) => (hazardLog = t))
			.catch(() => (hazardLog = null));
	});
	const pkgName = $derived(table?.annotations?.package ?? null);
	const pkg = $derived<ModelElement | undefined>(
		nodes.find((n) => n.qualifiedName === pkgName)?.node.element
	);

	/** What the sheet covers: the elements its package imports. */
	const scope = $derived.by(() => {
		if (!pkg) return [];
		const text = workspace.text(pkg.file) ?? '';
		const own = text.slice(pkg.span.from ?? 0, pkg.span.to ?? text.length);
		return [...own.matchAll(/\bimport\s+([^;*]+?)\s*;/g)]
			.map((m) => m[1]!.trim())
			.filter((q) =>
				nodes.some((n) => n.qualifiedName === q && !isLibraryFile(n.node.element.file))
			);
	});
	let everything = $state(false);
	let selected = $state<string[]>([]);
	const inScope = (q: string) =>
		everything || !scope.length || scope.some((s) => q === s || q.startsWith(`${s}::`));
	const element = $derived.by((): Chosen | null => {
		const q = selected[0];
		const n = q ? nodes.find((x) => x.qualifiedName === q) : undefined;
		return n ? { qualifiedName: n.qualifiedName, label: n.node.element.label } : null;
	});

	let failureMode = $state('');
	let effectText = $state('');
	let cause = $state('');
	let preventionControls = $state('');
	let detectionControls = $state('');
	let ratings = $state<Record<Rating['field'], string>>({
		severity: '',
		likelihood: '',
		detection: ''
	});
	const numbers = $derived({
		severity: ratings.severity ? Number(ratings.severity) : null,
		likelihood: ratings.likelihood ? Number(ratings.likelihood) : null,
		detection: ratings.detection ? Number(ratings.detection) : null
	});
	const rpn = $derived(
		numbers.severity && numbers.likelihood && numbers.detection
			? numbers.severity * numbers.likelihood * numbers.detection
			: null
	);

	/** The project's hazards, with the severity of the worst harm each leads to. */
	const hazards = $derived(
		nodes
			.filter(
				(n) =>
					!n.node.element.isDefinition &&
					!isLibraryFile(n.node.element.file) &&
					/(^|::)Hazard$/.test(n.node.element.typeRef ?? '')
			)
			.map((n) => {
				const row = hazardLog?.rows.find((r) => r[0] === n.node.element.label);
				const literal = row?.[hazardLog!.columns.indexOf('severity')] ?? '';
				const severity = SEVERITY_CLASSES.find((c) => c.literal === literal) ?? null;
				return { qualifiedName: n.qualifiedName, label: n.node.element.label, severity };
			})
	);
	let hazardName = $state('');
	const hazard = $derived(hazards.find((h) => h.qualifiedName === hazardName) ?? null);
	// The hazard's worst harm says how severe the line is.
	$effect(() => {
		const value = hazard?.severity?.value;
		if (value) untrack(() => (ratings.severity = String(value)));
	});

	const input = $derived(
		pkg && element && rpn
			? {
					pkg,
					kind,
					element,
					failureMode,
					effect: effectText,
					cause,
					severity: numbers.severity!,
					likelihood: numbers.likelihood!,
					detection: numbers.detection!,
					hazard: hazard ? { qualifiedName: hazard.qualifiedName, label: hazard.label } : null,
					preventionControls,
					detectionControls
				}
			: null
	);
	const preview = $derived(
		input && failureMode.trim() ? planFmeaLine(workspace, input).preview : ''
	);

	const steps: Step[] = $derived([
		{
			id: 'element',
			label: kind.id === 'design' ? 'Part' : kind.id === 'process' ? 'Step' : 'Task',
			question:
				kind.id === 'use'
					? 'In which task can the user go wrong?'
					: `Which ${kind.element} can fail?`
		},
		{
			id: 'failure',
			label: kind.id === 'use' ? 'Use error' : 'Failure',
			question: kind.id === 'use' ? 'What could the user do wrong?' : 'How can it fail?'
		},
		{ id: 'ratings', label: 'Ratings', question: 'How serious is it?' }
	]);

	function check(index: number): string | null {
		const id = steps[index]?.id;
		if (!pkg)
			return table
				? 'This worksheet doesn’t show a package to add lines to.'
				: 'Reading the worksheet…';
		const problem = fmeaLineProblem({
			about: element?.qualifiedName ?? null,
			failureMode,
			ratings: numbers,
			kind
		});
		if (id === 'element') return element ? null : problem;
		if (id === 'failure') return failureMode.trim() ? null : problem;
		return problem;
	}

	async function finish(): Promise<string | null> {
		if (!input) return check(2);
		const plan = planFmeaLine(workspace, input);
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		open = false;
		return null;
	}
</script>

<CreateDialog
	bind:open
	title="Add a line to {pkg?.label ?? 'the FMEA'}"
	{steps}
	bind:step
	{preview}
	{check}
	finishLabel="Add line"
	onfinish={finish}
>
	{#if steps[step]?.id === 'element'}
		{#if !sheetKind}
			<div class="segmented" role="radiogroup" aria-label="Kind of line">
				{#each FMEA_KINDS as k (k.id)}
					<label>
						<input type="radio" name="{uid}-kind" value={k.id} bind:group={chosenKind} />
						<span>{k.label}</span>
					</label>
				{/each}
			</div>
		{/if}
		<ModelPicker
			tree={workspace.tree}
			bind:selected
			single
			label={steps[0]!.question}
			selectable={(e, q) => canAnalyse(kind, e) && inScope(q)}
			note={(e) => (e.typeRef ? `a ${e.typeRef.split('::').pop()}` : null)}
			empty={kind.id === 'design'
				? 'The model has no parts here yet. Add them first, in a diagram or the text.'
				: 'The model has no actions or use cases here yet. Add them first, in a diagram or the text.'}
		/>
		{#if scope.length}
			<label class="check">
				<input type="checkbox" bind:checked={everything} />
				Show the whole model, not only what this FMEA covers
			</label>
		{/if}
	{:else if steps[step]?.id === 'failure'}
		<label class="field">
			<span class="name">{kind.failure}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={failureMode}
				placeholder={kind.examples.failure}
				autocomplete="off"
				autofocus
			/>
		</label>
		<label class="field">
			<span class="name">Effect</span>
			<span class="hint">What follows, for the product and the people using it.</span>
			<textarea bind:value={effectText} rows="2" placeholder={kind.examples.effect}></textarea>
		</label>
		<label class="field">
			<span class="name">Cause</span>
			<span class="hint">Why it would happen.</span>
			<textarea bind:value={cause} rows="2" placeholder={kind.examples.cause}></textarea>
		</label>
		<details class="more">
			<summary>Controls already in place (optional)</summary>
			<label class="field">
				<span class="name">What prevents the cause</span>
				<input bind:value={preventionControls} autocomplete="off" />
			</label>
			<label class="field">
				<span class="name">What would detect the failure</span>
				<input bind:value={detectionControls} autocomplete="off" />
			</label>
		</details>
	{:else}
		{#if hazards.length}
			<label class="field">
				<span class="name">Hazard it can lead to</span>
				<select bind:value={hazardName}>
					<option value="">None</option>
					{#each hazards as h (h.qualifiedName)}
						<option value={h.qualifiedName}
							>{h.label}{h.severity ? ` (worst harm ${h.severity.literal})` : ''}</option
						>
					{/each}
				</select>
				{#if hazard?.severity}
					<span class="hint"
						>Its worst harm is {hazard.severity.literal}, so the severity is {hazard.severity
							.value}.</span
					>
				{/if}
			</label>
		{/if}
		{#each RATINGS as r (r.field)}
			{@const value = numbers[r.field]}
			<label class="field">
				<span class="name">{r.label}: {r.question}</span>
				<select bind:value={ratings[r.field]}>
					<option value="">Choose 1 to 10</option>
					{#each r.meanings as meaning, i (i)}
						<option value={String(i + 1)}>{i + 1} · {meaning}</option>
					{/each}
				</select>
				{#if value}<span class="hint">{value} of 10: {r.meanings[value - 1]}</span>{/if}
			</label>
		{/each}
		{#if rpn}
			<p class="rpn" aria-live="polite">
				Risk priority number: <strong>{rpn}</strong>
				<span class="hint">({numbers.severity} × {numbers.likelihood} × {numbers.detection})</span>
			</p>
		{/if}
	{/if}
</CreateDialog>

<style>
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
	.rpn {
		font-size: var(--text-sm);
	}
	.rpn strong {
		font-variant-numeric: tabular-nums;
	}
</style>
