<script lang="ts">
	/**
	 * New FMEA: the kind (design, process or use), what it covers (parts, a
	 * process, user tasks) and a name. It writes a package for the lines, in
	 * a file of its own, and a worksheet view of them, brings the risk
	 * libraries the first time, and opens the worksheet.
	 */
	import { untrack } from 'svelte';
	import { Cog, ShieldAlert, UserRound } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import { openView, takenNames, write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import { FMEA_KINDS, canAnalyse, fmeaKind, fmeaSheetProblem, listWords } from './fmea';
	import { flatten } from './model';
	import ModelPicker from './ModelPicker.svelte';
	import { planFmea, riskLibrariesWrite } from './plans';
	import { pascalName } from './sysml';

	let {
		open = $bindable(false),
		workspace,
		ui,
		engine,
		kindId: initialKind
	}: {
		open?: boolean;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		/** A kind to start with (`design`, `process`, `use`). */
		kindId?: string;
	} = $props();

	const uid = $props.id();
	const ICONS = { design: ShieldAlert, process: Cog, use: UserRound };
	let step = $state(untrack(() => (initialKind && fmeaKind(initialKind) ? 1 : 0)));
	let kindId = $state(untrack(() => initialKind ?? ''));
	const kind = $derived(fmeaKind(kindId));
	let selected = $state<string[]>([]);
	let title = $state('');
	let titleEdited = $state(false);

	const nodes = $derived(flatten(workspace.tree));
	const covers = $derived(
		selected.flatMap((q) => {
			const n = nodes.find((x) => x.qualifiedName === q);
			return n ? [{ qualifiedName: q, label: n.node.element.label }] : [];
		})
	);

	// A kind's choices don't carry over to another kind.
	let chosenFor = '';
	$effect(() => {
		if (kindId !== chosenFor) {
			chosenFor = kindId;
			selected = [];
		}
	});
	$effect(() => {
		if (titleEdited || !kind) return;
		const about = covers[0]?.label;
		title = about ? `${about[0]!.toUpperCase()}${about.slice(1)} ${kind.suffix}` : `${kind.label}`;
	});

	const taken = $derived(takenNames(workspace).has(pascalName(title, 'Fmea')));
	const preview = $derived(
		kind && title.trim() && !taken ? planFmea(workspace, { kind, title, covers }).preview : ''
	);

	const steps: Step[] = [
		{ id: 'kind', label: 'Kind', question: 'What kind of FMEA?' },
		{ id: 'covers', label: 'Covers', question: 'What does it cover?' },
		{ id: 'name', label: 'Name', question: 'What is it called?' }
	];

	function check(index: number): string | null {
		const id = steps[index]?.id;
		if (id === 'kind') return kind ? null : 'Choose the kind of FMEA.';
		if (id === 'covers') return null;
		return fmeaSheetProblem({ kind, title, taken });
	}

	async function finish(): Promise<string | null> {
		if (!kind) return 'Choose the kind of FMEA.';
		const libraries = await riskLibrariesWrite(workspace, engine);
		const plan = planFmea(workspace, { kind, title, covers }, libraries);
		const error = await write(workspace, plan.label, plan.write);
		if (error) return error;
		void openView(workspace, ui, plan.open!);
		open = false;
		return null;
	}
</script>

<CreateDialog bind:open title="New FMEA" {steps} bind:step {preview} {check} onfinish={finish}>
	{#if steps[step]?.id === 'kind'}
		<p class="hint">
			An FMEA (failure mode and effects analysis) lists what can go wrong, what follows, and how
			serious, how likely and how hard to detect each is.
		</p>
		<fieldset>
			<legend class="visually-hidden">Kind of FMEA</legend>
			<div class="cards">
				{#each FMEA_KINDS as k (k.id)}
					{@const Icon = ICONS[k.id]}
					<label class="card">
						<input type="radio" name="{uid}-kind" value={k.id} bind:group={kindId} />
						<span class="glyph"><Icon size={18} aria-hidden="true" /></span>
						<strong>{k.label} <span class="short">({k.short})</span></strong>
						<small>{k.description}</small>
					</label>
				{/each}
			</div>
		</fieldset>
	{:else if steps[step]?.id === 'covers' && kind}
		<ModelPicker
			tree={workspace.tree}
			bind:selected
			label={kind.covers}
			selectable={(e) => canAnalyse(kind, e)}
			note={(e) => (e.typeRef ? `a ${e.typeRef.split('::').pop()}` : null)}
			empty={kind.id === 'design'
				? 'The model has no parts yet. You can still make the FMEA, and add parts later.'
				: 'The model has no actions or use cases yet. You can still make the FMEA, and add them later.'}
		/>
		<p class="hint">
			{#if covers.length}
				Its lines will be about {listWords(covers.map((c) => c.label))} and what {covers.length > 1
					? 'they contain'
					: 'it contains'}.
			{:else}
				Optional: choose {kind.id === 'design'
					? 'the parts (or the whole product)'
					: kind.id === 'process'
						? 'the process (an action and its steps)'
						: 'the use cases or user tasks'} it analyses. Each line is about one {kind.element}.
			{/if}
		</p>
	{:else if kind}
		<label class="field">
			<span class="name">Name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={title} oninput={() => (titleEdited = true)} autocomplete="off" autofocus />
		</label>
		<p class="hint">
			It is saved in its own file, with a worksheet that lists its lines, highest risk first. Add
			lines from the worksheet.
		</p>
	{/if}
</CreateDialog>

<style>
	.short {
		color: var(--text-2);
		font-weight: 500;
	}
</style>
