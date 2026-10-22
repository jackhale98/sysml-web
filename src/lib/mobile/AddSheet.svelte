<script lang="ts">
	import { untrack } from 'svelte';
	import type { ModelElement } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import { addElement } from '#lib/workbench/actions.ts';
	import AddForm from '#lib/workbench/AddForm.svelte';
	import { canOwnMembers, type AddKind } from '#lib/workbench/templates.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import Sheet from './Sheet.svelte';

	/**
	 * Add an element by filling in a form rather than typing SysML. The owner
	 * starts as the selected element (or what contains it), else the package
	 * of the open view, and can be changed.
	 */
	let {
		workspace,
		ui,
		context = null
	}: { workspace: Workspace; ui: WorkbenchUi; context?: ModelElement | null } = $props();

	const PACKAGE_KINDS: AddKind[] = [
		'part def',
		'port def',
		'item def',
		'requirement',
		'action def',
		'state def',
		'package'
	];
	const MEMBER_KINDS: AddKind[] = ['part', 'port', 'attribute', 'action', 'requirement'];

	/** A place a guide asked for (for a new requirement or part), kept while the sheet is open. */
	let askedOwner = $state<string | null>(null);
	const candidates = $derived.by(() => {
		const own = workspace.elements.filter(
			(e) => !isLibraryFile(e.file) && canOwnMembers(e.kind, e.isDefinition)
		);
		const out: ModelElement[] = [];
		const add = (e: ModelElement | null | undefined) => {
			if (e && canOwnMembers(e.kind, e.isDefinition) && !isLibraryFile(e.file)) {
				if (!out.some((o) => o.key === e.key)) out.push(e);
			}
		};
		// The selection and what contains it, innermost first.
		let current = workspace.elements.find((e) => e.key === ui.selection?.key);
		for (let depth = 0; current && depth < 12; depth++) {
			add(current);
			const parent: string | null = current.parent;
			const file: string = current.file;
			current = parent
				? workspace.elements.find((e) => e.file === file && e.name === parent)
				: undefined;
		}
		add(context);
		// Asked for by a guide (a place for a new requirement or part).
		add(workspace.elements.find((e) => e.key === askedOwner));
		for (const e of own) if (e.kind === 'package') add(e);
		return out;
	});

	let ownerKey = $state('');
	/** The kind the form starts with: the one asked for, else a part. */
	let initialKind = $state<AddKind | undefined>(undefined);
	$effect.pre(() => {
		if (!ui.addSheet) return;
		untrack(() => {
			askedOwner = ui.addOwner;
			const asked = askedOwner && candidates.find((c) => c.key === askedOwner);
			ownerKey = asked ? asked.key : (candidates[0]?.key ?? '');
			initialKind = ui.addKind ?? undefined;
			ui.addOwner = null;
			ui.addKind = null;
		});
	});
	const owner = $derived(candidates.find((c) => c.key === ownerKey) ?? candidates[0]);

	function describe(e: ModelElement): string {
		const kind = e.isDefinition && e.kind !== 'package' ? `${e.kind} def` : e.kind;
		return `${e.label} (${kind.replace(/_/g, ' ')})`;
	}
</script>

<Sheet bind:open={ui.addSheet} label="Add an element">
	{#if !owner}
		<p class="none">There is no package to add to yet.</p>
	{:else}
		<label class="owner">
			<span>Add inside</span>
			<select bind:value={ownerKey}>
				{#each candidates as c (c.key)}
					<option value={c.key}>{describe(c)}</option>
				{/each}
			</select>
		</label>
		{#key owner.key}
			<AddForm
				ownerLabel={owner.label}
				kinds={owner.kind === 'package' ? PACKAGE_KINDS : MEMBER_KINDS}
				{initialKind}
				onadd={async (kind, name, type) => {
					const error = await addElement(workspace, owner, kind, name, type);
					if (!error) ui.addSheet = false;
					return error;
				}}
				oncancel={() => (ui.addSheet = false)}
			/>
		{/key}
	{/if}
</Sheet>

<style>
	.owner {
		display: grid;
		gap: var(--space-1);
		margin: 0 0 var(--space-3);
		padding: 0 var(--space-1);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	select {
		height: 3rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text);
	}
	/* The form sits in the sheet rather than floating as a card. */
	.owner ~ :global(form.add-form) {
		width: 100%;
		padding: 0 var(--space-1);
		border: 0;
		box-shadow: none;
		background: transparent;
	}
	.owner ~ :global(form.add-form input),
	.owner ~ :global(form.add-form select) {
		height: 3rem;
		border-radius: var(--radius-md);
	}
	.owner ~ :global(form.add-form button) {
		height: 3rem;
		flex: 1;
		border-radius: var(--radius-md);
	}
	.owner ~ :global(form.add-form .where) {
		display: none;
	}
	.none {
		padding: var(--space-4) var(--space-2);
		color: var(--text-2);
	}
</style>
