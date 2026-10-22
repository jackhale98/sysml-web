<script lang="ts">
	/**
	 * Set a limit: a value must be at most, at least or between numbers.
	 * On a requirement it adds the checked constraint (and what it is about
	 * and which part must meet it, when the requirement doesn't say yet); on
	 * a value it makes a requirement for it, with a statement in words and a
	 * satisfy link. Either way the design checks show the verdict.
	 */
	import { untrack } from 'svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ElementFeatures, FeatureInfo } from '#lib/engine/types.ts';
	import { convert, formatQuantity, readable } from '#lib/engine/quantity.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import { write } from './apply';
	import CreateDialog, { type Step } from './CreateDialog.svelte';
	import {
		limitProblem,
		limitStatement,
		limitTitle,
		limitWords,
		nextRequirementId,
		parseNumber,
		type Limit,
		type LimitKind
	} from './limit';
	import { enclosingPackage, flatten } from './model';
	import { planLimit, requirementsPackage } from './plans';
	import { camelName, words } from './sysml';
	import { isQuantity, unitChoices } from './units';

	let {
		open = $bindable(false),
		workspace,
		engine,
		element: key,
		attribute: attributeName
	}: {
		open?: boolean;
		workspace: Workspace;
		engine: Engine;
		element: string;
		attribute?: string | undefined;
	} = $props();

	const uid = $props.id();
	const element = $derived(workspace.elements.find((e) => e.key === key));
	const onRequirement = $derived(element?.kind === 'requirement');
	const requirementRow = $derived(workspace.requirements.find((r) => r.key === key));

	// What the engine says about the element, and about what the limit reads.
	let features = $state.raw<ElementFeatures | null>(null);
	/** The element whose values are limited: the requirement's subject's type, a chosen part, or the element. */
	let about = $state.raw<ElementFeatures | null>(null);
	let loading = $state(true);
	/** For a requirement without a subject (or not satisfied yet): the part that must meet it (qualified). */
	let partChoice = $state('');
	let partFeatures = $state.raw<ElementFeatures | null>(null);
	/** What satisfies the requirement already (its values are what the check reads). */
	let satisfier = $state.raw<ElementFeatures | null>(null);

	let step = $state(0);
	let chosen = $state(untrack(() => attributeName ?? ''));
	let kind = $state<LimitKind>('atMost');
	let value = $state('');
	let low = $state('');
	let unit = $state('');

	let id = $state('');
	let title = $state('');
	let statement = $state('');
	let edited = $state({ title: false, statement: false });

	const files = () => workspace.sourceFiles();
	const subject: FeatureInfo | undefined = $derived(
		features?.features.find((f) => f.kind === 'subject')
	);

	/** Part usages of the project (to say what must meet a requirement). */
	const designParts = $derived(
		flatten(
			workspace.tree.filter((n) => !isLibraryFile(n.element.file)),
			(e) => e.kind === 'part' && !e.isDefinition
		)
	);

	$effect(() => {
		const eid = element?.id;
		if (!eid) return;
		void (async () => {
			const own = (await engine.elementFeatures(files(), [eid]))[eid] ?? null;
			features = own;
			const s = own?.features.find((f) => f.kind === 'subject');
			if (onRequirement) {
				about = s?.typeId
					? ((await engine.elementFeatures(files(), [s.typeId]))[s.typeId] ?? null)
					: null;
				const by = requirementRow?.satisfiedBy[0];

				const byId = by ? requirementRow?.linkIds[by] : undefined;
				if (byId) satisfier = (await engine.elementFeatures(files(), [byId]))[byId] ?? null;
			} else about = own;
			loading = false;
		})();
	});

	// The part chosen to meet the requirement.
	$effect(() => {
		const q = partChoice;
		const e = q ? designParts.find((p) => p.qualifiedName === q)?.node.element : undefined;
		if (!e?.id) {
			partFeatures = null;
			return;
		}
		void engine.elementFeatures(files(), [e.id]).then((r) => (partFeatures = r[e.id!] ?? null));
	});

	/** Where the values come from: the subject's type, else the part chosen to meet it. */
	const source = $derived(onRequirement ? (subject ? about : partFeatures) : about);
	const numbers = $derived(
		(source?.features ?? []).filter((f) => f.kind === 'attribute' && f.numeric)
	);
	$effect(() => {
		if (!chosen && numbers.length) chosen = numbers[0]!.name;
	});
	const attribute = $derived(numbers.find((f) => f.name === chosen));
	/** The value now, in the part that must meet it (when known). */
	const current = $derived.by(() => {
		const from = onRequirement ? (partFeatures ?? satisfier) : about;
		return from?.features.find((f) => f.name === chosen)?.evaluated ?? attribute?.evaluated ?? null;
	});
	const units = $derived(
		unitChoices(
			attribute?.valueType ?? null,
			current?.kind === 'number' && current.unit
				? readable({ value: current.value, unit: current.unit }).unit
				: null
		)
	);
	$effect(() => {
		if (!units.includes(unit)) unit = units[0] ?? '';
	});
	const quantity = $derived(isQuantity(attribute?.valueType ?? null, unit || null));

	const limit: Limit | null = $derived.by(() => {
		if (limitProblem({ kind, value, low })) return null;
		return {
			kind,
			value: parseNumber(value),
			...(kind === 'between' ? { low: parseNumber(low) } : {}),
			unit: quantity && unit ? unit : null
		};
	});

	/** Whether today's value meets the limit, for the person to see before writing. */
	const verdict = $derived.by(() => {
		if (!limit || current?.kind !== 'number') return null;
		const v =
			limit.unit && current.unit ? convert(current.value, current.unit, limit.unit) : current.value;
		if (v === null) return null;
		const met =
			kind === 'atMost'
				? v <= limit.value
				: kind === 'atLeast'
					? v >= limit.value
					: v >= (limit.low ?? 0) && v <= limit.value;
		return { met, now: formatQuantity(readable({ value: current.value, unit: current.unit })) };
	});

	// The requirement's words, until the person changes them.
	const ownerWords = $derived(element ? element.label : '');
	$effect(() => {
		if (onRequirement || !limit) return;
		if (!edited.title) title = limitTitle(chosen, limit);
		if (!edited.statement) statement = limitStatement(ownerWords, chosen, limit);
	});
	$effect(() => {
		if (!id) id = nextRequirementId(workspace.requirements.map((r) => r.id));
	});

	/** For a definition: which of its uses must meet the new requirement. */
	$effect(() => {
		if (onRequirement || !features?.isDefinition || partChoice) return;
		partChoice = features.usedBy[0] ?? '';
	});

	const needsPart = $derived(
		onRequirement
			? !subject || !(requirementRow?.satisfiedBy.length ?? 0)
			: !!features?.isDefinition
	);
	const partOptions = $derived.by(() => {
		const kinds = onRequirement
			? subject?.type
				? [subject.type]
				: null
			: features
				? [features.qualifiedName]
				: null;
		if (!onRequirement && features?.isDefinition) return features.usedBy;
		if (!kinds || !subject) return designParts.map((p) => p.qualifiedName);
		return about?.usedBy.length ? about.usedBy : designParts.map((p) => p.qualifiedName);
	});

	function planInput() {
		if (!element || !features || !limit || !attribute) return null;
		if (onRequirement) {
			const pf = partFeatures;
			let s: { name: string; type: string; subsets?: boolean; add: boolean };
			if (subject?.type) s = { name: subject.name, type: subject.type, add: false };
			else if (pf) {
				const own = attribute.declaredIn === pf.qualifiedName || !pf.kinds.length;
				s = {
					name: camelName(pf.name, 'subject'),
					type: own ? pf.qualifiedName : pf.kinds[0]!,
					...(own ? { subsets: true } : {}),
					add: true
				};
			} else return null;
			return {
				attribute: attribute.written,
				limit,
				requirement: { element, features },
				subject: s,
				satisfyBy: needsPart && pf ? pf : null
			};
		}
		const pkg = requirementsPackage(workspace) ?? enclosingPackage(workspace.tree, element.key);
		if (!pkg) return null;
		const usage = !features.isDefinition;
		const own =
			usage && (attribute.declaredIn === features.qualifiedName || !features.kinds.length);
		return {
			attribute: attribute.written,
			limit,
			subject: {
				name: camelName(element.label, 'subject'),
				type: usage && !own ? features.kinds[0]! : features.qualifiedName,
				...(own ? { subsets: true } : {}),
				add: true
			},
			satisfyBy: usage ? features : partFeatures,
			create: { id, title, statement, pkg: pkg as ModelElement }
		};
	}
	const plan = $derived.by(() => {
		const input = planInput();
		return input ? planLimit(workspace, input) : null;
	});

	const steps: Step[] = $derived([
		{
			id: 'limit',
			label: 'Limit',
			question: onRequirement
				? `What must ${requirementRow?.id ?? element?.label ?? 'it'} limit?`
				: `What must ${words(chosen)} of ${element?.label ?? 'it'} be?`
		},
		...(onRequirement
			? []
			: [{ id: 'requirement', label: 'Requirement', question: 'Which requirement says so?' }])
	]);

	function check(step: number): string | null {
		if (loading) return 'Reading the model…';
		if (steps[step]?.id === 'limit') {
			if (onRequirement && !subject && !partChoice)
				return 'Choose the part this requirement is about.';
			if (!numbers.length)
				return 'It has no values that are numbers to limit. Give it one first (an attribute such as mass).';
			if (!attribute) return 'Choose the value to limit.';
			return limitProblem({ kind, value, low });
		}
		if (!id.trim()) return 'Give the requirement an ID.';
		if (workspace.requirements.some((r) => r.id === id.trim()))
			return `There is already a requirement ${id.trim()}. Choose another ID.`;
		if (!title.trim()) return 'Give the requirement a title.';
		if (workspace.elements.some((e) => e.kind === 'requirement' && e.label === title.trim()))
			return `There is already a requirement called “${title.trim()}”.`;
		return null;
	}

	async function finish(): Promise<string | null> {
		if (!plan) return 'Fill in the limit first.';
		const error = await write(workspace, plan.label, plan.write);
		if (!error) open = false;
		return error;
	}

	const KINDS: { id: LimitKind; label: string }[] = [
		{ id: 'atMost', label: 'At most' },
		{ id: 'atLeast', label: 'At least' },
		{ id: 'between', label: 'Between' }
	];
	const shortName = (q: string) => q.split('::').slice(1).join('.') || q;
