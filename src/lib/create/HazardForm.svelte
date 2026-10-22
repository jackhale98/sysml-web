<script lang="ts">
	/**
	 * New hazard: what could cause harm (and, optionally, when people are
	 * exposed to it), the harms it can cause with how severe each is, and the
	 * risk controls on it, each a requirement. It writes them with the
	 * hazard analysis library, linked from cause to effect, beside the
	 * project's other hazards, and opens the hazard log; what implements and
	 * verifies a control is linked from the control's details, as for any
	 * requirement.
	 */
	import { Plus, Trash2 } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { openView, write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import {
		CONTROL_KINDS,
		SEVERITY_CLASSES,
		hazardProblem,
		type ControlSpec,
		type HarmSpec,
		type HazardSpec
	} from './hazard';
	import { flatten } from './model';
	import { nextControlId, planHazard, riskLibrariesWrite } from './plans';

	let {
		open = $bindable(false),
		workspace,
		ui,
		engine
	}: { open?: boolean; workspace: Workspace; ui: WorkbenchUi; engine: Engine } = $props();

	const uid = $props.id();
	let step = $state(0);
	let name = $state('');
	let description = $state('');
	let situationName = $state('');
	let situationDescription = $state('');
	let harms = $state<HarmSpec[]>([{ name: '', description: '', severity: 'serious' }]);
	let controls = $state<ControlSpec[]>([]);
	let existing = $state<string[]>([]);

	const nodes = $derived(flatten(workspace.tree));
	/** The harms the model has already. */
	const knownHarms = $derived(
		nodes
			.filter(
				(n) =>
					!n.node.element.isDefinition &&
					!isLibraryFile(n.node.element.file) &&
					/(^|::)Harm$/.test(n.node.element.typeRef ?? '')
			)
			.map((n) => ({ qualifiedName: n.qualifiedName, label: n.node.element.label }))
	);
	const taken = $derived(new Set(workspace.elements.flatMap((e) => [e.label, e.shortName ?? ''])));

	const spec: HazardSpec = $derived({
		name,
		description,
		situation: situationName.trim()
			? { name: situationName, description: situationDescription }
			: null,
		harms,
		existingHarms: existing,
		controls
	});
	const existingHarms = $derived(knownHarms.filter((h) => existing.includes(h.qualifiedName)));
	const preview = $derived(
		name.trim() ? planHazard(workspace, { spec, existingHarms }).preview : ''
	);

	function addHarm() {
		harms = [...harms, { name: '', description: '', severity: 'serious' }];
	}
	function addControl() {
		const ids = [...workspace.requirements.map((r) => r.id), ...controls.map((c) => c.id)];
		controls = [
			...controls,
			{ id: nextControlId(ids), title: '', statement: '', hierarchy: 'protectiveMeasure' }
		];
	}

	const steps: Step[] = [
		{ id: 'hazard', label: 'Hazard', question: 'What could cause harm?' },
		{ id: 'harms', label: 'Harms', question: 'What harm can it cause, and how severe?' },
		{ id: 'controls', label: 'Controls', question: 'What lowers the risk?' }
	];

	function check(index: number): string | null {
		const id = steps[index]?.id as 'hazard' | 'harms' | 'controls';
		return hazardProblem(spec, id, taken);
	}

	async function finish(): Promise<string | null> {
		const libraries = await riskLibrariesWrite(workspace, engine);
		const plan = planHazard(workspace, { spec, existingHarms }, libraries);
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		void openView(workspace, ui, plan.open!);
		open = false;
		return null;
	}
</script>

<CreateDialog
	bind:open
	title="New hazard"
	{steps}
	bind:step
	{preview}
	{check}
	finishLabel="Create"
	onfinish={finish}
>
	{#if steps[step]?.id === 'hazard'}
		<label class="field">
			<span class="name">Hazard</span>
			<span class="hint"
				>A source of harm, such as a hot surface, a falling part or a sharp edge.</span
			>
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={name} placeholder="Battery fire" autocomplete="off" autofocus />
		</label>
		<label class="field">
			<span class="name">Description</span>
			<textarea
				bind:value={description}
				rows="2"
				placeholder="Fire or explosion of the battery pack, in use or charging"></textarea>
		</label>
		<fieldset class="group">
			<legend>When is someone exposed to it? (optional)</legend>
			<p class="hint">The hazardous situation: the circumstances in which it can do harm.</p>
			<label class="field">
				<span class="name">Situation</span>
				<input bind:value={situationName} placeholder="Charging indoors" autocomplete="off" />
			</label>
			{#if situationName.trim()}
				<label class="field">
					<span class="name">Description of the situation</span>
					<textarea bind:value={situationDescription} rows="2"></textarea>
				</label>
			{/if}
		</fieldset>
	{:else if steps[step]?.id === 'harms'}
		{#each harms as harm, i (i)}
			<fieldset class="group">
				<legend>Harm {harms.length > 1 ? i + 1 : ''}</legend>
				<div class="row">
					<label class="field">
						<span class="name">Harm</span>
						<input bind:value={harm.name} placeholder="Burns" autocomplete="off" />
					</label>
					<button
						type="button"
						class="remove"
						aria-label="Remove harm {i + 1}"
						onclick={() => (harms = harms.filter((_, j) => j !== i))}
						><Trash2 size={16} aria-hidden="true" /></button
					>
				</div>
				<label class="field">
					<span class="name">Description (optional)</span>
					<input
						bind:value={harm.description}
						placeholder="Burns to people nearby"
						autocomplete="off"
					/>
				</label>
				<fieldset>
					<legend class="name">How severe?</legend>
					<div class="severities">
						{#each SEVERITY_CLASSES as c (c.literal)}
							<label class="card">
								<input
									type="radio"
									name="{uid}-severity-{i}"
									value={c.literal}
									bind:group={harm.severity}
								/>
								<span class="glyph">{c.value}</span>
								<strong>{c.literal[0]!.toUpperCase()}{c.literal.slice(1)}</strong>
								<small>{c.meaning}</small>
							</label>
						{/each}
					</div>
				</fieldset>
			</fieldset>
		{/each}
		<button type="button" class="add" onclick={addHarm}>
			<Plus size={16} aria-hidden="true" /> Add a harm
		</button>
		{#if knownHarms.length}
			<fieldset class="group">
				<legend>Or harms the model has already</legend>
				{#each knownHarms as h (h.qualifiedName)}
					<label class="check">
						<input type="checkbox" value={h.qualifiedName} bind:group={existing} />
						{h.label}
					</label>
				{/each}
			</fieldset>
		{/if}
		<p class="hint">
			The worst harm sets the severity of the FMEA lines that can lead to this hazard.
		</p>
	{:else}
		<p class="hint">
			Each risk control is a requirement on the design. Once it exists, say what implements it and
			what tests it from its details. Optional: you can add controls later.
		</p>
		{#each controls as control, i (i)}
			<fieldset class="group">
				<legend>Risk control {control.id}</legend>
				<div class="row">
					<label class="field id">
						<span class="name">ID</span>
						<input bind:value={control.id} autocomplete="off" />
					</label>
					<label class="field">
						<span class="name">Title</span>
						<input
							bind:value={control.title}
							placeholder="Battery thermal protection"
							autocomplete="off"
						/>
					</label>
					<button
						type="button"
						class="remove"
						aria-label="Remove risk control {control.id}"
						onclick={() => (controls = controls.filter((_, j) => j !== i))}
						><Trash2 size={16} aria-hidden="true" /></button
					>
				</div>
				<label class="field">
					<span class="name">What it requires</span>
					<textarea
						bind:value={control.statement}
						rows="2"
						placeholder="The battery shall disconnect before any cell reaches its thermal limit."
					></textarea>
				</label>
				<label class="field">
					<span class="name">Kind of control</span>
					<select bind:value={control.hierarchy}>
						{#each CONTROL_KINDS as k (k.literal)}
							<option value={k.literal}>{k.label}: {k.meaning}</option>
						{/each}
					</select>
				</label>
			</fieldset>
		{/each}
		<button type="button" class="add" onclick={addControl}>
			<Plus size={16} aria-hidden="true" /> Add a risk control
		</button>
	{/if}
</CreateDialog>

<style>
	fieldset.group.group {
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
	}
	.group > legend {
		padding: 0 var(--space-1);
	}
	.severities {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: var(--space-2);
	}
	.severities .glyph {
		font-variant-numeric: tabular-nums;
		font-weight: 650;
	}
	.row .id {
		flex: 0 1 7rem;
	}
	.remove,
	.add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-width: 2.75rem;
		min-height: 2.75rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.add {
		justify-self: start;
		padding: 0 var(--space-3);
		font-weight: 560;
	}
	.remove:hover,
	.add:hover {
		background: var(--surface-hover);
	}
	@media (max-width: 760px) {
		.severities {
			grid-template-columns: 1fr;
		}
	}
</style>
