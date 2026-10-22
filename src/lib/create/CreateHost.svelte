<script lang="ts">
	/**
	 * The guided form `ui.create` asks for (`#lib/create`), one at a time.
	 * The risk forms load when first asked for.
	 */
	import type { Engine } from '#lib/engine/client.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { CreateRequest, WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import LimitForm from './LimitForm.svelte';
	import NewViewForm from './NewViewForm.svelte';
	import RollupForm from './RollupForm.svelte';
	import TradeForm from './TradeForm.svelte';

	let { workspace, ui, engine }: { workspace: Workspace; ui: WorkbenchUi; engine: Engine } =
		$props();

	/** The request on show; a new request starts a fresh form. */
	let request = $state.raw<CreateRequest | null>(null);
	let open = $state(false);
	let generation = $state(0);
	$effect(() => {
		const asked = ui.create;
		if (!asked) return;
		request = asked;
		generation++;
		open = true;
		ui.create = null;
	});
	$effect(() => {
		if (!open && request) {
			// Let the dialog close before the form goes away.
			const done = request;
			queueMicrotask(() => {
				if (!open && request === done) request = null;
			});
		}
	});
</script>

{#if request}
	{#key generation}
		{#if request.kind === 'view'}
			<NewViewForm
				bind:open
				{workspace}
				{ui}
				{engine}
				viewKind={request.viewKind}
				target={request.target}
			/>
		{:else if request.kind === 'rollup'}
			<RollupForm
				bind:open
				{workspace}
				{ui}
				{engine}
				element={request.element}
				attribute={request.attribute}
			/>
		{:else if request.kind === 'limit'}
			<LimitForm
				bind:open
				{workspace}
				{engine}
				element={request.element}
				attribute={request.attribute}
			/>
		{:else if request.kind === 'trade'}
			<TradeForm bind:open {workspace} {ui} {engine} alternatives={request.alternatives ?? []} />
		{:else if request.kind === 'fmea'}
			{#await import('./FmeaForm.svelte') then { default: FmeaForm }}
				<FmeaForm bind:open {workspace} {ui} {engine} kindId={request.fmeaKind} />
			{/await}
		{:else if request.kind === 'fmeaLine'}
			{#await import('./FmeaLineForm.svelte') then { default: FmeaLineForm }}
				<FmeaLineForm bind:open {workspace} {engine} view={request.view} />
			{/await}
		{:else if request.kind === 'hazard'}
			{#await import('./HazardForm.svelte') then { default: HazardForm }}
				<HazardForm bind:open {workspace} {ui} {engine} />
			{/await}
		{:else if request.kind === 'riskPolicy'}
			{#await import('./RiskPolicyForm.svelte') then { default: RiskPolicyForm }}
				<RiskPolicyForm bind:open {workspace} {engine} />
			{/await}
		{:else if request.kind === 'savedReview'}
			{#await import('./SaveReviewForm.svelte') then { default: SaveReviewForm }}
				<SaveReviewForm bind:open {workspace} {ui} {request} />
			{/await}
		{/if}
	{/key}
{/if}