</script>

<CreateDialog
	bind:open
	title="Set a limit"
	{steps}
	bind:step
	preview={plan?.preview ?? ''}
	{check}
	finishLabel={onRequirement ? 'Set the limit' : 'Create the requirement'}
	onfinish={finish}
>
	{#if loading}
		<p class="note">Reading the model…</p>
	{:else if steps[step]?.id === 'limit'}
		{#if onRequirement && !subject}
			<label class="field">
				<span class="name">Which part is it about?</span>
				<select bind:value={partChoice}>
					<option value="" disabled>Choose a part</option>
					{#each partOptions as q (q)}<option value={q}>{shortName(q)}</option>{/each}
				</select>
				<small class="hint"
					>It must meet the requirement; its values are checked against the limit.</small
				>
			</label>
		{/if}
		{#if numbers.length}
			{#if onRequirement || !attributeName}
				<label class="field">
					<span class="name">Value</span>
					<select bind:value={chosen}>
						{#each numbers as n (n.name)}<option value={n.name}>{words(n.name)}</option>{/each}
					</select>
				</label>
			{/if}
			<fieldset>
				<legend>It must be</legend>
				<div class="segmented">
					{#each KINDS as k (k.id)}
						<label>
							<input type="radio" name="{uid}-kind" value={k.id} bind:group={kind} />
							<span>{k.label}</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<div class="row">
				{#if kind === 'between'}
					<label class="field">
						<span class="name">From</span>
						<input bind:value={low} inputmode="decimal" autocomplete="off" />
					</label>
				{/if}
				<label class="field">
					<span class="name">{kind === 'between' ? 'To' : 'Limit'}</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value inputmode="decimal" autocomplete="off" autofocus />
				</label>
				{#if quantity && units.length}
					<label class="field unit">
						<span class="name">Unit</span>
						<select bind:value={unit}>
							{#each units as u (u)}<option value={u}>{u.replace(/\*/g, '·')}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
			{#if verdict}
				<p class="verdict" class:met={verdict.met}>
					Now {verdict.now}: {verdict.met ? 'it meets' : 'it does not meet'}
					{limit ? limitWords(limit) : ''}.
				</p>
			{/if}
		{:else if !onRequirement || subject || partChoice}
			<p class="note">
				{onRequirement ? 'What it is about' : element?.label} has no values that are numbers yet. Give
				it one (an attribute such as mass) first.
			</p>
		{/if}
		{#if onRequirement && subject && needsPart}
			<label class="field">
				<span class="name">Which part must meet it? <small class="hint">(optional)</small></span>
				<select bind:value={partChoice}>
					<option value="">None yet</option>
					{#each partOptions as q (q)}<option value={q}>{shortName(q)}</option>{/each}
				</select>
				<small class="hint">Without one the check can’t say yet whether it is met.</small>
			</label>
		{/if}
	{:else}
		<div class="row">
			<label class="field id">
				<span class="name">ID</span>
				<input bind:value={id} autocomplete="off" />
			</label>
			<label class="field">
				<span class="name">Title</span>
				<input bind:value={title} oninput={() => (edited.title = true)} autocomplete="off" />
			</label>
		</div>
		<label class="field">
			<span class="name">Statement</span>
			<textarea bind:value={statement} rows="3" oninput={() => (edited.statement = true)}
			></textarea>
		</label>
		{#if features?.isDefinition}
			<label class="field">
				<span class="name">Which part of the design must meet it?</span>
				<select bind:value={partChoice}>
					<option value="">None yet</option>
					{#each partOptions as q (q)}<option value={q}>{shortName(q)}</option>{/each}
				</select>
			</label>
		{:else}
			<p class="note">{element?.label} must meet it: the design checks show whether it does.</p>
		{/if}
	{/if}
</CreateDialog>

<style>
	.unit {
		flex: 0 1 7rem !important;
	}
	.id {
		flex: 0 1 8rem !important;
	}
	.verdict {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		font-size: var(--text-sm);
	}
	.verdict.met {
		background: var(--ok-weak);
	}
</style>
